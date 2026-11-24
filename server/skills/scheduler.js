'use strict'
/**
 * task194：通用定时 skill 调度器
 * - 注册表 REGISTRY：id -> { id, name, defaults, run(settings) }
 * - 配置持久化：<ROOT>/config/skills.json（内存单例 + tmp→rename 原子写）
 * - tick 每 60s：enabled 且 now >= nextRunAt → execSkill；interval.unref() 不阻止进程退出
 * - 安全：运行日志只写白名单字段（绝不 dump settings / 凭据）
 * - 方案审 P1-2：run 超时看门狗 / tick try-catch / 原子写；P1-3：凭据不落日志
 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const ROOT = require('../paths').ROOT
const CONFIG_FILE = path.join(ROOT, 'config', 'skills.json')
const LOG_FILE = path.join(ROOT, 'logs', 'skills.jsonl')
const TICK_MS = 60 * 1000
const RUN_TIMEOUT_MS = 120 * 1000
const LOG_MAX_LINES = 200 // 运行日志保留上限（超出裁剪头部）

const REGISTRY = Object.create(null)
let timer = null
let CFG = null // 内存单例（node 单线程 + 同步写，天然不交错）

function register (skill) {
  if (!skill || !skill.id || typeof skill.run !== 'function') throw new Error('skill 必须有 id 与 run()')
  REGISTRY[skill.id] = skill
}

function skillIds () { return Object.keys(REGISTRY) }

function defaultState () {
  return { running: false, runningSince: 0, nextRunAt: 0, lastRunAt: 0, lastResult: null }
}

function loadConfig () {
  try {
    const d = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    if (!d || typeof d !== 'object' || !d.skills || typeof d.skills !== 'object') return { version: 1, skills: {} }
    return d
  } catch (e) { return { version: 1, skills: {} } }
}

function getCfg () {
  if (!CFG) CFG = loadConfig()
  return CFG
}

function saveCfg () {
  const cfg = getCfg()
  try {
    fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
    const tmp = CONFIG_FILE + '.tmp-' + process.pid
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
    fs.renameSync(tmp, CONFIG_FILE)
  } catch (e) { /* 写失败不阻断调度，下次 tick 再试 */ }
}

function deepClone (o) { return JSON.parse(JSON.stringify(o || {})) }

// 确保注册 skill 在配置中有条目（缺省 settings + state）
function entry (id) {
  const cfg = getCfg()
  const skill = REGISTRY[id]
  if (!cfg.skills[id]) {
    cfg.skills[id] = { settings: deepClone(skill.defaults), state: defaultState() }
  }
  const s = cfg.skills[id]
  if (!s.settings) s.settings = deepClone(skill.defaults)
  if (!s.state) s.state = defaultState()
  return s
}

// ---------- 时间计算（纯函数，供 selftest 直接验证） ----------
const MODES = ['daily', 'every3days', 'weekly', 'monthly']

function parseTime (t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || ''))
  if (!m) return { hh: 8, mm: 0 }
  return { hh: Math.min(23, Math.max(0, Number(m[1]))), mm: Math.min(59, Math.max(0, Number(m[2]))) }
}

function clampMonth (d, origDay) {
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(origDay, last))
  return d
}

/**
 * 计算严格大于 fromMs 的下一个触发时刻。
 * daily      ：下一个 hh:mm（今天未到→今天；已过→明天）
 * every3days ：基准日 hh:mm；已过则 +3 天（基准=上次触发时刻 → 正好 3 天后同刻）
 * weekly     ：基准日 hh:mm；已过则 +7 天
 * monthly    ：基准日 hh:mm；已过则下月同日（月末 clamp）
 */
function computeNextRun (schedule, fromMs) {
  const sc = schedule || {}
  const mode = MODES.indexOf(sc.mode) >= 0 ? sc.mode : 'every3days'
  const t = parseTime(sc.time)
  const baseMs = Number(fromMs) || Date.now()
  const base = new Date(baseMs)
  const d = new Date(baseMs)
  d.setSeconds(0, 0)
  d.setHours(t.hh, t.mm, 0, 0)
  if (mode === 'monthly') {
    if (d.getTime() <= baseMs) { d.setDate(1); d.setMonth(d.getMonth() + 1); clampMonth(d, base.getDate()) }
    d.setHours(t.hh, t.mm, 0, 0)
    return d.getTime()
  }
  const step = mode === 'daily' ? 1 : (mode === 'every3days' ? 3 : 7)
  if (d.getTime() <= baseMs) d.setDate(d.getDate() + step)
  return d.getTime()
}

// 首次启用：下一个 hh:mm（不叠加间隔，尽早跑第一轮）
function computeFirstRun (schedule, nowMs) {
  const sc = schedule || {}
  const t = parseTime(sc.time)
  const d = new Date(nowMs || Date.now())
  d.setSeconds(0, 0)
  d.setHours(t.hh, t.mm, 0, 0)
  if (d.getTime() <= (nowMs || Date.now())) d.setDate(d.getDate() + 1)
  return d.getTime()
}

// ---------- 运行日志（白名单字段） ----------
function appendLog (rec) {
  const line = JSON.stringify({
    id: String(rec.id || ''),
    at: Number(rec.at) || Date.now(),
    ok: !!rec.ok,
    count: Number(rec.count) || 0,
    durationMs: Number(rec.durationMs) || 0,
    error: String(rec.error || '').slice(0, 300)
  }) + '\n'
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line)
    // 简单裁剪：文件过大时只留尾部 LOG_MAX_LINES 行
    const st = fs.statSync(LOG_FILE)
    if (st.size > 64 * 1024) {
      const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n')
      if (lines.length > LOG_MAX_LINES) {
        fs.writeFileSync(LOG_FILE, lines.slice(-LOG_MAX_LINES).join('\n') + '\n')
      }
    }
  } catch (e) { /* 日志写失败不阻断 */ }
}

function readLog (id, limit) {
  const n = Math.min(50, Math.max(1, Number(limit) || 10))
  try {
    const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean)
    const out = []
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      try {
        const rec = JSON.parse(lines[i])
        if (!id || rec.id === id) out.push(rec)
      } catch (e) { /* 跳过坏行 */ }
    }
    return out.reverse()
  } catch (e) { return [] }
}

// ---------- 执行 ----------
function execSkill (id, plannedAt) {
  const skill = REGISTRY[id]
  if (!skill) return Promise.resolve({ ok: false, error: 'skill 未注册' })
  let s
  try { s = entry(id) } catch (e) { return Promise.resolve({ ok: false, error: '配置读取失败' }) }
  if (s.state.running) return Promise.resolve({ ok: false, error: '已在运行中' })
  s.state.running = true
  s.state.runningSince = Date.now()
  const t0 = Date.now()
  let watchdog = null
  const runPromise = Promise.resolve().then(function () { return skill.run(deepClone(s.settings)) })
  const timeoutPromise = new Promise(function (resolve, reject) {
    watchdog = setTimeout(function () { reject(new Error('运行超时（' + Math.round(RUN_TIMEOUT_MS / 1000) + 's）')) }, RUN_TIMEOUT_MS)
    if (watchdog.unref) watchdog.unref()
  })
  return Promise.race([runPromise, timeoutPromise]).then(function (res) {
    return { ok: !(res && res.ok === false), count: (res && res.count) || 0, error: (res && res.error) || '' }
  }, function (e) {
    return { ok: false, count: 0, error: String((e && e.message) || e).slice(0, 300) }
  }).then(function (r) {
    if (watchdog) clearTimeout(watchdog)
    const dur = Date.now() - t0
    const now = Date.now()
    s.state.running = false
    s.state.runningSince = 0
    s.state.lastRunAt = now
    s.state.lastResult = { ok: r.ok, count: r.count, durationMs: dur, error: r.error, at: now }
    // 下次触发从 max(计划时刻, 现在) 起算：跑晚了不立即连环触发
    s.state.nextRunAt = computeNextRun(s.settings.schedule, Math.max(Number(plannedAt) || 0, now))
    saveCfg()
    appendLog({ id: id, at: now, ok: r.ok, count: r.count, durationMs: dur, error: r.error })
    return s.state.lastResult
  })
}

// ---------- tick ----------
function tick (nowMs) {
  const now = Number(nowMs) || Date.now()
  let touched = false
  skillIds().forEach(function (id) {
    try {
      const s = entry(id)
      const sc = s.settings && s.settings.schedule
      if (!sc || sc.enabled === false) return
      if (s.state.running) return
      if (!s.state.nextRunAt) {
        s.state.nextRunAt = computeFirstRun(sc, now)
        touched = true
        return
      }
      if (now >= s.state.nextRunAt) {
        touched = true
        execSkill(id, s.state.nextRunAt).catch(function () {})
      }
    } catch (e) { /* 单个 skill 异常不影响其他（P1-2） */ }
  })
  if (touched) saveCfg()
}

function start () {
  if (timer) return
  skillIds().forEach(function (id) {
    try {
      const s = entry(id)
      // 产出审 P1-1：进程在 run 中死亡会永久残留 running:true（tick 永跳过 + runNow 永拒，skill 哑火须手改文件）→ 启动即复位
      if (s.state.running) { s.state.running = false; s.state.runningSince = 0 }
    } catch (e) {}
  })
  saveCfg()
  timer = setInterval(function () { try { tick() } catch (e) {} }, TICK_MS)
  if (timer.unref) timer.unref()
}

function stop () {
  if (timer) { clearInterval(timer); timer = null }
}

// ---------- 对外数据（凭据递归掩码：任何层级常见凭据键名一律 ********） ----------
const CRED_KEY = /^(pass|password|apikey|api_key|secret|accesskey|secretkey)$/i
function maskDeep (v, depth) {
  if (depth > 4 || v == null) return v
  if (Array.isArray(v)) return v.map(function (x) { return maskDeep(x, depth + 1) })
  if (typeof v === 'object') {
    const o = {}
    Object.keys(v).forEach(function (k) {
      const val = v[k]
      if (CRED_KEY.test(k) && typeof val === 'string' && val) o[k] = '********'
      else o[k] = maskDeep(val, depth + 1)
    })
    return o
  }
  return v
}
function maskSettings (settings) {
  return maskDeep(deepClone(settings), 0)
}

function listSkills () {
  return skillIds().map(function (id) {
    const skill = REGISTRY[id]
    const s = entry(id)
    const sc = (s.settings && s.settings.schedule) || {}
    return {
      id: id,
      name: skill.name || id,
      enabled: sc.enabled !== false,
      schedule: { mode: sc.mode || 'every3days', time: sc.time || '08:00', enabled: sc.enabled !== false },
      nextRunAt: s.state.nextRunAt || 0,
      running: !!s.state.running,
      lastRunAt: s.state.lastRunAt || 0,
      lastResult: s.state.lastResult || null,
      sources: (s.settings && Array.isArray(s.settings.sources)) ? s.settings.sources.map(function (x) { return { id: x.id, name: x.name, url: x.url, enabled: x.enabled !== false, hasCredential: !!(x.credential && x.credential.pass) } }) : [],
      settings: maskSettings(s.settings)
    }
  })
}

function updateSettings (id, patch) {
  const skill = REGISTRY[id]
  if (!skill) return { ok: false, error: '未知 skill：' + id }
  const s = entry(id)
  const cur = s.settings || deepClone(skill.defaults)
  const p = patch && typeof patch === 'object' ? patch : {}
  // sources 整体替换（凭据：空串=保留旧值，输入新值才覆盖）
  if (Array.isArray(p.sources)) {
    const old = Array.isArray(cur.sources) ? cur.sources : []
    const oldById = {}
    old.forEach(function (o) { if (o && o.id) oldById[String(o.id)] = o })
    cur.sources = p.sources.slice(0, 20).map(function (src, i) {
      const os = (src && src.id && oldById[String(src.id)]) || old[i] || {}
      const oc = os.credential || {}
      const nc = (src && src.credential) || {}
      const keepPass = String(oc.pass || '').slice(0, 500)
      return {
        id: String((src && src.id) || os.id || ('source' + i)).slice(0, 40),
        name: String((src && src.name) || os.name || '数据源').slice(0, 60),
        url: String((src && src.url) || '').slice(0, 500),
        enabled: (src && src.enabled) !== false,
        // pass：'__CLEAR__'=显式清空；非空新值=覆盖；空串=保留已存（前端「不改请留空」）
        credential: {
          user: String(nc.user || '').slice(0, 200),
          pass: nc.pass === '__CLEAR__' ? '' : (String(nc.pass || '') ? String(nc.pass).slice(0, 500) : keepPass)
        }
      }
    })
  }
  if (p.schedule && typeof p.schedule === 'object') {
    const prev = cur.schedule || {}
    const mode = MODES.indexOf(p.schedule.mode) >= 0 ? p.schedule.mode : (prev.mode || 'every3days')
    cur.schedule = {
      mode: mode,
      time: String(p.schedule.time || prev.time || '08:00').slice(0, 5),
      enabled: p.schedule.enabled !== undefined ? !!p.schedule.enabled : prev.enabled !== false
    }
    s.state.nextRunAt = computeNextRun(cur.schedule, Date.now())
  }
  s.settings = cur
  saveCfg()
  return { ok: true, skill: listSkills().filter(function (x) { return x.id === id })[0] }
}

function runNow (id) {
  const skill = REGISTRY[id]
  if (!skill) return { ok: false, error: '未知 skill：' + id }
  const s = entry(id)
  if (s.state.running) return { ok: false, error: '已在运行中，请等本轮结束' }
  execSkill(id, Date.now()).catch(function () {})
  return { ok: true, started: true }
}

module.exports = {
  register: register,
  start: start,
  stop: stop,
  tick: tick,
  listSkills: listSkills,
  updateSettings: updateSettings,
  runNow: runNow,
  readLog: readLog,
  _test: { computeNextRun: computeNextRun, computeFirstRun: computeFirstRun, parseTime: parseTime, getCfg: getCfg, setCfgForTest: function (c) { CFG = c }, CONFIG_FILE: CONFIG_FILE }
}

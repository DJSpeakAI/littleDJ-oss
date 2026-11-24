// wedge-heal: 会话卡死（半开回合）自动解封（task316）
// 事故：2026-11-15 13:40 大管家回合在 question 工具上等主人回答；14:27:45 主人答完，
// 14:27:53 又发「继续」，serve 收了新提示词却不再起回合 → 会话永远停在「assistant 未完成 + 后发 user」。
// 现有 autoheal 只认「空回合（0 parts/仅 step-start）」，autoresume 只认「尾消息 user / assistant 部件悬空」，
// 这类「有内容但没 completed 的半开回合」两边都不管 → 主人看到「空闲中」却永远不动。
//
// 本脚本的三段动作（均幂等、有超时、有冷却）：
//   ① 检测：server/wedge-detect.js 纯函数（半开回合 + 后发 user 或尾部件静默超阈值；跳过等回答/工具在跑）
//   ② 软解：abort 掉半开回合 → 重放「后发 user 原话」→ 18s 后验证是否真有新 assistant 部件产出
//   ③ 硬解：软解无效 → 等全局安静窗（无其它会话在跑工具/刚发消息）→ POST /_serve/restart（全局唯一可靠解）
//          → 重启就绪后重放提示词 → 验证；仍失败只落 run/wedge-alert.json 告警，绝不无限重启
// 红线：不碰等主人回答的 question、不碰工具在跑的会话、不碰子会话、不碰左栏已归档（hidden-sessions.json）；
//       每会话 15min 冷却 + 每 30min 最多一次 serve 重启。
// task377（2026-11-18 主人实锤）：DAG_AI_Chat 解除拒入——该目录会话 21:04 卡死到 21:35 无人自愈，
//       根因正是本条拒入表把唯一的自动解锁通道也挡掉了（detect 自带 question/工具在跑/年龄闸三重防误杀，
//       abort 只释放锁不改文件；env LITTLEDJ_WEDGE_DENY_DIRS=DAG_AI_Chat 可回退旧行为）。
// task397（2026-11-23「新对话 17:23」事故）：项目级段 abort 成功后补一句固定恢复语（RECOVER_TEXT）。
//       旧行为只 abort 不补——主人排在挂死回合后面的消息随 abort 一起没人处理（当日 03:01 实证：
//       掐掉后尾消息=user 无人应答，续跑巡检又因护栏旧账拦下，会话就此停摆）。
//       用固定恢复语不重放主人原话：原话在会话历史里本来就留着（模型续跑时看得见），且原话带
//       proxy 注入的水印前缀，原样重放=把可能已过期的模式水印再灌一遍（task395 P2-6 同类风险）。
// 调度：deploy/watchdog.sh 每 WEDGE_EVERY 跳（默认 4×15s=60s）后台跑一次；单实例锁。
// 用法：node server/wedge-heal.js [--dry] [--json]
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const WD = require('./wedge-detect')

const ROOT = require('./paths').ROOT
const PROXY_PORT = Number(process.env.LITTLEDJ_PORT || 4097)
const RECENT_MS = Number(process.env.LITTLEDJ_WEDGE_RECENT_MS || 6 * 3600 * 1000)
const MIN_AGE_MS = Number(process.env.LITTLEDJ_WEDGE_MIN_AGE_MS || 8 * 60 * 1000)
const IDLE_MS = Number(process.env.LITTLEDJ_WEDGE_IDLE_MS || 12 * 60 * 1000)
const SESSION_COOLDOWN_MS = Number(process.env.LITTLEDJ_WEDGE_COOLDOWN_MS || 15 * 60 * 1000)
const SOFT_FAIL_RETRY_MS = Number(process.env.LITTLEDJ_WEDGE_SOFT_RETRY_MS || 60 * 1000) // 软解失败后 1min 内可再试（硬解等全局安静窗）
const RESTART_COOLDOWN_MS = Number(process.env.LITTLEDJ_WEDGE_RESTART_COOLDOWN_MS || 30 * 60 * 1000)
const MAX_TARGETS = Number(process.env.LITTLEDJ_WEDGE_MAX || 2)
const SCAN_MAX = Number(process.env.LITTLEDJ_WEDGE_SCAN_MAX || 10)
const PROMPT_WAIT_MS = Number(process.env.LITTLEDJ_WEDGE_PROMPT_WAIT_MS || 18000)
const AFTER_RESTART_WAIT_MS = Number(process.env.LITTLEDJ_WEDGE_RESTART_WAIT_MS || 20000)
// task377：默认不拒入任何目录（含 DAG_AI_Chat）；需要临时冻结某目录时用 env 显式回退。
const DENY_DIRS = (process.env.LITTLEDJ_WEDGE_DENY_DIRS || '').split(',').map(function (s) { return s.trim() }).filter(Boolean)
const DRY = process.argv.includes('--dry')
const AS_JSON = process.argv.includes('--json')

// task366（2026-11-16 DAG 事故）：项目级卡死检测——挂死回合占项目锁→整目录瘫痪，abort 无效、
// 只能重启 serve。本段只做预警：检测+告警+（非拒入目录）对 detect 命中的主会话做 abort 尝试；
// 绝不自动重启 serve（C 类红线）、绝不 prompt 注入。env 全可调；NO_ABORT 全局只告警。
const BACKEND_PORT = Number(process.env.LITTLEDJ_BACKEND_PORT || 4098)
const PROJECT_MS = Number(process.env.LITTLEDJ_WEDGE_PROJECT_MS || 15 * 60 * 1000) // 仅判据③ prompt 窗（判据①固定 detect 默认 8/12min，防刀锋交集）
const PROJECT_ALERT_COOLDOWN_MS = Number(process.env.LITTLEDJ_WEDGE_PROJECT_ALERT_COOLDOWN_MS || 30 * 60 * 1000)
const PROJECT_MSG_BUDGET = Number(process.env.LITTLEDJ_WEDGE_PROJECT_MSG_BUDGET || 12) // 每轮 message 拉取预算，控制扫描放大
const PROJECT_NO_ABORT = process.env.LITTLEDJ_WEDGE_PROJECT_NO_ABORT === '1'
// task377：DENY_DIRS 默认已空 → isDeny 恒 false，项目级 abort 对 DAG 同样生效；本开关保留作总闸。
const PROJECT_DENY_ABORT = process.env.LITTLEDJ_WEDGE_PROJECT_DENY_ABORT === '1' // 拒入目录（env 回退时）默认只告警不 abort；此开关=主人明示授权才可开（P2-9：开了=间接动 DAG 在途工具）
const PROJECT_ENABLED = process.env.LITTLEDJ_WEDGE_PROJECT !== '0' // task366 应急总闸：=0 跳过项目级整段（单会话逻辑不变，P1-D）
const PROJECT_ALERT_FILE = path.join(ROOT, 'run', 'wedge-project-alert.json')

const LOCK = path.join(ROOT, 'run', 'wedge-heal.pid')
const LOG = path.join(ROOT, 'logs', 'wedge-heal.log')
const STATE_FILE = path.join(ROOT, 'config', 'wedge-heal-state.json')
const ALERT_FILE = path.join(ROOT, 'run', 'wedge-alert.json')
const LOG_JSONL = path.join(ROOT, 'run', 'wedge-heal-log.jsonl')
const HIDDEN_FILE = path.join(ROOT, 'config', 'hidden-sessions.json')

function log(msg) {
  const line = new Date().toISOString().replace('T', ' ').replace('Z', '') + ' [wedge] ' + msg
  try { fs.appendFileSync(LOG, line + '\n') } catch (e) { console.error(line + ' (' + e.message + ')') }
  if (!AS_JSON) console.log(line)
}

function logJsonl(obj) {
  try {
    fs.mkdirSync(path.dirname(LOG_JSONL), { recursive: true })
    try {
      const st = fs.statSync(LOG_JSONL)
      if (st.size > 1024 * 1024) {
        try { fs.unlinkSync(LOG_JSONL + '.old') } catch (e) {}
        fs.renameSync(LOG_JSONL, LOG_JSONL + '.old')
      }
    } catch (e) { /* 首写 */ }
    fs.appendFileSync(LOG_JSONL, JSON.stringify(obj) + '\n')
  } catch (e) { /* 审计失败不阻断 */ }
}

function readAuth() {
  try { return fs.readFileSync(path.join(ROOT, 'config', 'auth.txt'), 'utf8').trim() } catch (e) { return '' }
}
const AUTH = readAuth()

function request(method, p, body, timeoutMs) {
  timeoutMs = timeoutMs || 20000
  return new Promise(function (resolve) {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null
    const headers = { Authorization: 'Basic ' + Buffer.from(AUTH).toString('base64') }
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = payload.length
    }
    let settled = false
    const finish = function (out) { if (settled) return; settled = true; resolve(out) }
    const req = http.request({ host: '127.0.0.1', port: PROXY_PORT, method: method, path: p, headers: headers }, function (res) {
      const chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8')
        let json = null
        try { json = JSON.parse(text) } catch (e) {}
        finish({ status: res.statusCode, json: json, text: text })
      })
      res.on('error', function (e) { finish({ status: 0, error: e.message }) })
      res.on('aborted', function () { finish({ status: 0, error: 'aborted' }) })
    })
    req.setTimeout(timeoutMs, function () { req.destroy(new Error('timeout ' + method + ' ' + p)) })
    req.on('error', function (e) { finish({ status: 0, error: e.message }) })
    if (payload) req.write(payload)
    req.end()
  })
}

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

// task366：项目级段专用请求——直连 serve 4098 无 auth（不经 proxy：abort 经 proxy 会联动
// queueSetPaused 把该会话队列静默暂停（P1-7）；且 proxy 侧 /api/session/status 有恒返 {} 的
// 历史（task80 G2，P1-新4）。路径一律无 /api 前缀（L-097：带 /api 回 serve 网页壳 HTML）。
function bareReq(method, p, body, timeoutMs) {
  timeoutMs = timeoutMs || 10000
  return new Promise(function (resolve) {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null
    const headers = {}
    if (payload) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = payload.length
    }
    let settled = false
    const finish = function (out) { if (settled) return; settled = true; resolve(out) }
    const r = http.request({ host: '127.0.0.1', port: BACKEND_PORT, method: method, path: p, headers: headers }, function (res) {
      const chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end', function () { finish({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }) })
      res.on('error', function (e) { finish({ status: 0, error: e.message }) })
    })
    r.setTimeout(timeoutMs, function () { r.destroy(new Error('timeout ' + method + ' ' + p)) })
    r.on('error', function (e) { finish({ status: 0, error: e.message }) })
    if (payload) r.write(payload)
    r.end()
  })
}

// task366：项目级卡死检测编排（判据组合见 wedge-detect.detectProject）。
// observe-boot：state 无 projects.bootAt 时首轮只记快照不处置（防上线即误报）；
// state 变更段末显式 saveState（短生命周期进程，L248 早退路径不落盘——P0-新1）。
async function projectWedgeScan(listArr, state, now, hiddenSet) {
  const projects = state.projects || (state.projects = {})
  // 按 directory 全量分组（仅主会话 parentID 空 + hidden 过滤与 candidates 同口径；
  // 不受 DENY_DIRS/SCAN_MAX 过滤——拒入表目录正是事故形态，只告警不注入不越线）。
  // P0-2 产出审修正：生产 /_sessions 返回顶层 directory（serve /session 端点 shape，
  // 2026-11-16 curl 实证），/api/session 端点才有 location.directory——顶层优先两者兼容。
  const byDir = {}
  for (const s of (listArr || [])) {
    if (!s || !s.id || s.parentID) continue
    if (s.pwa === 0) continue
    if (hiddenSet && hiddenSet[s.id]) continue
    const dir = s.directory || (s.location && s.location.directory) || ''
    if (!dir) continue
    ;(byDir[dir] = byDir[dir] || []).push(s)
  }
  const dirs = Object.keys(byDir)
  log('project-wedge scan ' + dirs.length + ' dirs（busy 非空才拉明细）')
  if (!projects.bootAt) {
    // P1-2 产出审：DRY 预演零写副作用（否则一次 --dry 就吃掉正式轮的 observe-boot）
    if (DRY) { log('[dry] project-wedge observe-boot：首轮只观察，不写 state'); return }
    projects.bootAt = now
    saveState(state)
    log('project-wedge observe-boot：首轮只记快照不处置（防上线即误报）')
    return
  }
  let msgBudget = PROJECT_MSG_BUDGET
  let stateDirty = false
  for (const dir of dirs) {
    const st = await bareReq('GET', '/session/status?directory=' + encodeURIComponent(dir), null, 8000)
    let busyMap = null
    if (st.status === 200) {
      try {
        busyMap = JSON.parse(st.text)
        if (!busyMap || typeof busyMap !== 'object' || Array.isArray(busyMap)) busyMap = null
      } catch (e) { busyMap = null }
    }
    if (busyMap === null) {
      // 解析失败不许静默 fail-open（P1-4）：计入 jsonl warn，patrol project_wedge 可见（DRY 不写）
      if (DRY) { log('[dry] project-wedge status 解析失败 dir=' + dir + '（HTTP ' + st.status + '）'); continue }
      logJsonl({ ts: new Date().toISOString(), event: 'project-wedge', level: 'warn', dir: dir, reason: 'status-parse-fail', status: st.status, bodyHead: String(st.text || st.error || '').slice(0, 80) })
      log('WARN project-wedge status 解析失败 dir=' + dir + '（HTTP ' + st.status + '）')
      continue
    }
    const busyIds = Object.keys(busyMap).filter(function (k) {
      const v = busyMap[k]
      return v === true || (v && typeof v === 'object' && v.type === 'busy')
    })
    if (!busyIds.length) continue // 无人 busy=目录安静，不拉明细（控制放大）
    // 拉该目录主会话明细：detect() 判 wedged + 算最近 prompt
    const wedgedMains = []
    let lastPromptAt = 0
    for (const s of byDir[dir]) {
      if (msgBudget <= 0) {
        // P1-5 产出审：预算耗尽要 WARN 级 + jsonl 留痕（patrol/主人可见），不是静默 log
        log('WARN project-wedge msg 预算用尽（' + PROJECT_MSG_BUDGET + '），dir=' + dir + ' 剩余会话下轮再看')
        if (!DRY) logJsonl({ ts: new Date().toISOString(), event: 'project-wedge', level: 'warn', dir: dir, reason: 'msg-budget-exhausted' })
        break
      }
      msgBudget--
      const r = await bareReq('GET', '/session/' + encodeURIComponent(s.id) + '/message', null, 12000)
      if (r.status !== 200) continue
      let msgs = null
      try { msgs = JSON.parse(r.text) } catch (e) { continue }
      if (!Array.isArray(msgs)) continue
      for (const m of msgs) {
        const info = m && (m.info || m)
        if (info && info.role === 'user' && info.time && info.time.created && info.time.created > lastPromptAt) {
          lastPromptAt = info.time.created
        }
      }
      const d = WD.detect(msgs, now) // 判据①固定 detect 默认 8/12min 窗（P0-新2）
      if (d.wedged) wedgedMains.push(s.id)
    }
    const verdict = WD.detectProject({ dir: dir, wedgedMains: wedgedMains, busyIds: busyIds, lastPromptAt: lastPromptAt }, now, { promptMs: PROJECT_MS })
    if (!verdict.wedged) continue
    // 命中：冷却检查
    const pst = projects[dir] || (projects[dir] = {})
    if (pst.lastAlertAt && now - pst.lastAlertAt < PROJECT_ALERT_COOLDOWN_MS) continue
    // ② abort 前置判定（P1-3：note 按实际分支写，别让主人误以为已 abort）
    const abortedBefore = !!(pst.lastAbortAt && now - pst.lastAbortAt < PROJECT_ALERT_COOLDOWN_MS)
    const base = dir.split(/[\\/]/).filter(Boolean).pop() || ''
    const isDeny = DENY_DIRS.indexOf(base) >= 0
    const willAbort = !DRY && !PROJECT_NO_ABORT && !(isDeny && !PROJECT_DENY_ABORT) && !abortedBefore
    const note = abortedBefore ? 'abort-ineffective，需人工重启 serve'
      : (DRY ? '[dry] 预演命中，不处置' : (willAbort ? '已尝试 abort，下轮复查' : (isDeny ? '拒入目录（' + base + '）默认只告警不 abort' : 'NO_ABORT 配置只告警')))
    // ① 先告警（abort 可能清库内半条消息致 busy 回落，先落痕防漏报——P1-9）
    log('WARN project-wedge：目录疑似被挂死回合占锁 ' + dir + '（' + verdict.reason + '，busy=' + busyIds.length + '，wedged 主会话=' + wedgedMains.length + '，prompt ' + verdict.promptAgeMin + 'min 前' + (abortedBefore ? '，abort 已试过无效' : '') + '）——abort 无效时需重启 serve（绝不自动重启，等主人发话）')
    if (DRY) { log('[dry] project-wedge 命中不落盘：' + dir + ' note=' + note); continue } // P1-2：DRY 零写副作用
    logJsonl({ ts: new Date().toISOString(), event: 'project-wedge', level: 'warn', dir: dir, reason: verdict.reason, busyIds: busyIds, wedgedMains: wedgedMains, promptAgeMin: verdict.promptAgeMin, abortIneffective: abortedBefore, note: note })
    try {
      fs.mkdirSync(path.dirname(PROJECT_ALERT_FILE), { recursive: true })
      fs.writeFileSync(PROJECT_ALERT_FILE, JSON.stringify({ ts: new Date().toISOString(), dir: dir, reason: verdict.reason, busyIds: busyIds, wedgedMains: wedgedMains, note: note }, null, 2))
    } catch (e) { /* 告警落盘失败不阻断，jsonl 仍有痕 */ }
    pst.lastAlertAt = now
    stateDirty = true
    // ③ abort（仅非拒入目录 + 仅 detect 命中的主会话；拒入目录默认只告警——abort 会截断其 AI
    //    在途工具=间接动其项目文件，且事故实证 abort 不释放锁收益≈0）
    if (!willAbort) continue
    for (const sid of wedgedMains) {
      const ab = await bareReq('POST', '/session/' + encodeURIComponent(sid) + '/abort', {}, 10000)
      log('project-wedge abort ' + sid + ' -> HTTP ' + ab.status + (ab.status !== 200 ? ' ' + String(ab.text || ab.error || '').slice(0, 80) : ''))
      // task397：abort 受理后补一句固定恢复语（经 proxy，水印由 proxy 按当下模式注入）。只 abort 不补=
      // 主人排在挂死回合后面的消息随 abort 一起没人处理。未受理不重试：30min 冷却内本项目不再 abort，
      // 兜底交 autoresume 周期续跑（护栏口径 task397 已修，主人发过新话不再被旧账拦下）。
      if (ab.status < 200 || ab.status >= 300) continue
      const s = (byDir[dir] || []).filter(function (x) { return x.id === sid })[0] || { id: sid }
      await sleep(1200) // 给 serve 清半开消息的时间（同单会话软解节奏）
      const accepted = await promptSession(s, WD.RECOVER_TEXT)
      logJsonl({ ts: new Date().toISOString(), event: 'project-abort+prompt', sid: sid, accepted: accepted })
      log((accepted ? '✅ project-wedge 已补恢复语 ' : '⚠️ project-wedge 恢复语未受理 ') + sid + (accepted ? '（主人排在后面的消息请从中断处一并处理）' : '（等 autoresume 周期续跑兜底）'))
      // 产审 P2-4：给下面的单会话软解留冷却——abort 的 errored 状态若在本轮回合扫描前还没反映，
      // 单会话段会把同一会话再 abort+重放一次（同轮双注入）。受理=按软解成功留 15min；未受理=1min 后
      // 允许单会话软解接手再试。值用 project-ok（产审 R7）：只代表「恢复语已受理」，别和验证过起回合的
      // soft-ok 混成一个含义。
      const sess = state.sessions[sid] || {}
      state.sessions[sid] = { lastAt: Date.now(), attempts: (sess.attempts || 0) + 1, lastResult: accepted ? 'project-ok' : 'soft-fail' }
    }
    pst.lastAbortAt = Date.now()
    stateDirty = true // P2-1 产出审：显式置脏，不靠 lastAlertAt 顺带
  }
  if (stateDirty) saveState(state) // P0-新1：短生命周期进程，显式落盘
}

function readHidden() {
  try {
    const h = JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8')) || {}
    const set = {}
    ;(h.hidden || []).forEach(function (id) { if (typeof id === 'string' && id) set[id] = 1 })
    return set
  } catch (e) { return {} }
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}
    if (!s.sessions) s.sessions = {}
    return s
  } catch (e) { return { version: 1, sessions: {}, lastRestartAt: 0 } }
}

function saveState(s) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    const tmp = STATE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2))
    fs.renameSync(tmp, STATE_FILE)
  } catch (e) { log('WARN 状态写入失败：' + e.message) }
}

function writeAlert(unresolved, ts) {
  try {
    if (!unresolved || !unresolved.length) {
      try { fs.unlinkSync(ALERT_FILE) } catch (e) {}
      return
    }
    fs.mkdirSync(path.dirname(ALERT_FILE), { recursive: true })
    fs.writeFileSync(ALERT_FILE, JSON.stringify({ ts: ts || new Date().toISOString(), unresolved: unresolved }, null, 2))
  } catch (e) { /* 告警落盘失败不阻断 */ }
}

function verifyProgress(msgs, promptAt) {
  for (const row of msgs) {
    const info = row.info || {}
    if (info.role !== 'assistant') continue
    const created = (info.time && info.time.created) || 0
    if (created >= promptAt && (row.parts || []).length > 0 && !info.error) return true
    if (created >= promptAt && (row.parts || []).length > 0) return true
  }
  return false
}

async function promptSession(s, text) {
  const body = { parts: [{ type: 'text', text: text }] }
  if (s.agent) body.agent = s.agent
  if (s.model && s.model.providerID && s.model.id) body.model = { providerID: s.model.providerID, modelID: s.model.id }
  const r = await request('POST', '/api/session/' + encodeURIComponent(s.id) + '/prompt_async', body, 25000)
  return r.status >= 200 && r.status < 300
}

async function globalBusy(exclude) {
  const list = await request('GET', '/_sessions', null, 20000)
  if (list.status !== 200 || !Array.isArray(list.json)) return true // 读不到全局态：保守不动
  const now = Date.now()
  const recent = list.json.filter(function (s) {
    return s && s.time && s.time.updated && now - s.time.updated < 20 * 60 * 1000 && !exclude[s.id]
  }).slice(0, 12)
  for (const s of recent) {
    const r = await request('GET', '/api/session/' + encodeURIComponent(s.id) + '/message', null, 12000)
    if (r.status !== 200 || !Array.isArray(r.json) || !r.json.length) continue
    const last = r.json[r.json.length - 1]
    const info = last.info || {}
    const parts = last.parts || []
    if (info.role === 'user') {
      if (info.time && now - info.time.created < 90 * 1000) return true
      continue
    }
    if (info.role === 'assistant') {
      for (const p of parts) {
        if (p.type === 'tool' && p.state && p.state.status === 'running') {
          const started = (p.time && p.time.start) || 0
          if (!started || now - started < 20 * 60 * 1000) return true
        }
      }
      let lastAt = 0
      for (const p of parts) {
        const t = (p.time && (p.time.end || p.time.start)) || 0
        if (t > lastAt) lastAt = t
      }
      if (lastAt && now - lastAt < 90 * 1000) return true
      if (!lastAt && info.time && now - info.time.created < 3 * 60 * 1000) return true
    }
  }
  return false
}

async function waitServe(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 70000)
  while (Date.now() < deadline) {
    const r = await request('GET', '/api/session', null, 6000)
    if (r.status === 200) return true
    await sleep(2500)
  }
  return false
}

async function main() {
  if (!AUTH) { log('config/auth.txt 不可读，放弃'); process.exit(0) }

  // 单实例锁（stale 10min）
  try {
    const old = Number(fs.readFileSync(LOCK, 'utf8')) || 0
    if (Date.now() - old < 10 * 60 * 1000) { log('上一轮仍在跑（lock ' + Math.round((Date.now() - old) / 1000) + 's），退出'); process.exit(0) }
  } catch (e) { /* 无锁 */ }
  try {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true })
    fs.writeFileSync(LOCK, String(Date.now()))
  } catch (e) { log('WARN 写锁失败：' + e.message) }
  process.on('exit', function () { try { fs.unlinkSync(LOCK) } catch (e) {} })

  const now = Date.now()
  const hidden = readHidden()
  const state = readState()
  const pending = state.pendingRestart || (state.pendingRestart = {})
  const list = await request('GET', '/_sessions', null, 25000)
  if (list.status !== 200 || !Array.isArray(list.json)) { log('_sessions 不可读（HTTP ' + list.status + '），退出'); process.exit(0) }
  // task366：项目级卡死检测（独立 try，不影响下面单会话逻辑；复用同一 list/state——禁二次 readState）。
  // 与单会话流程先后关系（P2-10）：本段先跑、WARN 先落盘；下方的 task316 单会话硬解（含全局安静时
  // POST /_serve/restart）是既有独立车道，二者互不阻塞——项目级段自身绝不重启 serve。
  if (PROJECT_ENABLED) {
    try { await projectWedgeScan(list.json, state, now, hidden) } catch (e) { log('WARN project-wedge 段失败（不影响单会话逻辑）：' + (e && e.message)) }
  }
  const candidates = list.json.filter(function (s) {
    if (!s || !s.id || s.parentID) return false
    if (s.pwa === 0) return false
    if (!s.time || !s.time.updated || now - s.time.updated > RECENT_MS) return false
    if (hidden[s.id]) return false
    if (DENY_DIRS.length && s.directory) {
      const base = String(s.directory).split(/[\\/]/).filter(Boolean).pop() || ''
      if (DENY_DIRS.indexOf(base) >= 0) return false
    }
    return true
  }).sort(function (a, b) { return b.time.updated - a.time.updated }).slice(0, SCAN_MAX)

  const targets = []
  for (const s of candidates) {
    const msgs = await request('GET', '/api/session/' + encodeURIComponent(s.id) + '/message', null, 15000)
    if (msgs.status !== 200 || !Array.isArray(msgs.json)) continue
    const d = WD.detect(msgs.json, now, { minAgeMs: MIN_AGE_MS, idleMs: IDLE_MS })
    if (d.wedged) {
      targets.push({ s: s, d: d })
      log('命中 ' + s.id + ' "' + (s.title || '') + '"（' + d.reason + '，开回合 ' + d.openAgeMin + 'min，尾部件静默 ' + d.idleMin + 'min，后发 user=' + d.laterUser + '）')
      logJsonl({ ts: new Date().toISOString(), event: 'detect', sid: s.id, title: s.title || '', reason: d.reason, openMsgId: d.openMsgId, openAgeMin: d.openAgeMin, idleMin: d.idleMin, laterUser: d.laterUser })
    }
  }
  if (!targets.length && !Object.keys(pending).length) { log('无卡死候选（扫描 ' + candidates.length + ' 个活跃主会话）'); writeAlert(null); process.exit(0) }

  const results = []
  for (const t of targets.slice(0, MAX_TARGETS)) {
    const sid = t.s.id
    if (pending[sid]) {
      log('已待硬解，跳过软解（避免重复注入）：' + sid)
      results.push({ s: t.s, d: t.d, ok: false, pending: true })
      continue
    }
    const st = state.sessions[sid] || {}
    const cd = (st.lastResult === 'soft-ok' || st.lastResult === 'hard-ok' || st.lastResult === 'project-ok') ? SESSION_COOLDOWN_MS : SOFT_FAIL_RETRY_MS // project-ok（task397）：项目级段补恢复语已受理，未验证起回合，按 15min 冷却
    if (st.lastAt && now - st.lastAt < cd) {
      log('跳过 ' + sid + '（本会话 ' + Math.round((now - st.lastAt) / 60000) + 'min 前刚处理过，冷却中）')
      results.push({ s: t.s, d: t.d, ok: true, note: 'cooldown' })
      continue
    }
    if (DRY) { log('[dry] 将 abort+重放：' + sid + ' target=' + JSON.stringify(t.d.target.slice(0, 80))); results.push({ s: t.s, d: t.d, ok: true, note: 'dry' }); continue }
    log('软解 ' + sid + '：abort 半开回合 → 重放后发提示词')
    await request('POST', '/api/session/' + encodeURIComponent(sid) + '/abort', {}, 12000)
    await sleep(1200)
    const promptAt = Date.now()
    const accepted = await promptSession(t.s, t.d.target)
    logJsonl({ ts: new Date().toISOString(), event: 'abort+prompt', sid: sid, accepted: accepted, targetHead: String(t.d.target).slice(0, 120) })
    await sleep(PROMPT_WAIT_MS)
    const after = await request('GET', '/api/session/' + encodeURIComponent(sid) + '/message', null, 15000)
    const ok = after.status === 200 && Array.isArray(after.json) && verifyProgress(after.json, promptAt)
    state.sessions[sid] = { lastAt: Date.now(), attempts: (st.attempts || 0) + 1, lastResult: ok ? 'soft-ok' : 'soft-fail' }
    if (!ok) pending[sid] = { id: sid, title: t.s.title || '', target: t.d.target, reason: t.d.reason, agent: t.s.agent, model: t.s.model }
    else delete pending[sid]
    state.pendingRestart = pending
    saveState(state)
    log((ok ? '✅ 软解成功 ' : '⚠️ 软解未起回合 ') + sid)
    logJsonl({ ts: new Date().toISOString(), event: 'soft-verify', sid: sid, ok: ok })
    results.push({ s: t.s, d: t.d, ok: ok, note: ok ? 'soft-ok' : 'soft-fail' })
  }

  // 上轮已判定「软解失败、等硬解」的会话：即使本轮没重新命中（例如回合更旧/更年轻），也继续排队硬解
  for (const sid of Object.keys(pending)) {
    if (results.some(function (r) { return r.s && r.s.id === sid })) continue
    const p = pending[sid]
    results.push({ s: { id: sid, title: p.title || '', agent: p.agent, model: p.model }, d: { target: p.target, reason: p.reason || 'pending' }, ok: false, pending: true })
  }
  let failed = results.filter(function (r) { return !r.ok })
  if (failed.length) {
    if (DRY) { log('[dry] 软解失败 ' + failed.length + ' 个，将走 serve 重启'); process.exit(0) }
    const sinceRestart = Date.now() - (state.lastRestartAt || 0)
    if (sinceRestart < RESTART_COOLDOWN_MS) {
      log('软解失败 ' + failed.length + ' 个，但距上次 serve 重启仅 ' + Math.round(sinceRestart / 60000) + 'min（冷却 ' + Math.round(RESTART_COOLDOWN_MS / 60000) + 'min），只告警不重启')
      writeAlert(failed.map(function (r) { return { id: r.s.id, title: r.s.title || '', reason: r.d.reason, note: 'restart-cooldown' } }))
      logJsonl({ ts: new Date().toISOString(), event: 'alert', reason: 'restart-cooldown', count: failed.length })
      process.exit(0)
    }
    const exclude = {}
    failed.forEach(function (r) { exclude[r.s.id] = 1 })
    const busy = await globalBusy(exclude)
    if (busy) {
      log('软解失败，但全局仍有会话在跑工具/刚发消息 → 本轮不重启 serve（避免误杀），下轮再试')
      writeAlert(failed.map(function (r) { return { id: r.s.id, title: r.s.title || '', reason: r.d.reason, note: 'global-busy-defer' } }))
      logJsonl({ ts: new Date().toISOString(), event: 'defer', reason: 'global-busy', count: failed.length })
      process.exit(0)
    }
    log('硬解：全局安静，POST /_serve/restart（影响全栈在途回合，重启后重放提示词）')
    const rr = await request('POST', '/_serve/restart', {}, 130000)
    log('serve 重启应答 HTTP ' + rr.status + ' ' + String(rr.text || '').slice(0, 180))
    logJsonl({ ts: new Date().toISOString(), event: 'serve-restart', status: rr.status, body: String(rr.text || '').slice(0, 300) })
    const up = await waitServe(80000)
    state.lastRestartAt = Date.now()
    saveState(state)
    if (!up) {
      log('❌ serve 重启后 80s 内未就绪，告警')
      writeAlert(failed.map(function (r) { return { id: r.s.id, title: r.s.title || '', reason: r.d.reason, note: 'serve-not-ready' } }))
      process.exit(1)
    }
    const still = []
    for (const r of failed) {
      const promptAt = Date.now()
      const accepted = await promptSession(r.s, r.d.target)
      await sleep(AFTER_RESTART_WAIT_MS)
      const after = await request('GET', '/api/session/' + encodeURIComponent(r.s.id) + '/message', null, 15000)
      const ok = after.status === 200 && Array.isArray(after.json) && verifyProgress(after.json, promptAt)
      state.sessions[r.s.id] = { lastAt: Date.now(), attempts: ((state.sessions[r.s.id] || {}).attempts || 0) + 1, lastResult: ok ? 'hard-ok' : 'hard-fail' }
      if (ok) delete pending[r.s.id]
      state.pendingRestart = pending
      saveState(state)
      log((ok ? '✅ 硬解成功 ' : '❌ 硬解仍失败 ') + r.s.id + '（accepted=' + accepted + '）')
      logJsonl({ ts: new Date().toISOString(), event: 'hard-verify', sid: r.s.id, ok: ok, accepted: accepted })
      if (!ok) still.push({ id: r.s.id, title: r.s.title || '', reason: r.d.reason, note: 'hard-fail' })
    }
    if (still.length) {
      writeAlert(still)
      log('告警已落盘 run/wedge-alert.json（' + still.length + ' 个）')
      process.exit(1)
    }
  }

  writeAlert(null)
  state.pendingRestart = pending
  saveState(state)
  log('完成：本轮 ' + targets.length + ' 个候选，' + results.length + ' 个处理')
  process.exit(0)
}

main().catch(function (e) {
  log('FATAL ' + (e && e.stack || e))
  process.exit(1)
})

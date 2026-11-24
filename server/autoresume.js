// task301 autoresume：serve 重启 / 断网恢复后，自动续跑被中断的会话（2026-11-15）
// task309 修复轮（教训 L-097）：原实现把消息接口打成 /api/session/<sid>/message——该路径在 serve 上
// 返回的是 session_message「开关事件」（model-switched/agent-switched），不是真实消息；classify 恒判
// ok，导致本工具上线以来从未真正续跑过（2026-11-15 11:35 挂死 + 11:48 重启事故两个悬空会话全漏）。
// 修复与增强：
//   ① 消息接口改走 serve 真实路径 /session/<sid>/message（proxy 剥 /api 后同款）
//   ② 空占位判定：assistant 尾消息 0 parts = run 建了消息从未产出（11:35 事故真实形态）
//   ③ 双采样指纹补 lastLen（流式输出 id 不变而 parts 在长，仅比 id 会误判正在干活的会话）
//   ④ 重试护栏：run/autoresume-orphan-state.json 记每会话注入次数，上限 MAX_ATTEMPTS（默认 2）；
//      our-mark 未应答重拉须间隔 MARK_REWAIT_MS（默认 30min）——防死循环轰炸
//   ⑤ 候选排除左栏已归档（hidden-sessions.json）会话：归档=主人收起，不自动复活
//   ⑥ --scan-only [--json]：只扫不修无锁模式，patrol 哨兵（只报不修红线）复用同一份判定
// 判定中断（只看会话最后一条消息，纯函数在 server/orphan-detect.js，与 patrol 共用）：
//   ① role=user 且无人应答（消息发出后 serve 死了/断网了/在途队列被重启冲掉）
//   ② role=assistant 且 parts 为空或最后 part 是 tool/step-start/reasoning（空占位/工具悬空没收尾）
// task397（2026-11-23「新对话 17:23」事故）：
//   ① 等主人点选的提问卡（question 工具未完结）判 pending-question，不算中断、不掐（旧口径误判
//      interrupted-assistant：掐掉重问、白耗护栏额度）；--scan-only 单列 waiting 供巡检转达主人
//   ② 护栏清账挪到第一轮采样逐会话做（旧实现放函数尾，early return 一遇就跳过：计数到上限后
//      永远不清，主人真发的消息没人捞）；lastAt 之后主人发过新话=新一轮，重新计数
// 防误伤：双采样确认——间隔 SAMPLE_MS 再查一次，最后消息 id+长度没变才认定真中断
// 防循环：注入提示词带 MARK 前缀；已带 MARK 的尾消息按护栏间隔重拉、达上限后留给人工
// 只续跑无 parentID 的主会话（子代理会话由主会话自己管理）；单次最多恢复 MAX_RESUME 个
// 用法：node autoresume.js [--dry] [--reason restart|netback|periodic|selftest] [--scan-only] [--json]
'use strict'
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const OD = require('./orphan-detect')

const PORT = Number(process.env.LITTLEDJ_BACKEND_PORT || 4098)
const ROOT = require('./paths').ROOT
const LOG = path.join(ROOT, 'logs', 'autoresume.log')
const LOCK = path.join(ROOT, 'run', 'autoresume.lock')
const ATTEMPTS_FILE = path.join(ROOT, 'run', 'autoresume-orphan-state.json')
const HIDDEN_FILE = path.join(ROOT, 'config', 'hidden-sessions.json')
const DRY = process.argv.includes('--dry')
const SCAN_ONLY = process.argv.includes('--scan-only')
const AS_JSON = process.argv.includes('--json')
const REASON = (process.argv.includes('--reason') ? process.argv[process.argv.indexOf('--reason') + 1] : 'manual') || 'manual'
const SAMPLE_MS = Number(process.env.LITTLEDJ_AUTORESUME_SAMPLE_MS || 12000)
const RECENT_MS = Number(process.env.LITTLEDJ_AUTORESUME_RECENT_MS || 6 * 3600 * 1000) // 只看最近 6h 动过的会话
// task397 产审 R6：--scan-only 列「等主人点选」时窗口放宽——候选窗 6h 会漏掉事故形态（提问卡挂 7h）；
// 只读、只挑不在候选里的最近 WAIT_SCAN_MAX 个，预算可控。续跑本身仍只认 6h 候选窗。
const WAIT_RECENT_MS = Number(process.env.LITTLEDJ_AUTORESUME_WAIT_RECENT_MS || 48 * 3600 * 1000)
const WAIT_SCAN_MAX = Number(process.env.LITTLEDJ_AUTORESUME_WAIT_SCAN_MAX || 12)
const WAIT_SERVE_MS = Number(process.env.LITTLEDJ_AUTORESUME_WAIT_SERVE_MS || 120000)
const MARK_REWAIT_MS = Number(process.env.LITTLEDJ_AUTORESUME_MARK_REWAIT_MS || 30 * 60 * 1000)
const MAX_ATTEMPTS = Number(process.env.LITTLEDJ_AUTORESUME_MAX_ATTEMPTS || 2)
const MIN_AGE_MS = Number(process.env.LITTLEDJ_AUTORESUME_MIN_AGE_MS || 10 * 60 * 1000) // 尾消息年龄闸：挡「正在流式/长工具执行中」的活跃会话
const NO_ABORT = process.env.LITTLEDJ_AUTORESUME_NO_ABORT === '1' // task366 应急闸：跳过续跑前 abort，prompt 照旧（P1-D）
// 目录拒入表（默认空；task377 起 DAG_AI_Chat 解除：主人 2026-11-18 要求卡死自愈必须覆盖 DAG，
// 续跑带 MARK 前缀+双采样+年龄闸+次数上限，等效主人手动发「继续」；env 显式回退旧行为）
const DENY_DIRS = (process.env.LITTLEDJ_AUTORESUME_DENY_DIRS || '').split(',').map(function (s) { return s.trim() }).filter(Boolean)
const MAX_RESUME = 3
const MARK = OD.MARK_DEFAULT
const PROMPT_TEXT = MARK + '(系统消息：服务重启/网络中断已恢复。刚才你的任务被打断了，请从中断处继续完成，不要从头开始，不要重复已完成的步骤。)'

function log(msg) {
  const line = new Date().toISOString().replace('T', ' ').replace('Z', '') + ' [' + REASON + '] ' + msg
  try { fs.appendFileSync(LOG, line + '\n') } catch (e) { console.error(line + ' (log write failed: ' + e.message + ')') }
  if (!SCAN_ONLY || !AS_JSON) console.log(line) // --scan-only --json 时 stdout 只留 JSON（patrol 解析用）
}

function req(method, p, body, allowEmpty, timeoutMs) {
  timeoutMs = timeoutMs || 30000 // task366：abort 等前置调用用小超时，默认 30s 不变
  return new Promise(function (resolve, reject) {
    const data = body ? Buffer.from(JSON.stringify(body)) : null
    const r = http.request({ host: '127.0.0.1', port: PORT, method: method, path: p, headers: data ? { 'content-type': 'application/json', 'content-length': data.length } : {} }, function (res) {
      const chunks = []
      res.on('data', function (c) { chunks.push(c) })
      res.on('end', function () {
        const txt = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('HTTP ' + res.statusCode + ' ' + txt.slice(0, 200)))
        // prompt_async 成功回 204 空体——allowEmpty 时空响应视为受理（JSON 解析失败才是异常）
        if (!txt && allowEmpty) return resolve(null)
        try { resolve(JSON.parse(txt)) } catch (e) { reject(new Error('bad json: ' + txt.slice(0, 120))) }
      })
    })
    r.on('error', reject)
    r.setTimeout(timeoutMs, function () { r.destroy(new Error('timeout ' + p)) })
    if (data) r.write(data)
    r.end()
  })
}

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

async function waitServe() {
  const deadline = Date.now() + WAIT_SERVE_MS
  while (Date.now() < deadline) {
    try { await req('GET', '/api/session'); return true } catch (e) { await sleep(3000) }
  }
  return false
}

// task309 L-097 修复锚：真实消息接口是 /session/<id>/message（无 /api 前缀；
// 带 /api 的同名路径返回 session_message 开关事件，恒判 ok——本工具曾经的空转根因）
async function snapshot(s) {
  const d = await req('GET', '/session/' + encodeURIComponent(s.id) + '/message')
  const msgs = OD.normMsgs(d)
  const fp = OD.fingerprint(msgs)
  return { session: s, msgs: msgs, cls: OD.classify(msgs, MARK), lastId: fp.lastId, lastLen: fp.lastLen }
}

function readAttempts() {
  try { return JSON.parse(fs.readFileSync(ATTEMPTS_FILE, 'utf8')) || {} } catch (e) { return {} }
}
function writeAttempts(st) {
  try {
    fs.mkdirSync(path.dirname(ATTEMPTS_FILE), { recursive: true })
    fs.writeFileSync(ATTEMPTS_FILE, JSON.stringify(st, null, 2))
  } catch (e) { log('WARN 护栏状态写入失败（退化为不计数，本进程内仍受 MAX_RESUME 约束）：' + e.message) }
}
function readHiddenSet() {
  try {
    const h = JSON.parse(fs.readFileSync(HIDDEN_FILE, 'utf8')) || {}
    const set = {}
    ((h.hidden || [])).forEach(function (id) { if (typeof id === 'string' && id) set[id] = 1 })
    return set
  } catch (e) { return {} } // 读不到按无隐藏处理，绝不因此放弃续跑
}

// task397：护栏清账（逐会话，第一轮采样时调）。旧实现放在 main() 函数尾，前面 3 处 early return
// 一遇就跳过——事故实证（2026-11-23「新对话 17:23」）：两次误掐把计数耗到 2 后会话明明恢复过，
// 计数却永远不清；03:01 主人的消息被卡死巡检 abort 吞掉后，本巡检每轮只报「护栏拦下」不捞人。
//   ① 尾消息健康（非中断、也不是我方 MARK 未应答）→ 清；
//   ② lastAt 之后主人发过新话（非 MARK）→ 清（主人亲自介入=新一轮，旧次数不压这一轮）。
// 返回 1=清了 1 条，0=没动。scanOnly 同口径（gaveUp 判定前先按本函数口径折算）。
function settleAttempts(attemptsState, sn) {
  const e = attemptsState[sn.session.id]
  if (!e) return 0
  const healthy = !OD.isInterrupted(sn.cls) && sn.cls !== 'our-mark'
  if (healthy || OD.supersededByUser(sn.msgs, e, MARK)) { delete attemptsState[sn.session.id]; return 1 }
  return 0
}

// task397：提问卡在问什么（等主人点选时转达用）——取尾 assistant 消息里 question 工具的首问
function questionHead(msgs) {
  const m = OD.lastMsg(msgs)
  const parts = (m && m.parts) || []
  for (const p of parts) {
    const qs = p && p.type === 'tool' && p.tool === 'question' && p.state && p.state.input && p.state.input.questions
    if (Array.isArray(qs) && qs.length) return String((qs[0] && (qs[0].header || qs[0].question)) || '').slice(0, 40)
  }
  return ''
}

// task397：等点选会话进 waiting（过年龄闸才算：刚出的卡不算「等人」）
function pushWaiting(out, sn, s, now) {
  if (sn.cls !== 'pending-question' || !OD.ageGate(sn.msgs, MIN_AGE_MS, now)) return
  const created = ((OD.lastMsg(sn.msgs).info.time || {}).created || now)
  out.push({ id: s.id, title: s.title || '', ageMin: Math.max(0, Math.round((now - created) / 60000)), q: questionHead(sn.msgs) })
}

async function main() {
  if (SCAN_ONLY) return scanOnly()

  // 单实例锁（stale 判定 10 分钟）
  try {
    fs.mkdirSync(path.dirname(LOCK), { recursive: true })
    const old = Number(fs.readFileSync(LOCK, 'utf8')) || 0
    if (Date.now() - old < 10 * 60 * 1000) { log('已有实例在跑（lock ' + Math.round((Date.now() - old) / 1000) + 's 前），退出'); return }
  } catch (e) { /* 无锁，继续 */ }
  try { fs.writeFileSync(LOCK, String(Date.now())) } catch (e) { log('WARN 写锁失败：' + e.message) }
  process.on('exit', function () { try { fs.unlinkSync(LOCK) } catch (e) {} })

  if (!(await waitServe())) { log('serve ' + WAIT_SERVE_MS + 'ms 内未就绪，放弃本次'); process.exit(1) }

  const list = (await req('GET', '/api/session')).data || []
  const now = Date.now()
  const candidates = OD.candidatesFrom(list, { now: now, recentMs: RECENT_MS, hiddenSet: readHiddenSet(), denyDirs: DENY_DIRS })

  log('候选会话 ' + candidates.length + '/' + list.length + '（最近 ' + Math.round(RECENT_MS / 60000) + 'min 内活跃且为主会话未归档，拒入目录=' + DENY_DIRS.join(',') + '）')
  const attemptsState = readAttempts()
  // task397（产审 P1-2）：不在候选里的旧账（归档/超 6h 未动/已隐藏/根本没候选）最先清——清账落盘
  // 必须在全部 3 处 early return 之前（旧行为放函数尾，一遇就跳过：计数到上限后永远不清）；
  // 没候选=没人要护，全清是安全的
  let pruned = 0
  for (const sid of Object.keys(attemptsState)) {
    if (!candidates.some(function (c) { return c.id === sid })) { delete attemptsState[sid]; pruned++ }
  }
  const settle = function () {
    if (pruned && DRY) log('[dry] 将清护栏账 ' + pruned + ' 条（预演不落盘）')
    if (pruned && !DRY) writeAttempts(attemptsState)
  }
  if (!candidates.length) {
    settle()
    log('无事可做，退出' + (pruned ? '（护栏清账 ' + pruned + ' 条）' : ''))
    return
  }

  // 第一轮采样（全量分类留痕：scan 口径与续跑口径同源，排查时可对照）
  const snaps = []
  const clsCount = {}
  let youngSkipped = 0
  for (const s of candidates) {
    try {
      const sn = await snapshot(s)
      clsCount[sn.cls] = (clsCount[sn.cls] || 0) + 1
      pruned += settleAttempts(attemptsState, sn) // task397：候选里的旧账逐会话清（见函数注释）
      const wantResume = OD.isInterrupted(sn.cls) || (function () {
        if (sn.cls !== 'our-mark') return false
        const g = OD.attemptsGuard(attemptsState, s.id, 'our-mark', { max: MAX_ATTEMPTS, rewaitMs: MARK_REWAIT_MS, now: now })
        if (g.ok) return true
        log('跳过 ' + s.id + '（标记未应答但 ' + g.reason + '，等下轮或人工）')
        return false
      })()
      if (!wantResume) continue
      // task308 年龄闸：尾消息太新=可能正在流式/长工具执行中（消息不增长），不抢跑
      if (!OD.ageGate(sn.msgs, MIN_AGE_MS, now)) { youngSkipped++; continue }
      snaps.push(sn)
    } catch (e) { log('WARN 读取 ' + s.id + ' 失败：' + e.message) }
  }
  log('第一轮分类分布 ' + JSON.stringify(clsCount) + (youngSkipped ? '，年龄闸拦下 ' + youngSkipped + ' 个（尾消息<' + Math.round(MIN_AGE_MS / 60000) + 'min，可能正在干活）' : ''))
  settle()
  if (!snaps.length) { log('第一轮无中断会话，退出' + (pruned ? '（护栏清账 ' + pruned + ' 条）' : '')); return }
  log('第一轮疑似中断：' + snaps.map(function (x) { return x.session.id + '(' + x.cls + ')' }).join(', ') + '，' + SAMPLE_MS + 'ms 后双采样确认')

  await sleep(SAMPLE_MS)

  // 第二轮：仅当最后消息 id+长度完全没变才认定真中断（排除正在干活/正在流式输出）
  const confirmed = []
  for (const sn of snaps) {
    try {
      const sn2 = await snapshot(sn.session)
      if (sn2.lastId === sn.lastId && sn2.lastLen === sn.lastLen && (OD.isInterrupted(sn2.cls) || sn2.cls === 'our-mark')) confirmed.push(sn2)
      else log('排除 ' + sn.session.id + '（二次采样有进展或状态变化：' + sn2.cls + '）')
    } catch (e) { log('WARN 二次读取 ' + sn.session.id + ' 失败：' + e.message) }
  }
  if (!confirmed.length) { log('双采样后无真中断会话，退出'); return }

  const todo = confirmed.slice(0, MAX_RESUME)
  for (const sn of confirmed.slice(MAX_RESUME)) log('超出 MAX_RESUME=' + MAX_RESUME + '，本次不续：' + sn.session.id)

  let injected = 0
  for (const sn of todo) {
    const s = sn.session
    const g = OD.attemptsGuard(attemptsState, s.id, sn.cls, { max: MAX_ATTEMPTS, rewaitMs: MARK_REWAIT_MS, now: Date.now() })
    if (!g.ok) { log('护栏拦下 ' + s.id + '（' + g.reason + '），留给人工/巡检告警'); continue }
    const body = {
      parts: [{ type: 'text', text: PROMPT_TEXT }],
      model: { providerID: (s.model && s.model.providerID) || '', modelID: (s.model && s.model.id) || '' },
    }
    if (s.agent) body.agent = s.agent
    if (DRY) { log('[dry] 将续跑 ' + s.id + ' "' + (s.title || '') + '" cls=' + sn.cls + ' model=' + JSON.stringify(body.model)); continue }
    // task366：续跑前先 abort——2026-11-16 DAG 事故实证：挂死回合占项目锁时，续跑消息只排队不执行
    // （当日 12:54/13:35 两次续跑全打水漂）。先 abort 清库内半开消息+保留续跑机会；失败不阻断（打错
    // 路径/无在途回合都算失败，记 WARN 立刻显形，不静默）。路径无 /api 前缀（L-097：带 /api 回 serve
    // 网页壳 HTML，2026-11-16 实测 200+HTML）。abort 不清上游挂死请求、不释放锁（事故实证），收益=
    // 清库内半开消息，别期望更多。应急闸 LITTLEDJ_AUTORESUME_NO_ABORT=1 跳过本步。
    if (!NO_ABORT) {
      try {
        const ab = await req('POST', '/session/' + encodeURIComponent(s.id) + '/abort', {}, true, 10000)
        log('abort-before-resume ok：' + s.id + '（应答=' + JSON.stringify(ab) + '）')
      } catch (e) {
        log('WARN abort-before-resume failed：' + s.id + ' ' + String(e.message).slice(0, 120) + '（不阻断，继续续跑）')
      }
      await sleep(2000) // 给 serve 清理时间
    }
    try {
      // 端点同 L-097 修复锚：prompt 也走无 /api 前缀的真实路径（带 /api 的是 serve 网页壳，回 HTML）；204 空体=受理
      await req('POST', '/session/' + encodeURIComponent(s.id) + '/prompt_async', body, true)
      attemptsState[s.id] = { attempts: ((attemptsState[s.id] || {}).attempts || 0) + 1, lastAt: Date.now() }
      writeAttempts(attemptsState)
      injected++
      log('✅ 已续跑 ' + s.id + ' "' + (s.title || '') + '"（中断形态=' + sn.cls + '，第 ' + attemptsState[s.id].attempts + '/' + MAX_ATTEMPTS + ' 次，最后消息=' + sn.lastId + '）')
    } catch (e) { log('❌ 续跑 ' + s.id + ' 失败：' + e.message) }
    await sleep(2000) // 逐个注入，间隔 2s，避免同时打爆
  }

  // task397：护栏清账已挪到第一轮采样（settleAttempts），这里不再扫尾（旧扫尾块被 early return 跳过的
  // 缺陷见函数注释）；上面「不在候选里的旧账」已在第一轮后清过，本轮注入产生的新账保留
  log('完成：本次注入 ' + (DRY ? '[dry] ' : '') + injected + ' 个会话，护栏清理 ' + pruned + ' 条')
}

// task308：只扫不修（无锁、不注入）——patrol 哨兵复用同一份判定，stdout 出 JSON
async function scanOnly() {
  if (!(await waitServe())) { console.error('serve not ready'); process.exit(1) }
  const list = (await req('GET', '/api/session')).data || []
  const now = Date.now()
  const hiddenSet = readHiddenSet()
  const candidates = OD.candidatesFrom(list, { now: now, recentMs: RECENT_MS, hiddenSet: hiddenSet, denyDirs: DENY_DIRS })
  const attemptsState = readAttempts()
  const orphans = []
  const waiting = [] // task397：等主人点选提问卡的会话（不是故障，列出来让主人知道该点哪张卡）
  let youngSkipped = 0
  for (const s of candidates) {
    try {
      const sn = await snapshot(s)
      // task397：gaveUp 口径与续跑同源——主人发过新话按 0 次算（只读，不落盘）
      const fresh = OD.supersededByUser(sn.msgs, attemptsState[s.id], MARK)
      const effState = fresh ? {} : attemptsState
      if (OD.isInterrupted(sn.cls) || sn.cls === 'our-mark') {
        if (!OD.ageGate(sn.msgs, MIN_AGE_MS, now)) { youngSkipped++; continue }
        const g = OD.attemptsGuard(effState, s.id, sn.cls, { max: MAX_ATTEMPTS, rewaitMs: MARK_REWAIT_MS, now: now })
        const ageMin = sn.msgs && sn.msgs.length ? Math.max(0, Math.round((now - ((OD.lastMsg(sn.msgs).info.time || {}).created || now)) / 60000)) : 0
        orphans.push({
          id: s.id, title: s.title || '', cls: sn.cls, ageMin: ageMin,
          attempts: (effState[s.id] || {}).attempts || 0,
          gaveUp: !g.ok, guardReason: g.reason || '',
        })
      } else {
        pushWaiting(waiting, sn, s, now)
      }
    } catch (e) { /* 单会话读失败不拖垮扫描 */ }
  }
  // task397 产审 R6：候选窗（6h）外、48h 内的会话也看一眼是否在等主人点选（只读；续跑不动它们）
  const seen = {}
  candidates.forEach(function (c) { seen[c.id] = 1 })
  const wide = OD.candidatesFrom(list, { now: now, recentMs: WAIT_RECENT_MS, hiddenSet: hiddenSet, denyDirs: DENY_DIRS })
    .filter(function (s) { return !seen[s.id] }).slice(0, WAIT_SCAN_MAX)
  for (const s of wide) {
    try { pushWaiting(waiting, await snapshot(s), s, now) } catch (e) { /* 同上 */ }
  }
  const out = { ts: new Date().toISOString(), reason: REASON, scanned: candidates.length, orphans: orphans, gaveUp: orphans.filter(function (o) { return o.gaveUp }).length, youngSkipped: youngSkipped, waiting: waiting, waitingScanned: wide.length }
  console.log(JSON.stringify(out))
}

main().catch(function (e) { log('FATAL ' + (e && e.stack || e)); process.exit(1) })

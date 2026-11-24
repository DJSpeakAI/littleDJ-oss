#!/usr/bin/env node
// selftest-stall-check: task315 在途任务静默检查（软提醒）自测
// 运行：node deploy/selftest-stall-check.js   （全过打印 N/N PASS 且 EXIT=0，L-086）
// 两段：
//   ①表驱动纯函数（server/stall-detect.js）：quiet/stalled 两态、阈值边界 11/14/15/16min、
//     completed 跳过、user 锚点、TUI 根/hidden/paused/非根/根不一致/中间层死、DAG、queueBusy、
//     tool 在跑、nudge/auto-reap 去重、首 tick、冷却、封顶、全局/rest 预算、degraded（probe 失败/reap-gate）、
//     deduped 不计次、清计数、文案、clamp；
//   ②沙箱端到端（L-097）：起真实 proxy 子进程 + 假 serve + 合成 sqlite 库（HOME/LITTLEDJ_ROOT 全部指向
//     临时沙箱；合成 Basic 凭据 L-093，绝不复制 config/auth.txt），先打真实 /_tasks 预热派生缓存，
//     断言注入文本/状态文件/日志三件落地 + 首 tick 只观察 + 冷却不重复，另跑 LITTLEDJ_NO_STALL_CHECK=1 负例。
// 备注：2026-11-15 15:30 曾出现并行会话重写本文件（默认 15min 口径 + task-derive 沙箱旋钮），
//   2026-11-15 15:49 按方案稿 §六 rev.3 P1-1 终裁：默认阈值统一 **15min**（任务书 §2.1 的 12min 被 rev.3 修订取代）；
//   并行版本（77 断言含真 E2E）零丢失存档于 run/task315-parallel-archive/。
'use strict'
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')
const net = require('net')
const { spawn } = require('child_process')
const SD = require(path.join(__dirname, '..', 'server', 'stall-detect'))

const MIN = 60 * 1000
const NOW = 1794725000000

let pass = 0
let total = 0
const fails = []
function ok(name, cond, detail) {
  total++
  if (cond) { pass++; console.log('✅ ' + name) }
  else { fails.push(name + (detail ? ' | ' + detail : '')); console.log('❌ ' + name + (detail ? ' | ' + detail : '')) }
}

/* ---------- ① 表驱动纯函数 ---------- */
function row(o) {
  return Object.assign({
    id: 'ses_root1', title: 'task315 演练', inTask: true, state: 'running', stale: 'stalled',
    staleMinutes: 16, runnerSession: 'ses_run1', runnerAgent: 'censor-plan',
    lastEventAt: NOW - 16 * MIN, directory: '/home/u/projects/littleDJ', etaDeadline: 0, etaChildId: ''
  }, o || {})
}
function probe(o) {
  return Object.assign({
    ok: true, lastRole: 'assistant', created: NOW - 16 * MIN, completed: 0,
    lastMsgCreated: NOW - 16 * MIN, hasRunningPart: false
  }, o || {})
}
function gs(o) {
  return Object.assign({
    child: { count: 0, lastAt: 0 }, hourCount: 0, rest: false, nudgeLastAt: 0, reapLastAt: 0,
    target: { id: 'ses_root1', agent: 'butler', isRoot: true, hidden: false, paused: false, rowRootOk: true },
    targetWhy: ''
  }, o || {})
}
function decide(name, r, p, busy, g, o, want) {
  const d = SD.decideStallCheck(r, p, busy, g, NOW, o)
  let good = d.action === want.action && (!want.why || d.why === want.why)
  if (good && want.silenceMin !== undefined) good = d.silenceMin === want.silenceMin
  if (good && want.attempt !== undefined) good = d.attempt === want.attempt
  ok(name, good, 'got=' + JSON.stringify(d))
}

// P1-1：quiet / stalled 两态（默认阈值 15min，rev.3）
decide('quiet 15min → remind（quiet 上界恰碰阈值）', row({ stale: 'quiet', staleMinutes: 15, lastEventAt: NOW - 15 * MIN }), probe({ created: NOW - 15 * MIN, lastMsgCreated: NOW - 15 * MIN }), false, gs(), { reapWhy: 'not-stalled' }, { action: 'remind', silenceMin: 15 })
decide('stalled 16min → remind', row(), probe(), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'remind', silenceMin: 16 })
// 阈值边界（rev.3 15min：11/14 下阈 + 恰好 15）
decide('quiet 11min → below-threshold', row({ stale: 'quiet', staleMinutes: 11, lastEventAt: NOW - 11 * MIN }), probe({ created: NOW - 11 * MIN, lastMsgCreated: NOW - 11 * MIN }), false, gs(), { reapWhy: 'not-stalled' }, { action: 'skip', why: 'below-threshold' })
decide('quiet 14min → below-threshold（近阈不打扰）', row({ stale: 'quiet', staleMinutes: 14, lastEventAt: NOW - 14 * MIN }), probe({ created: NOW - 14 * MIN, lastMsgCreated: NOW - 14 * MIN }), false, gs(), { reapWhy: 'not-stalled' }, { action: 'skip', why: 'below-threshold' })
decide('quiet 15min 整 → remind（含边界）', row({ stale: 'quiet', staleMinutes: 15, lastEventAt: NOW - 15 * MIN }), probe({ created: NOW - 15 * MIN, lastMsgCreated: NOW - 15 * MIN }), false, gs(), { reapWhy: 'not-stalled' }, { action: 'remind', silenceMin: 15 })
decide('stalled 16min（run-in-progress 形态）', row(), probe(), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'remind', silenceMin: 16 })
// P1-6：completed 跳过（交给 auto-reap done）；user 尾不算收尾
decide('assistant 已 completed → runner-completed', row(), probe({ completed: NOW - 20 * MIN }), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'runner-completed' })
decide('user 锚点：16min 前发话 → remind', row(), probe({ lastRole: 'user', lastMsgCreated: NOW - 16 * MIN, created: NOW - 30 * MIN, completed: NOW - 31 * MIN }), false, gs(), { reapWhy: 'user-pending' }, { action: 'remind', silenceMin: 16 })
decide('user 锚点回归：3min 前刚发话 → below-threshold', row(), probe({ lastRole: 'user', lastMsgCreated: NOW - 3 * MIN, created: NOW - 40 * MIN, completed: NOW - 41 * MIN }), false, gs(), { reapWhy: 'user-pending' }, { action: 'skip', why: 'below-threshold' })
// P1-5：目标根四闸 + 中间层死
decide('TUI 根（agent=build）→ tui-root', row(), probe(), false, gs({ target: { id: 'ses_root1', agent: 'build', isRoot: true, hidden: false, paused: false, rowRootOk: true } }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'tui-root' })
decide('hidden 根 → target-hidden', row(), probe(), false, gs({ target: { id: 'ses_root1', agent: 'butler', isRoot: true, hidden: true, paused: false, rowRootOk: true } }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'target-hidden' })
decide('queuePaused 根 → target-paused', row(), probe(), false, gs({ target: { id: 'ses_root1', agent: 'butler', isRoot: true, hidden: false, paused: true, rowRootOk: true } }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'target-paused' })
decide('根不一致（换主会话）→ root-mismatch', row(), probe(), false, gs({ target: { id: 'ses_root2', agent: 'butler', isRoot: true, hidden: false, paused: false, rowRootOk: false } }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'root-mismatch' })
decide('非根目标（中间层活着）→ target-not-root', row(), probe(), false, gs({ target: { id: 'ses_mid1', agent: 'steward', isRoot: false, hidden: false, paused: false, rowRootOk: false } }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'target-not-root' })
decide('中间层死（上溯失败）→ target-unresolved', row(), probe(), false, gs({ target: null, targetWhy: 'unresolved' }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'target-unresolved' })
decide('根 meta 404 → target-meta-404', row(), probe(), false, gs({ target: null, targetWhy: 'meta-404' }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'target-meta-404' })
// 目录拒入（DAG 红线）
decide('DAG 目录 → deny-dir', row({ directory: '/home/u/projects/DAG_AI_Chat' }), probe(), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'deny-dir' })
// 判活
decide('queueBusy 在途 → queue-busy', row(), probe(), true, gs(), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'queue-busy' })
decide('tool part 在跑 → tool-running', row(), probe({ hasRunningPart: true }), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'tool-running' })
// degraded 同型兜底：probe 失败 / reap 原因不在准入表
decide('probe 失败（degraded 同型）→ probe-failed', row(), { ok: false, why: 'timeout' }, false, gs(), { reapWhy: 'not-stalled' }, { action: 'skip', why: 'probe-failed' })
decide('reap 原因=recently-ended → reap-gate', row(), probe(), false, gs(), { reapWhy: 'recently-ended' }, { action: 'skip', why: 'reap-gate' })
decide('reap 原因缺失 → reap-gate', row(), probe(), false, gs(), {}, { action: 'skip', why: 'reap-gate' })
// 候选基础谓词
decide('state=done → not-running', row({ state: 'done' }), probe(), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'not-running' })
decide('stale=archived → stale-out', row({ stale: 'archived' }), probe(), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'stale-out' })
decide('stale=active → stale-out', row({ stale: 'active' }), probe(), false, gs(), { reapWhy: 'not-stalled' }, { action: 'skip', why: 'stale-out' })
decide('inTask=false → not-in-task', row({ inTask: false }), probe(), false, gs(), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'not-in-task' })
// P1-7 去重（30min 窗，nudge 与 auto-reap 各一正一反）
decide('近 10min 有 nudge → nudge-recent', row(), probe(), false, gs({ nudgeLastAt: NOW - 10 * MIN }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'nudge-recent' })
decide('nudge 已 31min 前 → remind', row(), probe(), false, gs({ nudgeLastAt: NOW - 31 * MIN }), { reapWhy: 'run-in-progress' }, { action: 'remind', silenceMin: 16 })
decide('近 5min 有 auto-reap 动作 → auto-reap-recent', row(), probe(), false, gs({ reapLastAt: NOW - 5 * MIN }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'auto-reap-recent' })
// P1-4 首 tick（放在判定链最后 = 其余全过的形态）
decide('首 tick → first-tick（只 log 观察）', row(), probe(), false, gs(), { firstTick: true, reapWhy: 'run-in-progress' }, { action: 'skip', why: 'first-tick' })
// P1-10 护栏：冷却 / 封顶 / 全局 / rest
decide('冷却窗内（10min 前）→ child-cooldown', row(), probe(), false, gs({ child: { count: 1, lastAt: NOW - 10 * MIN } }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'child-cooldown' })
decide('冷却窗外（21min 前，count=1）→ remind attempt=2', row(), probe(), false, gs({ child: { count: 1, lastAt: NOW - 21 * MIN } }), { reapWhy: 'run-in-progress' }, { action: 'remind', attempt: 2 })
decide('count=2 → child-max', row(), probe(), false, gs({ child: { count: 2, lastAt: NOW - 21 * MIN } }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'child-max' })
decide('全局每小时=3 → global-max', row(), probe(), false, gs({ hourCount: 3 }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'global-max' })
decide('rest 且每小时=2 → rest-budget', row(), probe(), false, gs({ rest: true, hourCount: 2 }), { reapWhy: 'run-in-progress' }, { action: 'skip', why: 'rest-budget' })
decide('rest 但每小时=1 → remind', row(), probe(), false, gs({ rest: true, hourCount: 1 }), { reapWhy: 'run-in-progress' }, { action: 'remind' })

// 文案（P2-3）：前缀 / 尾句 / runner / 静默分钟 / ETA 段 / title 清洗截断
{
  const t1 = SD.buildStallText(row({ title: '第一行\n第二行超长超长超长超长超长超长超长超长超长超长超长' }), { runner: 'ses_run1', silenceMin: 16, etaDeadline: NOW + 24 * MIN })
  ok('文案：标准前缀', t1.indexOf('【系统自动提醒·程序触发】') === 0, t1.slice(0, 40))
  ok('文案：尾句（非主人指令）', t1.indexOf('此消息由自动机制发送，非主人指令，不得当作新任务执行。') === t1.length - '此消息由自动机制发送，非主人指令，不得当作新任务执行。'.length)
  ok('文案：含 runner id 与静默分钟', t1.indexOf('ses_run1') >= 0 && t1.indexOf('已静默 16 分钟') >= 0)
  ok('文案：ETA 截止段（有 etaDeadline）', t1.indexOf('，ETA 截止 ') > 0)
  ok('文案：title 去换行且 ≤30 字', t1.indexOf('\n') < 0 && t1.indexOf('第一行 第二行') > 0)
  const t2 = SD.buildStallText(row(), { runner: 'ses_run1', silenceMin: 13, etaDeadline: 0 })
  ok('文案：无 ETA 时不出现 ETA 段', t2.indexOf('ETA 截止') < 0 && t2.indexOf('已静默 13 分钟') > 0)
  ok('文案：三选一核对项齐全', t1.indexOf('①仍在跑→更新预计') > 0 && t1.indexOf('②已挂/中断→标记 interrupt') > 0 && t1.indexOf('③已被其他会话接管') > 0 && t1.indexOf('勿重复已完成步骤') > 0)
}
// 计次规则：sent 计 / deduped 不计 / history 滚动 200
{
  const st = SD.newStallState()
  SD.recordStallResult(st, 'ses_run1', 'sent', NOW, { target: 'ses_root1', root: 'ses_root1', silenceMin: 16, attempt: 1 })
  ok('record：sent → count=1 且 history+1', st.perChild.ses_run1.count === 1 && st.history.length === 1)
  SD.recordStallResult(st, 'ses_run1', 'deduped', NOW + 1000)
  ok('record：deduped 不计次（P2-2）', st.perChild.ses_run1.count === 1 && st.history.length === 1)
  SD.recordStallResult(st, 'ses_run1', 'sent', NOW + 25 * MIN, { target: 'ses_root1', silenceMin: 40 })
  ok('record：第二次 sent → count=2', st.perChild.ses_run1.count === 2 && st.perChild.ses_run1.lastAt === NOW + 25 * MIN)
  for (let i = 0; i < 210; i++) SD.recordStallResult(st, 'ses_x' + i, 'sent', NOW + i, {})
  ok('record：history ≤200 滚动', st.history.length === 200)
}
// 清计数（P1-10）
{
  const st = SD.newStallState()
  st.perChild = { ses_run1: { count: 1, lastAt: NOW }, ses_run2: { count: 2, lastAt: NOW }, ses_run3: { count: 1, lastAt: NOW } }
  SD.pruneStallState(st, [
    { id: 'r1', inTask: true, state: 'running', runnerSession: 'ses_run1' },        // 保留
    { id: 'r2', inTask: true, state: 'done', runnerSession: 'ses_run2' },            // state 非 running → 清
    { id: 'r3', inTask: true, state: 'running', runnerSession: 'ses_run9' }          // runner 换人 → ses_run3 清
  ])
  ok('prune：只留 running 在途行 runner', st.perChild.ses_run1 && !st.perChild.ses_run2 && !st.perChild.ses_run3, JSON.stringify(st.perChild))
}
// clamp 与准入表
ok('clamp：默认 15 / 下界 5 / 上界 30', SD.clampStallMin(undefined) === 15 && SD.clampStallMin('3') === 5 && SD.clampStallMin('99') === 30 && SD.clampStallMin('18') === 18 && SD.clampStallMin('abc') === 15)
ok('reapSkipAllowsStall：三真余假', SD.reapSkipAllowsStall('run-in-progress') && SD.reapSkipAllowsStall('user-pending') && SD.reapSkipAllowsStall('not-stalled') && !SD.reapSkipAllowsStall('done') && !SD.reapSkipAllowsStall('recently-ended') && !SD.reapSkipAllowsStall('probe-failed') && !SD.reapSkipAllowsStall(''))

/* ---------- ② 沙箱端到端（真实 proxy 子进程 + 假 serve + 合成库） ---------- */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }
function freePort() {
  return new Promise(function (res, rej) {
    const s = net.createServer()
    s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { res(p) }) })
    s.on('error', rej)
  })
}
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }) } catch (e) {} }

// ---- C 段：源码锚点（防编排/开关/旋钮被静默改链；并行版 77 断言中的 C 段并入本版） ----
function sourceAnchorPhase() {
  const read = function (p) { try { return fs.readFileSync(path.join(__dirname, '..', p), 'utf8') } catch (e) { return '' } }
  const proxySrc = read('server/proxy.js')
  const tdSrc = read('server/task-derive.js')
  ok('C1 tick 集成锚点（含首 tick 守卫）', proxySrc.indexOf('stallCheckPass(stallCands, rows, firstTickAfterBoot, now)') >= 0 && proxySrc.indexOf('if (!firstTick) {') >= 0 && proxySrc.indexOf('SD.pruneStallState(st, rows)') >= 0)
  ok('C2 候选门锚点（reap skip 三类才进）', proxySrc.indexOf('SD.reapSkipAllowsStall(d.why)') >= 0)
  ok('C3 一键关锚点', proxySrc.indexOf("LITTLEDJ_NO_STALL_CHECK === '1'") >= 0)
  ok('C4 复用 tick probe（不另发探针）', proxySrc.indexOf('stallCands.push({ row: row, probe: probe, busy: busyNow, reapWhy: d.why })') >= 0)
  ok('C5 去重出口写 nudge（P1-7）', proxySrc.indexOf('npc.stallLastAt = now') >= 0)
  ok('C6 阈值走 clampStallMin（默认 15min）', proxySrc.indexOf('SD.clampStallMin(process.env.LITTLEDJ_STALL_CHECK_MIN)') >= 0)
  ok('C7 probe 判活信号 hasRunningPart', proxySrc.indexOf('hasRunningPart: hasRunningPart') >= 0)
  ok('C8 沙箱 DB 旋钮（E2E 配套）', tdSrc.indexOf('LITTLEDJ_DEVECO_DB') >= 0)
}

async function integrationPhase() {
  const PROJ = path.join(__dirname, '..')
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-check-e2e-'))
  const home = path.join(sandbox, 'home')
  const rootA = path.join(sandbox, 'rootA')
  const rootB = path.join(sandbox, 'rootB')
  fs.mkdirSync(path.join(home, '.local', 'share', 'deveco'), { recursive: true })
  fs.mkdirSync(path.join(rootA, 'config'), { recursive: true })
  fs.mkdirSync(path.join(rootB, 'config'), { recursive: true })
  const dbPath = path.join(home, '.local', 'share', 'deveco', 'deveco.db')
  const t0 = Date.now()
  const db = new (require('node:sqlite').DatabaseSync)(dbPath)
  db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, parent_id TEXT, agent TEXT, title TEXT, directory TEXT, time_created INTEGER, time_updated INTEGER)')
  const ins = db.prepare('INSERT INTO session (id, parent_id, agent, title, directory, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
  ins.run('ses_root1', null, 'butler', 'task315 E2E 演练', '/sandbox/proj', t0 - 2 * 3600 * 1000, t0 - 2 * 3600 * 1000)
  ins.run('ses_run1', 'ses_root1', 'censor-plan', '方案审子会话', '/sandbox/proj', t0 - 20 * MIN, t0 - 16 * MIN)
  db.close()

  const runnerMsgs = [{
    info: { id: 'm1', role: 'assistant', time: { created: t0 - 16 * MIN, completed: 0 } },
    parts: [{ type: 'text', text: '审阅中…' }]
  }]
  const captures = []
  const serve = http.createServer(function (req, res) {
    const u = req.url || ''
    const send = function (code, obj) { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json' }); res.end(b) }
    if (u === '/health') return send(200, { ok: true })
    if (u === '/session/ses_run1/message') return send(200, runnerMsgs)
    if (/^\/session\/[^/]+\/prompt_async$/.test(u) && req.method === 'POST') {
      let b = ''
      req.on('data', function (c) { b += c })
      req.on('end', function () { captures.push({ path: u, body: b }); send(200, { ok: true }) })
      return
    }
    return send(404, { ok: false })
  })
  await new Promise(function (r) { serve.listen(0, '127.0.0.1', r) })
  const servePort = serve.address().port
  const proxyPortA = await freePort()
  const proxyPortB = await freePort()

  const childEnv = function (root, port) {
    return Object.assign({}, process.env, {
      HOME: home,
      LITTLEDJ_ROOT: root,
      LITTLEDJ_USER: 'selftest315',           // 合成 Basic（L-093）：绝不复制 config/auth.txt
      LITTLEDJ_PASS: 'synth-pass-315',
      LITTLEDJ_HOST: '127.0.0.1',
      LITTLEDJ_PORT: String(port),
      LITTLEDJ_BACKEND_HOST: '127.0.0.1',
      LITTLEDJ_BACKEND_PORT: String(servePort),
      LITTLEDJ_AUTO_REAP_TICK_MS: '3000'      // E2E 旋钮：首 tick 窗口 6s（预留模块加载耗时），第 2/3 拍起可动作
    })
  }
  const spawnChild = function (root, port, extraEnv) {
    const c = spawn(process.execPath, [path.join(PROJ, 'server', 'proxy.js')], {
      env: Object.assign(childEnv(root, port), extraEnv || {}), stdio: ['ignore', 'pipe', 'pipe']
    })
    c.stdout.on('data', function () {})
    c.stderr.on('data', function () {})
    return c
  }
  const authHeader = 'Basic ' + Buffer.from('selftest315:synth-pass-315').toString('base64')
  const httpGet = function (port, p) {
    return new Promise(function (resolve) {
      const rq = http.get({ host: '127.0.0.1', port: port, path: p, headers: { authorization: authHeader } }, function (rs) {
        let b = ''
        rs.on('data', function (c) { b += c })
        rs.on('end', function () { resolve({ code: rs.statusCode, body: b }) })
      })
      rq.on('error', function () { resolve({ code: 0, body: '' }) })
    })
  }

  let childA = null
  let childB = null
  try {
    // 正例：静默 16min → 软提醒注入承接根（butler）三件落地
    childA = spawnChild(rootA, proxyPortA)
    // 等监听就绪后打一发真实 /_tasks 预热派生缓存（否则 tick1 处于 warming 会整拍跳过，
    // 首 tick「只观察」证据就没了；顺带走真实 API 路径）
    let warmed = false
    for (let i = 0; i < 24 && !warmed; i++) {
      await sleep(250)
      const h = await httpGet(proxyPortA, '/_health')
      if (h.code !== 200) continue
      const t = await httpGet(proxyPortA, '/_tasks')
      try { warmed = !!((JSON.parse(t.body) || {}).tasks || []).length } catch (e) {}
    }
    ok('E2E：子进程就绪且 /_tasks 派生可用', warmed)
    let hit = null
    for (let i = 0; i < 40 && !hit; i++) {
      await sleep(500)
      hit = captures.find(function (c) { return c.path === '/session/ses_root1/prompt_async' }) || null
    }
    ok('E2E：软提醒已投喂承接根（prompt_async 捕获）', !!hit, 'captures=' + captures.map(function (c) { return c.path }).join(','))
    if (hit) {
      const parts = (JSON.parse(hit.body).parts) || []
      // promptInject 会给承接根的首条注入「开工三查」head，故按全文包含断言（精确前缀/尾句由纯函数段保证）
      const text = parts.map(function (p) { return String((p && p.text) || '') }).join('\n')
      ok('E2E：注入文本=标准前缀+尾句', text.indexOf('【系统自动提醒·程序触发】你名下的子任务') > 0 && text.indexOf('此消息由自动机制发送，非主人指令，不得当作新任务执行。') > 0)
      ok('E2E：注入文本含 runner 与静默分钟', text.indexOf('ses_run1') > 0 && text.indexOf('已静默 16 分钟') > 0)
    } else {
      ok('E2E：注入文本=标准前缀+尾句', false, '无捕获')
      ok('E2E：注入文本含 runner 与静默分钟', false, '无捕获')
    }
    const stallState = JSON.parse(fs.readFileSync(path.join(rootA, 'config', 'stall-check-state.json'), 'utf8'))
    ok('E2E：stall-check-state 落地且计次=1', stallState.perChild && stallState.perChild.ses_run1 && stallState.perChild.ses_run1.count === 1)
    const logTxt = fs.readFileSync(path.join(rootA, 'logs', 'stall-check.log'), 'utf8')
    ok('E2E：stall-check.log 固定字段齐全', /"runner":"ses_run1"/.test(logTxt) && /"result":"enqueue-ok"/.test(logTxt) && /"root":"ses_root1"/.test(logTxt) && /"silenceMin":16/.test(logTxt) && /"attempt":1/.test(logTxt) && /"target":"ses_root1"/.test(logTxt))
    ok('E2E：首 tick 只观察（log 含 observe:first-tick）', /"result":"observe:first-tick"/.test(logTxt))
    const nudgeState = JSON.parse(fs.readFileSync(path.join(rootA, 'config', 'nudge-state.json'), 'utf8'))
    ok('E2E：nudge-state perChild.lastAt 已写（P1-7 双向去重）', nudgeState.perChild && nudgeState.perChild.ses_run1 && Number(nudgeState.perChild.ses_run1.lastAt) > 0)
    // 单 runner 只注入 1 次（20min 冷却；观察窗内无第二条）
    const before = captures.length
    await sleep(3500)
    const dup = captures.slice(before).filter(function (c) { return c.path === '/session/ses_root1/prompt_async' })
    ok('E2E：冷却窗内不重复注入', dup.length === 0, 'dup=' + dup.length)

    // 负例：LITTLEDJ_NO_STALL_CHECK=1 → tick 入口直接关，零注入零状态
    const capturesB0 = captures.length
    childB = spawnChild(rootB, proxyPortB, { LITTLEDJ_NO_STALL_CHECK: '1' })
    await sleep(7000)
    const afterB = captures.slice(capturesB0).filter(function (c) { return /prompt_async/.test(c.path) })
    ok('E2E：NO_STALL_CHECK=1 零注入', afterB.length === 0, 'captured=' + afterB.length)
    ok('E2E：NO_STALL_CHECK=1 不落状态/日志', !fs.existsSync(path.join(rootB, 'config', 'stall-check-state.json')) && !fs.existsSync(path.join(rootB, 'logs', 'stall-check.log')))
  } finally {
    if (childA) { try { childA.kill('SIGKILL') } catch (e) {} }
    if (childB) { try { childB.kill('SIGKILL') } catch (e) {} }
    try { serve.close() } catch (e) {}
    rmrf(sandbox)
  }
}

integrationPhase().then(function () {
  sourceAnchorPhase()
  console.log('\n' + pass + '/' + total + ' PASS' + (fails.length ? ' — FAIL: ' + fails.join(' ; ') : ''))
  process.exit(pass === total ? 0 : 1)
}).catch(function (e) {
  console.error('E2E 异常：' + ((e && e.stack) || e))
  console.log('\n' + pass + '/' + total + ' PASS — FAIL: E2E 异常 ' + (e && e.message))
  process.exit(1)
})

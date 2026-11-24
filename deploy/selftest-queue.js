#!/usr/bin/env node
// task254 任务队列自测：applyOverrides 的 queued/taskRunning 通道、queuePositionOf 排位、
//   reapDecide 对 queued 的隔离、op 参数校验（不写盘路径）、proxy/ui 关键实现静态断言。
// 运行：node deploy/selftest-queue.js   （EXIT=0 全过）
'use strict'
const path = require('path')
const fs = require('fs')
const P = require(path.join(__dirname, '..', 'server', 'proxy.js'))
const UI = path.join(__dirname, '..', 'ui', 'index.html')
let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name) } else { fail++; console.log('FAIL ' + name + (extra ? '  → ' + extra : '')) }
}
function row(o) {
  return Object.assign({
    id: 'ses_root', title: 'T', inTask: true, state: 'running', stale: 'stalled',
    staleMinutes: 40, runnerSession: 'ses_runner', lastEventAt: 1000, directory: '/p/littleDJ'
  }, o || {})
}

// ---- 1. applyOverrides：queued 覆盖派生行（单行、无 union、ETA 不生效）----
const r1 = P.applyOverrides([row({ id: 'ses_q1' })], { overrides: { ses_q1: { state: 'queued', queuedAt: 500, title: '排队任务', directory: '/p/littleDJ' } } })
ok('queued 覆盖 state', r1[0].state === 'queued', r1[0].state)
ok('queued 透传 queueAt/queueTitle/queueDirectory', r1[0].queueAt === 500 && r1[0].queueTitle === '排队任务' && r1[0].queueDirectory === '/p/littleDJ')
ok('queued 仍单行（原数组长度不变）', r1.length === 1)

// ---- 2. applyOverrides：taskRunning 提升 inTask（亲自做 step=0 行入口径）----
const r2 = P.applyOverrides([row({ id: 'ses_t1', inTask: false })], { overrides: { ses_t1: { taskRunning: true, startedAt: 700, directory: '/p/littleDJ' } } })
ok('taskRunning 置位', r2[0].taskRunning === true && r2[0].taskStartedAt === 700)
ok('taskRunning 提升 inTask=true', r2[0].inTask === true)
ok('taskRunning 不覆盖 state（保持派生 running）', r2[0].state === 'running')

// ---- 3. applyOverrides：queued 条目不因会话新活动失效（与 auto-done 区分）----
const r3 = P.applyOverrides([row({ id: 'ses_q2', lastEventAt: 99999 })], { overrides: { ses_q2: { state: 'queued', queuedAt: 1, directory: '/x' } } })
ok('queued 不因 lastEventAt 新于条目失效', r3[0].state === 'queued', r3[0].state)

// ---- 4. applyOverrides：auto-done 新活动失效回归（⑥修复同谓词口径）----
const r4a = P.applyOverrides([row({ id: 'ses_d1', lastEventAt: 5000 })], { overrides: { ses_d1: { state: 'done', at: 1000, note: 'auto-done（静默 1s）' } } })
ok('auto-done 被新活动失效 → 回落 running', r4a[0].state === 'running', r4a[0].state)
const r4b = P.applyOverrides([row({ id: 'ses_d2', lastEventAt: 500 })], { overrides: { ses_d2: { state: 'done', at: 1000, note: 'auto-done（静默 1s）' } } })
ok('auto-done 无新活动 → 保持 done', r4b[0].state === 'done', r4b[0].state)

// ---- 5. queuePositionOf：同目录按 queuedAt 排位 ----
const st = { overrides: {
  ses_a: { state: 'queued', queuedAt: 300, directory: '/p/x' },
  ses_b: { state: 'queued', queuedAt: 100, directory: '/p/x' },
  ses_c: { state: 'queued', queuedAt: 200, directory: '/p/x' },
  ses_o: { state: 'queued', queuedAt: 50, directory: '/p/other' }
} }
ok('位次：最早 queuedAt = #1', P.queuePositionOf(st, '/p/x', 'ses_b') === 1)
ok('位次：第二 = #2', P.queuePositionOf(st, '/p/x', 'ses_c') === 2)
ok('位次：第三 = #3', P.queuePositionOf(st, '/p/x', 'ses_a') === 3)
ok('位次：不同目录隔离', P.queuePositionOf(st, '/p/other', 'ses_o') === 1)

// ---- 6. reapDecide：queued 行不进 auto-reap（防误杀排队）----
const dq = P.reapDecide(row({ state: 'queued', stale: 'stalled' }), { ok: true, lastRole: 'user', lastMsgCreated: 1 }, false, 99999999)
ok('queued 行 reapDecide=skip/overridden', dq.action === 'skip', JSON.stringify(dq))

// ---- 7. saveOverrideOp 参数校验（不写盘路径）----
const e1 = P.saveOverrideOp({ sessionId: 'ses_z1', op: 'queue' })
ok('op=queue 缺 directory → 报错', !e1.ok && /directory/.test(e1.error), JSON.stringify(e1))
const e2 = P.saveOverrideOp({ sessionId: 'bad-id', op: 'queue', directory: '/x' })
ok('sessionId 非法 → 报错', !e2.ok)
const e3 = P.saveOverrideOp({ sessionId: 'ses_z2', op: 'bogus' })
ok('未知 op → 报错且提示含 queue/start', !e3.ok && /queue/.test(e3.error))

// ---- 8. 静态断言：proxy 实现接线 ----
const prox = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8')
ok('op 白名单含 queue/start', /'queue', 'start'\]/.test(prox) || /op 只支持 interrupt \/ done \/ reopen \/ eta \/ queue \/ start/.test(prox))
ok('start 409 闸存在', /code: 409/.test(prox) && /同项目有在途任务/.test(prox))
ok('收口拉起钩子存在（saveOverrideOp 内）', /queuePromote\(dirOfTaskRow\(sessionId\)\)/.test(prox))
ok('队列调度防伪文案存在', /【队列调度·程序触发】/.test(prox) && /合法开工许可|开工许可/.test(prox))
ok('⑥ already-marked 加 staleAuto 豁免（两处）', (prox.match(/staleAuto/g) || []).length >= 4)
ok('queueHygiene 挂 tick', /qh = queueHygiene\(now\)/.test(prox))

// ---- 9. 静态断言：UI 接线 ----
const ui = fs.readFileSync(UI, 'utf8')
ok('ledgerInTask 豁免 queued/taskRunning', /t\.state === 'queued' \|\| t\.taskRunning/.test(ui))
ok('stageOf 有 queued 分支', /if \(st === 'queued'\) return 'queued'/.test(ui))
ok('stageLabel 有 ⏳ 等待', /⏳ 等待/.test(ui))
ok('renderTaskUnits 位次计算', /qByDir\[d\]\.sort/.test(ui) && /u\.queuePos = i \+ 1/.test(ui))
ok('taskModel 透传 queue 字段', /u\.queueDirectory = String\(t\.queueDirectory\)/.test(ui))
ok('版本号 verText ×3 且唯一（动态口径，L-063：禁写死版本字面量）', (function(){ var mm = ui.match(/personal agent · v[0-9.]+/g) || []; return mm.length === 3 && mm[0] === mm[1] && mm[1] === mm[2] })())


// ---- 10. 产出审复审补强（P0-1/P1-1 修法断言）----
ok('P0-1 queueAheadOf 实现了 queuedAt FIFO 比较', prox.indexOf('meQueued ? (Number(r.queueAt) || 0) < myQAt : true') >= 0)
ok('P1-1 op=queue 拒在跑条目', /已开工（running），如需重排请先收口/.test(prox))
ok('queue 幂等 dup:1', /dup: 1/.test(prox))
ok('HTTP 组包透传 position/ahead', /position: r.position, force: r.force/.test(prox) && /ahead: r.ahead/.test(prox))
ok('start 已收口拒绝', /如需重开请先 op=reopen/.test(prox))
ok('promote 防抖（10min）', /QUEUE_PROMOTE_DEBOUNCE_MS/.test(prox) && /debounced/.test(prox))
ok('hygiene 首 tick 只观察', /firstTick/.test(prox) && /重启首 tick 只观察/.test(prox))
ok('UI 冒名注释已还原（task254 仅剩 queue 语义）', (ui.match(/task254/g) || []).length === 4)
console.log('\n' + (fail ? 'FAIL' : 'PASS') + '  ' + pass + '/' + (pass + fail))
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
// task157 auto-reap 判定纯函数单测（reapDecide）；task180 扩展「自动完成（done）」正反例
// 运行：node deploy/selftest-auto-reap.js   （EXIT=0 全过）
'use strict'
const path = require('path')
const P = require(path.join(__dirname, '..', 'server', 'proxy.js'))
if (typeof P.reapDecide !== 'function') { console.error('FAIL: reapDecide 未导出'); process.exit(2) }

const MIN = 60 * 1000
const now = 1794240000000
let pass = 0, fail = 0
function row(o) {
  return Object.assign({
    id: 'ses_root', inTask: true, state: 'running', stale: 'stalled',
    staleMinutes: 40, runnerSession: 'ses_runner', lastEventAt: now - 40 * MIN,
    etaOverdueMin: 0, etaMinutes: 0
  }, o || {})
}
function probe(o) {
  return Object.assign({ ok: true, lastRole: 'assistant', created: now - 60 * MIN, completed: now - 45 * MIN }, o || {})
}
function t(name, r, p, busy, wantAction, wantWhy, wantKind) {
  const d = P.reapDecide(r, p, busy, now)
  const kindOk = !wantKind || d.kind === wantKind
  const ok = d.action === wantAction && (!wantWhy || d.why === wantWhy) && kindOk
  const got = d.action + '/' + d.why + (d.kind ? '/' + d.kind : '')
  if (ok) { pass++; console.log('PASS ' + name + ' -> ' + got) }
  else { fail++; console.log('FAIL ' + name + ' -> ' + got + '  期望 ' + wantAction + '/' + wantWhy + (wantKind ? '/' + wantKind : '')) }
}

// 1 口径外
t('not-in-task', row({ inTask: false }), probe(), false, 'skip', 'not-in-task')
// 2 已 override（人工或 auto-reap 已标）
t('overridden-done', row({ state: 'done' }), probe(), false, 'skip', 'overridden')
t('overridden-interrupted', row({ state: 'interrupted' }), probe(), false, 'skip', 'overridden')
// 3 无 runner 子会话
t('no-runner', row({ runnerSession: '' }), probe(), false, 'skip', 'no-runner')
// 4 物理在途
t('busy-skip', row(), probe(), true, 'skip', 'alive-busy')
t('busy-overdue-extend', row({ etaOverdueMin: 12 }), probe(), true, 'extend', 'alive-busy')
// 5 探针失败不判死
t('probe-failed', row(), { ok: false, why: 'timeout' }, false, 'skip', 'probe-failed')
t('probe-null', row(), null, false, 'skip', 'probe-failed')

/* ---- task180：自动完成（done）分支——主痛点「已完成却显示疑似中断/ETA 红标」 ---- */
// 6 已结束 45min 无人标记 → 自动完成（旧版误标 interrupt）
t('auto-done-45min', row(), probe({ completed: now - 45 * MIN }), false, 'close', 'ended-unmarked', 'done')
// 6b 边界：刚过 8s 防抖门槛 → done（task234：done 静默门槛 5min→8s）
t('auto-done-boundary-10s', row(), probe({ completed: now - 10 * 1000 }), false, 'close', 'ended-unmarked', 'done')
// 6c 边界：不足 8s（同刻抖动窗口）→ 先不动
t('auto-done-4s-skip', row(), probe({ completed: now - 4 * 1000 }), false, 'skip', 'recently-ended')
// 6d 未到 stalled（静默 6min，行还是 quiet）也应收口——done 不依赖 15min stalled
t('auto-done-not-stalled', row({ stale: 'quiet', staleMinutes: 6 }), probe({ completed: now - 6 * MIN }), false, 'close', 'ended-unmarked', 'done')

/* ---- 死路分支：保持 interrupt 语义 ---- */
// 7 末条 user 刚发出（等回复中）——锚点=user 消息自身 created（lastMsgCreated，P1-2）
t('user-pending', row(), probe({ lastRole: 'user', lastMsgCreated: now - 10 * MIN, created: now - 20 * MIN, completed: 0 }), false, 'skip', 'user-pending')
// 8 末条 user 超阈值（AI 一直没回 → 真断）
t('no-reply-silent', row(), probe({ lastRole: 'user', lastMsgCreated: now - 35 * MIN, created: now - 60 * MIN, completed: 0 }), false, 'close', 'no-reply-silent', 'interrupt')
// 8b 回归（P1-2 防同错重犯）：user 刚发 5min，但上一条 assistant created 在 40min 前——
//    若错用 assistant.created 当锚点会误判 close；必须按 lastMsgCreated 判 skip
t('user-pending-anchor-regression', row(), probe({ lastRole: 'user', lastMsgCreated: now - 5 * MIN, created: now - 40 * MIN, completed: now - 35 * MIN }), false, 'skip', 'user-pending')
// 8c user 消息超阈值但 assistant 已 completed（正常：AI 回完后人又发了一条，等新回复）→ 仍按 user 锚点判死
t('user-silent-after-completed', row(), probe({ lastRole: 'user', lastMsgCreated: now - 40 * MIN, created: now - 50 * MIN, completed: now - 45 * MIN }), false, 'close', 'no-reply-silent', 'interrupt')
// 9 run 未结束但 created 在阈值内（长命令闭口——R1 实测支撑）
t('run-in-progress', row(), probe({ lastRole: 'assistant', created: now - 25 * MIN, completed: 0 }), false, 'skip', 'run-in-progress')
// 9b 未到 stalled 且 run 未结束 → 不判死（stale=quiet）
t('not-stalled-run-open', row({ stale: 'quiet', staleMinutes: 6 }), probe({ lastRole: 'assistant', created: now - 6 * MIN, completed: 0 }), false, 'skip', 'not-stalled')
// 10 run 未结束且 created 超阈值（僵尸 run）
t('run-zombie', row(), probe({ lastRole: 'assistant', created: now - 35 * MIN, completed: 0 }), false, 'close', 'run-zombie', 'interrupt')

// 11 已结束边界：29 分钟 → 不再等 30min（done 门槛 8s 已过，主路径应收口）
t('boundary-29min-done', row(), probe({ created: now - 60 * MIN, completed: now - 29 * MIN }), false, 'close', 'ended-unmarked', 'done')

/* ---- task180 P1-2：applyOverrides 自动恢复守卫（auto-done 后新活动 → 行恢复 running；人工 done 不受影响） ---- */
function ovCheck(name, storeNote, lastEventAt, wantState) {
  const store = { version: 1, overrides: { ses_root: { state: 'done', at: now - 10 * MIN, note: storeNote } } }
  const out = P.applyOverrides([{ id: 'ses_root', state: 'running', inTask: true, lastEventAt: lastEventAt }], store)
  const got = out[0].state
  const ok = got === wantState
  if (ok) { pass++; console.log('PASS ' + name + ' -> ' + got) }
  else { fail++; console.log('FAIL ' + name + ' -> ' + got + '  期望 ' + wantState) }
}
ovCheck('auto-done-无新活动仍done', 'auto-done（静默 6m）', now - 20 * MIN, 'done')
ovCheck('auto-done-新活动自动恢复', 'auto-done（静默 6m）', now - 1 * MIN, 'running')
ovCheck('人工done-新活动不恢复', '主人已确认完成', now - 1 * MIN, 'done')

/* ---- task334：waiting（op=hold）守卫——P0-1 竞态闭环 ---- */
// W1 行级：applyOverrides 套上 waiting 后，reapDecide 必 skip（不因 stale=stalled 判死）
t('waiting-row-skip', row({ state: 'waiting', stale: 'stalled', staleMinutes: 40 }), probe({ completed: now - 45 * MIN }), false, 'skip', 'overridden')
// W2 套用：waiting 透传 + note 透传（UI 胶囊短语链路）
;(function () {
  const store = { version: 1, overrides: { ses_root: { state: 'waiting', at: now - 5 * MIN, note: '测试台无限循环监督' } } }
  const out = P.applyOverrides([{ id: 'ses_root', state: 'running', inTask: true, lastEventAt: now - 40 * MIN }], store)
  const ok = out[0].state === 'waiting' && out[0].overrideNote === '测试台无限循环监督'
  if (ok) { pass++; console.log('PASS waiting-applyOverrides透传 -> waiting/' + out[0].overrideNote) }
  else { fail++; console.log('FAIL waiting-applyOverrides透传 -> ' + out[0].state + '/' + out[0].overrideNote) }
})()
// W3 开工台账（P1-2）：bootLedgerText 走真派生无法单测注入行——源码锚断言：
//    waiting 分支必须存在于 stalled「疑似中断」分支之前（否则等待中被误报诱导收口）
;(function () {
  const fs = require('fs')
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8')
  const wPos = src.indexOf("t.state === 'waiting'")
  const sPos = src.indexOf('疑似中断（静默')
  const ok = wPos > 0 && sPos > 0 && wPos < sPos
  if (ok) { pass++; console.log('PASS waiting-bootLedger源码锚（分支先于stalled） -> ' + wPos + ' < ' + sPos) }
  else { fail++; console.log('FAIL waiting-bootLedger源码锚 -> waiting:' + wPos + ' stalled:' + sPos) }
})()

console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====')
process.exit(fail ? 1 : 0)

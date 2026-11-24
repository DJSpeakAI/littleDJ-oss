// selftest-wedge: server/wedge-detect.js 打表（task316）
// 运行：node deploy/selftest-wedge.js；打印 N/N PASS，全过 EXIT=0，任一失败 EXIT=1。
'use strict'
const WD = require('../server/wedge-detect')

const now = 1794725000000
const t = (min) => now - min * 60000
const asst = (id, createdMin, parts, extra) => Object.assign({ info: { id: id, role: 'assistant', time: { created: t(createdMin) } }, parts: parts || [] }, extra || {})
const user = (id, createdMin, text) => ({ info: { id: id, role: 'user', time: { created: t(createdMin) } }, parts: [{ type: 'text', text: text }] })
const step = (atMin) => ({ type: 'step-start', time: { start: t(atMin) } })
const tool = (name, status, atMin, extra) => Object.assign({ type: 'tool', tool: name, state: { status: status }, time: { start: t(atMin), end: status === 'running' ? undefined : t(atMin) } }, extra || {})
const text = (atMin) => ({ type: 'text', text: 'ok', time: { start: t(atMin), end: t(atMin) } })

const cases = []
function add(name, msgs, expect) {
  cases.push({ name: name, msgs: msgs, expect: expect })
}

add('已完成回合不算卡死', [user('u1', 30, 'hi'), asst('a1', 29, [step(29), text(28)], { info: { id: 'a1', role: 'assistant', time: { created: t(29), completed: t(28) } } })], { wedged: false })
add('刚开的回合不算（年龄闸）', [user('u1', 1, 'hi'), asst('a1', 1, [step(1)])], { wedged: false, reason: 'too-young' })
add('半开回合 + 后发 user（13:17 形态）', [user('u1', 50, 'q'), asst('a1', 49, [step(49), tool('question', 'completed', 1), text(1)]), user('u2', 0.8, '继续')], { wedged: true, target: '继续', laterUser: true })
add('等主人回答的 question 不算卡死', [user('u1', 50, 'q'), asst('a1', 49, [step(49), tool('question', 'running', 40), text(40)])], { wedged: false, reason: 'pending-question' })
add('半开回合静默无后发 user（13:34 形态）', [user('u1', 60, 'go'), asst('a1', 59, [step(59), tool('bash', 'completed', 55)])], { wedged: true, laterUser: false })
add('工具在跑（<20min）不算卡死', [user('u1', 30, 'go'), asst('a1', 29, [step(29), tool('bash', 'running', 5)])], { wedged: false, reason: 'tool-running' })
add('后发 user 但回合很新不算（年龄闸）', [user('u1', 10, 'q'), asst('a1', 3, [step(3), text(3)]), user('u2', 1, '继续')], { wedged: false, reason: 'too-young' })
add('errored 回合不算', [user('u1', 50, 'q'), asst('a1', 49, [step(49), text(49)], { info: { id: 'a1', role: 'assistant', time: { created: t(49) }, error: { name: 'Aborted' } } })], { wedged: false, reason: 'errored' })
add('后发 user 取最后一条原文', [user('u1', 50, 'q'), asst('a1', 49, [step(49), text(49)]), user('u2', 10, '第二条'), user('u3', 2, '最后一条')], { wedged: true, target: '最后一条' })
// task377（2026-11-18 DAG 事故形态）：后发「跑了怎么样了」+「？？」→ 取有实质内容的前一条，不重放空话
add('后发含空话取实质内容（task377 事故形态）', [user('u1', 50, 'q'), asst('a1', 49, [step(49), tool('bash', 'completed', 48)]), user('u2', 30, '跑了怎么样了'), user('u3', 20, '？？')], { wedged: true, target: '跑了怎么样了', laterUser: true })
add('后发全是空话 → 固定恢复语', [user('u1', 50, 'q'), asst('a1', 49, [step(49), tool('bash', 'completed', 48)]), user('u2', 20, '？？'), user('u3', 19, '。。。')], { wedged: true, target: '【卡死自动恢复】请从中断处继续完成刚才的任务，不要从头开始，不要重复已完成的步骤。' })
add('空消息不算卡死', [], { wedged: false, reason: 'no-assistant' })

let pass = 0
const fails = []
for (const c of cases) {
  let got
  try { got = WD.detect(c.msgs, now) } catch (e) { got = { __err: e.message } }
  let ok = got.wedged === c.expect.wedged
  if (ok && c.expect.reason) ok = got.reason === c.expect.reason
  if (ok && c.expect.laterUser !== undefined) ok = got.laterUser === c.expect.laterUser
  if (ok && c.expect.target !== undefined) ok = got.target === c.expect.target
  if (ok) pass++
  else fails.push(c.name + ' => ' + JSON.stringify(got))
  console.log((ok ? '✅ ' : '❌ ') + c.name + (ok ? '' : ' | got=' + JSON.stringify(got)))
}
console.log('\n' + pass + '/' + cases.length + ' PASS' + (fails.length ? ' — FAIL: ' + fails.join('; ') : ''))
process.exit(pass === cases.length ? 0 : 1)

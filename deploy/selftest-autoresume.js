/* selftest-autoresume.js —— task308 悬空回复检测纯函数自测（server/orphan-detect.js）
    覆盖：normMsgs 双形态归一 / classify 六值域（含 090 事故两形态：空占位、开关事件接口打错回归锚；
    task397 pending-question 等点选不算中断）/ fingerprint 双采样指纹（id 同长不同=有进展）/
    candidatesFrom 四过滤 / attemptsGuard 护栏三态 / task397 supersededByUser 旧账作废（我方系统消息不算）。
    exit 0=PASS / 1=FAIL / 2=装载失败。用法：node deploy/selftest-autoresume.js */
'use strict'
const path = require('path')
let OD
try { OD = require(path.join(__dirname, '..', 'server', 'orphan-detect')) } catch (e) {
  console.log('FAIL 装载 orphan-detect：' + e.message); process.exit(2)
}

let pass = 0, fail = 0
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; return }
  fail++; console.log('FAIL ' + label + '：got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
}

/* 1) normMsgs：serve 扁平与 proxy 包裹两形态统一成 {info,parts} */
const flat = [{ id: 'm1', role: 'user', time: { created: 1 }, parts: [{ type: 'text', text: 'hi' }] }]
const wrapped = [{ info: { id: 'm2', role: 'user' }, parts: [] }]
eq('扁平归一', OD.normMsgs(flat)[0].info.role, 'user')
eq('包裹原样', OD.normMsgs(wrapped)[0].info.id, 'm2')
eq('对象包装', OD.normMsgs({ data: flat }).length, 1)

/* 2) classify：值域打表 */
eq('user 尾→interrupted-user（喂原始扁平体，classify 内部归一）', OD.classify(flat), 'interrupted-user')
eq('MARK 前缀→our-mark', OD.classify([{ info: { id: 'x', role: 'user' }, parts: [{ type: 'text', text: OD.MARK_DEFAULT + '(系统消息…)' }] }]), 'our-mark')
eq('MARK 不在首位不算', OD.classify([{ info: { id: 'x', role: 'user' }, parts: [{ type: 'text', text: '正文 ' + OD.MARK_DEFAULT }], }]), 'interrupted-user')
eq('assistant 尾 tool→interrupted', OD.classify([{ info: { id: 'a', role: 'assistant' }, parts: [{ type: 'text', text: 'r' }, { type: 'tool', tool: 'bash' }] }]), 'interrupted-assistant')
eq('assistant 尾 step-start→interrupted', OD.classify([{ info: { id: 'a', role: 'assistant' }, parts: [{ type: 'step-start' }] }]), 'interrupted-assistant')
eq('assistant 尾 reasoning→interrupted', OD.classify([{ info: { id: 'a', role: 'assistant' }, parts: [{ type: 'reasoning' }] }]), 'interrupted-assistant')
/* L-090 事故形态①：assistant 空占位（0 parts）——11:35 挂死轮的真实形状 */
eq('assistant 0 parts→interrupted（090 形态①）', OD.classify([{ info: { id: 'a', role: 'assistant' }, parts: [] }]), 'interrupted-assistant')
eq('assistant 尾 step-finish→ok', OD.classify([{ info: { id: 'a', role: 'assistant' }, parts: [{ type: 'step-finish' }] }]), 'ok')
eq('assistant 尾 text→ok', OD.classify([{ info: { id: 'a', role: 'assistant' }, parts: [{ type: 'text', text: '答完了' }] }]), 'ok')
/* L-090 事故形态②（回归锚）：消息接口打错拿到「开关事件」（只有 type 没有 role）——必须判 empty，
   绝不判 ok（当年正是恒判 ok 才让续跑形同虚设） */
eq('开关事件形态→empty（090 回归锚）', OD.classify(OD.normMsgs({ data: [{ id: 'e1', type: 'model-switched', time: { created: 1 } }, { id: 'e2', type: 'agent-switched', time: { created: 1 } }] })), 'empty')
eq('空列表→empty', OD.classify([]), 'empty')

/* 3) fingerprint：id 同、长度不同=有进展（流式输出中） */
const f1 = OD.fingerprint([{ info: { id: 'm9', role: 'assistant' }, parts: [{ type: 'text', text: 'ab' }] }])
const f2 = OD.fingerprint([{ info: { id: 'm9', role: 'assistant' }, parts: [{ type: 'text', text: 'abcdef' }] }])
eq('指纹 id 相等', f2.lastId === f1.lastId, true)
eq('指纹长度变化=有进展', f2.lastLen !== f1.lastLen, true)
eq('指纹全等', JSON.stringify(OD.fingerprint([{ info: { id: 'm9', role: 'assistant' }, parts: [{ type: 'text', text: 'ab' }] }])) === JSON.stringify(f1), true)

/* 4) candidatesFrom：parentID/archived/hidden/过期/拒入目录 全排除 */
const NOW = 1794700000000
const list = [
  { id: 'ok1', time: { updated: NOW - 60 * 1000 }, directory: '/p/littleDJ' },
  { id: 'kid', parentID: 'p', time: { updated: NOW - 60 * 1000 } },
  { id: 'arc', archived: true, time: { updated: NOW - 60 * 1000 } },
  { id: 'hid', time: { updated: NOW - 60 * 1000 } },
  { id: 'old', time: { updated: NOW - 7 * 3600 * 1000 } },
  { id: 'dag', time: { updated: NOW - 60 * 1000 }, directory: '/storage/Users/currentUser/project/DAG_AI_Chat' },
]
const cands = OD.candidatesFrom(list, { now: NOW, recentMs: 6 * 3600 * 1000, hiddenSet: { hid: 1 }, denyDirs: ['DAG_AI_Chat'] })
eq('候选只剩 ok1', cands.map(function (c) { return c.id }).join(','), 'ok1')
eq('候选按 updated 降序', OD.candidatesFrom([{ id: 'b', time: { updated: 2 } }, { id: 'a', time: { updated: 9 } }], { now: 10, recentMs: 100 }).map(function (c) { return c.id }).join(','), 'a,b')

/* 4b) ageGate：年龄闸挡「正在干活」的年轻尾消息 */
eq('老尾消息→放行', OD.ageGate([{ info: { id: 'x', role: 'user', time: { created: NOW - 11 * 60 * 1000 } }, parts: [] }], 10 * 60 * 1000, NOW), true)
eq('新尾消息→拦', OD.ageGate([{ info: { id: 'x', role: 'assistant', time: { created: NOW - 3 * 60 * 1000 } }, parts: [{ type: 'tool' }] }], 10 * 60 * 1000, NOW), false)
eq('无时间戳→保守拦', OD.ageGate([{ info: { id: 'x', role: 'user' }, parts: [] }], 10 * 60 * 1000, NOW), false)
eq('空列表→拦', OD.ageGate([], 10 * 60 * 1000, NOW), false)

/* 5) attemptsGuard：上限/冷静期/放行 三态 */
const st = { s1: { attempts: 1, lastAt: NOW - 40 * 60 * 1000 }, s2: { attempts: 2, lastAt: NOW - 99 * 60 * 1000 }, s3: { attempts: 1, lastAt: NOW - 5 * 60 * 1000 } }
eq('1 次+过冷静期→放行', OD.attemptsGuard(st, 's1', 'interrupted-user', { now: NOW, max: 2, rewaitMs: 30 * 60 * 1000 }).ok, true)
eq('达上限→拦', OD.attemptsGuard(st, 's2', 'interrupted-user', { now: NOW, max: 2, rewaitMs: 30 * 60 * 1000 }).ok, false)
eq('our-mark 冷静期内→拦', OD.attemptsGuard(st, 's3', 'our-mark', { now: NOW, max: 2, rewaitMs: 30 * 60 * 1000 }).ok, false)
eq('our-mark 过冷静期→放行', OD.attemptsGuard(st, 's3', 'our-mark', { now: NOW + 30 * 60 * 1000, max: 2, rewaitMs: 30 * 60 * 1000 }).ok, true)
eq('无记录新会话→放行', OD.attemptsGuard(st, 'new', 'interrupted-user', { now: NOW, max: 2, rewaitMs: 30 * 60 * 1000 }).ok, true)

/* 6) task397：等主人点选的提问卡不算中断（1123「新对话 17:23」事故回归锚） */
const qMsg = function (status, tool, extra) {
  const part = { type: 'tool', tool: tool || 'question' }
  if (status !== null) part.state = { status: status, input: { questions: [{ header: 'DS OCR 范围对齐', question: '哪条路？' }] } }
  return { info: Object.assign({ id: 'a9', role: 'assistant', time: { created: NOW - 30 * 60 * 1000 } }, extra || {}), parts: [{ type: 'step-start' }, part] }
}
eq('提问卡在等（running）→pending-question', OD.classify([qMsg('running')]), 'pending-question')
eq('提问卡在等（pending）→pending-question', OD.classify([qMsg('pending')]), 'pending-question')
eq('提问卡被掐（error）→仍按中断可续跑', OD.classify([qMsg('error')]), 'interrupted-assistant')
eq('提问卡答完没下文（completed）→按中断', OD.classify([qMsg('completed')]), 'interrupted-assistant')
eq('提问卡没 state（形态异常）→不算等，按中断', OD.classify([qMsg(null)]), 'interrupted-assistant')
eq('消息级 error + 提问卡 running→按中断（产审 P2-6）', OD.classify([qMsg('running', 'question', { error: 'Aborted' })]), 'interrupted-assistant')
eq('普通工具悬空→仍按中断（不受影响）', OD.classify([qMsg('running', 'bash')]), 'interrupted-assistant')
eq('pending-question 不算中断', OD.isInterrupted('pending-question'), false)
eq('hasPendingQuestion 命中', OD.hasPendingQuestion(qMsg('running')), true)
eq('hasPendingQuestion error 不算', OD.hasPendingQuestion(qMsg('error')), false)

/* 7) task397：supersededByUser——主人发过新话=护栏旧账作废；我方系统消息不算 */
const WD = require(path.join(__dirname, '..', 'server', 'wedge-detect'))
const ent = { attempts: 2, lastAt: NOW - 60 * 60 * 1000 }
const uMsg = function (text, created) { return { info: { id: 'u1', role: 'user', time: { created: created } }, parts: [{ type: 'text', text: text }] } }
eq('恢复语前缀与 wedge-detect 同步', WD.RECOVER_TEXT.indexOf(OD.RECOVER_MARK), 0)
eq('lastAt 之后主人有新话→作废', OD.supersededByUser([uMsg('继续', NOW - 5 * 60 * 1000)], ent), true)
eq('只有 lastAt 之前的旧话→不作废', OD.supersededByUser([uMsg('继续', NOW - 90 * 60 * 1000)], ent), false)
eq('lastAt 之后只有我方 MARK→不作废', OD.supersededByUser([uMsg(OD.MARK_DEFAULT + 'x', NOW - 5 * 60 * 1000)], ent), false)
eq('lastAt 之后只有卡死恢复语（带水印前缀）→不作废（产审 P1-1）', OD.supersededByUser([uMsg('【当前模式：休息中】\n边界\n' + WD.RECOVER_TEXT, NOW - 5 * 60 * 1000)], ent), false)
eq('恢复语在行首=系统消息', OD.isSystemMsg('【当前模式：休息中】\n边界\n' + WD.RECOVER_TEXT), true)
eq('主人正文中间提到恢复语≠系统消息', OD.isSystemMsg('你那个【卡死自动恢复】是啥'), false)
eq('无账→不作废', OD.supersededByUser([uMsg('继续', NOW - 5 * 60 * 1000)], undefined), false)
eq('无 lastAt→不作废', OD.supersededByUser([uMsg('继续', NOW - 5 * 60 * 1000)], { attempts: 1 }), false)
eq('lastAt 之后只有程序触发的系统提醒→不作废（产审 R3）', OD.supersededByUser([uMsg('【系统自动提醒·程序触发】超时点名', NOW - 5 * 60 * 1000)], ent), false)
eq('带水印前缀的程序提醒也算系统消息', OD.isSystemMsg('【当前模式：休息中】\n边界\n【队列调度·程序触发】x'), true)
eq('水印贴着主人原话≠系统消息（后面是主人的话）', OD.isSystemMsg('【当前模式：休息中】\n边界\n把那个也改了'), false)
/* 8) task397 产审 R5：状态值域双向锁定——未知状态值按中断（宁可多续一次，不把活卡晾着） */
eq('提问卡未知状态值（starting）→按中断可续跑', OD.classify([qMsg('starting')]), 'interrupted-assistant')

console.log(pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' PASS') + ' orphan-detect')
process.exit(fail ? 1 : 0)

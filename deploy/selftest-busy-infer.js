/* task341 自测：忙闲判据 inferBusy——「思考窗口」误判空闲修复。
   现场（2026-11-16 03:1x）：DAG_AI_Chat「新对话 03:06」在跑（台账 running/active），
   末条 assistant 消息 time 只有 created、无 completed，parts=step-start+reasoning
   无 state.status='running' → 旧 inferBusy 判 IDLE → 侧栏回落「空闲中」，点开对话才纠偏。
   覆盖：表驱动 11 例（思考窗口/工具在跑/末条 user/僵尸保护/安全默认）+ 源码锚 + 冻结旧判据红对照。
   用法：node deploy/selftest-busy-infer.js   （EXIT=0 全绿） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'ui/src/chat/session.js');
let pass = 0, fail = 0;
function t(name, cond, detail){
  if (cond){ pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function extractInferBusy(code, label){
  const start = code.indexOf('function inferBusy(');
  const end = code.indexOf('window.newTask=', start);
  if (start < 0 || end < 0 || end <= start) throw new Error('未能定位 inferBusy 函数块：' + label);
  return code.slice(start, end);
}
function loadInferBusy(code, label){
  const sandbox = { console: { log(){}, warn(){}, error(){} }, Date, Object, Array, String, Number, JSON, Math };
  vm.createContext(sandbox);
  vm.runInContext(code + '\nthis.__inferBusy = inferBusy;', sandbox, { filename: label || 'inferBusy.js' });
  return sandbox.__inferBusy;
}
const NOW = Date.now();
const msg = (o) => Object.assign({ info: {}, parts: [] }, o);
const cases = [
  ['空消息列表 → 空闲', [], false],
  ['末条 user 新鲜（刚发未回） → 忙', [msg({ info: { role: 'user', time: { created: NOW - 1000 } } })], true],
  ['末条 user 超 5 分钟（僵尸） → 空闲', [msg({ info: { role: 'user', time: { created: NOW - 6 * 60 * 1000 } } })], false],
  ['assistant 工具 running（新鲜） → 忙', [msg({ info: { role: 'assistant', time: { created: NOW - 5000 } }, parts: [{ type: 'tool', state: { status: 'running' } }] })], true],
  ['assistant 工具 running 超 5 分钟（僵尸） → 空闲', [msg({ info: { role: 'assistant', time: { created: NOW - 6 * 60 * 1000 } }, parts: [{ type: 'tool', state: { status: 'running' } }] })], false],
  /* ★ 核心回归：思考窗口——step-start+reasoning，无 completed、无 running part */
  ['assistant 未收口·思考窗口（step-start+reasoning） → 忙', [msg({ info: { role: 'assistant', time: { created: NOW - 8000 } }, parts: [{ type: 'step-start' }, { type: 'reasoning', time: { start: NOW - 7000, end: NOW - 3000 } }] })], true],
  ['assistant 已收口（有 completed） → 空闲', [msg({ info: { role: 'assistant', time: { created: NOW - 9000, completed: NOW - 1000 } }, parts: [{ type: 'step-start' }, { type: 'text' }] })], false],
  ['assistant 未收口但 created 超 5 分钟（僵尸） → 空闲', [msg({ info: { role: 'assistant', time: { created: NOW - 6 * 60 * 1000 } }, parts: [{ type: 'reasoning' }] })], false],
  ['assistant 未收口且无 created（老数据兜底） → 空闲', [msg({ info: { role: 'assistant', time: {} }, parts: [{ type: 'reasoning' }] })], false],
  ['assistant 已收口但工具仍在 running → 忙（running part 硬信号优先）', [msg({ info: { role: 'assistant', time: { created: NOW - 9000, completed: NOW - 1000 } }, parts: [{ type: 'tool', state: { status: 'running' } }] })], true],
  ['非 user/assistant 角色 → 空闲', [msg({ info: { role: 'system', time: { created: NOW - 1000 } } })], false]
];

console.log('[task341] inferBusy 忙闲判据（思考窗口）');
let newFn;
try {
  const src = fs.readFileSync(SRC, 'utf8');
  newFn = loadInferBusy(extractInferBusy(src, SRC), SRC);
  /* 源码锚：新判据必须消费 time.completed */
  t('源码锚：新判据含 t.completed 收口判定', /!\s*t\.completed\s*&&\s*t\.created/.test(src));
} catch (e){
  console.log('  FAIL 装载 session.js :: ' + e.message);
  console.log('RESULT: FAIL ' + pass + ' pass / ' + (fail + 1) + ' fail');
  process.exit(1);
}

cases.forEach(function(c, i){
  const [name, msgs, want] = c;
  let got;
  try { got = newFn(msgs); } catch (e){ got = 'ERR:' + e.message }
  t(String(i + 1).padStart(2, '0') + '-' + name, got === want, 'want=' + want + ' got=' + got);
});

/* 红对照：task341 落码前旧判据（冻结在测试内，不取 git HEAD——task341 提交后 HEAD 已含新判据，
   旧「HEAD 红对照」会自失效；task342 清欠账改为字面冻结，语义不变：只认 running part / 末条 user） */
const OLD_INFER = `function inferBusy(msgs){
  if (!msgs || !msgs.length) return false;
  var last = msgs[msgs.length - 1], info = last.info || {};
  var ZOMBIE_MS = 5 * 60 * 1000;
  var lastTouch = (info.time && (info.time.updated || info.time.created)) || 0;
  if (info.role === 'user'){
    if (lastTouch && Date.now() - lastTouch > ZOMBIE_MS) return false;
    return true;
  }
  if (info.role === 'assistant'){
    var parts = last.parts || [];
    for (var i = 0; i < parts.length; i++){
      if ((parts[i].state || {}).status === 'running'){
        if (lastTouch && Date.now() - lastTouch > ZOMBIE_MS) return false;
        return true;
      }
    }
  }
  return false;
}`;
try {
  const oldFn = loadInferBusy(OLD_INFER, 'task341-pre');
  const thinkingMsgs = cases[5][1];
  t('红对照：旧判据在思考窗口误判 IDLE（应 FAIL 咬合）', oldFn(thinkingMsgs) !== true, 'old=' + oldFn(thinkingMsgs));
  t('红对照：旧判据与末条 user 用例一致（非全盘否定）', oldFn(cases[1][1]) === true);
} catch (e){
  t('红对照：旧判据可比对', false, e.message);
}

console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);

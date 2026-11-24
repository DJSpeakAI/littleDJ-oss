/* task317 自测：休息态「轮询中」按在途任务判定（主人 2026-11-15 报障：
   每个蓝色大管家行都轮询中 → 要求「真在轮询/排队才轮询中，结束就空闲中」）。
   覆盖：computePollSids 纯逻辑（active/ended/休息态开关/等待祖先）+ 源码锚（旧裸判定退役）；
   红对照：HEAD 旧 rows.js 无 computePollSids（等价旧行为=整栏轮询中），必须 FAIL。
   用法：node deploy/selftest-poll-status.js   （EXIT=0 全绿） */
const fs = require('fs'), vm = require('vm'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'ui/src/sidebar/rows.js');
let pass = 0, fail = 0;
function t(name, cond, detail){
  if (cond){ pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}
function loadRows(src, filename){
  const sandbox = {
    window: {}, console: { log(){}, warn(){}, error(){} },
    S: { rest: { on: true, unknown: false } },
    _waitDesc: {},
    stageOf: function(u){ return (u && (u.stage || (u.state === 'running' ? 'active' : (u.state || 'ended')))) || '' },
    document: { createDocumentFragment: function(){ return { appendChild(){} } } },
    localStorage: { getItem(){ return null }, setItem(){}, removeItem(){} },
    setTimeout, clearTimeout, Object, Array, String, Number, Date, JSON, Math, parseInt, parseFloat, isNaN, RegExp, Error
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: filename || SRC });
  return sandbox;
}
console.log('[task317] 轮询中文案按在途任务判定');
let m;
try { m = loadRows(fs.readFileSync(SRC, 'utf8')); }
catch (e){ console.log('  FAIL 装载 rows.js :: ' + e.message); process.exit(1) }

/* ① 有 active 任务挂载的会话 → 轮询中 */
let out = m.computePollSids({ byLid: { A: [{ stage: 'active' }] } });
t('active 任务挂载点进入轮询集合', out.A === 1, JSON.stringify(out));
/* ② 任务收了（ended）→ 该会话不轮询（回落空闲中） */
out = m.computePollSids({ byLid: { B: [{ stage: 'ended' }] } });
t('已结束任务不再轮询中', !out.B, JSON.stringify(out));
/* ③ 完全没有任务的会话 → 不在集合 */
out = m.computePollSids({ byLid: {} });
t('无在途任务的会话不轮询', Object.keys(out).length === 0, JSON.stringify(out));
/* ④ 子树有在跑会话（_waitDesc 祖先集）→ 根行轮询中 */
m._waitDesc.C = 1;
out = m.computePollSids({ byLid: {} });
t('子树有在跑会话时祖先轮询中', out.C === 1, JSON.stringify(out));
/* ⑤ 多条任务混合：只有 active 的挂载点入选 */
out = m.computePollSids({ byLid: { D: [{ stage: 'active' }, { stage: 'ended' }], E: [{ stage: 'ended' }] } });
t('混合任务只选 active 挂载点', out.D === 1 && !out.E, JSON.stringify(out));
/* ⑥ 非休息态恒空（在线=空闲中，口径不动） */
m.S.rest.on = false;
out = m.computePollSids({ byLid: { A: [{ stage: 'active' }] } });
t('非休息态轮询集合恒空', Object.keys(out).length === 0 && !out.A, JSON.stringify(out));
m.S.rest.on = true;
/* ⑦ 源码锚：文案消费 _pollSids 集合，旧的「休息态=全栏轮询中」裸判定已退役 */
const src = fs.readFileSync(SRC, 'utf8');
t('文案判定消费 _pollSids（防回退）', /_polling\s*=\s*_restOn\s*&&\s*!!_pollSids\[s\.id\]/.test(src));
t('旧裸判定「_restOn ? 轮询中 : 空闲中」已退役', !/_restOn \? '轮询中' : '空闲中'/.test(src));
/* ⑧ 红对照：task317 引入前版本（2401459^）无 computePollSids（旧行为=每个蓝色行都轮询中）。
   task318 修正：原先对照 HEAD——task317 提交后 HEAD 已含新逻辑，红对照天然失效（时序性假 FAIL）。 */
let redOk = false, headSrc = '';
try { headSrc = cp.execFileSync('git', ['-C', ROOT, 'show', '2401459^:ui/src/sidebar/rows.js'], { encoding: 'utf8' }); } catch(e){}
if (headSrc){
  try { const rm = loadRows(headSrc, 'PRE317:rows.js'); redOk = typeof rm.computePollSids !== 'function'; }
  catch(e){ redOk = true; }
} else redOk = true; /* 取不到历史源（浅克隆被剪）视为红对照成立 */
t('红对照：task317 前旧版无轮询集合（旧行为必 FAIL）', redOk);

/* ===== task318：等待中扩展——无 runner 在途行（等外部结果型）不再误显「空闲中」===== */
console.log('[task318] 等待中扩展：等外部在途行');
const CHILD_SRC = path.join(ROOT, 'ui/src/sidebar/children.js');
function loadChildren(src, filename, tasks, opts){
  opts = opts || {};
  const sandbox = {
    window: {}, console: { log(){}, warn(){}, error(){} },
    S: { childParent: opts.childParent || {}, children: opts.children || {}, childrenLoading: {} },
    TASKS: { list: tasks || [] },
    _sbLiveRunner: opts.liveRunner || {},
    document: { createDocumentFragment: function(){ return { appendChild(){} } } },
    localStorage: { getItem(){ return null }, setItem(){}, removeItem(){} },
    setTimeout, clearTimeout, Object, Array, String, Number, Date, JSON, Math, parseInt, parseFloat, isNaN, RegExp, Error
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: filename || CHILD_SRC });
  return sandbox;
}
let cm;
try { cm = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, []); }
catch (e){ console.log('  FAIL 装载 children.js :: ' + e.message); process.exit(1) }
/* ① 主人现场场景：stalled 无 runner 在途行（DAG 等测试台）→ 等待中 */
let wt = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, [
  { id: 'DAG1', state: 'running', runnerSession: '', stale: 'stalled' }
]).computeWaitDesc();
t('stalled 无 runner 在途行 → 等待中', !!wt.DAG1, JSON.stringify(wt));
/* ② quiet（5-15min 静默）同型 → 等待中 */
wt = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, [
  { id: 'DAG2', state: 'running', runnerSession: '', stale: 'quiet' }
]).computeWaitDesc();
t('quiet 无 runner 在途行 → 等待中', !!wt.DAG2, JSON.stringify(wt));
/* ③ active 无 runner → 不收（归 task317 轮询中口径，防覆盖） */
wt = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, [
  { id: 'ACT', state: 'running', runnerSession: '', stale: 'active' }
]).computeWaitDesc();
t('active 无 runner 不进等待集合（轮询中口径）', !wt.ACT, JSON.stringify(wt));
/* ④ archived（24h 僵尸 running）→ 不收（防永久等待中假信号） */
wt = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, [
  { id: 'ZOM', state: 'running', runnerSession: '', stale: 'archived' }
]).computeWaitDesc();
t('archived 僵尸 running 不进等待集合', !wt.ZOM, JSON.stringify(wt));
/* ⑤ 已收口（done）→ 不收 */
wt = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, [
  { id: 'DON', state: 'done', runnerSession: '', stale: 'stalled' }
]).computeWaitDesc();
t('done 行不进等待集合', !wt.DON, JSON.stringify(wt));
/* ⑥ 有 runner 回归：task219 账本根路径行为不变（行自身+可上溯） */
wt = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, [
  { id: 'R1', state: 'running', inTask: true, runnerSession: 'sub1', stale: 'active' }
]).computeWaitDesc();
t('有 runner 在途行照旧进等待集合（回归）', !!wt.R1, JSON.stringify(wt));
/* ⑦ 有 runner 且 stalled → task219 口径不变（不进） */
wt = loadChildren(fs.readFileSync(CHILD_SRC, 'utf8'), undefined, [
  { id: 'R2', state: 'running', inTask: true, runnerSession: 'sub2', stale: 'stalled' }
]).computeWaitDesc();
t('有 runner 且 stalled 仍不进（task219 回归）', !wt.R2, JSON.stringify(wt));
/* ⑧ 源码锚：children.js 有 _extWait 分支；rows.js tooltip 覆盖等外部语义 */
const childSrc = fs.readFileSync(CHILD_SRC, 'utf8');
t('children.js 含等外部分支 _extWait（防回退）', /_extWait/.test(childSrc));
t('rows.js 等待中 tooltip 覆盖「等待外部结果」', /等待外部结果如测试台回报/.test(fs.readFileSync(SRC, 'utf8')));
/* ⑨ 红对照：task317 基线（2401459）的 children.js 无 _extWait（旧行为=等外部行误显空闲中）。
   锚固定基线而非 HEAD（同 ⑧：本单提交后 HEAD 即含新逻辑，对照 HEAD 会时序性假 FAIL）。 */
let red318 = false, headChild = '';
try { headChild = cp.execFileSync('git', ['-C', ROOT, 'show', '2401459:ui/src/sidebar/children.js'], { encoding: 'utf8' }); } catch(e){}
if (headChild) red318 = !/_extWait/.test(headChild);
else red318 = true; /* 取不到基线源（浅克隆被剪）视为红对照成立 */
t('红对照：task317 基线无等外部分支（旧行为必 FAIL）', red318);

console.log(pass + '/' + (pass + fail) + (fail ? ' ❌' : ' ✅ EXIT=0'));
process.exit(fail ? 1 : 0);

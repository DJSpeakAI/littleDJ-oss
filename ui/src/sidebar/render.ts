/* @module render @order 7 @职责 侧栏项目渲染/拖拽/导航信号 @提供 HIDDEN_PROJECT_PATHS _dragKey _dragConv _sbTimer _sbLastAt _sbPending _dragAt _sbLiveRunner _waitDesc S_ENDED CHILD_STALE_MS _focusRendered _navSig _normProjPath _projRowHidden projectEntries clearDropMarks persistProjectOrder moveProjectTo bindProjDrag dragGuardActive dragReleaseRender navSidebarSig scheduleSidebar @依赖 - @依赖运行期 S renderSidebar taskUnits TASKS navTaskRoleLabel fmtDur fmtAgo navTaskDisplayLid @DOM契约 - @严格模式 是 @全局占用 HIDDEN_PROJECT_PATHS _dragKey _dragConv _sbTimer _sbLastAt _sbPending _dragAt _sbLiveRunner _waitDesc S_ENDED CHILD_STALE_MS _focusRendered _navSig _normProjPath _projRowHidden projectEntries clearDropMarks persistProjectOrder moveProjectTo bindProjDrag dragGuardActive dragReleaseRender navSidebarSig scheduleSidebar @源行 ui/index.html L1849-L2002 @测试锚点 - @被调用 - */
'use strict';
/* ---------- sidebar render ---------- */
/* B1：PWA 左栏不显示的项目（仅 UI 层过滤，零数据变动）
   task237（2026-11-12 主人指令）：解除 DAG AI Chat 的隐藏——主人要从小 DJ 左栏进这个项目修它的 bug，
   选择「选已有文件夹」指到它时却因本名单被吞掉、左栏纹丝不动（hit 分支连登记都跳过）。
   名单只保留「日常」（littleDJ 的草稿目录，留着会干扰）。
   task400：键由绝对路径改为「路径后缀」——运行根搬家后绝对路径会变，写死会让被藏的项目重新冒出来；
   匹配仍只看 path（禁按 name/title）：有运行根先剥掉前缀，再按后缀精确命中。 */
var HIDDEN_PROJECT_PATHS = {
  '/projects/日常': 1
};
function _normProjPath(p: any): string{ p = String(p || ''); return p.length > 1 && p.charAt(p.length - 1) === '/' ? p.slice(0, -1) : p; }
function _projRowHidden(proj: { path?: string } | null): boolean{
  if (!proj) return false;
  var pp: string = _normProjPath(proj.path);
  if (!pp) return false;
  var root: string = _normProjPath((S as any).root);
  if (root && pp.indexOf(root + '/') === 0) pp = pp.slice(root.length);
  return Object.keys(HIDDEN_PROJECT_PATHS).some(function(k){ return pp.slice(-k.length) === k; });
}
function projectEntries(visibleOnly?: boolean){
  var arr = [];
  /* task236-fu1：路径级去重——`<运行根>/projects/*` 下的目录由服务端 listProjects() 自动扫进 projects，
     若同一路径又被 import 过（登录/多端场景很常见），左栏会画出两行同名项目（本轮真机 E2E 实锤）。
     同路径只保留 projects 那一行；同名不同路径仍旧各显示（项目名允许重名）。 */
  var seenPath = {};
  S.projects.forEach(function(p){ if (visibleOnly && _projRowHidden(p)) return; seenPath[_normProjPath(p && p.path)] = 1; arr.push({ proj: p, key: p.name, isImport: false }) });
  S.imports.forEach(function(im){
    if (visibleOnly && _projRowHidden(im)) return;
    var k = _normProjPath(im && im.path);
    if (k && seenPath[k]) return;
    arr.push({ proj: im, key: 'i:' + im.name, isImport: true });
  });
  var pos = {};
  (S.order || []).forEach(function(k, i){ pos[k] = i });
  arr.sort(function(a, b){
    var ia = pos[a.key], ib = pos[b.key];
    if (ia == null && ib == null) return 0;
    if (ia == null) return 1;
    if (ib == null) return -1;
    return ia - ib;
  });
  return arr;
}
function clearDropMarks(): void{
  $$('#navBody .item').forEach(function(x){ x.classList.remove('drop-before', 'drop-after') });
}
function persistProjectOrder(order: string[]): void{
  fetch('/_projects/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: order }) }).catch(function(){});
}
function moveProjectTo(fromKey: string, toKey: string, after: boolean): void{
  if (!fromKey || !toKey || fromKey === toKey) return;
  var list = projectEntries().map(function(en){ return en.key });
  var fi = list.indexOf(fromKey);
  if (fi < 0) return;
  list.splice(fi, 1);
  var ti = list.indexOf(toKey);
  if (ti < 0) return;
  list.splice(after ? ti + 1 : ti, 0, fromKey);
  S.order = list;
  renderSidebar();
  persistProjectOrder(list);
}
var _dragKey = '';
var _dragConv = ''; /* task141：PC 拖拽排序中的会话 id */
function bindProjDrag(it: any, key: string): void{
  it.draggable = true;
  it.classList.add('proj-row');
  it.addEventListener('dragstart', function(ev){
    _dragKey = key; _dragAt = Date.now(); /* task145 P0-A */
    it.classList.add('dragging');
    if (ev.dataTransfer){ ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', key) } catch(e){} }
  });
  it.addEventListener('dragend', function(){
    _dragKey = ''; _dragAt = 0;
    it.classList.remove('dragging');
    clearDropMarks();
    dragReleaseRender(); /* task145 */
  });
  it.addEventListener('dragover', function(ev){
    if (!_dragKey || _dragKey === key) return;
    _dragAt = Date.now(); /* task145 P0-C：dragover 心跳，证明拖拽仍活着，避免长拖被 5s 自愈误杀 */
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    var r = it.getBoundingClientRect();
    var after = ev.clientY > r.top + r.height / 2;
    clearDropMarks();
    it.classList.add(after ? 'drop-after' : 'drop-before');
  });
  it.addEventListener('dragleave', function(ev){
    if (!it.contains(ev.relatedTarget)) it.classList.remove('drop-before', 'drop-after');
  });
  it.addEventListener('drop', function(ev){
    if (!_dragKey || _dragKey === key) return;
    ev.preventDefault();
    var r = it.getBoundingClientRect();
    var after = ev.clientY > r.top + r.height / 2;
    var from = _dragKey;
    clearDropMarks();
    moveProjectTo(from, key, after);
  });
}
/* P0-1：侧栏重绘 200ms 合并节流 + 视图守卫（防 session.updated 高频整块重建导致闪烁/滚动跳动） */
var _sbTimer = null, _sbLastAt = 0;
/* task145：拖拽排序期间挂起左栏整块重绘（在跑会话的 SSE 每帧重建会把被拖行从 DOM 摘走→拖到一半就断），松手后补一帧 */
var _sbPending = false, _dragAt = 0;
/* task145 P0-A：dragend 丢失（拖拽未真正启动/触屏模拟不可靠）时标志会残留→左栏永久冻结，用 5s 泄漏自愈兜底 */
function dragGuardActive(): boolean{
  if (!(_dragConv || _dragKey)) return false;
  if (_dragAt && Date.now() - _dragAt > 5000){ _dragConv = ''; _dragKey = ''; _dragAt = 0; return false }
  _sbPending = true; return true;
}
/* task145 P1-1：补帧前先比指纹，数据未变就省掉一次整块重建 */
function dragReleaseRender(): void{
  if (_dragConv || _dragKey || !_sbPending) return;
  _sbPending = false;
  if (navSidebarSig() === _navSig) return;
  scheduleSidebar();
}
/* task145 P0-A 双保险：行元素处理器随重建丢失时，文档级 capture 仍能收口释放 */
/* task145 P1-2：文档级 dragover 心跳——静止悬停（自身行/空白/窗外）无行级 dragover 时也持续续命，5s 自愈只在拖拽事件真死时才触发 */
var _sbLiveRunner = {}; /* 本次渲染的「在跑任务 runner 会话」集合，供子会话状态判定（task54 B） */
var _waitDesc = {}; /* task188：本次渲染的「等待中」判定集——在跑会话（busyBy ∪ liveRunner）沿父链上溯的全部祖先，
   供 childStatusInfo 判「小管家/枢机自己回合结束、但手下子代理还在跑」（主人 2026-11-10 定） */
var S_ENDED = {}; /* task78：本页收到的子会话结束提示（session.idle 置位 / busy 清除，内存态） */
var CHILD_STALE_MS = 15 * 60 * 1000; /* task78：子任务回执新鲜度阈值，数值对齐 server TASK_STALE_MS.stalled（15min）；双写点见 docs 方案稿 §4.1.1 */
var _focusRendered = false; /* task56：本次渲染是否已把当前树挂在某个项目分组下 */
/* task70 F1-2：左栏可见数据轻量指纹；台账/runner 事件回调在指纹未变时不再触发整树重建 */
var _navSig = '';
function navSidebarSig(): string{
  var busy = [];
  Object.keys(S.busyBy || {}).sort().forEach(function(k){ if (S.busyBy[k]) busy.push(k) });
  var us = taskUnits(true);
  var _etaRem = []; /* task176-fu1：未到期 ETA 剩余分钟（ceil）入指纹——每分钟一变驱动左栏重建，会话行倒计时跳变；无未到期项为空串，指纹与旧版同构 */
  var _etas = (TASKS && TASKS.etas) || {};
  var _now = Date.now();
  Object.keys(_etas).sort().forEach(function(k){
    var dl = Number((_etas[k] || {}).deadline) || 0;
    if (dl > _now) _etaRem.push(k + ':' + Math.ceil((dl - _now) / 60000));
  });
  /* task235：项目列表入指纹——登记/移除/改名项目后（S.order 常不含新 key）SSE/轮询两条事件补帧路径（指纹闸）才能感知重绘；
     否则 mProjAdd 入口登记成功后左栏永远不出现新项目（主人 2026-11-12 报障「还是不显示」第二轮，实锤取证见任务牌） */
  var _pj = (S.projects || []).concat(S.imports || []).map(function(x){ return x.name + '~' + x.path }).join(',');
  return ((S.current && S.current.id) || '') + '#' + busy.join(',') + '#' + (S.order || []).join(',') + '#' + _pj + '#' + us.map(function(u){ /* task145 P0-D：项目序入指纹，治拖项目后补帧被指纹闸吃掉 */
    return [u.key, u.state, u.title || '', navTaskRoleLabel(u), u.updated || 0,
      u.elapsed ? fmtDur(u.elapsed) : (u.live ? '' : fmtAgo(u.updated)),
      u.phase || '', u.progress || '', (u.artifacts || []).join(','),
      u.stale || '', u.staleMinutes == null ? '' : u.staleMinutes,
      u.ended ? 1 : 0, u.markable ? 1 : 0, navTaskDisplayLid(u),
      u.etaMinutes > 0 ? (u.etaDeadline || 0) : 0, u.etaOverdueMin || 0].join('|'); /* task106：显示父 lid 纳入指纹；task119：ETA 两字段纳入（治左栏超时冻结） */
  }).join(';') + '#' + _etaRem.join(',') + '#' + (S.ctxMap ? S.ctxMap.ver : 0) + '#' + (S.chain ? (S.chain.mode + (S.chain.unknown ? '?' : '')) : '') + '#' + 'rest:' + (S.rest && S.rest.on ? 1 : 0); /* task189：ctx 数据版本入指纹——拉到新数据且内容变化才重绘；task197：链路模式入指纹（徽标/等待中随模式变，防未来只靠指纹闸的重绘路径漏更新）；task317：休息态开关入指纹（轮询中/空闲中随开关切换） */
}
function scheduleSidebar(): void{
  var now = Date.now();
  if (_sbTimer) return;
  if (dragGuardActive()) return; /* task145：拖拽中不重建（5s 泄漏自愈） */
  var wait = Math.max(0, 200 - (now - _sbLastAt));
  _sbTimer = setTimeout(function(){
    _sbTimer = null; _sbLastAt = Date.now();
    if (S.view === 'projects') renderSidebar();
  }, wait);
}
window.HIDDEN_PROJECT_PATHS=HIDDEN_PROJECT_PATHS; window._dragKey=_dragKey; window._dragConv=_dragConv; window._sbTimer=_sbTimer; window._sbLastAt=_sbLastAt; window._sbPending=_sbPending; window._dragAt=_dragAt; window._sbLiveRunner=_sbLiveRunner; window._waitDesc=_waitDesc; window.S_ENDED=S_ENDED; window.CHILD_STALE_MS=CHILD_STALE_MS; window._focusRendered=_focusRendered; window._navSig=_navSig; window._normProjPath=_normProjPath; window._projRowHidden=_projRowHidden; window.projectEntries=projectEntries; window.clearDropMarks=clearDropMarks; window.persistProjectOrder=persistProjectOrder; window.moveProjectTo=moveProjectTo; window.bindProjDrag=bindProjDrag; window.dragGuardActive=dragGuardActive; window.dragReleaseRender=dragReleaseRender; window.navSidebarSig=navSidebarSig; window.scheduleSidebar=scheduleSidebar;

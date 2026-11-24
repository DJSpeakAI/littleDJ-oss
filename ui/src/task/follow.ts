/* @module follow @order 30 @职责 会话跟随 + 任务行视图 @提供 BOARD _navTouchAt boardLines boardDone loadBoardData navTaskUnits taskFollowCandidate butlerRoots activeButlerSid markActiveButler clearActiveButlerIf syncActiveButler navTaskDisplayLid navTaskDisplayParent navTaskParent projKeyOfLittleDJ projKeyForDir navTaskProjKey groupProjectTasks navTaskRoleKey navTaskRoleLabel navTasksFocus navTasksIsRunner navTasksTouch openRight @依赖 - @依赖运行期 taskUnits stageOf S isButlerSession isHiddenId findSessionAnywhere samePath baseName CHILD_ROLE_LABEL isMobile syncPanelMask renderSidebar toast saveProjOpen fetchChildren TASKS collectLiveTasks loadTaskLedger navSidebarSig _navSig scheduleSidebar pushPanelHist loadPanel @DOM契约 - @严格模式 是 @全局占用 BOARD _navTouchAt boardLines boardDone loadBoardData navTaskUnits taskFollowCandidate butlerRoots activeButlerSid markActiveButler clearActiveButlerIf syncActiveButler navTaskDisplayLid navTaskDisplayParent navTaskParent projKeyOfLittleDJ projKeyForDir navTaskProjKey groupProjectTasks navTaskRoleKey navTaskRoleLabel navTasksFocus navTasksIsRunner navTasksTouch openRight @源行 ui/index.html L8109-L8379 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 左栏任务板数据（task143：任务板 UI 已按主人要求删除，仅留 /_board 只读，供交接摘要「任务清单」用） ---------- */
var BOARD = { text: '', updatedAt: 0 };
function boardLines(){
  return String(BOARD.text || '').split('\n').map(function(l){ return l.replace(/\s+$/, '') });
}
function boardDone(l){ return /^\[x\]/i.test(l.trim()) }
function loadBoardData(cb){
  fetch('/_board').then(function(r){ return r.json() }).then(function(d){
    if (d && d.ok){
      BOARD.text = String(d.text || '');
      BOARD.updatedAt = Number(d.updatedAt) || 0;
    }
    if (cb) cb();
  }).catch(function(){ if (cb) cb() });
}
/* ---------- 左栏项目内任务行（并入项目列表；只做视图，数据源=taskUnits()） ---------- */
/* 纳入判据：有子代理会话（台账）或本次实时 task 调用；普通对话不算任务，防与对话条目重复 */
function navTaskUnits(){
  return taskUnits(true).filter(function(u){ return !!u.live || !!u.sid });
}
/* ---------- task106：会话跟随（显示归属重定向；数据归属 u.lid/u.sid 一律不动） ---------- */
/* D1 在途判定：实际可达态只有 running（台账派生层）+ stalled（疑似中断，按拍板迁移）；终态留原会话 */
function taskFollowCandidate(u){
  if (!u || !u.lid) return false;
  if (u.stale === 'archived') return false; /* archived 不在 stage 四态内，单独排除 */
  /* task156 §3.5：只跟随 active（quiet/stalled 不再跟随；stalled 旧口径为跟随） */
  return (u.stage || stageOf(u)) === 'active';
}
/* 大管家根会话集（正证据 !parentID + pwa===1，且未隐藏），按 time.updated 降序 */
function butlerRoots(){
  var out = (S.sessions || []).filter(function(s){ return isButlerSession(s) && !isHiddenId(s.id) });
  out.sort(function(a, b){ return ((b.time && b.time.updated) || 0) - ((a.time && a.time.updated) || 0) });
  return out;
}
/* 指针优先（校验通过才用），失效时临时回落最新 butler 根；不回写 S.activeButlerSid */
function activeButlerSid(){
  var p = S.activeButlerSid || '';
  if (p){
    var hit = findSessionAnywhere(p);
    if (hit && !hit.parentID && !isHiddenId(p)) return p;
  }
  var roots = butlerRoots();
  return roots.length ? roots[0].id : '';
}
/* 写指针（内存 + localStorage）：不删 S.children、不 hidden、不新增持久化键；旧根折叠已退役（task177） */
function markActiveButler(sid){
  if (!sid) return;
  S.activeButlerSid = sid;
  try {
    localStorage.setItem('littledj.activeButlerSid', sid);
    localStorage.setItem('littledj.activeButlerAt', String(Date.now()));
  } catch(e){}
  /* task177：不再折叠旧根（旧版此处会删旧根的展开标记，已退役）——主人 2026-11-10 定「我原先是怎么样的就是怎么样的」；
     任务行迁移走 activeButlerSid 指针（navTaskDisplayLid 不读 convOpen），折叠纯视觉，删行零功能影响 */
}
/* 删除/隐藏路径：指针命中才清键 */
function clearActiveButlerIf(sid){
  if (!sid || S.activeButlerSid !== sid) return;
  S.activeButlerSid = '';
  try {
    localStorage.removeItem('littledj.activeButlerSid');
    localStorage.removeItem('littledj.activeButlerAt');
  } catch(e){}
}
/* loadSessions 后校验：指针不在根集 / 被隐藏 / 是子会话 → 清键；只清理，不写回落值 */
function syncActiveButler(){
  var p = S.activeButlerSid;
  if (!p) return;
  var hit = null;
  for (var i = 0; i < (S.sessions || []).length; i++){ if (S.sessions[i].id === p){ hit = S.sessions[i]; break } }
  if (!hit || hit.parentID || isHiddenId(p)) clearActiveButlerIf(p);
}
/* 显示父 lid：三层护栏（根会话 / 正证据或指针 / 同项目）+ 焦点视图渲染护栏；不满足即回落 u.lid */
function navTaskDisplayLid(u){
  if (!u || !u.lid){
    /* task152：live 单元按「产出它的会话」归属（ownerSid），不再一律挂当前会话 */
    var _os = u.ownerSid || (S.current && S.current.id) || '';
    return (_os && findSessionAnywhere(_os)) ? _os : '';
  }
  var a = activeButlerSid();
  if (!a || a === u.lid) return u.lid;
  if (!taskFollowCandidate(u)) return u.lid;

  var src = findSessionAnywhere(u.lid);
  var dst = findSessionAnywhere(a);
  if (!src || !dst || dst.parentID) return u.lid;
  /* 目标正证据：isButlerSession(dst) 或「本次新建指针」（指针只在大管家上下文写入） */
  if (!(isButlerSession(dst) || dst.id === S.activeButlerSid)) return u.lid;
  /* 同项目护栏：跨项目绝不迁移；项目 key 双空（未登记）时按目录严格同路径判定 */
  var srcKey = projKeyForDir(src.directory), dstKey = projKeyForDir(dst.directory);
  if (!srcKey || !dstKey){ if (!samePath(src.directory, dst.directory)) return u.lid; }
  else if (srcKey !== dstKey) return u.lid;
  /* 渲染护栏：目标不是当前根时先不迁（焦点视图下迁了也看不见，防任务行凭空消失） */
  if (!(S.current && S.current.id === a)) return u.lid;
  return a;
}
function navTaskDisplayParent(u){
  var id = navTaskDisplayLid(u);
  if (!id || !S.sessions) return null;
  for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === id) return S.sessions[i];
  return null;
}
/* 显示侧项目 key 兜底（navTaskDisplayProjKey）已随 synthetic 分组退役（task164），删除 */
function navTaskParent(u){
  var id = navTaskDisplayLid(u); /* task106：渲染取父口径改显示父；数据归属仍用 u.lid */
  if (!id || !S.sessions) return null;
  for (var i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === id) return S.sessions[i];
  return null;
}
/* 无法判定归属时暂归 littleDJ：按路径找（项目名可被重命名，不按 name 精确匹配） */
function projKeyOfLittleDJ(){
  var i, p;
  for (i = 0; i < S.projects.length; i++){
    p = S.projects[i];
    if (baseName(p.path) === 'littleDJ' || samePath(p.path, S.root)) return p.name;
  }
  for (i = 0; i < S.imports.length; i++){
    p = S.imports[i];
    if (baseName(p.path) === 'littleDJ' || samePath(p.path, S.root)) return 'i:' + p.name;
  }
  for (i = 0; i < S.projects.length; i++){
    if (String(S.projects[i].path || '').toLowerCase().indexOf('littledj') >= 0) return S.projects[i].name;
  }
  for (i = 0; i < S.imports.length; i++){
    if (String(S.imports[i].path || '').toLowerCase().indexOf('littledj') >= 0) return 'i:' + S.imports[i].name;
  }
  return '';
}
/* 归属口径与对话条目 projConvs 双支一致：先全等 path，再末段同项目名（全等优先，防同名项目抢导入项目） */
function projKeyForDir(dir){
  var i, p;
  for (i = 0; i < S.projects.length; i++){ if (samePath(S.projects[i].path, dir)) return S.projects[i].name }
  for (i = 0; i < S.imports.length; i++){ if (samePath(S.imports[i].path, dir)) return 'i:' + S.imports[i].name }
  for (i = 0; i < S.projects.length; i++){ if (baseName(dir) === S.projects[i].name) return S.projects[i].name }
  for (i = 0; i < S.imports.length; i++){ if (baseName(dir) === S.imports[i].name) return 'i:' + S.imports[i].name }
  return '';
}
/* 归属：挂靠会话目录优先 → live 随当前会话 → 目录未登记暂归 littleDJ → 孤儿返回空（左栏不显示） */
/* task106 §15.5 P2-2：项目与 u._dir 恒按原父 u.lid（数据归属），显示归属只走 navTaskDisplay* */
function navTaskProjKey(u){
  var p = null, i;
  if (u.lid && S.sessions){
    for (i = 0; i < S.sessions.length; i++) if (S.sessions[i].id === u.lid){ p = S.sessions[i]; break }
  }
  var key = '';
  if (p) key = projKeyForDir(p.directory);
  else if (!u.lid && S.current) key = projKeyForDir(S.current.directory);
  if (!key && (p || (!u.lid && S.current))) key = projKeyOfLittleDJ();
  u._dir = p ? (p.directory || '') : ((S.current && S.current.directory) || '');
  return key;
}
/* task54 B §4.4：任务行归位——返回 byLid（父在）/ liveRunner（在跑 runner 集合）；synthetic 暂挂已随任务行渲染退役（task164）。
   map 已退役（任务行不再按项目平铺，改挂根会话节点下） */
function groupProjectTasks(){
  var out = { byLid: {}, orphan: 0, liveRunner: {} };
  navTaskUnits().forEach(function(u){
    if ((u.stage || stageOf(u)) === 'active' && u.sid) out.liveRunner[u.sid] = 1; /* task156 S6b：收口旧静默判定散判，统一走四态 stage */
    var key = navTaskProjKey(u); /* 原父口径；同时写 u._dir 供「打开子代理会话」兜底 */
    var dl = navTaskDisplayLid(u);
    var p = dl ? navTaskDisplayParent(u) : null;
    if (dl && p){
      (out.byLid[dl] || (out.byLid[dl] = [])).push(u); /* task106：改数组，迁移行可与原生行并存 */
    } else if (u.lid && !p){
      /* §3.1 ⑤ / task47 口径：父会话已不在（server 回滚/会话被删）——synthetic 暂挂渲染已随任务行退役（task164），只计数 */
      out.orphan++;
    } else if (!u.lid){
      /* task152：live 单元归到「产出它的会话」（ownerSid）；归属会话已不在列表时按孤儿处理，绝不乱挂当前会话 */
      var _own = u.ownerSid || (S.current && S.current.id) || '';
      if (_own && findSessionAnywhere(_own)) (out.byLid[_own] || (out.byLid[_own] = [])).push(u);
      else out.orphan++;
    } else {
      out.orphan++;
    }
  });
  function rowCmp(a, b){
    /* 在跑优先，其次实时，再次最新更新 */
    var pa = (a.state === 'running' && !a.ended) ? 0 : 1;
    var pb = (b.state === 'running' && !b.ended) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    if (!!a.live !== !!b.live) return a.live ? -1 : 1;
    return (b.updated || 0) - (a.updated || 0);
  }
  Object.keys(out.byLid).forEach(function(k){ out.byLid[k].sort(rowCmp) });
  return out;
}
/* task60 增量：任务行显示实际承接角色（runner agent=最新子会话 agent，/_tasks 已带）。
   回退只读已缓存 S.children，绝不触发 fetchChildren、绝不猜角色；拿不到回落旧文案 */
function navTaskRoleKey(u){
  var ra = String(u.runnerAgent || '');
  if (!ra && u.sid){
    var pool = null;
    if (u.lid && Object.prototype.hasOwnProperty.call(S.children, u.lid)) pool = S.children[u.lid];
    else if (S.current && Object.prototype.hasOwnProperty.call(S.children, S.current.id)) pool = S.children[S.current.id];
    if (pool) for (var i = 0; i < pool.length; i++){
      if (pool[i] && pool[i].id === u.sid){ ra = String(pool[i].agent || ''); break }
    }
  }
  return ra;
}
function navTaskRoleLabel(u){
  var ra = navTaskRoleKey(u);
  return ra ? (CHILD_ROLE_LABEL[ra] || '') : '';
}
/* task164：navTasksRow（左栏任务行渲染）与 _navTaskOpen 已退役——任务态统一看右栏任务面板（openRight('tasks')）；
   navTasksFocus 保留（右栏跳转定位），定位回退 .conv-sub 子会话行 */
function navTasksFocus(sid){
  if (isMobile()){ $('#sidebar').classList.add('open'); syncPanelMask() }
  if (!sid){ renderSidebar(); return }
  var units = navTaskUnits(), u = null, first = null, i, st;
  for (i = 0; i < units.length; i++){
    if (units[i].sid !== sid) continue;
    if (!first) first = units[i];
    st = units[i].state;
    if (st === 'running' || st === 'queued' || st === 'waiting' || st === 'blocked'){ u = units[i]; break }
  }
  if (!u) u = first;
  if (!u){ renderSidebar(); return }
  var key = navTaskProjKey(u);
  if (!key){ /* 孤儿任务：左栏无归属，退右栏任务面板并提示 */
    openRight('tasks');
    toast('该任务没有归属项目，已打开右栏任务面板', true);
    return;
  }
  S.projOpen[key] = true; saveProjOpen();
  /* task342：搜索入口退役，原「清空搜索词」一行删除 */
  /* task54 B §4.9：先展开父会话（任务行挂在其下），再渲染定位；子会话未缓存则异步补取，不阻塞定位 */
  /* task106：按「显示父」展开并滚动，迁移后的任务行也能定位 */
  var dl = navTaskDisplayLid(u);
  if (dl && navTaskParent(u)){
    S.convOpen[dl] = 1;
    if (!Object.prototype.hasOwnProperty.call(S.children, dl) && !S.childrenLoading[dl]) fetchChildren(dl);
  }
  renderSidebar();
  var hit = document.querySelector('.conv-sub[data-sid="' + sid + '"]'); /* task164：左栏任务行退役，只定位子会话行 */
  if (!hit) return;
  hit.classList.add('focus');
  try { hit.scrollIntoView({ block: 'nearest' }) } catch (e){}
  setTimeout(function(){ hit.classList.remove('focus') }, 2200);
}
function navTasksIsRunner(sid){
  if (!sid) return false;
  try {
    if ((TASKS.list || []).some(function(t){ return t.runnerSession === sid })) return true;
    return collectLiveTasks().some(function(u){ return u.sid === sid });
  } catch (e){ return false }
}
var _navTouchAt = 0;
function navTasksTouch(sid){
  var now = Date.now();
  if (now - _navTouchAt < 2000) return;
  _navTouchAt = now;
  /* task54 B §4.5：按 childParent 反查父缓存定向失效；task70 F1-1 改为打脏标记，不删旧数组（父展开时旧行保留、后台刷新） */
  var pid = sid && S.childParent[sid];
  if (pid && Object.prototype.hasOwnProperty.call(S.children, pid)){
    S.childrenDirty[pid] = 1;
    if (S.convOpen[pid] && !S.childrenLoading[pid]) fetchChildren(pid);
  }
  loadTaskLedger(false);
  if (navSidebarSig() !== _navSig) scheduleSidebar(); /* task70 F1-2：可见数据未变不重建 */
}
function openRight(tab){
  if (tab){ S.tab = tab; $$('.tabs .tb').forEach(function(x){ x.classList.toggle('active', x.dataset.tab === tab) }) }
  $('#app').classList.remove('noright');
  if (isMobile()){
    $('#sidebar').classList.remove('open');
    $('#right').classList.add('open');
    pushPanelHist();
    syncPanelMask();
  }
  loadPanel();
}
window.BOARD=BOARD; window._navTouchAt=_navTouchAt; window.boardLines=boardLines; window.boardDone=boardDone; window.loadBoardData=loadBoardData; window.navTaskUnits=navTaskUnits; window.taskFollowCandidate=taskFollowCandidate; window.butlerRoots=butlerRoots; window.activeButlerSid=activeButlerSid; window.markActiveButler=markActiveButler; window.clearActiveButlerIf=clearActiveButlerIf; window.syncActiveButler=syncActiveButler; window.navTaskDisplayLid=navTaskDisplayLid; window.navTaskDisplayParent=navTaskDisplayParent; window.navTaskParent=navTaskParent; window.projKeyOfLittleDJ=projKeyOfLittleDJ; window.projKeyForDir=projKeyForDir; window.navTaskProjKey=navTaskProjKey; window.groupProjectTasks=groupProjectTasks; window.navTaskRoleKey=navTaskRoleKey; window.navTaskRoleLabel=navTaskRoleLabel; window.navTasksFocus=navTasksFocus; window.navTasksIsRunner=navTasksIsRunner; window.navTasksTouch=navTasksTouch; window.openRight=openRight;

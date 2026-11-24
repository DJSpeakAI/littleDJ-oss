/* @module rows @order 8 @职责 会话行/项目行渲染 @提供 CONV_ICON_ARCHIVE CONV_ICON_PIN CONV_ICON_PIN_ON CONV_ICON_DOTS CONV_ICON_FORK CONV_ICON_PLUS PROJ_ICO_SVG HIDE_GROUP_TITLES isHiddenId sessInProj findSessionAnywhere resolveCurrentRoot ensureCurrentTreeOpen _pollSids computePollSids buildSidebarCtx renderSidebar renderFocusFallback sectFoldHead renderTuiSection ARCHIVE_LIST_MAX renderArchiveSection buildArchiveRow buildRestoredRow openRestored convSpinEl buildConvRow isTodayTs todayButlerConv renderProjRow @依赖 - @依赖运行期 S baseName fetchChildren dragGuardActive _navSig navSidebarSig renderMultiSelBar ledgerActiveSids liveRunningSids groupProjectTasks _sbLiveRunner _waitDesc computeWaitDesc stageOf _focusRendered projectEntries appendChildRows exitSortMode convPins isSessionLocked lockHint toggleConvOpen isPinnedConv chainMeta TASKS convCtxPill fmtTime updateMultiSelBar openSession restoreSession toast openRestored moveConv showCtxMenu deleteSession togglePinConv bindConvDrag bindItemMenu isButlerSession projConvs butlerRoots _flashProj newTask showProjectMenu saveFocusProjOpen toggleProjOpen bindProjDrag @DOM契约 - @严格模式 是 @全局占用 CONV_ICON_ARCHIVE CONV_ICON_PIN CONV_ICON_PIN_ON CONV_ICON_DOTS CONV_ICON_FORK CONV_ICON_PLUS PROJ_ICO_SVG HIDE_GROUP_TITLES isHiddenId sessInProj findSessionAnywhere resolveCurrentRoot ensureCurrentTreeOpen _pollSids computePollSids buildSidebarCtx renderSidebar renderFocusFallback sectFoldHead renderTuiSection ARCHIVE_LIST_MAX renderArchiveSection buildArchiveRow buildRestoredRow openRestored convSpinEl buildConvRow isTodayTs todayButlerConv renderProjRow @源行 ui/index.html L2003-L2562 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task56 §4：精简视图（当前根解析 / 自动展开 / 空态 / 已移除分区） ---------- */
function isHiddenId(id: string | null | undefined): boolean{ return !!(id && S.hidden[id]) }
function sessInProj(proj: any, s: any): boolean{
  if (!proj || !s) return false;
  return s.directory === proj.path || baseName(s.directory) === proj.name;
}
/* 只查内存（S.sessions 根 + 已加载的 S.children），不发额外请求 */
function findSessionAnywhere(id: string){
  if (!id) return null;
  var i, j;
  for (i = 0; i < S.sessions.length; i++){ if (S.sessions[i].id === id) return S.sessions[i] }
  var pids = Object.keys(S.children);
  for (i = 0; i < pids.length; i++){
    var arr = S.children[pids[i]] || [];
    for (j = 0; j < arr.length; j++){ if (arr[j] && arr[j].id === id) return arr[j] }
  }
  return null;
}
/* 复用 _pidAlive 同款上溯：当前 → … → 根；链尾即根，深度上限 8 层并防环（§4.2） */
function resolveCurrentRoot(){
  if (!S.current) return null;
  var chain = [S.current.id];
  var seen = {}; seen[S.current.id] = 1;
  var pid = S.current.parentID || S.childParent[S.current.id] || '';
  var guard = 0;
  while (pid && !seen[pid] && guard < 8){
    seen[pid] = 1; chain.push(pid); guard++;
    var p = findSessionAnywhere(pid);
    pid = (p && p.parentID) || S.childParent[pid] || '';
  }
  var rootId = chain[chain.length - 1];
  var rootSess = findSessionAnywhere(rootId);
  /* 根缺失兜底（§4.4）：不在根集 / 对象不在内存 / 根已被软删 → 当前会话升为虚拟根 */
  var virtual = !rootSess || isHiddenId(rootId);
  return { id: rootId, chain: chain, root: rootSess, virtual: !!virtual };
}
/* 自动展开到当前会话：openSession() 内一次 + renderSidebar() 仅当前根变化时兜底一次；内部去重（§4.5） */
function ensureCurrentTreeOpen(): void{
  if (!S.current) return;
  if (S._treeOpenedFor === S.current.id) return;
  var info = resolveCurrentRoot();
  if (!info) return;
  S._treeOpenedFor = S.current.id;
  var i, aid;
  for (i = 1; i < info.chain.length; i++){
    aid = info.chain[i];
    if (isHiddenId(aid)) continue;            /* 隐藏祖先不渲染，不展开 */
    if (!findSessionAnywhere(aid)) continue;  /* 断链祖先不展开，避免无谓失败项 */
    S.convOpen[aid] = 1;
    fetchChildren(aid);
  }
  /* 主人 2026-11-09 定：当前会话自身默认不展开（子代理/子任务收在 caret 里，需要看时手点）。
     祖先链展开保留——那是让当前会话在树里可见的必要条件。 */
}
/* task143：任务行开关按钮已随主人要求删除；task138 语义保留——内部派单任务行恒按 localStorage 开关渲染 */
/* task196：左栏「当前没有打开的对话」空态盒退役（主人 2026-11-10 拍板：隐藏会话后弹这个纯属噪音，
   且高度撑开左栏导致下方列表整体下移跳动）；无当前会话时左栏只显示项目/会话列表本身 */
/* task317（主人 2026-11-15 报障）：休息态「轮询中」不再无脑挂给每个大管家行——
   只标「真的在轮询/排队」的会话：名下任务行存在 active 单元（byLid 挂载点），或子树里有在跑会话（_waitDesc 祖先）。
   任务收口（done/interrupted/ended）后该会话不在集合里 ⇒ 自动回落「空闲中」；
   非休息态集合恒空，文案口径不动（在线=空闲中）。 */
var _pollSids = {};
function computePollSids(grouped: any){
  var out = {};
  if (!(S.rest && S.rest.on && !S.rest.unknown)) return out;
  var byLid = (grouped && grouped.byLid) || {};
  Object.keys(byLid).forEach(function(lid){
    var us = byLid[lid] || [];
    for (var i = 0; i < us.length; i++){
      var u = us[i];
      if (u && (u.stage || stageOf(u)) === 'active'){ out[lid] = 1; break }
    }
  });
  Object.keys(_waitDesc || {}).forEach(function(k){ if (_waitDesc[k]) out[k] = 1 });
  return out;
}
/* 本次渲染的上下文：视图模式 + 当前根 + 已移除候选，一次算好供所有项目行复用（§4.3）
   task342：搜索入口退役后恒为聚焦视图（原 q/search/all 三字段删除） */
function buildSidebarCtx(){
  var ctx: any = {
    focus: true,
    root: null, focusSess: null
  };
  ctx.root = resolveCurrentRoot();
  ctx.focusSess = ctx.root ? ((ctx.root.virtual ? S.current : ctx.root.root) || S.current) : null;
  /* task196：空态盒退役后不再需要 ctx.empty */
  /* task86：「已移除」分区全场景退役（旧分区不复活）；task390（主人 2026-11-22 新指令）另设常驻「归档会话列表」
     = 最近 10 条可恢复，覆盖 task86「找回唯一走 AI 后台」口径 */
  return ctx;
}
function renderSidebar(){
  if (dragGuardActive()) return; /* task145：拖拽中不重建（含直接调用方） */
  _navSig = navSidebarSig(); /* task70 F1-2：记录本次已渲染数据的指纹 */
  var body = $('#navBody'); var _sbTop = body.scrollTop; body.replaceChildren();
  /* task160：「＋新建项目」入口恒显——原「仅项目视图可见」让对话视图下入口凭空消失，
     主人找不到创建新项目的地方（2026-11-10 报障）；新建对话另有顶部快捷钮/快捷键，互不冲突 */

  if (S.view === 'projects'){
    $('#sectTitle').textContent = '项目';
    if (S.multiSel.on) body.appendChild(renderMultiSelBar());
    var ledgerSet = ledgerActiveSids(), liveSet = liveRunningSids();
    var grouped = groupProjectTasks(); /* 每帧只算一次：byLid / liveRunner（task54 B；暂挂分组已随任务行退役 task164） */
    _sbLiveRunner = grouped.liveRunner || {};
    _waitDesc = computeWaitDesc(); /* task188：每帧重算「等待中」祖先集（busy 通常≤5、深度≤3，开销可忽略） */
    _pollSids = computePollSids(grouped); /* task317：每帧重算「轮询中」集合——必须在 _waitDesc 之后（依赖在跑祖先集） */
    var ctx = buildSidebarCtx();
    ctx.ledgerSet = ledgerSet; ctx.liveSet = liveSet;
    /* 当前根变化时兜底展开一次（正常重绘不重复触发，避免高频 fetchChildren） */
    if (S.current && ctx.root){
      if (S.treeRootId !== ctx.root.id){ S.treeRootId = ctx.root.id; ensureCurrentTreeOpen() }
    } else S.treeRootId = '';
    /* task60 R1：TUI 分区只算一次；仅焦点视图挂载（task342：搜索态退役后恒挂载）
       task139：大管家会话已并回所属项目分组，不再单独成区 */
    var tuiFrag = renderTuiSection(ctx);
    /* task161：无当前会话时项目列表照常渲染；task196：「当前没有打开的对话」提示盒已退役，无会话即不插任何占位 */
    _focusRendered = false;
    projectEntries(true).forEach(function(en){
      var row = renderProjRow(en.proj, PROJ_ICO_SVG, en.key, en.isImport, ledgerSet, liveSet, grouped, ctx);
      if (row) body.appendChild(row);
    });
    /* 当前会话所属项目不在登记里（或该项目行被隐藏）：直接挂一行兜底分组，不留黑洞 */
    if (ctx.focus && !_focusRendered && ctx.focusSess) body.appendChild(renderFocusFallback(ctx));
    /* task390：归档会话列表（项目树后、TUI 前——防被 60+ 行 TUI 挤出一屏外）；无归档/多选态返回 null 不占位 */
    var archFrag = renderArchiveSection(ctx);
    if (archFrag) body.appendChild(archFrag);
    if (tuiFrag) body.appendChild(tuiFrag);
    if (!S.projects.length && !S.imports.length) body.appendChild(el('div', 'emptyhint', '还没有项目，点右上角 ＋ 选一个文件夹'));
  }
  body.scrollTop = _sbTop;
  if (_sbTop && body.scrollTop !== _sbTop) setTimeout(function(){ body.scrollTop = _sbTop }, 0);
}
/* 兜底分组：当前会话不属于任何已登记的可见项目时，也要能看到当前树 */
function renderFocusFallback(ctx: any){
  var frag = document.createDocumentFragment();
  var s = ctx.focusSess;
  frag.appendChild(el('div', 'sect-sub', baseName(s.directory) + ' · 1 对话'));
  var cached = Object.prototype.hasOwnProperty.call(S.children, s.id);
  var kids = cached ? (S.children[s.id] || []) : null;
  var hasKids = cached ? kids.length > 0 : (Number(s.childCount) > 0);
  var open = !!S.convOpen[s.id];
  frag.appendChild(buildConvRow(s, { hasKids: hasKids, open: open, ledgerSet: ctx.ledgerSet, liveSet: ctx.liveSet }));
  if (open && hasKids) appendChildRows(frag, s.id, 1);
  return frag;
}
/* task128：可折叠分区标题行（TUI 会话）——点击切换 + localStorage 持久化 + 无条件重绘
   （折叠态不进 navSidebarSig 指纹：事件驱动的指纹闸只管数据面，交互切换当轮直接重绘）
   task139：大管家分区退役后仅剩 TUI 一种，kind 形参随之收掉
   task390：新增 sectKey='archive'——「归档会话列表」分区复用同一标题行（独立折叠态 + 独立 localStorage 键） */
function sectFoldHead(label: string, sortKey: string, sectKey?: string): HTMLElement{
  var isArch = sectKey === 'archive';
  var open = isArch ? !!S.archiveSectOpen : !!S.tuiSectOpen;
  var h = el('div', 'sect-sub sect-fold' + (open ? ' open' : ''));
  h.appendChild(el('span', 'scaret', '▸'));
  h.appendChild(el('span', null, label));
  /* task146 P1-2：TUI 排序模式没有项目行，「完成」按钮挂到分区标题右侧（手机端无 ESC 也能退出） */
  if (sortKey && S.sortProj === sortKey){
    var _done = el('button', 'sort-done', '完成');
    _done.title = '保存顺序并退出排序';
    _done.onclick = function(ev){ ev.stopPropagation(); exitSortMode(sortKey) };
    h.appendChild(_done);
  }
  h.title = open ? '点击折叠' : '点击展开';
  h.onclick = function(){
    if (isArch){
      S.archiveSectOpen = !S.archiveSectOpen;
      try { localStorage.setItem('littledj.archiveSectOpen', S.archiveSectOpen ? '1' : '0') } catch(e){}
    } else {
      S.tuiSectOpen = !S.tuiSectOpen;
      try { localStorage.setItem('littledj.tuiSectOpen', S.tuiSectOpen ? '1' : '0') } catch(e){}
    }
    renderSidebar();
  };
  return h;
}
/* task60 R1：TUI 会话常驻分区——仅 focus 视图挂载；task128：标题行折叠 caret（默认展开，localStorage 持久化） */
function renderTuiSection(ctx: any){
  var frag = document.createDocumentFragment();
  /* 数据源 S.sessions 即根会话全集；判定唯一复用来源字段，当前根去重（已在原树渲染） */
  var list = S.sessions.filter(function(s){
    return s && s.pwa === 0 && !isHiddenId(s.id) && !(ctx.root && ctx.root.id === s.id);
  });
  /* task146：TUI 分区应用会话手动排序（key='__tui__'）；task147：未列出的（=新建）排最前，与项目分组同语义；
     task200：同 renderProjRow——逻辑序写 _lastConvOrder，pin 只在显示层叠加 */
  var _tord = S.convOrder['__tui__'];
  var _tpins = convPins();
  if ((_tord && _tord.length) || _tpins.length){
    var _tpos = {};
    if (_tord && _tord.length) _tord.forEach(function(id, idx){ _tpos[id] = idx });
    var _tlogical = list.toSorted(function(a, b){
      var pa = _tpos[a.id], pb = _tpos[b.id];
      if (pa == null && pb == null) return 0;
      if (pa == null) return -1;
      if (pb == null) return 1;
      return pa - pb;
    });
    S._lastConvOrder['__tui__'] = _tlogical.map(function(x){ return x.id }); /* 逻辑序快照（pin 前） */
    if (_tpins.length){
      var _tpinSet = {};
      _tpins.forEach(function(id){ _tpinSet[id] = 1 });
      list = _tlogical.toSorted(function(a, b){
        var pa = _tpinSet[a.id] ? 0 : 1, pb = _tpinSet[b.id] ? 0 : 1;
        return pa - pb;
      });
    } else list = _tlogical;
  } else {
    S._lastConvOrder['__tui__'] = list.map(function(x){ return x.id });
  }
  frag.appendChild(sectFoldHead('TUI 会话（' + list.length + '）', '__tui__'));
  if (!S.tuiSectOpen) return frag;
  if (!list.length){
    frag.appendChild(el('div', 'proj-empty', '暂无 TUI 会话'));
    return frag;
  }
  list.forEach(function(s){
    var cached = Object.prototype.hasOwnProperty.call(S.children, s.id);
    var kids = cached ? (S.children[s.id] || []) : null;
    var hasKids = cached ? kids.length > 0 : (Number(s.childCount) > 0);
    /* task187：多选不再强制折叠——open 按 convOpen 原样（主人 2026-11-10 定「多选时保持原样」） */
    var open = !!S.convOpen[s.id];
    frag.appendChild(buildConvRow(s, { hasKids: hasKids, open: open, ledgerSet: ctx.ledgerSet, liveSet: ctx.liveSet, sortMode: (S.sortProj === '__tui__') })); /* task146：TUI 区排序模式 */
    if (open && hasKids) appendChildRows(frag, s.id, 1);
  });
  return frag;
}
/* task390（主人 2026-11-22 口述）：左栏「归档会话列表」——默认显示最近 10 条（服务端 hidden 顺序尾部=最近归档，最新在前），
   点击行/「恢复」即恢复。定位=项目树之后、TUI 分区之前（TUI 实测 60+ 行，排其后会被挤出一屏外=等于没做）。
   口径：括号里是归档总数（hidden 全量）；列表只列本端内存能解析到的最近 10 条；解析不到的不占位、给「暂不可读」。 */
var ARCHIVE_LIST_MAX = 10;
function renderArchiveSection(ctx: any){
  /* 多选态整区收起：hidden 行本就不参与多选，避免「边选边恢复」语义混乱（方案审 P2-4） */
  if (S.multiSel && S.multiSel.on) return null;
  var total = Object.keys(S.hidden || {}).length;
  var restored = Array.isArray(S.archiveRestored) ? S.archiveRestored.filter(function(x){ return x && x.id }) : [];
  if (!total && !restored.length) return null;
  var frag = document.createDocumentFragment();
  var head = sectFoldHead(total ? ('归档会话列表（' + total + '）') : '归档会话列表', '', 'archive');
  head.title = '归档共 ' + total + ' 条；列表为本端可解析的最近 ' + ARCHIVE_LIST_MAX + ' 条（点击折叠 / 展开）';
  frag.appendChild(head);
  if (!S.archiveSectOpen) return frag;
  /* 产出审 P1-1：刚恢复的会话给「已恢复 · 打开」临时行——历史会话在 focus 视图默认不显示、归档行又已消失；
     打开=二次点击（不自动切会话），刷新后本行消失 */
  restored.toReversed().forEach(function(s){ frag.appendChild(buildRestoredRow(s)) });
  /* P0 防御：hiddenOrder 初值/降级都可能是空数组，任何首屏路径都不得抛 */
  var ordered = Array.isArray(S.hiddenOrder) ? S.hiddenOrder : [];
  /* 产出审 P2-1：只从尾部倒扫、收满 MAX+1 个可解析即停（不逐个 findSessionAnywhere 扫全量 716）；
     根会话先建 id→session 映射，children 兜底交给 findSessionAnywhere */
  var byId = {};
  S.sessions.forEach(function(x){ if (x && x.id) byId[x.id] = x });
  var recent = [];
  for (var i = ordered.length - 1; i >= 0 && recent.length <= ARCHIVE_LIST_MAX; i--){
    var id = ordered[i];
    if (!S.hidden[id]) continue;               /* 已恢复的不算 */
    var s = byId[id] || findSessionAnywhere(id);
    if (s) recent.push(s);                     /* 已彻底删除/不在内存的跳过 */
  }
  if (!recent.length){
    if (total) frag.appendChild(el('div', 'proj-empty', '这些归档会话当前不在本端列表；可刷新页面或让我后台查'));
    return frag;
  }
  recent.slice(0, ARCHIVE_LIST_MAX).forEach(function(s){ frag.appendChild(buildArchiveRow(s)) });
  if (recent.length > ARCHIVE_LIST_MAX){
    frag.appendChild(el('div', 'proj-empty', '仅显示最近 ' + ARCHIVE_LIST_MAX + ' 条（归档共 ' + total + ' 条），更早的可让我在后台找回'));
  }
  return frag;
}
/* task390（产出审 P1-1）：刚恢复行——标题 + 项目名 + 「打开」；打开=显式二次点击，不自动切会话 */
function buildRestoredRow(s: any){
  var ci = el('div', 'item conv-child arch-row arch-restored');
  ci.title = '已恢复 · 点击打开（刷新后本行消失；历史会话左栏默认不显示，需要时再让我打开）';
  ci.appendChild(el('div', 't', '已恢复：' + (s.title || '未命名对话')));
  ci.appendChild(el('span', 'arch-proj', baseName(s.directory) || '未登记'));
  var op = el('button', 'conv-restore', '打开');
  op.title = '打开该会话';
  op.onclick = function(ev){ ev.stopPropagation(); openRestored(s) };
  ci.appendChild(op);
  ci.onclick = function(){ openRestored(s) };
  return ci;
}
function openRestored(s: any){
  try { openSession(s) } catch(e){
    toast('打开失败：' + ((e && e.message) || String(e)), true, 5000);
    return; /* 打开失败保留临时行，入口不丢（产出审 P2-8①） */
  }
  S.archiveRestored = (Array.isArray(S.archiveRestored) ? S.archiveRestored : []).filter(function(x){ return x && x.id !== s.id });
  renderSidebar();
}
/* 归档行：标题 + 项目名 pill + 恢复按钮；整行点击=恢复（归档行点开旧会话无意义，防误开） */
function buildArchiveRow(s: any){
  var ci = el('div', 'item conv-child is-hidden arch-row');
  ci.title = '已归档 · 点击恢复（不打开会话）';
  ci.appendChild(el('div', 't', s.title || '未命名对话'));
  ci.appendChild(el('span', 'arch-proj', baseName(s.directory) || '未登记'));
  var res = el('button', 'conv-restore', '恢复');
  res.title = '取消归档，恢复到会话列表';
  res.onclick = function(ev){ ev.stopPropagation(); restoreSession(s) };
  ci.appendChild(res);
  ci.onclick = function(){ restoreSession(s) };
  return ci;
}
/* task274：会话行图标（路径取自 DSH 图标集 archive-outline / pin-outline / pin-fill，线宽统一 1.3） */
var CONV_ICON_ARCHIVE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1.3" aria-hidden="true"><path d="M13.5 2.5H2.5C1.94772 2.5 1.5 2.94772 1.5 3.5V4.5C1.5 5.05228 1.94772 5.5 2.5 5.5H13.5C14.0523 5.5 14.5 5.05228 14.5 4.5V3.5C14.5 2.94772 14.0523 2.5 13.5 2.5Z" stroke="currentColor"/><path d="M2.5 5.5V13.5C2.5 13.7652 2.60536 14.0196 2.79289 14.2071C2.98043 14.3946 3.23478 14.5 3.5 14.5H12.5C12.7652 14.5 13.0196 14.3946 13.2071 14.2071C13.3946 14.0196 13.5 13.7652 13.5 13.5V5.5" stroke="currentColor"/><path d="M6.5 9.5H9.5" stroke="currentColor"/></svg>';
var CONV_ICON_PIN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1.3" aria-hidden="true"><path d="M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z" stroke="currentColor" stroke-linejoin="round"/><path d="M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z" fill="currentColor"/></svg>';
var CONV_ICON_PIN_ON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1.3" aria-hidden="true"><path d="M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><path d="M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z" fill="currentColor"/></svg>';
/* task282（主人 2026-11-14 口述「这几个图标都不在框框的正当中」）：⋯/＋ 原为字体字符（⋯ 受 ascent/descent 基线影响偏上、全角 ＋ 视觉重心随字体漂移），改几何 SVG 保证格内精确居中 */
var CONV_ICON_DOTS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="3.2" cy="8" r="1.2"/><circle cx="8" cy="8" r="1.2"/><circle cx="12.8" cy="8" r="1.2"/></svg>'; /* 三点 x 对称：3.2/8/12.8，y=8 正中 */
/* task314-fork：分叉图标（DSH 同款分支线+两圆，⋯ 菜单与消息操作行共用） */
var CONV_ICON_FORK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M2 8h4.2"/><path d="M6.2 8 10.4 4.4"/><path d="M6.2 8 10.4 11.6"/><circle cx="11.9" cy="4" r="1.6"/><circle cx="11.9" cy="12" r="1.6"/></svg>';
var CONV_ICON_PLUS = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3.2V12.8M3.2 8H12.8" stroke="currentColor"/></svg>'; /* 加号十字居中：横竖均 3.2~12.8 */
function convSpinEl(){
  var ns = 'http://www.w3.org/2000/svg';
  var svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'conv-spin');
  var g = document.createElementNS(ns, 'g'); g.setAttribute('class', 'spin-motion');
  var t = document.createElementNS(ns, 'circle'); t.setAttribute('cx', '12'); t.setAttribute('cy', '12'); t.setAttribute('r', '9.5'); t.setAttribute('class', 'spin-track');
  var a = document.createElementNS(ns, 'circle'); a.setAttribute('cx', '12'); a.setAttribute('cy', '12'); a.setAttribute('r', '9.5'); a.setAttribute('class', 'spin-arc');
  g.appendChild(t); g.appendChild(a); svg.appendChild(g); return svg;
}
/* task277（主人 2026-11-14 口述）：项目图标换新——原 ▦（网格）被主人嫌「土鳖」，
   改 DSH 同风格 layers 线稿（stroke 1.3/currentColor，与 task274 会话图标集同规格）；页签与项目行共用同一图形 */
var PROJ_ICO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.9 13.8 5 8 8.1 2.2 5 8 1.9Z"/><path d="m2.2 8 5.8 3.1L13.8 8"/><path d="m2.2 11 5.8 3.1L13.8 11"/></svg>';
/* 单条根会话行（多选 / caret / 右键 / 恢复按钮）：精简兜底与已移除分区共用 */
function buildConvRow(s: any, opt?: any){
  opt = opt || {};
  var ledgerSet = opt.ledgerSet || {}, liveSet = opt.liveSet || {};
  var isBusy = !!S.busyBy[s.id];
  var locked = isSessionLocked(s.id, ledgerSet, liveSet);
  var ci = el('div', 'item conv-child' + (S.current && S.current.id === s.id ? ' active' : ''));
  if (opt.hidden) ci.classList.add('is-hidden');
  if (isBusy) ci.classList.add('is-running'); /* task274：运行态（圈圈占左侧槽位，三角悬停让位） */
  if (S.multiSel.on && !opt.hidden){
    if (locked) ci.classList.add('locked');
    if (S.multiSel.ids[s.id]) ci.classList.add('picked');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'conv-check';
    cb.value = s.id;
    cb.checked = !!S.multiSel.ids[s.id];
    cb.disabled = locked;
    ci.appendChild(cb);
    if (locked) ci.title = lockHint(s.id, ledgerSet, liveSet) || '任务执行中，先停止再归档';
  } else if (opt.hasKids){
    /* task154：三角只认「真有子会话」——主人 2026-11-09 定：没有子会话时，选中与否都不画折叠三角。
       原先「只要有任务行也画三角」的分支已退役（点了展开只有任务行，主人明确不要这种三角）。 */
    /* caret 单独点击展开/折叠；点击行本身仍 openSession，行为不变（§4.2） */
    var car = el('span', 'caret' + (opt.open ? ' open' : ''), '▸');
    car.title = '展开 / 折叠子会话';
    car.onclick = function(ev){ ev.stopPropagation(); toggleConvOpen(s.id) };
    ci.appendChild(car);
  }
  /* task60：来源前缀——仅 s.pwa === 0（有 TUI 推断）显示 TUI；1/缺失/异常值一律大管家（原 AI 侧前缀已退役，宁可不标错） */
  var _srcPre = (s.pwa === 0) ? 'TUI · ' : '大管家 · ';
  /* task274：执行中在标题左侧转圈圈（主人 2026-11-14 口述） */
  if (isBusy) ci.appendChild(convSpinEl());
  /* task200：置顶标记紧贴标题文本（只改 DOM 层，不动 s.title——防污染拖拽 ghost 文案） */
  ci.appendChild(el('div', 't', (isPinnedConv(s.id) ? '📌 ' : '') + _srcPre + (s.title || '未命名对话')));
  if (opt.mark) ci.appendChild(el('span', 'conv-mark', opt.mark));
  /* task197：链路模式徽标——主人 2026-11-10 定：模式只在「大管家」会话行标出（TUI 行不标）；
     ☰五角色 / ⛓压扁 / ✊亲自 与底部状态栏同源（S.chain ← /_chain），未知时宁可不标。 */
  if (s.pwa !== 0 && !S.chain.unknown){
    var _cm = chainMeta();
    var _cmEl = el('span', 'conv-mode m-' + S.chain.mode, (S.chain.mode === 'direct' ? _cm.label : _cm.icon + _cm.label));
    _cmEl.title = '当前链路模式 · ' + _cm.label + '：' + _cm.tip + '（全局模式，切换后所有大管家会话同步）';
    ci.appendChild(_cmEl);
  }
  /* task188：大管家 root 行 idle 态文案——压扁/五角色模式下大管家=常驻管家，派完单闲着显示「空闲中」
     （主人 2026-11-10 定）。task190：direct 亲自做模式同样适用——亲自模式下大管家也是常驻管家，
     底下御史（censor）在审核时大管家自己已空闲，应显示「空闲中」而非「已完成」（主人 2026-11-10 定）；
     仅 chain unknown（模式未知）保守回退「已完成」；TUI 会话行（pwa===0，与上方前缀同口径）保持「已完成」=问答回合语义。 */
  /* task219（主人 2026-11-11 报障）：台账首拉未回（TASKS.at===0）时不给结论——原来一律先画「空闲中」，
     而实际可能有子代在跑，属 L-049「未加载就乐观画」的反向假信号。改中性「同步中」，首拉成功/失败均会置 at 并重绘。
     只替换「空闲中」分支，TUI 行（pwa===0）与 chain unknown 的「已完成」语义逐字不动（方案审 P2-1）。 */
  /* task316（主人 2026-11-15 14:27 定）：休息态=值守轮询，左栏 idle 文案用「轮询中」；
     task317（主人 2026-11-15 报障）：只给真正有在途任务在轮询/排队的会话标「轮询中」——
     名下无 active 任务、子树也无在跑会话的行回落「空闲中」，不再整栏蓝色全变轮询中。
     在线态语义不动（真正的空闲）；TUI 行（pwa===0）与 chain unknown 的「已完成」不动。 */
  var _restOn = !!(S.rest && S.rest.on && !S.rest.unknown);
  var _polling = _restOn && !!_pollSids[s.id];
  var _idleTxt = (s.pwa !== 0 && !S.chain.unknown) ? ((TASKS && TASKS.at) ? (_polling ? '轮询中' : '空闲中') : '同步中') : '已完成';
  /* task274：执行中由左侧圈圈承担，右侧不再重复「执行中」文字；其余状态标签口径不变 */
  var _stTxt = _idleTxt;
  var _stCls = ((_idleTxt === '空闲中' || _idleTxt === '轮询中') ? 'off idle' : (_idleTxt === '同步中' ? 'off sync' : 'off done'));
  /* task197（主人 2026-11-10 定）：亲自做模式（direct）下大管家自己就是执行者——手下御史/子代理还在跑
     = 整个任务没收口，此时显「等待中」（≈不可布置新命令）；五角色/压扁模式大管家是常驻调度，仍显「空闲中」。
     判定复用 task188 的 _waitDesc（在跑会话沿父链上溯的祖先集），自身在跑仍优先「执行中」。
     task318（主人 2026-11-15 定）：_waitDesc 扩含「等外部在途行」——state=running 无 runner（活儿派给外部系统
     如 DAG 测试台等结果）的行自身也算「有任务在身」，显示「等待中」而非「空闲中」。 */
  var _waiting = !isBusy && s.pwa !== 0 && !S.chain.unknown && S.chain.mode === 'direct' && !!_waitDesc[s.id];
  if (_waiting){ _stTxt = '等待中'; _stCls = 'off wait' }
  /* task189：会话行上下文百分比（无 assistant 有值消息的会话不渲染 pill，缺源不编数） */
  var _ctxp = convCtxPill(s.id, 'conv-ctx');
  if (_ctxp) ci.appendChild(_ctxp);
  /* task199（主人 2026-11-10 定）：大管家根行旁的「时间/日期」取消（子代理行时间 task198 已删，父行同步清掉）；
     TUI 行是本机对话，保留时间便于辨别新旧——口径与上方前缀同源（pwa===0）。 */
  if (s.pwa === 0) ci.appendChild(el('span', 'm', fmtTime((s.time && (s.time.updated || s.time.created)) || 0)));
  /* task197：状态标签右锚——与子会话行 .conv-sub-st 同列（主人 2026-11-10 报「执行中在最右、空闲中在中间，太奇怪」）
     task274：执行中（isBusy）不再追加文字标签，只留左侧圈圈 */
  if (!isBusy){
    var _stEl = el('span', 'conv-st ' + _stCls, _stTxt);
    if (_waiting) _stEl.title = '等待中：任务在途（子代理执行中 / 等待外部结果如测试台回报），非必要不建议布置新指令';
    ci.appendChild(_stEl);
  }
  if (S.multiSel.on && !opt.hidden){
    ci.onclick = function(){
      if (locked){ alert(lockHint(s.id, ledgerSet, liveSet) || '任务执行中，先停止再归档'); return }
      if (S.multiSel.ids[s.id]) delete S.multiSel.ids[s.id]; else S.multiSel.ids[s.id] = 1;
      updateMultiSelBar();
    };
  } else {
    if (isBusy) ci.title = '任务执行中…';
    ci.onclick = function(){ if (opt.sortMode) return; openSession(s) }; /* task141：仅本行所属项目排序中才拦截（御史 P1-1：禁用 S.sortProj 全局残留量，防「切项目后全体点不开」死角） */
    /* task183：主人定「有子代理在工作时，双击大管家行展开、再双击折叠」——有子会话（hasKids，含工作/已结束）
       的根行双击 = toggleConvOpen（与 caret 同构）；无子行双击无操作；多选/排序/隐藏行不响应；
       双击前会先触发两次 click（openSession 同会话幂等重拉，可接受，勿给单击加延迟）；
       preventDefault + 清 selection 治双击选词闪蓝。 */
    ci.ondblclick = function(ev){
      if (opt.sortMode || S.multiSel.on || opt.hidden || !opt.hasKids) return;
      ev.preventDefault();
      try { var _sel = window.getSelection(); if (_sel && _sel.removeAllRanges) _sel.removeAllRanges(); } catch(e){}
      toggleConvOpen(s.id);
    };
    if (opt.hidden){
      var res = el('button', 'conv-restore', '恢复');
      res.title = '取消归档';
      res.onclick = function(ev){ ev.stopPropagation(); restoreSession(s) };
      ci.appendChild(res);
    } else if (opt.sortMode){
      /* task141：排序模式——每行右侧 ↑↓（手机长按/右键「调整顺序」进入），连点可连续移动 */
      /* task200 P1-1：置顶行冻结排序操作——pin 恒在显示层最前，允许移动只会写出 pin 污染序 */
      if (isPinnedConv(s.id)){
        ci.title = '已置顶，取消置顶后再调整顺序';
      } else {
        var mvUp = el('button', 'sort-mv', '↑');
        mvUp.title = '上移一位';
        mvUp.onclick = function(ev){ ev.stopPropagation(); moveConv(s.id, -1) };
        var mvDn = el('button', 'sort-mv', '↓');
        mvDn.title = '下移一位';
        mvDn.onclick = function(ev){ ev.stopPropagation(); moveConv(s.id, 1) };
        ci.appendChild(mvUp); ci.appendChild(mvDn);
      }
    } else {
      /* task274：悬停出现「⋯ + 归档 + 置顶」三个按钮（⋯ 移动端常驻，⋮ 桌面悬停出现；DSH 截图同款） */
      var acts = el('div', 'conv-acts');
      var cmore = el('button', 'item-more');
      cmore.innerHTML = CONV_ICON_DOTS; /* task282：SVG 三点替代字符 ⋯（几何居中） */
      cmore.title = '更多';
      cmore.onclick = function(ev){ ev.stopPropagation(); var r = cmore.getBoundingClientRect(); showCtxMenu(r.right, r.bottom + 4, s) };
      acts.appendChild(cmore);
      var arc = el('button', 'conv-act conv-act-arc');
      arc.title = '归档'; arc.setAttribute('aria-label', '归档');
      arc.innerHTML = CONV_ICON_ARCHIVE;
      arc.onclick = function(ev){ ev.stopPropagation(); deleteSession(s) };
      acts.appendChild(arc);
      var _pinOn = isPinnedConv(s.id);
      var pnb = el('button', 'conv-act conv-act-pin' + (_pinOn ? ' on' : ''));
      pnb.title = _pinOn ? '取消置顶' : '置顶'; pnb.setAttribute('aria-label', _pinOn ? '取消置顶' : '置顶');
      pnb.innerHTML = _pinOn ? CONV_ICON_PIN_ON : CONV_ICON_PIN;
      pnb.onclick = function(ev){ ev.stopPropagation(); togglePinConv(s) };
      acts.appendChild(pnb);
      ci.appendChild(acts);
      bindConvDrag(ci, s); /* task141：PC 按住左键直接拖动排序 */
      /* task326（主人 2026-11-15）：退役「手机长按 550ms 直进排序模式」——它与 bindItemMenu 的
         长按 520ms 弹菜单叠绑同一行，两个长按定时器先后都触发 → 菜单和 ↑↓ 排序模式一起出现。
         手机进排序改走：长按弹菜单 →「调整顺序」（入口未丢，多一跳）；PC 拖拽/菜单入口不变。 */
    }
    bindItemMenu(ci, function(x, y){ showCtxMenu(x, y, s) });
  }
  return ci;
}

/* P1-4：只隐藏分组标题（数据/右键/排序不动），对话全部保留
   task237：`DAG AI Chat` 一并撤出——主人要看得见这个项目名（只撤 path 隐藏不够，标题空着等于一行白条）。 */
var HIDE_GROUP_TITLES = { '日常': 1 };
/* task171（主人 2026-11-10 定）：聚焦视图下「非当前项目」点开只展开今天的会话，
   历史（11-9、11-4 等）不再随点标题刷屏；判定按本地日期取 time.created。 */
function isTodayTs(ts: number): boolean{
  if (!ts) return false;
  var d = new Date(ts), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}
function todayButlerConv(s: any): boolean{
  if (!s || isHiddenId(s.id) || !isButlerSession(s)) return false;
  /* task332（主人 2026-11-16 报障「新建对话后原先的对话框没了」）：
     只认 time.created 会在跨午夜/隔天续聊时把活跃会话判成「非今天」——
     当前根一旦切走（新建对话/切会话），它就从左栏蒸发。
     口径改为「今天创建 或 今天聊过（time.updated）」：
     昨天以前聊完不动的死会话依旧隐藏（task171/247 口径不变；task342 搜索入口已退役）。 */
  var c = (s.time && s.time.created) || 0, u = (s.time && s.time.updated) || 0;
  return isTodayTs(c) || isTodayTs(u);
}
function renderProjRow(proj: any, ico: unknown, openKey: string, isImport: boolean, ledgerSet: any, liveSet: any, grouped: any, ctx: any){
  var frag = document.createDocumentFragment();
  var convs = projConvs(proj.path, proj.name);
  var visible = [], i;
  var _focusProj = false; /* task161：本项目是否=当前根所在项目（决定聚焦精简/强制展开；其余项目退化为普通折叠行） */
  if (ctx.focus && ctx.root){
    /* 精简视图：当前根所在项目分组常显；task139：该项目下其它大管家根会话一并并入本项目分组
       （原「大管家会话（N）」独立分区退役——同一个工作区的会话不再拆两处，主人 2026-11-09 定）
       task161：非当前根所在项目不再 return null——退化为普通折叠行，保证新登记项目立刻出现在左栏 */
      if (ctx.root.virtual){
        /* 根缺失兜底：当前会话升为虚拟根，挂在它自己的项目分组下（§4.4） */
        if (sessInProj(proj, ctx.focusSess)){ _focusProj = true; visible = [ctx.focusSess]; }
        else for (i = 0; i < convs.length; i++){ if (todayButlerConv(convs[i])) visible.push(convs[i]) } /* task171：非当前项目只列今天的会话 */
      } else {
        /* task140：当前根不再强制置顶——按 convs 原顺序过滤（点哪行哪行不跳位，主人 2026-11-09 定） */
        for (i = 0; i < convs.length; i++){ if (convs[i].id === ctx.root.id){ visible = [convs[i]]; break } }
        if (visible.length) _focusProj = true;
        else for (i = 0; i < convs.length; i++){ if (todayButlerConv(convs[i])) visible.push(convs[i]) } /* task171：非当前项目只列今天的会话 */
      }
    if (_focusProj){
      /* 同项目其它大管家根：只认正证据 isButlerSession（butlerRoots），当前根不重复 */
      var pushed = {}, butlerId = {};
      for (i = 0; i < visible.length; i++){ if (visible[i] && visible[i].id) pushed[visible[i].id] = 1 }
      var brs = butlerRoots();
      for (i = 0; i < brs.length; i++){
        if (!brs[i] || brs[i].id === ctx.root.id || isHiddenId(brs[i].id)) continue;
        /* task247（主人 2026-11-12 手机报障「小 DJ 有很多个」）：只并入今天的会话。
           task242 把 isButlerSession 放宽到 pwa!==0 后，11-04~11-10 的 pwa 缺失旧空会话也被当成
           大管家根，全被并进当前项目 → 当前项目一展开就是十几条「大管家·新对话」刷屏。
           历史会话默认隐藏（与 task171 非当前项目口径一致；task342 搜索入口已退役）；当前根不在此列，永远保留。 */
        if (sessInProj(proj, brs[i]) && todayButlerConv(brs[i])) butlerId[brs[i].id] = 1;
      }
      /* task140：visible 重建为「按 convs（创建时间序）全量过滤」——当前根与其它大管家根同在一条时间线上，不因选中而提前 */
      var visibleSet = {};
      for (i = 0; i < visible.length; i++){ if (visible[i] && visible[i].id) visibleSet[visible[i].id] = visible[i] }
      var visibleOrdered = [];
      for (i = 0; i < convs.length; i++){
        var _c = convs[i];
        if (!_c || isHiddenId(_c.id)) continue;
        if (visibleSet[_c.id]) visibleOrdered.push(_c);
        else if (butlerId[_c.id] && !pushed[_c.id]){ pushed[_c.id] = 1; visibleOrdered.push(_c) }
      }
      visible = visibleOrdered;
      _focusRendered = true;
    }
  } else {
    /* task171：聚焦视图「无当前会话」态同样只列今天的会话——历史（11-9/11-4）不再默认铺满左栏（task342：搜索入口退役） */
    for (i = 0; i < convs.length; i++){ if (todayButlerConv(convs[i])) visible.push(convs[i]) }
  }
  /* task141：手动排序优先（项目内 conv-order）；task147：未列出的会话（=保存排序后新建）排最前——
     visible 原序即 created 降序，稳定排序下表外新会话按 created 序整体置顶（新建对话沉底修复，主人 2026-11-09 定）。
     task200：pin 只在显示层叠加——先算逻辑序（base 排序）写 _lastConvOrder（重排基准不受 pin 污染），再 pin 排序得显示序 */
  var _ord = S.convOrder[openKey];
  var _pins = convPins();
  if ((_ord && _ord.length) || _pins.length){
    var _pos = {};
    if (_ord && _ord.length) _ord.forEach(function(id, idx){ _pos[id] = idx });
    var _logical = visible.toSorted(function(a, b){
      var pa = _pos[a.id], pb = _pos[b.id];
      if (pa == null && pb == null) return 0;
      if (pa == null) return -1;
      if (pb == null) return 1;
      return pa - pb;
    });
    S._lastConvOrder[openKey] = _logical.map(function(x){ return x.id }); /* 逻辑序快照（pin 前，重排基准） */
    if (_pins.length){
      var _pinSet = {};
      _pins.forEach(function(id){ _pinSet[id] = 1 });
      visible = _logical.toSorted(function(a, b){
        var pa = _pinSet[a.id] ? 0 : 1, pb = _pinSet[b.id] ? 0 : 1;
        return pa - pb; /* 组内保持逻辑序（sort 稳定） */
      });
    } else visible = _logical;
  } else {
    S._lastConvOrder[openKey] = visible.map(function(x){ return x.id }); /* 排序模式 moveConv / 完成保存的基准（无表即原序） */
  }
  /* task143：筛选器已删，过滤退化为恒等；展开态按 焦点视图/手动折叠 计算（task342：搜索态退役） */
  var filtered = visible;
  var expanded = (ctx.focus && ctx.root) ? (_focusProj ? S.focusProjOpen[openKey] !== false : !!S.focusProjOpen[openKey]) : !!S.projOpen[openKey]; /* task168：聚焦视图非当前项目按会话级 focusProjOpen（默认收起）；task247：当前项目也吃 focusProjOpen——折叠箭头要真的能折叠，展开由 openSession 进项目时兜底置 true */
  /* task171（主人 2026-11-10 定）：聚焦视图下数字必须与展开后实际行数严格一致——
     当前项目=当前对话树条数，非当前项目=今天的会话条数（之前 task170 只数大管家的全量 35 条，
     与「点开只列今天」后的行数不符，主人截图「3 对话却列一大串」就是这么来的）。
     空态同口径只列今天（task342：搜索入口退役，历史会话不再走全量搜索态）。 */
  var count = visible.length; /* task171：数字恒等于展开后实际行数（§4.8） */
  var byLid = (grouped && grouped.byLid) || {};
  var it = el('div', 'item');
  /* task236-fu2：新建项目后 2.6s 内该行高亮（每帧按 _flashProj 补类，防补帧/SSE 重绘把类冲掉） */
  if (_flashProj && _flashProj.name && _flashProj.name === proj.name && Date.now() < _flashProj.until) it.classList.add('proj-new');
  it.appendChild(el('span', 'caret' + (expanded ? ' open' : ''), '▸'));
  var _icoEl = el('span', 'proj-ico');
  _icoEl.innerHTML = ico; /* task277：图标已改为 SVG 线稿常量（PROJ_ICO_SVG），innerHTML 挂载 */
  it.appendChild(_icoEl);
  if (HIDE_GROUP_TITLES[proj.name]) it.appendChild(el('div', 't', ''));
  else it.appendChild(el('div', 't', proj.name));
  /* task141：排序模式下项目行右侧「N 对话」变为「完成」按钮（主人指定位置） */
  if (S.sortProj === openKey){
    var _done = el('button', 'sort-done', '完成');
    _done.title = '保存顺序并退出排序';
    _done.onclick = function(ev){ ev.stopPropagation(); exitSortMode(openKey) };
    it.appendChild(_done);
  } else {
    /* task276（主人 2026-11-14 口述）：「项目右边也加一个加号，这个加号是加对话的」——
       位置=「N 对话」左边，点一下直接在本项目新建对话（不用再右键进菜单）；常驻显示，多选态隐藏（与 ⋯ 一致）。 */
    if (!S.multiSel.on){
      var _padd = el('button', 'proj-add');
      _padd.innerHTML = CONV_ICON_PLUS; /* task282：SVG 加号替代全角字符 ＋（几何居中） */
      _padd.title = '在此项目新建对话';
      _padd.onclick = function(ev){ ev.stopPropagation(); newTask(proj.name) };
      _padd.oncontextmenu = function(ev){ ev.preventDefault(); ev.stopPropagation() }; /* 点右键不弹项目菜单 */
      _padd.addEventListener('touchstart', function(ev){ ev.stopPropagation() }, { passive: true }); /* 防长按冒泡触发 bindItemMenu 的项目长按菜单 */
      it.appendChild(_padd);
    }
    it.appendChild(el('span', 'm', count + ' 对话'));
  }
  it.title = (HIDE_GROUP_TITLES[proj.name] ? proj.name + ' · ' : '') + '拖动可排序 · 点击展开 / 折叠 · ＋ 新建对话 · 右键：删除项目 / 改名字';
  var more = el('button', 'item-more');
  more.innerHTML = CONV_ICON_DOTS; /* task282：SVG 三点替代字符 ⋯（几何居中） */
  more.title = '更多';
  more.onclick = function(ev){ ev.stopPropagation(); var r = more.getBoundingClientRect(); showProjectMenu(r.right, r.bottom + 4, proj.name, isImport) };
  if (!S.multiSel.on) it.appendChild(more);
  it.onclick = function(){
    if (ctx.focus && ctx.root){
      /* task247（主人 2026-11-12 报「点击左边的折叠也点了没用」）：当前项目也真正折叠/展开。
         旧 task172 为防「刷新回跳」让当前项目恒展开、标题点击直接 return，折叠箭头成了死键。
         展开兜底改由 openSession 写 focusProjOpen=true（同根切子会话也覆盖），点标题只翻转不重置。 */
      S.focusProjOpen[openKey] = !S.focusProjOpen[openKey]; saveFocusProjOpen();
      if (S.sortProj && S.sortProj !== openKey) exitSortMode(S.sortProj); /* task141 连带保留：折叠别的项目时退出其排序 */
      renderSidebar();
      return;
    }
    toggleProjOpen(openKey);
  };
  bindItemMenu(it, function(x, y){ showProjectMenu(x, y, proj.name, isImport) });
  bindProjDrag(it, openKey);
  frag.appendChild(it);
  if (expanded){
    /* task54 B：会话树——父节点=根会话（默认折叠），任务行与子会话同层挂其下（§4.1/§4.4） */
    var items = [];
    filtered.forEach(function(s){
      var units = byLid[s.id] || []; /* task106：byLid 值已由单值改为数组（迁移行可与原生行并存） */
      var cached = Object.prototype.hasOwnProperty.call(S.children, s.id);
      var kids = cached ? (S.children[s.id] || []) : null;
      /* childCount 来自 server 回填（仅已请求目录口径）；取回空数组后以缓存为准、撤 caret */
      var hasKids = cached ? kids.length > 0 : (Number(s.childCount) > 0);
      /* task342：搜索态退役——q 命中过滤整段删除，所有行按折叠态渲染
         （task187：多选不再强制折叠——convOpen 原样保留） */
      var open = !!S.convOpen[s.id];
      items.push({ s: s, units: units, hasKids: hasKids, open: open, mark: (ctx.focus && _focusProj && ctx.root.virtual) ? '上层已归档' : '' }); /* task161 P0/P1（御史）：_focusProj 短路——empty 态 ctx.root=null 不崩、virtual 非当前项目不错标 */
    });
    if (!items.length){
      frag.appendChild(el('div', 'proj-empty', '还没有对话，右键项目可新建'));
    } else {
      items.forEach(function(itm){
        var s = itm.s;
        var ci = buildConvRow(s, { hasKids: itm.hasKids, open: itm.open, mark: itm.mark, ledgerSet: ledgerSet, liveSet: liveSet, sortMode: (S.sortProj === openKey) });
        frag.appendChild(ci);
        /* task187：多选下也渲染已展开的子树（保持原样）；子行无复选框，勾选仍只覆盖根会话 */
        if (itm.open){
          /* task164：任务行渲染层退役（navTasksRow 删净）——任务态统一看右栏任务面板 */
          if (itm.hasKids) appendChildRows(frag, s.id, 1);
        }
      });
    }
  }
  return frag;
}
window.CONV_ICON_ARCHIVE=CONV_ICON_ARCHIVE; window.CONV_ICON_PIN=CONV_ICON_PIN; window.CONV_ICON_PIN_ON=CONV_ICON_PIN_ON; window.CONV_ICON_DOTS=CONV_ICON_DOTS; window.CONV_ICON_FORK=CONV_ICON_FORK; window.CONV_ICON_PLUS=CONV_ICON_PLUS; window.PROJ_ICO_SVG=PROJ_ICO_SVG; window.HIDE_GROUP_TITLES=HIDE_GROUP_TITLES; window.isHiddenId=isHiddenId; window.sessInProj=sessInProj; window.findSessionAnywhere=findSessionAnywhere; window.resolveCurrentRoot=resolveCurrentRoot; window.ensureCurrentTreeOpen=ensureCurrentTreeOpen; window._pollSids=_pollSids; window.computePollSids=computePollSids; window.buildSidebarCtx=buildSidebarCtx; window.renderSidebar=renderSidebar; window.renderFocusFallback=renderFocusFallback; window.sectFoldHead=sectFoldHead; window.renderTuiSection=renderTuiSection; window.convSpinEl=convSpinEl; window.buildConvRow=buildConvRow; window.isTodayTs=isTodayTs; window.todayButlerConv=todayButlerConv; window.renderProjRow=renderProjRow;

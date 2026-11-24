/* @module board @order 29 @职责 任务看板渲染/排序/拖拽 @提供 TASK_ORDER_LABEL TASK_FILTER_LABEL _taskFilter _taskOrderEditing _taskOrderSnapshot _taskOrderDirty _dragTaskKey _tusSig setTaskManualPosFromIds applyTaskConvOrderFromCache refreshTaskConvOrder setTaskOrderMode enterTaskManual cancelTaskManual taskManualOrderKeys saveTaskManual setTaskFilter taskFilterPass moveTaskUnit dragTaskTo clearTaskDropMarks taskCardAtPoint bindTaskDrag bindTaskTouchDrag renderTaskToolbar runningUnits taskUnits loadPanel taskUnitsSig renderTaskUnits taskCardSubline renderTaskUnitCard renderTasks renderTasksDegraded @依赖 - @依赖运行期 setTaskManualPos S taskOrderMode ORDERS _taskManualPos toast stageOf isMobile taskUnitAt collectLiveTasks TASKS ledgerInTask taskModel loadDiff renderWatch loadPricingPanel loadFiles navTaskRoleLabel childRoleClass navTaskRoleKey stageLabel fmtDur fmtAgo markLedgerState openSession loadTaskLedger @DOM契约 - @严格模式 是 @全局占用 TASK_ORDER_LABEL TASK_FILTER_LABEL _taskFilter _taskOrderEditing _taskOrderSnapshot _taskOrderDirty _dragTaskKey _tusSig setTaskManualPosFromIds applyTaskConvOrderFromCache refreshTaskConvOrder setTaskOrderMode enterTaskManual cancelTaskManual taskManualOrderKeys saveTaskManual setTaskFilter taskFilterPass moveTaskUnit dragTaskTo clearTaskDropMarks taskCardAtPoint bindTaskDrag bindTaskTouchDrag renderTaskToolbar runningUnits taskUnits loadPanel taskUnitsSig renderTaskUnits taskCardSubline renderTaskUnitCard renderTasks renderTasksDegraded @源行 ui/index.html L7471-L8108 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task156 §3.3：排序工具条 + 手动模式（保存/取消/拖拽；服务端复用 /_conv-order 的 __tasks__ 键） ---------- */
var TASK_ORDER_LABEL = { active: '活跃优先', recent: '最近更新', manual: '手动' };
var TASK_FILTER_LABEL = { all: '全部', running: '在跑', ended: '已结束' };
var _taskFilter = 'all';          /* all|running|ended：只过滤显示，不改排序 */
var _taskOrderEditing = false;    /* 手动编辑中才出 ↑↓ / 保存 / 取消 */
var _taskOrderSnapshot = null;    /* 进入手动前的 {mode,pos} 快照，取消即回滚 */
var _taskOrderDirty = false;      /* 手动顺序被改过：回读服务端时不许覆盖用户正在改的顺序 */
var _dragTaskKey = '';
/* 服务端 __tasks__ 顺序 / key 数组 → 位置表（坏数据静默丢弃，空数组=清除） */
function setTaskManualPosFromIds(ids){
  var m = {};
  if (Array.isArray(ids)){
    var n = 0;
    ids.forEach(function(k){
      if (typeof k === 'string' && k && k.length <= 128 && !Object.prototype.hasOwnProperty.call(m, k)){ m[k] = n; n++ }
    });
  }
  setTaskManualPos(m);
  return m;
}
/* 启动/回读：复用页面已有的 conv-order 缓存（loadConvOrder 已把 __tasks__ 一起拿回） */
function applyTaskConvOrderFromCache(){
  var ids = (S.convOrder && S.convOrder['__tasks__']) || [];
  if (!Array.isArray(ids)) return false;
  setTaskManualPosFromIds(ids);
  if (taskOrderMode() === 'manual' && S.tab === 'tasks' && S.current) renderTaskUnits(taskUnits(), true);
  return true;
}
/* 进入手动时补拉一次服务端顺序；用户已改序（dirty）则不覆盖 */
function refreshTaskConvOrder(){
  return fetch('/_conv-order').then(function(r){
    if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
    return r.json();
  }).then(function(d){
    var map = (d && d.order && typeof d.order === 'object' && !Array.isArray(d.order)) ? d.order : null;
    if (!map) return false;
    var ids = Array.isArray(map['__tasks__']) ? map['__tasks__'] : null;
    if (!ids) return false;
    if (S.convOrder) S.convOrder['__tasks__'] = ids.slice();
    if (!_taskOrderEditing || !_taskOrderDirty){
      setTaskManualPosFromIds(ids);
      if (taskOrderMode() === 'manual' && S.tab === 'tasks' && S.current) renderTaskUnits(taskUnits(), true);
    }
    return true;
  }).catch(function(){ return false });
}
function setTaskOrderMode(m){
  if (!ORDERS[m]) m = 'active';
  if (m === 'manual'){ enterTaskManual(); return }
  if (_taskOrderEditing){ /* 编辑中直接切别的模式 = 放弃本次改动（与取消同义，但不再提示） */
    if (_taskOrderSnapshot) setTaskManualPos(_taskOrderSnapshot.pos);
    _taskOrderEditing = false; _taskOrderSnapshot = null; _taskOrderDirty = false;
  }
  try { localStorage.setItem('littledj.taskOrderMode', m) } catch(e){}
  if (S.tab === 'tasks') renderTaskUnits(taskUnits(), true);
}
function enterTaskManual(){
  if (_taskOrderEditing){ if (S.tab === 'tasks') renderTaskUnits(taskUnits(), true); return }
  var prevMode = taskOrderMode();
  var snapPos = {};
  Object.keys(_taskManualPos || {}).forEach(function(k){ snapPos[k] = _taskManualPos[k] });
  _taskOrderSnapshot = { mode: prevMode, pos: snapPos };
  /* 初始化位置：优先沿用已保存的 __tasks__ 顺序；缓存里没有的单元按当前显示顺序追加 */
  var cached = (S.convOrder && Array.isArray(S.convOrder['__tasks__'])) ? S.convOrder['__tasks__'] : [];
  var order = [], seen = {};
  var push = function(k){ if (typeof k === 'string' && k && !seen[k]){ seen[k] = 1; order.push(k) } };
  cached.forEach(push);
  taskUnits().toSorted(ORDERS[prevMode] || ORDERS.active).forEach(function(u){ push(u.key) });
  setTaskManualPosFromIds(order);
  _taskOrderEditing = true; _taskOrderDirty = false;
  try { localStorage.setItem('littledj.taskOrderMode', 'manual') } catch(e){}
  if (S.tab === 'tasks') renderTaskUnits(taskUnits(), true);
  refreshTaskConvOrder();
  toast('手动排序：点 ↑↓ 或拖动卡片调整，「保存」后生效', false, 3000);
}
function cancelTaskManual(){
  var snap = _taskOrderSnapshot;
  if (snap){
    setTaskManualPos(snap.pos);
    try { localStorage.setItem('littledj.taskOrderMode', snap.mode || 'active') } catch(e){}
  } else {
    try { localStorage.removeItem('littledj.taskOrderMode') } catch(e){}
  }
  _taskOrderEditing = false; _taskOrderSnapshot = null; _taskOrderDirty = false;
  if (S.tab === 'tasks') renderTaskUnits(taskUnits(), true);
  toast('已取消，顺序回滚到进入手动前', false, 2400);
}
function taskManualOrderKeys(units){
  return (units || []).toSorted(ORDERS.manual).map(function(u){ return u && u.key }).filter(function(k){
    return typeof k === 'string' && k.length > 0 && k.length <= 128;
  });
}
function saveTaskManual(){
  var ids = taskManualOrderKeys(taskUnits()).slice(0, 500);
  return fetch('/_conv-order', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projKey: '__tasks__', ids: ids })
  }).then(function(r){
    if (!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
    return r.json();
  }).then(function(d){
    if (d && d.ok === false) throw new Error(d.error || '保存失败');
    if (S.convOrder) S.convOrder['__tasks__'] = ids.slice();
    _taskOrderEditing = false; _taskOrderSnapshot = null; _taskOrderDirty = false;
    toast('已保存', false, 2000);
    if (S.tab === 'tasks') renderTaskUnits(taskUnits(), true);
    return true;
  }).catch(function(e){
    /* 保存失败：不改本地模式、保留当前手动顺序，只报错 */
    toast('顺序保存失败：' + ((e && e.message) || '网络异常'), true);
    return false;
  });
}
function setTaskFilter(f){
  if (!TASK_FILTER_LABEL[f]) f = 'all';
  if (f === _taskFilter) return;
  _taskFilter = f;
  if (S.tab === 'tasks') renderTaskUnits(taskUnits(), true);
}
function taskFilterPass(u){
  if (_taskFilter === 'running') return !!u && (u.stage || stageOf(u)) !== 'ended';
  if (_taskFilter === 'ended') return !!u && (u.stage || stageOf(u)) === 'ended';
  return true;
}
/* 上移/下移：只在当前可见（筛选后）列表里换位，隐藏项位置不动 */
function moveTaskUnit(key, delta){
  if (!key || !delta) return;
  var all = taskUnits().toSorted(ORDERS.manual);
  var visible = all.filter(taskFilterPass);
  var vi = -1;
  visible.forEach(function(u, i){ if (u.key === key) vi = i });
  if (vi < 0) return;
  var tj = vi + delta;
  if (tj < 0 || tj >= visible.length) return;
  var targetKey = visible[tj].key;
  var i = -1, j = -1;
  all.forEach(function(u, idx){ if (u.key === key) i = idx; if (u.key === targetKey) j = idx });
  if (i < 0 || j < 0 || i === j) return;
  var tmp = all[i]; all[i] = all[j]; all[j] = tmp;
  setTaskManualPosFromIds(all.map(function(u){ return u.key }));
  _taskOrderDirty = true;
  renderTaskUnits(taskUnits(), true);
}
function dragTaskTo(fromKey, toKey, after){
  if (!fromKey || !toKey || fromKey === toKey) return;
  var order = taskManualOrderKeys(taskUnits());
  var fi = order.indexOf(fromKey);
  if (fi < 0) return;
  order.splice(fi, 1);
  var ti = order.indexOf(toKey);
  if (ti < 0) order.push(fromKey); else order.splice(after ? ti + 1 : ti, 0, fromKey);
  setTaskManualPosFromIds(order);
  _taskOrderDirty = true;
  renderTaskUnits(taskUnits(), true);
}
function clearTaskDropMarks(){
  Array.prototype.slice.call(document.querySelectorAll('#rightBody .tcard.drop-before, #rightBody .tcard.drop-after')).forEach(function(n){
    n.classList.remove('drop-before', 'drop-after');
  });
}
function taskCardAtPoint(x, y){
  var node: any = document.elementFromPoint ? document.elementFromPoint(x, y) : null;
  while (node && !(node.classList && node.classList.contains('tcard'))) node = node.parentNode;
  if (node && node.classList && node.classList.contains('tcard')) return node;
  var cards = document.querySelectorAll('#rightBody .tcard');
  for (var i = 0; i < cards.length; i++){
    var r = cards[i].getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) return cards[i];
  }
  return null;
}
/* PC 拖拽：复用左栏 ghost 思路；拖到目标上半/下半=插到前/后 */
function bindTaskDrag(card, u){
  if (isMobile()) return;
  card.draggable = true;
  card.addEventListener('dragstart', function(ev){
    _dragTaskKey = u.key; card.classList.add('dragging');
    if (ev.dataTransfer){
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', u.key) } catch(e){}
      try {
        var ghost = el('div', 'drag-ghost', u.title || '任务');
        document.body.appendChild(ghost);
        ev.dataTransfer.setDragImage(ghost, 14, 14);
        setTimeout(function(){ if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost) }, 0);
      } catch(e2){}
    }
  });
  card.addEventListener('dragend', function(){
    _dragTaskKey = ''; card.classList.remove('dragging'); clearTaskDropMarks(); renderTaskUnits(taskUnits(), true);
  });
  card.addEventListener('dragover', function(ev){
    if (!_dragTaskKey || _dragTaskKey === u.key) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    var r = card.getBoundingClientRect();
    clearTaskDropMarks();
    card.classList.add(ev.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  });
  card.addEventListener('dragleave', function(ev){
    if (!card.contains(ev.relatedTarget)) card.classList.remove('drop-before', 'drop-after');
  });
  card.addEventListener('drop', function(ev){
    if (!_dragTaskKey || _dragTaskKey === u.key) return;
    ev.preventDefault(); ev.stopPropagation();
    var r = card.getBoundingClientRect();
    var after = ev.clientY > r.top + r.height / 2;
    var from = _dragTaskKey; _dragTaskKey = '';
    card.classList.remove('drop-before', 'drop-after');
    dragTaskTo(from, u.key, after);
  });
}
/* 手机长按 550ms 进入拖动（与左栏排序一致）：移动到目标卡上/下半区，松手落位 */
function bindTaskTouchDrag(card, h, u){
  if (!isMobile()) return;
  var t0x = 0, t0y = 0, timer = null, active = false, target = null, after = false;
  var clearTimer = function(){ if (timer){ clearTimeout(timer); timer = null } };
  h.addEventListener('touchstart', function(ev){
    if (!_taskOrderEditing) return;
    if (ev.target && ev.target.tagName === 'BUTTON') return;
    var t = ev.touches && ev.touches[0]; if (!t) return;
    t0x = t.clientX; t0y = t.clientY; target = null; after = false;
    clearTimer();
    timer = setTimeout(function(){
      timer = null; active = true; _dragTaskKey = u.key; card.classList.add('dragging');
    }, 550);
  }, { passive: true });
  h.addEventListener('touchmove', function(ev){
    var t = ev.touches && ev.touches[0]; if (!t) return;
    if (timer){
      if (Math.abs(t.clientX - t0x) > 10 || Math.abs(t.clientY - t0y) > 10){ clearTimer() }
      return;
    }
    if (!active) return;
    if (ev.preventDefault) ev.preventDefault();
    var hit = taskCardAtPoint(t.clientX, t.clientY);
    if (!hit || hit === card){ clearTaskDropMarks(); target = null; return }
    var r = hit.getBoundingClientRect();
    after = t.clientY > r.top + r.height / 2;
    clearTaskDropMarks();
    hit.classList.add(after ? 'drop-after' : 'drop-before');
    target = hit;
  }, { passive: false });
  var end = function(){
    clearTimer();
    if (!active) return;
    active = false; _dragTaskKey = '';
    var tk = (target && target.dataset) ? target.dataset.tkey : '';
    card.classList.remove('dragging'); clearTaskDropMarks();
    if (tk && tk !== u.key) dragTaskTo(u.key, tk, after);
    else renderTaskUnits(taskUnits(), true);
  };
  h.addEventListener('touchend', end);
  h.addEventListener('touchcancel', end);
}
function renderTaskToolbar(){
  var bar = el('div', 'taskbar');
  bar.appendChild(el('span', 'taskbar-lb', '排序：'));
  var sel = el('select', 'taskbar-sel');
  ['active', 'recent', 'manual'].forEach(function(m){
    var o = el('option', null, TASK_ORDER_LABEL[m]);
    o.value = m;
    if (taskOrderMode() === m) o.selected = true;
    sel.appendChild(o);
  });
  sel.value = taskOrderMode();
  sel.title = '任务排序方式（选择「手动」进入手动排序）';
  sel.onchange = function(){ setTaskOrderMode(sel.value) };
  bar.appendChild(sel);
  var fg = el('div', 'taskbar-filter');
  ['all', 'running', 'ended'].forEach(function(f){
    var fb = el('button', 'taskbar-fbtn' + (_taskFilter === f ? ' on' : ''), TASK_FILTER_LABEL[f]);
    fb.title = '筛选：' + TASK_FILTER_LABEL[f] + '（只过滤显示，不改排序）';
    fb.onclick = function(ev){ if (ev) ev.stopPropagation(); setTaskFilter(f) };
    fg.appendChild(fb);
  });
  bar.appendChild(fg);
  bar.appendChild(el('span', 'taskbar-sp', ''));
  var bm = el('button', 'taskbar-btn' + (_taskOrderEditing || taskOrderMode() === 'manual' ? ' on' : ''), '⇅ 手动');
  if (_taskOrderEditing){
    bm.title = '手动排序中（↑↓ / 拖拽）';
    bm.onclick = function(ev){ if (ev) ev.stopPropagation() };
  } else {
    bm.title = '进入手动排序（↑↓ / 拖拽）';
    bm.onclick = function(ev){ if (ev) ev.stopPropagation(); enterTaskManual() };
  }
  bar.appendChild(bm);
  if (_taskOrderEditing){
    var bs = el('button', 'taskbar-btn taskbar-save', '保存');
    bs.title = '保存手动顺序';
    bs.onclick = function(ev){ if (ev) ev.stopPropagation(); saveTaskManual() };
    bar.appendChild(bs);
    var bc = el('button', 'taskbar-btn', '取消');
    bc.title = '回滚到进入手动前的顺序';
    bc.onclick = function(ev){ if (ev) ev.stopPropagation(); cancelTaskManual() };
    bar.appendChild(bc);
  }
  return bar;
}
/* task334（主人拍板）：「已结束自动折叠段」废除——已结束单元置底灰显常驻可见，绝不允许背着主人自动隐藏；
   waiting（op=hold 显式等待中）常驻显示「🟡 等待中」胶囊。折叠族函数（TASK_ENDED_GRACE_MS/isRecentEnded/
   isFoldedEnded/taskEndedOpen/setTaskEndedOpen）已随本任务退役删除。 */
/* task54：在跑口径唯一出口——任务口径内且 state==='running'（与 /_watch 的 tasks.running 同源），含实时真值单元 */
function runningUnits(){
  /* task156 S6：在跑口径统一走 stage==='active'（quiet/stalled/ended 不计入；真在跑由 live 真值保底） */
  return taskUnits(true).filter(function(u){ return (u.stage || stageOf(u)) === 'active' });
}
function taskUnits(full?){
  var live = collectLiveTasks();
  /* task156 S6b：退役旧「把 live.key 改写成 ledger:<id> 前缀 + live 循环见前缀 return」的字符串前缀去重 hack；
     改由 taskModel() 按 sid 建表显式合并（同 sid 台账+实时 → 一条 source='both'，无 sid 台账 → ledger:<id> 单列）。
     本函数只做「对外 shape 兼容」映射：taskModel 不产出 lid/level/ownerSid，这里按 sid/台账行回填，供分组/标记/归属。 */
  var rowById = {}, rowBySid = {};
  (TASKS.list || []).forEach(function(t){
    if (!t || !ledgerInTask(t)) return;
    rowById[t.id] = t;
    if (t.runnerSession && !rowBySid[t.runnerSession]) rowBySid[t.runnerSession] = t;
  });
  var ownerBySid = {}, liveByKey = {};
  live.forEach(function(l){
    if (!l) return;
    if (l.sid && l.ownerSid) ownerBySid[l.sid] = l.ownerSid;
    if (l.key) liveByKey[l.key] = l;
  });
  var units = taskModel(TASKS.list || [], live).map(function(u){
    /* 无 sid 台账行的合法键 = taskModel 的兜底键 ledger:<id>（非去重 hack），据此回填 lid */
    var lid = (u.sid && rowBySid[u.sid] && rowBySid[u.sid].id)
      || (!u.sid && u.key.indexOf('ledger:') === 0 ? u.key.slice('ledger:'.length) : '');
    var row = (u.sid ? rowBySid[u.sid] : null) || (lid ? rowById[lid] : null) || null;
    return {
      key: u.key,
      title: u.title || '(未命名任务)',
      state: u.state || '',
      stage: u.stage,
      phase: u.phase || (row && row.phase) || '',
      progress: u.progress || '',
      artifacts: Array.isArray(u.artifacts) ? u.artifacts : [],
      level: (row && row.level) || '',
      sid: u.sid || '',
      lid: lid,
      ownerSid: u.sid ? (ownerBySid[u.sid] || '') : ((liveByKey[u.key] && liveByKey[u.key].ownerSid) || ''),
      runnerAgent: u.runnerAgent || '',
      markable: !!u.markable,
      overridden: !!u.overridden,
      ended: !!u.ended,
      live: !!u.live,
      updated: Number(u.updated) || 0,
      at: Number(u.at) || Number(u.updated) || 0,
      stale: u.stale || '',
      staleMinutes: (u.staleMinutes == null ? null : u.staleMinutes),
      elapsed: Number(u.elapsed) || 0,
      /* task156 S5：卡片次行需要最新一句（taskModel 已从 /_tasks 行取 lastEventText） */
      lastEventText: u.lastEventText || '',
      /* task334 P2-2：overrideNote 透传到卡（waiting 胶囊「等待中·短语」真实链路可达） */
      overrideNote: u.overrideNote || '',
      /* task119：ETA 三字段行内透传（/_tasks 行由 proxy applyOverrides 按 runnerSession 套好；overdue 只在行 running 时计） */
      etaMinutes: Number(u.etaMinutes) || 0,
      etaDeadline: Number(u.etaDeadline) || 0,
      etaOverdueMin: Number(u.etaOverdueMin) || 0,
      source: u.source
    };
  });
  /* task119：live-only 单元（无台账行）查 TASKS.etas 映射按自身 state 本地判（服务端对无行条目恒 0，防永久误报） */
  units.forEach(function(u){
    if (u.lid) return; /* 有台账行：eta 三字段已由台账透传 */
    var em = (TASKS.etas || {})[u.sid];
    if (em && Number(em.minutes) > 0) {
      u.etaMinutes = Number(em.minutes) || 0;
      u.etaDeadline = Number(em.deadline) || 0;
      u.etaOverdueMin = ((u.state === 'running' || u.state === 'queued') && u.etaDeadline > 0 && Date.now() >= u.etaDeadline)
        ? Math.floor((Date.now() - u.etaDeadline) / 60000) : 0;
    }
  });
  units.sort(function(a, b){ return (b.updated || 0) - (a.updated || 0) });
  /* C-2：可标记（台账锁定）条目置顶（仅作排序基线；右栏最终顺序由 §3.2 ORDERS 决定） */
  /* task54：已结束（完成/中断/失败）一律置底，不再挤占在跑可视区 */
  units.sort(function(a, b){
    var ea = a.ended ? 1 : 0, eb = b.ended ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return (a.markable === b.markable ? 0 : (a.markable ? -1 : 1));
  });
  /* task156 §3.2：面板静默截断已退役——已结束单元改由折叠段收纳 */
  return units;
}
// 台账兜底轮询（T09）：SSE 漏事件时 10s 自刷台账（原每卡 4s 拉子会话消息的轮询链已退役）
function loadPanel(){
  // 面板加载隔离：右栏异常绝不阻断/抹掉中栏对话显示
  try {
    if (S.tab === 'diff') loadDiff(); else if (S.tab === 'tasks') renderTasks(); else if (S.tab === 'watch') renderWatch(); else if (S.tab === 'pricing') loadPricingPanel(); else loadFiles();
  } catch (e) {}
}
/* P0-3：任务单元轻量指纹，数据无变化且列表在位则跳过整块重建（防轮询周期性重画/展开态被重置） */
var _tusSig = '';
function taskUnitsSig(units){
  var sigNow = Date.now();
  return String((S.current && S.current.id) || '') + '#' + (TASKS.degraded ? 1 : 0) + '#' + taskOrderMode() + '#' + _taskFilter + '#' + (_taskOrderEditing ? 1 : 0) + '#' + units.map(function(u){
    var st = stageOf(u);
    return [u.key, st, u.state, u.updated || 0, u.phase || '', u.progress || '', u.stale || '', u.staleMinutes == null ? '' : u.staleMinutes, (u.artifacts || []).join(','), u.etaDeadline || 0, u.etaOverdueMin || 0, (u.etaDeadline > 0 && sigNow < u.etaDeadline && st !== 'waiting') ? Math.ceil((u.etaDeadline - sigNow) / 60000) : 0, u.overrideNote || ''].join('|'); /* task176-fu1：末位=剩余分钟（未到期）；task334：折叠 r/f 桶随折叠段退役；waiting 行剩余分钟恒 0（暂停计时，防每分钟整板重建）+overrideNote 入指纹（短语变化驱动重绘） */
  }).join(';');
}
function renderTaskUnits(units?, force?){
  var b = $('#rightBody');
  var allUnits = Array.isArray(units) ? units : [];
  var sig = taskUnitsSig(allUnits);
  if (!force && sig === _tusSig && b.querySelector('.tclist')) return;
  _tusSig = sig;
  var prevTop = b.scrollTop;
  var keepOpen = {};
  Array.prototype.slice.call(b.querySelectorAll('.tcard.open')).forEach(function(n){ keepOpen[n.dataset.tkey] = true });
  b.replaceChildren();
  b.appendChild(renderTaskToolbar());
  /* §3.2：先归一化 stage/at；§3.3：筛选只影响显示，不影响排序 */
  allUnits.forEach(function(u){ if (!u.stage) u.stage = stageOf(u); if (!u.at) u.at = u.updated || 0 });
  /* task254：排队位次——同项目 queued 按 queueAt 排序，位次锚在单元上（stageLabel 显示 #N） */
  var qByDir = {};
  allUnits.forEach(function(u){ if (u && u.state === 'queued'){ var d = String(u.queueDirectory || ''); (qByDir[d] = qByDir[d] || []).push(u) } });
  Object.keys(qByDir).forEach(function(d){
    qByDir[d].sort(function(a, b){ return (Number(a.queueAt) || 0) - (Number(b.queueAt) || 0) });
    qByDir[d].forEach(function(u, i){ u.queuePos = i + 1; u.queueLen = qByDir[d].length });
  });
  var visUnits = allUnits.filter(taskFilterPass);
  var _qn = allUnits.filter(function(u){ return u.state === 'queued' }).length;
  var head = el('div', 'emptyhint', '按枢机 / 任务聚合 · ' + visUnits.length + ' 个单元' + (_taskFilter === 'all' ? '' : '（' + TASK_FILTER_LABEL[_taskFilter] + '）') + (_qn ? ' · ⏳ 排队 ' + _qn : ''));
  head.style.padding = '0 0 8px';
  b.appendChild(head);
  if (!visUnits.length){
    b.appendChild(el('div', 'emptyhint', allUnits.length
      ? ('当前筛选（' + TASK_FILTER_LABEL[_taskFilter] + '）下没有任务单元。')
      : '还没有任务单元。<br>派单后任务台账与子会话会在这里按枢机聚合。'));
    b.scrollTop = 0;
    return;
  }
  /* §3.2：按唯一比较器排序；task334：已结束单元不再折叠——全部常驻（置底灰显），绝不允许自动隐藏 */
  var cmp = ORDERS[taskOrderMode()] || ORDERS.active;
  var shown = visUnits.slice();
  shown.sort(cmp);
  var list = el('div', 'tclist');
  /* 分组只影响视觉标题：按全局排序结果顺序渲染，同组出现中断时重挂标题，绝不重排单元 */
  var gInfo = {}, gOrder = [];
  shown.forEach(function(u){
    var g = u.lid || '';
    if (!gInfo[g]){ gInfo[g] = { id: g, title: '', n: 0 }; gOrder.push(g) }
    gInfo[g].n++;
  });
  gOrder.forEach(function(g){
    if (!g) return;
    var t = (S.sessions || []).filter(function(s){ return s.id === g })[0];
    gInfo[g].title = (t && t.title) || (TASKS.list || []).filter(function(x){ return x.id === g })[0] ? ((TASKS.list || []).filter(function(x){ return x.id === g })[0].title || '') : '';
  });
  var lastG = null, firstUnit = true;
  shown.forEach(function(u){
    var g = u.lid || '';
    if (firstUnit || g !== lastG){
      var gh = el('div', 'tcgroup-h');
      gh.appendChild(el('span', 'tcgroup-t', (g ? (gInfo[g].title || '主会话 ' + String(g).slice(-6)) : '未归属枢机（仅实时）')));
      gh.appendChild(el('span', 'tcgroup-n', gInfo[g].n + ' 个任务'));
      list.appendChild(gh);
    }
    lastG = g; firstUnit = false;
    list.appendChild(renderTaskUnitCard(u, keepOpen));
  });
  b.appendChild(list);
  b.scrollTop = prevTop;
}
/* task156 S5：次行一句话——最新进展（lastEventText 截 60 字）优先，其次进度，最后阶段文案 */
function taskCardSubline(u){
  var txt = String(u.lastEventText || '').trim();
  if (!txt) txt = String(u.progress || '').trim();
  if (txt && txt.length > 60) txt = txt.slice(0, 60) + '…';
  if (txt) return txt;
  return String(u.phase || '');
}
function renderTaskUnitCard(u, keepOpen){
  var stage = u.stage || stageOf(u);
  var card = el('div', 'tcard' + (stage === 'active' ? ' active' : '') + (stage === 'ended' ? ' ended' : '') + (stage === 'waiting' ? ' waiting' : '')); /* task334：waiting 常驻琥珀胶囊，不折叠不隐藏 */
  card.dataset.tkey = u.key;
  /* 头部：[角色徽标] 标题 …… [状态胶囊] */
  var h = el('div', 'tcard-h');
  h.appendChild(el('span', 'caret', '▶'));
  var rlabel = navTaskRoleLabel(u);
  if (rlabel) h.appendChild(el('span', 'tcard-role ' + childRoleClass(navTaskRoleKey(u)), rlabel));
  h.appendChild(el('span', 'tt', u.title));
  /* task176：头部超时红标（仅超时态；未到期不重复折叠区既有「预计 X 分钟」行） */
  if (!u.ended && Number(u.etaOverdueMin) > 0){
    h.appendChild(el('span', 'tcard-eta-bad', '超' + u.etaOverdueMin + 'm·待查验'));
  }
  h.appendChild(el('span', 'tcard-st stage-' + stage, stageLabel(stage, u)));
  /* §3.3：手动模式每卡右侧 ↑↓（点按上下移；PC 亦支持拖拽，手机长按 550ms 拖动） */
  if (_taskOrderEditing){
    var ctrl = el('span', 'tcard-ctrl');
    var mvUp = el('button', 'sort-mv', '↑');
    mvUp.title = '上移一位';
    mvUp.onclick = function(ev){ if (ev) ev.stopPropagation(); moveTaskUnit(u.key, -1) };
    var mvDn = el('button', 'sort-mv', '↓');
    mvDn.title = '下移一位';
    mvDn.onclick = function(ev){ if (ev) ev.stopPropagation(); moveTaskUnit(u.key, 1) };
    ctrl.appendChild(mvUp); ctrl.appendChild(mvDn);
    h.appendChild(ctrl);
  }
  card.appendChild(h);
  /* 次行：最新一句（截 60 字）或进度 */
  var sub = taskCardSubline(u);
  if (sub) card.appendChild(el('div', 'tcard-sub', sub));
  /* 折叠区（点卡展开）：阶段 / ETA/超时 / 进度 / 产物 / 按钮组 */
  var body = el('div', 'tcard-b');
  var stageLine = [u.phase || '', (u.live ? '实时' : '台账')];
  if (u.elapsed) stageLine.push('已用 ' + fmtDur(u.elapsed));
  stageLine.push('更新 ' + fmtAgo(u.updated));
  body.appendChild(el('div', 'tcard-meta', '阶段：' + stageLine.filter(Boolean).join(' · ')));
  /* task119：ETA 展示（终态不渲染）；超时态独立警示行（文案禁判死：已超预计·待查验） */
  var etaOn = !u.ended && Number(u.etaMinutes) > 0 && (u.state !== 'waiting'); /* task334 P2-4：waiting 暂停计时——不渲染倒计时（服务端已恒 0 超时，展示层同步停表） */
  var overdue = Number(u.etaOverdueMin) > 0;
  if (etaOn){
    var rem = (u.etaDeadline > 0 && Date.now() < u.etaDeadline) ? Math.max(1, Math.ceil((u.etaDeadline - Date.now()) / 60000)) : 0; /* task176-fu1：倒计时（rem 已入 taskUnitsSig 指纹） */
    body.appendChild(el('div', 'tcard-meta', '预计 ' + u.etaMinutes + ' 分钟' + (rem > 0 ? ' · 剩 ' + rem + 'm' : '') + (overdue ? ' · 已超预计 ' + u.etaOverdueMin + 'm·待查验' : '')));
  }
  /* task126 F5'/角色级：本任务全链角色 ETA 明细（按 rootId 聚合） */
  if (!u.ended){
    var chain = [];
    var etasAll = (TASKS && TASKS.etas) || {};
    Object.keys(etasAll).forEach(function(k){
      var ev = etasAll[k] || {};
      if (ev.rootId && u.lid && ev.rootId === u.lid) chain.push({ sid: k, role: ev.role || '-', title: ev.title || '', minutes: Number(ev.minutes) || 0, overdueMin: Number(ev.overdueMin) || 0, deadline: Number(ev.deadline) || 0 });
    });
    chain.sort(function(a, b){ return a.deadline - b.deadline });
    if (chain.length > 1 || (chain.length === 1 && (!etaOn || chain[0].sid !== u.sid))) {
      var parts = chain.map(function(c){
        return (c.role ? c.role + ' ' : '') + c.minutes + 'm' + (c.overdueMin > 0 ? '（超' + c.overdueMin + 'm）' : '');
      });
      body.appendChild(el('div', 'tcard-meta', 'ETA：' + parts.join(' · ')));
    }
  }
  body.appendChild(el('div', 'tcard-sec', '进度'));
  body.appendChild(el('div', null, u.progress || '（未登记进度）'));
  body.appendChild(el('div', 'tcard-sec', '要交付的产物'));
  if (u.artifacts && u.artifacts.length){
    u.artifacts.forEach(function(a){ body.appendChild(el('span', 'tcard-art', a)) });
  } else {
    body.appendChild(el('div', 'tcard-empty', u.sid ? '未登记产物，可打开子会话查看结果' : '未登记产物'));
  }
  /* 按钮组：顺延 / 标记完成 / 标记中断 / 撤销 / 打开子会话 */
  var acts = el('div', 'tcard-acts');
  /* task158：mkBtn 必须在卡片函数作用域内定义——原写在 `if (u.lid)` 块里，
     导致 live-only 单元（有 sid、无 lid）走到「打开子会话」时 mkBtn 未定义，
     任务页签直接抛 Uncaught TypeError（主人 2026-11-09 截图） */
  var mkBtn = function(txt){ var b = el('button', 'acard-open', txt); b.style.marginTop = '0'; return b };
  if (u.lid){
    if (u.markable){
      if (u.sid && overdue){
        var bEta = mkBtn('顺延 10m');
        bEta.onclick = function(ev){ if (ev) ev.stopPropagation(); markLedgerState(u.sid, 'eta', { etaMinutes: 10 }) };
        acts.appendChild(bEta);
      }
      var bDone = mkBtn('标记完成');
      bDone.onclick = function(ev){ if (ev) ev.stopPropagation();
        if (confirm('把「' + u.title + '」标记为完成？若它实际还在执行，台账将不再锁定它。')) markLedgerState(u.lid, 'done');
      };
      var bInt = mkBtn('标记中断');
      bInt.onclick = function(ev){ if (ev) ev.stopPropagation();
        if (confirm('把「' + u.title + '」标记为中断？若它实际还在执行，台账将不再锁定它。')) markLedgerState(u.lid, 'interrupt');
      };
      acts.appendChild(bDone); acts.appendChild(bInt);
    } else if (u.state === 'waiting'){
      /* task334 P1-3：等待中必须有 UI 出口——否则 hold 后只能 API 解除，等待中成死状态 */
      var bUn = mkBtn('解除等待');
      bUn.title = '解除等待中标记，恢复为进行中';
      bUn.onclick = function(ev){ if (ev) ev.stopPropagation();
        if (confirm('解除「' + u.title + '」的等待中标记？任务将恢复进行中状态。')) markLedgerState(u.lid, 'reopen');
      };
      acts.appendChild(bUn);
    } else if (u.overridden){
      var bRe = mkBtn('撤销标记');
      bRe.onclick = function(ev){ if (ev) ev.stopPropagation(); markLedgerState(u.lid, 'reopen') };
      acts.appendChild(bRe);
    }
  }
  if (u.sid){
    var bOpen = mkBtn('打开子会话');
    bOpen.title = '打开该子代理会话';
    bOpen.onclick = function(ev){
      if (ev) ev.stopPropagation();
      openSession({ id: u.sid, directory: u._dir || (S.current && S.current.directory) || '', title: u.title + ' · 子代理' });
    };
    acts.appendChild(bOpen);
  }
  if (acts.children.length) body.appendChild(acts);
  card.appendChild(body);
  h.onclick = function(){ card.classList.toggle('open') };
  if (_taskOrderEditing){ bindTaskDrag(card, u); bindTaskTouchDrag(card, h, u) }
  if (keepOpen[u.key]) card.classList.add('open');
  return card;
}
function renderTasks(){
  if (S.tab !== 'tasks') return;
  var b = $('#rightBody');
  if (!S.current){ b.innerHTML = '<div class="emptyhint">先选一个对话</div>'; return }
  loadTaskLedger(false);
  renderTaskUnits(taskUnits());
  renderTasksDegraded(b);
}
/* 台账降级横幅：先删后插，重复渲染不叠加 */
function renderTasksDegraded(b?){
  var old = document.getElementById('tasksDegradedBanner');
  if (old) old.remove();
  if (!TASKS.degraded) return;
  var hint = TASKS.degradedHint || '未知原因';
  var reason = TASKS.degradedReason || '未知原因';
  var banner = el('div', 'emptyhint', '⚠ 任务台账降级：' + hint + '（' + reason + '）· 列表可能不全，稍后自动重试');
  banner.id = 'tasksDegradedBanner';
  banner.style.textAlign = 'left';
  banner.style.padding = '8px 10px';
  banner.style.color = '#e8c87a';
  b.insertBefore(banner, b.firstChild);
}
window.TASK_ORDER_LABEL=TASK_ORDER_LABEL; window.TASK_FILTER_LABEL=TASK_FILTER_LABEL; window._taskFilter=_taskFilter; window._taskOrderEditing=_taskOrderEditing; window._taskOrderSnapshot=_taskOrderSnapshot; window._taskOrderDirty=_taskOrderDirty; window._dragTaskKey=_dragTaskKey; window._tusSig=_tusSig; window.setTaskManualPosFromIds=setTaskManualPosFromIds; window.applyTaskConvOrderFromCache=applyTaskConvOrderFromCache; window.refreshTaskConvOrder=refreshTaskConvOrder; window.setTaskOrderMode=setTaskOrderMode; window.enterTaskManual=enterTaskManual; window.cancelTaskManual=cancelTaskManual; window.taskManualOrderKeys=taskManualOrderKeys; window.saveTaskManual=saveTaskManual; window.setTaskFilter=setTaskFilter; window.taskFilterPass=taskFilterPass; window.moveTaskUnit=moveTaskUnit; window.dragTaskTo=dragTaskTo; window.clearTaskDropMarks=clearTaskDropMarks; window.taskCardAtPoint=taskCardAtPoint; window.bindTaskDrag=bindTaskDrag; window.bindTaskTouchDrag=bindTaskTouchDrag; window.renderTaskToolbar=renderTaskToolbar; window.runningUnits=runningUnits; /* task334：折叠族五导出（TASK_ENDED_GRACE_MS/isRecentEnded/isFoldedEnded/taskEndedOpen/setTaskEndedOpen）随函数退役一并删除 */ window.taskUnits=taskUnits; window.loadPanel=loadPanel; window.taskUnitsSig=taskUnitsSig; window.renderTaskUnits=renderTaskUnits; window.taskCardSubline=taskCardSubline; window.renderTaskUnitCard=renderTaskUnitCard; window.renderTasks=renderTasks; window.renderTasksDegraded=renderTasksDegraded;

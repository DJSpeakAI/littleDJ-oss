/* @module actions @order 10 @职责 会话置顶/多选/排序/删除/重命名/派生 @提供 bindConvDrag convSortKeyOf convPins isPinnedConv togglePinConv dragConvTo enterSortMode moveConv exitSortMode appendChildRows appendChildRow enterMultiSel exitMultiSel selAllLabel renderMultiSelBar updateMultiSelBar forkSession showCtxMenu hideCtxMenu showProjectMenu refreshProjectsView deleteProject askRenameProject askRenameSession archiveNoAsk deleteSession clearCurrentAfterRemove restoreSession deleteSessionsBulk @依赖 - @依赖运行期 isMobile _dragConv _dragAt clearDropMarks dragReleaseRender projOpenKeyForDir S renderSidebar toast findSessionAnywhere saveProjOpen fetchChildren isHiddenId isLeafChildRole toggleConvOpen childStatusInfo convSpinEl childRoleClass childRoleKey childRoleLabel childMismatchAgent CHILD_TITLE_SUFFIX_RE childTitleText TASKS convCtxPill openSession fetchLedgerNow api _localNewSids newTask loadProjects setView openModal closeModal renderTitle lockHint ledgerActiveSids liveRunningSids hideSessions clearActiveButlerIf renderQuote syncSseBanner restoreSessions hiddenOrderAdd hiddenOrderRemove draftStash autoGrow renderAtts holdBarSync isSessionLocked @DOM契约 - @严格模式 是 @全局占用 bindConvDrag convSortKeyOf convPins isPinnedConv togglePinConv dragConvTo enterSortMode moveConv exitSortMode appendChildRows appendChildRow enterMultiSel exitMultiSel selAllLabel renderMultiSelBar updateMultiSelBar forkSession showCtxMenu hideCtxMenu showProjectMenu refreshProjectsView deleteProject askRenameProject askRenameSession archiveNoAsk deleteSession clearCurrentAfterRemove restoreSession deleteSessionsBulk @源行 ui/index.html L2748-L3295 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task141：会话手动排序模式（右键「调整顺序」/ 手机长按进入；项目行右侧「完成」保存退出） ---------- */
/* PC 拖拽排序（HTML5 DnD，移动端自动无效）：拖到目标行上半/下半=插到前/后，松手即保存 */
function bindConvDrag(ci: any, s: any): void{
  if (isMobile()) return; /* 手机走长按进入排序模式；不启用 HTML5 DnD，避免长按被拖拽接管 */
  ci.draggable = true;
  ci.addEventListener('dragstart', function(ev){
    _dragConv = s.id; _dragAt = Date.now(); /* task145 P0-A */
    ci.classList.add('dragging');
    if (ev.dataTransfer){
      ev.dataTransfer.effectAllowed = 'move';
      try { ev.dataTransfer.setData('text/plain', s.id) } catch(e){}
      /* task140b：自绘深色拖拽图，替代浏览器默认的惨白快照虚影 */
      try {
        var ghost = el('div', 'drag-ghost', ((s.pwa === 0) ? 'TUI · ' : '大管家 · ') + (s.title || '未命名对话'));
        document.body.appendChild(ghost);
        ev.dataTransfer.setDragImage(ghost, 14, 14);
        setTimeout(function(){ if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost) }, 0);
      } catch(e2){}
    }
  });
  ci.addEventListener('dragend', function(){ _dragConv = ''; _dragAt = 0; ci.classList.remove('dragging'); clearDropMarks(); dragReleaseRender() });
  ci.addEventListener('dragover', function(ev){
    if (!_dragConv || _dragConv === s.id) return;
    _dragAt = Date.now(); /* task145 P0-C：dragover 心跳（同上） */
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    var r = ci.getBoundingClientRect();
    clearDropMarks();
    ci.classList.add(ev.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  });
  ci.addEventListener('dragleave', function(ev){
    if (!ci.contains(ev.relatedTarget)) ci.classList.remove('drop-before', 'drop-after');
  });
  ci.addEventListener('drop', function(ev){
    if (!_dragConv || _dragConv === s.id) return;
    ev.preventDefault();
    ev.stopPropagation();
    var r = ci.getBoundingClientRect();
    var after = ev.clientY > r.top + r.height / 2;
    var from = _dragConv;
    _dragConv = '';
    ci.classList.remove('drop-before', 'drop-after');
    dragConvTo(from, s.id, after);
  });
}
/* task146：会话排序列归属——TUI 会话独立成区（固定键 __tui__），其余按项目；跨区不排序 */
function convSortKeyOf(sess: any): string{
  if (!sess) return '';
  if (sess.pwa === 0) return '__tui__';
  return projOpenKeyForDir(sess.directory) || '';
}
/* ---------- task200：会话置顶（复用 /_conv-order 的 __pins__ 键，跨设备持久化；显示层 pin first，逻辑序不动） ---------- */
function convPins(): string[]{
  var p = S.convOrder['__pins__'];
  return Array.isArray(p) ? p : [];
}
function isPinnedConv(id: string): boolean{ return !!id && convPins().indexOf(id) >= 0 }
/* 置顶=纯显示层排序（_lastConvOrder 与 convOrder 均不写 pin 序）；乐观更新，失败 toast 与 dragConvTo 口径一致 */
function togglePinConv(sess: any): void{
  if (!sess || !sess.id) return;
  var pins = convPins().slice();
  var i = pins.indexOf(sess.id);
  if (i >= 0) pins.splice(i, 1); else pins.push(sess.id);
  S.convOrder['__pins__'] = pins;
  renderSidebar();
  fetch('/_conv-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projKey: '__pins__', ids: pins }) })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(function(){ toast(i >= 0 ? '已取消置顶' : '已置顶', false, 1800) })
    .catch(function(){ toast('置顶保存失败（本次仅临时生效）', true) });
}
function dragConvTo(fromId: string, toId: string, after: boolean): void{
  if (!fromId || !toId || fromId === toId) return;
  /* task200 P1-1：置顶行冻结拖动排序——pin 恒在显示层最前，拖动只会写出 pin 污染序 */
  if (isPinnedConv(fromId) || isPinnedConv(toId)){ toast('已置顶的会话不支持拖动排序，先取消置顶', true, 2800); return }
  var sFrom = findSessionAnywhere(fromId), sTo = findSessionAnywhere(toId);
  if (!sFrom || !sTo) return;
  var pk = convSortKeyOf(sFrom);
  if (!pk){ toast('这条会话没有归属项目，无法排序', true, 2600); return }
  if (pk !== convSortKeyOf(sTo)){ toast('TUI 会话与项目会话分开排序，不能互拖', true, 2600); return } /* task146 P1-1：不再静默 */
  var list = (S.convOrder[pk] && S.convOrder[pk].length) ? S.convOrder[pk].slice() : (S._lastConvOrder[pk] || []).slice();
  var fi = list.indexOf(fromId);
  if (fi < 0){
    /* task147：fromId 在排序表外（=新建会话）——按最近渲染序补齐基准再定位（与 moveConv 同构），新建会话可直接拖转正 */
    list = (S._lastConvOrder[pk] || []).slice();
    fi = list.indexOf(fromId);
  }
  if (fi < 0){ toast('这条会话不在排序表内，先右键「调整顺序」再拖', true, 2800); return } /* task146 P1-1：不再静默 */
  list.splice(fi, 1);
  var ti = list.indexOf(toId);
  if (ti < 0) list.push(fromId); else list.splice(after ? ti + 1 : ti, 0, fromId);
  S.convOrder[pk] = list;
  S.sortProj = null; /* 拖拽排序即有效果，退出任何排序模式 */
  renderSidebar();
  fetch('/_conv-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projKey: pk, ids: list }) })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(function(){ toast('顺序已保存', false, 2000) })
    .catch(function(){ toast('顺序保存失败（本次仅临时生效）', true) });
}
function enterSortMode(projKey: string): void{
  if (!projKey) return;
  if (S.multiSel.on) exitMultiSel();
  if (S.sortProj === projKey){ return }
  if (S.sortProj) exitSortMode(S.sortProj); /* task146 / task141 复审 P1：切项目进排序前先保存上一个项目的改动，防悬空丢失 */
  S.sortProj = projKey;
  if (S.projOpen && projKey !== '__tui__'){ S.projOpen[projKey] = true; saveProjOpen() } /* 排序时保证分组展开可见；task146 P2：__tui__ 非项目键，不写展开态 */
  renderSidebar();
  toast(projKey === '__tui__' ? '排序模式（TUI 会话）：点 ↑ ↓ 调整，「完成」保存' : '排序模式：点 ↑ ↓ 调整位置，「完成」保存', false, 3200);
}
function moveConv(sid: string, delta: number): void{
  var pk = S.sortProj; if (!pk) return;
  /* task200 P1-1：置顶行冻结 ↑↓（与拖动同口径） */
  if (isPinnedConv(sid)){ toast('已置顶的会话不支持上移下移，先取消置顶', true, 2600); return }
  var list = (S.convOrder[pk] && S.convOrder[pk].length) ? S.convOrder[pk].slice() : (S._lastConvOrder[pk] || []).slice();
  var i = list.indexOf(sid);
  if (i < 0){
    /* 会话尚未进顺序表：先按最近渲染顺序补齐再定位 */
    list = (S._lastConvOrder[pk] || []).slice();
    i = list.indexOf(sid);
  }
  var j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  var t = list[i]; list[i] = list[j]; list[j] = t;
  S.convOrder[pk] = list; /* 内存态先行（退出时统一落盘） */
  renderSidebar();
}
function exitSortMode(projKey: string): void{
  var pk = projKey || S.sortProj; if (!pk) return;
  var ids = (S.convOrder[pk] && S.convOrder[pk].length) ? S.convOrder[pk].slice() : (S._lastConvOrder[pk] || []).slice();
  S.sortProj = null;
  renderSidebar();
  if (!ids.length){ toast('顺序已退出（无可保存项）', false, 2000); return }
  fetch('/_conv-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projKey: pk, ids: ids }) })
    .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(function(){ toast('顺序已保存', false, 2200) })
    .catch(function(e){ toast('顺序保存失败：' + (e && e.message ? e.message : '网络异常'), true) });
}
/* level：1=直接子（0px）、2=孙（12px）、3=曾孙（24px）；超过实测最大深度 3 不再下钻 */function appendChildRows(container, pid, level){
  var lvlCls = 'conv-sub lv' + Math.min(level, 3);
  if (S.childrenErr[pid]){
    var fe = el('div', lvlCls + ' failed', S.childrenErr[pid]);
    fe.title = '点击重试';
    fe.onclick = function(ev){ ev.stopPropagation(); delete S.childrenErr[pid]; fetchChildren(pid) };
    container.appendChild(fe);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(S.children, pid)){
    if (!S.childrenLoading[pid]) fetchChildren(pid);
    container.appendChild(el('div', lvlCls + ' loading', '加载中…'));
    return;
  }
  /* task70 F1-1：已有旧数组时先照旧渲染（不塌成占位行），后台刷新回填后再重绘 */
  if (S.childrenDirty[pid] && !S.childrenLoading[pid]) fetchChildren(pid);
  var kids = S.children[pid] || [];
  /* task56：软删的子会话不渲染（当前会话例外，绝不因 hidden 消失）；task342：搜索态退役，命中筛删除 */
  var list = kids.filter(function(c){ return !isHiddenId(c.id) || (S.current && S.current.id === c.id) });
  list.forEach(function(c){ appendChildRow(container, c, level) });
}
function appendChildRow(container: HTMLElement, c: any, level: number): void{
  var lvl = Math.min(level, 3);
  var row = el('div', 'conv-sub lv' + lvl + (S.current && S.current.id === c.id ? ' active' : ''));
  row.dataset.sid = c.id;
  var subCached = Object.prototype.hasOwnProperty.call(S.children, c.id);
  var subKids = subCached ? (S.children[c.id] || []) : null;
  /* task179：caret 判据「已知看数据、未知看角色」——已知子会话非空才画；未加载时叶子角色
     （御史/执笔/子代理）一律不画。旧判据 !subCached 乐观画 ⇒ 御史行每次渲染都冒假 ▸，
     点开一次消失、刷新又回来（主人 2026-11-10 反复报障，task154 修的是另一处任务行假三角）。
     叶子若真有子会话数据（subCached 且非空）仍照常给 caret，不丢展开能力。 */
  var canExpand = level < 3 && (subCached ? subKids.length > 0 : !isLeafChildRole(c.agent));
  if (canExpand) row.classList.add('has-caret'); /* task299：可展开行才让出 caret 槽（绝对定位在 8px），叶子御史行不留占位空槽 */
  var open = !!S.convOpen[c.id]; /* task342：搜索态退役，qDeep 强制展开删除 */
  if (canExpand){
    var car = el('span', 'conv-sub-caret', open ? '▾' : '▸');
    car.onclick = function(ev){ ev.stopPropagation(); toggleConvOpen(c.id) };
    row.appendChild(car);
  }
  /* task274：子会话行运行中同样在左侧转圈圈（右侧不再重复「执行中」）；task299：圈圈绝对定位，标签列恒在 30px 不跳动 */
  var st = childStatusInfo(c);
  if (st.cls === 'live'){ row.classList.add('is-running'); row.appendChild(convSpinEl()) }
  row.appendChild(el('span', 'conv-sub-tag ' + childRoleClass(childRoleKey(c)), childRoleLabel(childRoleKey(c))));
  /* task184：派单角色丢失红标——主徽章仍按后缀（派单意图），红标表事实（实际执行器） */
  var _mm = childMismatchAgent(c);
  if (_mm){
    var _wantM = CHILD_TITLE_SUFFIX_RE.exec(String(c.title || ''));
    var _mt = el('span', 'conv-sub-tag mismatch', '⚠实际' + _mm);
    _mt.title = '派单角色 ' + String((_wantM && _wantM[1]) || '').trim() + ' 未生效：实际执行器 ' + _mm + '（全工具），权限边界已破。新建会话会由 task184 自动核对闸处置；历史会话仅标记。';
    row.appendChild(_mt);
  }
  row.appendChild(el('span', 'conv-sub-t', childTitleText(c.title)));
  /* task176 / fu1 倒计时：ETA 徽标（数据源 TASKS.etas，task126 角色级 ETA）。终态不显示——
     终态判据用 childStatusInfo 文案前缀（已完成 / 已中断）；task190 起 cls 不再全空（已中断=inter、
     疑似中断=stall），故仍只按文案前缀判、不按 cls 判。未到期=剩余分钟倒计时（fu1 起剩余分钟已入
     navSidebarSig 指纹，每分钟驱动一次左栏重绘跳变）；过期即红（不足 1 分钟也显超1m）；
     无 deadline 兜底静态预计总时长 */
  var ev = (TASKS && TASKS.etas && TASKS.etas[c.id]) || null;
  if (ev && Number(ev.minutes) > 0 && st.txt.indexOf('已完成') !== 0 && st.txt.indexOf('已中断') !== 0){
    var dl = Number(ev.deadline) || 0;
    var od = (dl > 0 && Date.now() >= dl) ? Math.max(1, Math.floor((Date.now() - dl) / 60000)) : 0;
    var etaTxt;
    if (od > 0) etaTxt = '超' + od + 'm·待查验';
    else if (dl > 0) etaTxt = '⏱剩' + Math.max(1, Math.ceil((dl - Date.now()) / 60000)) + 'm';
    else etaTxt = '⏱预计' + (Number(ev.minutes) || 0) + 'm';
    var etaEl = el('span', 'conv-sub-eta' + (od > 0 ? ' eta-bad' : ''), etaTxt);
    if (dl > 0){
      var dd = new Date(dl);
      etaEl.title = '预计 ' + (Number(ev.minutes) || 0) + ' 分钟，截止 ' + (dd.getHours() < 10 ? '0' : '') + dd.getHours() + ':' + (dd.getMinutes() < 10 ? '0' : '') + dd.getMinutes();
    }
    row.appendChild(etaEl);
  }
  /* task189：子会话行上下文百分比（全部角色：小管家/枢机/执笔/御史…） */
  var _cp = convCtxPill(c.id, 'conv-sub-ctx');
  if (_cp) row.appendChild(_cp);
  if (st.cls !== 'live') row.appendChild(el('span', 'conv-sub-st' + (st.cls ? ' ' + st.cls : ''), st.txt));
  row.onclick = function(){ if (S.sortProj || S.multiSel.on) return; openSession(c) }; /* task141 御史 P2-2：排序模式下子会话行同拦（与根行一致）；task187：多选时子行仅展示（保持展开原样），点击不切会话防误触退出勾选现场 */
  container.appendChild(row);
  if (open && canExpand) appendChildRows(container, c.id, level + 1);
}


function enterMultiSel(): void{
  if (S.multiSel.on) return;
  hideCtxMenu();
  S.multiSel.on = true; S.multiSel.ids = {}; S.multiSel.busy = false;
  /* 进入多选不因强刷失败阻断；成功时 fetchLedgerNow 内部会自行重绘 */
  fetchLedgerNow().catch(function(){});
  renderSidebar();
}
function exitMultiSel(): void{
  if (S.multiSel.busy) return; /* P1-2：删除执行期间禁止退出/复位 */
  S.multiSel.on = false; S.multiSel.ids = {}; S.multiSel.busy = false;
  renderSidebar();
}
function selAllLabel(): string{
  /* 二态文案唯一口径：只统计当前可见可选项（锁定项 disabled 天然排除） */
  var sel = $$('#navBody .conv-check').filter(function(cb){ return !cb.disabled });
  var allChecked = sel.length > 0 && sel.every(function(cb){ return cb.checked });
  return allChecked ? '取消全选' : '全选';
}
function renderMultiSelBar(): HTMLElement{
  var n = Object.keys(S.multiSel.ids).length;
  var bar = el('div', 'msel-bar');
  bar.appendChild(el('span', 'msel-count', '已选 ' + n + ' 项'));
  var all = el('button', null, selAllLabel());
  all.id = 'btnSelAll';
  all.onclick = function(){
    var sel = $$('#navBody .conv-check').filter(function(cb){ return !cb.disabled });
    if (sel.length && sel.every(function(cb){ return cb.checked })){
      S.multiSel.ids = {}; /* 取消全选：清空全部（含过滤后不可见的手选项） */
    } else {
      /* 全选：合并写入，不清空、不覆盖已手选项；无可选项时自然无新增 */
      $$('#navBody .conv-check').forEach(function(cb){ if (!cb.disabled) S.multiSel.ids[cb.value] = 1 });
    }
    updateMultiSelBar(); /* 二态唯一同步点，不再整树重绘 */
  };
  var del = el('button', 'arc', '归档');
  del.disabled = n === 0 || S.multiSel.busy;
  del.onclick = function(){ deleteSessionsBulk() };
  var quit = el('button', null, '退出');
  quit.onclick = function(){ exitMultiSel() };
  if (S.multiSel.busy){ all.disabled = true; del.disabled = true; quit.disabled = true }
  bar.appendChild(all); bar.appendChild(del); bar.appendChild(quit);
  return bar;
}
/* 就地同步：勾选态 / picked / 计数 / 删除按钮，避免整树重绘导致滚动跳动 */
function updateMultiSelBar(): void{
  var n = Object.keys(S.multiSel.ids).length;
  $$('.msel-bar .msel-count').forEach(function(x){ x.textContent = '已选 ' + n + ' 项' });
  $$('.msel-bar button.arc').forEach(function(b){ b.disabled = n === 0 || S.multiSel.busy });
  $$('#navBody .conv-check').forEach(function(cb){
    var on = !!S.multiSel.ids[cb.value];
    cb.checked = on;
    if (cb.parentNode) cb.parentNode.classList.toggle('picked', on);
  });
  /* 二态文案必须排在勾选回写之后：selAllLabel() 读的是 cb.checked，否则文案慢一拍 */
  var btn = $('#btnSelAll');
  if (btn){ btn.textContent = selAllLabel(); btn.disabled = !!S.multiSel.busy }
}

/* task314-fork（主人 2026-11-15 口述）：会话分叉——调后端原生 fork 接口把历史复制成新会话，成功后直接打开。
   messageID 可选＝从该条消息处切开（含该条），用于「从这一步重走」；不传=整段分叉。
   与 DSH 一致：新会话标题由后端加 (fork) 后缀，原会话一条不动。 */
function forkSession(sess: any, messageID?: string): void{
  if (!sess || !sess.id){ toast('分叉失败：没有选中会话', true, 3000); return }
  if (S._forking){ toast('正在分叉，请稍候…', false, 1800); return }
  S._forking = true;
  toast(messageID ? '正在从这条消息分叉…' : '正在分叉会话…', false, 6000);
  api('/session/' + encodeURIComponent(sess.id) + '/fork', { method: 'POST', body: messageID ? { messageID: messageID } : {} })
    .then(function(ns){
      if (!ns || !ns.id) throw new Error('后端没有返回新会话');
      if (ns.pwa == null) ns.pwa = 1; /* 本机分叉出来的=大管家会话 */
      _localNewSids[ns.id] = 1;
      if (!(S.sessions || []).some(function(x){ return x && x.id === ns.id })) (S.sessions = S.sessions || []).unshift(ns);
      toast('已分叉：' + (ns.title || '新会话'), false, 2600);
      openSession(ns);
      renderSidebar(); /* 乐观入列后补一帧，防列表晚到看不见 */
    })
    .catch(function(e){
      var m = String((e && e.message) || e || '未知错误');
      if (/HTTP 4\d\d|no message|empty|INVALID|not found/i.test(m)) toast('分叉失败：这个会话还没有可继承的消息', true, 5000);
      else toast('分叉失败：' + m.slice(0, 140), true, 5000);
    })
    .then(function(){ S._forking = false });
}
function showCtxMenu(x: number, y: number, sess: any): void{
  if (S.multiSel.on) return;
  var m = $('#ctxMenu'); if (!m) return;
  m.replaceChildren();
  if (isHiddenId(sess.id)){
    /* 归档行：只给「取消归档」（task163：彻底删除入口退役；task390 主入口=左栏归档会话列表） */
    var rs = el('button', null, '取消归档');
    rs.onclick = function(){ hideCtxMenu(); restoreSession(sess) };
    m.appendChild(rs);
  } else {
    /* 验收桩：右键菜单「多选…」入口 id（原过滤栏按钮方案已退役，id 保留供回归 grep 与 UI 自动化定位） */
    var ms = el('button', null, '多选…'); ms.id = 'btnMultiSel'; ms.onclick = function(){ hideCtxMenu(); enterMultiSel() };
    /* task200：置顶/取消置顶——显示层 pin first（逻辑序不动，见 togglePinConv 注释） */
    var pn = el('button', null, isPinnedConv(sess.id) ? '取消置顶' : '置顶');
    pn.onclick = function(){ hideCtxMenu(); togglePinConv(sess) };
    var ren = el('button', null, '重命名对话');
    ren.onclick = function(){ hideCtxMenu(); askRenameSession(sess) };
    /* task314-fork：分叉会话（复制整段历史开新会话；后端原生 fork，不搬库不复制项目文件） */
    var fk = el('button', null, '分叉会话');
    fk.onclick = function(){ hideCtxMenu(); forkSession(sess) };
    /* task141：进入本项目的会话排序模式（task326 起统一从菜单进入；手机长按行=弹菜单，不再直进排序） */
    var srt = el('button', null, '调整顺序');
    srt.onclick = function(){
      hideCtxMenu();
      var pk = convSortKeyOf(sess); /* task146：TUI 会话进 __tui__ 排序区 */
      if (!pk){ toast('该会话没有归属项目，无法排序', true, 2600); return }
      enterSortMode(pk);
    };
    var del = el('button', null, '归档');
    del.onclick = function(){ hideCtxMenu(); deleteSession(sess) };
    /* task305：归档置菜单第一位（主人 2026-11-15 指令：「把这个归档放在第一位」） */
    m.appendChild(del); m.appendChild(ms); m.appendChild(pn); m.appendChild(ren); m.appendChild(fk); m.appendChild(srt);
  }
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - 170) + 'px';
  m.style.top = Math.min(y, window.innerHeight - 170) + 'px';
}
function hideCtxMenu(): void{ var m = $('#ctxMenu'); if (m) m.hidden = true }
function showProjectMenu(x: number, y: number, name: string, isImport: boolean): void{
  if (S.multiSel.on) return;
  var m = $('#ctxMenu'); if (!m) return;
  m.replaceChildren();
  var ms = el('button', null, '多选…');
  ms.onclick = function(){ hideCtxMenu(); enterMultiSel() };
  var c1 = el('button', null, '新建对话');
  c1.onclick = function(){ hideCtxMenu(); newTask(name) };
  var c2 = el('button', null, '改名字');
  c2.onclick = function(){ hideCtxMenu(); askRenameProject(name, isImport) };
  var c3 = el('button', 'danger', '删除项目');
  c3.onclick = function(){ hideCtxMenu(); deleteProject(name, isImport) };
  m.appendChild(ms); m.appendChild(c1); m.appendChild(c2); m.appendChild(c3);
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - 170) + 'px';
  m.style.top = Math.min(y, window.innerHeight - 140) + 'px';
}
function refreshProjectsView(): void{
  loadProjects().then(function(){ setView('projects') });
}
function deleteProject(name: string, isImport: boolean): void{
  if (!name) return;
  if (isImport){
    if (!confirm('移除导入的项目「' + name + '」？\n只移除登记，不删除实际文件。')) return;
    fetch('/_unimport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
      .then(function(r){ return r.json() })
      .then(function(d){ if (d.error) return alert('移除失败：' + d.error); refreshProjectsView() })
      .catch(function(e){ alert('移除失败：' + e.message) });
    return;
  }
  if (!confirm('删除项目「' + name + '」？\n将永久删除 projects/' + name + ' 文件夹及其全部内容，不可恢复！')) return;
  fetch('/_fs/rmdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
    .then(function(r){ return r.json() })
    .then(function(d){
      if (d.error) return alert('删除失败：' + d.error);
      refreshProjectsView();
    })
    .catch(function(e){ alert('删除失败：' + e.message) });
}
function askRenameProject(name: string, isImport: boolean): void{
  if (!name) return;
  openModal('改名字', '<div class="hint">' + (isImport ? '修改导入项目的显示名称（不改动实际路径）。' : '重命名 projects 下的项目文件夹。<br>注意：历史对话按旧路径保存，改名后旧对话可能不再显示。') + '</div><input id="mRename" placeholder="新名称" value="' + esc(name) + '">', function(){
    var nn = ($('#mRename').value || '').trim();
    if (!nn || nn === name){ closeModal(); return }
    var dup = S.projects.some(function(p){ return p.name === nn }) || S.imports.some(function(im){ return im.name === nn });
    if (dup) return alert('已有同名项目：' + nn);
    if (isImport){
      var im = S.imports.filter(function(x){ return x.name === name })[0];
      if (!im) return;
      fetch('/_import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nn, path: im.path }) })
        .then(function(r){ return r.json() })
        .then(function(d){
          if (d.error) return alert('改名失败：' + d.error);
          return fetch('/_unimport', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name }) })
            .then(function(r){ return r.json() })
            .then(function(d2){ if (d2.error) return alert('移除旧登记失败：' + d2.error); closeModal(); refreshProjectsView() });
        })
        .catch(function(e){ alert('改名失败：' + e.message) });
      return;
    }
    fetch('/_fs/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: name, to: nn }) })
      .then(function(r){ return r.json() })
      .then(function(d){
        if (d.error) return alert('改名失败：' + d.error);
        closeModal(); refreshProjectsView();
      })
      .catch(function(e){ alert('改名失败：' + e.message) });
  });
  setTimeout(function(){ var i = $('#mRename'); if (i){ i.focus(); i.select() } }, 0);
}
function askRenameSession(sess: any): void{
  if (!sess || !sess.id) return;
  openModal('重命名对话',
    '<div class="hint">给这个对话起一个新标题。</div><input id="mSessRename" placeholder="新标题" value="' + esc(sess.title || '') + '">',
    function(){
      var nn = ($('#mSessRename').value || '').trim();
      if (!nn || nn === sess.title){ closeModal(); return }
      api('/session/' + sess.id, { method: 'PATCH', body: { title: nn } })
        .then(function(d){
          if (!d || !d.id) throw new Error('后端未返回会话信息');
          sess.title = d.title || nn;
          var hit = S.sessions.filter(function(x){ return x.id === sess.id })[0];
          if (hit) hit.title = sess.title;
          if (S.current && S.current.id === sess.id) S.current.title = sess.title;
          closeModal(); renderSidebar(); renderTitle();
        })
        .catch(function(e){ alert('重命名失败：' + e.message) });
    });
  setTimeout(function(){ var i = $('#mSessRename'); if (i){ i.focus(); i.select() } }, 0);
}
/* task279：归档确认「不再提示」持久开关（localStorage；默认仍每次提示） */
function archiveNoAsk(): boolean{ try { return localStorage.getItem('littledj.archiveNoConfirm') === '1' } catch(e){ return false } }
/* task56：软删（只移出列表，数据不动）。占用判定沿用台账 + 实时三信号，运行中一律拒绝 */
function deleteSession(sess: any): void{
  if (!sess || !sess.id) return;
  /* 占用判定（静态台账 + 实时）：堵住右键菜单移除绕过批量复核的路径 */
  var lockTxt = lockHint(sess.id, ledgerActiveSids(), liveRunningSids());
  if (lockTxt){
    alert('「' + (sess.title || '未命名对话') + '」' + lockTxt);
    return;
  }
  var title = sess.title || '未命名对话';
  var doHide = function(){
    hideSessions([sess.id]).then(function(){
      hiddenOrderAdd(sess.id); /* task390：本端即时入归档列表（服务端 Set 同款尾插） */
      S.hidden[sess.id] = 1;
      clearActiveButlerIf(sess.id); /* task106：指针会话被隐藏即清键 */
      if (S.current && S.current.id === sess.id) clearCurrentAfterRemove('已归档，可在左栏「归档会话列表」恢复。');
      renderSidebar();
    }).catch(function(e){ alert('归档失败：' + ((e && e.message) || String(e))) });
  };
  if (archiveNoAsk()){ doHide(); return; }
  openModal('归档对话',
    '<div class="hint">归档「' + esc(title) + '」？不删除任何数据，仅从列表归档；需要时可在左栏「归档会话列表」恢复。</div>' +
    '<label class="arch-noask"><input type="checkbox" id="mArchNoAsk"><span>以后归档不再提示</span></label>',
    function(){
      var cb = $('#mArchNoAsk');
      if (cb && cb.checked){ try { localStorage.setItem('littledj.archiveNoConfirm', '1') } catch(e){} }
      closeModal();
      doHide();
    },
    '归档');
}
function clearCurrentAfterRemove(text: string): void{
  /* task391：归档/批量删除当前会话前先把输入草稿存槽（恢复该会话后可原样回填） */
  if (S.current && S.current.id){ try { draftStash(S.current.id) } catch(e){} }
  S.current = null;
  if (S.quote){ S.quote = null; renderQuote() } /* task77 §3.5：置 null 即清引用，避免发给下一个会话 */
  S.treeRootId = ''; S._treeOpenedFor = '';
  /* task391：当前无会话归属——清空输入框/附件，防残留串进下一个打开的会话（方案审 v2 P2-1） */
  try {
    var _ta = $('#input'); if (_ta){ _ta.value = ''; autoGrow() }
    S.atts = []; S.files = []; renderAtts();
    if (typeof holdBarSync === 'function') holdBarSync();
  } catch(e){}
  $('#messages').innerHTML = '<div class="empty"><div>' + text + '</div></div>';
  renderTitle();
  syncSseBanner();
}
/* 恢复：POST restore，成功才改本地 hidden（+ hiddenOrder），失败不假装成功。
   task390：本函数现在是左栏「归档会话列表」的唯一恢复入口；
   默认只恢复不切会话（输入框草稿全局单例，task391 未修前不乱切），仅本来没开对话时兜底打开。 */
function restoreSession(sess: any): void{
  if (!sess || !sess.id || S._restoring[sess.id]) return;
  S._restoring[sess.id] = 1;
  restoreSessions([sess.id]).then(function(){
    delete S._restoring[sess.id];
    delete S.hidden[sess.id];
    hiddenOrderRemove(sess.id);
    /* task390（产出审 P1-1）：记入「刚恢复」临时行——历史会话在 focus 视图默认不显示、归档行又已消失，
       给一条「已恢复 · 打开」可达入口（打开=二次点击，不自动切会话；内存态刷新即清） */
    S.archiveRestored = (Array.isArray(S.archiveRestored) ? S.archiveRestored : [])
      .filter(function(x){ return x && x.id !== sess.id }).concat([sess]).slice(-5);
    var noCurrent = !S.current;
    renderSidebar();
    toast('已恢复：' + (sess.title || '未命名对话'));
    if (noCurrent){
      S.archiveRestored = S.archiveRestored.filter(function(x){ return x.id !== sess.id }); /* 先移除再打开，防临时行残留到下次重绘（产出审 P2-8②） */
      try { openSession(sess) }
      catch(e){ toast('已恢复，但打开失败：' + ((e && e.message) || String(e)), true, 5000) }
    }
  }).catch(function(e){ delete S._restoring[sess.id]; alert('恢复失败：' + ((e && e.message) || String(e))) });
}
/* task163：彻底删除（先归档）前端入口已退役——隐藏即唯一维护入口，数据不删；
   服务端 DELETE + 归档模块保留供人工/AI 明示清理时使用（需主人当轮指令）。 */
/* 批量移除（软删）：fail-closed 强刷台账 → 三信号复核（锁定项跳过）→ 一次 POST hide
   不调 DELETE、不剔除 S.sessions，数据一条不删 */
async function deleteSessionsBulk(){
  if (S.multiSel.busy) return;
  S.multiSel.busy = true;
  /* 恢复按钮（退出按钮始终保留可用） */
  var restore = function(){
    $$('.msel-bar button').forEach(function(b){ b.disabled = false });
    updateMultiSelBar();
  };
  /* 移除期间锁住「全选」「移除」，只留「退出」 */
  $$('.msel-bar button').forEach(function(b){ if (b.textContent !== '退出') b.disabled = true });
  var ids = Object.keys(S.multiSel.ids);
  if (!ids.length){ S.multiSel.busy = false; restore(); return; }
  /* fail-closed：台账强刷失败即中止，此路径下尚未发出任何写请求 */
  try { await fetchLedgerNow(); }
  catch(e){
    S.multiSel.busy = false; restore();
    alert('台账刷新失败，已中止归档，请稍后重试');
    return;
  }
  var interN = 0;
  ids.forEach(function(sid){
    if ((TASKS.list || []).some(function(t){ return t.id === sid && t.state === 'interrupted' })) interN++;
  });
  var msg = '确认归档选中的 ' + ids.length + ' 个对话？不删除数据，可恢复。';
  if (interN > 0) msg += '\n其中 ' + interN + ' 个已中断，归档后可在左栏「归档会话列表」恢复。';
  if (!confirm(msg)){ S.multiSel.busy = false; restore(); return; }
  /* 用刚强刷的台账重算三信号（busyBy / 台账 / 实时），锁定项一律跳过、不自动放行 */
  var ledgerSet = ledgerActiveSids(), liveSet = liveRunningSids(), skipped = [];
  ids = ids.filter(function(sid){
    if (!isSessionLocked(sid, ledgerSet, liveSet)) return true;
    var hit = S.sessions.filter(function(x){ return x.id === sid })[0];
    skipped.push({ title: (hit && hit.title) || '未命名对话', reason: lockHint(sid, ledgerSet, liveSet) || '任务执行中，先停止再归档' });
    delete S.multiSel.ids[sid];
    return false;
  });
  if (!ids.length){
    S.multiSel.busy = false; restore();
    var allMsg = ['未归档任何对话。'];
    skipped.forEach(function(k){ allMsg.push('跳过「' + k.title + '」：' + k.reason) });
    alert(allMsg.join('\n'));
    return;
  }
  var failedMsg = '';
  try { await hideSessions(ids) }
  catch(e){ failedMsg = (e && e.message) || String(e) }
  if (failedMsg){
    S.multiSel.busy = false; restore();
    alert('归档失败：' + failedMsg);
    return;
  }
  ids.forEach(function(sid){ hiddenOrderAdd(sid); S.hidden[sid] = 1; clearActiveButlerIf(sid) }); /* task106：隐藏命中指针即清键；task390 同步归档顺序 */
  if (S.current && ids.indexOf(S.current.id) >= 0) clearCurrentAfterRemove('已归档，可在左栏「归档会话列表」恢复。');
  /* 台账收口：强刷，失败仅重试 1 次；仍失败只记标记，不阻断后续 */
  var ledgerFail = false;
  try { await fetchLedgerNow(); }
  catch(e1){ try { await fetchLedgerNow(); } catch(e2){ ledgerFail = true } }
  S.multiSel.busy = false; /* P1-2：先撤 busy 再退出，否则守卫吞掉收尾 */
  exitMultiSel();
  var lines = ['已归档 ' + ids.length + ' 个对话（可在左栏「归档会话列表」恢复）。'];
  skipped.forEach(function(k){ lines.push('跳过「' + k.title + '」：' + k.reason) });
  if (ledgerFail) lines.push('台账收口失败，请在任务面板核对');
  alert(lines.join('\n'));
}

window.bindConvDrag=bindConvDrag; window.convSortKeyOf=convSortKeyOf; window.convPins=convPins; window.isPinnedConv=isPinnedConv; window.togglePinConv=togglePinConv; window.dragConvTo=dragConvTo; window.enterSortMode=enterSortMode; window.moveConv=moveConv; window.exitSortMode=exitSortMode; window.appendChildRows=appendChildRows; window.appendChildRow=appendChildRow; window.enterMultiSel=enterMultiSel; window.exitMultiSel=exitMultiSel; window.selAllLabel=selAllLabel; window.renderMultiSelBar=renderMultiSelBar; window.updateMultiSelBar=updateMultiSelBar; window.forkSession=forkSession; window.showCtxMenu=showCtxMenu; window.hideCtxMenu=hideCtxMenu; window.showProjectMenu=showProjectMenu; window.refreshProjectsView=refreshProjectsView; window.deleteProject=deleteProject; window.askRenameProject=askRenameProject; window.askRenameSession=askRenameSession; window.archiveNoAsk=archiveNoAsk; window.deleteSession=deleteSession; window.clearCurrentAfterRemove=clearCurrentAfterRemove; window.restoreSession=restoreSession; window.deleteSessionsBulk=deleteSessionsBulk;

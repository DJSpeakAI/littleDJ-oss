/* @module todo @order 21 @职责 TodoDock 任务清单 @提供 TODO todoRender todoLoad sysPanelShow sysPanelPlace sysPanelClose sysTimersStop sysTimersStart sysBind @依赖 - @依赖运行期 S SYS sysRenderPanel POP_TAB sysWatch fetchBalance sysFetchQuota sysFetchScore sysRender @DOM契约 - @严格模式 是 @全局占用 TODO todoRender todoLoad sysPanelShow sysPanelPlace sysPanelClose sysTimersStop sysTimersStart sysBind @源行 ui/index.html L5668-L5827 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 任务清单 dock（移植 DSH TodoDock，2026-11-14）：读 deveco /api/session/:sid/todo，折叠面板 ---------- */
var TODO = { sid: '', data: null, at: 0, busy: false, collapsed: true, sig: '' };
function todoRender(){
  var box = $('#todoDock'); if (!box) return;
  var list = TODO.data;
  if (!Array.isArray(list) || !list.length){ box.hidden = true; box.textContent = ''; TODO.sig = ''; return }
  var done = 0, active = 0;
  list.forEach(function(t){ var s = t && t.status; if (s === 'completed') done++; else if (s === 'in_progress') active++ });
  var pending = list.length - done - active;
  var sig = JSON.stringify(list) + '|' + (TODO.collapsed ? 'c' : 'e');
  if (sig === TODO.sig) return;
  TODO.sig = sig;
  box.hidden = false;
  box.textContent = '';
  var card = el('div', 'tdock');
  var head = el('button', 'tdock-head');
  head.type = 'button';
  head.title = TODO.collapsed ? '展开任务清单' : '收起任务清单';
  /* task310：折叠箭头移到行首（左上角）——与 diff 汇总卡同口径，左手拇指可达 */
  head.appendChild(el('span', 'tdock-chev', TODO.collapsed ? '▸' : '▾'));
  head.appendChild(el('span', 'tdock-ico', '☑'));
  head.appendChild(el('span', 'tdock-title', '任务'));
  var prog = el('span', 'tdock-progress');
  if (done) prog.appendChild(el('b', 'tdock-done', done + ' 已完成'));
  if (active) prog.appendChild(el('b', 'tdock-active', active + ' 进行中'));
  if (pending) prog.appendChild(el('b', 'tdock-pending', pending + ' 待处理'));
  head.appendChild(prog);
  head.onclick = function(){ TODO.collapsed = !TODO.collapsed; TODO.sig = ''; todoRender() };
  card.appendChild(head);
  if (!TODO.collapsed){
    var ul = el('ul', 'tdock-list');
    list.forEach(function(t){
      var st = (t && t.status) || 'pending';
      var li = el('li', 'tdock-item tdock-' + st);
      li.appendChild(el('i', 'tdock-dot'));
      var c = el('span', 'tdock-content', String((t && t.content) || ''));
      c.title = String((t && t.content) || '');
      li.appendChild(c);
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }
  box.appendChild(card);
}
function todoLoad(force){
  var sid = (S.current && S.current.id) || '';
  if (!sid){ TODO.data = null; TODO.sid = ''; if (TODO.sig !== ''){ TODO.sig = ''; todoRender() } return }  if (TODO.sid !== sid){ TODO.sid = sid; TODO.data = null; TODO.sig = ''; }
  if (!force && TODO.busy) return;
  if (!force && TODO.at && Date.now() - TODO.at < 4000) return;
  TODO.busy = true;
  fetch('/api/session/' + encodeURIComponent(sid) + '/todo').then(function(r){ return r.json() }).then(function(d){
    TODO.busy = false; TODO.at = Date.now();
    if (!S.current || S.current.id !== sid) return;
    TODO.data = Array.isArray(d) ? d : ((d && d.todos) || null);
    todoRender();
  }).catch(function(){ TODO.busy = false; TODO.at = Date.now() });
}
function sysPanelShow(sec, anchor){
  var p = $('#sysPanel'); if (!p) return;
  var s = sec || 'all';
  var secChanged = SYS.sec !== s; /* task120 P2-1：跨区块切换重置滚动（10s 轮询同区块重建仍走 keepTop 防跳顶） */
  SYS.sec = s; SYS.open = true; SYS.anchor = anchor || null; p.hidden = false;
  if (secChanged) p.scrollTop = 0;
  sysPanelPlace(SYS.anchor);
  sysRenderPanel();
}
/* task122：面板对齐到触发胶囊正下方（原 right:0 恒对齐整组右缘，点「内存」却出现在「统计」下面）；
   居中后按视口左右各留 8px 收敛，窄屏也不出界 */
function sysPanelPlace(anchor){
  var p = $('#sysPanel'), wrap = $('#sysWrap'); if (!p || !wrap) return;
  var pw = p.offsetWidth || 264;
  var a = anchor || $('#sysPill');
  if (!a) return;
  var ar = a.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
  if (!ar.width && !ar.height){ /* task122 P2-1：跨 1121 断点后 anchor 已被 display:none，回退原 right:0 语义 */
    p.style.left = '';
    p.style.right = '0';
    return;
  }
  var vw = window.innerWidth || document.documentElement.clientWidth || 0;
  var left = ar.left + ar.width / 2 - pw / 2;
  if (vw > 0){
    if (left < 8) left = 8;
    if (left + pw > vw - 8) left = vw - 8 - pw;
  }
  p.style.right = 'auto';
  p.style.left = Math.round(left - wr.left) + 'px';
}
function sysPanelClose(){
  var p = $('#sysPanel'); if (!p) return;
  if (SYS.hoverOpenT){ clearTimeout(SYS.hoverOpenT); SYS.hoverOpenT = null } /* 复审 P2-b：关闭即作废待开计时器 */
  SYS.open = false; p.hidden = true;
}
function sysTimersStop(){
  if (SYS.watchTimer){ clearInterval(SYS.watchTimer); SYS.watchTimer = null }
  if (SYS.slowTimer){ clearInterval(SYS.slowTimer); SYS.slowTimer = null }
}
function sysTimersStart(){
  if (POP_TAB) return; /* task206：大屏弹出页严禁后台轮询/响铃链（/_watch 10s+额度 120s；sysWatch 超时跳变会响铃+通知） */
  if (document.hidden) return;
  if (!SYS.watchTimer){
    SYS.watchTimer = setInterval(function(){ if (document.hidden) return; sysWatch(); }, 10000);
    sysWatch();
  }
  if (!SYS.slowTimer){
    SYS.slowTimer = setInterval(function(){ if (document.hidden) return; fetchBalance(); sysFetchQuota(); sysFetchScore(); }, 120000);
    fetchBalance(); sysFetchQuota(); sysFetchScore(); /* task386：积分快照同节拍 120s（DJH 5 分钟推送，慢轮询足够） */
  }
  sysRender();
}
function sysBind(){
  var wrap = $('#sysWrap'), pill = $('#sysPill');
  if (!wrap || !pill) return;
  var hoverable = !!(window.matchMedia && window.matchMedia('(hover: hover)').matches);
  /* task120：每胶囊独立 hover/click（合一胶囊=all；拆分胶囊=各自区块）。
     计时器拆两个（御史 P0-1）：hoverOpenT=待开（胶囊 enter 设）/ hoverCloseT=待关（wrap leave 设）；
     wrap 级 mouseenter 只清 hoverCloseT 不开面板——鼠标跨 8px 间隙进入面板时取消待关（且不清待开，防外→内触发序误杀 hover 打开） */
  var secs = [ [pill, 'all'], [$('#sysPMem'), 'mem'], [$('#sysPQuo'), 'quo'], [$('#sysPTask'), 'task'], [$('#sysPStat'), 'stat'] ];
  secs.forEach(function(pair){
    var b = pair[0], sec = pair[1];
    if (!b) return;
    if (hoverable){
      b.addEventListener('mouseenter', function(){
        if (SYS.hoverCloseT){ clearTimeout(SYS.hoverCloseT); SYS.hoverCloseT = null }
        if (SYS.hoverOpenT) clearTimeout(SYS.hoverOpenT);
        SYS.hoverOpenT = setTimeout(function(){ SYS.hoverOpenT = null; sysPanelShow(sec, b) }, 150);
      });
    }
    b.onclick = function(ev){
      ev.stopPropagation();
      if (SYS.hoverOpenT){ clearTimeout(SYS.hoverOpenT); SYS.hoverOpenT = null } /* 复审 P2-b：click 判定前清待开计时器，防「点了关闭又自己弹回」 */
      if (SYS.open && SYS.sec === sec) sysPanelClose(); else sysPanelShow(sec, b);
    };
  });
  if (hoverable){
    wrap.addEventListener('mouseenter', function(){
      if (SYS.hoverCloseT){ clearTimeout(SYS.hoverCloseT); SYS.hoverCloseT = null }
    });
    wrap.addEventListener('mouseleave', function(){
      if (SYS.hoverOpenT){ clearTimeout(SYS.hoverOpenT); SYS.hoverOpenT = null }
      SYS.hoverCloseT = setTimeout(function(){ SYS.hoverCloseT = null; sysPanelClose() }, 150);
    });
  }
  document.addEventListener('click', function(ev){
    if (!SYS.open) return;
    var w = $('#sysWrap');
    if (w && !w.contains(ev.target)) sysPanelClose();
  });
}

window.TODO=TODO; window.todoRender=todoRender; window.todoLoad=todoLoad; window.sysPanelShow=sysPanelShow; window.sysPanelPlace=sysPanelPlace; window.sysPanelClose=sysPanelClose; window.sysTimersStop=sysTimersStop; window.sysTimersStart=sysTimersStart; window.sysBind=sysBind;

/* @module views @order 43 @职责 视图切换 + 列宽 @提供 _selfBackAt _backTransAt _exitUntil _escAt setView applyColWidths initColResize autoGrow loadConvOrder sideCloseJudge edgeSwipeJudge @依赖 - @依赖运行期 S exitMultiSel renderSidebar isMobile syncScrollBtnPos applyTaskConvOrderFromCache @DOM契约 - @严格模式 是 @全局占用 _selfBackAt _backTransAt _exitUntil _escAt setView applyColWidths initColResize autoGrow loadConvOrder sideCloseJudge edgeSwipeJudge @源行 ui/index.html L12185-L12613 @测试锚点 - @被调用 - */
'use strict';
/* ---------- views ---------- */
function setView(v?){
  if (S.multiSel.busy) return;
  if (v !== 'projects' && S.multiSel.on) exitMultiSel();
  S.view = v;
  $$('.nav button').forEach(function(b){ b.classList.toggle('active', b.dataset.view === v) });
  renderSidebar();
}

function applyColWidths(){
  var app = $('#app'); if (!app) return;
  if (isMobile()){ app.style.removeProperty('--sbw'); app.style.removeProperty('--rgw'); return }
  var w = window.innerWidth;
  var l = parseFloat(localStorage.getItem('littledj.sbw') || '');
  var r = parseFloat(localStorage.getItem('littledj.rgw') || '');
  if (l > 0) app.style.setProperty('--sbw', Math.max(160, Math.min(l, Math.min(520, w * 0.5))) + 'px');
  if (r > 0) app.style.setProperty('--rgw', Math.max(220, Math.min(r, Math.min(760, w * 0.6))) + 'px');
}
function initColResize(){
  var app = $('#app'), L = $('#spLeft'), R = $('#spRight');
  if (!app || !L || !R) return;
  var drag = null;
  function start(which, ev){
    if (isMobile() || ev.button !== 0) return;
    ev.preventDefault();
    drag = { which: which, rect: app.getBoundingClientRect(), moved: false };
    (which === 'l' ? L : R).classList.add('drag');
    document.body.classList.add('dragging-col');
    try { (which === 'l' ? L : R).setPointerCapture(ev.pointerId) } catch(e){}
  }
  function move(ev){
    if (!drag) return;
    drag.moved = true;
    var w = window.innerWidth;
    if (drag.which === 'l'){
      app.style.setProperty('--sbw', Math.max(160, Math.min(ev.clientX - drag.rect.left, Math.min(520, w * 0.5))) + 'px');
    } else {
      app.style.setProperty('--rgw', Math.max(220, Math.min(drag.rect.right - ev.clientX, Math.min(760, w * 0.6))) + 'px');
    }
  }
  function end(){
    if (!drag) return;
    var moved = drag.moved;
    drag = null;
    L.classList.remove('drag'); R.classList.remove('drag');
    document.body.classList.remove('dragging-col');
    if (!moved) return;
    var cs = getComputedStyle(app);
    try {
      localStorage.setItem('littledj.sbw', String(Math.round(parseFloat(cs.getPropertyValue('--sbw')) || 250)));
      localStorage.setItem('littledj.rgw', String(Math.round(parseFloat(cs.getPropertyValue('--rgw')) || 380)));
    } catch(e){}
  }
  function reset(which){
    app.style.removeProperty(which === 'l' ? '--sbw' : '--rgw');
    try { localStorage.removeItem(which === 'l' ? 'littledj.sbw' : 'littledj.rgw') } catch(e){}
  }
  L.addEventListener('pointerdown', function(ev){ start('l', ev) });
  R.addEventListener('pointerdown', function(ev){ start('r', ev) });
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  L.addEventListener('dblclick', function(){ reset('l') });
  R.addEventListener('dblclick', function(){ reset('r') });
}

/* ---------- init ---------- */
function autoGrow(){ var ta = $('#input'); if (isMobile()){ ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 142) + 'px'; syncScrollBtnPos(); return } ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; syncScrollBtnPos() }

/* task71 S2a：休息态按钮 + 30s 轮询 + 回前台立即拉取（多端以服务端为准） */
/* task137：链路模式三选——按钮开浮层，菜单外点击/ESC 收口 */
/* task189：会话行上下文百分比——boot 拉一次 + 60s 低频（页面隐藏跳过；内容变化才重绘见 fetchCtxMap） */
/* task141：启动拉会话手动排序表（失败按空表=纯 created 顺序，不阻塞） */
function loadConvOrder(){
  return fetch('/_conv-order').then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(function(d){
      var m = (d && d.order && typeof d.order === 'object' && !Array.isArray(d.order)) ? d.order : {};
      var clean = {};
      Object.keys(m).forEach(function(k){ if (Array.isArray(m[k])) clean[k] = m[k].filter(function(x){ return typeof x === 'string' }) });
      S.convOrder = clean;
      applyTaskConvOrderFromCache(); /* task156 S4：__tasks__ 顺序回填手动位次 */
      renderSidebar();
    }).catch(function(){ /* 读不到按现状渲染 */ });
}
/* task80 S2b：页面隐藏即停队列轮询（省资源），回前台立刻补一次并恢复 3s 表（count>0 时）；
   task124 R3 面：回前台若队列非空补一次普通试探 nudge（不带证人——后台期间是否漏 idle 前端不可知，保守试探） */
/* task175：全屏侧栏的 ✕ 收起（与 ☰ 再点同路） */
/* task175：侧栏上往左滑=收起（主人需求：空白处从右往左滑退出边栏；全屏后无空白区，手势落在侧栏自身）
   判定抽纯函数 sideCloseJudge 便于离线自测；排序模式（S.sortProj）中不抢——排序有自己的触控交互 */
function sideCloseJudge(dx?, dy?){
  if (dx > -46) return false;                     /* 左滑距离不足 */
  if (-dx <= dy * 1.6) return false;              /* 竖向成分过大=列表滚动，不抢 */
  return true;
}
/* task175：系统返回手势翻译——鸿蒙/移动浏览器把「左缘右滑」抢成 history.back()（主人 2026-11-10 实测：滑动=返回上一页），
   页面 touch 事件收不到、preventDefault 无效。改为在历史栈垫哨兵条目，popstate 时（面板关着）把返回手势翻译成「开侧栏」：
   - 栈底垫 {djSentinel:1}（boot 一次，幂等：栈顶已是哨兵不重复垫）
   - 面板开着时返回=关面板（原语义不变）；closePanels 自己 back() 用 _selfBackAt 时间戳抑制，防「关了又自动开」
   - 快速连续返回（<1200ms 内第二次落到「面板关着」的 popstate）= 真想退出，放行不垫（三连快滑=退出逃生门） */
var _selfBackAt = 0, _backTransAt = 0, _exitUntil = 0;
/* task174：手机端左缘右滑唤出侧栏（等同 ☰ 按钮，主人 2026-11-10 需求）
   判定抽成纯函数 edgeSwipeJudge 便于离线自测；手势开启路径与 #btnMenu 完全同构（open 类 + pushPanelHist + syncPanelMask） */
function edgeSwipeJudge(startX?, startY?, dx?, dy?){
  if (startX < 12 || startX > 64 || startY < 44) return false; /* task176：热区右移 12–64px——最物理边缘 ≤12px 是系统手势死区（事件不给页面），放弃交给哨兵翻译兜底；>64px 属内容区不算边缘手势 */
  if (dx < 40) return false;                     /* task176：阈值 46→40px 更跟手 */
  if (dx <= dy * 1.6) return false;              /* 竖向成分过大=列表滚动，不抢手势 */
  return true;
}
/* task79 S2b：ESC 分级取消（仅桌面；移动端一律走上面那条关面板逻辑）。
   注意：imgViewer 的 ESC 关闭仅桌面生效，移动端走 #ivClose 按钮（task267 全屏版）。 */
var _escAt = 0;
/* 滑动切换（>40px 水平位移；tap 仍走 click 关闭） */
/* 查看器开着时 ←/→ 切换（桌面键盘；ESC 已有分级取消） */
/* task267：移动端 ＋ = 展开附件面板（再点收起，＋ 旋转 45° 变 ×，DAG 同款）；桌面保持直接文件选择 */
/* 多选模式下屏蔽左栏原生右键菜单（中栏输入框右键不受影响） */
window._selfBackAt=_selfBackAt; window._backTransAt=_backTransAt; window._exitUntil=_exitUntil; window._escAt=_escAt; window.setView=setView; window.applyColWidths=applyColWidths; window.initColResize=initColResize; window.autoGrow=autoGrow; window.loadConvOrder=loadConvOrder; window.sideCloseJudge=sideCloseJudge; window.edgeSwipeJudge=edgeSwipeJudge;

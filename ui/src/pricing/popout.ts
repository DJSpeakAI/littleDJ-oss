/* @module popout @order 41 @职责 大屏弹出独立窗口 @提供 popWinPlace popWinAfter popoutOpen popoutOpenKey popHintShow popHintHide popPointerClear bootPopout @依赖 - @依赖运行期 POP_TABS toast popHintEl popDown S POP_TAB POP_PROV skRenderKeyWin skRenderProvList loadPricingPanel SK skRenderPricing @DOM契约 - @严格模式 是 @全局占用 popWinPlace popWinAfter popoutOpen popoutOpenKey popHintShow popHintHide popPointerClear bootPopout @源行 ui/index.html L11312-L11401 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task206：大屏弹出独立窗口（同文件 popout 模式，渲染走既有 skRenderPricing 原链零复制） ---------- */
/* 弹窗居中（2026-11-12）：设置/比价窗原来不带 left/top，浏览器把窗口丢在屏幕左上角。
   这里统一算屏幕正中，窗口被复用或尺寸不符时用 moveTo/resizeTo 兜底（Chrome 对已存在的同名窗口会忽略 features）。 */
function popWinPlace(features?, defW?, defH?){
  var f = features || '';
  var mw = /width\s*=\s*(\d+)/i.exec(f), mh = /height\s*=\s*(\d+)/i.exec(f);
  var W = mw ? parseInt(mw[1], 10) : defW;
  var H = mh ? parseInt(mh[1], 10) : defH;
  var aw = (window.screen && screen.availWidth) || 1280;
  var ah = (window.screen && screen.availHeight) || 800;
  W = Math.min(W, Math.max(320, aw - 40));
  H = Math.min(H, Math.max(320, ah - 60));
  var left = Math.max(0, Math.round((aw - W) / 2));
  var top = Math.max(0, Math.round((ah - H) / 2));
  var base = f.replace(/width\s*=\s*\d+/ig, '').replace(/height\s*=\s*\d+/ig, '').replace(/,{2,}/g, ',').replace(/^,|,$/g, '');
  return { feats: (base ? base + ',' : '') + 'width=' + W + ',height=' + H + ',left=' + left + ',top=' + top, W: W, H: H, left: left, top: top };
}
function popWinAfter(w?, pl?){
  if (!w) return;
  try {
    if (w.outerWidth !== pl.W || w.outerHeight !== pl.H || w.screenX !== pl.left || w.screenY !== pl.top){
      w.resizeTo(pl.W, pl.H); w.moveTo(pl.left, pl.top);
    }
  } catch(e){}
}
function popoutOpen(tab?, sz?){
  if (!POP_TABS[tab]){ toast('不支持的弹出页签', false, 2200); return }
  var w = null;
  var _pl = popWinPlace(sz || 'width=1280,height=880', 1280, 880); /* 居中：原来不带 left/top 会跑到左上角 */
  try { w = window.open('?popout=' + tab, 'ljPopout_' + tab, _pl.feats) } catch(e){}
  popWinAfter(w, _pl);
  if (!w) toast('浏览器拦截了弹出窗口，请允许弹窗后重试', true, 2800);
}
/* task215：供应商 Key 管理独立窗（窄高卡式；ds/zp/volc 各一扇，同名窗口复用置前；oa 已随 task228 退役） */
function popoutOpenKey(prov?){
  if (prov !== 'ds' && prov !== 'zp' && prov !== 'volc') return;
  var w = null;
  var _pl2 = popWinPlace('width=640,height=860', 640, 860); /* 居中：同上 */
  try { w = window.open('?popout=apikey&prov=' + prov, 'ljPopout_apikey_' + prov, _pl2.feats) } catch(e){}
  popWinAfter(w, _pl2);
  if (!w){ toast('浏览器拦截了弹出窗口，请允许弹窗后重试', true, 2800); return }
  try { w.focus() } catch(e){}
}
function popHintShow(){
  if (!popHintEl){
    popHintEl = el('div', 'pr-pop-hint');
    popHintEl.textContent = '松开弹出大屏窗口';
    document.body.appendChild(popHintEl);
  }
  popHintEl.hidden = false;
}
function popHintHide(){ if (popHintEl) popHintEl.hidden = true }
function popPointerClear(){
  if (popDown && popDown.timer){ clearTimeout(popDown.timer) }
  popDown = null; popHintHide();
}
function bootPopout(){
  /* 大屏专页：单列全宽 + 只渲染比价；跳过铃桥/会话链/SSE/后台轮询（sysTimersStart/kaStart 已加 POP_TAB 守卫，
     顶层 pointerdown/visibilitychange 等残留副作用经御史方案审核实为无害：无 SSE 即无提示音/通知来源） */
  document.body.classList.add('popout');
  var app = $('#app'); if (app) app.classList.remove('noright'); /* task206-fu1：初始 HTML 带 noright，不摘则 #app.noright #right{display:none}（双 id 特异度）压过 body.popout #right → 黑屏 */
  var vt = $('#verText'); if (vt) vt.textContent = 'personal agent · v0.391.0.0'; /* task385：三处 verText 同值（index.html 静态+boot+popout），scroll-jump D7 守门；谱系连环让号见 NUMBERING */
  S.tab = POP_TAB; /* task224：两页签统一正字——缺这行时 S.tab 停在默认 'tasks'，任何台账轮询都会让 renderTasks 覆盖 #rightBody */
  window.addEventListener('pagehide', function(){ if (SK.popPollT){ clearInterval(SK.popPollT); SK.popPollT = 0 } });
  /* task337（御审 P0-1）：弹窗页=独立浏览上下文，别名单源必须先水化再渲染——否则 _aliasMap 恒空 {}，
     弹窗内保存别名=setModelAliases(仅 1 条)全量上行，服务端其余别名被清空（数据丢失）。
     syncModelAliasBoot 内部全兜底（GET 失败→本地旧值/空），永不 reject，弹窗渲染零阻塞。
     task343：加 8s 超时兜底（与 bootReal 同口径，防 GET 半开时弹窗永久空白）。 */
  Promise.race([
    syncModelAliasBoot(),
    new Promise(function(res){ setTimeout(res, 8000) })
  ]).then(function(){
    if (POP_TAB === 'apikey'){
      /* task215/task229：有 prov = 供应商 Key 编辑窗（单卡）；无 prov = API Key 管理列表页（上模型对比按钮 + 下供应商卡）。
         两路都不拉比价/不启 popPollT（无表格无轮询） */
      try { document.title = 'API Key 管理 · 小DJ' } catch(e){}
      var host0 = $('#rightBody');
      if (host0){
        host0.innerHTML = '<div class="pr-panel" id="keyWinWrap"></div>';
        if (POP_PROV === 'ds' || POP_PROV === 'zp' || POP_PROV === 'volc') skRenderKeyWin(POP_PROV, 'keyWinWrap');
        else skRenderProvList('keyWinWrap');
      }
      return;
    }
    try { document.title = '模型比价 · 小DJ 大屏' } catch(e){}
    $$('.tabs .tb').forEach(function(x){ x.classList.toggle('active', x.dataset.tab === S.tab) });
    loadPricingPanel();
    /* 5 分钟静默校新：读 latest.json 缓存（不触发爬虫），updatedAt 变了才重渲（与右栏同款防打断筛选/排序） */
    if (SK.popPollT){ clearInterval(SK.popPollT) }
    SK.popPollT = setInterval(function(){
      fetch('/_pricing').then(function(r){ return r.json() }).then(function(d){
        if (!d || !d.ok) return;
        var old = SK.prData && SK.prData.updatedAt;
        SK.prData = d.data;
        if (!old || old !== d.data.updatedAt) skRenderPricing(SK.prWrap || 'pricingWrap');
      }).catch(function(){});
    }, 300000);
  });
}
window.popWinPlace=popWinPlace; window.popWinAfter=popWinAfter; window.popoutOpen=popoutOpen; window.popoutOpenKey=popoutOpenKey; window.popHintShow=popHintShow; window.popHintHide=popHintHide; window.popPointerClear=popPointerClear; window.bootPopout=bootPopout;

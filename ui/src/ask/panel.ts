/* @module panel @order 45 @职责 问 AI 旁问小浮窗 @提供 ASK askPanelEl askOpenNow askSelAllowed askModelLabel askRenderModel askRenderList askToggleList askAppend askScroll askAutoGrow askSendState askStop askClose askPlace askBuild askOnClick askInfoBefore askSel askOpen askSend onSelDismiss @依赖 - @依赖运行期 aliasOf S loadModelsWithRetry _selText closeSelMenu toast @DOM契约 - @严格模式 是 @全局占用 ASK askPanelEl askOpenNow askSelAllowed askModelLabel askRenderModel askRenderList askToggleList askAppend askScroll askAutoGrow askSendState askStop askClose askPlace askBuild askOnClick askInfoBefore askSel askOpen askSend onSelDismiss @源行 ui/index.html L12733-L12996 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task280：问 AI 旁问小浮窗 ----------
   主人 2026-11-14 口述：「把划词引用和问 AI 也用到小 DJ 上，特别是问 AI——设置、API Key 所有页面都能划词，
   因为我会问它这个模型跟其他模型有什么区别」。
   链路：划词浮层「问 AI」→ 小窗（模型下拉同输入框 S.models）→ POST /_ask
        （后端取当前会话历史当背景 + 直连供应商 /chat/completions 流式，不写会话）。
   task350 联网 → task358 常开：主人定版「联网默认开，一直开着也不用选择了，必须要开着」——
        🌐 toggle 与 localStorage 记忆退役，body 恒带 web:true，后端 wantWeb 默认 true（web!==false）；
        search/notice 事件仍在回答气泡前插 info 行（搜索提示/降级提示）。 */
var ASK: any = { panel: null, open: false, quote: '', turns: [], busy: false, abort: null, model: null, modelsOpen: false, anchor: null };
function askPanelEl(){ return $('#askPanel') }
function askOpenNow(){ var p = askPanelEl(); return !!(p && !p.hidden) }
/* 整页划词：输入框/编辑器里选字让给原生菜单（要能剪切粘贴），小窗里选字让给复制 */
function askSelAllowed(sel?){
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  if (!String(sel.toString() || '').trim()) return false;
  var n = sel.anchorNode, e = n && n.nodeType === 3 ? n.parentElement : n;
  if (!e || !e.closest) return false;
  if (e.closest('textarea,input,select,[contenteditable="true"]')) return false;
  if (e.closest('#askPanel')) return false;
  return true;
}
function askModelLabel(){
  var m = ASK.model;
  /* task289（三入口一致）：别名优先、无别名回落原名——与输入框下拉/比价表/设置 Key 卡同一别名单源（task337 起服务端 //_model-alias 跨设备同步）；
     不带 pname 前缀（小窗按钮空间有限，供应商组头已分组） */
  if (m) return aliasOf(m) || m.name || m.modelID;
  return (S.models && S.models.length) ? '选择模型' : '模型加载中…';
}
function askRenderModel(){
  var p = askPanelEl(); if (!p) return;
  var b = p.querySelector('[data-ask="model"]');
  if (b) b.innerHTML = '<span>' + esc(askModelLabel()) + '</span><i>▾</i>';
  if (b) b.title = ASK.model ? ('当前模型：' + askModelLabel() + '（点一下换一个）') : '选择模型';
}
function askRenderList(){
  var p = askPanelEl(); if (!p) return;
  var box = p.querySelector('.ask-models'); if (!box) return;
  var ms = S.models || [];
  if (!ms.length){ box.innerHTML = '<div class="ask-empty">模型清单还没加载好，稍等一下（或在输入框点一下模型下拉）</div>'; return; }
  var groups = {}, order = [];
  ms.forEach(function(m){ if (!groups[m.pname]){ groups[m.pname] = []; order.push(m.pname) } groups[m.pname].push(m) });
  var h = '';
  order.forEach(function(name){
    h += '<div class="ask-grp">' + esc(name) + '</div>';
    groups[name].forEach(function(m){
      var on = ASK.model && ASK.model.providerID === m.providerID && ASK.model.modelID === m.modelID;
      h += '<button type="button" class="ask-opt' + (on ? ' on' : '') + '" data-p="' + esc(m.providerID) + '" data-m="' + esc(m.modelID) + '">' + esc(aliasOf(m) || m.name || m.modelID) + (on ? '<span class="ask-tick">✓</span>' : '') + '</button>';
    });
  });
  box.innerHTML = h;
}
function askToggleList(force?){
  var p = askPanelEl(); if (!p) return;
  var box = p.querySelector('.ask-models'); if (!box) return;
  var want = (force == null) ? !ASK.modelsOpen : !!force;
  ASK.modelsOpen = want;
  if (want){ askRenderList(); box.hidden = false; if ((S.models || []).length === 0){ try { loadModelsWithRetry(4).then(askRenderList) } catch(e){} } }
  else box.hidden = true;
}
function askAppend(role?, text?){
  var p = askPanelEl(); if (!p) return null;
  var log = p.querySelector('.ask-log'); if (!log) return null;
  var d = document.createElement('div');
  d.className = 'ask-msg'; d.setAttribute('data-role', role); d.textContent = text || '';
  log.appendChild(d); askScroll();
  return d;
}
function askScroll(){ var p = askPanelEl(); if (!p) return; var log = p.querySelector('.ask-log'); if (log) log.scrollTop = log.scrollHeight }
function askAutoGrow(){ var p = askPanelEl(); if (!p) return; var ta = p.querySelector('.ask-in'); if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px' }
function askSendState(busy?){
  var p = askPanelEl(); if (!p) return;
  var b = p.querySelector('[data-ask="send"]'); if (!b) return;
  b.textContent = busy ? '停止' : '发送';
  if (busy) b.classList.add('stop'); else b.classList.remove('stop');
}
function askStop(){ if (ASK.abort){ try { ASK.abort.abort() } catch(e){} } }
/* task350→task358：info 行插在目标气泡前（联网搜索/降级提示），只插一条防重复 */
function askInfoBefore(refNode?, text?){
  if (!refNode || !refNode.parentNode) return;
  var log = refNode.parentNode;
  if (log.querySelector('.ask-info')) return;
  var d = document.createElement('div');
  d.className = 'ask-msg ask-info';
  d.textContent = text || '';
  log.insertBefore(d, refNode);
}
function askClose(){
  var p = askPanelEl(); if (!p) return;
  if (ASK.busy) askStop();
  ASK.open = false; ASK.busy = false; ASK.abort = null; ASK.turns = []; ASK.quote = ''; ASK.anchor = null;
  p.hidden = true;
  askToggleList(false);
}
function askPlace(){
  var p = askPanelEl(); if (!p) return;
  p.style.visibility = 'hidden'; p.hidden = false;
  var w = p.offsetWidth, h = p.offsetHeight;
  p.style.visibility = '';
  var vw = window.innerWidth, vh = window.innerHeight, a = ASK.anchor;
  var left = a ? Math.max(8, Math.min(a.left, vw - w - 8)) : Math.max(8, (vw - w) / 2);
  var top = a ? (a.bottom + 10) : 60;
  if (a && top + h > vh - 8) top = Math.max(8, a.top - h - 10);
  top = Math.max(8, Math.min(top, vh - h - 8));
  p.style.left = Math.round(left) + 'px';
  p.style.top = Math.round(top) + 'px';
}
function askBuild(){
  if (ASK.panel) return ASK.panel;
  var p = document.createElement('div');
  p.id = 'askPanel'; p.hidden = true;
  p.innerHTML = '<div class="ask-head">'
    + '<span class="ask-title">问 AI</span>'
    + '<button type="button" class="ask-model" data-ask="model"><span>模型</span><i>▾</i></button>'
    + '<button type="button" class="ask-x" data-ask="close" title="关闭（Esc）">✕</button>'
    + '</div>'
    + '<div class="ask-models" hidden></div>'
    + '<div class="ask-quote"></div>'
    + '<div class="ask-log"></div>'
    + '<div class="ask-foot">'
    + '<textarea class="ask-in" rows="1" placeholder="想问什么？Enter 发送 / Shift+Enter 换行"></textarea>'
    + '<button type="button" class="ask-send" data-ask="send">发送</button>'
    + '</div>';
  document.body.appendChild(p);
  ASK.panel = p;
  p.addEventListener('click', askOnClick);
  var ta = p.querySelector('.ask-in');
  ta.addEventListener('keydown', function(e: KeyboardEvent){
    if (e.key !== 'Enter' || e.shiftKey) return;
    if (e.isComposing || e.keyCode === 229) return; /* 中文输入法选词时的 Enter 不发送 */
    e.preventDefault();
    if (!ASK.busy) askSend();
  });
  ta.addEventListener('input', askAutoGrow);
  /* 拖标题栏移动 */
  var head = p.querySelector('.ask-head');
  head.addEventListener('pointerdown', function(e: PointerEvent){
    if (e.button !== 0) return;
    var tg: any = e.target;
    if (tg && tg.closest && tg.closest('button')) return;
    var sx = e.clientX, sy = e.clientY;
    var ox = parseFloat(p.style.left) || p.offsetLeft || 0;
    var oy = parseFloat(p.style.top) || p.offsetTop || 0;
    function mv(ev){ p.style.left = Math.round(Math.max(4, ox + ev.clientX - sx)) + 'px'; p.style.top = Math.round(Math.max(4, oy + ev.clientY - sy)) + 'px' }
    function up(){ window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    e.preventDefault();
  });
  return p;
}
function askOnClick(e?){
  var t = e.target;
  var opt = t.closest ? t.closest('.ask-opt') : null;
  if (opt){
    e.preventDefault();
    var pid = opt.getAttribute('data-p'), mid = opt.getAttribute('data-m');
    var m = (S.models || []).filter(function(x){ return x.providerID === pid && x.modelID === mid })[0];
    if (m) ASK.model = m;
    askRenderModel(); askToggleList(false);
    return;
  }
  var b = t.closest ? t.closest('[data-ask]') : null;
  if (!b) return;
  var act = b.getAttribute('data-ask');
  if (act === 'model'){ e.preventDefault(); askToggleList() }
  else if (act === 'close'){ e.preventDefault(); askClose() }
  else if (act === 'send'){ e.preventDefault(); if (ASK.busy) askStop(); else askSend() }
}
/* 划词浮层点「问 AI」：先抓原文和选区矩形，再开小窗 */
function askSel(){
  var t = _selText;
  if (!t) return;
  var rect = null;
  try { var sel = window.getSelection(); if (sel && sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect() } catch(e){ rect = null }
  closeSelMenu();
  askOpen(t, rect);
}
function askOpen(text?, rect?){
  var p = askBuild();
  ASK.open = true; ASK.quote = String(text || ''); ASK.turns = []; ASK.busy = false; ASK.abort = null; ASK.modelsOpen = false;
  ASK.anchor = rect ? { left: rect.left, top: rect.top, bottom: rect.bottom } : null;
  if (!ASK.model){
    var cur = S.model || {};
    var found = (S.models || []).filter(function(x){ return x.providerID === cur.providerID && x.modelID === cur.modelID })[0];
    ASK.model = found || (S.models || [])[0] || (cur.providerID ? { providerID: cur.providerID, modelID: cur.modelID, name: cur.modelID } : null);
  }
  p.querySelector('.ask-log').replaceChildren();
  p.querySelector('.ask-quote').textContent = ASK.quote ? ('选中：' + ASK.quote) : '';
  var ta = p.querySelector('.ask-in'); ta.value = ''; ta.style.height = 'auto';
  askSendState(false); askRenderModel(); askToggleList(false);
  askPlace();
  if ((S.models || []).length === 0){ try { loadModelsWithRetry(4).then(function(){
    /* task280-fix：模型清单晚到——把「只有 modelID 的占位条目」换成带显示名的真条目（popout 独立窗常见） */
    if (ASK.model){ var _hit = (S.models || []).filter(function(x){ return x.providerID === ASK.model.providerID && x.modelID === ASK.model.modelID })[0]; if (_hit) ASK.model = _hit }
    askRenderModel(); askRenderList()
  }) } catch(e){} }
  setTimeout(function(){ try { ta.focus() } catch(e){} }, 40);
}
function askSend(){
  var p = askPanelEl(); if (!p || ASK.busy) return;
  var ta = p.querySelector('.ask-in');
  var q = String(ta.value || '').trim();
  if (!q){ try { ta.focus() } catch(e){} return }
  var model = ASK.model;
  if (!model || !model.providerID || !model.modelID){ toast('还没有选到模型', true); return }
  var outgoing = q;
  if (!ASK.turns.length && ASK.quote) outgoing = '【我在界面里选中的原文】\n' + ASK.quote + '\n\n【我的问题】\n' + q;
  outgoing += '\n\n（旁问：请只回答我这个问题，不要接着上面的会话记录继续往下写。）';
  ASK.turns.push({ role: 'user', text: outgoing, show: q });
  askAppend('user', q);
  ta.value = ''; ta.style.height = 'auto';
  var bubble = askAppend('assistant', '');
  bubble.classList.add('pending');
  ASK.busy = true; askSendState(true);
  var ctrl = null; try { ctrl = new AbortController() } catch(e){}
  ASK.abort = ctrl;
  var acc = '', failure = '', aborted = false;
  var body = { sessionId: (S.current && S.current.id) || '', providerID: model.providerID, modelID: model.modelID,
               turns: ASK.turns.map(function(t){ return { role: t.role, text: t.text } }), web: true }; /* task358：联网常开（后端 web!==false 默认 true，双保险） */
  var opt: any = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  if (ctrl) opt.signal = ctrl.signal;
  fetch('/_ask', opt).then(function(r){
    var ct = String(r.headers.get('content-type') || '');
    if (ct.indexOf('application/json') >= 0){
      return r.json().then(function(d){ throw new Error((d && d.error) || '请求被拒绝') });
    }
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
    var reader = r.body.getReader(), dec = new TextDecoder(), buf = '';
    function pump(){
      return reader.read().then(function(res){
        if (res.done) return;
        buf += dec.decode(res.value, { stream: true });
        var i;
        while ((i = buf.indexOf('\n')) >= 0){
          var line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line) continue;
          var ev = null; try { ev = JSON.parse(line) } catch(e){ continue }
          if (ev.type === 'delta'){ acc += ev.text || ''; bubble.textContent = acc; askScroll() }
          else if (ev.type === 'search'){ askInfoBefore(bubble, '🌐 已联网搜索 ' + (ev.count || 0) + ' 条 · ' + (ev.query || '')) }
          else if (ev.type === 'notice'){ askInfoBefore(bubble, '⚠ ' + (ev.message || '')) }
          else if (ev.type === 'error'){ failure = ev.message || '模型调用失败' }
          else if (ev.type === 'aborted'){ aborted = true }
        }
        return pump();
      });
    }
    return pump();
  }).catch(function(e){
    if (e && e.name === 'AbortError') aborted = true; else failure = String((e && e.message) || e);
  }).then(function(){
    bubble.classList.remove('pending');
    ASK.busy = false; ASK.abort = null; askSendState(false);
    if (failure){
      if (!acc) bubble.remove();
      askAppend('error', '⚠ ' + failure);
      if (acc) ASK.turns.push({ role: 'assistant', text: acc });
    } else {
      if (!acc && !aborted) acc = '（模型没有输出内容）';
      bubble.textContent = acc;
      ASK.turns.push({ role: 'assistant', text: acc });
    }
    if (aborted && !acc) bubble.remove();
    askScroll();
    try { ta.focus() } catch(e){}
  });
}
/* task280-fix：捕获期挂在 window 上——必须比设置弹窗自己的 Esc（document 冒泡）先跑，
   否则按一次 Esc 会把设置一起关掉、小窗却还留在屏幕上（2026-11-14 实测）。 */
function onSelDismiss(e?){ var t = e.target; if (!(t && t.closest && t.closest('#selMenu'))) closeSelMenu() }
window.ASK=ASK; window.askPanelEl=askPanelEl; window.askOpenNow=askOpenNow; window.askSelAllowed=askSelAllowed; window.askModelLabel=askModelLabel; window.askRenderModel=askRenderModel; window.askRenderList=askRenderList; window.askToggleList=askToggleList; window.askAppend=askAppend; window.askScroll=askScroll; window.askAutoGrow=askAutoGrow; window.askSendState=askSendState; window.askStop=askStop; window.askClose=askClose; window.askPlace=askPlace; window.askBuild=askBuild; window.askOnClick=askOnClick; window.askSel=askSel; window.askOpen=askOpen; window.askSend=askSend; window.onSelDismiss=onSelDismiss;

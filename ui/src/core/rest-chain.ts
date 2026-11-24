/* @module rest-chain @order 11 @职责 休息态 + 链路模式 @提供 CHAIN_META loadRest setRest renderRest chainMeta loadChain setChain renderChain openChainMenu closeChainMenu renderTitle @依赖 - @依赖运行期 S toast scheduleSidebar fmtHM baseName @DOM契约 - @严格模式 是 @全局占用 CHAIN_META loadRest setRest renderRest chainMeta loadChain setChain renderChain openChainMenu closeChainMenu renderTitle @源行 ui/index.html L3296-L3421 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 休息态（task71 S2a）：以服务端 /_rest 为唯一真相，失败只置未知 ---------- */
function loadRest(): Promise<void>{
  return fetch('/_rest').then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d){
    S.rest.on = !!(d && d.on);
    S.rest.since = (d && d.since) || null;
    S.rest.unknown = false;
    renderRest();
  }).catch(function(){
    S.rest.unknown = true;
    renderRest();
  });
}
function setRest(on: boolean): Promise<void>{
  return fetch('/_rest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: on, source: 'button' }) })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(d){
      S.rest.on = !!(d && d.on);
      S.rest.since = (d && d.since) || null;
      S.rest.unknown = false;
      renderRest();
    }).catch(function(e){
      renderRest(); /* 失败保留原态，不做乐观写入 */
      toast('休息态切换失败：' + (e && e.message ? e.message : '网络异常'), true);
    });
}
function renderRest(): void{
  var b = $('#btnRest'); if (!b) return;
  b.classList.toggle('on', !!S.rest.on && !S.rest.unknown);
  b.classList.toggle('unknown', !!S.rest.unknown);
  var lb = b.querySelector('.restlabel');
  if (lb) lb.textContent = S.rest.unknown ? '未知' : (S.rest.on ? '休息中' : '在线');
  b.setAttribute('aria-pressed', S.rest.on ? 'true' : 'false');
  b.title = S.rest.unknown ? '休息状态未知' : (S.rest.on ? '休息中：点击恢复在线' : '休息态：开启后大管家自主推进已排队任务');
  renderTitle();
  if (typeof scheduleSidebar === 'function') scheduleSidebar(); /* task316：休息态切换后左栏标签立即重绘 */
}

/* ---------- 链路模式（task137）：以服务端 /_chain 为唯一真相，失败只置未知（与休息态同构） ---------- */
var CHAIN_META = {
  full:   { icon: '☰', label: '五角色', tip: '标准全链：大管家→小管家→枢机→执笔→御史' },
  flat:   { icon: '⛓', label: '压扁',   tip: '压扁链：小管家一肩挑（接单+拆解+执行），御史照过' },
  direct: { icon: '✊', label: '亲自',   tip: '亲自做：大管家直接执行（等价主人说「你直接做」）' }
}
function chainMeta(): { icon: string; label: string; tip: string }{ return CHAIN_META[S.chain.mode] || CHAIN_META.full }
function loadChain(): Promise<void>{
  return fetch('/_chain').then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d){
    S.chain.mode = (d && CHAIN_META[d.mode]) ? d.mode : 'full';
    S.chain.since = (d && d.since) || null;
    S.chain.unknown = false;
    renderChain();
  }).catch(function(){
    S.chain.unknown = true;
    renderChain();
  });
}
function setChain(mode: string): Promise<void>{
  if (!CHAIN_META[mode] || S.chain.unknown) return Promise.resolve();
  return fetch('/_chain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode, source: 'button' }) })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(d){
      S.chain.mode = (d && CHAIN_META[d.mode]) ? d.mode : 'full';
      S.chain.since = (d && d.since) || null;
      S.chain.unknown = false;
      renderChain();
      var m = chainMeta();
      toast('已切「' + m.label + '」：' + m.tip, false, 3200);
    }).catch(function(e){
      renderChain(); /* 失败保留原态，不做乐观写入 */
      toast('链路模式切换失败：' + (e && e.message ? e.message : '网络异常'), true);
    });
}
function renderChain(): void{
  var b = $('#btnChain'); if (!b) return;
  var m = chainMeta();
  var known = !S.chain.unknown;
  b.classList.toggle('unknown', !known);
  b.classList.toggle('on-direct', known && S.chain.mode === 'direct');
  b.classList.toggle('on-flat', known && S.chain.mode === 'flat');
  var lb = b.querySelector('.chainlabel');
  if (lb) lb.textContent = known ? m.label : '未知';
  b.setAttribute('aria-pressed', S.chain.mode !== 'full' ? 'true' : 'false');
  b.title = known ? ('链路模式 · ' + m.label + '：' + m.tip + '（点击更换）') : '链路模式未知';
  renderTitle();
  scheduleSidebar(); /* task197：模式徽标/「等待中」语义随链路模式变，切模式或首载后补一次左栏重绘 */
}
/* 三选浮层：挂按钮上方，点选项生效；点浮层外/ESC 关闭（收口在 closeChainMenu 单点） */
function openChainMenu(): void{
  var m = $('#chainMenu'), b = $('#btnChain');
  if (!m || !b || S.chain.unknown) return;
  m.replaceChildren();
  ['direct', 'flat', 'full'].forEach(function(k){
    var meta = CHAIN_META[k];
    var btn = el('button', null, meta.icon + ' ' + meta.label + (S.chain.mode === k ? ' ✓' : ''));
    btn.title = meta.tip;
    btn.onclick = function(){ closeChainMenu(); if (S.chain.mode !== k) setChain(k) };
    m.appendChild(btn);
  });
  m.hidden = false;
  var r = b.getBoundingClientRect(), mw = m.offsetWidth, mh = m.offsetHeight;
  var x = Math.max(8, Math.min(r.left + r.width / 2 - mw / 2, window.innerWidth - mw - 8));
  var y = r.top - mh - 8; if (y < 8) y = r.bottom + 8; /* 上方放不下转下方 */
  m.style.left = x + 'px'; m.style.top = y + 'px';
}
function closeChainMenu(): void{ var m = $('#chainMenu'); if (m){ m.hidden = true; m.replaceChildren() } }

function renderTitle(): void{
  var t = $('#title'), sub = $('#subtitle');
  var restTxt = S.busy ? '思考中…' : '在线';
  if (!S.busy && S.rest.on){ var hm = fmtHM(S.rest.since); restTxt = hm ? '休息中 · ' + hm + ' 起' : '休息中' }
  if (!S.chain.unknown && S.chain.mode !== 'full'){ restTxt += ' · ' + chainMeta().icon + chainMeta().label } /* task137：非默认链路入左栏状态 */
  var foot = $('#footStatus'); if (foot) foot.textContent = restTxt;
  if (!S.current){ t.textContent = '今天帮你做些什么'; sub.textContent = '选择项目，直接下指令'; return }
  t.textContent = S.current.title || '未命名对话';
  sub.textContent = baseName(S.current.directory) + (S.busy ? ' · 思考中…' : ' · ' + (S.current.model && S.current.model.id ? S.current.model.id : 'ready'));
}

window.CHAIN_META=CHAIN_META; window.loadRest=loadRest; window.setRest=setRest; window.renderRest=renderRest; window.chainMeta=chainMeta; window.loadChain=loadChain; window.setChain=setChain; window.renderChain=renderChain; window.openChainMenu=openChainMenu; window.closeChainMenu=closeChainMenu; window.renderTitle=renderTitle;

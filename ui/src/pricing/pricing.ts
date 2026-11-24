/* @module pricing @order 40 @职责 比价数据页 @提供 skPriceSpan skPriceSpanU skSpanScale prNormCtx skPricingRows skOpenPricing loadPricingPanel @依赖 - @依赖运行期 SK openModal closeModal skRenderPricing @DOM契约 - @严格模式 是 @全局占用 skPriceSpan skPriceSpanU skSpanScale prNormCtx skPricingRows skOpenPricing loadPricingPanel @源行 ui/index.html L11177-L11311 @测试锚点 - @被调用 - */
'use strict';
/* ---- 比价数据页 ---- */
function skPriceSpan(v?){
  var o = (v && v.offpeak) != null ? v.offpeak : null;
  var p = (v && v.peak) != null ? v.peak : null;
  if (o == null && p == null) return '—';
  if (o != null && p != null && o !== p) return o + '~' + p;
  return String(o != null ? o : p);
}
function skPriceSpanU(m?, v?){
  var unit = (m.price && m.price.unit) || '';
  /* task213：单位上移表头（元/百万），元价行与折元模式单元格只显数字；积分行（未折元）保留行内「积分」——跨量纲区分，列头元/百万不适用 */
  if (!unit) return esc(skPriceSpan(v)); /* 按量 API：元 / 百万 tokens */
  if (SK.prUnitCny && +(SK.prRate || 0) > 0) return esc(skSpanScale(v, +SK.prRate)); /* 积分行按自定汇率折元 */
  return esc(skPriceSpan(v)) + ' <span class="pr-unit">' + esc(unit) + '</span>';
}
/* 积分→元：区间两端分别折算，小值保留 4 位小数 */
function skSpanScale(v?, rate?){
  var one = function(x){
    var n = Number(x); if (x == null || !isFinite(n)) return null;
    var r = n * rate; return r >= 0.1 ? r.toFixed(2) : r.toFixed(4);
  };
  var o = (v && v.offpeak != null) ? one(v.offpeak) : null;
  var p = (v && v.peak != null) ? one(v.peak) : null;
  if (o == null && p == null) return '—';
  if (o != null && p != null && o !== p) return o + '~' + p;
  return String(o != null ? o : p);
}
/* task278：网抓数据统一展示——上下文列文本归一（各站表格口径不一，展示层统一成同一格式，主人 2026-11-14 定）：
   ①去冗余词「输入长度」（列头已叫上下文）②输入/输出→入/出、全角括号逗号→半角、逗号后空格去掉
   ③分段用「·」连接。例：输入长度 [0, 32K) → [0,32K)；输入 [0, 32K)，输出 [0, 0.2K) → 入[0,32K)·出[0,0.2K)
   新数据源接入只要求服务端 schema 对齐（contextText 原文即可），展示归一由本函数统一兜底。 */
function prNormCtx(s?){
  return String(s == null ? '' : s).trim()
    .replace(/输入长度/g, '')
    .replace(/输入/g, '入')
    .replace(/输出/g, '出')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/，/g, '·')
    .replace(/,(\s*)/g, ',')
    .replace(/([入出])\s+/g, '$1')
    .replace(/\s*·\s*/g, '·')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function skPricingRows(){
  var data = SK.prData; if (!data || !data.providers) return [];
  var rows = [];
  data.providers.forEach(function(p){
    (p.models || []).forEach(function(m){
      /* task212：官方产品名里的中文括注拆成灰标签（如「GLM-5.3-Flash（含视觉理解 MCP）」→ 名 + 标签），其余模型名保持原样 */
      if (!m.remark && typeof m.name === 'string'){
        var nm = /^(.+?)（([^）]+)）/.exec(m.name);
        if (nm){ m.name = nm[1].trim(); m.remark = nm[2].trim() }
      }
      /* task212→task213 撤：上下文单位上移表头（PRMETA.u='tokens'），不再前端注入 tokens 后缀改写（latest.json 原文即干净） */
      var base = { provider: p.provider, linked: !!(p.integration && p.integration.linked), note: (p.integration && p.integration.note) || '', api: p.api || '', apiFull: p.apiFull || '', unit: (m.price && m.price.unit) || '', m: m };
      rows.push(base);
      /* task209：GLM Token Plan 按 [1m] 拆行——官方口径「模型名加 [1m] 才开启 1M 上下文」，
         同一模型普通/[1m] 是两种调用形态（抵扣系数表只给一组，系数相同），主人要求分行展示。
         服务端若将来自己拆（name 已带 [1m]），此处按后缀判断不重复拆。 */
      if (/Token\s*Plan/i.test(p.provider || '') && !/\[1m\]$/i.test(m.name || '')){
        var m2: any = {};
        for (var mk in m){ if (Object.prototype.hasOwnProperty.call(m, mk)) m2[mk] = m[mk] }
        m2.name = m.name + '[1m]';
        m2.contextText = '1M（需加 [1m]）';
        var note = (base.note ? base.note + ' ｜ ' : '') + '同一模型加 [1m] 后缀启用 1M 上下文，抵扣系数相同';
        rows.push({ provider: p.provider, linked: base.linked, note: note, api: base.api, apiFull: base.apiFull, unit: base.unit, m: m2 });
        m.contextText = '默认窗口（不加 [1m]）';
      }
    });
  });
  var q = String(SK.prQ || '').toLowerCase();
  if (q) rows = rows.filter(function(r){ return (r.provider + ' ' + r.m.name).toLowerCase().indexOf(q) >= 0 });
  if (SK.prCat) rows = rows.filter(function(r){ return r.m.category === SK.prCat });
  if (SK.prLink === 'yes') rows = rows.filter(function(r){ return r.linked });
  if (SK.prLink === 'no') rows = rows.filter(function(r){ return !r.linked });
  var key = SK.prSort, dir = SK.prDir;
  rows.sort(function(a, b){
    /* task207：积分制行（Token Plan）与元价跨量纲不可比——输入/输出数值排序时恒排末尾（方案审 P1-2） */
    if (key === 'input' || key === 'output'){
      var au = a.unit ? 1 : 0, bu = b.unit ? 1 : 0;
      if (au !== bu) return au - bu;
    }
    var va, vb;
    if (key === 'input'){ va = (a.m.price.inputMiss.offpeak != null ? a.m.price.inputMiss.offpeak : 1e9); vb = (b.m.price.inputMiss.offpeak != null ? b.m.price.inputMiss.offpeak : 1e9) }
    else if (key === 'output'){ va = (a.m.price.output.offpeak != null ? a.m.price.output.offpeak : 1e9); vb = (b.m.price.output.offpeak != null ? b.m.price.output.offpeak : 1e9) }
    else if (key === 'context'){ va = String(a.m.contextText || ''); vb = String(b.m.contextText || '') }
    else if (key === 'note'){ va = String(a.m.note || ''); vb = String(b.m.note || '') } /* task345：备注列可排序（文本） */
    else if (key === 'model'){ va = a.m.name; vb = b.m.name }
    else if (key === 'api'){ va = String(a.api || ''); vb = String(b.api || '') }
    else { va = a.provider; vb = b.provider }
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });
  /* task278：分段计价同名行（如 GLM-5.1 的 [0,32K)/≥32K）——模型名只显第一行、续行显「〃」
     （复刻官方表 rowspan 合并格效果）；只合并排序后相邻的同名行，被价格排序打散时各自显全名。 */
  for (var gi = 1; gi < rows.length; gi++){
    rows[gi]._cont = rows[gi].provider === rows[gi - 1].provider && rows[gi].m.name === rows[gi - 1].m.name;
  }
  return rows;
}
function skOpenPricing(){
  if (SK.pollT){ clearInterval(SK.pollT); SK.pollT = 0 }
  if (SK.prPollT){ clearInterval(SK.prPollT); SK.prPollT = 0 }
  document.querySelector('.modal').classList.add('xwide'); /* task203：比价页用超大宽，数据为重 */
  openModal('模型比价', '<div class="pr-wrap" id="prWrap"><div class="pr-empty">加载中…</div></div>', function(){ closeModal() }, '关闭');
  $('#modalSave').style.display = 'none';
  fetch('/_pricing').then(function(r){ return r.json().then(function(d){ if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d }) })
    .then(function(d){ SK.prData = d.data; skRenderPricing() })
    .catch(function(e){
      var w = $('#prWrap');
      if (w) w.innerHTML = '<div class="pr-empty">' + esc(e.message) + '<br>先在「定时任务 → 模型比价」里点一次「▶ 立即运行」。</div>';
    });
}
/* task204：右栏「比价」页签——常驻随时看；读 /_pricing 缓存（latest.json）不触发爬虫，内存有数据先秒显再静默校新 */
function loadPricingPanel(){
  var host = $('#rightBody'); if (!host) return;
  host.innerHTML = '<div class="pr-panel" id="pricingWrap"><div class="pr-empty">加载中…</div></div>';
  if (SK.prData) skRenderPricing('pricingWrap');
  fetch('/_pricing').then(function(r){ return r.json().then(function(d){ if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d }) })
    .then(function(d){
      var w = $('#pricingWrap'); if (!w) return;
      if (!d.ok){
        if (!SK.prData) w.innerHTML = '<div class="pr-empty">' + esc(d.error || '暂无数据') + '<br>先在「⏰ 定时任务 → 模型比价」点一次「▶ 立即运行」。</div>';
        return;
      }
      var old = SK.prData && SK.prData.updatedAt;
      SK.prData = d.data;
      if (!old || old !== d.data.updatedAt) skRenderPricing('pricingWrap'); /* 数据变了才重渲，防打断筛选/排序状态 */
    })
    .catch(function(e){
      var w = $('#pricingWrap'); if (w && !SK.prData) w.innerHTML = '<div class="pr-empty">加载失败：' + esc(e.message) + '</div>';
    });
}
window.skPriceSpan=skPriceSpan; window.skPriceSpanU=skPriceSpanU; window.skSpanScale=skSpanScale; window.prNormCtx=prNormCtx; window.skPricingRows=skPricingRows; window.skOpenPricing=skOpenPricing; window.loadPricingPanel=loadPricingPanel;

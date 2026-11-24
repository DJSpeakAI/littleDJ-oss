/* @module usage @order 37 @职责 用量统计 @提供 USAGE USAGE_RANGE aliasedModelKeys fmtTok modelLabelById openUsageStats closeUsageStats fetchUsage renderUsageStats @依赖 - @依赖运行期 getModelAliases S @DOM契约 - @严格模式 是 @全局占用 USAGE USAGE_RANGE aliasedModelKeys fmtTok modelLabelById openUsageStats closeUsageStats fetchUsage renderUsageStats @源行 ui/index.html L10694-L10801 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 用量统计（数据源：deveco.db 消息级 tokens/cost，服务端聚合） ---------- */
var USAGE: any = { bucket: 'day', model: 'all', data: null, loading: false };
var USAGE_RANGE: any = { day: '近 30 天 · 按天', week: '近 12 周 · 按周', month: '近 12 个月 · 按月' };
function aliasedModelKeys(){
  var al = getModelAliases(), out = [];
  Object.keys(al).forEach(function(k){ if (String(al[k] || '').trim()) out.push(k) });
  return out;
}
function fmtTok(n?){
  n = n || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}
function modelLabelById(id?){
  var i = String(id || '').indexOf('/');
  var p = i > 0 ? id.slice(0, i) : '', m = i > 0 ? id.slice(i + 1) : id;
  var al = getModelAliases()[id];
  if (al) return al;
  var hit = (S.models || []).filter(function(x){ return x.providerID === p && x.modelID === m })[0];
  return hit ? (hit.pname + ' · ' + hit.name) : id;
}
function openUsageStats(){
  USAGE.bucket = 'day'; USAGE.model = 'all'; USAGE.data = null;
  $('#usageStats').hidden = false;
  renderUsageStats();
  fetchUsage(false);
}
function closeUsageStats(){ $('#usageStats').hidden = true; var tip = $('#usTip'); if (tip) tip.hidden = true }
function fetchUsage(force?){
  if (!aliasedModelKeys().length){ USAGE.loading = false; USAGE.data = null; renderUsageStats(); return }
  var only = aliasedModelKeys().join(',');
  USAGE.loading = true; renderUsageStats();
  fetch('/_stats/usage?bucket=' + encodeURIComponent(USAGE.bucket) + '&model=' + encodeURIComponent(USAGE.model) + '&only=' + encodeURIComponent(only) + (force ? '&refresh=1' : ''))
    .then(function(r){ return r.json() }).then(function(d){ USAGE.loading = false; USAGE.data = d; renderUsageStats() })
    .catch(function(e){ USAGE.loading = false; USAGE.data = { ok: false, error: e.message }; renderUsageStats() });
}
function renderUsageStats(){
  var rEl = $('#usRange'); if (rEl) rEl.textContent = USAGE_RANGE[USAGE.bucket] || '';
  var gran = $('#usGran');
  if (gran) Array.prototype.forEach.call(gran.querySelectorAll('button'), function(b){ b.classList.toggle('active', b.getAttribute('data-bucket') === USAGE.bucket) });
  var tipEl = $('#usTip'); if (tipEl) tipEl.hidden = true;
  var sum = $('#usSum'), chart = $('#usChart'), xlab = $('#usXLabels'), table = $('#usTable');
  if (!aliasedModelKeys().length){
    if (sum) sum.replaceChildren();
    if (chart) chart.innerHTML = '<div class="us-empty">用量统计只统计「有别名」的模型。<br>请先在 设置 → API Key → 点供应商 → 别名 里给要统计的模型起个名字。</div>';
    if (xlab) xlab.replaceChildren();
    if (table) table.replaceChildren();
    var sel0 = $('#usModel'); if (sel0) sel0.innerHTML = '<option value="all">全部模型</option>';
    return;
  }
  var d = USAGE.data;
  var sel = $('#usModel');
  if (sel){
    var ids = (d && d.ok && d.models) ? d.models.slice() : [];
    if (USAGE.model !== 'all' && ids.indexOf(USAGE.model) < 0) ids.unshift(USAGE.model);
    sel.replaceChildren();
    var allOpt = document.createElement('option');
    allOpt.value = 'all'; allOpt.textContent = '全部模型';
    if (USAGE.model === 'all') allOpt.selected = true;
    sel.appendChild(allOpt);
    ids.forEach(function(id){
      var o = document.createElement('option');
      o.value = id; o.textContent = modelLabelById(id);
      if (id === USAGE.model) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function(){ USAGE.model = sel.value; fetchUsage(false) };
  }
  if (USAGE.loading){
    if (sum) sum.innerHTML = '<span>正在统计…（首次打开需要几秒读取本地记录）</span>';
    if (chart) chart.replaceChildren();
    if (xlab) xlab.replaceChildren();
    if (table) table.replaceChildren();
    return;
  }
  if (!d || !d.ok){
    if (sum) sum.replaceChildren();
    if (chart) chart.innerHTML = '<div class="us-empty">统计失败：' + esc((d && d.error) || '未知错误') + '</div>';
    if (xlab) xlab.replaceChildren();
    if (table) table.replaceChildren();
    return;
  }
  var t = d.totals || { input: 0, output: 0, cost: 0, count: 0 };
  var hasCost = t.cost > 0;
  if (sum) sum.innerHTML = '输入 <b>' + fmtTok(t.input) + '</b> · 输出 <b>' + fmtTok(t.output) + '</b> · 合计 <b>' + fmtTok(t.input + t.output) + '</b>' + (hasCost ? ' · 花费 <b>$' + t.cost.toFixed(3) + '</b>' : '') + ' · 消息 <b>' + t.count + '</b>';
  var list = d.buckets || [];
  var max = 0;
  list.forEach(function(b){ var v = (b.input || 0) + (b.output || 0); if (v > max) max = v });
  if (chart) chart.innerHTML = list.map(function(b){
    var v = (b.input || 0) + (b.output || 0);
    var h = max > 0 ? Math.max(v > 0 ? 2 : 0, Math.round(v / max * 100)) : 0;
    return '<div class="us-bar" data-label="' + esc(b.label) + '" data-tin="' + (b.input || 0) + '" data-tout="' + (b.output || 0) + '" data-cost="' + (b.cost || 0) + '" data-count="' + (b.count || 0) + '"><i style="height:' + h + '%"></i></div>';
  }).join('');
  var n = list.length, step = Math.max(1, Math.ceil(n / 10));
  if (xlab) xlab.innerHTML = list.map(function(b, i){ return '<span>' + (i % step === 0 ? esc(b.label) : '') + '</span>' }).join('');
  if (table){
    var rows = list.filter(function(b){ return b.count > 0 }).toReversed();
    var cols = hasCost ? 6 : 5;
    var head = '<thead><tr><th>时间</th><th>输入</th><th>输出</th><th>合计</th>' + (hasCost ? '<th>花费</th>' : '') + '<th>消息</th></tr></thead>';
    var bodyHtml = rows.length ? rows.map(function(b){
      return '<tr><td>' + esc(b.label) + '</td><td>' + fmtTok(b.input) + '</td><td>' + fmtTok(b.output) + '</td><td>' + fmtTok((b.input || 0) + (b.output || 0)) + '</td>' + (hasCost ? '<td>' + (b.cost > 0 ? '$' + b.cost.toFixed(3) : '—') + '</td>' : '') + '<td>' + b.count + '</td></tr>';
    }).join('') : '<tr><td colspan="' + cols + '" class="us-empty">该时段暂无记录</td></tr>';
    table.innerHTML = head + '<tbody>' + bodyHtml + '</tbody>';
  }
}

window.USAGE=USAGE; window.USAGE_RANGE=USAGE_RANGE; window.aliasedModelKeys=aliasedModelKeys; window.fmtTok=fmtTok; window.modelLabelById=modelLabelById; window.openUsageStats=openUsageStats; window.closeUsageStats=closeUsageStats; window.fetchUsage=fetchUsage; window.renderUsageStats=renderUsageStats;

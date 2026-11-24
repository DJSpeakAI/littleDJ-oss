/* @module selftest @order 47 @职责 页内自检机器人 @提供 _stBusy _stSeen ST_SUITES stDelay stAssert stSnapshot stSuiteSidebar stSuiteNewProj stSuiteDag stSuiteApiKey stSuitePricing stSuiteBusyReco stSuiteFork stSuiteScrollJump stRun stPoll @依赖 - @依赖运行期 loadProjects S renderSidebar openSettings closeModal skOpenPricing skPricingRows refreshModelOptions aliasOf modelKey reconcileBusySessions BUSY_RECO_TICK_MS BUSY_RECO_QUIET_MS BUSY_RECO_MIN_MS BUSY_RECO_MAX api inferBusy S_ENDED _busyRecoAt _busyRecoBusy scheduleSidebar forkSession CONV_ICON_FORK isHiddenId showCtxMenu hideCtxMenu toast POP_TAB scrollToLastAsk lastUserMsgEl syncScrollBtn _stickBottom @DOM契约 - @严格模式 是 @全局占用 _stBusy _stSeen ST_SUITES stDelay stAssert stSnapshot stSuiteSidebar stSuiteNewProj stSuiteDag stSuiteApiKey stSuitePricing stSuiteBusyReco stSuiteFork stSuiteScrollJump stRun stPoll @源行 ui/index.html L13114-L13439 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task245：页内自检机器人（真浏览器断言，替代假 DOM stub） ----------
   背景（2026-11-12 实测）：设备沙箱里 uitest / snapshot_display / hidumper / playwright 全部不可用，
   没法从外部驱动或截屏；但**这个页面本身就是真浏览器、真 DOM、真数据**——让它自己跑断言，
   再由 proxy 落盘成 JSON 证据，闭环就不需要任何外部驱动。
   用法：`node deploy/selftest-browser.js --suite newproj`（它会 POST /_selftest/request，
   本页 2.5s 轮询接单 → 跑 → POST /_selftest/report → proxy 写 run/selftest/*.json）。
   注意：newproj 套件会真的建一个「ZJ自检xxxxx」项目并在断言后删掉（自检不留垃圾）。 */
var _stBusy = false;
var _stSeen = '';
function stDelay(ms?){ return new Promise(function(r){ setTimeout(r, ms) }) }
function stAssert(arr?, name?, ok?, extra?){ arr.push({ name: name, ok: !!ok, extra: extra == null ? '' : String(extra).slice(0, 300) }) }
function stSnapshot(){
  var rows = $$('#navBody .item.proj-row').map(function(it){ var t = it.querySelector('.t'); return t ? t.textContent : '' });
  var vt = ($('#verText') || {}).textContent || '';
  return {
    ver: (vt.split('· ')[1] || vt).trim(),
    rows: rows,
    convRows: $$('#navBody .item.conv-child').length,
    tuiSect: !!$('#navBody .sect-fold'),
    toast: (($('#toast') || {}).textContent || ''),
    modalOpen: !!($('#overlay') && $('#overlay').classList.contains('open')),
    w: window.innerWidth, h: window.innerHeight,
    url: location.pathname + location.search
  };
}
/* 套件①sidebar：只读断言（最安全，任何页面状态都能跑） */
async function stSuiteSidebar(a){
  var s = stSnapshot();
  stAssert(a, '左栏至少一行项目', s.rows.length >= 1, s.rows.join('|'));
  var seen = {}, dup = [];
  s.rows.forEach(function(n){ if (!n) return; if (seen[n]) dup.push(n); seen[n] = 1 });
  stAssert(a, '项目行无重名（task236-fu1 回归锚）', dup.length === 0, dup.join('|'));
  stAssert(a, '版本区有版本号', /^v\d+\.\d+\.\d+\.\d+$/.test(s.ver), s.ver);
  stAssert(a, 'DAG AI Chat 行可见且有名字（task237 回归锚）', s.rows.indexOf('DAG AI Chat') >= 0, s.rows.join('|'));
  stAssert(a, '页面无 [object Object] 泄漏', document.body.innerText.indexOf('[object Object]') < 0, '');
  stAssert(a, 'TUI 分区在', s.tuiSect, '');
  /* task276：项目行「＋」新建对话按钮——常驻在「N 对话」左侧；排序模式行（只有「完成」）与多选态豁免 */
  var addBad = [], _multi = !!$('#navBody .msel-bar');
  if (!_multi){
    $$('#navBody .item.proj-row').forEach(function(it){
      if (it.querySelector('.sort-done')) return;
      var ab = it.querySelector('.proj-add');
      if (!ab){ addBad.push('缺＋'); return }
      var mEl = it.querySelector('.m');
      if (!mEl || ab.nextElementSibling !== mEl) addBad.push('位置错');
    });
  }
  stAssert(a, '项目行「＋」常驻在「N 对话」左侧（task276）', addBad.length === 0, addBad.join('|'));
  /* task277（主人 2026-11-14）：会话行左移对齐（30px 文字位贴圈 + 0 margin，绿圈/三角落项目三角正下方）+ 项目图标 SVG */
  var _conv0 = $('#navBody .item.conv-child');
  if (_conv0){
    var _cs = getComputedStyle(_conv0);
    stAssert(a, '会话行左移对齐 padding-left:30px / margin-left:0（task277-fu1 文字贴圈）',
      _cs.paddingLeft === '30px' && _cs.marginLeft === '0px', _cs.paddingLeft + '/' + _cs.marginLeft);
  }
  var _pico = $$('#navBody .item.proj-row .proj-ico svg');
  stAssert(a, '项目行图标为 SVG 线稿（task277 换掉 ▦）', _pico.length >= 1, String(_pico.length));
  stAssert(a, '项目页签图标为 SVG 线稿（task277）', !!$$('.nav button[data-view="projects"] .ico svg').length, '');
  /* task299（主人 2026-11-14「这个御史的 UI 也要左对齐」）：子行 lv1 外层归 0、标签徽章与父会话标题同列 30px */
  var _sub0 = $('#navBody .conv-sub.lv1');
  if (_sub0){
    var _ss = getComputedStyle(_sub0);
    stAssert(a, '御史子行左对齐：lv1 margin-left:0 / padding-left:30px（task299）',
      _ss.marginLeft === '0px' && _ss.paddingLeft === '30px', _ss.marginLeft + '/' + _ss.paddingLeft);
  }
  var _stag = $('#navBody .conv-sub.lv1 .conv-sub-tag');
  if (_stag && _stag.closest){
    var _srow = _stag.closest('.conv-sub');
    var _srr = _srow.getBoundingClientRect(), _str = _stag.getBoundingClientRect();
    var _stdx = _str.left - _srr.left;
    stAssert(a, '御史子行徽章列与父会话标题同列 30px（task299）', _srr.width > 0 && Math.abs(_stdx - 30) <= 1, _stdx.toFixed(1) + 'px');
  }
  /* task282（主人 2026-11-14「这几个图标都不在框框的正当中」）：几何居中防复发——按钮背景框中心 vs SVG 中心偏差 ≤1px；
     只量可见元素（⋯/归档/置顶桌面非 hover 时 display:none，rect 全 0 会误报）；字符图标不允许回归（必须 SVG） */
  var _cenBad = [], _cenN = 0;
  $$('#navBody .item-more, #navBody .proj-add, #navBody .conv-act').forEach(function(b){
    var sv = b.querySelector('svg');
    if (!sv){ _cenBad.push('字符图标未换SVG'); return }
    var br = b.getBoundingClientRect(); if (!br.width) return; /* 隐藏态跳过 */
    var sr = sv.getBoundingClientRect();
    var dx = Math.abs((br.left+br.right)/2 - (sr.left+sr.right)/2);
    var dy = Math.abs((br.top+br.bottom)/2 - (sr.top+sr.bottom)/2);
    _cenN++;
    if (dx > 1 || dy > 1) _cenBad.push((b.className.split(' ')[0]||'?') + ':' + dx.toFixed(1) + 'px/' + dy.toFixed(1) + 'px');
  });
  stAssert(a, '小图标按钮几何居中（task282，SVG 中心偏差 ≤1px，实测 ' + _cenN + ' 个）', _cenBad.length === 0, _cenBad.join('|'));
}
/* 套件②newproj：真点一遍「＋新建项目」→ 断言左栏出现 → 自动清理 */
async function stSuiteNewProj(a){
  var nm = 'ZJ自检' + String(Date.now()).slice(-5);
  var inp0 = $('#mkProjName');
  if (!inp0) $('#btnMkProj').click();
  await stDelay(350);
  var inp = $('#mkProjName');
  stAssert(a, '新建项目小窗打开（mkProjName 在）', !!inp, '');
  if (!inp) return;
  inp.value = nm;
  $('#modalOk').click();
  await stDelay(1400);
  var s = stSnapshot();
  var hits = s.rows.filter(function(x){ return x === nm });
  stAssert(a, '新项目出现在左栏且只有一行', hits.length === 1, s.rows.join('|'));
  stAssert(a, '新行高亮 .proj-new 在位（task236-fu2 回归锚）', !!$('#navBody .item.proj-new'), '');
  stAssert(a, 'toast 回执含项目名', s.toast.indexOf(nm) >= 0, s.toast);
  stAssert(a, '弹窗已关闭', !s.modalOpen, '');
  /* 自检不留垃圾：删目录 + 回填列表 */
  try {
    await fetch('/_fs/rmdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: nm }) });
  } catch (e) {}
  await loadProjects();
  if (S.view === 'projects') renderSidebar();
  await stDelay(400);
  stAssert(a, '清理后左栏无自检残留项目', stSnapshot().rows.indexOf(nm) < 0, '');
}
/* 套件③dag：DAG AI Chat 选择链（只读：断言行在 + 有名字） */
async function stSuiteDag(a){
  var s = stSnapshot();
  var row = $$('#navBody .item.proj-row').filter(function(it){ var t = it.querySelector('.t'); return t && t.textContent === 'DAG AI Chat' })[0];
  stAssert(a, 'DAG AI Chat 项目行存在', !!row, s.rows.join('|'));
  stAssert(a, '该行标题非空（HIDE_GROUP_TITLES 未误伤）', !!(row && row.querySelector('.t') && row.querySelector('.t').textContent), '');
  stAssert(a, '该行有项目图标（task277：SVG 线稿）', !!(row && row.querySelector('.proj-ico')), '');
}
/* 套件④apikey（task275）：设置 → API Key 内嵌页真点断言（「右侧空白」回归锚）。
   真浏览器真 DOM：开设置 → 点导航 API Key → 断言列表/标题/两张供应商卡 → 点卡进编辑页 → 返回 → 关弹窗。 */
async function stSuiteApiKey(a){
  openSettings();
  await stDelay(350);
  var navBtns = $$('.settings-nav button');
  var btn = navBtns.filter(function(b){ return b.textContent.indexOf('API Key') >= 0 })[0];
  stAssert(a, '设置一级导航有 API Key 项', !!btn, navBtns.map(function(b){ return b.textContent.trim() }).join('|'));
  if (!btn) return;
  btn.click();
  await stDelay(600);
  var box = $('#keyEmbedBox');
  stAssert(a, '内嵌页容器 #keyEmbedBox 在（task275 白屏回归锚）', !!box, '');
  var title = box ? box.querySelector('.kvls-title') : null;
  stAssert(a, '列表标题「API Key 管理」上屏', !!(title && title.textContent === 'API Key 管理'), title ? title.textContent : (box ? box.textContent.slice(0, 80) : 'no-box'));
  var cards = box ? Array.prototype.slice.call(box.querySelectorAll('.kvls-card')) : [];
  stAssert(a, '三家供应商卡上屏（DeepSeek / GLM / 火山方舟）', cards.length === 3, String(cards.length)); /* task328：火山方舟卡加入 */
  /* task328：火山方舟编辑页回归锚——三卡同款链路里最易漏的是 volc 分支（Key 输入/保存/测试/已存列表/模型下拉缺一即白屏或点了没反应） */
  var volcCard = cards.filter(function(c){ return String(c.textContent || '').indexOf('火山') >= 0 })[0];
  stAssert(a, '火山方舟供应商卡在', !!volcCard, cards.map(function(c){ return String(c.textContent || '').slice(0, 10) }).join('|'));
  if (volcCard) volcCard.click();
  await stDelay(700);
  stAssert(a, '火山编辑页 Key 输入框上屏', !!$('.kv-volc-key'), '');
  stAssert(a, '火山编辑页保存/测试按钮在', !!$('.kv-volc-test'), '');
  stAssert(a, '火山编辑页已存 Key 列表容器在', !!$('.kv-volc-list'), '');
  stAssert(a, '火山编辑页模型下拉在（含自定义接入点项）', !!(function(){ var s = $('.kv-volc-model'); if (!s) return false; for (var i = 0; i < s.options.length; i++) if (s.options[i].value === '__custom__') return true; return false })(), '');
  var backV = $('.key-embed-back');
  if (backV) backV.click();
  await stDelay(500);
  var boxV = $('#keyEmbedBox');
  stAssert(a, '火山页返回后回列表页', !!(boxV && boxV.querySelector('.kvls-card')), '');
  if (cards[0]) cards[0].click();
  await stDelay(700);
  stAssert(a, '点供应商卡切内嵌编辑页（返回行在）', !!$('.key-embed-back'), '');
  stAssert(a, '编辑页仍复用 #keyEmbedBox（两态同容器）', !!$('#keyEmbedBox'), '');
  var back = $('.key-embed-back');
  if (back) back.click();
  await stDelay(500);
  var box2 = $('#keyEmbedBox');
  stAssert(a, '返回后回列表页（供应商卡重新上屏）', !!(box2 && box2.querySelector('.kvls-card')), '');
  closeModal();
  await stDelay(250);
  stAssert(a, '自检后设置弹窗已关闭', !($('#overlay') && $('#overlay').classList.contains('open')), '');
}
/* 套件⑤pricing（task278）：模型比价表格式统一真机断言（网抓数据归一展示回归锚）。
   真浏览器真 DOM：开比价窗 → 渲好后断言「〃」/「免费」/上下文列零长中文 → 关窗。 */
async function stSuitePricing(a){
  var stAliasAsync = []; /* task337 御审二轮 P1-2：别名服务端交互链收集——末尾 await Promise.all，断言必进报告 */
  skOpenPricing();
  await stDelay(1200);
  var box = $('#prTableBox');
  var tbl = box ? box.querySelector('.pr-table') : null;
  stAssert(a, '比价表已渲染（.pr-table 在）', !!tbl, box ? String(box.textContent).slice(0, 60) : 'no-box');
  if (!tbl){ try { closeModal() } catch(e){} return }
  var txt = tbl.innerText || tbl.textContent || '';
  stAssert(a, '上下文列零「输入长度」冗余词（task278 归一）', txt.indexOf('输入长度') < 0, '');
  stAssert(a, '上下文列无「输入 [」半角空格残留（task278 归一）', txt.indexOf('输入 [') < 0, '');
  /* task281 退役 GLM 官方按量源后，〃/免费/[0,32K) 等样例数据可能不存在——改条件断言：数据在则严格验，不在则记 PASS 跳过说明 */
  var rowsNow = skPricingRows();
  var hasCont = rowsNow.some(function(r){ return r._cont });
  var cont = tbl.querySelectorAll('td.pr-cont');
  if (hasCont) stAssert(a, '分段同名续行出现「〃」（task278）', cont.length >= 1, String(cont.length));
  else stAssert(a, '当前数据无分段行，〃 断言跳过（task281 退役按量源后条件化）', true, 'no-cont-row');
  var hasFree = rowsNow.some(function(r){ return r.m && r.m.free });
  var freeTags = Array.prototype.filter.call(tbl.querySelectorAll('.pr-tag'), function(s){ return s.textContent === '免费' });
  if (hasFree) stAssert(a, '免费模型挂「免费」灰标签（task278）', freeTags.length >= 1, String(freeTags.length));
  else stAssert(a, '当前数据无免费模型，免费标签断言跳过', true, 'no-free-model');
  var hasRange = rowsNow.some(function(r){ return /\[0,\s*32K\)/.test(String(r.m && r.m.contextText)) });
  if (hasRange) stAssert(a, '区间文本去空格（存在 [0,32K)，无 [0, 32K)）', txt.indexOf('[0,32K)') >= 0 && txt.indexOf('[0, 32K)') < 0, '');
  else stAssert(a, '当前数据无区间上下文，区间断言跳过', true, 'no-range-ctx');
  /* task283：别名列——表头/输入框/保存按钮存在，且保存按钮真写 localStorage（写后立即还原，不污染主人别名） */
  var aliasTh = tbl.querySelector('th[data-k="alias"]');
  stAssert(a, '别名列存在且紧跟模型列（task283）', !!aliasTh && aliasTh.previousElementSibling && aliasTh.previousElementSibling.getAttribute('data-k') === 'model', aliasTh ? 'th-ok' : 'no-th');
  var alIn = tbl.querySelector('.pr-alias-in'), alBtn = tbl.querySelector('.pr-alias-save');
  stAssert(a, '别名列每行有输入框+保存按钮（task283；task289-fu2 回滚只读化——别名要能设置）', !!alIn && !!alBtn && tbl.querySelectorAll('.pr-alias-in').length === rowsNow.length, 'in=' + tbl.querySelectorAll('.pr-alias-in').length + ' expect=' + rowsNow.length);
  if (alIn && alBtn){
    /* task337：别名单源化改造——快照/写入/还原全走 getModelAliases/setModelAliases（服务端 /_model-alias），
       不再直接碰 localStorage。御审 P1-1 门槛：单源未水化（syncModelAliasBoot 未完成）时跳过写类断言，
       防止空快照还原清空服务端。御审二轮 P1-2：服务端交互链全部串成 Promise 并 push 进 stAliasAsync，
       由 stSuitePricing 末尾 Promise.all 返回——stRun 的 await fn() 会等齐，断言必进报告（不再假绿）；
       还原必须等「保存上行真实落库」确认后才发（防乱序/防终态 GET 早到）。 */
    if (!aliasSynced()) stAssert(a, '别名单源未水化，别名保存断言跳过（御审 P1-1 门槛）', true, 'no-alias-sync');
    else {
    var oldAliasSnap = JSON.stringify(getModelAliases()), oldAliasVal = alIn.value, ak = alIn.getAttribute('data-ak');
    alIn.value = '__st_alias__';
    try { alIn.dispatchEvent(new Event('input', { bubbles: true })) } catch(e){}
    stAssert(a, '改值后保存按钮发亮（task285 脏标记）', alBtn.classList.contains('dirty'), 'cls=' + alBtn.className);
    alBtn.click();
    stAssert(a, '保存后保存按钮回默认色（task285）', !alBtn.classList.contains('dirty'), 'cls=' + alBtn.className);
    stAssert(a, '保存按钮写入别名单源 getModelAliases（task283 出入口→task337 服务端单源）', getModelAliases()[ak] === '__st_alias__', String(ak));
    /* task289-fu2（主人裁决「以别名为准」）：保存后该模型必须立即出现在下拉且显示别名——
       没别名=不显示，起别名=进下拉（这条断言就是主人语义的机械闸，不放水） */
    var optAkTxt = null;
    Array.prototype.forEach.call($('#modelSel').options, function(o){ if (o.value === ak) optAkTxt = o.textContent });
    if (S.models && S.models.length) stAssert(a, '保存后该模型立即出现在输入框下拉并显示别名（以别名为准，task289-fu2）', optAkTxt === '__st_alias__', String(optAkTxt));
    else stAssert(a, '模型列表未加载，下拉命中断言跳过', true, 'no-models');
    alIn.value = oldAliasVal;
    var optAkTxt2 = null; /* 先看「还原前」下拉（此时内存仍含测试别名）——还原后下拉断言挪进服务端链（还原真实发生后） */
    /* 御审二轮 P1-2：save(POST#1) → 轮询确认服务端真含 __st_alias__ → 才发还原(POST#2) → 终态 GET=原快照 */
    var waitSrvHas = function(key?, tries?){
      tries = (tries == null) ? 6 : tries;
      return fetch('/_model-alias').then(function(r){ return r.json() }).then(function(d){
        if (d && d.ok && d.alias && d.alias[key]) return true;
        if (tries <= 1) return false;
        return new Promise(function(res){ setTimeout(res, 350) }).then(function(){ return waitSrvHas(key, tries - 1) });
      }).catch(function(){ return false });
    };
    stAliasAsync.push(
      waitSrvHas(ak).then(function(hit){
        stAssert(a as any, '保存上行真实落库（服务端轮询可见测试别名，御审二轮 P1-2）', hit === true, String(hit));
        var rp = null;
        try { rp = setModelAliases(JSON.parse(oldAliasSnap || '{}')) } catch(e){ rp = null }
        return rp || Promise.resolve(false);
      }).then(function(){
        return fetch('/_model-alias').then(function(r){ return r.json() });
      }).then(function(d){
        var nowSrv = (d && d.ok && d.alias) ? JSON.stringify(d.alias) : null;
        var optAkTxt3 = null;
        Array.prototype.forEach.call($('#modelSel').options, function(o){ if (o.value === ak) optAkTxt3 = o.textContent });
        stAssert(a, '还原别名后下拉不再显示测试别名（以别名为准反向验证，task289-fu2）', optAkTxt3 !== '__st_alias__', String(optAkTxt3));
        stAssert(a, '别名自检后已还原（不污染真实别名单源·内存态）', JSON.stringify(getModelAliases()) === oldAliasSnap, '');
        stAssert(a, '别名自测服务端终态=原快照（两笔上行真实落库且保序，御审 P1-1/二轮 P1-2）', nowSrv === oldAliasSnap, String(nowSrv == null ? 'srv-bad' : nowSrv.slice(0, 40)));
      }).catch(function(e){
        stAssert(a, '别名自测服务端链异常：' + (e && e.message), false, '');
      })
    );
    }
  }
  /* task289-fu2（主人裁决「以别名为准」）：[1m] 行输入框恢复 + 下拉=别名清单 真机闭环 */
  try {
    var lmRows2 = rowsNow.filter(function(r){ return /\[1m\]$/.test(String(r.m && r.m.name || '')) });
    if (lmRows2.length){
      var lmIns2 = 0;
      Array.prototype.forEach.call(tbl.querySelectorAll('.pr-alias-in'), function(x){ if (/\[1m\]$/.test(String(x.getAttribute('data-ak') || ''))) lmIns2++ });
      stAssert(a, '[1m] 行别名输入框已恢复（task289-fu2 回滚只读化——别名要能设置）', lmIns2 >= 1, 'lmIns=' + lmIns2);
    } else stAssert(a, '当前数据无 [1m] 拆行，输入框恢复断言跳过', true, 'no-lm-row');
    /* 下拉选项数=有別名的模型数（+当前模型无別名时的兜底项） */
    var msAll = S.models || [];
    var aliasedN = msAll.filter(function(m){ return !!aliasOf(m) }).length;
    if (aliasedN && msAll.length){
      var curHasAlias = !!(S.model && msAll.some(function(m){ return m.providerID === S.model.providerID && m.modelID === S.model.modelID && !!aliasOf(m) }));
      var expectN = aliasedN + (curHasAlias ? 0 : 1);
      var optN = $('#modelSel').options.length;
      stAssert(a, '下拉选项数=已起别名的模型数（以别名为准，task289-fu2）', optN === expectN, 'opt=' + optN + ' expect=' + expectN + ' aliased=' + aliasedN);
    } else stAssert(a, '暂无别名/模型列表，下拉过滤计数断言跳过', true, 'no-alias');
    /* 起别名 → 立即进下拉；清别名 → 立即出下拉（写后还原，不污染主人别名） */
    var noAliasM = null;
    for (var mi2 = 0; mi2 < msAll.length; mi2++){
      var m0 = msAll[mi2];
      if (aliasOf(m0)) continue;
      if (S.model && m0.providerID === S.model.providerID && m0.modelID === S.model.modelID) continue;
      noAliasM = m0; break;
    }
    if (noAliasM){
      /* task337：别名单源化——快照/写入/还原全走 getModelAliases/setModelAliases（御审 P1-1：
         水化门槛 + 三笔上行 Promise 链保序 + 链尾服务端终态复核） */
      if (!aliasSynced()) stAssert(a, '别名单源未水化，起别名进下拉断言跳过（御审 P1-1 门槛）', true, 'no-alias-sync');
      else {
      var snapBak4 = JSON.stringify(getModelAliases());
      var o4 = getModelAliases();
      var pickKey = modelKey(noAliasM.providerID, noAliasM.modelID);
      o4[pickKey] = '__st_pick__';
      var p4a = setModelAliases(structuredClone(o4));
      var hitOpt = null;
      Array.prototype.forEach.call($('#modelSel').options, function(o){ if (o.value === pickKey) hitOpt = o.textContent });
      stAssert(a, '起别名的模型立即进下拉并显示别名（task289-fu2）', hitOpt === '__st_pick__', String(hitOpt));
      delete o4[pickKey];
      var p4b = setModelAliases(structuredClone(o4));
      var goneOpt = null;
      Array.prototype.forEach.call($('#modelSel').options, function(o){ if (o.value === pickKey) goneOpt = o.textContent });
      stAssert(a, '清别名后该模型从下拉消失（不需要用=不显示，task289-fu2）', goneOpt == null, String(goneOpt));
      var p4r = null;
      try { p4r = setModelAliases(JSON.parse(snapBak4 || '{}')) } catch(e){ p4r = null }
      stAliasAsync.push(p4a.then(function(){ return p4b }).then(function(){ return p4r || Promise.resolve(false) }).then(function(){
        return fetch('/_model-alias').then(function(r){ return r.json() });
      }).then(function(d){
        stAssert(a, '起/清别名服务端终态=原快照（三笔上行保序落库，御审 P1-1/二轮 P1-2）', !!(d && d.ok && JSON.stringify(d.alias) === snapBak4), '');
      }).catch(function(e){ stAssert(a, '起/清别名服务端终态复核异常：' + (e && e.message), false, ''); }));
      }
    } else stAssert(a, '无空闲无别名模型，起别名进下拉断言跳过', true, 'no-free');
  } catch(e){ stAssert(a, 'task289-fu2 [1m]/下拉过滤断言执行异常：' + (e && e.message), false, '') }
  /* 御审二轮 P1-2：等齐全部别名服务端交互链（保存落库确认→还原→终态复核），断言必进报告再关弹窗 */
  if (stAliasAsync.length) { try { await Promise.all(stAliasAsync) } catch(e){} }
  try { closeModal() } catch(e){}
  await stDelay(300);
  stAssert(a, '自检后比价弹窗已关闭', !($('#overlay') && $('#overlay').classList.contains('open')), '');
}
/* task307：挂圈会话对账自检——注入假忙态，验证「无事件 + 已结束 → 对账清圈」链路（写后立即还原） */
async function stSuiteBusyReco(a){
  stAssert(a, '对账函数已定义（task307）', typeof reconcileBusySessions === 'function', '');
  stAssert(a, '对账参数就位（tick/quiet/min/max）', BUSY_RECO_TICK_MS > 0 && BUSY_RECO_QUIET_MS > 0 && BUSY_RECO_MIN_MS > 0 && BUSY_RECO_MAX > 0, [BUSY_RECO_TICK_MS, BUSY_RECO_QUIET_MS, BUSY_RECO_MIN_MS, BUSY_RECO_MAX].join('/'));
  var pool = (S.sessions || []).filter(function(s){ return s && s.id && !s.parentID && (!S.current || s.id !== S.current.id) });
  if (!pool.length){ stAssert(a, '无候选根会话，对账链路断言跳过', true, 'no-session'); return }
  var hit = null;
  for (var i = 0; i < pool.length && i < 3; i++){
    try { var m = await api('/session/' + encodeURIComponent(pool[i].id) + '/message'); if (!inferBusy(m)){ hit = pool[i]; break } } catch(e){}
  }
  if (!hit){ stAssert(a, '候选会话都在跑或不可达，对账链路断言跳过', true, 'live-skip'); return }
  var sid = hit.id;
  var hadBusy = !!S.busyBy[sid], hadEnded = !!S_ENDED[sid], hadEv = S.busyEvAt[sid], hadAt = _busyRecoAt[sid];
  S.busyBy[sid] = true; S.busyEvAt[sid] = 0; _busyRecoAt[sid] = 0; delete S_ENDED[sid]; delete _busyRecoBusy[sid];
  scheduleSidebar();
  try {
    reconcileBusySessions();
    await stDelay(2500);
    stAssert(a, '无事件+已结束的假忙态被对账清除（task307 主诉）', !S.busyBy[sid], 'busy=' + !!S.busyBy[sid]);
    stAssert(a, '清忙同时补记 S_ENDED 终局证据', !!S_ENDED[sid], '');
  } finally {
    S.busyBy[sid] = hadBusy; S.busyEvAt[sid] = hadEv; _busyRecoAt[sid] = hadAt;
    if (hadEnded) S_ENDED[sid] = 1; else delete S_ENDED[sid];
    scheduleSidebar();
  }
}
/* 套件 fork（task314-fork）：分叉入口只读防复发——菜单项在、顺序对、消息操作行有按钮+SVG。
   不真建会话（避免自检污染左栏）；真机全链 E2E 由外部 CDP 验证。 */
async function stSuiteFork(a){
  stAssert(a, '分叉函数 forkSession 在（task314）', typeof forkSession === 'function', '');
  stAssert(a, '分叉图标常量 CONV_ICON_FORK 在（task314）', typeof CONV_ICON_FORK === 'string' && CONV_ICON_FORK.indexOf('<svg') === 0, '');
  var sess = (S.sessions || []).filter(function(x){ return x && !x.parentID && !isHiddenId(x.id) })[0];
  if (sess){
    showCtxMenu(24, 24, sess);
    var labels = $$('#ctxMenu button').map(function(b){ return (b.textContent || '').trim() }); /* task314-fu2：$$ 被 replace 特殊替换吃掉，补回 */
    hideCtxMenu();
    stAssert(a, '⋯ 菜单含「分叉会话」（task314）', labels.indexOf('分叉会话') >= 0, labels.join('|'));
    stAssert(a, '⋯ 菜单顺序：归档第一、分叉紧跟重命名（task314/task305）',
      labels[0] === '归档' && labels.indexOf('分叉会话') === labels.indexOf('重命名对话') + 1, labels.join('|'));
  } else stAssert(a, '会话列表为空，菜单断言跳过（task314）', true, 'no-session');
  var rows = $$('#messages .msg').filter(function(m){ return m.querySelector('.acts') });
  var fbs = $$('#messages .msg .acts button[data-act="fork"]');
  stAssert(a, 'assistant 消息操作行都带分叉按钮（task314）', rows.length === 0 || fbs.length === rows.length, fbs.length + '/' + rows.length);
  if (fbs.length) stAssert(a, '分叉按钮挂 SVG 图标（task314）', !!fbs[0].querySelector('svg'), '');
}
/* 套件 scrolljump（task356）：↑ 回跳最近一次提问——按钮在/显隐语义对/点击真跳回。
   只临时改 scrollTop 并还原，不插 DOM、不建会话；当前会话无用户消息或不可滚动时跳过回跳段。 */
async function stSuiteScrollJump(a){
  var b = $('#messages'), up = $('#btnScrollUp'), down = $('#btnScrollDown');
  stAssert(a, '↑ 按钮存在且 title=回到最近一次提问', !!(up && up.title === '回到最近一次提问'), up && up.title);
  stAssert(a, '↓ 按钮保留', !!(down && down.title === '回到底部'), '');
  stAssert(a, 'scrollToLastAsk/lastUserMsgEl 已挂载', typeof scrollToLastAsk === 'function' && typeof lastUserMsgEl === 'function', '');
  if (!b || !up) return;
  stAssert(a, '贴底时 ↑ 隐藏', up.classList.contains('show') === false, up.className);
  var u = lastUserMsgEl();
  if (!u) { stAssert(a, '当前会话无用户消息，回跳断言跳过', true, 'no-user-msg'); return }
  var origTop = b.scrollTop, origStick = _stickBottom;
  try {
    b.scrollTop = 0;
    syncScrollBtn();
    var dTop = u.getBoundingClientRect().top - b.getBoundingClientRect().top;
    var wantShow = dTop < -8;
    stAssert(a, '顶部时 ↑ 显隐符合语义', up.classList.contains('show') === wantShow,
      'show=' + up.classList.contains('show') + ' dTop=' + Math.round(dTop) + ' want=' + wantShow);
    if (!wantShow) return;
    scrollToLastAsk();
    await stDelay(900);
    var back = u.getBoundingClientRect().top - b.getBoundingClientRect().top;
    stAssert(a, '点击后最近提问回到视口附近', Math.abs(back) <= 80, 'dTop=' + Math.round(back) + ' scrollTop=' + b.scrollTop);
  } finally {
    b.scrollTop = origTop; _stickBottom = origStick; syncScrollBtn();
  }
}
var ST_SUITES: any = { sidebar: stSuiteSidebar, newproj: stSuiteNewProj, dag: stSuiteDag, apikey: stSuiteApiKey, pricing: stSuitePricing, busyreco: stSuiteBusyReco , fork: stSuiteFork, scrolljump: stSuiteScrollJump };
async function stRun(reqObj){
  var suite = String(reqObj && reqObj.suite || '');
  var fn = ST_SUITES[suite];
  var assertions = [];
  var snap0 = stSnapshot();
  if (!fn) stAssert(assertions, '未知套件：' + suite, false, Object.keys(ST_SUITES).join(','));
  else { try { await fn(assertions) } catch (e) { stAssert(assertions, '套件异常：' + (e && e.message), false, String(e)) } }
  var pass = assertions.length > 0 && assertions.every(function(x){ return x.ok });
  var payload = { id: reqObj && reqObj.id, suite: suite, pass: pass, assertions: assertions, snapshot: stSnapshot(), ua: navigator.userAgent };
  try { await fetch('/_selftest/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch (e) {}
  try { toast('页内自检 [' + suite + '] ' + (pass ? '通过' : '失败'), !pass, 4000) } catch (e) {}
  return { pass: pass, assertions: assertions, before: snap0 };
}
function stPoll(){
  if (_stBusy || document.hidden || POP_TAB) return;
  fetch('/_selftest/pending').then(function(r){ return r.json() }).then(function(d){
    var q = d && d.request;
    if (!q || !q.id || _stBusy || q.id === _stSeen) return;
    _stBusy = true; _stSeen = q.id;
    stRun(q).catch(function(){}).then(function(){ _stBusy = false });
  }).catch(function(){});
}
window._stBusy=_stBusy; window._stSeen=_stSeen; window.ST_SUITES=ST_SUITES; window.stDelay=stDelay; window.stAssert=stAssert; window.stSnapshot=stSnapshot; window.stSuiteSidebar=stSuiteSidebar; window.stSuiteNewProj=stSuiteNewProj; window.stSuiteDag=stSuiteDag; window.stSuiteApiKey=stSuiteApiKey; window.stSuitePricing=stSuitePricing; window.stSuiteBusyReco=stSuiteBusyReco; window.stSuiteFork=stSuiteFork; window.stSuiteScrollJump=stSuiteScrollJump; window.stRun=stRun; window.stPoll=stPoll;

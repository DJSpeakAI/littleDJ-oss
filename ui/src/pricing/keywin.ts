/* @module keywin @order 42 @职责 比价 Key 视图 + 档案表 + 密码本选取导入 Key（task331） @提供 skKvModelOptions skKvAliasKey skKvAliasFill skKvSaveAlias skKvSaveCtx skKvSaveKey skKvCard skKvCtxCard skRenderProvList skRenderKeyWin skRenderPricing popoutFitOnce skRenderTable prAliasDirtySync prSaveAliasRow prSyncAliasRows prBindAlias prBindProvLinks prColDefs prOrder prWidthOf prSaveCols prRerender skProvId prAliasKeyOf prCell prBindHead prDropMark prDropIndex prThDown prMoveCol prGripDown prColMenu prColMenuOut prColMenuClose fetchProfile saveProfile profileItemRow renderProfile skVpOpen skVpClose skVpGuard skVpEsc skVpApply @依赖 - @依赖运行期 zpModelList skKvEl getModelAliases refreshModelOptions getContextK updateUsage S skKvDraftSet setDsTestResult setZpTestResult setVolcTestResult SETTINGS testDeepseek loadDsSettings skKvList fetchBalance skKvBalance testZhipu loadZpSettings fetchZhipuQuota skKvDraftGet closeModal openUsageStats popoutOpen skKvKeys renderSettings popoutOpenKey POP_TAB renderZpQuota SK prBoxIdOf toast skPricingRows PRMETA prNormCtx skPriceSpanU PRUI PROFILE fmtTime profileDimData navRestoreScroll profileDimMeta el $ @DOM契约 #skVpPanel @严格模式 是 @全局占用 skKvModelOptions skKvAliasKey skKvAliasFill skKvSaveAlias skKvSaveCtx skKvSaveKey skKvCard skKvCtxCard skRenderProvList skRenderKeyWin skRenderPricing popoutFitOnce skRenderTable prAliasDirtySync prSaveAliasRow prSyncAliasRows prBindAlias prBindProvLinks prColDefs prOrder prWidthOf prSaveCols prRerender skProvId prAliasKeyOf prCell prBindHead prDropMark prDropIndex prThDown prMoveCol prGripDown prColMenu prColMenuOut prColMenuClose fetchProfile saveProfile profileItemRow renderProfile skVpOpen skVpClose skVpGuard skVpEsc skVpApply @源行 ui/index.html L11402-L12184 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task214：比价页「⚿ Key」视图（API Key 管理整合，设置页 API 子页退役后的唯一入口） ----------
   设计：按供应商两组独立卡片（DeepSeek 官方 / GLM Token Plan，概念不同天然分开）+ 通用上下文兜底区块。
   复用既有 /_settings/* 后端路由与既有操作函数（已容器化，scope=wrapId，三入口 DOM 隔离）。
   草稿：name/key 走 SK.kvDraft 内存回填（切视图/重渲/关弹窗重开不丢，页面刷新才丢）。 */
function skKvModelOptions(prov?){
  if (prov === 'ds') return [['deepseek-flash', 'Flash（V4.1-Flash）'], ['deepseek-v4-pro', 'Pro（V4 Pro）']];
  if (prov === 'volc') return volcModelList(); /* task328：火山方舟（豆包）；测试连接后并入账号可见模型 */
  return zpModelList().map(function(m){ return [m.modelID, m.name] });
}
function skKvAliasKey(prov?, mid?){
  if (prov === 'volc') return 'volcengine/' + mid; /* task328：与 serve providerID 对齐（volcengine） */
  return (prov === 'ds' ? 'deepseek/' : 'zhipuai-coding-plan/') + mid;
}
function skKvAliasFill(prov?, scope?){
  var mEl = skKvEl(scope, 'kv-' + prov + '-model'), aEl = skKvEl(scope, 'kv-' + prov + '-alias');
  if (!mEl || !aEl) return;
  aEl.value = String(getModelAliases()[skKvAliasKey(prov, mEl.value)] || '');
}
function skKvSaveAlias(prov?, scope?){
  var mEl = skKvEl(scope, 'kv-' + prov + '-model'), aEl = skKvEl(scope, 'kv-' + prov + '-alias');
  if (!mEl || !aEl) return;
  if (!aliasSynced()){ toast('别名同步未完成（网络/代理异常），请刷新页面后重试'); return }
  var al = getModelAliases(), pk = skKvAliasKey(prov, mEl.value), v = aEl.value.trim();
  if (v) al[pk] = v; else delete al[pk];
  var sent = setModelAliases(al); /* task337：内存即更+上行服务端；task343：显式保存按钮/回车触发，不再 oninput 逐字写 */
  if (sent && sent.then) sent.then(function(up){
    if (up && up.ok) toast(v ? '别名已保存' : '别名已清除');
    else { try { aEl.value = String(getModelAliases()[pk] || '') } catch(e){} }
  }, function(){});
}
function skKvSaveCtx(scope?){
  var c = skKvEl(scope, 'kv-ctx'); if (!c) return;
  var v = parseInt(c.value, 10); if (!(v > 0)) v = getContextK();
  try { localStorage.setItem('littledj.contextK', String(v)) } catch(e){}
  updateUsage(S.lastMsgs || []);
}
function skKvSaveKey(prov?, scope?){
  var isDs = prov === 'ds';
  var isVolc = prov === 'volc';
  var nEl = skKvEl(scope, 'kv-' + prov + '-name'), kEl = skKvEl(scope, 'kv-' + prov + '-key');
  var name = nEl ? nEl.value.trim() : '', key = kEl ? kEl.value.trim() : '';
  skKvDraftSet(prov, 'name', name); skKvDraftSet(prov, 'key', key);
  skKvSaveCtx(scope);
  var res = function(cls, txt){
    if (isDs) setDsTestResult(cls, txt, scope);
    else if (isVolc) setVolcTestResult(cls, txt, scope);
    else setZpTestResult(cls, txt, scope);
  };
  if (!key){ res('ok', '✓ 已保存（未填新 Key，Key 未改动）'); return }
  var url = isDs ? '/_settings/deepseek' : (isVolc ? '/_settings/volc' : '/_settings/zhipu');
  fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: key, name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (d.error){ res('err', '✕ 保存失败：' + d.error); return }
    if (kEl) kEl.value = ''; if (nEl) nEl.value = '';
    skKvDraftSet(prov, 'key', ''); skKvDraftSet(prov, 'name', '');
    var st = { configured: true, masked: d.masked, active: d.active };
    if (isDs){
      SETTINGS.ds = st;
      res('ok', '✓ 已保存，正在自动验证…');
      testDeepseek(key, scope);
      loadDsSettings(function(){ skKvList(scope, 'ds') });
      fetchBalance(function(){ skKvBalance(scope) });
    } else if (isVolc) {
      SETTINGS.volc = st;
      res('ok', '✓ 已保存，正在自动验证…');
      testVolc(key, scope);
      loadVolcSettings(function(){ skKvList(scope, 'volc') });
    } else {
      SETTINGS.zp = st;
      res('ok', '✓ 已保存，正在自动验证…');
      testZhipu(key, scope);
      loadZpSettings(function(){ skKvList(scope, 'zp') });
      fetchZhipuQuota(null, scope);
    }
  }).catch(function(e){ res('err', '✕ 保存失败：' + e.message) });
}
function skKvCard(prov?, wrapId?){
  var isDs = prov === 'ds';
  var isVolc = prov === 'volc';
  var card = el('div', 'keycard');
  /* 卡片头：供应商名 + 接口 + 余额/额度刷新 */
  var head = el('div', 'kc-head');
  head.appendChild(el('b', null, isDs ? 'DeepSeek 官方' : (isVolc ? '火山方舟（火山引擎）' : 'GLM Token Plan')));
  head.appendChild(el('span', 'kc-api', isDs ? 'api.deepseek.com' : (isVolc ? 'ark.cn-beijing.volces.com/api/v3' : 'api/coding/paas/v4')));
  if (isDs) head.appendChild(el('span', 'kc-bal kv-ds-balance', S.balance ? ('余额 ' + S.balance) : '余额 —'));
  var rf = el('button', 'guard-btn kc-rf', '⟳');
  rf.title = isDs ? '刷新余额（大屏页无自动轮询，手动刷新）' : (isVolc ? '重新验证连接（火山无余额接口，刷新=再测一次 Key）' : '刷新 Token Plan 额度（大屏页无自动轮询，手动刷新）');
  rf.onclick = function(){
    if (isDs) fetchBalance(function(){ skKvBalance(wrapId) });
    else if (isVolc) testVolc(null, wrapId);
    else fetchZhipuQuota(null, wrapId);
  };
  head.appendChild(rf);
  card.appendChild(head);
  /* GLM 额度双进度条 */
  if (prov === 'zp'){
    var qc = el('div', 'quotacard');
    [['kv-zp-q5val', 'kv-zp-q5bar', 'kv-zp-q5sub', '5 小时额度'], ['kv-zp-qwval', 'kv-zp-qwbar', 'kv-zp-qwsub', '本周额度']].forEach(function(cfg){
      var qr = el('div', 'qrow');
      qr.appendChild(el('span', 'qlab', cfg[3]));
      var qb = el('div', 'qbar');
      var qi = el('i', cfg[1]); qi.style.width = '0%';
      qb.appendChild(qi);
      qr.appendChild(qb);
      qr.appendChild(el('span', 'qval ' + cfg[0], '—'));
      qc.appendChild(qr);
      qc.appendChild(el('div', 'qsub ' + cfg[2], ''));
    });
    card.appendChild(qc);
  }
  /* 新增 Key 行 */
  var row1 = el('div', 'kc-row');
  var nInp = el('input', 'kv-' + prov + '-name');
  nInp.placeholder = '名字/代号（如：主人、备用）'; nInp.autocomplete = 'off';
  nInp.value = skKvDraftGet(prov, 'name');
  nInp.oninput = function(){ skKvDraftSet(prov, 'name', nInp.value) };
  var kInp = el('input', 'kv-' + prov + '-key');
  kInp.placeholder = isDs ? '输入新的 DeepSeek Key（留空不改）' : (isVolc ? '输入新的火山方舟 Key（留空不改）' : '输入新的智谱 Key（留空不改）');
  kInp.autocomplete = 'off';
  kInp.value = skKvDraftGet(prov, 'key');
  kInp.oninput = function(){ skKvDraftSet(prov, 'key', kInp.value) };
  var sb = el('button', 'guard-btn kv-save', '保存 Key');
  sb.onclick = function(){ skKvSaveKey(prov, wrapId) };
  /* task331：密码本选取导入——免复制粘贴，服务端直接落 Key */
  var vp = el('button', 'guard-btn kv-vpick', '🔑 密码本');
  vp.title = '从密码本里选一条直接导入为 Key（不用复制粘贴）';
  vp.onclick = function(){ skVpOpen(prov, wrapId, vp) };
  var tb = el('button', 'test-btn kv-' + prov + '-test', '测试连接');
  tb.onclick = function(){
    if (isDs) testDeepseek(null, wrapId);
    else if (isVolc) testVolc(null, wrapId);
    else testZhipu(null, wrapId);
  };
  row1.appendChild(nInp); row1.appendChild(kInp); row1.appendChild(vp); row1.appendChild(sb); row1.appendChild(tb);
  card.appendChild(row1);
  card.appendChild(el('div', 'test-result kv-' + prov + '-result', ''));
  /* 已存 Key 列表 */
  card.appendChild(el('div', 'settings-sub', '已保存的 Key（点击名字即切换使用并自动填入）'));
  card.appendChild(el('div', 'keylist kv-' + prov + '-list'));
  /* 模型 + 别名（只选看/改别名的模型，不切主模型） */
  var row2 = el('div', 'kc-row');
  row2.appendChild(el('span', 'dlab', '模型'));
  var msel = document.createElement('select');
  msel.className = 'kv-' + prov + '-model';
  var curPid = isDs ? 'deepseek' : (isVolc ? 'volcengine' : 'zhipuai-coding-plan');
  var curMid = (S.model && S.model.providerID === curPid) ? S.model.modelID : '';
  skKvModelOptions(prov).forEach(function(pair){
    var o = document.createElement('option');
    o.value = pair[0]; o.textContent = pair[1];
    if ((curMid || pair[0]) === pair[0]) o.selected = true;
    msel.appendChild(o);
  });
  if (isVolc){
    /* task328：火山方舟支持推理接入点（ep-xxx）/新模型 ID 自行填写——下拉末项「自定义」由 prompt 补录 */
    var oc = document.createElement('option'); oc.value = '__custom__'; oc.textContent = '自定义接入点/模型 ID…';
    msel.appendChild(oc);
    if (curMid && !skKvModelOptions(prov).some(function(p){ return p[0] === curMid })){
      var ox = document.createElement('option'); ox.value = curMid; ox.textContent = curMid;
      msel.insertBefore(ox, oc); msel.value = curMid;
    }
  }
  msel.onchange = function(){
    if (isVolc && msel.value === '__custom__'){
      var prev = msel.getAttribute('data-prev') || '';
      var id = window.prompt('输入火山方舟的推理接入点 ID（ep-…）或模型 ID（如 doubao-seed-1-6-250615）：', '');
      id = String(id || '').trim();
      if (!id){ msel.value = prev; return }
      var ex = null;
      for (var i = 0; i < msel.options.length; i++){ if (msel.options[i].value === id) { ex = msel.options[i]; break } }
      if (!ex){
        ex = document.createElement('option'); ex.value = id; ex.textContent = id;
        msel.insertBefore(ex, msel.querySelector('option[value="__custom__"]'));
      }
      msel.value = id;
    }
    msel.setAttribute('data-prev', msel.value);
    skKvAliasFill(prov, wrapId);
  };
  msel.setAttribute('data-prev', msel.value);
  row2.appendChild(msel);
  row2.appendChild(el('span', 'dlab', '别名'));
  var aInp = el('input', 'kv-' + prov + '-alias');
  aInp.placeholder = '给该模型起别名（显示在顶栏下拉）'; aInp.autocomplete = 'off'; aInp.maxLength = 64; /* task337 御审 P2-5：与服务端值截断上限一致 */
  aInp.value = String(getModelAliases()[skKvAliasKey(prov, msel.value)] || '');
  aInp.onkeydown = function(ev){ if (ev && ev.isComposing) return; if (ev && ev.key === 'Enter'){ ev.preventDefault(); skKvSaveAlias(prov, wrapId) } };
  var aBtn = el('button', 'pr-alias-save kv-' + prov + '-alias-save', '保存');
  aBtn.title = '保存别名（同步到服务端，跨设备生效）';
  aBtn.onclick = function(){ skKvSaveAlias(prov, wrapId) };
  row2.appendChild(aInp);
  row2.appendChild(aBtn);
  card.appendChild(row2);
  if (isDs){ /* task214 产出审 P0-1：用量统计入口（原设置页两子页按钮随退役删除，此处补回；全屏层复用 openUsageStats） */
    var urow = el('div', 'kc-row');
    var ub = el('button', 'guard-btn kv-usage', '📊 用量统计');
    ub.title = '按小时/天/周/月查看 tokens 与花费（仅统计已起别名的模型）';
    ub.onclick = function(){ closeModal(); openUsageStats() };
    urow.appendChild(ub);
    urow.appendChild(el('span', 'test-result', '按小时 / 天 / 周 / 月查看 tokens 与花费'));
    card.appendChild(urow);
    /* task349（主人：「API Key 的 DeepSeek 里面加 TTS 内容，不要单独拎出来」）：
       语音合成并入本卡——与对话共用本页 Key（代理端 dsActiveKey 自动取），音色作用于消息播报 🔊 + 语音对话朗读。 */
    var trow = el('div', 'kc-row');
    trow.appendChild(el('span', 'dlab', '语音合成（TTS）'));
    var tsel = document.createElement('select');
    tsel.className = 'kv-ds-ttsvoice';
    tsel.title = 'DeepSeek TTS 音色：消息播报 🔊 与语音对话朗读都用它';
    [['female', '女声 · Stella（默认）'], ['male', '男声 · Tide']].forEach(function(pair){
      var o = document.createElement('option'); o.value = pair[0]; o.textContent = pair[1]; tsel.appendChild(o);
    });
    var tG = 'female'; try { tG = localStorage.getItem('littledj.msgSpeakVoice') === 'male' ? 'male' : 'female' } catch(e){}
    tsel.value = tG;
    tsel.onchange = function(){ try { localStorage.setItem('littledj.msgSpeakVoice', tsel.value) } catch(e){} };
    trow.appendChild(tsel);
    var tpb = el('button', 'guard-btn kv-ds-ttsplay', '▶ 试听');
    tpb.onclick = function(){
      var voice = tsel.value === 'male' ? 'tide' : 'stella';
      var oldT = tpb.textContent;
      tpb.disabled = true; tpb.textContent = '合成中…';
      fetch('/_voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '主人你好，我是 DeepSeek 语音，和对话用的是同一个 Key。', voice: voice, providerId: 'deepseek' }) })
        .then(function(r){
          if (!r.ok) return r.json().catch(function(){ return null }).then(function(j){ throw new Error((j && j.error) || ('HTTP ' + r.status)) });
          return r.blob();
        })
        .then(function(blob){ tpb.disabled = false; tpb.textContent = oldT; playVoiceAudio(blob, null, 1) })
        .catch(function(e){ tpb.disabled = false; tpb.textContent = oldT; toast('试听失败：' + ((e && e.message) || e), true) });
    };
    trow.appendChild(tpb);
    card.appendChild(trow);
    card.appendChild(el('div', 'test-result', '语音合成与对话共用本页 DeepSeek Key（无需另填）；音色同时作用于消息播报 🔊 与语音对话朗读。'));
  }
  if (isVolc){
    /* task328（主人 2026-11-15 口述：API Key 管理里加火山 Key 输入，方式与 DS 一致）；
       火山没有余额/积分查询接口，这里挂一条口径说明，防把「无余额」误解为「没保存」 */
    card.appendChild(el('div', 'test-result', '火山方舟无余额查询接口；测试连接 = 校验 Key 并拉取账号可见模型清单。Key 只存本机 config/volc-keys.json（600、不入 git）'));
    card.appendChild(el('div', 'test-result', '当前先收 Key 与别名；火山模型进顶栏下拉还需放开前端模型白名单（serve 侧 volcengine provider 已在册），等主人发话'));
    /* task349（比价 TTS 行→供应商 Key 窗全链有 TTS 内容）：火山 TTS 音色/资源在 TTS 页火山卡，这里给直达入口 */
    var vtr = el('div', 'kc-row');
    vtr.appendChild(el('span', 'dlab', '语音合成（TTS）'));
    var vtb = el('button', 'guard-btn kv-volc-ttshop', '打开 TTS 音色设置');
    vtb.title = '火山语音合成（TTS）的音色/资源 ID 在 设置 → TTS → 火山引擎 配置';
    vtb.onclick = function(){
      try { closeModal(); openSettings('tts-p-volcano') } catch(e){ toast('请到 设置 → TTS → 火山引擎 配置音色', true) }
    };
    vtr.appendChild(vtb);
    card.appendChild(vtr);
  }
  return card;
}
function skKvCtxCard(wrapId?){
  var card = el('div', 'keycard');
  var row = el('div', 'kc-row');
  row.appendChild(el('span', 'dlab', '上下文窗口兜底值（单位 K）'));
  var c = el('input', 'kv-ctx');
  c.type = 'number'; c.min = '1'; c.step = '1'; c.value = String(getContextK());
  c.oninput = function(){ skKvSaveCtx(wrapId) };
  row.appendChild(c);
  row.appendChild(el('span', 'test-result', '模型自带窗口时自动用模型值；即时保存'));
  card.appendChild(row);
  return card;
}
/* task229：API Key 管理列表页（?popout=apikey 无 prov；设置 → API Key 直达）。
    上面「📊 模型对比」按钮弹比价大窗，下面供应商卡点击弹该供应商 Key 编辑窗（popoutOpenKey 新窗，本窗保留）。
    task272：embed=true（设置内嵌页，唯一入口）时供应商卡不弹窗——写 SETTINGS.keyProv 后整页切到编辑态。
    Key 数徽标：SETTINGS 缓存直填，无缓存拉一次（loadDs/loadZp），零自动轮询（L-067 同款纪律）。 */
function skRenderProvList(wrapId?, embed?){
  var w = $('#' + wrapId); if (!w) return;
  w.replaceChildren();
  var g = el('div', 'keys-wrap kvwin kvls');
  var top = el('div', 'kvls-top');
  top.appendChild(el('div', 'kvls-title', 'API Key 管理'));
  var cmp = el('button', 'guard-btn', '📊 模型对比');
  cmp.title = '打开模型比价界面（独立大窗）';
  cmp.onclick = function(){ popoutOpen('pricing') };
  top.appendChild(cmp);
  g.appendChild(top);
  var fill = function(prov, d){
    var b = w.querySelector('.kvls-' + prov + '-cnt'); if (!b) return;
    if (!d){ b.textContent = '加载失败'; return } /* task229 产出审 P2-2：加载失败 ≠ 没有 Key，别误导 */
    var cnt = skKvKeys(prov).length;
    b.textContent = cnt ? (cnt + ' 个 Key') : '尚未添加 Key';
  };
  [['ds', 'DeepSeek 官方', 'api.deepseek.com', '余额与 Key 管理'],
   ['zp', 'GLM Token Plan', 'api/coding/paas/v4', '额度与 Key 管理'],
   ['volc', '火山方舟（火山引擎）', 'ark.cn-beijing.volces.com/api/v3', '豆包模型 · Key 与连接测试']].forEach(function(cfg){
    var card = el('div', 'kvls-card');
    card.title = embed ? ('在设置内打开 ' + cfg[1] + ' 的 Key 管理') : ('点击打开 ' + cfg[1] + ' 的 Key 管理窗口');
    card.onclick = embed
      ? function(){ SETTINGS.keyProv = cfg[0]; renderSettings() }
      : function(){ popoutOpenKey(cfg[0]) };
    var info = el('div', 'kvls-info');
    info.appendChild(el('b', null, cfg[1]));
    info.appendChild(el('span', 'kvls-api', cfg[2] + ' · ' + cfg[3]));
    card.appendChild(info);
    card.appendChild(el('span', 'kvls-cnt kvls-' + cfg[0] + '-cnt', '…'));
    card.appendChild(el('span', 'kvls-go', '›'));
    g.appendChild(card);
  });
  w.appendChild(g);
  w.appendChild(el('div', 'kvls-note', '仅列出支持 Key 管理的供应商；模型价格对比请点上方「📊 模型对比」'));
  if (SETTINGS.ds) fill('ds', SETTINGS.ds); else loadDsSettings(function(d){ fill('ds', d) });
  if (SETTINGS.zp) fill('zp', SETTINGS.zp); else loadZpSettings(function(d){ fill('zp', d) });
  if (SETTINGS.volc) fill('volc', SETTINGS.volc); else loadVolcSettings(function(d){ fill('volc', d) });
  if (POP_TAB) setTimeout(popoutFitOnce, 60);
}
/* task215：单供应商 Key 管理窗渲染核心（popout apikey 页签；prov='ds'|'zp'|'volc'）。
   复用 skKvCard 原链零复制；回填按 prov 分支，避免另一家无效请求（方案审 P2-5）。
   task229：无 prov 已由 skRenderProvList 列表页接管，此处 provs 兜底仅作防御（正常链路进不来）。
   task328：火山方舟（volc）并入同一链路，回填走 loadVolcSettings。 */
function skRenderKeyWin(prov?, wrapId?){
  var w = $('#' + wrapId); if (!w) return;
  w.replaceChildren();
  var g = el('div', 'keys-wrap kvwin');
  var provs = (prov === 'ds' || prov === 'zp' || prov === 'volc') ? [prov] : ['ds', 'zp'];
  provs.forEach(function(p){ g.appendChild(skKvCard(p, wrapId)) });
  g.appendChild(skKvCtxCard(wrapId)); /* 全局上下文 K：两窗同款，即时落 localStorage（最终一致，非实时互刷） */
  w.appendChild(g);
  provs.forEach(function(p){
    if (p === 'ds'){
      if (SETTINGS.ds) skKvList(wrapId, 'ds');
      else loadDsSettings(function(){ skKvList(wrapId, 'ds') });
      skKvBalance(wrapId);
      fetchBalance(function(){ skKvBalance(wrapId) });
    } else if (p === 'volc'){
      if (SETTINGS.volc) skKvList(wrapId, 'volc');
      else loadVolcSettings(function(){ skKvList(wrapId, 'volc') });
    } else {
      if (SETTINGS.zp) skKvList(wrapId, 'zp');
      else loadZpSettings(function(){ skKvList(wrapId, 'zp') });
      if (SETTINGS.zpQuota) renderZpQuota(wrapId); else fetchZhipuQuota(null, wrapId);
    }
  });
  if (POP_TAB) setTimeout(popoutFitOnce, 60);
}
function skRenderPricing(wrapId?){
  wrapId = wrapId || 'prWrap'; SK.prWrap = wrapId; /* task204：双入口共用渲染核心 */
  var w = $('#' + wrapId); if (!w) return;
  w.replaceChildren();
  var data = SK.prData || {};
  var bar = el('div', 'pr-bar');
  /* task215：撤 task214 的「📊 比价 / ⚿ Key」视图切换（主人要求 Key 入口不放比价页右边）；
     Key 管理改为 设置 → API Key → 供应商列表页 → 点供应商 → 独立 Key 窗（skRenderKeyWin；task229）。 */
  var q = el('input'); q.placeholder = '搜索供应商 / 模型，如 deepseek'; q.value = SK.prQ;
  q.oninput = function(){ SK.prQ = q.value; skRenderTable(prBoxIdOf(SK.prWrap)) };
  var cat = el('select');
  [['', '全部类别'], ['text', '文本'], ['image', '图像'], ['audio', '音频']].forEach(function(p){
    var o = el('option', null, p[1]); o.value = p[0]; if (p[0] === SK.prCat) o.selected = true; cat.appendChild(o);
  });
  cat.onchange = function(){ SK.prCat = cat.value; skRenderTable(prBoxIdOf(SK.prWrap)) };
  var link = el('select');
  [['', '全部接入状态'], ['yes', '仅已接入'], ['no', '仅未接入']].forEach(function(p){
    var o = el('option', null, p[1]); o.value = p[0]; if (p[0] === SK.prLink) o.selected = true; link.appendChild(o);
  });
  link.onchange = function(){ SK.prLink = link.value; skRenderTable(prBoxIdOf(SK.prWrap)) };
  /* task212：积分 ⇄ 元 切换（首次需先定 1 积分≈多少元；官方无公开静态汇率，只能本地自定后持久化） */
  var cv = el('button', 'guard-btn', SK.prUnitCny ? '⇄ 显示积分' : '⇄ 显示元');
  cv.title = '积分制（GLM Token Plan）按自定汇率折算成元显示；点击切换';
  cv.onclick = function(){
    if (!SK.prUnitCny && !(+(SK.prRate || 0) > 0)){
      var s = window.prompt('1 积分约等于多少元？（用于把 Token Plan 积分折算成元，只存本机）', '0.005');
      var r = parseFloat(s);
      if (!(r > 0)) return;
      SK.prRate = r;
      try { localStorage.setItem('littledj.prRate', String(r)) } catch(e){}
    }
    SK.prUnitCny = !SK.prUnitCny;
    try { localStorage.setItem('littledj.prUnitCny', SK.prUnitCny ? '1' : '0') } catch(e){}
    skRenderPricing(SK.prWrap || 'prWrap');
  };
  var rf = el('button', 'guard-btn', '⟳ 立即刷新');
  rf.onclick = function(){
    fetch('/_skills/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'model-pricing' }) })
      .then(function(r){ return r.json() }).then(function(d){
        if (!d.ok) return toast(d.error || '启动失败', true);
        toast('正在重新抓取…');
        var n = 0;
        if (SK.prPollT){ clearInterval(SK.prPollT); SK.prPollT = 0 }
        SK.prPollT = setInterval(function(){
          n++;
          fetch('/_skills').then(function(r){ return r.json() }).then(function(x){
            var s = (x.skills || []).filter(function(y){ return y.id === 'model-pricing' })[0];
            if ((s && !s.running) || n > 45){
              clearInterval(SK.prPollT); SK.prPollT = 0;
              fetch('/_pricing').then(function(r){ return r.json() }).then(function(pd){ if (pd.ok){ SK.prData = pd.data; skRenderPricing(SK.prWrap); toast('数据已刷新') } else toast(pd.error || '刷新失败', true) }).catch(function(){});
            }
          }).catch(function(){ if (n > 45){ clearInterval(SK.prPollT); SK.prPollT = 0 } });
        }, 3000);
      }).catch(function(e){ toast('刷新失败：' + e.message, true) });
  };
  bar.appendChild(q); bar.appendChild(cat); bar.appendChild(link); bar.appendChild(cv); bar.appendChild(rf);
  if (!POP_TAB){ /* task206：大屏弹出页内不再显示 ⤢（避免自我重开）；弹窗版与右栏版都可见 */
    var big = el('button', 'guard-btn', '⤢ 大屏');
    big.title = '在独立窗口打开比价大屏（右栏「比价」页签长按 / 按住拖出 同效）';
    big.onclick = function(){ popoutOpen('pricing') };
    bar.appendChild(big);
  }
  w.appendChild(bar);
  var tableBox = el('div'); tableBox.id = prBoxIdOf(wrapId);
  w.appendChild(tableBox);
  var note = el('div', 'pr-note');
  /* task212：说明行按当前显示模式组装（anyUnit 判断已由模式文案覆盖，变量退役） */
  note.textContent = '价格单位：' + (SK.prUnitCny && +(SK.prRate || 0) > 0 ? ('元 / 百万 tokens（Token Plan 积分行已按 1 积分 ≈ ' + SK.prRate + ' 元折算）') : '元 / 百万 tokens；GLM Token Plan 行为订阅积分（抵扣系数，非等额现金）') +
    '。区间=空闲时段~高峰时段：高峰=周一至周五 14:00–18:00，其余时段按 5 折（元价与积分同规则）。更新时间：' + (data.updatedAt ? data.updatedAt.replace('T', ' ').slice(0, 16) : '—') +
    ((data.errors && data.errors.length) ? ' ｜ 部分数据源失败：' + data.errors.join('；') : '');
  w.appendChild(note);
  skRenderTable();
  if (POP_TAB) setTimeout(popoutFitOnce, 60); /* task211：大屏页首次渲染后窗口收高贴合内容 */
}
/* task211：大屏页窗口高度贴合内容——主人二次反馈「下面黑色空间太大」（task208 只修了弹窗版 .pr-wrap min-height，大屏页是 #right 全屏 flex 撑满视口）。
   只缩一次（SK.popFitted），不监听 resize/后续重渲，避免与用户手动拉伸窗口打架；resizeTo 受限的环境静默不动。 */
function popoutFitOnce(){
  if (!POP_TAB || SK.popFitted) return;
  var rb = document.getElementById('rightBody'); if (!rb) return;
  var first = rb.firstElementChild; if (!first) return;
  SK.popFitted = true;
  var top = Math.ceil(rb.getBoundingClientRect().top);
  var need = top + Math.ceil(first.getBoundingClientRect().height) + 14 + 10; /* 视口偏移 + 面板高 + rightBody 下内边距 + 余量 */
  if (need < 320 || need + 24 >= window.innerHeight) return; /* 太小/内容已够高：不动 */
  var chrome = Math.max(0, (window.outerHeight || window.innerHeight) - window.innerHeight);
  /* task215：apikey 卡式窗保 640 宽下限（不被比价窗 760 下限撑宽） */
  var minW = (POP_TAB === 'apikey') ? 640 : 760;
  var defW = (POP_TAB === 'apikey') ? 640 : 1280;
  try { window.resizeTo(Math.max(minW, window.outerWidth || defW), Math.round(need + chrome)) } catch(e){}
  /* 弹窗居中-2（2026-11-12）：高度自适应后把窗口重新摆回屏幕正中，否则 top 停在初始位置、视觉偏下 */
  try {
    var _aw = (window.screen && screen.availWidth) || 1280, _ah = (window.screen && screen.availHeight) || 800;
    var _ow = window.outerWidth || minW, _oh = window.outerHeight || Math.round(need + chrome);
    if (_oh < _ah - 20) window.moveTo(Math.max(0, Math.round((_aw - _ow) / 2)), Math.max(0, Math.round((_ah - _oh) / 2)));
  } catch(e){}
}
function skRenderTable(boxId?){
  boxId = boxId || prBoxIdOf(SK.prWrap || 'prWrap');
  var box = $('#' + boxId); if (!box) return;
  var rows = skPricingRows();
  if (!rows.length){ box.innerHTML = '<div class="pr-empty">没有匹配的数据</div>'; return }
  /* task209：撤「🏅」最低价标记——主人 2026-11-11 明确要求去掉（跨供应商最低价在跨量纲/套餐积分场景易误导） */
  /* task208：列序/列宽走 SK.prOrder/SK.prW（用户可拖拽调整，localStorage 持久化） */
  var order = prOrder(), cmap = prColDefs(), total = 0;
  order.forEach(function(k){ total += prWidthOf(k) });
  var html = '<table class="pr-table" style="width:' + total + 'px"><colgroup>';
  order.forEach(function(k){ html += '<col data-k="' + k + '" style="width:' + prWidthOf(k) + 'px">' });
  html += '</colgroup><thead><tr>';
  order.forEach(function(k){
    var c = cmap[k];
    var arrow = SK.prSort === k ? (SK.prDir > 0 ? ' ↑' : ' ↓') : '';
    /* task213：单位小字挂列头（排序箭头之前），单元格只显数字 */
    html += '<th data-k="' + k + '" title="排序：点击表头；调宽：拖右边缘；换位：桌面按住拖动 / 手机长按">' + c.t + (c.u ? ' <span class="pr-hunit">' + c.u + '</span>' : '') + arrow + '<span class="pr-grip" title="拖动调整列宽"></span></th>';
  });
  html += '</tr></thead><tbody>';
  rows.forEach(function(r, ri){
    html += '<tr>';
    order.forEach(function(k){ html += prCell(r, k, ri) });
    html += '</tr>';
  });
  html += '</tbody></table>';
  box.innerHTML = html;
  prBindHead(box);
  prBindProvLinks(box);
  prBindAlias(box); /* task283：别名列行内保存绑定 */
}
/* task283→task337：比价表别名列——保存按钮/回车经 setModelAliases 写入别名单源（服务端 /_model-alias，跨设备同步），顶栏即时生效 */
/* task285：脏标记同步——输入内容与已存别名不一致时保存按钮发亮（.dirty），保存/改回原值后回默认 */
function prAliasDirtySync(inp?){
  if (!inp) return;
  var cell = inp.closest ? inp.closest('.pr-alias-cell') : null;
  var btn = cell ? cell.querySelector('.pr-alias-save') : null;
  if (!btn) return;
  var ak = inp.getAttribute('data-ak');
  var stored = String(getModelAliases()[ak] || '');
  var dirty = String(inp.value || '').trim() !== stored;
  if (dirty) btn.classList.add('dirty'); else btn.classList.remove('dirty');
}
function prSaveAliasRow(box?, ak?, ri?){
  if (!ak || !box) return;
  if (!aliasSynced()){ toast('别名同步未完成（网络/代理异常），请刷新页面后重试'); return }
  var ins = box.querySelectorAll('.pr-alias-in'), inp = null;
  for (var i = 0; i < ins.length; i++){
    var el = ins[i];
    if (el.getAttribute('data-ak') !== ak) continue;
    /* task286：同 key 多行（GLM-5.3 与 [1m] 行共享别名）必须按行索引精确定位，否则存到别行 */
    if (ri != null && ri !== '' && el.getAttribute('data-ri') !== String(ri)) continue;
    inp = el; break;
  }
  if (!inp) return;
  var al = getModelAliases(), v = String(inp.value || '').trim();
  if (v) al[ak] = v; else delete al[ak];
  var sent = setModelAliases(al); /* task337：内存即更+上行服务端（refreshModelOptions 已在 setModelAliases 内） */
  prSyncAliasRows(box, ak); /* task286：同 key 所有行值/按钮状态统一（保存的那行也在此回到默认色）；task343 取消清空也由此回填 */
  if (sent && sent.then) sent.then(function(up){
    if (up && up.ok) toast(v ? ('别名已保存：' + v) : '别名已清除（' + ak + '）');
  }, function(){});
}
/* task286：同一别名 key 可对应多行展示（GLM-5.3 / GLM-5.3[1m]）——保存后统一回填 + 统一熄灭 dirty */
function prSyncAliasRows(box?, ak?){
  if (!box || !ak) return;
  var stored = String(getModelAliases()[ak] || '');
  var ins = box.querySelectorAll('.pr-alias-in');
  for (var i = 0; i < ins.length; i++){
    if (ins[i].getAttribute('data-ak') !== ak) continue;
    ins[i].value = stored;
    prAliasDirtySync(ins[i]);
  }
}
function prBindAlias(box?){
  if (!box) return;
  var btns = box.querySelectorAll('.pr-alias-save');
  for (var i = 0; i < btns.length; i++){
    (function(b){ b.onclick = function(){ prSaveAliasRow(box, b.getAttribute('data-ak'), b.getAttribute('data-ri')) } })(btns[i]);
  }
  var ins = box.querySelectorAll('.pr-alias-in');
  for (var j = 0; j < ins.length; j++){
    (function(inp){
      inp.onkeydown = function(e){ if (e && e.isComposing) return; if (e && e.key === 'Enter'){ e.preventDefault(); prSaveAliasRow(box, inp.getAttribute('data-ak'), inp.getAttribute('data-ri')) } };
      inp.oninput = function(){ prAliasDirtySync(inp) }; /* task285：改动即时点亮保存按钮 */
      prAliasDirtySync(inp); /* 初始态（含重渲后回填）按已存值校准 */
    })(ins[j]);
  }
}
/* task215：provider 列可点链接绑定（点击弹该供应商 Key 管理独立窗；三入口共用 prCell/本绑定） */
function prBindProvLinks(box?){
  var ls = box.querySelectorAll('.pr-prov-link');
  for (var i = 0; i < ls.length; i++){
    (function(a){ a.onclick = function(){ popoutOpenKey(a.getAttribute('data-prov')) } })(ls[i]);
  }
}
/* task208：比价表表头交互——点击排序 / 右边缘拖宽 / 桌面按住拖动换位 / 手机长按弹菜单 */
function prColDefs(){ var m = {}; PRMETA.forEach(function(c){ m[c.k] = c }); return m }
function prOrder(){
  var all = PRMETA.map(function(c){ return c.k }), saved = Array.isArray(SK.prOrder) ? SK.prOrder : [];
  var out = [];
  saved.forEach(function(k){ if (all.indexOf(k) >= 0 && out.indexOf(k) < 0) out.push(k) }); /* task210 P2-1：脏数据重复键去重（AOCI 口径「去重」落实） */
  all.forEach(function(k){ if (out.indexOf(k) < 0) out.push(k) });
  /* task283：新列 alias 默认紧跟 model——旧列序（无 alias 键）升级时插到 model 后面，不甩到末列；
     用户已自定义过含 alias 的列序（saved 里有）则尊重原位置，不重排 */
  if (saved.indexOf('alias') < 0){
    var ai = out.indexOf('alias'), mi = out.indexOf('model');
    if (ai > mi + 1 && mi >= 0){ out.splice(ai, 1); out.splice(mi + 1, 0, 'alias') }
  }
  return out;
}
function prWidthOf(k?){
  var d = prColDefs()[k], v = +((SK.prW || {})[k]);
  return (d && v >= d.min && v <= 640) ? v : (d ? d.w : 100);
}
function prSaveCols(){
  try { localStorage.setItem('littledj.prCols', JSON.stringify(prOrder())); localStorage.setItem('littledj.prColW', JSON.stringify(SK.prW || {})) } catch(e){}
}
function prRerender(){ skRenderTable(prBoxIdOf(SK.prWrap || 'prWrap')) }
/* task215：供应商名 → Key 管理提供方（ds=DeepSeek 官方 / zp=GLM Token Plan；与 task209 [1m] 拆行判据同源）。
    按量计费的「智谱官方」等无 /_settings 路由的供应商返回 ''，provider 列不可点。 */
function skProvId(provider?){
  var s = String(provider || '');
  if (/deepseek/i.test(s)) return 'ds';
  if (/token\s*plan/i.test(s)) return 'zp';
  if (/火山|volc/i.test(s)) return 'volc'; /* task328：火山方舟接入 Key 管理链路 */
  return '';
}
/* task283：比价行 → 别名存储键（与设置页 skKvAliasKey 同格式 provider/modelID）。
   比价数据里的模型名与 serve 真实 modelID 大小写/后缀不同（如 GLM-5.3 → glm-5.3；GLM-5.3[1m] 无此变体→归基础模型），
   先按 S.models 真实 modelID 归一，匹配不上再小写兜底——保证与「设置→API Key→别名」和顶栏下拉读写同一 key。 */
 function prAliasKeyOf(r){
   var pid = skProvId(r.provider);
   var prov = pid === 'ds' ? 'deepseek' : (pid === 'zp' ? 'zhipuai-coding-plan' : (pid === 'volc' ? 'volcengine' : ''));
   if (!prov) return '';
   var name = String((r.m && r.m.name) || '');
   var low = name.toLowerCase();
   /* task289（主人三入口一致令）：比价名尾部圆括号备注（全角「（含视觉理解 MCP）」/半角「(beta)」）是展示注释非模型名——
      task212 投影层只拆全角，半角漏网；带备注匹配落空 → 别名存进漂移 key → 比价/输入框下拉/设置 Key 卡三入口分裂。
      剥备注（全角+半角）后再匹配一轮，兜底也用剥后净名。[1m] 方括号是独立调用形态（task288-fu1 主人裁决），不剥、独立 key。 */
   var stripped = name.replace(/[（(][^）)]*[）)][ \t]*$/, '').trim();
   var slow = stripped.toLowerCase();
   var cands = (S.models || []).filter(function(x){ return x.providerID === prov });
   function hitOf(nl){
     var hit = null, i;
     /* task288-fu1（主人纠正）：[1m] 是独立调用形态（1M 窗口），**不做去后缀归一**——GLM-5.3 与 GLM-5.3[1m] 别名各自独立；
        仅按 serve 真实 modelID 做大小写不敏感的精确匹配（GLM-5.3 → glm-5.3），匹配不上小写原名兜底（[1m] 后缀保留）。 */
     for (i = 0; i < cands.length && !hit; i++){
       if (String(cands[i].modelID || '').toLowerCase() === nl) hit = cands[i];
     }
     for (i = 0; i < cands.length && !hit; i++){
       if (String(cands[i].name || '').toLowerCase() === nl) hit = cands[i];
     }
     return hit;
   }
   var hit = hitOf(low) || (slow !== low ? hitOf(slow) : null);
   return prov + '/' + (hit ? hit.modelID : slow);
 }
function prCell(r?, k?, ri?){
  var m = r.m;
  if (k === 'provider'){
    var pid = skProvId(r.provider);
    /* task215：有 Key 管理能力 → 供应商名可点，弹独立 Key 窗。
       task348（主人令）：不再要求「已接入」才可点——未接入时点进去正是去配 Key 的路径；
       已接入则直达已存 Key 管理。两态同一跳转目标，title 区分语义。
       task349：语音能力行（TTS/ASR/OCR，category=audio/image）title 明示「点击配置语音合成」——
       比价表与 TTS 配置打通：DeepSeek 行→Key 窗内嵌 TTS 区块；火山行→Key 窗含 TTS 页直达按钮。 */
    var isVoiceRow = !!(r.m && (r.m.category === 'audio' || r.m.category === 'image'));
    var tTitle = isVoiceRow ? '点击配置语音合成（TTS）/ 查看该供应商 Key' : (r.linked ? '点击管理 API Key（独立窗口）' : '点击去配置 API Key（独立窗口）');
    var nameHtml = pid
      ? '<span class="pr-prov-link" data-prov="' + pid + '" data-voice="' + (isVoiceRow ? '1' : '') + '" title="' + tTitle + '">' + esc(r.provider) + ' ⚿</span>'
      : '<span title="该供应商无 API Key 管理">' + esc(r.provider) + '</span>';
    return '<td>' + nameHtml + (r.linked ? ' <span class="pr-linked">已接入 ✓</span>' : ' <span class="pr-unlinked">未接入</span>') + '</td>';
  }
  if (k === 'model'){
    /* task278：分段同名续行只留「〃」（官方 rowspan 合并格效果，title 保留全名）；免费模型挂灰标签「免费」 */
    if (r._cont) return '<td class="pr-cont" title="' + esc(m.name) + '">〃</td>';
    return '<td title="' + esc(r.note || '') + '">' + esc(m.name) + (m.remark ? ' <span class="pr-tag">' + esc(m.remark) + '</span>' : '') + (m.free ? ' <span class="pr-tag">免费</span>' : '') + '</td>';
  }
  if (k === 'alias'){
    /* task283→task337：行内别名输入 + 保存按钮（同一别名单源 setModelAliases；保存后顶栏模型下拉即时生效）
       task289-fu2（主人裁决）：每行都可设置别名（包括 [1m] 拆行）——别名的用途=主人标记「我要用的模型」；
       [1m] 行别名通过 aliasOf 的 [1m] 兜底回退对同一模型生效（见 aliasOf）。
       可编辑行带 data-ri 行索引（task286：同 key 多行按行精确定位） */
    var ak = prAliasKeyOf(r);
    if (!ak) return '<td><span class="pr-alias-na" title="该供应商无模型别名入口">—</span></td>';
    var av = getModelAliases()[ak] || '';
    var riAttr = String(ri == null ? '' : ri);
    return '<td><div class="pr-alias-cell"><input class="pr-alias-in" data-ak="' + esc(ak) + '" data-ri="' + riAttr + '" value="' + esc(av) + '" placeholder="起别名" maxlength="64" autocomplete="off"><button class="pr-alias-save" data-ak="' + esc(ak) + '" data-ri="' + riAttr + '">保存</button></div></td>';
  }
  if (k === 'context') return '<td class="num">' + esc(prNormCtx(m.contextText) || '—') + '</td>';
  if (k === 'note') return '<td class="pr-note-cell" title="' + esc(m.note || '') + '">' + esc(m.note || '—') + '</td>'; /* task345：备注列（能力 API 介绍/折扣；上下文列不混介绍） */
  if (k === 'input') return '<td class="num">' + skPriceSpanU(m, m.price.inputMiss) + '</td>';
  if (k === 'hit') return '<td class="num">' + skPriceSpanU(m, m.price.inputHit) + '</td>';
  if (k === 'output') return '<td class="num">' + skPriceSpanU(m, m.price.output) + '</td>';
  if (k === 'conc') return '<td class="num">' + esc(m.limits && m.limits.concurrency ? ('并发 ' + m.limits.concurrency) : '—') + '</td>';
  if (k === 'api') return '<td class="pr-api" title="' + esc(r.apiFull || '') + '">' + esc(r.api || '—') + '</td>';
  if (k === 'link') return '<td>' + (r.linked ? '<span class="pr-linked">可用</span>' : '<span class="pr-unlinked">待接入</span>') + '</td>';
  return '<td></td>';
}
function prBindHead(box?){
  var table = box.querySelector('.pr-table'); if (!table) return;
  var ths = box.querySelectorAll('th[data-k]');
  for (var i = 0; i < ths.length; i++){
    (function(th, idx){
      th.onclick = function(){
        if (PRUI.suppress){ PRUI.suppress = false; return }
        var k = th.getAttribute('data-k');
        if (k === 'alias') return; /* task283：别名列不参与排序（行内编辑列，点表头无意义） */
        if (SK.prSort === k) SK.prDir = -SK.prDir; else { SK.prSort = k; SK.prDir = 1 }
        skRenderTable(box.id);
      };
      var grip = th.querySelector('.pr-grip');
      if (grip) grip.addEventListener('pointerdown', function(e){ prGripDown(e, table, th) });
      th.addEventListener('pointerdown', function(e){ prThDown(e, table, th, idx) });
    })(ths[i], i);
  }
}
function prDropMark(table?, from?, to?){
  var ths = table.querySelectorAll('th[data-k]');
  for (var i = 0; i < ths.length; i++){ ths[i].classList.remove('pr-drop-l'); ths[i].classList.remove('pr-drop-r') }
  if (to < 0 || to === from || to >= ths.length) return;
  ths[to].classList.add(to > from ? 'pr-drop-r' : 'pr-drop-l');
}
function prDropIndex(table?, x?){
  var ths = table.querySelectorAll('th[data-k]');
  for (var i = 0; i < ths.length; i++){
    var rc = ths[i].getBoundingClientRect();
    if (x < rc.left + rc.width / 2) return i;
  }
  return ths.length - 1;
}
function prThDown(e?, table?, th?, idx?){
  if (e.button != null && e.button !== 0) return;
  if (e.target && e.target.classList && e.target.classList.contains('pr-grip')) return;
  var key = th.getAttribute('data-k');
  var touch = (e.pointerType && e.pointerType !== 'mouse');
  var st = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, long: 0 };
  PRUI.drag = st;
  if (touch){
    st.long = setTimeout(function(){
      st.long = 0;
      if (PRUI.drag !== st) return;
      PRUI.drag = null; PRUI.suppress = true;
      setTimeout(function(){ PRUI.suppress = false }, 800);
      prColMenu(key, st.x, st.y);
    }, 520);
  }
  var move = function(ev){
    st.x = ev.clientX; st.y = ev.clientY;
    if (PRUI.drag !== st || touch) return; /* 触屏滑动=滚动表格，不参与拖动换位 */
    if (!st.moved && (Math.abs(ev.clientX - st.x0) > 8 || Math.abs(ev.clientY - st.y0) > 8)){
      st.moved = true; th.classList.add('pr-th-dragging');
    }
    if (st.moved) prDropMark(table, idx, prDropIndex(table, ev.clientX));
  };
  var up = function(){
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up);
    if (st.long){ clearTimeout(st.long); st.long = 0 }
    th.classList.remove('pr-th-dragging');
    prDropMark(table, idx, -1);
    if (PRUI.drag === st) PRUI.drag = null;
    if (st.moved){
      var to = prDropIndex(table, st.x);
      PRUI.suppress = true; setTimeout(function(){ PRUI.suppress = false }, 350);
      if (to >= 0 && to !== idx) prMoveCol(key, to);
    }
  };
  document.addEventListener('pointermove', move, { passive: true });
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}
function prMoveCol(key?, target?){
  var order = prOrder(), i = order.indexOf(key); if (i < 0) return;
  order.splice(i, 1);
  var t = target > i ? target - 1 : target;
  t = Math.max(0, Math.min(order.length, t));
  order.splice(t, 0, key);
  SK.prOrder = order; prSaveCols(); prRerender();
}
function prGripDown(e?, table?, th?){
  e.preventDefault(); e.stopPropagation();
  var key = th.getAttribute('data-k'), def = prColDefs()[key];
  var col = table.querySelector('colgroup col[data-k="' + key + '"]');
  if (!col || !def) return;
  var sum = 0; PRMETA.forEach(function(c){ sum += prWidthOf(c.k) });
  var scale = (table.getBoundingClientRect().width || sum) / (sum || 1);
  var startX = e.clientX, startW = prWidthOf(key), cur = startW;
  PRUI.suppress = true;
  document.body.classList.add('dragging-col');
  var move = function(ev){
    cur = Math.max(def.min, Math.min(640, Math.round(startW + (ev.clientX - startX) / (scale || 1))));
    col.style.width = cur + 'px';
    var t = 0; PRMETA.forEach(function(c){ t += (c.k === key ? cur : prWidthOf(c.k)) });
    table.style.width = t + 'px';
  };
  var up = function(){
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', up); /* task210 P1-1（task208 御史产出审）：系统打断也走收口，防监听残留 + 列宽白拖 + suppress 悬挂 */
    document.body.classList.remove('dragging-col');
    SK.prW[key] = cur; prSaveCols();
    setTimeout(function(){ PRUI.suppress = false }, 150);
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
}
function prColMenu(key?, x?, y?){
  prColMenuClose();
  var def = prColDefs()[key]; if (!def) return;
  var menu = document.createElement('div');
  menu.className = 'pr-colmenu';
  menu.innerHTML = '<div class="mt">列「' + esc(def.t) + '」</div>' +
    '<button data-op="left">◀ 往前移</button>' +
    '<button data-op="right">往后移 ▶</button>' +
    '<button data-op="resetw">重置本列宽</button>' +
    '<button data-op="reset">恢复默认列序/列宽</button>';
  document.body.appendChild(menu);
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 10)) + 'px';
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 10)) + 'px';
  PRUI.menu = menu;
  menu.addEventListener('click', function(e){
    var tg: any = e.target;
    var b = tg && tg.closest ? tg.closest('button') : null; if (!b) return;
    var op = b.getAttribute('data-op'), order = prOrder(), i = order.indexOf(key);
    if (op === 'left' && i > 0){ order.splice(i, 1); order.splice(i - 1, 0, key); SK.prOrder = order; prSaveCols(); prRerender() }
    else if (op === 'right' && i >= 0 && i < order.length - 1){ order.splice(i, 1); order.splice(i + 1, 0, key); SK.prOrder = order; prSaveCols(); prRerender() }
    else if (op === 'resetw'){ delete (SK.prW || {})[key]; prSaveCols(); prRerender() }
    else if (op === 'reset'){ SK.prOrder = null; SK.prW = {}; prSaveCols(); prRerender() }
    prColMenuClose();
  });
  setTimeout(function(){ document.addEventListener('pointerdown', prColMenuOut, true) }, 0);
  window.addEventListener('scroll', prColMenuClose, true); /* task210 P2-3：表格滚动时菜单跟随关闭，避免悬空错位（capture 捕获容器内滚动） */
}
function prColMenuOut(e?){ if (PRUI.menu && !PRUI.menu.contains(e.target)) prColMenuClose() }
function prColMenuClose(){
  if (PRUI.menu){
    document.removeEventListener('pointerdown', prColMenuOut, true);
    window.removeEventListener('scroll', prColMenuClose, true);
    if (PRUI.menu.parentNode) PRUI.menu.parentNode.removeChild(PRUI.menu);
    PRUI.menu = null;
  }
}

/* task251：openProfile 独立弹窗退役——画像页改设置内普通页（renderSettings 'profile' 分发 + fetchProfile + modalSave 绑 saveProfile） */
function fetchProfile(){
  fetch('/_profile').then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }).then(function(d){
    PROFILE.dims = d.dims || [];
    PROFILE.data = d.profile || { dimensions: [] };
    if (!PROFILE.dims.some(function(x){ return x.id === PROFILE.cur })) PROFILE.cur = PROFILE.dims.length ? PROFILE.dims[0].id : 'identity';
    renderProfile();
  }).catch(function(e){
    var w = $('#profileWrap'); if (w) w.innerHTML = '<div class="emptyhint">画像加载失败：' + esc(e.message) + '</div>';
  });
}
function saveProfile(action?){
  if (!PROFILE.data) return;
  fetch('/_profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: PROFILE.data, action: action || '保存' }) })
    .then(function(r){ if (!r.ok) return r.text().then(function(t){ throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120)) }); return r.json() })
    .then(function(d){ if (d && d.profile){ PROFILE.data = d.profile; renderProfile() } toast('画像已保存') })
    .catch(function(e){ toast('画像保存失败：' + e.message, true) });
}
function profileItemRow(dim?, dd?, item?, isSugg?){
  var it = el('div', 'pf-item' + (isSugg ? ' sugg' : ''));
  it.appendChild(el('div', 'txt', item.text));
  var meta = el('div', 'pf-meta');
  meta.appendChild(el('span', 'pf-badge', item.source || '主人原话'));
  meta.appendChild(el('span', 'pf-badge ' + (item.status === 'confirmed' ? 'ok' : 'pend'), item.status === 'confirmed' ? '已确认' : '待确认'));
  if (typeof item.confidence === 'number') meta.appendChild(el('span', 'pf-badge', Math.round(item.confidence * 100) + '%'));
  meta.appendChild(el('span', null, fmtTime(item.updated)));
  var ops = el('div', 'pf-ops');
  if (isSugg){
    var ok = el('button', null, '采纳');
    ok.onclick = function(){
      var idx = dd.suggestions.indexOf(item); if (idx >= 0) dd.suggestions.splice(idx, 1);
      item.status = 'confirmed'; item.updated = Date.now(); dd.items.push(item);
      renderProfile(); saveProfile('采纳建议：' + dim.name);
    };
    var no = el('button', null, '驳回');
    no.onclick = function(){
      var idx = dd.suggestions.indexOf(item); if (idx >= 0) dd.suggestions.splice(idx, 1);
      renderProfile(); saveProfile('驳回建议：' + dim.name);
    };
    ops.appendChild(ok); ops.appendChild(no);
  } else {
    if (item.status !== 'confirmed'){
      var c = el('button', null, '确认');
      c.onclick = function(){ item.status = 'confirmed'; item.updated = Date.now(); renderProfile(); saveProfile('确认：' + dim.name) };
      ops.appendChild(c);
    }
    var ed = el('button', null, '编辑');
    ed.onclick = function(){
      var v = prompt('修改这条画像内容：', item.text);
      if (v == null) return;
      v = String(v).trim().slice(0, 300); if (!v) return;
      item.text = v; item.updated = Date.now(); renderProfile(); saveProfile('编辑：' + dim.name);
    };
    ops.appendChild(ed);
    var del = el('button', null, '删除');
    del.onclick = function(){
      if (!confirm('删除这条画像记录？')) return;
      var idx = dd.items.indexOf(item); if (idx >= 0) dd.items.splice(idx, 1);
      renderProfile(); saveProfile('删除：' + dim.name);
    };
    ops.appendChild(del);
  }
  meta.appendChild(ops);
  it.appendChild(meta);
  return it;
}
function renderProfile(){
  var wrap = $('#profileWrap'); if (!wrap || !PROFILE.data) return;
  var prevDim = wrap.dataset.dim || '';
  /* task250（主人 2026-11-13 口述）：复制 task248 两改动——①重渲前记导航滚动位置，渲染后恢复
     （旧版 rAF 强制把 active 滚到正中=跳动感来源，已删）；②滚动条隐藏见 .profile-nav CSS。 */
  var pfNavPrev = wrap.querySelector('.profile-nav');
  var pfNavScroll = pfNavPrev ? { l: pfNavPrev.scrollLeft, t: pfNavPrev.scrollTop } : { l: 0, t: 0 };
  wrap.replaceChildren();
  var nav = el('div', 'profile-nav');
  var sel = document.createElement('select');
  sel.className = 'profile-select';
  sel.setAttribute('aria-label', '画像维度');
  PROFILE.dims.forEach(function(d){
    var dd = profileDimData(d.id);
    var pend = dd.items.filter(function(i){ return i.status !== 'confirmed' }).length + dd.suggestions.length;
    var done = dd.items.filter(function(i){ return i.status === 'confirmed' }).length;
    var b = el('button', PROFILE.cur === d.id ? 'active' : '');
    b.appendChild(el('span', null, d.name));
    b.appendChild(el('span', 'pf-badge' + (pend ? ' pend' : ''), String(pend || done)));
    b.onclick = function(){ PROFILE.cur = d.id; renderProfile() };
    b.onfocus = function(){ try { nav.scrollLeft = b.offsetLeft - (nav.clientWidth - b.offsetWidth) / 2 } catch (e){} };
    nav.appendChild(b);
    var o = document.createElement('option');
    o.value = d.id;
    o.textContent = d.name + (pend ? ' · 待确认 ' + pend : '');
    sel.appendChild(o);
  });
  sel.value = PROFILE.cur;
  sel.onchange = function(){ PROFILE.cur = sel.value; renderProfile() };
  wrap.appendChild(sel);
  wrap.appendChild(nav);
  navRestoreScroll(nav, pfNavScroll.l, pfNavScroll.t); /* task250：恢复滚动位置；仅 active 不在视野才微调 */

  var meta = profileDimMeta(PROFILE.cur), dd = profileDimData(PROFILE.cur);
  var body = el('div', 'profile-body');
  body.appendChild(el('div', 'hint', (meta.hint || '') + '　·　改动即时保存到本机，不外露。'));
  dd.items.filter(function(i){ return i.status === 'confirmed' }).forEach(function(item){ body.appendChild(profileItemRow(meta, dd, item, false)) });
  var pendItems = dd.items.filter(function(i){ return i.status !== 'confirmed' });
  if (pendItems.length){
    body.appendChild(el('div', 'pf-sec', '待确认'));
    pendItems.forEach(function(item){ body.appendChild(profileItemRow(meta, dd, item, false)) });
  }
  if (dd.suggestions.length){
    body.appendChild(el('div', 'pf-sec', '小 DJ 的建议'));
    dd.suggestions.forEach(function(s){ body.appendChild(profileItemRow(meta, dd, s, true)) });
  }
  if (!dd.items.length && !dd.suggestions.length) body.appendChild(el('div', 'emptyhint', '这个维度还没有记录，下面说一句就行'));

  var add = el('div', 'pf-add');
  var ta = document.createElement('textarea');
  ta.placeholder = '我来说一句（追加到「' + meta.name + '」，按已确认保存）';
  add.appendChild(ta);
  var btn = el('button', null, '添加');
  btn.onclick = function(){
    var v = ta.value.trim(); if (!v) return;
    dd.items.push({ text: v.slice(0, 300), source: '主人原话', confidence: 0.98, status: 'confirmed', updated: Date.now() });
    renderProfile(); saveProfile('新增：' + meta.name);
  };
  add.appendChild(btn);
  body.appendChild(add);
  wrap.appendChild(body);
  if (prevDim && prevDim !== PROFILE.cur) body.scrollTop = 0;
  wrap.dataset.dim = PROFILE.cur;
  $('#modalSave').disabled = false;
}

/* ===== task331：密码本 → Key 选取器 =====
   GET /_vault/pick 只回元数据（id/名称/分类/掩码）；选中 POST /_vault/apply 服务端直接落 Key，
   明文不出浏览器。公网两路都会 403（与保存 Key 同级敏感面，内网操作）。 */
function skVpClose(){
  var p = document.getElementById('skVpPanel');
  if (p) p.remove();
  document.removeEventListener('pointerdown', skVpGuard, true);
  document.removeEventListener('keydown', skVpEsc, true);
}
function skVpGuard(ev?){
  var p = document.getElementById('skVpPanel');
  if (p && !p.contains(ev.target)) skVpClose();
}
function skVpEsc(ev?){
  if (ev.key === 'Escape'){ skVpClose(); ev.stopPropagation(); }
}
function skVpOpen(prov?, wrapId?, anchor?){
  skVpClose();
  var panel = document.createElement('div');
  panel.id = 'skVpPanel'; panel.className = 'skvp-panel';
  var head = document.createElement('div'); head.className = 'skvp-head';
  var q = document.createElement('input'); q.className = 'skvp-q'; q.placeholder = '搜索名称/分类…'; q.autocomplete = 'off';
  var xb = el('button', 'guard-btn skvp-x', '✕');
  xb.onclick = skVpClose;
  head.appendChild(q); head.appendChild(xb);
  var list = document.createElement('div'); list.className = 'skvp-list';
  panel.appendChild(head); panel.appendChild(list);
  document.body.appendChild(panel);
  var r = anchor.getBoundingClientRect();
  panel.style.top = Math.max(8, Math.min(window.innerHeight - 340, r.bottom + 6)) + 'px';
  panel.style.left = Math.max(8, Math.min(window.innerWidth - 306, r.left)) + 'px';
  var all = [];
  var render = function(){
    var kw = q.value.trim().toLowerCase();
    list.replaceChildren();
    var hits = all.filter(function(i){ return !kw || ((i.name + ' ' + i.cat).toLowerCase().indexOf(kw) >= 0) });
    if (!hits.length){ list.appendChild(el('div', 'skvp-empty', '密码本里没有匹配的条目')); return }
    hits.sort(function(a, b){ return (b.hasKey ? 1 : 0) - (a.hasKey ? 1 : 0) });
    hits.slice(0, 50).forEach(function(i){
      var row = el('div', 'skvp-item' + (i.hasKey ? '' : ' nokey'));
      row.appendChild(el('b', null, i.name || '未命名'));
      row.appendChild(el('span', 'skvp-meta', (i.cat || '') + (i.mask ? ' · ' + i.mask : '') + (i.hasKey ? '' : ' · 无Key')));
      row.title = i.hasKey ? '点选后直接保存为该供应商的 Key' : '该条目密码字段是空的，选了也会失败';
      row.onclick = function(){ skVpApply(prov, wrapId, i) };
      list.appendChild(row);
    });
    if (hits.length > 50) list.appendChild(el('div', 'skvp-more', '还有 ' + (hits.length - 50) + ' 条，输入关键词缩小范围'));
  };
  q.oninput = render;
  fetch('/_vault/pick').then(function(r){ return r.json() }).then(function(d){
    if (d && d.error){ list.replaceChildren(); list.appendChild(el('div', 'skvp-empty', '✕ ' + d.error)); return }
    all = (d && d.items) || [];
    render(); q.focus();
  }).catch(function(e){ list.replaceChildren(); list.appendChild(el('div', 'skvp-empty', '✕ 拉取密码本失败：' + e.message)) });
  setTimeout(function(){
    document.addEventListener('pointerdown', skVpGuard, true);
    document.addEventListener('keydown', skVpEsc, true);
  }, 0);
}
function skVpApply(prov?, wrapId?, it?){
  var server = prov === 'ds' ? 'deepseek' : (prov === 'volc' ? 'volc' : 'zhipu');
  var res = function(cls, txt){
    if (prov === 'ds') setDsTestResult(cls, txt, wrapId);
    else if (prov === 'volc') setVolcTestResult(cls, txt, wrapId);
    else setZpTestResult(cls, txt, wrapId);
  };
  fetch('/_vault/apply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: server, id: it.id })
  }).then(function(r){ return r.json() }).then(function(d){
    skVpClose();
    if (d && d.error){ res('err', '✕ 导入失败：' + d.error); return }
    skKvDraftSet(prov, 'key', ''); skKvDraftSet(prov, 'name', '');
    res('ok', '✓ 已从密码本导入「' + d.active + '」' + (d.masked ? '（' + d.masked + '）' : '') + '，已设为当前使用');
    if (prov === 'ds'){ loadDsSettings(function(){ skKvList(wrapId, 'ds') }); fetchBalance(function(){ skKvBalance(wrapId) }); }
    else if (prov === 'volc'){ loadVolcSettings(function(){ skKvList(wrapId, 'volc') }); testVolc(null, wrapId); }
    else { loadZpSettings(function(){ skKvList(wrapId, 'zp') }); fetchZhipuQuota(null, wrapId); }
  }).catch(function(e){ skVpClose(); res('err', '✕ 导入失败：' + e.message) });
}

window.skKvModelOptions=skKvModelOptions; window.skKvAliasKey=skKvAliasKey; window.skKvAliasFill=skKvAliasFill; window.skKvSaveAlias=skKvSaveAlias; window.skKvSaveCtx=skKvSaveCtx; window.skKvSaveKey=skKvSaveKey; window.skKvCard=skKvCard; window.skKvCtxCard=skKvCtxCard; window.skRenderProvList=skRenderProvList; window.skRenderKeyWin=skRenderKeyWin; window.skRenderPricing=skRenderPricing; window.popoutFitOnce=popoutFitOnce; window.skRenderTable=skRenderTable; window.prAliasDirtySync=prAliasDirtySync; window.prSaveAliasRow=prSaveAliasRow; window.prSyncAliasRows=prSyncAliasRows; window.prBindAlias=prBindAlias; window.prBindProvLinks=prBindProvLinks; window.prColDefs=prColDefs; window.prOrder=prOrder; window.prWidthOf=prWidthOf; window.prSaveCols=prSaveCols; window.prRerender=prRerender; window.skProvId=skProvId; window.prAliasKeyOf=prAliasKeyOf; window.prCell=prCell; window.prBindHead=prBindHead; window.prDropMark=prDropMark; window.prDropIndex=prDropIndex; window.prThDown=prThDown; window.prMoveCol=prMoveCol; window.prGripDown=prGripDown; window.prColMenu=prColMenu; window.prColMenuOut=prColMenuOut; window.prColMenuClose=prColMenuClose; window.fetchProfile=fetchProfile; window.saveProfile=saveProfile; window.profileItemRow=profileItemRow; window.renderProfile=renderProfile; window.skVpOpen=skVpOpen; window.skVpClose=skVpClose; window.skVpGuard=skVpGuard; window.skVpEsc=skVpEsc; window.skVpApply=skVpApply;

/* @module settings @order 34 @职责 设置弹窗 + 尺寸拖拽 @提供 SETTINGS SETTINGS_NAV_SCROLL SETTINGS_NAV SETTINGS_WIN_KEY MR_DRAG _zpQuotaBusy navRestoreScroll openSettings swGet swSet swClamp applySettingsWinSize bindModalResize loadZpSettings loadDsSettings loadVolcSettings volcModelList skKvFillVolcModels setVolcTestResult testVolc activateVolcKey deleteVolcKey currentSettingsGroup renderSettings renderKeyEmbedPage zpModelList fmtResetTime skKvScope skKvEl skKvSetState skKvDraftGet skKvDraftSet skKvKeys skKvList skKvBalance renderZpQuota fetchZhipuQuota setZpTestResult testZhipu activateZhipuKey deleteZhipuKey buildSoundGrid renderTtsPwaPage renderTtsTuiPage @依赖 - @依赖运行期 openModal closeModal settingsSave loadTtsProviders fetchBalance toast renderVoicePage renderTtsProviderPage renderGuardPage fetchProfile saveProfile loadRoles skRenderKeyWin skRenderProvList S SK activateNamedKey deleteNamedKey DING_SOUNDS getDingVol playDing getDingSound getAskSound playAskDing getSwitchSound playSwitchDing getPwaAgentSound kaEnabled kaStart kaStop getTuiSound @DOM契约 - @严格模式 是 @全局占用 SETTINGS SETTINGS_NAV_SCROLL SETTINGS_NAV SETTINGS_WIN_KEY MR_DRAG _zpQuotaBusy navRestoreScroll openSettings swGet swSet swClamp applySettingsWinSize bindModalResize loadZpSettings loadDsSettings loadVolcSettings volcModelList skKvFillVolcModels setVolcTestResult testVolc activateVolcKey deleteVolcKey currentSettingsGroup renderSettings renderKeyEmbedPage zpModelList fmtResetTime skKvScope skKvEl skKvSetState skKvDraftGet skKvDraftSet skKvKeys skKvList skKvBalance renderZpQuota fetchZhipuQuota setZpTestResult testZhipu activateZhipuKey deleteZhipuKey buildSoundGrid renderTtsPwaPage renderTtsTuiPage @源行 ui/index.html L9349-L9874 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 设置弹窗（导航第 1 项：API Key） ---------- */
var SETTINGS: any = { view: 'apikey', keyProv: '', ds: null, volc: null, testing: false }; /* task214 曾改 sfx（当时 API 子页退役）；task360（主人 2026-11-16 定规）：默认页=API Key（导航第 1 项）——'sfx' 是组 id 无渲染分支，当默认页=打开设置右侧空白（本次根因）；task272 keyProv=内嵌页当前供应商（''=列表页）；task328：volc=火山方舟 Key 缓存 */
/* task251：settingsBackView 退役（画像/角色改设置内普通页，无需返回来源页记忆） */
var SETTINGS_NAV_SCROLL = 0; /* task250：设置一级导航横向滚动跨弹窗记忆——进画像/角色再返回设置不跳回开头 */
/* task250（L-076 通用化，复制 task248）：整块重渲后恢复导航滚动位置；仅 active 不在视野时按 rect 最小微调，
   禁 scrollIntoView（会连带滚动外层容器）。横向（settings-nav）/纵向（profile-nav/roles-nav）通用。 */
function navRestoreScroll(nav?, sl?, st?){
  if (!nav) return;
  nav.scrollLeft = sl || 0;
  nav.scrollTop = st || 0;
  var act = nav.querySelector('button.active');
  if (!act) return;
  var nr = nav.getBoundingClientRect(), ar = act.getBoundingClientRect();
  if (ar.left < nr.left) nav.scrollLeft = Math.max(0, nav.scrollLeft - (nr.left - ar.left + 8));
  else if (ar.right > nr.right) nav.scrollLeft = nav.scrollLeft + (ar.right - nr.right + 8);
  if (ar.top < nr.top) nav.scrollTop = Math.max(0, nav.scrollTop - (nr.top - ar.top + 8));
  else if (ar.bottom > nr.bottom) nav.scrollTop = nav.scrollTop + (ar.bottom - nr.bottom + 8);
}
var SETTINGS_NAV = [
  /* task229（主人 2026-11-11 口述）：API Key 一度为动作项，点击弹「供应商列表页」独立窗（?popout=apikey 无 prov）。
     task272（主人 2026-11-14 口述「点击 API Key 把它嵌入进去，点模型对比再弹出来」）：改普通页内嵌——
     点击切 SETTINGS.view='apikey' 在 settings-body 渲染列表（模型对比按钮仍弹比价大窗，供应商卡切内部编辑页带返回）。 */
  { id: 'apikey', label: 'API Key', ico: '⚿' },
  /* task217（主人 2026-11-11 口述）：左栏「主人画像」「角色」两按钮退役，整体移入设置。
     task251（主人 2026-11-13 截图反馈「点击了角色页之后一级导航没有了，应该在一级导航上呈现」）：
     两项从「动作项」（独立弹窗、一级导航消失）改回**普通页**——点击只切 view，一级导航保持高亮，
     内容区渲染画像/角色（task217 独立弹窗 + 「← 设置」返回行 + settingsBackView 整体退役）。
     图标：roles 用 ◇（P2-1：◈ 与 TTS 冲突）。 */
  { id: 'profile', label: '主人画像', ico: '◉' },
  { id: 'roles', label: '角色', ico: '◇' },
  /* task385：积分板设置页已撤（主人 2026-11-19「右上角本来就有，设置里再弄一个纯重复」）——
     右上角余额显示（fetchBalance 系）为唯一积分入口；DJH 推送快照链路如需整合进右上角另行立项 */
  /* v0.104（task68 S2a）：一级顺序 = 音效 → TTS → 语音对话 → 约束管理。
     音效只放提示音（本机 WebAudio 合成，与 TTS 供应商无关）；子页 id 沿用 tts-pwa/tts-tui，
     仅为历史键名、语义已归音效（改名需同步渲染分发与 11 键回归指纹，另立项）。 */
  { id: 'sfx', label: '音效', ico: '♪', children: [
    { id: 'tts-pwa', label: 'PWA' },
    { id: 'tts-tui', label: 'TUI' }
  ] },
  /* TTS = 供应商集合：子页为供应商动态列表（id 前缀 tts-p-，页内按供应商渲染）。
     首帧静态占位见 TTS_PROVIDER_PLACEHOLDER；/_tts/providers 可用时由 loadTtsProviders() 替换。
      task349（主人语音口述「把这个语音结合到 TTS 里面去、穿插进去」）：原独立一级「语音对话」页并入 TTS——
      TTS 一级首项「朗读与播报」= 原语音对话页（供应商下拉/音色/试听/自动朗读/消息播报），其后是各供应商配置。 */
  { id: 'tts', label: 'TTS', ico: '◈', children: [
    { id: 'tts', label: '朗读与播报' },
    { id: 'tts-p-volcano', label: '火山引擎' },
    { id: 'tts-p-qwen', label: '千问语音（待接入）' },
    { id: 'tts-p-local', label: '老机器语音（待接入）' },
    { id: 'tts-p-rest', label: '另一网站语音（待接入）' },
    { id: 'tts-p-new', label: '＋ 添加供应商' }
  ] },
  { id: 'guard', label: '约束管理', ico: '⛨' }
];
function openSettings(vw?){
  /* task214/task229：设置默认进「音效」（API 子页退役）；API Key 为动作项，点击弹供应商列表页（?popout=apikey），点供应商进 Key 编辑窗 */
  /* task217：vw 可选目标页（从画像/角色返回时回来源页） */
  /* task360（主人定规「打开设置默认页就是 API Key」）：默认 'sfx'——'sfx' 是组 id、分发链无此分支，
     打开设置右侧空白且导航无高亮（主人截图报障根因）；默认页改 'apikey'（导航第 1 项） */
  /* task218（主人 2026-11-11 截图报错 SETTINGS.view.indexOf is not a function）：入口曾裸引用
     `onclick = openSettings`，MouseEvent 被当成 vw ⇒ SETTINGS.view 变事件对象 ⇒ renderSettings 崩。
     调用点已全仓收口（只留显式零参），此处再兜一层类型防御。 */
  if (vw && typeof vw !== 'string') vw = '';
  SETTINGS.view = 'apikey'; /* task360：默认页=API Key（原 'sfx' 组 id 无渲染分支=空白页） */
  if (vw) SETTINGS.view = vw;
  var mbox = document.querySelector('.modal');
  if (mbox) mbox.classList.add('settings'); /* task218：定高定宽一次给足（替 task217 的 wide；两类宽度冲突不并存） */
  openModal('设置', '<div class="settings-wrap" id="settingsWrap"></div>', function(){ closeModal() });
  applySettingsWinSize(); /* task218：主人拖动过的尺寸优先，否则用 .modal.settings 固定默认 */
  var rz = $('#modalResize'); if (rz) rz.hidden = false; /* task218：仅设置弹窗显示拖拽手柄 */
  $('#modalSave').style.display = 'inline-block';
  $('#modalSave').disabled = true;
  $('#modalSave').onclick = function(){ settingsSave(false) };
  $('#modalCancel').onclick = function(){ closeModal() };
  renderSettings();
  loadTtsProviders();
  fetchBalance();
  /* task295 A5 曾在此尾部追加「已绑定设备」区块（独立于子页体系的尾部挂载）；
     task365（主人 2026-11-16 定规）：设备绑定/踢除=后台事务，前台设置不呈现（主人原话「这个是后台的事情……
     如果说我需要有的话，我专门会给他这个功能去做一个设置页面」）——整块退役；后台 /_devices API 与
     devices.json 审计保留，将来要给再做专门页面。 */
}
/* ---------- task218：设置弹窗尺寸（固定默认 + 手动拖拽记忆） ---------- */
var SETTINGS_WIN_KEY = 'littledj.settingsWin'; /* 主人拖过的尺寸；脏值/坏 JSON 一律丢弃回固定默认 */
var MR_DRAG = null; /* 拖拽守卫：null=未拖，window 级 pointermove 空转 */
function swGet(){
  try {
    var o = JSON.parse(localStorage.getItem(SETTINGS_WIN_KEY) || 'null');
    if (!o || typeof o !== 'object') return null;
    var w = Math.round(Number(o.w)), h = Math.round(Number(o.h));
    if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return null;
    return { w: w, h: h };
  } catch(e){ return null }
}
function swSet(o?){ try { localStorage.setItem(SETTINGS_WIN_KEY, JSON.stringify(o)) } catch(e){} }
function swClamp(w?, h?){
  return {
    w: Math.max(420, Math.min(Math.round(w), Math.round(window.innerWidth * 0.96))),
    h: Math.max(320, Math.min(Math.round(h), Math.round(window.innerHeight * 0.90)))
  };
}
function applySettingsWinSize(){
  var m: any = document.querySelector('.modal'); if (!m) return;
  var s = swGet();
  if (!s){ m.style.removeProperty('width'); m.style.removeProperty('height'); return } /* 回 CSS 固定默认 760×720 */
  s = swClamp(s.w, s.h);
  m.style.width = s.w + 'px'; m.style.height = s.h + 'px';
}
/* init 一次性绑定（对齐三栏拖拽范式 10695-10735）：window 三个 pointer 监听只挂一次，
   靠 MR_DRAG 守卫空转；closeModal 只清状态不解绑，杜绝重复绑定泄漏。 */
function bindModalResize(){
  var hd = $('#modalResize'); if (!hd) return;
  hd.addEventListener('pointerdown', function(ev){
    var m: any = document.querySelector('.modal'); if (!m) return;
    ev.preventDefault();
    var r = m.getBoundingClientRect();
    MR_DRAG = { x: ev.clientX, y: ev.clientY, w: r.width, h: r.height, m: m };
    try { hd.setPointerCapture(ev.pointerId) } catch(e){}
    hd.classList.add('active');
  });
  function mrEnd(){
    if (!MR_DRAG) return;
    var m = MR_DRAG.m;
    MR_DRAG = null;
    var h2 = $('#modalResize'); if (h2) h2.classList.remove('active');
    if (m && m.classList.contains('settings')){
      var r = m.getBoundingClientRect();
      swSet({ w: Math.round(r.width), h: Math.round(r.height) });
    }
  }
  window.addEventListener('pointermove', function(ev){
    if (!MR_DRAG) return;
    var s = swClamp(MR_DRAG.w + (ev.clientX - MR_DRAG.x), MR_DRAG.h + (ev.clientY - MR_DRAG.y));
    MR_DRAG.m.style.width = s.w + 'px'; MR_DRAG.m.style.height = s.h + 'px';
  });
  window.addEventListener('pointerup', mrEnd);
  window.addEventListener('pointercancel', mrEnd);
  hd.addEventListener('dblclick', function(){ /* 双击复位：清记忆回固定默认，防拖坏卡死 */
    try { localStorage.removeItem(SETTINGS_WIN_KEY) } catch(e){}
    var m: any = document.querySelector('.modal');
    if (m){ m.style.removeProperty('width'); m.style.removeProperty('height') }
  });
}
/* task214 P1-5 / task215：只做数据拉取，不再绑定设置弹窗重渲（Key 管理窗由 skRenderKeyWin 按 prov 自行回填） */
function loadZpSettings(cb?){
  fetch('/_settings/zhipu').then(function(r){ return r.json() }).then(function(d){
    SETTINGS.zp = d;
    if (cb) cb(d);
  }).catch(function(){ if (cb) cb(null) });
}
function loadDsSettings(cb?){
  fetch('/_settings/deepseek').then(function(r){ return r.json() }).then(function(d){
    SETTINGS.ds = d;
    if (cb) cb(d);
  }).catch(function(){ if (cb) cb(null) });
}
/* task328：火山方舟 Key（与 DS/GLM 同构拉取；火山无余额/额度接口，卡片只挂连通性测试与 Key 列表） */
function loadVolcSettings(cb?){
  fetch('/_settings/volc').then(function(r){ return r.json() }).then(function(d){
    SETTINGS.volc = d;
    if (cb) cb(d);
  }).catch(function(){ if (cb) cb(null) });
}
function currentSettingsGroup(){
  for (var i = 0; i < SETTINGS_NAV.length; i++){
    var n = SETTINGS_NAV[i];
    if (n.children && n.children.some(function(c){ return c.id === SETTINGS.view })) return n;
  }
  return null;
}
function renderSettings(){
  var wrap = $('#settingsWrap'); if (!wrap) return;
  if (typeof SETTINGS.view !== 'string' || !SETTINGS.view) SETTINGS.view = 'apikey'; /* task218：任何来源脏值只回落默认页，不再崩；task360 默认页=apikey */
  /* task360 防复发：view 落在组 id（如 'sfx'）上时回落组内首子页——组 id 无渲染分支，直渲染=空白页（本次空白的结构性根治；
     与导航父按钮行为一致（点组=进首子页）；'tts' 组 id===children[0].id 不受影响） */
  for (var gi = 0; gi < SETTINGS_NAV.length; gi++){
    var gn = SETTINGS_NAV[gi];
    if (gn.children && gn.id === SETTINGS.view) { SETTINGS.view = gn.children[0].id; break; }
  }
  /* task248（主人 2026-11-12 截图反馈）：点导航项后导航横向滚动被重置、跳回开头。
     根因=整页 wrap.innerHTML='' 重渲，nav 的 scrollLeft 随容器一起销毁。改为先记原位置、渲染后恢复。
     task250：恢复逻辑抽公共函数 navRestoreScroll（画像/角色页同款）；弹窗重开（进画像/角色后返回）时
     回落 SETTINGS_NAV_SCROLL 跨弹窗记忆，同样不跳回开头。 */
  var navPrev = wrap.querySelector('.settings-nav');
  var navScroll = navPrev ? navPrev.scrollLeft : (SETTINGS_NAV_SCROLL || 0);
  wrap.replaceChildren();
  /* v0.097.1（御史 P1-1）：切页统一复位保存钮，防 TTS 页 display:none 泄漏到 Key/智谱等需要保存钮的页；
     各 render*Page 内对 display/disabled 的覆盖都在本行之后执行，语义不变 */
  var sb0 = $('#modalSave'); if (sb0){ sb0.style.display = 'inline-block'; sb0.disabled = true; sb0.onclick = function(){ settingsSave(false) } } /* task251：onclick 一并复位，防画像页绑定残留到别的页 */
  var nav = el('div', 'settings-nav');
  SETTINGS_NAV.forEach(function(n){
    if (n.children){
      var inGroup = n.children.some(function(c){ return c.id === SETTINGS.view });
      var p = el('button', 'nav-parent' + (inGroup ? ' active' : ''));
      p.innerHTML = '<span>' + n.ico + '</span>' + n.label;
      p.onclick = function(){ SETTINGS.view = n.children[0].id; renderSettings() };
      nav.appendChild(p);
      return;
    }
    var b2 = el('button', SETTINGS.view === n.id ? 'active' : '');
    b2.innerHTML = '<span>' + n.ico + '</span>' + n.label;
    if (n.id === 'apikey'){
      /* task272：切内嵌页（不再弹 ?popout=apikey 独立窗）；每次进列表先复位到列表态 */
      b2.onclick = function(){ SETTINGS.view = 'apikey'; SETTINGS.keyProv = ''; renderSettings() };
    } else {
      /* task251：profile/roles 从动作项改普通页，与 guard 等同走通用切页分支（一级导航保持） */
      b2.onclick = function(){ SETTINGS.view = n.id; renderSettings() };
    }
    nav.appendChild(b2);
  });
  wrap.appendChild(nav);
  /* task248/task250：恢复导航横向滚动位置（点导航不再跳回开头）；仅当 active 不在视野内才微调 */
  navRestoreScroll(nav, navScroll, 0);
  nav.addEventListener('scroll', function(){ SETTINGS_NAV_SCROLL = nav.scrollLeft }); /* task250：跨弹窗记忆（监听随 nav 元素销毁，无泄漏） */
  var body = el('div', 'settings-body');
  var group = currentSettingsGroup();
  if (group){
    var tabs = el('div', 'settings-tabs');
    group.children.forEach(function(c){
      var t = el('button', 'settings-tab' + (SETTINGS.view === c.id ? ' active' : ''), c.label);
      t.onclick = function(){
        if (SETTINGS.view === c.id) return;
        SETTINGS.view = c.id; renderSettings();
      };
      tabs.appendChild(t);
    });
    body.appendChild(tabs);
  }
  if (SETTINGS.view === 'tts-pwa') renderTtsPwaPage(body);
  else if (SETTINGS.view === 'tts') renderVoicePage(body); /* task349：TTS 一级=朗读与播报（原语音对话页并入） */
  else if (SETTINGS.view === 'tts-voice') renderVoicePage(body); /* 旧深链兼容（一级项已删，保留分派） */
  else if (SETTINGS.view === 'tts-tui') renderTtsTuiPage(body);
  else if (SETTINGS.view.indexOf('tts-p-') === 0) renderTtsProviderPage(body, SETTINGS.view.slice(6));
  else if (SETTINGS.view === 'guard') renderGuardPage(body);
  else if (SETTINGS.view === 'profile'){
    /* task251：画像为设置内普通页——容器进 settings-body，数据每次进入强刷（原 openProfile 行为）；modalSave=手动保存 */
    var pfw = el('div', 'profile-wrap'); pfw.id = 'profileWrap';
    pfw.innerHTML = '<div class="emptyhint">加载中…</div>';
    body.appendChild(pfw);
    fetchProfile();
    var sb1 = $('#modalSave'); if (sb1){ sb1.style.display = 'inline-block'; sb1.disabled = false; sb1.onclick = function(){ saveProfile('手动保存') } }
  }
  else if (SETTINGS.view === 'roles'){
    /* task251：角色为设置内普通页——容器进 settings-body，数据每次进入强刷（原 openRoles 行为） */
    var rw2 = el('div', 'roles-wrap'); rw2.id = 'rolesWrap';
    rw2.innerHTML = '<div class="emptyhint">加载角色…</div>';
    body.appendChild(rw2);
    loadRoles();
  }
  wrap.appendChild(body);
  /* task275（主人 2026-11-14 截图「点设置里的 API Key 右侧空白」）：内嵌页必须等 body 挂进文档后再渲染。
     skRenderProvList/skRenderKeyWin 以 document.querySelector('#keyEmbedBox') 定位容器，游离节点下查不到
     ⇒ 静默 return 白屏。其余页分支都是异步首拉回调里才查询（profile/roles/guard），唯 apikey 同步查询。 */
  if (SETTINGS.view === 'apikey') renderKeyEmbedPage(body);
}
/* task272：设置 → API Key 内嵌页（主人 2026-11-14 截图反馈：原点击直接弹 ?popout=apikey 新窗）。
   两态同容器切换：SETTINGS.keyProv=''→供应商列表；'ds'/'zp'→该供应商 Key 编辑页（顶部返回）。
   渲染复用 skRenderProvList / skRenderKeyWin（容器化 scope 零复制）；模型对比按钮仍走 popoutOpen('pricing')。 */
function renderKeyEmbedPage(body?){
  var host = el('div', 'key-embed');
  body.appendChild(host);
  var sb = $('#modalSave'); if (sb) sb.style.display = 'none'; /* 本页无弹窗级保存（Key 卡内自带保存），底部禁用「保存」不上屏 */
  var prov = SETTINGS.keyProv;
  if (prov === 'ds' || prov === 'zp' || prov === 'volc'){
    var back = el('button', 'guard-btn key-embed-back', '‹ 返回 API Key 管理');
    back.onclick = function(){ SETTINGS.keyProv = ''; renderSettings() };
    host.appendChild(back);
  }
  var box = el('div', 'pr-panel'); box.id = 'keyEmbedBox';
  host.appendChild(box);
  if (prov === 'ds' || prov === 'zp' || prov === 'volc') skRenderKeyWin(prov, 'keyEmbedBox');
  else skRenderProvList('keyEmbedBox', true);
}
function zpModelList(){
  var ms = (S.models || []).filter(function(m){ return m.providerID === 'zhipuai-coding-plan' });
  if (!ms.length) ms = [
    { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3', name: 'GLM-5.3' },
    { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3-highspeed', name: 'GLM-5.3 Highspeed' },
    { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }
  ];
  return ms;
}
function fmtResetTime(ts?){
  if (!ts) return '';
  var d = new Date(typeof ts === 'number' ? ts : String(ts));
  if (isNaN(d.getTime())) return '';
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
}
/* task214：Key 视图容器查询 helper（scope=wrapId 字符串或元素；比价页三入口 DOM 隔离，零全局 id） */
function skKvScope(scope?){
  if (scope && typeof scope === 'object' && typeof scope.querySelector === 'function') return scope;
  return $('#' + (scope || SK.prWrap || 'prWrap')) || null;
}
function skKvEl(scope?, cls?){ var s = skKvScope(scope); return s ? s.querySelector('.' + cls) : null }
function skKvSetState(el2?, cls?, text?){
  if (!el2) return;
  el2.classList.remove('ok', 'err', 'waiting');
  if (cls) el2.classList.add(cls);
  el2.textContent = text;
}
function skKvDraftGet(prov?, f?){ return ((SK.kvDraft || {})[prov] || {})[f] || '' }
function skKvDraftSet(prov?, f?, v?){ SK.kvDraft = SK.kvDraft || {}; SK.kvDraft[prov] = SK.kvDraft[prov] || {}; SK.kvDraft[prov][f] = v }
function skKvKeys(prov?){ var d = prov === 'ds' ? SETTINGS.ds : (prov === 'volc' ? SETTINGS.volc : SETTINGS.zp); return (d && d.keys) || [] }
/* 局部重渲已保存 Key 列表（activate/delete 后调，不整页重渲） */
function skKvList(scope?, prov?){
  var box = skKvEl(scope, 'kv-' + prov + '-list'); if (!box) return;
  var keys = skKvKeys(prov);
  box.replaceChildren();
  if (!keys.length){ box.appendChild(el('div', 'empty', '还没有命名保存的 Key')); return }
  keys.forEach(function(k){
    var it = el('div', 'key-item');
    it.innerHTML = '<span class="kn">' + esc(k.name) + '</span><span class="kk">' + esc(k.masked) + '</span>' + (k.active ? '<span class="badge">使用中</span>' : '');
    it.onclick = function(){
      if (prov === 'ds') activateNamedKey(k.name, scope);
      else if (prov === 'volc') activateVolcKey(k.name, scope);
      else activateZhipuKey(k.name, scope);
    };
    var del = el('button', 'kdel', '✕'); del.title = '删除这个 Key';
    del.onclick = function(ev){
      ev.stopPropagation();
      if (prov === 'ds') deleteNamedKey(k.name, scope);
      else if (prov === 'volc') deleteVolcKey(k.name, scope);
      else deleteZhipuKey(k.name, scope);
    };
    it.appendChild(del);
    box.appendChild(it);
  });
}
/* 余额块（DeepSeek，S.balance 与右上角胶囊同源） */
function skKvBalance(scope?){
  var b = skKvEl(scope, 'kv-ds-balance'); if (!b) return;
  b.textContent = S.balance ? ('余额 ' + S.balance) : '余额 —';
}
function renderZpQuota(scope?){
  var q = SETTINGS.zpQuota;
  [['kv-zp-q5val', 'kv-zp-q5bar', 'kv-zp-q5sub', 'fiveHour'], ['kv-zp-qwval', 'kv-zp-qwbar', 'kv-zp-qwsub', 'week']].forEach(function(cfg){
    var v = skKvEl(scope, cfg[0]), b = skKvEl(scope, cfg[1]), s = skKvEl(scope, cfg[2]);
    if (!v) return;
    var item = (q && q.ok) ? q[cfg[3]] : null;
    if (!item || item.percentage == null){
      v.textContent = '—';
      if (b) b.style.width = '0%';
      if (s) s.textContent = (q && !q.ok) ? (q.error || '') : '未配置 Key';
      return;
    }
    var pct = Math.max(0, Math.min(100, Number(item.percentage) || 0));
    v.textContent = (Math.round(pct * 10) / 10) + '%';
    if (b) b.style.width = pct + '%';
    if (s) s.textContent = item.resetAt ? ('重置 ' + fmtResetTime(item.resetAt)) : '';
  });
}
var _zpQuotaBusy = false;
function fetchZhipuQuota(apiKey?, scope?){
  if (_zpQuotaBusy) return;
  _zpQuotaBusy = true;
  fetch('/_settings/zhipu/quota', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(apiKey ? { apiKey: apiKey } : {})
  }).then(function(r){ return r.json() }).then(function(d){
    _zpQuotaBusy = false; SETTINGS.zpQuota = d; renderZpQuota(scope);
  }).catch(function(e){
    _zpQuotaBusy = false; SETTINGS.zpQuota = { ok: false, error: e.message }; renderZpQuota(scope);
  });
}
function setZpTestResult(cls?, text?, scope?){
  skKvSetState(skKvEl(scope, 'kv-zp-result'), cls, text);
}
function testZhipu(newKey?, scope?){
  if (SETTINGS.testingZp) return;
  SETTINGS.testingZp = true;
  var tb = skKvEl(scope, 'kv-zp-test'); if (tb){ tb.disabled = true; tb.textContent = '测试中…' }
  setZpTestResult('waiting', '正在连接 open.bigmodel.cn…', scope);
  var key = newKey || (function(){ var i = skKvEl(scope, 'kv-zp-key'); return i ? i.value.trim() : '' })();
  fetch('/_settings/zhipu/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(key ? { apiKey: key } : {})
  }).then(function(r){ return r.json() }).then(function(d){
    SETTINGS.testingZp = false;
    var tb2 = skKvEl(scope, 'kv-zp-test'); if (tb2){ tb2.disabled = false; tb2.textContent = '测试连接' }
    if (d.ok){
      setZpTestResult('ok', '✓ 测试成功，GLM 模型可用', scope);
      fetchZhipuQuota(null, scope);
    } else {
      setZpTestResult('err', '✕ 测试失败：' + (d.error || '未知错误'), scope);
    }
  }).catch(function(e){
    SETTINGS.testingZp = false;
    var tb2 = skKvEl(scope, 'kv-zp-test'); if (tb2){ tb2.disabled = false; tb2.textContent = '测试连接' }
    setZpTestResult('err', '✕ 测试失败：' + e.message, scope);
  });
}
function activateZhipuKey(name?, scope?){
  fetch('/_settings/zhipu/active', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (!d.ok){ setZpTestResult('err', '✕ 切换失败：' + (d.error || '未知错误'), scope); return }
    loadZpSettings(function(){
      var ni = skKvEl(scope, 'kv-zp-name'); if (ni) ni.value = d.name;
      var ki = skKvEl(scope, 'kv-zp-key'); if (ki) ki.value = '';
      skKvDraftSet('zp', 'name', d.name); skKvDraftSet('zp', 'key', '');
      skKvList(scope, 'zp');
      setZpTestResult('waiting', '正在验证「' + d.name + '」…', scope);
      testZhipu(d.key, scope);
      fetchZhipuQuota(null, scope);
    });
  }).catch(function(e){ setZpTestResult('err', '✕ 切换失败：' + e.message, scope) });
}
function deleteZhipuKey(name?, scope?){
  if (!confirm('确定删除「' + name + '」这个 Key 吗？' + (SETTINGS.zp && SETTINGS.zp.active === name ? '\n它正在使用中，删除后将不再有可用 Key。' : ''))) return;
  fetch('/_settings/zhipu/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (d.error){ setZpTestResult('err', '✕ 删除失败：' + d.error, scope); return }
    var ni = skKvEl(scope, 'kv-zp-name'), ki = skKvEl(scope, 'kv-zp-key');
    var keepName = d.wasActive ? '' : (ni ? ni.value : '');
    var keepKey = d.wasActive ? '' : (ki ? ki.value : '');
    loadZpSettings(function(){
      if (ni) ni.value = keepName; if (ki) ki.value = keepKey;
      skKvDraftSet('zp', 'name', keepName); skKvDraftSet('zp', 'key', keepKey);
      skKvList(scope, 'zp');
      setZpTestResult('ok', '✓ 已删除「' + name + '」' + (d.wasActive ? '（当前已无可用 Key）' : ''), scope);
      SETTINGS.zpQuota = d.wasActive ? { ok: false, error: '还没有可用的 API Key' } : SETTINGS.zpQuota;
      renderZpQuota(scope);
    });
  }).catch(function(e){ setZpTestResult('err', '✕ 删除失败：' + e.message, scope) });
}
/* ---------- task328：火山方舟（Volcengine Ark · 豆包）Key 管理（与 DS/GLM 同款交互） ---------- */
/* 内置常见豆包模型（兜底展示；测试连接成功后用账号可见模型清单覆盖/补全，见 volcModelList） */
function volcModelList(){
  var FALLBACK = [
    ['doubao-seed-1-6-250615', 'Doubao Seed 1.6'],
    ['doubao-seed-1-6-flash-250715', 'Doubao Seed 1.6 Flash'],
    ['doubao-seed-1-6-thinking-250715', 'Doubao Seed 1.6 Thinking'],
    ['doubao-1-5-pro-32k-250115', 'Doubao 1.5 Pro 32K'],
    ['doubao-1-5-lite-32k-250115', 'Doubao 1.5 Lite 32K']
  ];
  var live = (SETTINGS.volc && SETTINGS.volc.liveModels) || [];
  var out = [], seen = {};
  live.forEach(function(id){ if (id && !seen[id]){ seen[id] = 1; out.push([id, id]) } });
  FALLBACK.forEach(function(p){ if (!seen[p[0]]){ seen[p[0]] = 1; out.push(p) } });
  return out;
}
function setVolcTestResult(cls?, text?, scope?){
  skKvSetState(skKvEl(scope, 'kv-volc-result'), cls, text);
}
function testVolc(newKey?, scope?){
  if (SETTINGS.testingVolc) return;
  SETTINGS.testingVolc = true;
  var tb = skKvEl(scope, 'kv-volc-test'); if (tb){ tb.disabled = true; tb.textContent = '测试中…' }
  setVolcTestResult('waiting', '正在连接火山方舟 ark.cn-beijing.volces.com…', scope);
  var key = newKey || (function(){ var i = skKvEl(scope, 'kv-volc-key'); return i ? i.value.trim() : '' })();
  fetch('/_settings/volc/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(key ? { apiKey: key } : {})
  }).then(function(r){ return r.json() }).then(function(d){
    SETTINGS.testingVolc = false;
    var tb2 = skKvEl(scope, 'kv-volc-test'); if (tb2){ tb2.disabled = false; tb2.textContent = '测试连接' }
    if (d.ok){
      if (d.models && d.models.length){
        SETTINGS.volc = SETTINGS.volc || {}; SETTINGS.volc.liveModels = d.models;
        skKvFillVolcModels(scope);
      }
      setVolcTestResult('ok', '✓ 测试成功' + ((d.models && d.models.length) ? ('，账号可见 ' + d.models.length + ' 个模型') : ''), scope);
    } else {
      setVolcTestResult('err', '✕ 测试失败：' + (d.error || '未知错误'), scope);
    }
  }).catch(function(e){
    SETTINGS.testingVolc = false;
    var tb2 = skKvEl(scope, 'kv-volc-test'); if (tb2){ tb2.disabled = false; tb2.textContent = '测试连接' }
    setVolcTestResult('err', '✕ 测试失败：' + e.message, scope);
  });
}
/* 测试成功拿到账号可见模型后重建下拉（保留当前选中值；已选自定义 ID 不在清单里时补一项） */
function skKvFillVolcModels(scope?){
  var sel = skKvEl(scope, 'kv-volc-model'); if (!sel) return;
  var cur = sel.value;
  var opts = volcModelList();
  sel.replaceChildren();
  opts.forEach(function(pair){
    var o = document.createElement('option');
    o.value = pair[0]; o.textContent = pair[1];
    sel.appendChild(o);
  });
  var oc = document.createElement('option'); oc.value = '__custom__'; oc.textContent = '自定义接入点/模型 ID…'; sel.appendChild(oc);
  if (cur && cur !== '__custom__' && !opts.some(function(p){ return p[0] === cur })){
    var ox = document.createElement('option'); ox.value = cur; ox.textContent = cur; sel.insertBefore(ox, oc);
  }
  sel.value = cur || (opts[0] ? opts[0][0] : '__custom__');
  sel.setAttribute('data-prev', sel.value);
}
function activateVolcKey(name?, scope?){
  fetch('/_settings/volc/active', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (!d.ok){ setVolcTestResult('err', '✕ 切换失败：' + (d.error || '未知错误'), scope); return }
    loadVolcSettings(function(){
      var ni = skKvEl(scope, 'kv-volc-name'); if (ni) ni.value = d.name;
      var ki = skKvEl(scope, 'kv-volc-key'); if (ki) ki.value = '';
      skKvDraftSet('volc', 'name', d.name); skKvDraftSet('volc', 'key', '');
      skKvList(scope, 'volc');
      setVolcTestResult('waiting', '正在验证「' + d.name + '」…', scope);
      testVolc(d.key, scope);
    });
  }).catch(function(e){ setVolcTestResult('err', '✕ 切换失败：' + e.message, scope) });
}
function deleteVolcKey(name?, scope?){
  if (!confirm('确定删除「' + name + '」这个 Key 吗？' + (SETTINGS.volc && SETTINGS.volc.active === name ? '\n它正在使用中，删除后将不再有可用 Key。' : ''))) return;
  fetch('/_settings/volc/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (d.error){ setVolcTestResult('err', '✕ 删除失败：' + d.error, scope); return }
    var ni = skKvEl(scope, 'kv-volc-name'), ki = skKvEl(scope, 'kv-volc-key');
    var keepName = d.wasActive ? '' : (ni ? ni.value : '');
    var keepKey = d.wasActive ? '' : (ki ? ki.value : '');
    loadVolcSettings(function(){
      if (ni) ni.value = keepName; if (ki) ki.value = keepKey;
      skKvDraftSet('volc', 'name', keepName); skKvDraftSet('volc', 'key', keepKey);
      skKvList(scope, 'volc');
      setVolcTestResult('ok', '✓ 已删除「' + name + '」' + (d.wasActive ? '（当前已无可用 Key）' : ''), scope);
    });
  }).catch(function(e){ setVolcTestResult('err', '✕ 删除失败：' + e.message, scope) });
}
function buildSoundGrid(key?, cur?, onPick?){
  var grid = el('div', 'soundgrid');
  DING_SOUNDS.concat([{ id: 'none', label: '无' }] as any[]).forEach(function(s: any){ /* 尾格「无」=该场景静音（v0.097 主人需求） */
    var b = el('button', 'soundchip' + (s.id === cur ? ' active' : ''), s.label);
    b.onclick = function(){
      try { localStorage.setItem(key, s.id) } catch(e){}
      Array.prototype.forEach.call(grid.querySelectorAll('.soundchip'), function(x){ x.classList.remove('active') });
      b.classList.add('active');
      onPick(s.id);
    };
    grid.appendChild(b);
  });
  return grid;
}
function renderTtsPwaPage(body?){
  body.appendChild(el('p', 'desc', 'PWA 端分两组：大管家回复结束（每轮回复完响一次）、其他角色回复（小管家/枢机/执笔/御史，默认关）。另有提问音、自动切会话音；音量共用。听不到时先确认设备未静音、浏览器标签页未被静音；网页音频需先点击页面一次才被允许发声。'));
  body.appendChild(el('div', 'settings-sub', '音量'));
  var volRow = el('div', 'volrow');
  var vol = document.createElement('input');
  vol.type = 'range'; vol.min = '0'; vol.max = '100'; vol.step = '5'; vol.id = 'mDingVol';
  vol.value = String(getDingVol());
  var volVal = el('span', 'volval', vol.value + '%');
  vol.oninput = function(){
    var v = Math.max(0, Math.min(100, parseInt(vol.value, 10) || 0));
    try { localStorage.setItem('littledj.dingVol', String(v)) } catch(e){}
    volVal.textContent = v + '%';
  };
  vol.onchange = function(){ playDing() };
  volRow.appendChild(vol); volRow.appendChild(volVal);
  body.appendChild(volRow);
  body.appendChild(el('div', 'settings-sub', '大管家回复结束提示音（点击即试听并选中）'));
  body.appendChild(buildSoundGrid('littledj.dingSound', getDingSound(), function(){ playDing() }));
  body.appendChild(el('div', 'settings-sub', '向我提问提示音（点击即试听并选中）'));
  body.appendChild(buildSoundGrid('littledj.askSound', getAskSound(), function(){ playAskDing() }));
  body.appendChild(el('div', 'settings-sub', '自动切换会话提示音（上下文到阈值时）'));
  body.appendChild(buildSoundGrid('littledj.switchSound', getSwitchSound(), function(){ playSwitchDing() }));
  body.appendChild(el('div', 'settings-sub', '其他角色/子代理默认无（旧值已自动关，可重开）'));
  body.appendChild(buildSoundGrid('littledj.agentSound', getPwaAgentSound(), function(id){ playDing(id) }));
  /* v0.097：独立试听按钮四只退役（点音色即试听，主人需求）；音量 0 提示保留 */
  body.appendChild(el('span', 'test-result', getDingVol() <= 0 ? '音量为 0，不会发声' : '更改即时自动保存，无需点保存'));
  /* v0.098：后台通知（切后台/锁屏时系统横幅+系统默认音；浏览器被系统杀掉则失效，关闭去浏览器站点设置） */
  body.appendChild(el('div', 'settings-sub', '后台通知（切后台/锁屏也能提醒）'));
  var nrow = el('div', 'test-row');
  var nb = el('button', 'test-btn', '');
  function refreshNotifyBtn(){
    if (!('Notification' in window)){ nb.textContent = '此浏览器不支持通知'; nb.disabled = true; return }
    if (Notification.permission === 'granted'){ nb.textContent = '后台通知：已开启 ✓'; nb.disabled = true; }
    else if (Notification.permission === 'denied'){ nb.textContent = '被浏览器拒绝：请到浏览器设置→网站通知里允许'; nb.disabled = true; }
    else { nb.textContent = '开启后台通知'; nb.disabled = false }
  }
  nb.onclick = function(){
    if (!('Notification' in window)) return;
    try { var npr = Notification.requestPermission(refreshNotifyBtn); if (npr && npr.then) npr.then(refreshNotifyBtn).catch(refreshNotifyBtn) } catch(e){} /* v0.098.1（御史 P2-b）：新旧两式回调全覆盖 */
  };
  refreshNotifyBtn();
  nrow.appendChild(nb);
  nrow.appendChild(el('span', 'test-result', '切后台/锁屏时系统横幅提醒；通知声为系统默认音；浏览器被手机杀掉则收不到'));
  body.appendChild(nrow);
  /* task193：息屏/后台完成音保活（近无声循环音轨 + MediaSession，页面像音乐 App 一样后台常驻） */
  body.appendChild(el('div', 'settings-sub', '息屏后台完成音（保活，默认开）'));
  var krow = el('div', 'test-row');
  var kb = el('button', 'test-btn', '');
  function refreshKaBtn(){ kb.textContent = kaEnabled() ? '保活：已开启（点此关闭）' : '保活：已关闭（点此开启）' }
  kb.onclick = function(){
    try { localStorage.setItem('littledj.bgKeepAlive', kaEnabled() ? '0' : '1') } catch(e){}
    if (kaEnabled()) kaStart(); else kaStop();
    refreshKaBtn();
  };
  refreshKaBtn();
  krow.appendChild(kb);
  krow.appendChild(el('span', 'test-result', '开启后手机息屏/切后台，页面当作「正在播放」继续守任务，任务完成音照响（子代理完成音走本页「其他角色/子代理」组，默认「无」=不响，要听请先选一个音色）；需允许浏览器后台运行；耗电略增；从最近任务划掉则失效'));
  body.appendChild(krow);
  var sb = $('#modalSave'); if (sb) sb.style.display = 'none';
}
function renderTtsTuiPage(body?){
  body.appendChild(el('p', 'desc', 'TUI 端任务完成、子代理完成、AI 提问、出错四个场景可各配独立音色，与 PWA 页两组开关互不影响；TUI 事件由 proxy 广播，网页音频需先点击页面一次才被允许发声。'));
  body.appendChild(el('div', 'settings-sub', '任务完成提示音（TUI 侧，点击即试听并选中）'));
  body.appendChild(buildSoundGrid('littledj.tuiDoneSound', getTuiSound('done'), function(id){ playDing(id) }));
  body.appendChild(el('div', 'settings-sub', 'AI 提问提示音（点击即试听并选中）'));
  body.appendChild(buildSoundGrid('littledj.tuiAskSound', getTuiSound('ask'), function(id){ playDing(id) }));
  body.appendChild(el('div', 'settings-sub', '出错提示音（单声，点击即试听并选中）'));
  body.appendChild(buildSoundGrid('littledj.tuiErrorSound', getTuiSound('error'), function(id){ playDing(id) }));
  body.appendChild(el('div', 'settings-sub', '其他角色/子代理默认无（旧值已自动关，可重开）'));
  body.appendChild(buildSoundGrid('littledj.tuiAgentSound', getTuiSound('agent'), function(id){ playDing(id) }));
  body.appendChild(el('p', 'desc', '音量沿用 PWA 页的共用音量。'));
  /* v0.097：独立试听按钮四只退役（点音色即试听，主人需求）；音量 0 提示保留 */
  body.appendChild(el('span', 'test-result', getDingVol() <= 0 ? '音量为 0，不会发声' : '更改即时自动保存，无需点保存'));
  var sb = $('#modalSave'); if (sb) sb.style.display = 'none';
}
window.SETTINGS=SETTINGS; window.SETTINGS_NAV_SCROLL=SETTINGS_NAV_SCROLL; window.SETTINGS_NAV=SETTINGS_NAV; window.SETTINGS_WIN_KEY=SETTINGS_WIN_KEY; window.MR_DRAG=MR_DRAG; window._zpQuotaBusy=_zpQuotaBusy; window.navRestoreScroll=navRestoreScroll; window.openSettings=openSettings; window.swGet=swGet; window.swSet=swSet; window.swClamp=swClamp; window.applySettingsWinSize=applySettingsWinSize; window.bindModalResize=bindModalResize; window.loadZpSettings=loadZpSettings; window.loadDsSettings=loadDsSettings; window.loadVolcSettings=loadVolcSettings; window.volcModelList=volcModelList; window.skKvFillVolcModels=skKvFillVolcModels; window.setVolcTestResult=setVolcTestResult; window.testVolc=testVolc; window.activateVolcKey=activateVolcKey; window.deleteVolcKey=deleteVolcKey; window.currentSettingsGroup=currentSettingsGroup; window.renderSettings=renderSettings; window.renderKeyEmbedPage=renderKeyEmbedPage; window.zpModelList=zpModelList; window.fmtResetTime=fmtResetTime; window.skKvScope=skKvScope; window.skKvEl=skKvEl; window.skKvSetState=skKvSetState; window.skKvDraftGet=skKvDraftGet; window.skKvDraftSet=skKvDraftSet; window.skKvKeys=skKvKeys; window.skKvList=skKvList; window.skKvBalance=skKvBalance; window.renderZpQuota=renderZpQuota; window.fetchZhipuQuota=fetchZhipuQuota; window.setZpTestResult=setZpTestResult; window.testZhipu=testZhipu; window.activateZhipuKey=activateZhipuKey; window.deleteZhipuKey=deleteZhipuKey; window.buildSoundGrid=buildSoundGrid; window.renderTtsPwaPage=renderTtsPwaPage; window.renderTtsTuiPage=renderTtsTuiPage;

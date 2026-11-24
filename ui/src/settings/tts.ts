/* @module tts @order 35 @职责 TTS 供应商 + 语音对话页 @提供 TTS_PROVIDER_PLACEHOLDER TTS_UI VOICE_UI ttsProviderList ttsProviderInfo ttsDefaultProviderName ttsTypeLabel ttsBuildNavChildren ttsApplyNav loadTtsProviders ttsKeyHint ttsCollectVoices drawTtsVoiceTable renderTtsVoiceTable ttsProviderPreview ttsProviderSave ttsProviderDelete renderTtsProviderForm renderTtsProviderPage voiceShownName voiceSubName loadVoiceList renderVoiceRows renderProviderVoiceRows voicePreview renderVoicePage @依赖 - @依赖运行期 SETTINGS_NAV SETTINGS renderSettings toast playVoiceAudio getVoiceChatVoice send voiceReadEnabled @DOM契约 - @严格模式 是 @全局占用 TTS_PROVIDER_PLACEHOLDER TTS_UI VOICE_UI ttsProviderList ttsProviderInfo ttsDefaultProviderName ttsTypeLabel ttsBuildNavChildren ttsApplyNav loadTtsProviders ttsKeyHint ttsCollectVoices drawTtsVoiceTable renderTtsVoiceTable ttsProviderPreview ttsProviderSave ttsProviderDelete renderTtsProviderForm renderTtsProviderPage voiceShownName voiceSubName loadVoiceList renderVoiceRows renderProviderVoiceRows voicePreview renderVoicePage @源行 ui/index.html L9875-L10495 @测试锚点 - @被调用 - */
'use strict';
/* ---------- TTS 供应商 tab（task68 S2b-B：表单 + 音色表 CRUD；语音对话页三点归 S2b-C） ----------
   数据源：/_tts/providers。接口未就绪（404 / 网络 / ok:false）时静默回落 S2a 静态占位，不白屏、不抛错。
   火山页 = 供应商表单 + 音色表整表保存；千问/老机器/另一网站 = 待接入只读槽位（可删）。
   Key 只在 type=password 输入框提交一次，永不回填、不落 localStorage。 */
var TTS_PROVIDER_PLACEHOLDER = [
  { id: 'volcano', label: '火山引擎', type: 'volcano', ready: true, enabled: true },
  { id: 'deepseek', label: 'DeepSeek', type: 'deepseek', ready: true, enabled: true },
  { id: 'qwen', label: '千问语音（待接入）', type: 'qwen', ready: false, enabled: false },
  { id: 'local', label: '老机器语音（待接入）', type: 'local', ready: false, enabled: false },
  { id: 'rest', label: '另一网站语音（待接入）', type: 'rest', ready: false, enabled: false },
  { id: 'new', label: '＋ 添加供应商', type: '', ready: false, enabled: false }
];
var TTS_UI: any = { providers: null, raw: null, loading: false, draft: null };
function ttsProviderList(){ return TTS_UI.providers || TTS_PROVIDER_PLACEHOLDER }
function ttsProviderInfo(pid?){
  var hit = ttsProviderList().filter(function(p){ return p.id === pid })[0];
  return hit || { id: pid, label: pid, type: '', ready: false, enabled: false };
}
function ttsDefaultProviderName(){
  var list = ttsProviderList();
  var hit = list.filter(function(p){ return p.enabled !== false && p.ready })[0] || list[0];
  return hit ? hit.label : '火山引擎';
}
function ttsTypeLabel(t?){
  if (t === 'volcano') return '火山引擎';
  if (t === 'deepseek') return 'DeepSeek 语音';
  if (t === 'qwen') return '千问语音（待接入）';
  if (t === 'local') return '老机器语音（待接入）';
  if (t === 'rest') return '另一网站语音（待接入）';
  return String(t || '');
}
/* task349：TTS 一级导航首项=朗读设置（原「语音对话」页并入 TTS——主人「语音结合到 TTS 里面去」），
   其后为供应商动态列表；点击 TTS 一级默认落到首项。 */
function ttsBuildNavChildren(list?){
  var out = [{ id: 'tts', label: '朗读与播报' }];
  out = out.concat((list || []).map(function(p){ return { id: 'tts-p-' + p.id, label: p.label } }));
  out.push({ id: 'tts-p-new', label: '＋ 添加供应商' });
  return out;
}
function ttsApplyNav(list?){
  TTS_UI.providers = list;
  var children = ttsBuildNavChildren(list);
  SETTINGS_NAV.forEach(function(n){ if (n.id === 'tts') n.children = children });
  if (SETTINGS.view.indexOf('tts-p-') === 0 && !children.some(function(c){ return c.id === SETTINGS.view })) SETTINGS.view = children[0].id;
}
function loadTtsProviders(cb?){
  if (TTS_UI.loading) return;
  TTS_UI.loading = true;
  fetch('/_tts/providers').then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(function(d){
      TTS_UI.loading = false;
      if (!d || !d.ok || !Array.isArray(d.providers)){
        TTS_UI.raw = null; TTS_UI.providers = null;
        if (cb) cb();
        return;
      }
      var list = d.providers.map(function(p){
        var type = String(p.type || '');
        /* task349：deepseek 已接入（task308 后端）——task308 漏改本判定，导致截图「DeepSeek（待接入）」误导 + 语音对话下拉不含 DS */
        var okType = (type === 'volcano' || type === 'deepseek');
        return {
          id: String(p.id || ''),
          label: String(p.name || p.id || '') + (okType ? '' : '（待接入）'),
          type: type,
          ready: okType,
          enabled: p.enabled !== false
        };
      }).filter(function(p){ return !!p.id });
      TTS_UI.raw = d.providers;
      ttsApplyNav(list);
      if ($('#settingsWrap') && $('#overlay').classList.contains('open')) renderSettings();
      if (cb) cb();
    })
    .catch(function(){ TTS_UI.loading = false; TTS_UI.raw = null; TTS_UI.providers = null; if (cb) cb() });
}
function ttsKeyHint(masked?){
  var s = String(masked || '');
  if (!s) return '未设置（留空即不配置）';
  var tail = /^\*{4}/.test(s) ? s.slice(4) : '';
  return tail ? ('已保存 · 尾号 ' + tail + '，留空不改') : '已保存（留空不改）';
}
function ttsCollectVoices(){
  var arr = TTS_UI.draft || [];
  var seen = {};
  var out = [];
  var defCount = 0;
  for (var i = 0; i < arr.length; i++){
    var v = arr[i] || {};
    var id = String(v.id == null ? '' : v.id).trim();
    if (!id) return { error: '音色 ID 不能为空' };
    if (/[\u0000-\u001f\u007f]/.test(id)) return { error: '音色 ID 不能包含控制字符' };
    if (seen[id]) return { error: '音色 ID 重复：' + id };
    seen[id] = true;
    var note = String(v.note == null ? '' : v.note).trim();
    if (/[\u0000-\u001f\u007f]/.test(note)) return { error: '音色备注不能包含控制字符' };
    if (Array.from(note).length > 20) return { error: '音色备注最多 20 个字' };
    if (v.default) defCount++;
    out.push({ id: id, note: note, default: !!v.default });
  }
  if (defCount > 1) return { error: '每家供应商最多一个默认音色' };
  return { value: out };
}
function drawTtsVoiceTable(){
  var box = $('#ttsVoiceTable'); if (!box) return;
  box.replaceChildren();
  var draft = TTS_UI.draft || [];
  if (!draft.length){
    box.appendChild(el('div', 'vempty', '还没有音色，点下面「＋ 添加音色」'));
    return;
  }
  draft.forEach(function(v, idx){
    var item = el('div', 'vitem');
    var row = el('div', 'vrow');
    var meta = el('div', 'vmeta');
    var idInp = document.createElement('input');
    idInp.value = String(v.id || '');
    idInp.placeholder = '音色 ID';
    if (v.existing) idInp.readOnly = true;
    idInp.oninput = function(){ v.id = idInp.value };
    var noteInp = document.createElement('input');
    noteInp.value = String(v.note || '');
    noteInp.placeholder = '备注（最多 20 字，留空显示 ID）';
    noteInp.maxLength = 20;
    noteInp.oninput = function(){ v.note = noteInp.value };
    meta.appendChild(idInp); meta.appendChild(noteInp);
    row.appendChild(meta);
    var defWrap = el('div', 'dscard-row');
    var radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'ttsDefaultVoice'; radio.className = 'vcheck';
    radio.checked = !!v.default;
    radio.onchange = function(){
      if (!radio.checked) return;
      draft.forEach(function(x){ x.default = (x === v) });
      drawTtsVoiceTable();
    };
    defWrap.appendChild(radio);
    defWrap.appendChild(el('span', null, '默认'));
    row.appendChild(defWrap);
    var del = el('button', 'vrename', '删');
    del.title = '移除这一行（保存前不落盘）';
    del.onclick = function(){ draft.splice(idx, 1); drawTtsVoiceTable() };
    row.appendChild(del);
    item.appendChild(row);
    box.appendChild(item);
  });
}
function renderTtsVoiceTable(body?, p?, pid?){
  TTS_UI.draft = (p && Array.isArray(p.voices) ? p.voices : []).map(function(v){
    return { id: String(v.id || ''), note: String(v.note || ''), default: v.default === true, existing: true };
  });
  var wrap = el('div');
  wrap.id = 'ttsVoiceWrap';
  wrap.appendChild(el('div', 'settings-sub', '音色表（随下方「保存」整表提交；既有音色 ID 不可改，新增行可填）'));
  var box = el('div', 'dscard');
  box.id = 'ttsVoiceTable';
  wrap.appendChild(box);
  var ops = el('div', 'test-row');
  var add = el('button', 'test-btn', '＋ 添加音色');
  add.onclick = function(){
    TTS_UI.draft.push({ id: '', note: '', default: false, existing: false });
    drawTtsVoiceTable();
  };
  ops.appendChild(add);
  if (pid){
    var pv = el('button', 'test-btn', '▶ 试听默认音色');
    pv.onclick = function(){ ttsProviderPreview(pv, pid) };
    ops.appendChild(pv);
  }
  wrap.appendChild(ops);
  body.appendChild(wrap);
  drawTtsVoiceTable();
}
function ttsProviderPreview(btn?, pid?){
  if (!pid){ toast('请先保存供应商再试听', true); return }
  var draft = TTS_UI.draft || [];
  var def = draft.filter(function(v){ return v.default })[0] || draft[0];
  var id = def ? String(def.id || '').trim() : '';
  if (!id){ toast('还没有可用音色，请先添加音色', true); return }
  var old = btn.textContent;
  btn.disabled = true; btn.textContent = '合成中…';
  fetch('/_voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '主人你好，这是你选的音色。', voice: id, providerId: pid }) })
    .then(function(r){
      if (!r.ok) return r.json().catch(function(){ return null }).then(function(j){ throw new Error((j && j.error) || ('HTTP ' + r.status)) });
      return r.blob();
    })
    .then(function(blob){ btn.disabled = false; btn.textContent = old; playVoiceAudio(blob, null, 1) })
    .catch(function(e){ btn.disabled = false; btn.textContent = old; toast('试听失败：' + ((e && e.message) || e), true) });
}
function ttsProviderSave(pid?, p?){
  var nameEl = $('#mTtsName'), typeEl = $('#mTtsType'), keyEl = $('#mTtsKey'), epEl = $('#mTtsEndpoint'), ordEl = $('#mTtsOrder'), enEl = $('#mTtsEnabled');
  if (!nameEl) return;
  var name = String(nameEl.value || '').trim();
  if (!name){ toast('供应商名称不能为空', true); return }
  var type = typeEl ? String(typeEl.value || '') : ((p && p.type) || 'volcano');
  var body: any = { name: name, endpoint: String(epEl ? epEl.value : '').trim(), enabled: !!(enEl && enEl.checked) };
  if (ordEl && String(ordEl.value).trim() !== ''){
    var n = Number(ordEl.value);
    if (!Number.isInteger(n) || n < 0 || n > 9999){ toast('排序值必须是 0-9999 的整数', true); return }
    body.order = n;
  }
  if (keyEl && String(keyEl.value || '') !== '') body.apiKey = String(keyEl.value);
  if (!pid) body.type = type;
  var isVolcano = pid ? !!(p && p.type === 'volcano') : (type === 'volcano');
  if (isVolcano){
    var vc = ttsCollectVoices();
    if (vc.error){ toast(vc.error, true); return }
    body.voices = vc.value;
  }
  if (pid) body.id = pid;
  fetch('/_tts/providers', { method: pid ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r){
      return r.json().catch(function(){ return null }).then(function(j){
        if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    })
    .then(function(j){
      toast('已保存');
      if (!pid && j.provider && j.provider.id) SETTINGS.view = 'tts-p-' + j.provider.id;
      loadTtsProviders(function(){ if (SETTINGS.view.indexOf('tts-p-') === 0) renderSettings() });
    })
    .catch(function(e){ toast('保存失败：' + ((e && e.message) || e), true) });
}
function ttsProviderDelete(p?){
  if (!p) return;
  if (!confirm('删除「' + (p.name || p.id) + '」？只删本机配置，不影响供应商账号。')) return;
  fetch('/_tts/providers?id=' + encodeURIComponent(p.id), { method: 'DELETE' })
    .then(function(r){
      return r.json().catch(function(){ return null }).then(function(j){
        if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    })
    .then(function(){ toast('已删除'); loadTtsProviders(function(){ renderSettings() }) })
    .catch(function(e){ toast('删除失败：' + ((e && e.message) || e), true) });
}
function renderTtsProviderForm(body?, p?){
  body.appendChild(el('p', 'desc', '供应商配置保存在本机 config/tts-providers.json（600 权限、不入 git）；API Key 只提交一次、页面永不回填。'));
  var card = el('div', 'dscard');
  var rName = el('div', 'dscard-row');
  rName.appendChild(el('span', 'dlab', '名称'));
  var nameInp = document.createElement('input');
  nameInp.id = 'mTtsName'; nameInp.maxLength = 20; nameInp.placeholder = '供应商名称（最多 20 字）'; nameInp.autocomplete = 'off';
  nameInp.value = p ? String(p.name || '') : '';
  rName.appendChild(nameInp);
  card.appendChild(rName);
  var rType = el('div', 'dscard-row');
  rType.appendChild(el('span', 'dlab', '类型'));
  var typeSel = document.createElement('select');
  typeSel.id = 'mTtsType';
  [['volcano', '火山引擎'], ['deepseek', 'DeepSeek 语音'], ['qwen', '千问语音（待接入）'], ['local', '老机器语音（待接入）'], ['rest', '另一网站语音（待接入）']].forEach(function(pair){
    var o = document.createElement('option');
    o.value = pair[0]; o.textContent = pair[1];
    typeSel.appendChild(o);
  });
  typeSel.value = p ? String(p.type || 'volcano') : 'volcano';
  if (p) typeSel.disabled = true;
  rType.appendChild(typeSel);
  card.appendChild(rType);
  if (p) card.appendChild(el('div', 'settings-sub', '类型不可改，需切换请新建供应商。'));
  var rKey = el('div', 'dscard-row');
  rKey.appendChild(el('span', 'dlab', 'API Key'));
  var keyInp = document.createElement('input');
  keyInp.id = 'mTtsKey'; keyInp.type = 'password'; keyInp.autocomplete = 'new-password';
  keyInp.placeholder = ttsKeyHint(p && p.apiKey);
  rKey.appendChild(keyInp);
  card.appendChild(rKey);
  var rEp = el('div', 'dscard-row');
  rEp.appendChild(el('span', 'dlab', 'API 地址'));
  var epInp = document.createElement('input');
  epInp.id = 'mTtsEndpoint'; epInp.autocomplete = 'off';
  epInp.placeholder = '留空=供应商默认域名；仅支持 http(s)';
  epInp.value = p ? String(p.endpoint || '') : '';
  rEp.appendChild(epInp);
  card.appendChild(rEp);
  var rOrd = el('div', 'dscard-row');
  rOrd.appendChild(el('span', 'dlab', '排序'));
  var ordInp = document.createElement('input');
  ordInp.id = 'mTtsOrder'; ordInp.type = 'number'; ordInp.min = '0'; ordInp.max = '9999'; ordInp.step = '1';
  ordInp.placeholder = '0-9999，越小越靠前';
  ordInp.value = p ? String(p.order == null ? '' : p.order) : '';
  rOrd.appendChild(ordInp);
  card.appendChild(rOrd);
  var rEn = el('div', 'dscard-row');
  rEn.appendChild(el('span', 'dlab', '启用'));
  var en = document.createElement('input');
  en.type = 'checkbox'; en.id = 'mTtsEnabled'; en.className = 'vcheck';
  en.checked = p ? (p.enabled !== false) : true;
  rEn.appendChild(en);
  rEn.appendChild(el('span', null, '启用后可被语音对话使用'));
  card.appendChild(rEn);
  body.appendChild(card);
  if (!p){
    /* task308：DeepSeek 语音说明行（选 deepseek 才显示）+ 音色表对 deepseek 开放（stella/tide 可编辑） */
    var dsHint = el('div', 'settings-sub', 'DeepSeek 语音：Key 留空=跟随「设置 → API Key」的 DeepSeek Key；音色 stella（女）/tide（男）；3 元/万字（限时 5 折 1.5）；输出 wav。');
    dsHint.style.display = 'none'; dsHint.id = 'mTtsDsHint';
    card.appendChild(dsHint);
    typeSel.onchange = function(){
      var w = $('#ttsVoiceWrap'); if (w) w.style.display = (typeSel.value === 'volcano' || typeSel.value === 'deepseek') ? '' : 'none';
      var h = $('#mTtsDsHint'); if (h) h.style.display = typeSel.value === 'deepseek' ? '' : 'none';
    };
  }
  var ops = el('div', 'test-row');
  var save = el('button', 'test-btn', '保存');
  save.onclick = function(){ ttsProviderSave(p ? String(p.id) : '', p) };
  ops.appendChild(save);
  if (p){
    var del = el('button', 'test-btn', '删除该供应商');
    del.onclick = function(){ ttsProviderDelete(p) };
    ops.appendChild(del);
  }
  body.appendChild(ops);
}
function renderTtsProviderPage(body?, pid?){
  if (pid === 'new'){
    body.appendChild(el('h4', null, '添加供应商'));
    renderTtsProviderForm(body, null);
    renderTtsVoiceTable(body, null, '');
    var sbNew = $('#modalSave'); if (sbNew) sbNew.style.display = 'none';
    return;
  }
  var raw = TTS_UI.raw;
  var p = null;
  if (raw && raw.length) p = raw.filter(function(x){ return x && x.id === pid })[0] || null;
  if (p){
    body.appendChild(el('h4', null, String(p.name || pid)));
    if (p.type !== 'volcano'){
      body.appendChild(el('p', 'desc', '该供应商类型尚未接入本机：本期只登记了火山引擎 adapter，此处仅保留结构槽位，暂不可合成、暂不可编辑（接入需先补协议文档与可测凭据，另立单）。'));
      var rc = el('div', 'dscard');
      [['名称', String(p.name || '')], ['类型', ttsTypeLabel(p.type)], ['排序', String(p.order == null ? '' : p.order)]].forEach(function(pair){
        var rr = el('div', 'dscard-row');
        rr.appendChild(el('span', 'dlab', pair[0]));
        rr.appendChild(el('span', null, pair[1]));
        rc.appendChild(rr);
      });
      body.appendChild(rc);
      var delSlot = el('button', 'test-btn', '删除该供应商');
      delSlot.onclick = function(){ ttsProviderDelete(p) };
      body.appendChild(delSlot);
      var sbSlot = $('#modalSave'); if (sbSlot) sbSlot.style.display = 'none';
      return;
    }
    renderTtsProviderForm(body, p);
    renderTtsVoiceTable(body, p, pid);
    var sbEdit = $('#modalSave'); if (sbEdit) sbEdit.style.display = 'none';
    return;
  }
  /* 接口不可用 / 该 id 不在供应商表：回落 S2a 静态占位行为，不白屏 */
  var info = ttsProviderInfo(pid);
  body.appendChild(el('h4', null, info.label));
  if (!info.ready){
    body.appendChild(el('p', 'desc', '该供应商类型尚未接入本机：本期只登记了火山引擎 adapter，此处仅保留结构槽位，暂不可合成、暂不可编辑（接入需先补协议文档与可测凭据，另立单）。'));
    var sbn = $('#modalSave'); if (sbn) sbn.style.display = 'none';
    return;
  }
  body.appendChild(el('p', 'desc', '音色清单来自 voice.json（旧 /_voice/voices 路径），备注名只改显示、不改音色本身；供应商接口未就绪时暂不可增删改，恢复后自动切换为可编辑表单。'));
  VOICE_UI.gen++; var gen = VOICE_UI.gen;
  var list = el('div', 'vlist');
  list.appendChild(el('div', 'vempty', '加载中…'));
  body.appendChild(list);
  loadVoiceList(gen, list);
  var sb = $('#modalSave'); if (sb) sb.style.display = 'none';
}
/* 语音对话设置（task55 重构）：朗读音色卡片（默认供应商 + 复刻音色行 + 行内改备注名）+ 整行试听 + 自动朗读开关；
   音色清单来自 /_voice/voices（proxy 读 voice.json，备注名覆盖层在 config/voice-names.json，本页只改显示不改音色本身） */
/* task68 S2b-C：providerId 为当前供应商 id（空串 ⇒ 旧 /_voice/voices + 不带 providerId 的兼容路径） */
var VOICE_UI: any = { gen: 0, voices: [], cur: '', editId: '', closeEdit: null, providerId: '' };

function voiceShownName(v?){ return v.name || v.label || v.id }
function voiceSubName(v?){ return (v.name && v.label && v.name !== v.label) ? (v.label + ' · ' + v.id) : (v.label || v.id) }

function loadVoiceList(gen?, list?){
  fetch('/_voice/voices').then(function(r){ return r.json() }).then(function(d){
    if (gen !== VOICE_UI.gen) return;
    list.replaceChildren();
    if (!d || !d.ok || !d.voices || !d.voices.length){
      list.appendChild(el('div', 'vempty', '音色清单为空：请确认 voice.json 已配置音色并重启 proxy'));
      return;
    }
    VOICE_UI.voices = d.voices;
    var saved = getVoiceChatVoice();
    VOICE_UI.cur = d.voices.some(function(v){ return v.id === saved }) ? saved : d.voices[0].id;
    renderVoiceRows(gen, list);
  }).catch(function(){
    if (gen !== VOICE_UI.gen) return;
    list.replaceChildren();
    list.appendChild(el('div', 'vempty', '音色清单加载失败：请确认 voice.json 已配置并重启 proxy'));
  });
}

function renderVoiceRows(gen?, list?){
  list.replaceChildren();
  VOICE_UI.voices.forEach(function(v){
    var item = el('div', 'vitem');
    var row = el('div', 'vrow' + (v.id === VOICE_UI.cur ? ' sel' : ''));
    row.setAttribute('data-vid', v.id);
    row.appendChild(el('span', 'vpick'));
    var meta = el('div', 'vmeta');
    var nm = el('div', 'vname', voiceShownName(v));
    var sub = el('div', 'vorig', voiceSubName(v));
    meta.appendChild(nm); meta.appendChild(sub);
    row.appendChild(meta);
    var rename = el('button', 'vrename', '改名');
    row.appendChild(rename);

    var edit = el('div', 'vedit');
    edit.hidden = true;
    var inp = document.createElement('input');
    inp.className = 'vname-input'; inp.maxLength = 20; inp.autocomplete = 'off';
    inp.placeholder = v.label || v.id;
    var lab = el('label', 'vlab', '备注名（留空保存 = 恢复原音色名）');
    var ok = el('button', 'vok', '保存'), cancel = el('button', 'vcancel', '取消'), ops = el('div', 'vedit-ops');
    ops.appendChild(ok); ops.appendChild(cancel);
    edit.appendChild(lab); edit.appendChild(inp); edit.appendChild(ops);
    item.appendChild(row); item.appendChild(edit); list.appendChild(item);

    function closeEdit(){ edit.hidden = true; VOICE_UI.editId = ''; VOICE_UI.closeEdit = null }
    function openEdit(){
      if (VOICE_UI.closeEdit) VOICE_UI.closeEdit();
      inp.value = (v.name !== v.label) ? v.name : '';
      edit.hidden = false;
      ok.disabled = false; cancel.disabled = false;
      VOICE_UI.editId = v.id; VOICE_UI.closeEdit = closeEdit;
      inp.focus(); inp.select();
    }
    function commit(){
      if (ok.disabled) return;
      var val = inp.value.trim();
      ok.disabled = true; cancel.disabled = true;
      fetch('/_voice/voices', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: v.id, name: val }) })
        .then(function(r){
          return r.json().catch(function(){ return null }).then(function(j){
            if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || ('HTTP ' + r.status));
            return j;
          });
        })
        .then(function(j){
          if (gen !== VOICE_UI.gen) return;
          var nv = (j.voices || []).filter(function(x){ return x.id === v.id })[0];
          if (nv){ v.name = nv.name; v.label = nv.label }
          nm.textContent = voiceShownName(v); sub.textContent = voiceSubName(v);
          inp.value = (v.name !== v.label) ? v.name : '';
          closeEdit(); toast(val ? '备注名已保存' : '已恢复原音色名');
        })
        .catch(function(e){
          if (gen !== VOICE_UI.gen) return;
          ok.disabled = false; cancel.disabled = false;
          toast('保存失败：' + ((e && e.message) || e), true);
        });
    }
    row.onclick = function(){
      if (VOICE_UI.closeEdit) VOICE_UI.closeEdit();
      VOICE_UI.cur = v.id;
      try { localStorage.setItem('littledj.voiceChatVoice', v.id) } catch(e){}
      Array.prototype.forEach.call(list.querySelectorAll('.vrow'), function(n){ n.classList.toggle('sel', n.getAttribute('data-vid') === v.id) });
    };
    rename.onclick = function(ev){ ev.stopPropagation(); openEdit() };
    ok.onclick = function(ev){ ev.stopPropagation(); commit() };
    cancel.onclick = function(ev){ ev.stopPropagation(); closeEdit() };
    inp.onkeydown = function(ev){
      if (ev.key === 'Enter'){ if (ev.isComposing || ev.keyCode === 229) return; ev.preventDefault(); commit() }
      else if (ev.key === 'Escape'){ ev.preventDefault(); closeEdit() }
    };
  });
}

/* task68 S2b-C：按供应商渲染音色卡（数据源 = /_tts/providers 的 raw.voices，形状 {id,note,default}）。
   行内不提供「改名」（备注归 TTS → 供应商页维护）；点击行 = 写当前音色键 + 切 .sel。 */
function renderProviderVoiceRows(gen?, list?, p?){
  list.replaceChildren();
  var raw = null;
  (TTS_UI.raw || []).forEach(function(x){ if (x && String(x.id) === String((p && p.id) || '')) raw = x });
  var voices = (raw && Array.isArray(raw.voices)) ? raw.voices : ((p && Array.isArray(p.voices)) ? p.voices : []);
  VOICE_UI.closeEdit = null; VOICE_UI.editId = '';
  if (!voices.length){
    VOICE_UI.voices = []; VOICE_UI.cur = '';
    list.appendChild(el('div', 'vempty', '该供应商还没有音色，请到 TTS → 对应供应商添加'));
    return;
  }
  var saved = getVoiceChatVoice();
  var def = voices.filter(function(v){ return v.default })[0] || voices[0] || {};
  var cur = voices.some(function(v){ return v.id === saved }) ? saved : String(def.id || '');
  VOICE_UI.voices = voices.map(function(v){ return { id: String(v.id || ''), name: '', label: String(v.note || '') } });
  VOICE_UI.cur = cur;
  list.replaceChildren();
  voices.forEach(function(v){
    var vid = String(v.id || '');
    var note = String(v.note || '');
    var item = el('div', 'vitem');
    var row = el('div', 'vrow' + (vid === cur ? ' sel' : ''));
    row.setAttribute('data-vid', vid);
    row.appendChild(el('span', 'vpick'));
    var meta = el('div', 'vmeta');
    meta.appendChild(el('div', 'vname', note || vid));
    meta.appendChild(el('div', 'vorig', '音色 ID · ' + vid));
    row.appendChild(meta);
    row.onclick = function(){
      VOICE_UI.cur = vid;
      try { localStorage.setItem('littledj.voiceChatVoice', vid) } catch(e){}
      Array.prototype.forEach.call(list.querySelectorAll('.vrow'), function(n){ n.classList.toggle('sel', n.getAttribute('data-vid') === vid) });
    };
    item.appendChild(row); list.appendChild(item);
  });
}

function voicePreview(btn?){
  if (btn.disabled) return;
  if (VOICE_UI.closeEdit) VOICE_UI.closeEdit();
  var id = VOICE_UI.cur || (VOICE_UI.voices[0] && VOICE_UI.voices[0].id) || '';
  if (!id){ toast('还没有可用音色，请先在 voice.json 配置', true); return }
  var gen = VOICE_UI.gen;
  btn.disabled = true; btn.textContent = '合成中…';
  /* task68 S2b-C：带当前供应商 providerId；旧后端（路由不认该字段会 404）⇒ 去 providerId 重试一次 */
  var send = function(withPid){
    var body: any = { text: '主人你好，这是你选的音色。', voice: id };
    if (withPid && VOICE_UI.providerId) body.providerId = VOICE_UI.providerId;
    return fetch('/_voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  };
  send(true)
    .then(function(r){
      if (r.status === 404 && VOICE_UI.providerId) return send(false);
      return r;
    })
    .then(function(r){
      if (r.status === 404) throw new Error('语音接口还没生效：在终端跑 sh deploy/restart-proxy.sh 重启');
      if (!r.ok) return r.json().catch(function(){ return null }).then(function(j){ throw new Error((j && j.error) || ('HTTP ' + r.status)) });
      return r.blob();
    })
    .then(function(blob){
      if (gen !== VOICE_UI.gen) return;
      btn.disabled = false; btn.textContent = '▶ 试听';
      playVoiceAudio(blob);
    })
    .catch(function(e){
      if (gen !== VOICE_UI.gen) return;
      btn.disabled = false; btn.textContent = '▶ 试听';
      toast('试听失败：' + ((e && e.message) || e), true);
    });
}

function renderVoicePage(body?){
  VOICE_UI.gen++; var gen = VOICE_UI.gen; VOICE_UI.closeEdit = null; VOICE_UI.editId = '';
  body.appendChild(el('h4', null, '语音对话'));
  body.appendChild(el('p', 'desc', '点输入区 🎙 开始说话、再点一次结束，小DJ 自动发送并朗读回复。你说的话会上传火山引擎做语音识别、回复文本会上传做语音合成；电脑需用 localhost 或 https 打开才能开麦，手机等外网 https 开通后可用；语音识别需火山控制台已开通 ASR 资源。'));

  var g1 = el('div', 'vgroup');
  g1.appendChild(el('div', 'vgroup-h', '朗读音色'));
  var card1 = el('div', 'dscard');
  var prow = el('div', 'dscard-row');
  /* task68 S2b-C：当前供应商下拉（数据源 /_tts/providers = TTS_UI.providers，只列启用且已接入的供应商）。
     选择只写非凭据偏好 littledj.ttsProvider；providerId 为空串 ⇒ 保持 S2a 静态胶囊 + 旧 /_voice/voices 视图。
     接口未就绪 / 全部停用 ⇒ 不出下拉，显式标注「供应商下拉待接入」，不伪造可用状态。 */
  var provs = (TTS_UI.providers || []).filter(function(p){ return p && p.enabled !== false && p.ready });
  var savedPid = ''; try { savedPid = String(localStorage.getItem('littledj.ttsProvider') || '') } catch(e){}
  var curPid = provs.some(function(p){ return p.id === savedPid }) ? savedPid : ((provs[0] && provs[0].id) || '');
  VOICE_UI.providerId = curPid;
  var psel = null;
  if (provs.length){
    prow.appendChild(el('span', 'dlab', '当前供应商'));
    psel = document.createElement('select');
    psel.id = 'mVoiceProvider'; psel.title = '当前供应商';
    provs.forEach(function(p){
      var o = document.createElement('option');
      o.value = p.id; o.textContent = p.label;
      if (p.id === curPid) o.selected = true;
      psel.appendChild(o);
    });
    prow.appendChild(psel);
  } else {
    prow.appendChild(el('span', 'settings-tab active vtab-static', ttsDefaultProviderName()));
    prow.appendChild(el('span', 'vtab-static', '供应商下拉待接入'));
  }
  card1.appendChild(prow);
  var vdesc = el('p', 'desc', ''), pdesc = el('p', 'desc', '');
  card1.appendChild(vdesc);
  var list = el('div', 'vlist');
  list.appendChild(el('div', 'vempty', '加载中…'));
  card1.appendChild(list);
  card1.appendChild(pdesc);
  var curProvider = function(){ return provs.filter(function(x){ return x.id === VOICE_UI.providerId })[0] || null };
  var drawVoiceDesc = function(){
    var p = curProvider();
    vdesc.textContent = p
      ? ('音色清单来自当前供应商「' + p.label + '」，在 TTS → 对应供应商维护；备注名只改显示、不改音色本身。')
      : '声音复刻音色：清单来自 voice.json，备注名只改显示、不改音色本身。';
    pdesc.textContent = p
      ? ('试听会把示例文本上传「' + p.label + '」合成，仅用于确认音色。')
      : '试听会把示例文本上传火山引擎合成，仅用于确认音色。';
  };
  var drawVoiceList = function(){
    VOICE_UI.closeEdit = null; VOICE_UI.editId = '';
    var p = curProvider();
    if (p) renderProviderVoiceRows(gen, list, p);
    else loadVoiceList(gen, list);
  };
  drawVoiceDesc(); drawVoiceList();
  var prevBtn = el('button', 'vprev-btn', '▶ 试听');
  prevBtn.onclick = function(){ voicePreview(prevBtn) };
  if (psel) psel.onchange = function(){
    var v = String(psel.value || '');
    try { localStorage.setItem('littledj.ttsProvider', v) } catch(e){}
    VOICE_UI.providerId = v;
    /* gen++ 作废旧供应商的在途异步回调；只重画音色卡列表，不整页重渲染 */
    VOICE_UI.gen++; gen = VOICE_UI.gen;
    if (prevBtn.disabled){ prevBtn.disabled = false; prevBtn.textContent = '▶ 试听' }   /* 在途试听被作废 ⇒ 复位按钮，防卡在「合成中…」 */
    drawVoiceDesc(); drawVoiceList();
  };
  card1.appendChild(prevBtn);
  g1.appendChild(card1);
  body.appendChild(g1);

  var g2 = el('div', 'vgroup');
  g2.appendChild(el('div', 'vgroup-h', '自动朗读'));
  var card2 = el('div', 'dscard');
  var row2 = el('div', 'dscard-row');
  var readLab = el('label', 'vread-lab', '语音发送后自动朗读小DJ的回复（关闭后只转文字发送，不朗读）');
  readLab.setAttribute('for', 'mVoiceRead');
  var cb = document.createElement('input');
  cb.type = 'checkbox'; cb.id = 'mVoiceRead'; cb.className = 'vcheck'; cb.checked = voiceReadEnabled();
  cb.onchange = function(){ try { localStorage.setItem('littledj.voiceChatRead', cb.checked ? '1' : '0') } catch(e){} };
  row2.appendChild(readLab); row2.appendChild(cb);
  card2.appendChild(row2);
  g2.appendChild(card2);
  body.appendChild(g2);

  /* task347：消息播报——每条 AI 回复下 🔊 按钮的音色选择（DeepSeek TTS：stella 女 / tide 男，默认女声=主人拍板） */
  var g3 = el('div', 'vgroup');
  g3.appendChild(el('div', 'vgroup-h', '消息播报（🔊 按钮）'));
  var card3 = el('div', 'dscard');
  card3.appendChild(el('p', 'desc', '每条 AI 回复下方的 🔊 按钮用这里选的音色朗读整条回复（走 DeepSeek TTS）；点击开始、再点一次停止；长回复会自动分段连读。'));
  var row3 = el('div', 'dscard-row');
  row3.appendChild(el('span', 'dlab', '播报音色'));
  var ssel = document.createElement('select');
  ssel.id = 'mMsgSpeakVoice'; ssel.title = '消息播报音色（默认女声）';
  [['female', '女声 · Stella（默认）'], ['male', '男声 · Tide']].forEach(function(pair){
    var o = document.createElement('option');
    o.value = pair[0]; o.textContent = pair[1];
    ssel.appendChild(o);
  });
  var savedG = 'female'; try { savedG = localStorage.getItem('littledj.msgSpeakVoice') === 'male' ? 'male' : 'female' } catch(e){}
  ssel.value = savedG;
  ssel.onchange = function(){
    try { localStorage.setItem('littledj.msgSpeakVoice', ssel.value) } catch(e){}
    if (typeof msgSpeakStop === 'function') msgSpeakStop(); /* 换音色时停掉在途播报，下次点击用新音色 */
  };
  row3.appendChild(ssel);
  card3.appendChild(row3);
  var prev3 = el('button', 'vprev-btn', '▶ 试听');
  prev3.onclick = function(){
    var voice = ssel.value === 'male' ? 'tide' : 'stella';
    var old3 = prev3.textContent;
    prev3.disabled = true; prev3.textContent = '合成中…';
    fetch('/_voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '主人你好，这是消息播报选中的音色。', voice: voice, providerId: 'deepseek' }) })
      .then(function(r){
        if (!r.ok) return r.json().catch(function(){ return null }).then(function(j){ throw new Error((j && j.error) || ('HTTP ' + r.status)) });
        return r.blob();
      })
      .then(function(blob){ prev3.disabled = false; prev3.textContent = old3; playVoiceAudio(blob, null, 1) })
      .catch(function(e){ prev3.disabled = false; prev3.textContent = old3; toast('试听失败：' + ((e && e.message) || e), true) });
  };
  card3.appendChild(prev3);
  g3.appendChild(card3);
  body.appendChild(g3);

  var sb = $('#modalSave'); if (sb) sb.disabled = true;
}

window.TTS_PROVIDER_PLACEHOLDER=TTS_PROVIDER_PLACEHOLDER; window.TTS_UI=TTS_UI; window.VOICE_UI=VOICE_UI; window.ttsProviderList=ttsProviderList; window.ttsProviderInfo=ttsProviderInfo; window.ttsDefaultProviderName=ttsDefaultProviderName; window.ttsTypeLabel=ttsTypeLabel; window.ttsBuildNavChildren=ttsBuildNavChildren; window.ttsApplyNav=ttsApplyNav; window.loadTtsProviders=loadTtsProviders; window.ttsKeyHint=ttsKeyHint; window.ttsCollectVoices=ttsCollectVoices; window.drawTtsVoiceTable=drawTtsVoiceTable; window.renderTtsVoiceTable=renderTtsVoiceTable; window.ttsProviderPreview=ttsProviderPreview; window.ttsProviderSave=ttsProviderSave; window.ttsProviderDelete=ttsProviderDelete; window.renderTtsProviderForm=renderTtsProviderForm; window.renderTtsProviderPage=renderTtsProviderPage; window.voiceShownName=voiceShownName; window.voiceSubName=voiceSubName; window.loadVoiceList=loadVoiceList; window.renderVoiceRows=renderVoiceRows; window.renderProviderVoiceRows=renderProviderVoiceRows; window.voicePreview=voicePreview; window.renderVoicePage=renderVoicePage;

/* @module guard @order 36 @职责 约束管理（世界观/三查） @提供 GUARD loadGuard saveGuardPrompt buildGuardEditor renderGuardPage activateNamedKey deleteNamedKey setDsTestResult testDeepseek settingsSave @依赖 - @依赖运行期 toast renderSettings SETTINGS autoNewEnabled S handoffEnabled ctxThreshold loadDsSettings skKvEl skKvDraftSet skKvList fetchBalance skKvBalance skKvSetState closeModal @DOM契约 - @严格模式 是 @全局占用 GUARD loadGuard saveGuardPrompt buildGuardEditor renderGuardPage activateNamedKey deleteNamedKey setDsTestResult testDeepseek settingsSave @源行 ui/index.html L10496-L10693 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 约束管理（世界观 / 开工三查） ---------- */
var GUARD: any = { data: null, loading: false };
function loadGuard(cb?){
  if (GUARD.loading) return;
  GUARD.loading = true;
  fetch('/_settings/prompts').then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
    .then(function(d){ GUARD.loading = false; GUARD.data = d; if (cb) cb(d) })
    .catch(function(e){ GUARD.loading = false; GUARD.data = { error: e.message }; if (cb) cb(GUARD.data) });
}
function saveGuardPrompt(which?, text?){
  if (!String(text || '').trim()){ toast('内容不能为空', true); return }
  fetch('/_settings/prompts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ which: which, text: text }) })
    .then(function(r){ if (!r.ok) return r.text().then(function(t){ throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120)) }); return r.json() })
    .then(function(d){
      toast((which === 'boot' ? '开工三查' : '世界观') + '已保存');
      // 不整页重渲染：保留另一份还没保存的草稿；只静默刷新留痕
      if (GUARD.data && GUARD.data.prompts && d && d.prompt) GUARD.data.prompts[which] = Object.assign({}, GUARD.data.prompts[which], d.prompt);
      fetch('/_settings/prompts').then(function(r){ return r.json() }).then(function(g){
        if (!GUARD.data) return;
        GUARD.data.log = g.log || [];
        GUARD.data.instructions = g.instructions || [];
      }).catch(function(){});
    })
    .catch(function(e){ toast('保存失败：' + e.message, true) });
}
function buildGuardEditor(which?, meta?){
  var wrap = el('div');
  var ta = document.createElement('textarea');
  ta.className = 'guard-area';
  ta.value = meta.text || '';
  var cnt = el('span', null, '');
  var upd = function(){ cnt.textContent = ta.value.length + ' 字 · 约 ' + Math.ceil(ta.value.length / 1.7) + ' tokens' };
  upd();
  ta.oninput = upd;
  var mrow = el('div', 'guard-meta');
  mrow.appendChild(el('span', 'gpath', String(meta.path || '').replace(/^.*\/config\//, 'config/')));
  mrow.appendChild(el('span', 'grow'));
  mrow.appendChild(cnt);
  var reset = el('button', 'guard-btn', '还原');
  reset.onclick = function(){ ta.value = meta.text || ''; upd() };
  var save = el('button', 'guard-btn primary', '保存');
  save.onclick = function(){ saveGuardPrompt(which, ta.value) };
  mrow.appendChild(reset); mrow.appendChild(save);
  wrap.appendChild(ta); wrap.appendChild(mrow);
  return wrap;
}
function renderGuardPage(body?){
  body.appendChild(el('h4', null, '约束管理'));
  body.appendChild(el('p', 'desc', '世界观每次请求自动注入；开工三查只在新建会话的首条消息注入一次。保存后写入本机 config/prompts/（600 权限、不入 git），并追加 changelog。注意：世界观内容保存后对新会话生效；deveco.jsonc 里的 instructions 路径变更需重启 serve 才生效（会中断当前会话，由主人决定时机）。'));
  if (!GUARD.data){
    body.appendChild(el('p', 'desc', '加载中…'));
    loadGuard(function(){ renderSettings() });
    return;
  }
  if (GUARD.data.error){
    body.appendChild(el('p', 'desc', '加载失败：' + GUARD.data.error));
    var retry = el('button', 'guard-btn', '重试');
    retry.onclick = function(){ GUARD.data = null; renderSettings() };
    body.appendChild(retry);
    return;
  }
  var p = GUARD.data.prompts || {};
  body.appendChild(el('div', 'settings-sub', '世界观（常驻，每轮注入）'));
  body.appendChild(buildGuardEditor('worldview', p.worldview || { text: '' }));
  body.appendChild(el('div', 'settings-sub', '开工三查（仅新会话首条）'));
  body.appendChild(buildGuardEditor('boot', p.boot || { text: '' }));
  body.appendChild(el('div', 'settings-sub', '主人画像'));
  var pb = el('button', 'guard-btn', '打开主人画像');
  pb.onclick = function(){ SETTINGS.view = 'profile'; renderSettings() }; /* task251：改设置内切页，不再独立弹窗 */
  var prow = el('div', 'guard-meta');
  prow.appendChild(pb);
  prow.appendChild(el('span', 'grow'));
  prow.appendChild(el('span', null, '称呼、风格、红线等由画像单独维护'));
  body.appendChild(prow);
  body.appendChild(el('div', 'settings-sub', '上下文纪律'));
  var disc = el('div', 'guard-meta');
  var cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = autoNewEnabled();
  cb.style.width = 'auto'; cb.style.margin = '0 6px 0 0';
  cb.onchange = function(){
    try { localStorage.setItem('littledj.autoNewCtx', cb.checked ? '1' : '0') } catch(e){}
    toast(cb.checked ? '已开启：红档后自动新开并交接' : '已关闭：红档后不再自动新开（仍可手动点横幅）');
  };
  var lab = el('label');
  lab.style.display = 'flex'; lab.style.alignItems = 'center'; lab.style.fontSize = '12px'; lab.style.color = 'var(--sub)';
  lab.appendChild(cb);
  lab.appendChild(document.createTextNode('红档后自动新开并交接（默认开启；有在途任务会等它们跑完）'));
  disc.appendChild(lab);
  disc.appendChild(el('span', 'grow'));
  disc.appendChild(el('span', null, '当前 ' + (S.ctxPct ? S.ctxPct.toFixed(1) : '0.0') + '%'));
  body.appendChild(disc);
  var disc2 = el('div', 'guard-meta');
  var cb2 = document.createElement('input');
  cb2.type = 'checkbox'; cb2.checked = handoffEnabled();
  cb2.style.width = 'auto'; cb2.style.margin = '0 6px 0 0';
  cb2.onchange = function(){
    try { localStorage.setItem('littledj.handoff', cb2.checked ? '1' : '0') } catch(e){}
    toast(cb2.checked ? '已开启：切换时带上一会话交接摘要' : '已关闭交接摘要');
  };
  var lab2 = el('label');
  lab2.style.display = 'flex'; lab2.style.alignItems = 'center'; lab2.style.fontSize = '12px'; lab2.style.color = 'var(--sub)';
  lab2.appendChild(cb2);
  lab2.appendChild(document.createTextNode('自动切换时带上一会话交接摘要（最近 12 条对话，本地拼接、不额外调用模型）'));
  disc2.appendChild(lab2);
  body.appendChild(disc2);
  var trow = el('div', 'guard-meta');
  trow.appendChild(el('span', null, '阈值'));
  var th = document.createElement('input');
  th.type = 'number'; th.min = '5'; th.max = '100'; th.step = '5';
  th.value = String(ctxThreshold());
  th.style.width = '72px'; th.style.margin = '0 6px';
  th.onchange = function(){
    var v = parseInt(th.value, 10);
    if (!(v >= 5 && v <= 100)) v = 20;
    th.value = String(v);
    try { localStorage.setItem('littledj.ctxThreshold', String(v)) } catch(e){}
    toast('阈值已设为 ' + v + '%');
  };
  trow.appendChild(th);
  trow.appendChild(el('span', null, '%（按模型真实窗口算，DeepSeek 约 1049K）'));
  body.appendChild(trow);
  body.appendChild(el('p', 'desc', '分级：绿 ≤15% / 黄 15–20% / 红 >20%（默认阈值下）；黄档下界 = max(10, 阈值−5)，随阈值联动。大管家主会话更严格：红档额外在消息区顶部常驻横幅。'));
  body.appendChild(el('p', 'desc', '只在当前任务跑完（session.idle）后触发，不打断在途任务；输入框有未发送内容时会推迟到下一次任务结束。普通会话不自动切；手动点红档横幅不受在途闸门限制。'));
  body.appendChild(el('div', 'settings-sub', '当前 instructions（只读）'));
  var ins = GUARD.data.instructions || [];
  body.appendChild(el('div', 'guard-log', ins.length ? ins.join('\n') : '（未读到 deveco.jsonc）'));
  body.appendChild(el('div', 'settings-sub', '最近保存'));
  var logs = GUARD.data.log || [];
  body.appendChild(el('div', 'guard-log', logs.length ? logs.join('\n') : '（暂无）'));
  var sb = $('#modalSave'); if (sb) sb.disabled = true;
}
function activateNamedKey(name?, scope?){
  fetch('/_settings/deepseek/active', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (!d.ok){ setDsTestResult('err', '✕ 切换失败：' + (d.error || '未知错误'), scope); return }
    loadDsSettings(function(){
      var ni = skKvEl(scope, 'kv-ds-name'); if (ni) ni.value = d.name;
      var ki = skKvEl(scope, 'kv-ds-key'); if (ki) ki.value = '';
      skKvDraftSet('ds', 'name', d.name); skKvDraftSet('ds', 'key', '');
      skKvList(scope, 'ds');
      setDsTestResult('waiting', '正在验证「' + d.name + '」…', scope);
      testDeepseek(d.key, scope);
      fetchBalance(function(){ skKvBalance(scope) });
    });
  }).catch(function(e){ setDsTestResult('err', '✕ 切换失败：' + e.message, scope) });
}
function deleteNamedKey(name?, scope?){
  if (!confirm('确定删除「' + name + '」这个 Key 吗？' + (SETTINGS.ds && SETTINGS.ds.active === name ? '\n它正在使用中，删除后将不再有可用 Key。' : ''))) return;
  fetch('/_settings/deepseek/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (d.error){ setDsTestResult('err', '✕ 删除失败：' + d.error, scope); return }
    var ni = skKvEl(scope, 'kv-ds-name'), ki = skKvEl(scope, 'kv-ds-key');
    var keepName = d.wasActive ? '' : (ni ? ni.value : '');
    var keepKey = d.wasActive ? '' : (ki ? ki.value : '');
    loadDsSettings(function(){
      if (ni) ni.value = keepName; if (ki) ki.value = keepKey;
      skKvDraftSet('ds', 'name', keepName); skKvDraftSet('ds', 'key', keepKey);
      skKvList(scope, 'ds');
      setDsTestResult('ok', '✓ 已删除「' + name + '」' + (d.wasActive ? '（当前已无可用 Key）' : ''), scope);
    });
  }).catch(function(e){ setDsTestResult('err', '✕ 删除失败：' + e.message, scope) });
}
function setDsTestResult(cls?, text?, scope?){
  skKvSetState(skKvEl(scope, 'kv-ds-result'), cls, text);
}
function testDeepseek(newKey?, scope?){
  if (SETTINGS.testing) return;
  SETTINGS.testing = true;
  var tb = skKvEl(scope, 'kv-ds-test'); if (tb){ tb.disabled = true; tb.textContent = '测试中…' }
  setDsTestResult('waiting', '正在连接官方 api.deepseek.com…', scope);
  var key = newKey || (function(){ var i = skKvEl(scope, 'kv-ds-key'); return i ? i.value.trim() : '' })();
  fetch('/_settings/deepseek/test', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(key ? { apiKey: key } : {})
  }).then(function(r){ return r.json() }).then(function(d){
    SETTINGS.testing = false;
    var tb2 = skKvEl(scope, 'kv-ds-test'); if (tb2){ tb2.disabled = false; tb2.textContent = '测试连接' }
    if (d.ok){
      var has = (d.models || []).indexOf('deepseek-flash') >= 0;
      setDsTestResult('ok', '✓ 测试成功' + (has ? '，deepseek-flash 可用' : ''), scope);
      fetchBalance(function(){ skKvBalance(scope) });
    } else {
      setDsTestResult('err', '✕ 测试失败：' + (d.error || '未知错误'), scope);
    }
  }).catch(function(e){
    SETTINGS.testing = false;
    var tb2 = skKvEl(scope, 'kv-ds-test'); if (tb2){ tb2.disabled = false; tb2.textContent = '测试连接' }
    setDsTestResult('err', '✕ 测试失败：' + e.message, scope);
  });
}
/* task214：设置弹窗保存链收口——API 子页退役后仅关闭（音效/TTS/语音/约束页各自即时保存或隐藏保存钮） */
function settingsSave(closeAfter?){
  closeModal();
}
window.GUARD=GUARD; window.loadGuard=loadGuard; window.saveGuardPrompt=saveGuardPrompt; window.buildGuardEditor=buildGuardEditor; window.renderGuardPage=renderGuardPage; window.activateNamedKey=activateNamedKey; window.deleteNamedKey=deleteNamedKey; window.setDsTestResult=setDsTestResult; window.testDeepseek=testDeepseek; window.settingsSave=settingsSave;

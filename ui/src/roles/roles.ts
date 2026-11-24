/* @module roles @order 33 @职责 角色页 @提供 ROLES ROLE_MODEL_RE loadRoles roleSrcItem roleModelReadonly renderRoles @依赖 - @依赖运行期 S labelModel navRestoreScroll visibleModelsForPick syncModelLabel refreshBillingViews toast loadModelsWithRetry rolePickModel @DOM契约 - @严格模式 是 @全局占用 ROLES ROLE_MODEL_RE loadRoles roleSrcItem roleModelReadonly renderRoles @源行 ui/index.html L9135-L9348 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 角色页（左上角入口：角色卡 + prompt 来源 + 模型写回） ---------- */
var ROLES: any = { data: null, sel: '', modelsTried: false, modelsLoading: false }; /* task250：modelsTried/modelsLoading=下拉模型列表加载缓存（task75 原版语义，openRoles 复位） */
var ROLE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/; /* task75 原版（task81 误删，task250 复活）：provider/model 校验 */
/* task251：openRoles 独立弹窗退役——角色页改设置内普通页（renderSettings 'roles' 分发 + loadRoles） */
function loadRoles(){
  fetch('/_roles').then(function(r){ return r.json() }).then(function(d){
    ROLES.data = d;
    if (!ROLES.sel && d.roles && d.roles.length) ROLES.sel = d.roles[0].name;
    renderRoles();
  }).catch(function(e){
    var w = $('#rolesWrap'); if (w) w.innerHTML = '<div class="emptyhint">角色加载失败：' + esc(e.message) + '</div>';
  });
}
function roleSrcItem(label?, path?, exists?, badge?){
  var box = el('div', 'role-item');
  var rn = el('div', 'rn');
  rn.appendChild(el('span', null, label));
  rn.appendChild(el('span', exists ? 'role-ok' : 'role-no', exists ? badge : '缺失'));
  box.appendChild(rn);
  box.appendChild(el('div', 'rp', path || '（无路径）'));
  return box;
}
/* ---------- 角色卡「当前模型」格式化（task81 S2 只读版退役，task250 恢复下拉写回；此函数降级为「未在列表」标注用） ---------- */
function roleModelReadonly(v?){
  var m = (S.models || []).filter(function(x){ return x.providerID + '/' + x.modelID === v })[0];
  return m ? labelModel(m) : v;
}
function renderRoles(){
  var wrap = $('#rolesWrap'); if (!wrap) return;
  var d = ROLES.data;
  if (!d || !d.roles || !d.roles.length){
    wrap.innerHTML = '<div class="emptyhint">没有找到角色卡。<br>检查 ~/.config/deveco/agent/ 或项目 .deveco/agent/。</div>';
    return;
  }
  /* task250（主人 2026-11-13 口述）：复制 task248 两改动——重渲前记导航滚动位置，渲染后恢复；滚动条隐藏见 .roles-nav CSS */
  var rlNavPrev = wrap.querySelector('.roles-nav');
  var rlNavScroll = rlNavPrev ? { l: rlNavPrev.scrollLeft, t: rlNavPrev.scrollTop } : { l: 0, t: 0 };
  wrap.replaceChildren();
  var nav = el('div', 'roles-nav');
  d.roles.forEach(function(r){
    var b = el('button', ROLES.sel === r.name ? 'active' : '');
    var dot = el('span', 'rdot');
    if (r.color) dot.style.background = r.color;
    b.appendChild(dot);
    b.appendChild(document.createTextNode(r.label || r.name)); /* task258：英文 id（censor-deepseek 等）不再上屏，六角色均有中文 label 兜底 name */
    b.onclick = function(){ ROLES.sel = r.name; renderRoles() };
    nav.appendChild(b);
  });
  wrap.appendChild(nav);
  navRestoreScroll(nav, rlNavScroll.l, rlNavScroll.t); /* task250：恢复滚动位置；仅 active 不在视野才微调 */
  var role = d.roles.filter(function(r){ return r.name === ROLES.sel })[0] || d.roles[0];
  var body = el('div', 'roles-body');
  body.appendChild(el('h4', null, role.label || role.name)); /* task258：标题同去英文 id */
  body.appendChild(el('div', 'roles-sub', (role.description || '（无描述）') + ' · mode=' + (role.mode || '-')));
  var f = el('div', 'role-field');
  f.appendChild(el('label', null, '当前模型'));
  var curModel = String(role.model || '').trim();
  if (role.name === 'butler'){
    /* task258（主人 2026-11-13 二次口述）：大管家下拉恢复，且与输入框**双向联通**——
       在此选择=改输入框当前模型（S.model + littledj.model 持久化，即时生效，不写角色卡）；
       输入框换了这里也跟着显示（selected 取 S.model 而非 role.model）。 */
    if (S.models && S.models.length){
      var bsel = document.createElement('select');
      bsel.autocomplete = 'off';
      /* task290：与输入框一字不差=别名清单（visibleModelsForPick；S.model 无别名时函数自带兜底追加当前模型） */
      visibleModelsForPick().forEach(function(m){
        var o = document.createElement('option');
        o.value = m.providerID + '/' + m.modelID;
        o.textContent = labelModel(m);
        if (m.providerID === S.model.providerID && m.modelID === S.model.modelID) o.selected = true;
        bsel.appendChild(o);
      });
      bsel.onchange = function(){
        var parts = bsel.value.split('/');
        if (!bsel.value || parts.length < 2) return;
        S.model = { providerID: parts[0], modelID: parts.slice(1).join('/') };
        try { localStorage.setItem('littledj.model', JSON.stringify(S.model)) } catch(err){}
        syncModelLabel();
        refreshBillingViews();
        var bm = (S.models || []).filter(function(m){ return m.providerID === S.model.providerID && m.modelID === S.model.modelID })[0];
        toast('大管家模型已切换（与输入框联动）：' + (bm ? labelModel(bm) : bsel.value));
      };
      f.appendChild(bsel);
    } else {
      f.appendChild(el('span', null, '模型列表加载中…（与输入框同步）'));
    }
    body.appendChild(f);
    body.appendChild(el('div', 'role-hint', 'task258：大管家模型与输入框联动——在此选择立即生效（同输入框右下角，有图片请选 4.1 Flash），角色卡不写回。'));
  } else {
  /* task250（主人 2026-11-13 口述「和输入框那个模型的选择对齐」）：恢复 task75 下拉（task81 改只读退役），
     选项与输入框模型下拉**一字不差**——同 S.models 数组、同 labelModel 文本、同排序；
     当前值不在列表置顶保留；写回走 /_roles/model（proxy 端点 task81 未删）。 */
  var touched = false; /* task75 原版语义：用户已动下拉后，模型列表异步到达不重渲（防吞掉选择/自定义输入） */
  /* task250（主人 2026-11-13 口述「和输入框那个模型的选择对齐」）：恢复 task75 下拉（task81 改只读退役），
     选项与输入框模型下拉**一字不差**——同 S.models 数组、同 labelModel 文本、同排序；
     当前值不在列表置顶保留；写回走 /_roles/model（proxy 端点 task81 未删）。 */
  if (!(S.models && S.models.length) && !ROLES.modelsTried && !ROLES.modelsLoading){
    ROLES.modelsTried = true; ROLES.modelsLoading = true;
    loadModelsWithRetry(3).then(function(){ ROLES.modelsLoading = false; if (!touched) renderRoles() });
  }
  var sel = document.createElement('select');
  sel.id = 'roleModelSel';
  sel.autocomplete = 'off';
  /* task290（主人裁决）：选项与输入框一字不差=别名清单（rolePickModel 内走 visibleModelsForPick）；
     角色存的模型没别名（主人原则「没别名就不能用」）→ sel 自动落到默认官方，见下方 autoFix 写回段 */
  var rp = rolePickModel(curModel);
  if (rp.sel && !rp.list.some(function(m){ return m.providerID + '/' + m.modelID === rp.sel })){
    var oCur = document.createElement('option');
    oCur.value = rp.sel; oCur.textContent = roleModelReadonly(rp.sel) + '（未在列表）'; oCur.selected = true;
    sel.appendChild(oCur);
  }
  rp.list.forEach(function(m){
    var o = document.createElement('option');
    o.value = m.providerID + '/' + m.modelID;
    o.textContent = labelModel(m); /* 与输入框 refreshModelOptions 同源同文 */
    if (o.value === rp.sel) o.selected = true;
    sel.appendChild(o);
  });
  var oCus = document.createElement('option');
  oCus.value = '__custom__'; oCus.textContent = '自定义…';
  sel.appendChild(oCus);
  f.appendChild(sel);
  var cus = document.createElement('input');
  cus.id = 'roleModelCustom'; cus.placeholder = 'provider/model'; cus.autocomplete = 'off';
  cus.style.display = 'none';
  cus.oninput = function(){ touched = true };
  f.appendChild(cus);
  var save = el('button', 'role-save', '保存');
  f.appendChild(save);
  sel.onchange = function(){
    touched = true;
    var on = sel.value === '__custom__';
    cus.style.display = on ? '' : 'none';
    if (on) cus.focus(); else cus.value = '';
  };
  body.appendChild(f);
  /* task290（主人裁决）：角色存的模型没别名（没别名就不能用）→ 自动默认改用「官方」并写回角色卡
     （重启 serve 后生效）；全无别名时 rolePickModel.autoFix 为空不触发；幂等，失败静默下次渲染重试 */
  if (rp.autoFix && !ROLES._autoFixBusy){
    ROLES._autoFixBusy = true;
    var dm = rp.list.filter(function(m){ return m.providerID + '/' + m.modelID === rp.autoFix })[0];
    var defLabel = dm ? labelModel(dm) : rp.autoFix;
    fetch('/_roles/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: role.name, model: rp.autoFix })
    }).then(function(r){ return r.json() }).then(function(res){
      ROLES._autoFixBusy = false;
      if (res.error) throw new Error(res.error);
      toast('「' + (role.label || role.name) + '」原模型已无别名（没别名不能用），已默认改用 ' + defLabel + '，重启 serve 后生效');
      ROLES.data = null;
      loadRoles();
    }).catch(function(){
      ROLES._autoFixBusy = false; /* 静默失败：下次渲染重试（PUT 幂等） */
    });
  }
  if (!(S.models && S.models.length)){
    var retry = el('div', 'role-src', ROLES.modelsLoading ? '模型加载中…' : '模型列表加载失败 · 点此重试');
    retry.style.cursor = 'pointer';
    retry.onclick = function(){
      if (ROLES.modelsLoading) return;
      ROLES.modelsLoading = true; renderRoles();
      loadModelsWithRetry(3).then(function(){ ROLES.modelsLoading = false; if (!touched) renderRoles() });
    };
    body.appendChild(retry);
  } else {
    body.appendChild(el('div', 'roles-sub', '选项与输入框一致（只列已起别名的模型），共 ' + rp.list.length + ' 项'));
  }
  body.appendChild(el('div', 'role-hint', '选择后点「保存」写回角色卡源文件，重启 serve 后对 TUI/serve 侧生效；PWA 对话实际模型仍以输入框每轮请求为准。' + (d.restartHint || '')));
  save.onclick = function(){
    var model = String(sel.value === '__custom__' ? cus.value : sel.value).trim();
    if (!model){ toast('模型不能为空', true); return }
    if (!ROLE_MODEL_RE.test(model)){ toast('模型格式应为 provider/model', true); return }
    save.disabled = true; save.textContent = '保存中…';
    fetch('/_roles/model', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: role.name, model: model })
    }).then(function(r){ return r.json() }).then(function(res){
      if (res.error) throw new Error(res.error);
      /* task256：unchanged 必须回显文件当前值——主人被「显示像旧值」坑过（task256 事故：误触写回手滑值后
         再选再存只报「未变化」，分不清是显示错还是存错）；回显值让人一眼看出文件里到底是什么 */
      toast(res.unchanged ? ('模型未变化：文件当前已是 ' + model + '。如果这不是你想要的，请重新在下拉里选好再点保存') : '模型已写回，重启 serve 后生效');
      ROLES.data = null;
      loadRoles();
    }).catch(function(e){
      save.disabled = false; save.textContent = '保存';
      toast('模型保存失败：' + e.message, true);
    });
  };
  } /* task257：else（非 butler）模型下拉块结束 */
  body.appendChild(el('div', 'role-src', '角色卡位置'));
  body.appendChild(roleSrcItem('生效副本（deveco 启动时加载）', role.livePath, role.liveExists, '生效'));
  if (role.sourcePath) body.appendChild(roleSrcItem('项目源文件（写回时同步）', role.sourcePath, role.sourceExists, '源文件'));
  body.appendChild(el('div', 'role-src', '工具权限'));
  body.appendChild(el('div', 'role-tools', role.tools && role.tools.length ? role.tools.join(' · ') : '（未声明）'));
  body.appendChild(el('div', 'role-src', '实际加载的 prompt 来源'));
  (role.prompts || []).forEach(function(p){
    var box = el('div', 'role-item');
    var rn = el('div', 'rn');
    rn.appendChild(el('span', null, p.label));
    rn.appendChild(el('span', p.active ? 'role-ok' : 'role-no', p.active ? '生效' : '未生效'));
    box.appendChild(rn);
    box.appendChild(el('div', 'rp', p.path || '（未配置路径）'));
    box.appendChild(el('div', 'rnote', (p.exists ? '' : '文件不存在 · ') + (p.note || '')));
    body.appendChild(box);
  });
  if (d.instructions && d.instructions.length){
    body.appendChild(el('div', 'role-src', 'deveco.jsonc instructions（全局注入）'));
    d.instructions.forEach(function(p){ body.appendChild(el('div', 'rp', p)) });
  }
  wrap.appendChild(body);
}

window.ROLES=ROLES; window.ROLE_MODEL_RE=ROLE_MODEL_RE; window.loadRoles=loadRoles; window.roleSrcItem=roleSrcItem; window.roleModelReadonly=roleModelReadonly; window.renderRoles=renderRoles;

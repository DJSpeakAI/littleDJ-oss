/* @module modals @order 32 @职责 弹窗/文件夹选择器/新建项目 @提供 _picker NEW_PROJ_NAME_RE _flashProj openModal closeModal samePath pickProjectName registerFolder pickFolder pickerConfirm pickerError loadPicker toggleNewDir submitNewDir jumpPicker renderPickerList renderPicker projParentDir validateNewProjName createProject flashProjectRow askNewProject submitNewProject askNewTaskDialog @依赖 - @依赖运行期 closeUsageStats fetchUsage fmtTok USAGE SK prColMenuClose MR_DRAG ntCloseFlush S loadProjects scheduleSidebar renderSidebar setView toast _projRowHidden findProject defaultProjectName newTask @DOM契约 - @严格模式 是 @全局占用 _picker NEW_PROJ_NAME_RE _flashProj openModal closeModal samePath pickProjectName registerFolder pickFolder pickerConfirm pickerError loadPicker toggleNewDir submitNewDir jumpPicker renderPickerList renderPicker projParentDir validateNewProjName createProject flashProjectRow askNewProject submitNewProject askNewTaskDialog @源行 ui/index.html L8778-L9134 @测试锚点 - @被调用 - */
'use strict';
/* ---------- modal ---------- */
function openModal(title?, bodyHTML?, onOk?, okText?){
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = bodyHTML;
  $('#overlay').classList.add('open');
  $('#modalOk').textContent = okText || '确定';
  $('#modalSave').style.display = 'none';
  $('#modalCancel').style.display = ''; /* task216：每次打开重置取消按钮可见性（openNotes 会单独隐藏） */
$('#modalCancel').onclick = closeModal;
$('#usBack').onclick = closeUsageStats;
$('#usClose').onclick = closeUsageStats;
$('#usRefresh').onclick = function(){ fetchUsage(true) };
$('#usChart').addEventListener('mousemove', function(e){
  var bar = e.target && e.target.closest ? e.target.closest('.us-bar') : null;
  var tip = $('#usTip'); if (!tip) return;
  if (!bar){ tip.hidden = true; return }
  var tin = Number(bar.getAttribute('data-tin')) || 0;
  var tout = Number(bar.getAttribute('data-tout')) || 0;
  var cost = Number(bar.getAttribute('data-cost')) || 0;
  var count = Number(bar.getAttribute('data-count')) || 0;
  tip.innerHTML = '<div class="t1">' + esc(bar.getAttribute('data-label')) + '</div>' +
    '<div>合计 <b>' + fmtTok(tin + tout) + '</b> tokens</div>' +
    '<div>输入 ' + fmtTok(tin) + ' · 输出 ' + fmtTok(tout) + '</div>' +
    (cost > 0 ? '<div>花费 <b>$' + cost.toFixed(3) + '</b></div>' : '') +
    '<div>' + count + ' 条消息</div>';
  tip.hidden = false;
  var x = e.clientX + 14, y = e.clientY + 14;
  var w = tip.offsetWidth, h = tip.offsetHeight;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - 12;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - 12;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
$('#usChart').addEventListener('mouseleave', function(){ var tip = $('#usTip'); if (tip) tip.hidden = true });
$('#usGran').addEventListener('click', function(e){
  var b = e.target;
  if (!b || !b.getAttribute) return;
  var bk = b.getAttribute('data-bucket');
  if (!bk || bk === USAGE.bucket) return;
  USAGE.bucket = bk; fetchUsage(false);
});
$('#usageStats').addEventListener('click', function(e){ if (e.target === $('#usageStats')) closeUsageStats() });
  $('#modalOk').onclick = function(){ onOk(); };
}
function closeModal(){
  var picker = _picker; _picker = null;
  $('#overlay').classList.remove('open');
  var m = document.querySelector('.modal'); if (m){ m.classList.remove('wide'); m.classList.remove('xwide'); m.classList.remove('picker') }
  if (picker && picker.onCancel) picker.onCancel();
  /* task194：关弹窗时收口 skill 运行/比价刷新轮询定时器（红线：定时器销毁点收口；产出审 P1-3） */
  if (typeof SK !== 'undefined'){ if (SK.pollT){ clearInterval(SK.pollT); SK.pollT = 0 } if (SK.prPollT){ clearInterval(SK.prPollT); SK.prPollT = 0 } }
  if (typeof prColMenuClose === 'function') prColMenuClose(); /* task208：关弹窗收口列菜单（红线：销毁点收口） */
  /* task218：设置弹窗收尾——定高类 / inline 尺寸 / 拖拽手柄与守卫（window 监听 init 一次性绑定，此处不解绑） */
  if (m){ m.classList.remove('settings'); (m as HTMLElement).style.removeProperty('width'); (m as HTMLElement).style.removeProperty('height') }
  MR_DRAG = null;
  var mrz = $('#modalResize'); if (mrz){ mrz.hidden = true; mrz.classList.remove('active') }
  if (typeof ntCloseFlush === 'function') ntCloseFlush(); /* task216：关弹窗收口备忘录未落盘输入（ESC/遮罩不走 onOk，须此兜底） */
}
/* ---------- 文件夹选择器（新建项目 / 新建对话） ---------- */
var _picker = null;
function samePath(a?, b?){ return String(a || '').replace(/[\\/]+$/, '') === String(b || '').replace(/[\\/]+$/, '') }
function pickProjectName(targetPath?){
  var base = String(targetPath || '').split(/[\\/]/).filter(Boolean).pop() || '项目';
  var name = base.replace(/[^\w\u4e00-\u9fa5 .\-]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 64) || '项目';
  var used = {};
  S.projects.concat(S.imports).forEach(function(p){ used[p.name] = p.path });
  if (used[name] && samePath(used[name], targetPath)) return name;
  var n = name, i = 2;
  while (used[n]){ n = (name + '-' + i).slice(0, 64); i++ }
  return n;
}
function registerFolder(targetPath?, cb?){
  var p = String(targetPath || '').replace(/[\\/]+$/, '');
  var hit = S.projects.concat(S.imports).filter(function(x){ return samePath(x.path, p) })[0];
  if (hit){ if (cb) cb(hit.name, hit.path); return }
  var name = pickProjectName(p);
  fetch('/_import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name, path: p }) })
    .then(function(r){ return r.json() })
    .then(function(d){
      if (d.error) return alert('登记项目失败：' + d.error);
      /* task235：登记成功立刻补帧左栏——「新建对话」弹窗内「＋」入口（mProjAdd→askNewTaskDialog）无 setView/renderSidebar，
         不补帧则新项目登记成功落盘但左栏永不显示（200ms 节流；askNewProject 入口最坏冗余一次重建，可忽略） */
      loadProjects().then(function(){ scheduleSidebar(); if (cb) cb(d.name, d.path) });
    })
    .catch(function(e){ alert('登记项目失败：' + e.message) });
}
function pickFolder(onPick?, onCancel?){
  _picker = { path: '', parent: null, onPick: onPick, onCancel: onCancel, seq: 0, entries: [], q: '' };
  openModal('选择项目文件夹',
    '<div id="dirPicker" class="dirpicker"><div class="dirempty">加载中…</div></div>',
    pickerConfirm, '选择此文件夹');
  document.querySelector('.modal').classList.add('picker');
  loadPicker('');
}
/* task233：「选择此文件夹」确认链抽出共用——手动点确认钮与「新建文件夹即项目」自动确认
   （submitNewDir 创建成功直达）走同一条路；先 _picker=null 再 closeModal，避开 closeModal 的 onCancel 钩子 */
function pickerConfirm(){
  if (!_picker || !_picker.path) return;
  var p = _picker.path, fn = _picker.onPick;
  _picker = null; closeModal();
  if (fn) fn(p);
}
function pickerError(msg?){
  var lb = $('#dirListBox');
  if (lb){ lb.innerHTML = '<div class="dirempty">' + esc(msg) + '</div>'; return }
  var box = $('#dirPicker'); if (box) box.innerHTML = '<div class="dirempty">' + esc(msg) + '</div>';
}
function loadPicker(p?){
  if (!_picker) return;
  _picker.q = '';
  var seq = ++_picker.seq;
  fetch('/_fs/browse' + (p ? '?path=' + encodeURIComponent(p) : ''))
    .then(function(r){ return r.json() })
    .then(function(d){
      if (!_picker || seq !== _picker.seq) return;
      if (d.error){ pickerError(d.error); return }
      _picker.path = d.path; _picker.parent = d.parent; _picker.entries = d.entries || [];
      renderPicker(d);
    })
    .catch(function(e){
      if (!_picker || seq !== _picker.seq) return;
      pickerError('加载失败：' + e.message);
    });
}
function toggleNewDir(show?){
  var row = $('#dirNewRow'); if (!row) return;
  var err = $('#dirNewErr'); if (err) err.textContent = '';
  if (show){
    row.hidden = false;
    var inp = $('#dirNewName');
    if (inp){ inp.value = ''; try { inp.focus() } catch (e) {} }
  } else row.hidden = true;
}
function submitNewDir(){
  var inp = $('#dirNewName'); if (!inp || !_picker) return;
  var name = String(inp.value || '').trim();
  var errBox = $('#dirNewErr');
  function fail(msg){ if (errBox) errBox.textContent = msg }
  if (!name){ fail('请先输入文件夹名称'); try { inp.focus() } catch (e) {} return }
  if (/[\/\\]/.test(name)){ fail('文件夹名不能包含斜杠'); return }
  fetch('/_fs/mkdir', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: _picker.path, name: name })
  }).then(function(r){ return r.json() }).then(function(d){
    if (!_picker) return;
    if (d.error){ fail(d.error); return }
    /* task233：新建文件夹=项目（主人 2026-11-12 原话钉死语义）——创建成功直达
       「选择此文件夹」同一确认链（pickerConfirm：登记项目+关弹窗+刷新左栏），
       不再 loadPicker 进入新目录停留弹窗等第二次确认（旧语义下主人以为建完即成，
       直接关弹窗 → 登记永不发生 → 左栏永远不显示新项目） */
    _picker.path = d.path;
    pickerConfirm();
  }).catch(function(e){ fail('新建失败：' + e.message) });
}
function jumpPicker(){
  var pi = $('#dirPathInput'); if (!pi || !_picker) return;
  var v = String(pi.value || '').trim();
  if (!v) return;
  loadPicker(v);
}
/* 只重绘列表区（筛选输入不重新请求服务端） */
function renderPickerList(){
  var lb = $('#dirListBox'); if (!lb || !_picker) return;
  var all = _picker.entries || [];
  var q = String(_picker.q || '').trim().toLowerCase();
  var list = all.filter(function(x){ return !q || String(x.name).toLowerCase().indexOf(q) >= 0 });
  if (!list.length){
    lb.innerHTML = '<div class="dirempty">' + (all.length ? '没有匹配「' + esc(String(_picker.q).trim()) + '」的文件夹' : '这个文件夹里没有子文件夹') + '</div>';
    return;
  }
  lb.innerHTML = list.map(function(x, i){
    return '<div class="dirrow" data-i="' + i + '" title="' + esc(x.path) + '"><span class="di">📁</span><span class="dn">' + esc(x.name) + '</span><span class="go">进入 ›</span></div>';
  }).join('');
  $$('#dirListBox .dirrow').forEach(function(row){
    row.onclick = function(){
      var x = list[Number(row.getAttribute('data-i'))];
      if (x) loadPicker(x.path);
    };
  });
}
function renderPicker(d?){
  var box = $('#dirPicker'); if (!box) return;
  var quickNames = ['Desktop', 'Documents', 'Download', 'IDEProjects'];
  var quick = (_picker.entries || []).filter(function(x){ return quickNames.indexOf(x.name) >= 0 });
  var html = '<div class="dirbar">' +
      '<input id="dirPathInput" class="dirpath" type="text" spellcheck="false" autocomplete="off" value="' + esc(d.path) + '" title="可直接输入或粘贴完整路径，回车跳转">' +
      '<button class="dirup" id="dirGo">跳转</button>' +
      '<button class="dirup" id="dirHome">⌂ 主目录</button>' +
      (d.parent ? '<button class="dirup" id="dirUp">↑ 上级</button>' : '') +
    '</div>' +
    '<div class="dirhint">点文件夹进入；也可以在路径栏直接输入或粘贴完整路径（在系统文件管理器里「复制路径」即可）后回车。新建的文件夹会直接登记为项目。</div>' +
    (quick.length ? '<div class="dirquick">' + quick.map(function(x, i){
      return '<button class="dirchip" data-qi="' + i + '">' + esc(x.name) + '</button>';
    }).join('') + '</div>' : '') +
    '<div class="dirfilterbar">' +
      '<input id="dirFilter" class="dirfilter" type="text" spellcheck="false" autocomplete="off" placeholder="筛选当前文件夹里的目录名…" value="' + esc(_picker.q) + '">' +
      '<button class="dirnew" id="dirNewBtn">＋ 新建文件夹</button>' +
    '</div>' +
    '<div class="dirnewrow" id="dirNewRow" hidden>' +
      '<input id="dirNewName" class="dirfilter" type="text" spellcheck="false" autocomplete="off" placeholder="新项目文件夹名，回车即创建并登记为项目">' +
      '<button class="dirnew" id="dirNewOk">创建</button>' +
      '<button class="dirup" id="dirNewCancel">取消</button>' +
      '<div class="dirnewerr" id="dirNewErr"></div>' +
    '</div>' +
    '<div class="dirlists" id="dirListBox"></div>';
  box.innerHTML = html;
  var go = $('#dirGo'); if (go) go.onclick = jumpPicker;
  var pi = $('#dirPathInput');
  if (pi) pi.onkeydown = function(e){ if (e.key === 'Enter'){ if (e.isComposing || e.keyCode === 229) return; e.preventDefault(); jumpPicker() } };
  var home = $('#dirHome'); if (home) home.onclick = function(){ loadPicker('') };
  var up = $('#dirUp'); if (up) up.onclick = function(){ loadPicker(d.parent) };
  $$('#dirPicker .dirchip').forEach(function(chip){
    chip.onclick = function(){
      var x = quick[Number(chip.getAttribute('data-qi'))];
      if (x) loadPicker(x.path);
    };
  });
  var fi = $('#dirFilter');
  if (fi) fi.oninput = function(){ if (_picker){ _picker.q = fi.value; renderPickerList() } };
  var nb = $('#dirNewBtn'); if (nb) nb.onclick = function(){ toggleNewDir(true) };
  var nc = $('#dirNewCancel'); if (nc) nc.onclick = function(){ toggleNewDir(false) };
  var nk = $('#dirNewOk'); if (nk) nk.onclick = submitNewDir;
  var nn = $('#dirNewName');
  if (nn) nn.onkeydown = function(e){
    if (e.key === 'Enter'){ if (e.isComposing || e.keyCode === 229) return; e.preventDefault(); e.stopPropagation(); submitNewDir() }
    else if (e.key === 'Escape'){ e.preventDefault(); toggleNewDir(false) }
  };
  renderPickerList();
}
/* ---------- task236：右上角「＋」一步新建项目（2026-11-12 主人报障） ----------
   主人原话：「我增加一个文件夹，这里应该显示项目里面新增的一个项目啊」。
   原流程 ＋ → 文件夹选择器（先浏览再点「选择此文件夹」，「新建文件夹」藏在筛选条里），
   认知上「＋ = 新建项目」的人点完看不到新项目行。新流程：＋ → 输入项目名 → 创建
   → 建文件夹（<数据根>/projects/<名字>）+ 登记 + 左栏立刻出现并高亮；「选已有文件夹」旧路保留。 */
function projParentDir(){
  var r = String(S.root || '').replace(/[\\/]+$/, '');
  return r ? r + '/projects' : '';
}
/* 与服务端 NAME_RE /^[\w\u4e00-\u9fa5 .\-]{1,64}$/ 同口径：前端先拦，少一次往返 */
var NEW_PROJ_NAME_RE = /^[\w\u4e00-\u9fa5 .\-]{1,64}$/;
function validateNewProjName(name?){
  var n = String(name == null ? '' : name).trim();
  if (!n) return '请先输入项目名';
  if (!NEW_PROJ_NAME_RE.test(n)) return '项目名只能用中英文、数字、空格和 . - _（1~64 字）';
  var dup = S.projects.concat(S.imports).filter(function(p){ return p && p.name === n })[0];
  if (dup) return '已经有同名项目「' + n + '」了，换个名字吧';
  return '';
}
/* 建目录即登记（task236-fu1）：`<运行根>/projects/*` 由服务端 listProjects() 自动扫进项目列表，
   再补一次 /_import 会让同一路径同时进 projects 与 imports → 左栏画出两行同名项目（真机 E2E 实锤）。
   外部已有目录仍走「选已有文件夹」→ registerFolder → /_import，那条路不变。 */
function createProject(name?, onErr?, onDone?){
  var parent = projParentDir();
  var fail = function(msg){ if (onErr) onErr(msg) };
  if (!parent) return fail('拿不到 littleDJ 数据根目录，请刷新页面后重试');
  fetch('/_fs/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: parent, name: name }) })
    .then(function(r){ return r.json() })
    .then(function(d){
      if (d && d.error) return fail(d.error);
      var abs = (d && d.path) || (parent + '/' + name);
      loadProjects().then(function(){ if (onDone) onDone(name, abs) });
    })
    .catch(function(e){ fail('新建失败：' + e.message) });
}
/* 建好项目后把左栏那一行高亮并滚进视野——主人报障的核心是「看不见新项目」。
   task236-fu2：高亮状态存 `_flashProj`（不是只在 DOM 上挂类）——建完项目后 200ms 补帧/SSE 重绘会把
   刚挂上的类冲掉（真机 E2E 实测 1.2s 后 class 已消失）；改由 renderProjRow 每帧按 `_flashProj` 补类，
   2.6s 后清状态并重绘一次收尾。 */
var _flashProj = { name: '', until: 0 };
function flashProjectRow(name?){
  _flashProj = { name: String(name || ''), until: Date.now() + 2600 };
  renderSidebar();
  var rows = $$('#navBody .item'), i, t;
  for (i = 0; i < rows.length; i++){
    t = rows[i].querySelector('.t');
    if (t && t.textContent === name){
      try { rows[i].scrollIntoView({ block: 'nearest' }) } catch (e) {}
      break;
    }
  }
  setTimeout(function(){
    _flashProj = { name: '', until: 0 };
    if (S.view === 'projects') renderSidebar();
  }, 2600);
}
function askNewProject(){
  var parent = projParentDir();
  var body = '<div class="hint">新建项目 = 在 littleDJ 的项目目录下建一个文件夹，并登记到左栏。</div>' +
    '<div class="projrow"><input id="mkProjName" class="dirfilter" type="text" spellcheck="false" autocomplete="off" placeholder="项目名（就是文件夹名），例如 读书笔记"></div>' +
    '<div class="dirhint" id="mkProjWhere">' + (parent ? ('位置：' + esc(parent) + '/<b>项目名</b>') : '位置：拿不到数据根目录，请改用「选已有文件夹」') + '</div>' +
    '<div class="mkproj-actions"><button class="dirnew" id="mkProjPick">选已有文件夹…</button></div>' +
    '<div class="dirnewerr" id="mkProjErr"></div>';
  openModal('新建项目', body, submitNewProject, '创建');
  var ok = $('#modalOk'); if (ok) ok.disabled = false;
  var inp = $('#mkProjName');
  if (inp){
    inp.onkeydown = function(e){
      if (e.key === 'Enter'){ if (e.isComposing || e.keyCode === 229) return; e.preventDefault(); e.stopPropagation(); submitNewProject() }
      else if (e.key === 'Escape'){ e.preventDefault(); closeModal() }
    };
    try { inp.focus() } catch (e) {}
  }
  var pk = $('#mkProjPick');
  if (pk) pk.onclick = function(){
    closeModal();
    pickFolder(function(path){
      registerFolder(path, function(nm){
        /* task237：选已有文件夹也给回执——旧行为是「已登记项直接秒回、界面零变化」，主人以为没生效 */
        loadProjects().then(function(){
          setView('projects');
          flashProjectRow(nm);
          toast('已登记项目「' + nm + '」，左栏已更新', false, 2600);
        });
      });
    }, function(){ askNewProject() });
  };
}
function submitNewProject(){
  var inp = $('#mkProjName'), errBox = $('#mkProjErr');
  var name = String((inp && inp.value) || '').trim();
  var bad = validateNewProjName(name);
  if (bad){ if (errBox) errBox.textContent = bad; if (inp) try { inp.focus() } catch (e) {} return }
  var ok = $('#modalOk'); if (ok) ok.disabled = true;
  createProject(name, function(msg){
    if (ok) ok.disabled = false;
    if (errBox) errBox.textContent = msg;
  }, function(nm){
    closeModal();
    setView('projects');
    toast('已新建项目「' + nm + '」，左栏已更新', false, 2600);
    flashProjectRow(nm);
  });
}
function askNewTaskDialog(preselect?){
  if (!S.projects.length && !S.imports.length){
    pickFolder(function(path){
      registerFolder(path, function(name){ askNewTaskDialog(name) });
    });
    return;
  }
  var all = [], seen = {};
  /* task243：下拉里不列「左栏看不见的项目」（如被 HIDDEN_PROJECT_PATHS 藏的「日常」）——
     列了就会被默认/手滑选中，新会话建到左栏看不见的地方，主人以为“跑到别的项目去了”。
     若全是隐藏项目（极端），退回列全部，至少还能建。 */
  S.projects.concat(S.imports).forEach(function(p){ if (p && p.name && !seen[p.name] && !_projRowHidden(p)){ seen[p.name] = 1; all.push(p) } });
  if (!all.length) S.projects.concat(S.imports).forEach(function(p){ if (p && p.name && !seen[p.name]){ seen[p.name] = 1; all.push(p) } });
  var def = (preselect && findProject(preselect)) ? preselect : defaultProjectName();
  if (!def || !all.some(function(p){ return p.name === def })) def = all.length ? all[0].name : '';
  var opts = all.map(function(p){ return '<option value="' + esc(p.name) + '"' + (p.name === def ? ' selected' : '') + '>' + esc(p.name) + '</option>' }).join('');
  openModal('新建对话', '<div class="hint">选择项目目录：</div><div class="projrow"><select id="mProj">' + opts + '</select><button id="mProjAdd" class="pickbtn" title="选择文件夹">＋</button></div>', function(){
    closeModal(); newTask($('#mProj').value);
  });
  $('#mProjAdd').onclick = function(){
    pickFolder(function(path){
      registerFolder(path, function(name){ askNewTaskDialog(name) });
    }, function(){ askNewTaskDialog(def) });
  };
}
window._picker=_picker; window.NEW_PROJ_NAME_RE=NEW_PROJ_NAME_RE; window._flashProj=_flashProj; window.openModal=openModal; window.closeModal=closeModal; window.samePath=samePath; window.pickProjectName=pickProjectName; window.registerFolder=registerFolder; window.pickFolder=pickFolder; window.pickerConfirm=pickerConfirm; window.pickerError=pickerError; window.loadPicker=loadPicker; window.toggleNewDir=toggleNewDir; window.submitNewDir=submitNewDir; window.jumpPicker=jumpPicker; window.renderPickerList=renderPickerList; window.renderPicker=renderPicker; window.projParentDir=projParentDir; window.validateNewProjName=validateNewProjName; window.createProject=createProject; window.flashProjectRow=flashProjectRow; window.askNewProject=askNewProject; window.submitNewProject=submitNewProject; window.askNewTaskDialog=askNewTaskDialog;

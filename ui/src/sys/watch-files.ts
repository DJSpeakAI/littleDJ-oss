/* @module watch-files @order 31 @职责 监视台 + 文件面板 @提供 _watchAt FS_PLACES_KEY FS_PLACES_MAX _fsPlacesWait renderWatch loadDiff fsScope fsProjectBase fsHomePath fsGoProject fsGoHome fsJoin fsShort fsNormPath fsPlaceAllowed fsFavs fsSaveFavs fsFavName fsAddFav fsRemoveFav fsQuick fsEnsurePlaces fsBar fsAddPlace fsErrState fsDl loadHomeFiles fsHomeList openHomeFile loadFiles openFile @依赖 - @依赖运行期 S api toast _picker openModal closeModal loadPicker @DOM契约 - @严格模式 是 @全局占用 _watchAt FS_PLACES_KEY FS_PLACES_MAX _fsPlacesWait renderWatch loadDiff fsScope fsProjectBase fsHomePath fsGoProject fsGoHome fsJoin fsShort fsNormPath fsPlaceAllowed fsFavs fsSaveFavs fsFavName fsAddFav fsRemoveFav fsQuick fsEnsurePlaces fsBar fsAddPlace fsErrState fsDl loadHomeFiles fsHomeList openHomeFile loadFiles openFile @源行 ui/index.html L8380-L8777 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 监视台（T11）：只读四区块（服务/任务/巡检/资源），唯一按钮=刷新，零写操作 ---------- */
var _watchAt = 0;
function renderWatch(){
  var b = $('#rightBody');
  b.innerHTML = '<div class="emptyhint">读取监视快照…</div>';
  var btn = el('button', 'acard-open', '刷新');
  btn.style.margin = '4px';
  btn.onclick = function(){ renderWatch() };
  fetch('/_watch').then(function(r){ return r.json() }).then(function(d){
    if (S.tab !== 'watch' || !d || !d.ok) return;
    b.replaceChildren();
    b.appendChild(btn);
    var sec = function(title){ var s = el('div', 'watch-sec'); s.appendChild(el('div', 'watch-h', title)); b.appendChild(s); return s };
    var s1 = sec('服务');
    (d.services || []).forEach(function(x){
      var row = el('div', 'watch-row' + (x.up ? '' : ' bad'));
      row.appendChild(el('span', 'watch-dot' + (x.up ? ' up' : '')));
      row.appendChild(el('span', null, x.name + ' · ' + x.port));
      row.appendChild(el('span', 'watch-st', x.up ? '在线' : '掉线'));
      s1.appendChild(row);
    });
    var s2 = sec('任务（台账派生）');
    var t = d.tasks || {};
    var r2 = el('div', 'watch-row');
    r2.appendChild(el('span', null, '在跑 ' + (t.running || 0) + ' / 共 ' + (t.total || 0)));
    var c = t.counts || {};
    r2.appendChild(el('span', 'watch-st', '活跃 ' + (c.active || 0) + ' · 静默 ' + (c.quiet || 0) + ' · 疑似中断 ' + (c.stalled || 0) + ' · 等待中 ' + (c.held || 0) + ' · 归档 ' + (c.archived || 0))); /* task334 P2-3：waiting 单列「等待中」，不再计入疑似中断 */
    s2.appendChild(r2);
    /* task119：ETA 超时行（TUI/所有入口常驻可见口；N>0 走 watch-row.bad 警示，明细见任务面板 /_tasks） */
    var nOver = Number(t.etaOverdueCount) || 0;
    var rEta = el('div', 'watch-row' + (nOver > 0 ? ' bad' : ''));
    rEta.appendChild(el('span', null, '超预计（ETA）'));
    rEta.appendChild(el('span', 'watch-st', nOver > 0 ? ('超时 ' + nOver + ' 项·待查验') : '无超时'));
    s2.appendChild(rEta);
    var s3 = sec('巡察使巡检');
    var p = d.patrol || {};
    if (p.ok){
      var ps = p.summary || {};
      var r3 = el('div', 'watch-row' + ((ps.fail || 0) > 0 ? ' bad' : ''));
      r3.appendChild(el('span', null, (p.ageMin != null ? p.ageMin + ' 分钟前' : '-') + ' · ' + (p.alert === 'none' ? '无告警' : '需主人')));
      r3.appendChild(el('span', 'watch-st', 'pass ' + (ps.pass || 0) + ' · warn ' + (ps.warn || 0) + ' · fail ' + (ps.fail || 0)));
      s3.appendChild(r3);
    } else s3.appendChild(el('div', 'watch-row', '暂无巡检报告'));
    var s4 = sec('资源（本机）');
    var rs = d.res || {};
    var r4 = el('div', 'watch-row');
    r4.appendChild(el('span', null, '内存可用 ' + (rs.memAvailableMb || 0) + ' / ' + (rs.memTotalMb || 0) + ' MB'));
    r4.appendChild(el('span', 'watch-st', 'load1 ' + (rs.load1 != null ? rs.load1 : '-')));
    s4.appendChild(r4);
    b.appendChild(el('div', 'emptyhint', '快照时间 ' + new Date(d.at).toLocaleTimeString() + ' · 只读视图，AI 读 config/watch-state.json 同源'));
  }).catch(function(e){
    b.replaceChildren();
    b.appendChild(btn);
    b.appendChild(el('div', 'emptyhint', '监视数据读取失败：' + esc(e.message)));
  });
}
function loadDiff(){  var b = $('#rightBody'); b.innerHTML = '<div class="emptyhint">加载产物…</div>';
  if (!S.current){ b.innerHTML = '<div class="emptyhint">先选一个对话</div>'; return }
  api('/session/' + S.current.id + '/diff').then(function(diff){
    b.replaceChildren();
    if (!diff || !diff.length){ b.innerHTML = '<div class="emptyhint">这个对话还没有改动文件。<br>AI 改的文件会出现在这里。</div>'; return }
    var list = el('div', 'difflist');
    diff.forEach(function(d){
      var row = el('div', 'd');
      row.appendChild(el('span', 'f', d.file || d.path || '?'));
      if (d.additions != null) row.appendChild(el('span', 'add', '+' + d.additions));
      if (d.deletions != null) row.appendChild(el('span', 'del', '-' + d.deletions));
      row.onclick = function(){
        var old = b.querySelector('.diffpatch'); if (old) old.remove();
        b.appendChild(el('div', 'diffpatch', d.patch || d.diff || '(无补丁内容)'));
      };
      list.appendChild(row);
    });
    b.appendChild(list);
  }).catch(function(e){ b.innerHTML = '<div class="emptyhint">产物加载失败：' + esc(e.message) + '</div>' });
}
/* ---------- 文件面板：本机目录位置条（task72 S3，只读浏览，零写操作） ---------- */
var FS_PLACES_KEY = 'littleDJ.places', FS_PLACES_MAX = 20;
var _fsPlacesWait = [];
function fsScope(){ var b = S.fsBase; return (b && b.scope) || 'project' }
function fsProjectBase(){
  var b = S.fsBase, s = (typeof b === 'string') ? b : (b && b.scope === 'project' ? b.path : '');
  return s || (S.current ? S.current.directory : '') || (S.projects[0] ? S.projects[0].path : '');
}
function fsHomePath(){
  var b = S.fsBase;
  return (b && b.scope === 'home' && b.path) ? String(b.path) : '';
}
function fsGoProject(){ S.fsBase = { scope: 'project', path: '' }; S.filePath = ''; loadFiles() }
function fsGoHome(p){ S.fsBase = { scope: 'home', path: String(p || '') }; S.filePath = ''; loadFiles() }
function fsJoin(a, b){
  var x = String(a || '').replace(/\/+$/, ''), y = String(b || '').replace(/^\/+/, '');
  if (!x) return y;
  if (!y) return x;
  return x + '/' + y;
}
function fsShort(p){
  var root = S.homeRoot || '', s = String(p || '');
  if (!root) return s;
  if (s === root) return '~';
  if (s.indexOf(root + '/') === 0) return '~/' + s.slice(root.length + 1);
  return s;
}
function fsNormPath(p){
  var s = String(p || '');
  try { s = s.normalize('NFKC') } catch (e){}
  return s.replace(/\/+$/, '').toLowerCase();
}
/* 客户端软校验：越界/敏感段不收（服务端仍全量校验） */
function fsPlaceAllowed(p){
  var s = String(p || '');
  if (s.charAt(0) !== '/' || s.indexOf('\u0000') >= 0) return false;
  var segs = s.split('/').filter(Boolean);
  for (var i = 0; i < segs.length; i++){
    var g = segs[i].toLowerCase();
    if (g === 'backup' || g === 'run' || g === 'logs' || g === '.ssh' || g === '.gnupg') return false;
  }
  var home = S.homeRoot || '';
  if (home && s !== home && s.indexOf(home + '/') !== 0) return false;
  var root = S.root || '';
  if (root && (s === root || s.indexOf(root + '/') === 0) && s.indexOf(root + '/projects/') !== 0) return false;
  return true;
}
function fsFavs(){
  var out = [];
  try {
    var arr = JSON.parse(localStorage.getItem(FS_PLACES_KEY) || '[]');
    if (!arr || typeof arr !== 'object' || typeof arr.length !== 'number') return out;
    var seen = {};
    for (var i = 0; i < arr.length; i++){
      var x = arr[i];
      if (!x || typeof x !== 'object') continue;
      var name = String(x.name == null ? '' : x.name).trim();
      var p = String(x.path == null ? '' : x.path);
      if (!name || name.length > 24) continue;
      if (!fsPlaceAllowed(p)) continue;
      var k = fsNormPath(p);
      if (seen[k]) continue;
      seen[k] = 1; out.push({ name: name, path: p });
    }
  } catch (e){ return [] }
  return out.slice(0, FS_PLACES_MAX);
}
function fsSaveFavs(list){
  try { localStorage.setItem(FS_PLACES_KEY, JSON.stringify(list)); return true }
  catch (e){ toast('浏览器拒绝保存收藏', true); return false }
}
function fsFavName(p){
  var home = S.homeRoot || '', s = String(p || '');
  if (home && s === home) return '主目录';
  var segs = s.split('/').filter(Boolean);
  return (segs.length ? segs[segs.length - 1] : '主目录').slice(0, 24);
}
function fsAddFav(p){
  var path = String(p || '').replace(/\/+$/, '');
  if (!fsPlaceAllowed(path)){ toast('这个位置不能收藏', true); return }
  var list = fsFavs(), k = fsNormPath(path);
  for (var i = 0; i < list.length; i++) if (fsNormPath(list[i].path) === k){ toast('这个位置已在收藏里'); return }
  if (list.length >= FS_PLACES_MAX){ toast('收藏已满，请先移除一个', true); return }
  list.push({ name: fsFavName(path), path: path });
  if (fsSaveFavs(list) && S.tab === 'files') loadFiles();
}
function fsRemoveFav(p){
  var k = fsNormPath(p);
  fsSaveFavs(fsFavs().filter(function(x){ return fsNormPath(x.path) !== k }));
  if (S.tab === 'files') loadFiles();
}
function fsQuick(){ return S.homePlaces || [] }
function fsEnsurePlaces(cb){
  if (S.homePlaces !== null){ if (cb) cb(); return }
  if (cb) _fsPlacesWait.push(cb);
  if (S.homePlacesPending) return;
  S.homePlacesPending = true;
  fetch('/_fs/home/roots').then(function(r){ return r.json() }).then(function(d){
    if (d && d.ok){
      if (d.root) S.homeRoot = String(d.root);
      S.homePlaces = (d.places && d.places.length) ? d.places : [];
    } else S.homePlaces = [];
  }).catch(function(){ S.homePlaces = [] }).then(function(){
    S.homePlacesPending = false;
    var q = _fsPlacesWait; _fsPlacesWait = [];
    for (var i = 0; i < q.length; i++){ try { q[i]() } catch (e){} }
  });
}
function fsBar(){
  var bar = el('div', 'fsbar');
  var cur = fsScope(), here = fsHomePath(), norm = here ? fsNormPath(here) : '';
  var add = function(label, cls, title, fn){
    var btn = el('button', 'fsplace' + (cls ? ' ' + cls : ''), label);
    if (title) btn.title = title;
    btn.onclick = fn;
    bar.appendChild(btn);
    return btn;
  };
  add('当前项目', cur === 'project' ? 'on' : '', '当前会话所在的项目目录', fsGoProject);
  fsQuick().forEach(function(pl){
    var on = cur === 'home' && norm && norm === fsNormPath(pl.path);
    add(pl.name, on ? 'on' : '', fsShort(pl.path), function(){ fsGoHome(pl.path) });
  });
  fsFavs().forEach(function(pl){
    var on = cur === 'home' && norm && norm === fsNormPath(pl.path);
    var chip = add(pl.name, 'fav' + (on ? ' on' : ''), pl.path, function(){ fsGoHome(pl.path) });
    chip.setAttribute('aria-label', '收藏位置：' + pl.name + '（' + pl.path + '）');
    var x = el('span', 'fx', '✕');
    x.title = '移除此收藏';
    x.onclick = function(ev){ if (ev && ev.stopPropagation) ev.stopPropagation(); fsRemoveFav(pl.path) };
    chip.appendChild(x);
  });
  add('＋添加', 'add', '添加收藏位置', fsAddPlace);
  return bar;
}
/* 「＋添加」复用 pickFolder 的弹窗框架与 /_fs/browse，但绝不调 registerFolder（无登记副作用） */
function fsAddPlace(){
  _picker = { path: '', parent: null, onPick: null, onCancel: null, seq: 0, entries: [], q: '' };
  openModal('添加收藏位置',
    '<div id="dirPicker" class="dirpicker"><div class="dirempty">加载中…</div></div>',
    function(){
      if (!_picker || !_picker.path) return;
      var p = _picker.path;
      _picker = null; closeModal();
      fsAddFav(p);
    }, '收藏此文件夹');
  document.querySelector('.modal').classList.add('picker');
  loadPicker('');
}
function fsErrState(b, hint, code, d){
  if (hint && hint.parentNode) hint.remove();
  var msg;
  if (code === 403) msg = '无权访问该目录';
  else if (code === 400 || code === 404) msg = '该位置不可用（可能已删除或越界）';
  else if (code === 503) msg = '服务繁忙，请稍后重试';
  else msg = '文件加载失败' + (d && d.error ? '：' + d.error : '');
  b.appendChild(el('div', 'emptyhint', msg));
  var row = el('div', 'fsacts');
  var back = el('button', 'linkbtn', '← 返回当前项目'); back.onclick = fsGoProject; row.appendChild(back);
  var rt = el('button', 'linkbtn', '重试'); rt.onclick = function(){ loadFiles() }; row.appendChild(rt);
  var here = fsHomePath();
  if (here && fsFavs().some(function(x){ return fsNormPath(x.path) === fsNormPath(here) })){
    var rm = el('button', 'linkbtn', '移除此收藏'); rm.onclick = function(){ fsRemoveFav(here) }; row.appendChild(rm);
  }
  b.appendChild(row);
}
function fsDl(abs){
  var a = el('a', 'fsdl', '↓ 下载文件');
  a.href = '/_fs/home/raw?path=' + encodeURIComponent(abs);
  a.setAttribute('download', String(abs || '').split('/').pop() || '');
  return a;
}
function loadHomeFiles(){
  var b = $('#rightBody');
  b.replaceChildren();
  var bar = fsBar();
  b.appendChild(bar);
  var hint = el('div', 'emptyhint', '加载文件…');
  b.appendChild(hint);
  fsEnsurePlaces(function(){
    if (S.tab !== 'files' || !hint.parentNode) return;
    if (bar.parentNode){ var nb = fsBar(); bar.parentNode.replaceChild(nb, bar) }
    fsHomeList(b, hint);
  });
}
function fsHomeList(b, hint){
  var cur = fsHomePath();
  fetch('/_fs/home/list' + (cur ? '?path=' + encodeURIComponent(cur) : ''))
    .then(function(r){ return r.json().then(function(d){ return { code: r.status, d: d } }, function(){ return { code: r.status, d: null } }) })
    .then(function(res){
      if (!hint.parentNode) return;
      var d = res.d;
      if (!d || d.ok === false){ fsErrState(b, hint, res.code, d); return }
      S.fsBase = { scope: 'home', path: String(d.path || '') };
      hint.remove();
      b.appendChild(el('div', 'crumb', fsShort(d.path)));
      if (d.parent){
        var up = el('button', 'linkbtn', '↑ 上一级');
        up.onclick = function(){ fsGoHome(d.parent) };
        b.appendChild(up);
      }
      var entries = d.entries || [];
      entries.forEach(function(e){
        var full = fsJoin(d.path, e.name);
        var row = el('div', 'frow');
        row.appendChild(el('span', null, e.dir ? '▸' : '·'));
        row.appendChild(el('span', 'nm', e.name));
        row.appendChild(el('span', 'sz', e.dir ? '' : (e.size > 1024 ? (e.size/1024).toFixed(1)+'k' : e.size + 'B')));
        if (!e.dir){
          var dl = el('a', 'nsdl', '↓');
          dl.title = '下载';
          dl.href = '/_fs/home/raw?path=' + encodeURIComponent(full);
          dl.setAttribute('download', e.name);
          dl.onclick = function(ev){ if (ev && ev.stopPropagation) ev.stopPropagation() };
          row.appendChild(dl);
        }
        row.onclick = function(){ if (e.dir){ fsGoHome(full); return } openHomeFile(full) };
        b.appendChild(row);
      });
      if (!entries.length) b.appendChild(el('div', 'emptyhint', '空目录'));
      if (d.truncated) b.appendChild(el('div', 'emptyhint', '仅显示前 2000 项，可用「＋添加」直接进入子目录'));
    })
    .catch(function(e){ if (hint.parentNode) fsErrState(b, hint, 0, { error: e && e.message }) });
}
function openHomeFile(abs){
  var b = $('#rightBody'), lower = String(abs || '').toLowerCase();
  b.replaceChildren();
  b.appendChild(fsBar());
  var back = el('button', 'linkbtn', '← 返回'); back.onclick = loadFiles; b.appendChild(back);
  if (/\.(png|jpe?g|gif|webp)$/.test(lower)){
    var img = document.createElement('img');
    img.src = '/_fs/home/raw?path=' + encodeURIComponent(abs);
    var pv = el('div', 'preview'); pv.appendChild(img); b.appendChild(pv);
    img.onerror = function(){ b.appendChild(el('div', 'emptyhint', '图片加载失败（可能无权访问或文件已删除）')) };
    b.appendChild(el('div', 'crumb', fsShort(abs)));
    return;
  }
  if (/\.(svg|ico)$/.test(lower)){
    b.appendChild(el('div', 'crumb', fsShort(abs)));
    b.appendChild(el('div', 'emptyhint', '该格式（svg/ico）不内联预览，请点下载'));
    b.appendChild(fsDl(abs));
    return;
  }
  var hint = el('div', 'emptyhint', '读取文件…'); b.appendChild(hint);
  fetch('/_fs/home/read?path=' + encodeURIComponent(abs))
    .then(function(r){ return r.json().then(function(d){ return { code: r.status, d: d } }, function(){ return { code: r.status, d: null } }) })
    .then(function(res){
      if (!hint.parentNode) return;
      hint.remove();
      var d = res.d;
      if (!d || d.ok === false){
        if (res.code === 403) b.appendChild(el('div', 'emptyhint', '无权访问该文件（可能被列入敏感名单）'));
        else if (res.code === 413){ b.appendChild(el('div', 'emptyhint', '文件过大，无法预览（>4MB），请下载后查看')); b.appendChild(fsDl(abs)) }
        else if (res.code === 404) b.appendChild(el('div', 'emptyhint', '文件不存在'));
        else if (res.code === 503) b.appendChild(el('div', 'emptyhint', '服务繁忙，请稍后重试'));
        else b.appendChild(el('div', 'emptyhint', '读取失败' + (d && d.error ? '：' + d.error : '')));
        return;
      }
      b.appendChild(el('div', 'crumb', fsShort(abs)));
      b.appendChild(el('div', 'preview', d.content || ''));
    })
    .catch(function(e){
      if (!hint.parentNode) return;
      hint.remove();
      b.appendChild(el('div', 'emptyhint', '读取失败：' + esc(e && e.message)));
      var rt = el('button', 'linkbtn', '重试'); rt.onclick = function(){ openHomeFile(abs) }; b.appendChild(rt);
    });
}
function loadFiles(){
  if (fsScope() === 'home') return loadHomeFiles();
  var b = $('#rightBody');
  var base = fsProjectBase();
  if (!base){ b.replaceChildren(); b.appendChild(fsBar()); b.appendChild(el('div', 'emptyhint', '没有项目')); return }
  b.replaceChildren();
  var bar = fsBar(); b.appendChild(bar);
  fsEnsurePlaces(function(){ if (S.tab === 'files' && bar.parentNode) bar.parentNode.replaceChild(fsBar(), bar) });
  var hint = el('div', 'emptyhint', '加载文件…'); b.appendChild(hint);
  var rel = S.filePath ? (base + '/' + S.filePath) : base;
  fetch('/_fs/list?path=' + encodeURIComponent(rel)).then(function(r){ return r.json() }).then(function(d){
    if (!hint.parentNode) return;
    hint.remove();
    b.appendChild(el('div', 'crumb', rel));
    if (S.filePath){
      var up = el('button', 'linkbtn', '↑ 上一级');
      up.onclick = function(){ S.filePath = S.filePath.split('/').slice(0,-1).join('/'); loadFiles() };
      b.appendChild(up);
    }
    if (d.error){ b.appendChild(el('div', 'emptyhint', d.error)); return }
    (d.entries || []).forEach(function(e){
      var row = el('div', 'frow');
      row.appendChild(el('span', null, e.dir ? '▸' : '·'));
      row.appendChild(el('span', 'nm', e.name));
      row.appendChild(el('span', 'sz', e.dir ? '' : (e.size > 1024 ? (e.size/1024).toFixed(1)+'k' : e.size + 'B')));
      row.onclick = function(){
        if (e.dir){ S.filePath = (S.filePath ? S.filePath + '/' : '') + e.name; loadFiles(); return }
        openFile(rel + '/' + e.name);
      };
      b.appendChild(row);
    });
    if (!(d.entries || []).length) b.appendChild(el('div', 'emptyhint', '空目录'))
  }).catch(function(e){ if (hint.parentNode) hint.remove(); b.appendChild(el('div', 'emptyhint', '文件加载失败：' + esc(e.message))) })
}
function openFile(rel){
  if (fsScope() === 'home') return openHomeFile(rel);
  var b = $('#rightBody');
  var lower = rel.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|ico)$/.test(lower)){
    b.replaceChildren();
    var back = el('button', 'linkbtn', '← 返回'); back.onclick = loadFiles; b.appendChild(back);
    var img = document.createElement('img'); img.src = '/_fs/raw?path=' + encodeURIComponent(rel);
    var pv = el('div', 'preview'); pv.appendChild(img); b.appendChild(pv);
    return;
  }
  fetch('/_fs/read?path=' + encodeURIComponent(rel)).then(function(r){ return r.json() }).then(function(d){
    b.replaceChildren();
    var back = el('button', 'linkbtn', '← 返回'); back.onclick = loadFiles; b.appendChild(back);
    b.appendChild(el('div', 'crumb', rel));
    b.appendChild(el('div', 'preview', d.content || d.error || ''));
  }).catch(function(e){ b.innerHTML = '<div class="emptyhint">读取失败：' + esc(e.message) + '</div>' });
}


window._watchAt=_watchAt; window.FS_PLACES_KEY=FS_PLACES_KEY; window.FS_PLACES_MAX=FS_PLACES_MAX; window._fsPlacesWait=_fsPlacesWait; window.renderWatch=renderWatch; window.loadDiff=loadDiff; window.fsScope=fsScope; window.fsProjectBase=fsProjectBase; window.fsHomePath=fsHomePath; window.fsGoProject=fsGoProject; window.fsGoHome=fsGoHome; window.fsJoin=fsJoin; window.fsShort=fsShort; window.fsNormPath=fsNormPath; window.fsPlaceAllowed=fsPlaceAllowed; window.fsFavs=fsFavs; window.fsSaveFavs=fsSaveFavs; window.fsFavName=fsFavName; window.fsAddFav=fsAddFav; window.fsRemoveFav=fsRemoveFav; window.fsQuick=fsQuick; window.fsEnsurePlaces=fsEnsurePlaces; window.fsBar=fsBar; window.fsAddPlace=fsAddPlace; window.fsErrState=fsErrState; window.fsDl=fsDl; window.loadHomeFiles=loadHomeFiles; window.fsHomeList=fsHomeList; window.openHomeFile=openHomeFile; window.loadFiles=loadFiles; window.openFile=openFile;

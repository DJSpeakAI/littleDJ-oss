/* @module skills @order 39 @职责 备忘录 + 技能库 @提供 NT ntFind ntFmtTime openNotes ntLoad ntRenderList ntRenderEdit ntCapture ntDirty ntFlush ntCloseFlush ntSwitch ntCreate ntDel openSkills skLoadList skRenderList skOpenDetail skStatusBox skLoadLog skCollectSettings skSave skRunNow skPoll @依赖 - @依赖运行期 openModal closeModal toast SK skFmtTime skFmtDur skModeLabel skFind skOpenPricing @DOM契约 - @严格模式 是 @全局占用 NT ntFind ntFmtTime openNotes ntLoad ntRenderList ntRenderEdit ntCapture ntDirty ntFlush ntCloseFlush ntSwitch ntCreate ntDel openSkills skLoadList skRenderList skOpenDetail skStatusBox skLoadLog skCollectSettings skSave skRunNow skPoll @源行 ui/index.html L10851-L11176 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 备忘录（task216）：多条 txt 式文档，服务端存储跨端可见；自动保存 ---------- */
var NT: any = { list: [], cur: '', timer: 0, dirty: false, saving: false, pend: null };
function ntFind(id?){ for (var i = 0; i < NT.list.length; i++) if (NT.list[i].id === id) return NT.list[i]; return null }
function ntFmtTime(ts?){
  if (!ts) return '';
  var d = new Date(ts), n = new Date();
  var p2 = function(x){ return (x < 10 ? '0' : '') + x };
  var hm = p2(d.getHours()) + ':' + p2(d.getMinutes());
  if (d.toDateString() === n.toDateString()) return hm;
  if (d.toDateString() === new Date(n.getTime() - 86400000).toDateString()) return '昨天 ' + hm;
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + hm;
}
function openNotes(){
  document.querySelector('.modal').classList.add('xwide');
  openModal('备忘录', '<div class="nt-wrap" id="ntWrap"><div class="nt-side"><button class="nt-add" id="ntAdd" title="新建一条备忘">＋ 新建备忘</button><div class="nt-list" id="ntList"><div class="pr-empty">加载中…</div></div></div><div class="nt-edit" id="ntEdit"><div class="pr-empty">左栏选择或新建一条备忘</div></div></div>', function(){ closeModal() }, '关闭');
  $('#modalSave').style.display = 'none';
  $('#modalCancel').style.display = 'none'; /* 自动保存语义下「取消」误导（方案审 P2-1） */
  $('#ntAdd').onclick = ntCreate;
  ntLoad();
}
function ntLoad(){
  fetch('/_notes').then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }).then(function(d){
    NT.list = (d && d.notes) || [];
    if (!NT.cur || !ntFind(NT.cur)) NT.cur = NT.list.length ? NT.list[0].id : '';
    ntRenderList(); ntRenderEdit();
  }).catch(function(e){
    var w = $('#ntList'); if (w) w.innerHTML = '<div class="pr-empty">加载失败：' + esc(e.message) + '</div>';
  });
}
function ntRenderList(){
  var w = $('#ntList'); if (!w) return;
  w.replaceChildren();
  if (!NT.list.length){ w.appendChild(el('div', 'pr-empty', '还没有备忘，点上面「＋ 新建备忘」')); return }
  NT.list.forEach(function(n){
    var it = el('div', 'nt-item' + (n.id === NT.cur ? ' on' : ''));
    it.appendChild(el('div', 't', n.title || '（无标题）'));
    it.appendChild(el('div', 'm', ntFmtTime(n.updatedAt)));
    it.onclick = function(){ ntSwitch(n.id) };
    w.appendChild(it);
  });
}
function ntRenderEdit(){
  var w = $('#ntEdit'); if (!w) return;
  var n = ntFind(NT.cur);
  if (!n){ w.innerHTML = '<div class="pr-empty">左栏选择或新建一条备忘</div>'; return }
  w.replaceChildren();
  var ti = el('input', 'nt-tinput'); ti.type = 'text'; ti.maxLength = 60; ti.placeholder = '标题（≤60 字）'; ti.value = n.title || '';
  var ta = el('textarea', 'nt-ta'); ta.placeholder = '在这里写…（自动保存）'; ta.value = n.content || '';
  var st = el('div', 'nt-status', ''); st.id = 'ntStatus';
  var del = el('button', 'nt-del-btn', '🗑 删除本条');
  ti.oninput = function(){ ntDirty() };
  ta.oninput = function(){ ntDirty() };
  ti.onblur = function(){ ntFlush() };
  ta.onblur = function(){ ntFlush() };
  del.onclick = function(){ ntDel(n.id) };
  var head = el('div', 'nt-head'); head.appendChild(ti); head.appendChild(del);
  w.appendChild(head); w.appendChild(ta); w.appendChild(st);
}
function ntCapture(){ /* 把编辑框现值捕获进内存对象（切条/保存前必调，防丢字） */
  var n = ntFind(NT.cur); if (!n) return;
  var ti: any = document.querySelector('#ntEdit .nt-tinput'), ta: any = document.querySelector('#ntEdit .nt-ta');
  if (ti) n.title = ti.value;
  if (ta) n.content = ta.value;
}
function ntDirty(){
  NT.dirty = true;
  var st = $('#ntStatus'); if (st) st.textContent = '编辑中…';
  if (NT.timer) clearTimeout(NT.timer);
  NT.timer = setTimeout(function(){ NT.timer = 0; ntFlush() }, 900);
}
function ntFlush(cb?){
  if (NT.timer){ clearTimeout(NT.timer); NT.timer = 0 }
  ntCapture();
  if (NT.saving){ if (cb) NT.pend = cb; return } /* 在途保存：排到完成后执行（防串写/丢字） */
  var n = ntFind(NT.cur);
  if (!n || !NT.dirty){ if (cb) cb(); return }
  NT.dirty = false; NT.saving = true;
  var body = { op: 'save', id: n.id, title: n.title, content: n.content };
  var st = $('#ntStatus'); if (st) st.textContent = '保存中…';
  fetch('/_notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r){ return r.json() }).then(function(d){
      if (!d || !d.ok) throw new Error((d && d.error) || '保存失败');
      n.updatedAt = (d.note && d.note.updatedAt) || Date.now();
      var s2 = $('#ntStatus'); if (s2) s2.textContent = '已保存 ' + ntFmtTime(n.updatedAt); /* P2-2：关闭后 DOM 已换，判空 */
      ntRenderList();
    }).catch(function(e){
      NT.dirty = true;
      var s3 = $('#ntStatus'); if (s3) s3.textContent = '保存失败：' + String((e && e.message) || e).slice(0, 60) + '（编辑或切条时自动重试）';
    }).then(function(){
      NT.saving = false;
      var p = NT.pend; NT.pend = null;
      if (p) p();
    });
  if (cb) cb();
}
function ntCloseFlush(){ /* closeModal 挂钩：兜住 ESC/遮罩关闭时的未落盘输入（含 save 在途+新输入，产出审 P1） */
  try { ntFlush(function(){ if (NT.dirty && !NT.saving) ntFlush() }) } catch (e) {}
}
function ntSwitch(id?){
  if (id === NT.cur) return;
  ntFlush(function(){ NT.cur = id; ntRenderList(); ntRenderEdit() });
}
function ntCreate(){
  ntFlush(function(){
    fetch('/_notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'create' }) })
      .then(function(r){ return r.json() }).then(function(d){
        if (!d || !d.ok) throw new Error((d && d.error) || '新建失败');
        NT.list.unshift(d.note); NT.cur = d.note.id;
        ntRenderList(); ntRenderEdit();
        setTimeout(function(){ var ti = document.querySelector<HTMLElement>('#ntEdit .nt-tinput'); if (ti) ti.focus() }, 50);
        toast('已新建备忘', false, 1200);
      }).catch(function(e){ toast('新建失败：' + String((e && e.message) || e), true, 2600) });
  });
}
function ntDel(id?){
  if (!confirm('删除这条备忘？\n删除后不可恢复！')) return;
  NT.dirty = false; if (NT.timer){ clearTimeout(NT.timer); NT.timer = 0 }
  fetch('/_notes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'delete', id: id }) })
    .then(function(r){ return r.json() }).then(function(d){
      if (!d || !d.ok) throw new Error((d && d.error) || '删除失败');
      NT.list = NT.list.filter(function(x){ return x.id !== id });
      if (NT.cur === id) NT.cur = NT.list.length ? NT.list[0].id : '';
      ntRenderList(); ntRenderEdit();
      toast('已删除', false, 1200);
    }).catch(function(e){ toast('删除失败：' + String((e && e.message) || e), true, 2600) });
}

function openSkills(){
  if (SK.pollT){ clearInterval(SK.pollT); SK.pollT = 0 }
  if (SK.prPollT){ clearInterval(SK.prPollT); SK.prPollT = 0 }
  document.querySelector('.modal').classList.add('wide');
  openModal('定时任务', '<div class="sk-wrap" id="skWrap"><div class="pr-empty">加载中…</div></div>', function(){ closeModal() }, '关闭');
  $('#modalSave').style.display = 'none';
  skLoadList();
}
function skLoadList(){
  fetch('/_skills').then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() }).then(function(d){
    SK.list = (d && d.skills) || [];
    skRenderList();
  }).catch(function(e){
    var w = $('#skWrap'); if (w) w.innerHTML = '<div class="pr-empty">加载失败：' + esc(e.message) + '</div>';
  });
}
function skRenderList(){
  var w = $('#skWrap'); if (!w) return;
  w.replaceChildren();
  /* task202 fu1：加号占位放页面里（主人 2026-11-10 纠正：不在侧栏 nav，在定时任务弹窗页内），功能后补先留位 */
  var add = el('div', 'sk-card sk-add');
  add.title = '添加定时任务（规划中，先留位）';
  var at = el('div', 't');
  at.appendChild(el('span', null, '＋'));
  at.appendChild(el('span', null, '新建任务'));
  add.appendChild(at);
  add.onclick = function(){ toast('添加定时任务：规划中，位置先留着', false, 1800) };
  w.appendChild(add);
  if (!SK.list.length){ w.appendChild(el('div', 'pr-empty', '还没有安装任何 skill')); return }
  SK.list.forEach(function(s){
    var card = el('div', 'sk-card');
    var t = el('div', 't');
    t.appendChild(el('span', null, '📊'));
    t.appendChild(el('span', null, s.name));
    t.appendChild(el('span', 'sk-badge' + (s.enabled ? ' on' : ''), s.enabled ? '已启用' : '已停用'));
    if (s.running) t.appendChild(el('span', 'sk-badge run', '运行中…'));
    card.appendChild(t);
    var m = el('div', 'm');
    m.appendChild(el('span', null, '⏱ 下次：' + skFmtTime(s.nextRunAt)));
    var lr = s.lastResult;
    if (!lr) m.appendChild(el('span', null, '上次：还没跑过'));
    else m.appendChild(el('span', null, '上次：' + (lr.ok ? '✓ 抓了 ' + lr.count + ' 个模型' : '✗ ' + String(lr.error || '失败').slice(0, 36)) + (lr.durationMs ? ' · ' + skFmtDur(lr.durationMs) : '')));
    m.appendChild(el('span', null, '频率：' + skModeLabel(s.schedule.mode) + ' ' + s.schedule.time));
    card.appendChild(m);
    card.onclick = function(){ skOpenDetail(s.id) };
    w.appendChild(card);
  });
  w.appendChild(el('div', 'pr-note', '以后新增的 skill 都会出现在这里（S3+ 逐个接入 GLM / 火山等）。点击卡片进设置。'));
}

function skOpenDetail(id?){
  SK.cur = id;
  var s = skFind(id); if (!s) return;
  if (SK.pollT){ clearInterval(SK.pollT); SK.pollT = 0 }
  document.querySelector('.modal').classList.add('wide');
  openModal(s.name, '<div class="sk-wrap" id="skWrap"></div>', function(){ closeModal() }, '关闭');
  $('#modalSave').style.display = 'none';
  var w = $('#skWrap');

  w.appendChild(el('div', 'settings-sub', '① 数据源（定时爬取的网址）'));
  var srcs = (s.settings && s.settings.sources) || [];
  srcs.forEach(function(src, i){
    var box = el('div', 'sk-src');
    box.setAttribute('data-sid', String(src.id || ('source' + i)));
    var r1 = el('div', 'sk-row');
    var n = el('input'); n.setAttribute('data-f', 'name'); n.value = src.name || ''; n.placeholder = '供应商名称';
    var u = el('input'); u.setAttribute('data-f', 'url'); u.value = src.url || ''; u.placeholder = 'https://（定价页地址）';
    r1.appendChild(n); r1.appendChild(u);
    box.appendChild(r1);
    var r2 = el('div', 'sk-row');
    var us = el('input'); us.setAttribute('data-f', 'user'); us.value = ''; us.placeholder = '账号（可选，需要登录的网站才填）';
    var ps = el('input'); ps.setAttribute('data-f', 'pass'); ps.type = 'password'; ps.value = '';
    ps.placeholder = (src.credential && src.credential.pass === '********') ? '密码已保存 · 不改请留空' : '密码（可选）';
    r2.appendChild(us); r2.appendChild(ps);
    box.appendChild(r2);
    w.appendChild(box);
  });
  w.appendChild(el('div', 'pr-note', '凭据只存本机（不入 git），页面上永远不回显明文。DeepSeek 官网公开定价页无需凭据。'));

  w.appendChild(el('div', 'settings-sub', '② 定时'));
  var sch = s.schedule || { mode: 'every3days', time: '08:00' };
  var inline = el('div', 'sk-inline');
  var sel = el('select'); sel.id = 'skMode';
  [['daily', '每天'], ['every3days', '每 3 天'], ['weekly', '每周'], ['monthly', '每月']].forEach(function(p){
    var o = el('option', null, p[1]); o.value = p[0]; if (p[0] === sch.mode) o.selected = true; sel.appendChild(o);
  });
  var tm = el('input'); tm.id = 'skTime'; tm.type = 'time'; tm.value = sch.time || '08:00';
  var cb = el('input'); cb.id = 'skEnabled'; cb.type = 'checkbox'; cb.checked = sch.enabled !== false;
  var cbLab = el('label', null, ' 启用定时');
  cbLab.style.cssText = 'font-size:12.5px;color:var(--sub);display:flex;align-items:center;gap:6px';
  cbLab.insertBefore(cb, cbLab.firstChild);
  inline.appendChild(sel); inline.appendChild(tm); inline.appendChild(cbLab);
  w.appendChild(inline);

  w.appendChild(el('div', 'settings-sub', '③ 运行状态'));
  w.appendChild(skStatusBox(s.id));

  var ops = el('div', 'sk-ops');
  var bSave = el('button', 'guard-btn primary', '保存设置');
  bSave.onclick = function(){ skSave() };
  var bRun = el('button', 'guard-btn', '▶ 立即运行');
  bRun.onclick = function(){ skRunNow(s.id) };
  var bData = el('button', 'guard-btn', '查看比价数据 →');
  bData.onclick = function(){ skOpenPricing() };
  ops.appendChild(bSave); ops.appendChild(bRun); ops.appendChild(bData);
  w.appendChild(ops);

  w.appendChild(el('div', 'settings-sub', '最近运行日志'));
  var logBox = el('div', 'sk-log'); logBox.id = 'skLog';
  logBox.textContent = '加载中…';
  w.appendChild(logBox);
  skLoadLog(s.id);
}

function skStatusBox(id?){
  var s = skFind(id) || { lastResult: null, nextRunAt: 0, running: false };
  var box = el('div', 'sk-status'); box.id = 'skStatus';
  var lr = s.lastResult;
  if (s.running) box.className = 'sk-status';
  else if (lr && lr.ok) box.className = 'sk-status ok';
  else if (lr && !lr.ok) box.className = 'sk-status err';
  box.textContent = (s.running ? '⏳ 运行中…' :
    (lr ? (lr.ok ? '✓ 上次运行成功：' + lr.count + ' 个模型 · 用时 ' + skFmtDur(lr.durationMs) : '✗ 上次运行失败：' + String(lr.error || '').slice(0, 120)) :
      '还没运行过')) + ' · 下次计划：' + skFmtTime(s.nextRunAt);
  return box;
}
function skLoadLog(id?){
  fetch('/_skills/log?id=' + encodeURIComponent(id) + '&limit=10').then(function(r){ return r.json() }).then(function(d){
    var box = $('#skLog'); if (!box) return;
    var log = (d && d.log) || [];
    if (!log.length){ box.textContent = '暂无运行记录'; return }
    box.textContent = log.map(function(x){
      return skFmtTime(x.at) + '  ' + (x.ok ? '✓' : '✗') + '  ' + x.count + ' 个 · ' + skFmtDur(x.durationMs) + (x.error ? '  ' + String(x.error).slice(0, 80) : '');
    }).join('\n');
  }).catch(function(){ var box = $('#skLog'); if (box) box.textContent = '日志加载失败' });
}
function skCollectSettings(){
  var sources = [];
  var boxes = document.querySelectorAll('#skWrap .sk-src');
  for (var i = 0; i < boxes.length; i++){
    var box = boxes[i];
    var pass = (box.querySelector('[data-f="pass"]') as HTMLInputElement).value;
    sources.push({
      id: box.getAttribute('data-sid'),
      name: (box.querySelector('[data-f="name"]') as HTMLInputElement).value.trim(),
      url: (box.querySelector('[data-f="url"]') as HTMLInputElement).value.trim(),
      enabled: true,
      credential: { user: (box.querySelector('[data-f="user"]') as HTMLInputElement).value.trim(), pass: pass === '********' ? '' : pass }
    });
  }
  return {
    sources: sources,
    schedule: { mode: $('#skMode').value, time: $('#skTime').value || '08:00', enabled: $('#skEnabled').checked }
  };
}
function skSave(){
  var id = SK.cur; if (!id) return;
  fetch('/_skills/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id, settings: skCollectSettings() }) })
    .then(function(r){ return r.json().then(function(d){ if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d }) })
    .then(function(d){
      toast('设置已保存，下次运行：' + skFmtTime(d.skill && d.skill.nextRunAt));
      SK.list = SK.list.map(function(x){ return x.id === id && d.skill ? d.skill : x });
    })
    .catch(function(e){ toast('保存失败：' + e.message, true) });
}
function skRunNow(id?){
  fetch('/_skills/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) })
    .then(function(r){ return r.json().then(function(d){ if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d }) })
    .then(function(){
      toast('已开始运行…');
      var box = $('#skStatus'); if (box){ box.className = 'sk-status'; box.textContent = '⏳ 运行中…' }
      skPoll(id);
    })
    .catch(function(e){ toast('启动失败：' + e.message, true) });
}
function skPoll(id?){
  if (SK.pollT) clearInterval(SK.pollT);
  var tries = 0;
  SK.pollT = setInterval(function(){
    tries++;
    fetch('/_skills').then(function(r){ return r.json() }).then(function(d){
      SK.list = (d && d.skills) || SK.list;
      var s = skFind(id);
      if (!s) { clearInterval(SK.pollT); SK.pollT = 0; return }
      if (!s.running || tries > 45){
        clearInterval(SK.pollT); SK.pollT = 0;
        var box = $('#skStatus');
        if (box){
          var lr = s.lastResult || {};
          box.className = 'sk-status ' + (lr.ok ? 'ok' : 'err');
          box.textContent = (lr.ok ? '✓ 运行完成：' + lr.count + ' 个模型 · 用时 ' + skFmtDur(lr.durationMs) : '✗ 运行失败：' + String(lr.error || '未知错误').slice(0, 140)) + ' · 下次计划：' + skFmtTime(s.nextRunAt);
        }
        if (lr.ok) toast('比价数据已更新（' + lr.count + ' 个模型）'); else toast('运行失败：' + String(lr.error || '').slice(0, 100), true);
        skLoadLog(id);
      }
    }).catch(function(){ if (tries > 45){ clearInterval(SK.pollT); SK.pollT = 0 } });
  }, 3000);
}

window.NT=NT; window.ntFind=ntFind; window.ntFmtTime=ntFmtTime; window.openNotes=openNotes; window.ntLoad=ntLoad; window.ntRenderList=ntRenderList; window.ntRenderEdit=ntRenderEdit; window.ntCapture=ntCapture; window.ntDirty=ntDirty; window.ntFlush=ntFlush; window.ntCloseFlush=ntCloseFlush; window.ntSwitch=ntSwitch; window.ntCreate=ntCreate; window.ntDel=ntDel; window.openSkills=openSkills; window.skLoadList=skLoadList; window.skRenderList=skRenderList; window.skOpenDetail=skOpenDetail; window.skStatusBox=skStatusBox; window.skLoadLog=skLoadLog; window.skCollectSettings=skCollectSettings; window.skSave=skSave; window.skRunNow=skRunNow; window.skPoll=skPoll;

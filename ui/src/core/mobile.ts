/* @module mobile @order 5 @职责 移动端判定/视口/面板历史 @提供 _panelHist _vvhTimer isMobile syncInputPh syncPanelMask pushPanelHist closePanels bindItemMenu syncViewport api fmtTime fmtHM baseName findProject defaultProjectName projConvs saveProjOpen saveFocusProjOpen projOpenKeyForDir toggleProjOpen @依赖 - @依赖运行期 VOICE hideCtxMenu _selfBackAt _backTransAt _exitUntil syncScrollBtnPos _stickBottom scrollBottom S samePath _projRowHidden exitSortMode renderSidebar @DOM契约 - @严格模式 是 @全局占用 _panelHist _vvhTimer isMobile syncInputPh syncPanelMask pushPanelHist closePanels bindItemMenu syncViewport api fmtTime fmtHM baseName findProject defaultProjectName projConvs saveProjOpen saveFocusProjOpen projOpenKeyForDir toggleProjOpen @源行 ui/index.html L1521-L1641 @测试锚点 - @被调用 - */
'use strict';
/* ---------- mobile helpers ---------- */
function isMobile(): boolean{ return window.innerWidth <= 940 }
/* task88-S3：占位按端型二态——PC(>940px) 长文案 / 移动(≤940px) 短文案，断点与 CSS max-width:940px 同口径；录音占位期间跳过（VOICE.inputPh 存/恢复链不动），结束后下一次 resize 自动校正 */
function syncInputPh(): void{
  if (VOICE.inputPh !== null) return;
  $('#input').placeholder = isMobile() ? '今天帮你做些什么？' : '今天帮你做些什么？  @ 添加上下文，/ 调用技能与指令（可直接 Ctrl+V 粘图）';
}
var _panelHist = false;
function syncPanelMask(): void{
  var on = isMobile() && ($('#sidebar').classList.contains('open') || $('#right').classList.contains('open'));
  var m = $('#panelMask'); if (m) m.classList.toggle('show', on);
  document.body.classList.toggle('lock', on);
}
function pushPanelHist(): void{
  if (!isMobile() || _panelHist) return;
  try { history.pushState({ djPanel: 1 }, ''); _panelHist = true } catch(e){}
}
function closePanels(back?: boolean): void{
  $('#sidebar').classList.remove('open');
  if (isMobile()) $('#right').classList.remove('open');
  syncPanelMask();
  hideCtxMenu();
  /* task175：自己 back() 前记 _selfBackAt，popstate 翻译分支据此放行（防「关面板→自动又开」）
     task177 P1-1：程序性关闭≠返回手势序列——同时清零逃生门计数与粘性窗，否则「滑开→✕关→1s 内再滑」会被逃生门误吞、下一次滑直接退出页面 */
  if (back && _panelHist){ _panelHist = false; _selfBackAt = Date.now(); _backTransAt = 0; _exitUntil = 0; try { history.back() } catch(e){} }
}
function bindItemMenu(node: HTMLElement, show: (x: number, y: number) => void): void{
  node.oncontextmenu = function(ev){ ev.preventDefault(); show(ev.clientX, ev.clientY) };
  var timer = null, sx = 0, sy = 0, fired = false;
  node.addEventListener('touchstart', function(ev){
    if (ev.touches.length !== 1) return;
    var t = ev.touches[0]; sx = t.clientX; sy = t.clientY; fired = false;
    clearTimeout(timer);
    timer = setTimeout(function(){ timer = null; fired = true; show(sx, sy) }, 520);
  }, { passive: true });
  node.addEventListener('touchmove', function(ev){
    if (!timer) return;
    var t = ev.touches[0];
    if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10){ clearTimeout(timer); timer = null }
  }, { passive: true });
  node.addEventListener('touchend', function(ev){
    if (timer){ clearTimeout(timer); timer = null }
    if (fired){ fired = false; ev.preventDefault() }
  });
  node.addEventListener('touchcancel', function(){ if (timer){ clearTimeout(timer); timer = null } fired = false });
}
var _vvhTimer = null;
function syncViewport(): void{
  if (!isMobile()){ document.documentElement.style.removeProperty('--vvh'); return }
  var vv = window.visualViewport;
  if (!vv){ document.documentElement.style.setProperty('--vvh', window.innerHeight + 'px'); return }
  if (vv.scale && vv.scale !== 1) return;
  document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');
  clearTimeout(_vvhTimer);
  _vvhTimer = setTimeout(function(){ syncScrollBtnPos(); if (_stickBottom) scrollBottom() }, 120);
}
function api(p: string, opt?: { method?: string; body?: unknown }): Promise<any>{
  opt = opt || {};
  var o: { method: string; headers: Record<string, string>; body?: string } = { method: opt.method || 'GET', headers: {} };
  if (opt.body !== undefined){ o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body) }
  return fetch('/api' + p, o).then(function(r){
    if (!r.ok) return r.text().then(function(t){ throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 200)) });
    var ct = r.headers.get('content-type') || '';
    return ct.indexOf('json') >= 0 ? r.json() : r.text();
  });
}
function fmtTime(ms: number | string): string{ if (!ms) return ''; var d = new Date(ms), n = new Date();
  if (d.toDateString() === n.toDateString()) return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
  return (d.getMonth()+1)+'-'+d.getDate();
}
/* task71 S2a：休息起始时刻显示为 HH:MM（since 兼容毫秒/ISO 字符串） */
function fmtHM(v: number | string): string{ if (!v) return ''; var d = new Date(v); if (isNaN(d.getTime())) return ''; return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2) }
function baseName(p: string | null | undefined): string{ if (!p) return 'global'; var parts = String(p).split(/[\\/]/).filter(Boolean); return parts[parts.length-1] || 'global' }
function findProject(name: string): string | null{
  for (var i = 0; i < S.projects.length; i++){ if (S.projects[i].name === name) return S.projects[i].path }
  for (var j = 0; j < S.imports.length; j++){ if (S.imports[j].name === name) return S.imports[j].path }
  return null;
}
/* task243（主人 2026-11-12：「明明我是在 dag aichat 创建，居然在 little dj 里面创建」）：
   默认项目 = **当前会话所属项目**；没有当前会话就取第一个「左栏看得见」的项目。
   旧实现硬优先「日常」——那是被 HIDDEN_PROJECT_PATHS 藏起来的草稿项目，
   「新建对话」弹窗默认选中它，一点创建就把会话建到了左栏看不见的地方（用户以为“跑到别的项目去了”）。 */
function defaultProjectName(): string{
  var cur = (S.current && S.current.directory) ? String(S.current.directory) : '';
  var pool = S.projects.concat(S.imports).filter(function(p){ return p && p.name });
  if (cur){
    var hit = pool.filter(function(p){ return samePath(p.path, cur) })[0];
    if (hit) return hit.name;
  }
  var vis = pool.filter(function(p){ return !_projRowHidden(p) })[0];
  return vis ? vis.name : (pool[0] ? pool[0].name : '');
}
function projConvs(path: string, name: string){
  return S.sessions.filter(function(s){ return s.directory === path || baseName(s.directory) === name });
}
function saveProjOpen(): void{
  try { localStorage.setItem('littledj.projOpen', JSON.stringify(S.projOpen)) } catch(e){}
}
/* task172：聚焦视图非当前项目展开态保存（与 projOpen 同构） */
function saveFocusProjOpen(): void{
  try { localStorage.setItem('littledj.focusProjOpen', JSON.stringify(S.focusProjOpen)) } catch(e){}
}
function projOpenKeyForDir(dir: string): string{
  var i;
  for (i = 0; i < S.projects.length; i++){
    if (samePath(S.projects[i].path, dir)) return S.projects[i].name;
  }
  for (i = 0; i < S.imports.length; i++){
    if (samePath(S.imports[i].path, dir)) return 'i:' + S.imports[i].name;
  }
  return '';
}
function toggleProjOpen(key: string): void{
  S.projOpen[key] = !S.projOpen[key];
  saveProjOpen();
  /* task141 御史 P1-1：切换/折叠别的项目时自动保存退出排序模式（防 S.sortProj 跨项目残留=「无完成按钮可退」死角） */
  if (S.sortProj && S.sortProj !== key) exitSortMode(S.sortProj);
  renderSidebar();
}


window._panelHist=_panelHist; window._vvhTimer=_vvhTimer; window.isMobile=isMobile; window.syncInputPh=syncInputPh; window.syncPanelMask=syncPanelMask; window.pushPanelHist=pushPanelHist; window.closePanels=closePanels; window.bindItemMenu=bindItemMenu; window.syncViewport=syncViewport; window.api=api; window.fmtTime=fmtTime; window.fmtHM=fmtHM; window.baseName=baseName; window.findProject=findProject; window.defaultProjectName=defaultProjectName; window.projConvs=projConvs; window.saveProjOpen=saveProjOpen; window.saveFocusProjOpen=saveFocusProjOpen; window.projOpenKeyForDir=projOpenKeyForDir; window.toggleProjOpen=toggleProjOpen;

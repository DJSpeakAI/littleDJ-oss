/* @module attachments @order 15 @职责 图片/文本文件附件 @提供 TEXT_FILE_EXT TEXT_FILE_MAX TEXT_FILE_MAX_N renderAtts addImageFile isTextFile fmtKB addTextFile hasFilesTypes handleDropFiles qAutoGrow bindImageInput @依赖 - @依赖运行期 S toast draftTrim @DOM契约 - @严格模式 是 @全局占用 TEXT_FILE_EXT TEXT_FILE_MAX TEXT_FILE_MAX_N renderAtts addImageFile isTextFile fmtKB addTextFile hasFilesTypes handleDropFiles qAutoGrow bindImageInput @源行 ui/index.html L4104-L4301 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 图片附件 ---------- */
function renderAtts(): void{
  var row = $('#attachRow'); row.replaceChildren();
  /* task324：有待机附件 → body.has-attach，语音待机模式下缩略行不再隐藏（选完图立即上屏，主人 2026-11-15） */
  if (document.body) document.body.classList.toggle('has-attach', (S.atts.length + (S.files || []).length) > 0);
  S.atts.forEach(function(a, i){
    var t = el('div', 'thumb');
    var img = document.createElement('img'); img.src = a.url; img.alt = a.name;
    img.title = '点击放大';
    img.onclick = function(){ openImageViewer(a.url, a.name) };
    t.appendChild(img);
    var x = el('button', null, '✕'); x.title = '移除';
    x.onclick = function(){ S.atts.splice(i, 1); renderAtts() };
    t.appendChild(x);
    row.appendChild(t);
  });
  /* task178：文本文件 chip（与图片同区，发送时内容并入消息正文） */
  (S.files || []).forEach(function(f, i){
    var t = el('div', 'file-chip');
    t.appendChild(el('span', 'fc-ico', '📄'));
    var nm = el('span', 'fc-name', f.name || 'file'); nm.title = f.name || '';
    t.appendChild(nm);
    t.appendChild(el('span', 'fc-size', fmtKB(f.size)));
    var x = el('button', null, '✕'); x.title = '移除';
    x.onclick = function(){ S.files.splice(i, 1); renderAtts() };
    t.appendChild(x);
    row.appendChild(t);
  });
}
function addImageFile(file: File): void{
  if (!file || file.type.indexOf('image/') !== 0) return;
  if (file.size > 8 * 1024 * 1024){ toast('图片超过 8MB', true); return }
  var _sid = (S.current && S.current.id) ? String(S.current.id) : ''; /* task391：异步读取归属快照（发起时会话） */
  var r = new FileReader();
  r.onload = function(){
    var att = { name: file.name || ('pasted-' + Date.now() + '.png'), mime: file.type, url: String(r.result) };
    /* task391（方案审 v2 P1-4）：读图期间切走了——写回发起会话的草稿槽，不串进当前会话 */
    if (_sid && (!S.current || String(S.current.id) !== _sid)){
      try {
        var d = S.drafts[_sid] || { text: '', atts: [], files: [], at: Date.now() };
        d.atts = (d.atts || []).concat([att]); d.at = Date.now();
        S.drafts[_sid] = d; draftTrim();
        toast('图片已存回原对话草稿', false, 2600);
      } catch(e){}
      return;
    }
    S.atts.push(att);
    renderAtts();
  };
  r.readAsDataURL(file);
}
/* ---------- 文本文件附件（task178：拖拽加载 md/txt 等） ---------- */
var TEXT_FILE_EXT = ['.md', '.markdown', '.txt', '.log', '.json', '.jsonc', '.js', '.ts', '.py', '.sh', '.css', '.html', '.htm', '.csv', '.tsv', '.yml', '.yaml', '.toml', '.ini', '.conf', '.xml', '.sql', '.c', '.h', '.cpp', '.java', '.go', '.rs', '.env'];
var TEXT_FILE_MAX = 256 * 1024; /* 单文件 256KB（≈10 万级字符，控 token；方案审 P1-4） */
var TEXT_FILE_MAX_N = 5;        /* 单次最多 5 个文本附件 */
function isTextFile(file: File): boolean{
  if (!file) return false;
  var mime = String(file.type || '');
  if (mime.indexOf('text/') === 0) return true;
  var name = String(file.name || '').toLowerCase();
  var dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return TEXT_FILE_EXT.indexOf(name.slice(dot)) >= 0;
}
function fmtKB(n: number): string{
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1048576) return Math.round(n / 1024) + ' KB';
  return (Math.round(n / 1048576 * 10) / 10) + ' MB';
}
function addTextFile(file: File): void{
  if (!file) return;
  if ((S.files || []).length >= TEXT_FILE_MAX_N){ toast('一次最多附加 ' + TEXT_FILE_MAX_N + ' 个文本文件', true); return }
  if (file.size > TEXT_FILE_MAX){ toast('文件超过 256KB，暂不支持：' + (file.name || ''), true); return }
  /* 同步占位再异步填充——防连续拖入多文件时「同步检查通过、异步 push 超限」的竞态（自测 ③3 抓出） */
  var rec = { name: file.name || ('file-' + Date.now() + '.txt'), size: file.size || 0, mime: file.type || 'text/plain', text: '' };
  (S.files || (S.files = [])).push(rec);
  renderAtts();
  var r = new FileReader();
  r.onload = function(){ rec.text = String(r.result || ''); renderAtts() };
  r.onerror = function(){
    var i = (S.files || []).indexOf(rec);
    if (i >= 0) S.files.splice(i, 1);
    renderAtts();
    toast('读取文件失败：' + (file.name || ''), true);
  };
  r.readAsText(file);
}
function hasFilesTypes(t: any): boolean{
  if (!t) return false;
  try {
    return Array.prototype.indexOf.call(t, 'Files') >= 0 || (typeof t.contains === 'function' && t.contains('Files'));
  } catch(e){ return false }
}
function handleDropFiles(fs: FileList | File[]): void{
  if (!fs || !fs.length) return;
  if (!S.current){ toast('请先打开或新建一个对话', true); return }
  for (var i = 0; i < fs.length; i++){
    var f = fs[i];
    if (!f) continue;
    if (f.type && f.type.indexOf('image/') === 0) addImageFile(f);
    else if (isTextFile(f)) addTextFile(f);
    else toast('暂只支持文本类文件与图片：' + (f.name || ''), true);
  }
}
function qAutoGrow(el: any): void{
  if (!el || !el.style) return;
  el.style.height = 'auto';
  var h = Math.min(el.scrollHeight || 38, 140);
  el.style.height = Math.max(h, 38) + 'px';
}
/* task327（主人 2026-11-15 定版「多此一举」）：附件三瓷砖面板退役——pickImages/#fileInput、
   #camInput、closeAttachPanel/bindAttachCards 整链移除；点 ＋ 直接弹 #filePickInput（无 accept，
   系统面板内含相册/拍照/文件）。恢复路径见任务牌 task327。 */
function bindImageInput(): void{
  /* task318：＋ 单入口（原三瓷砖的 filePickInput 接线搬进来，卡片层退役） */
  $('#filePickInput').addEventListener('change', function(e){
    var fs = e.target.files || [];
    if (fs.length) handleDropFiles(fs); /* 任意类型：图片走 addImageFile，文本走 task178 链 */
    e.target.value = '';
  });
  var onPaste = function(e){
    var cd = e.clipboardData; if (!cd) return;
    var items = cd.items || [], got = false;
    for (var i = 0; i < items.length; i++){
      if (items[i].type && items[i].type.indexOf('image/') === 0){
        addImageFile(items[i].getAsFile()); got = true;
      }
    }
    if (got) e.preventDefault();
  };
  $('#input').addEventListener('paste', onPaste);
  document.addEventListener('paste', function(e){
    var ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
    onPaste(e);
  });
  var inner = document.querySelector('.composer-inner');
  inner.addEventListener('dragover', function(e){ e.preventDefault() });
  inner.addEventListener('drop', function(e: DragEvent){
    if (!e.dataTransfer) return;
    var fs = e.dataTransfer.files || [];
    if (fs.length){ handleDropFiles(fs); e.preventDefault() } /* task178：统一入口（图片+文本）；P2-B 保留 preventDefault 防 document 级重复处理 */
  });
  /* task327：#fileInput（accept image/*）随三瓷砖退役——图片也统一走 #filePickInput/handleDropFiles */
  /* task178：全页拖拽加载——冒泡相监听（P2-A：捕获相会让下方 preventDefault 判据失效→双重添加）；
     #dropMask 已 pointer-events:none，拖拽事件穿透到页面元素 */
  var dm = document.getElementById('dropMask');
  var dmDepth = 0; /* P2-C：dragenter/dragleave 成对计数，防子元素抖动误隐藏 */
  var dmTimer = 0; /* 御史产出审 P2-③：拖拽取消（Esc 等）可能不触发 dragleave → 保活定时器兜底隐藏 */
  function dmKick(){
    if (dmTimer) clearTimeout(dmTimer);
    dmTimer = setTimeout(function(){ dmDepth = 0; if (dm) dm.classList.remove('on') }, 1500);
  }
  document.addEventListener('dragenter', function(e: DragEvent){
    if (!hasFilesTypes(e.dataTransfer && e.dataTransfer.types)) return;
    e.preventDefault(); dmDepth++;
    if (dm) dm.classList.add('on');
    dmKick();
  });
  document.addEventListener('dragover', function(e){
    if (!hasFilesTypes(e.dataTransfer && e.dataTransfer.types)) return;
    e.preventDefault(); /* 允许 drop + 阻止浏览器打开文件 */
    dmKick(); /* 悬停期间续期（dragover 约 350ms 一次） */
  });
  document.addEventListener('dragend', function(){ dmDepth = 0; if (dmTimer) clearTimeout(dmTimer); if (dm) dm.classList.remove('on') });
  document.addEventListener('dragleave', function(e){
    if (!hasFilesTypes(e.dataTransfer && e.dataTransfer.types)) return;
    dmDepth = Math.max(0, dmDepth - 1);
    if (!dmDepth && dm){ dm.classList.remove('on'); if (dmTimer) clearTimeout(dmTimer) }
  });
  document.addEventListener('drop', function(e){
    if (dm){ dm.classList.remove('on'); dmDepth = 0; if (dmTimer) clearTimeout(dmTimer) }
    if (e.defaultPrevented) return; /* 下层（composer/qcard）已处理 → 防双挂（方案审 P1-1） */
    if (!e.dataTransfer) return;
    var fs = e.dataTransfer.files || [];
    if (!fs.length) return;
    e.preventDefault();
    handleDropFiles(fs);
  });
}

window.TEXT_FILE_EXT=TEXT_FILE_EXT; window.TEXT_FILE_MAX=TEXT_FILE_MAX; window.TEXT_FILE_MAX_N=TEXT_FILE_MAX_N; window.renderAtts=renderAtts; window.addImageFile=addImageFile; window.isTextFile=isTextFile; window.fmtKB=fmtKB; window.addTextFile=addTextFile; window.hasFilesTypes=hasFilesTypes; window.handleDropFiles=handleDropFiles; window.qAutoGrow=qAutoGrow; window.bindImageInput=bindImageInput;

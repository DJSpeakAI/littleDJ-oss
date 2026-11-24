/* @module imgviewer @order 3 @职责 全屏看图(task267) @提供 IV ivShow openImageViewer closeImageViewer ivGo @依赖 $ @依赖运行期 S @DOM契约 #imgViewer #imgViewerImg #ivCount #ivPrev #ivNext #ivClose #ivSave @源行 ui/index.html.bak-p1 L8316-8346 @严格模式 是 @全局占用 IV ivShow openImageViewer closeImageViewer ivGo @测试锚点 selftest-load-ui ORDER@3；PLAN-v2 §7-B+ @被调用 消息图点击/附件缩略图/ivPrev ivNext ivClose/ESC */
'use strict';
/* ---------- 图片查看器（task267 全屏版，对齐 DAG AI Chat：黑底/左右切换/单击关/保存/滑动切换） ---------- */
var IV: any = { list: [], idx: 0 };
function ivShow(){
  var im = $('#imgViewerImg');
  if (!IV.list.length){ closeImageViewer(); return }
  IV.idx = Math.max(0, Math.min(IV.idx, IV.list.length - 1));
  im.src = IV.list[IV.idx].url;
  im.alt = IV.list[IV.idx].name || '';
  var c = $('#ivCount'), p = $('#ivPrev'), n = $('#ivNext');
  if (c) c.textContent = IV.list.length > 1 ? (IV.idx + 1) + ' / ' + IV.list.length : '';
  if (p) p.hidden = IV.list.length < 2;
  if (n) n.hidden = IV.list.length < 2;
}
function openImageViewer(src?, alt?){
  var v = $('#imgViewer');
  if (!v || !src) return;
  /* 组列表：图片在当前附件列表里 → 整组可切换；否则单图模式 */
  var list = (S.atts && S.atts.length) ? S.atts : null;
  var idx = list ? list.findIndex(function(a){ return a.url === src }) : -1;
  if (idx >= 0){ IV.list = list.slice(); IV.idx = idx }
  else { IV.list = [{ url: src, name: alt }]; IV.idx = 0 }
  ivShow();
  v.hidden = false;
}
function closeImageViewer(){
  var v = $('#imgViewer'), im = $('#imgViewerImg');
  if (v) v.hidden = true;
  if (im) im.removeAttribute('src');
  IV.list = []; IV.idx = 0;
}
function ivGo(d?){ if (!IV.list.length) return; IV.idx += d; ivShow() }
window.IV=IV; window.ivShow=ivShow; window.openImageViewer=openImageViewer; window.closeImageViewer=closeImageViewer; window.ivGo=ivGo;

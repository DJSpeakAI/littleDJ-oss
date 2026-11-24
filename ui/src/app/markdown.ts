/* @module markdown @order 2 @职责 Markdown→HTML @提供 md mdInline inline @依赖 esc @依赖运行期 - @DOM契约 - @源行 ui/index.html.bak-p1 L1517-1569 @严格模式 是 @全局占用 md mdInline inline @测试锚点 selftest-load-ui ORDER@2；PLAN-v2 §7-B @被调用 消息/备注/卡片渲染（md×7） */
'use strict';
/* ---------- markdown-lite ---------- */
function md(src: unknown): string{
  var text = String(src || '');
  var blocks = text.split(/```/), out = '', i;
  for (i = 0; i < blocks.length; i++){
    if (i % 2 === 1){
      var body = blocks[i], nl = body.indexOf('\n');
      if (nl >= 0 && body.slice(0, nl).length < 24 && body.slice(0, nl).trim()) body = body.slice(nl + 1);
      out += '<pre><button class="copy" data-copy>复制</button><code>' + esc(body.replace(/\n$/, '')) + '</code></pre>';
    } else {
      out += mdInline(blocks[i]);
    }
  }
  return out;
}
function mdInline(seg: string): string{
  var lines = seg.split('\n'), html = '', list = null, para = [];
  function flushPara(){ if (para.length){ html += '<p>' + para.join('<br>') + '</p>'; para = [] } }
  function closeList(){ if (list){ html += '</' + list + '>'; list = null } }
  for (var i = 0; i < lines.length; i++){
    var raw = lines[i], line = esc(raw);
    if (/^\s*$/.test(raw)){ flushPara(); closeList(); continue }
    if (/^###\s+/.test(raw)){ flushPara(); closeList(); html += '<h3>' + inline(raw.replace(/^###\s+/, '')) + '</h3>'; continue }
    if (/^##\s+/.test(raw)){ flushPara(); closeList(); html += '<h2>' + inline(raw.replace(/^##\s+/, '')) + '</h2>'; continue }
    if (/^#\s+/.test(raw)){ flushPara(); closeList(); html += '<h1>' + inline(raw.replace(/^#\s+/, '')) + '</h1>'; continue }
    if (/^\s*([-*+])\s+/.test(raw)){
      flushPara();
      if (list !== 'ul'){ closeList(); html += '<ul>'; list = 'ul' }
      html += '<li>' + inline(raw.replace(/^\s*[-*+]\s+/, '')) + '</li>'; continue
    }
    if (/^\s*\d+\.\s+/.test(raw)){
      flushPara();
      if (list !== 'ol'){ closeList(); html += '<ol>'; list = 'ol' }
      html += '<li>' + inline(raw.replace(/^\s*\d+\.\s+/, '')) + '</li>'; continue
    }
    if (/^\s*&gt;\s?/.test(line)){
      flushPara(); closeList();
      html += '<blockquote>' + inline(raw.replace(/^\s*>\s?/, '')) + '</blockquote>'; continue
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)){ flushPara(); closeList(); html += '<hr>'; continue }
    closeList();
    para.push(inline(raw));
  }
  flushPara(); closeList();
  return html;
}
function inline(s: string): string{
  var t = esc(s);
  t = t.replace(/`([^`]+)`/g, function(_, c){ return '<code>' + c + '</code>' });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}
window.md=md; window.mdInline=mdInline; window.inline=inline;

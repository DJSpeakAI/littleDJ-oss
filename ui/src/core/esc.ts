/* @module esc @order 1 @职责 HTML转义 @提供 esc @依赖 - @依赖运行期 - @DOM契约 - @源行 ui/index.html.bak-p1 L1452 @严格模式 是 @全局占用 esc @测试锚点 selftest-load-ui ORDER@1；PLAN-v2 §7-A+/B(XSS) @被调用 主脚本50处裸调用 + markdown */
'use strict';
function esc(s: unknown): string{ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] }) }
window.esc=esc;

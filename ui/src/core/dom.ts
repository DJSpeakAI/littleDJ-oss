/* @module dom @order 0 @职责 DOM选择/创建+新API兜底(task387) @提供 $ $$ el structuredClone @依赖 - @依赖运行期 - @DOM契约 - @源行 ui/index.html.bak-p1 L1391-1394 @严格模式 是 @全局占用 $ $$ el structuredClone @测试锚点 selftest-load-ui ORDER@0；selftest-web-modern E2；PLAN-v2 §7-A+/C @被调用 主脚本全文（$×25、el×650） */
'use strict';
/* task387：ES2022/2023 新 API 老内核兜底（modern-web-guidance 迁移配套；退役条件=最低支持设备 ArkWeb ≥ Chromium 110，届时可删）。
   defineProperty 不可枚举对齐原生语义（方案审 P2-2：裸赋值会让 for...in 数组多出成员）。
   structuredClone 兜底仅等价「JSON 可序列化对象」：Date→字符串/undefined 丢键/Map/Set/循环引用/BigInt 会变或抛（方案审 P2-1，
   当前 3 处调用全是纯数据安全；新增调用点若含上述类型须先改真 polyfill）。 */
if (!Array.prototype.toSorted) Object.defineProperty(Array.prototype, 'toSorted', { value: function(fn?: (a: any, b: any) => number){ return Array.prototype.slice.call(this).sort(fn) }, writable: true, configurable: true });
if (!Array.prototype.toReversed) Object.defineProperty(Array.prototype, 'toReversed', { value: function(){ return Array.prototype.slice.call(this).reverse() }, writable: true, configurable: true });
if (typeof structuredClone !== 'function') Object.defineProperty(window, 'structuredClone', { value: function(x: any){ return JSON.parse(JSON.stringify(x)) }, writable: true, configurable: true });
/* ---------- utils ---------- */
function $(s: string): any{ return document.querySelector(s) }
function $$(s: string){ return Array.prototype.slice.call(document.querySelectorAll(s)) }
function el(tag: string, cls?: string, text?: string): any{ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
window.$=$; window.$$=$$; window.el=el;

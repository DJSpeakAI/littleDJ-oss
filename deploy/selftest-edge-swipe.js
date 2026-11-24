/* task174 手机端左缘右滑唤出侧栏亲测工具（无需浏览器）：
   1) 抽取 UI 源的 edgeSwipeJudge 纯函数，跑热区/距离/方向边界用例；
   2) 静态断言手势接线：开启路径与 #btnMenu 同构、防误触护栏齐全。
   用法：node deploy/selftest-edge-swipe.js  （exit 0=PASS / 1=FAIL / 2=装载失败）
   task381：抽取源由「直读 ui/index.html」改为 selftest-load-ui 拼接串（ui/src/*.js 产物 + index.html
   内联）——edgeSwipeJudge/sideCloseJudge 已迁入 ui/src/app/views.ts（编译产物 views.js），直读 index.html
   恒 MISS（旧版 UI 口径）。接线断言的触摸/哨兵代码也可能分布各模块产物，拼接串=全集，一并兜住。 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { loadUiSource } = require('./selftest-load-ui.js');
const UI_DIR = process.env.UI_DIR || path.join(__dirname, '..', 'ui');
const html = loadUiSource(UI_DIR);
/* task381：拼接串只含 JS 模块产物+内联脚本——CSS/HTML 结构类断言另读 index.html 原文 */
const htmlRaw = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');

const m = html.match(/function edgeSwipeJudge\(startX, startY, dx, dy\)\{[\s\S]*?\n\}/);
if (!m) { console.log('FAIL 抽取失败：edgeSwipeJudge（旧版 UI 无此实现）'); process.exit(2) }
/* task175：侧栏左滑收起判定 */
const m2 = html.match(/function sideCloseJudge\(dx, dy\)\{[\s\S]*?\n\}/);
if (!m2) { console.log('FAIL 抽取失败：sideCloseJudge（旧版 UI 无此实现）'); process.exit(2) }
const ctx = { console: { log(){} } };
vm.createContext(ctx);
try { new vm.Script(m[0] + '\n' + m2[0]).runInContext(ctx) } catch (e) { console.log('FAIL 装载：' + e.message); process.exit(2) }

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; return }
  fail++; console.log('FAIL ' + name + '：got=' + got + ' want=' + want)
}

/* 判定函数边界用例：task176 热区 12–64px（≤12 系统死区交给哨兵兜底）/ 阈值 40px / 横向主导 */
const J = ctx.edgeSwipeJudge;
eq('常规右滑（热区内）', J(30, 300, 80, 10), true);
eq('系统死区 11 不触发（交给哨兵翻译）', J(11, 300, 80, 10), false);
eq('热区左界含 12', J(12, 300, 80, 10), true);
eq('热区右界含 64', J(64, 300, 80, 10), true);
eq('热区外 65 不触发', J(65, 300, 80, 10), false);
eq('顶部按钮区 43 不触发', J(30, 43, 80, 10), false);
eq('顶部区下界 44 触发', J(30, 44, 80, 10), true);
eq('距离不足 39', J(30, 300, 39, 5), false);
eq('阈值 40 且横向主导', J(30, 300, 40, 20), true);
eq('竖向成分过大（80≤50×1.6）', J(30, 300, 80, 50), false);
eq('横向刚好压线 81>80', J(30, 300, 81, 50), true);
eq('左滑不触发', J(30, 300, -60, 5), false);

/* task175：侧栏左滑收起判定边界 */
const C = ctx.sideCloseJudge;
eq('侧栏左滑常规', C(-70, 10), true);
eq('左滑距离不足 -45', C(-45, 5), false);
eq('左滑阈值 -46 且横向主导', C(-46, 20), true);
eq('竖向成分过大', C(-80, 60), false);
eq('右滑不触发', C(60, 5), false);

/* 静态断言：手势接线与护栏 */
function has(s, name) {
  if (html.indexOf(s) < 0) { fail++; console.log('FAIL 缺少：' + name) } else pass++
}
function hasRaw(s, name) {
  if (htmlRaw.indexOf(s) < 0) { fail++; console.log('FAIL 缺少：' + name) } else pass++
}
has("document.addEventListener('touchstart'", 'touchstart 监听');
has("document.addEventListener('touchmove'", 'touchmove 监听');
has("}, { passive: false });\n})();", 'touchmove 非 passive（可 preventDefault）');
has("document.body.classList.contains('lock')) return", '已有面板开着不抢手势');
has("e.target.closest('button,a,input,textarea,select,[contenteditable=\"true\"],pre,code')) return", '交互元素/代码块起点不抢');
has("if (isMobile()) $('#right').classList.remove('open');\n        sb.classList.add('open');\n        pushPanelHist();\n        syncPanelMask();", '开启路径与 #btnMenu 同构（关右栏+open+历史栈+遮罩）');
has('if (!isMobile() || !e.touches || e.touches.length !== 1) return', '仅手机端+单指');
has('if (dx < -12 || dy > 26){ reset() }', '反向/变竖滑放弃跟踪');

/* task175：全屏侧栏 + 哨兵翻译 + 收起护栏（CSS/HTML 结构类断言读 index.html 原文，task381） */
hasRaw('width:100vw;max-width:100%', '侧栏全屏宽 CSS（max-width:100% 兜滚动条溢出，task177 P2-5）');
hasRaw('<button id="btnCloseSide" class="iconbtn" aria-label="收起侧栏" title="收起侧栏">✕</button>', 'brand 行 ✕ 收起按钮');
has("#btnCloseSide').onclick = function(){ closePanels(true) }", '✕ 走 closePanels(true)');
has("if (S.sortProj) return; /* task141 排序模式中，手势让位 */", '排序模式中侧栏手势让位');
has('pushState({ djSentinel: 1 }', '返回哨兵垫条存在');
has("if (!POP_TAB && isMobile() && !(history.state && history.state.djSentinel === 1)){", 'boot 垫哨兵幂等闸（task206 起带 !POP_TAB 前缀）');
has('if (now - _selfBackAt < 150) return', 'closePanels 自触发 back 抑制（150ms，防关了又开）');
has('if (now - _backTransAt < 450){ _backTransAt = 0; _exitUntil = now + 5000; return }', '快速二次逃生门 + 5s 粘性窗（task177 P1-2：慢滑也能退出）');
has('if (now < _exitUntil) return;', '逃生粘性窗放行分支（task177 P1-2）');
has("_selfBackAt = Date.now(); _backTransAt = 0; _exitUntil = 0; try { history.back() }", '程序性关面板清零逃生门计数（task177 P1-1：防误吞后下一次滑退出页面）');
has("sb.addEventListener('touchmove'", '侧栏 touchmove 监听（左滑收起）');

console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + ' pass / ' + fail + ' fail');
process.exit(fail ? 1 : 0);

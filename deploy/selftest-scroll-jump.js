/* task356 自测：↑ 回跳「最近一次提问」按钮（PC/手机同款）。
   需求（主人 2026-11-16）：AI 叭叭叭回几十上百行后，忘了自己最近问的是什么；
   点聊天区底部 ↑ 即跳回最近一条用户提问。与既有 ↓ 回底部按钮并排。
   覆盖：A 双向显隐 4 例 + B 回跳滚动 4 例 + C 双按钮定位 1 例 + D 静态锚 10 条 + E 红对照 1 组。
   用法：node deploy/selftest-scroll-jump.js   （EXIT=0 全绿） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const QSRC = fs.readFileSync(path.join(ROOT, 'ui/src/chat/queue.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'ui/index.html'), 'utf8');
const BOOT = fs.readFileSync(path.join(ROOT, 'ui/src/app/boot.js'), 'utf8');
const POPOUT = fs.readFileSync(path.join(ROOT, 'ui/src/pricing/popout.js'), 'utf8');
let pass = 0, fail = 0;
function t(name, cond, detail){
  if (cond){ pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

/* ---------- 抽取 queue.js 滚动按钮函数块（syncScrollBtn..scrollBottom 之前） ---------- */
function extractBlock(src){
  const start = src.indexOf('function syncScrollBtn(');
  const end = src.indexOf('function scrollBottom(');
  if (start < 0 || end <= start) throw new Error('未能定位 syncScrollBtn..scrollBottom 函数块');
  return src.slice(start, end);
}
const BLOCK = extractBlock(QSRC);

function mkEl(opts){
  const el = {
    _cls: {}, style: {},
    classList: {
      toggle: function(c, on){ el._cls[c] = !!on },
      add: function(c){ el._cls[c] = true },
      remove: function(c){ el._cls[c] = false }
    },
    getBoundingClientRect: function(){ return { top: opts.top || 0, left: 0, width: 0, height: 0 } },
    scrollTo: function(arg){ el._scrollTo = arg },
    offsetHeight: opts.offsetHeight || 0
  };
  return el;
}

/* state = { scrollTop, scrollHeight, clientHeight, msgTop, userTop|hasUser, composerH, scrollBehavior } */
function run(state, blockOverride){
  const down = mkEl({ top: 0 });
  const up = mkEl({ top: 0 });
  const box = mkEl({ top: state.msgTop || 0 });
  box.scrollTop = state.scrollTop || 0;
  box.scrollHeight = state.scrollHeight || 600;
  box.clientHeight = state.clientHeight || 600;
  const user = state.hasUser === false ? null : mkEl({ top: state.userTop == null ? 0 : state.userTop });
  box.querySelectorAll = function(sel){ return (sel === '.msg.user' && user) ? [user] : [] };
  const composer = mkEl({ offsetHeight: state.composerH || 0 });
  const els = { '#messages': box, '#btnScrollDown': down, '#btnScrollUp': up, '#composer': composer };
  const sandbox = {
    console: { log(){}, warn(){}, error(){} },
    document: { documentElement: { style: state.scrollBehavior === false ? {} : { scrollBehavior: 'smooth' } } },
    $: function(sel){ return els[sel] || null }
  };
  vm.createContext(sandbox);
  vm.runInContext((blockOverride || BLOCK) +
    '\nthis.__api = { syncScrollBtn: syncScrollBtn, lastUserMsgEl: lastUserMsgEl, scrollToLastAsk: scrollToLastAsk, syncScrollBtnPos: syncScrollBtnPos };',
    sandbox, { filename: 'scroll-jump-block.js' });
  return { api: sandbox.__api, sandbox: sandbox, down: down, up: up, box: box };
}

console.log('== A. syncScrollBtn 双向显隐 ==');
/* A1 贴底：↓ 隐藏；最近提问在视口内 → ↑ 隐藏 */
(function(){
  const r = run({ scrollTop: 1000, scrollHeight: 1600, clientHeight: 600, msgTop: 0, userTop: 200 });
  r.api.syncScrollBtn();
  t('A1 贴底双隐藏', r.down._cls.show === false && r.up._cls.show === false,
    JSON.stringify({ down: r.down._cls, up: r.up._cls }));
})();
/* A2 中部且最近提问已滚出上沿：↓ 显示；↑ 显示 */
(function(){
  const r = run({ scrollTop: 500, scrollHeight: 1600, clientHeight: 600, msgTop: 0, userTop: -50 });
  r.api.syncScrollBtn();
  t('A2 中部↑↓同显', r.down._cls.show === true && r.up._cls.show === true,
    JSON.stringify({ down: r.down._cls, up: r.up._cls }));
})();
/* A3 最近提问就在视口内（略露 4px）：↑ 不显示（阈值 -8） */
(function(){
  const r = run({ scrollTop: 500, scrollHeight: 1600, clientHeight: 600, msgTop: 0, userTop: 4 });
  r.api.syncScrollBtn();
  t('A3 提问可见时不显↑', r.up._cls.show === false, JSON.stringify(r.up._cls));
})();
/* A4 空会话无 .msg.user：↑ 不显示 */
(function(){
  const r = run({ scrollTop: 0, scrollHeight: 600, clientHeight: 600, hasUser: false });
  r.api.syncScrollBtn();
  t('A4 无提问不显↑', r.up._cls.show === false, JSON.stringify(r.up._cls));
})();

console.log('== B. scrollToLastAsk 回跳 ==');
/* B1 回跳目标 = 当前 + 用户消息顶部差值 - 10；平滑滚动；_stickBottom 置 false */
(function(){
  const r = run({ scrollTop: 500, scrollHeight: 1600, clientHeight: 600, msgTop: 0, userTop: -150 });
  r.api.scrollToLastAsk();
  t('B1 目标 top=340 平滑滚动', r.box._scrollTo && r.box._scrollTo.top === 340 && r.box._scrollTo.behavior === 'smooth',
    JSON.stringify(r.box._scrollTo));
  t('B2 _stickBottom=false', r.sandbox._stickBottom === false, String(r.sandbox._stickBottom));
})();
/* B3 顶部越界 clamp 到 0 */
(function(){
  const r = run({ scrollTop: 20, scrollHeight: 1600, clientHeight: 600, msgTop: 0, userTop: -100 });
  r.api.scrollToLastAsk();
  t('B3 clamp 不为负', r.box._scrollTo && r.box._scrollTo.top === 0, JSON.stringify(r.box._scrollTo));
})();
/* B4 不支持 scrollBehavior 时降级直赋 scrollTop */
(function(){
  const r = run({ scrollTop: 500, scrollHeight: 1600, clientHeight: 600, msgTop: 0, userTop: -150, scrollBehavior: false });
  r.api.scrollToLastAsk();
  t('B4 降级直赋 scrollTop', r.box.scrollTop === 340 && !r.box._scrollTo, String(r.box.scrollTop));
})();
/* B5 无用户消息时零动作 */
(function(){
  const r = run({ scrollTop: 500, scrollHeight: 1600, clientHeight: 600, hasUser: false });
  r.api.scrollToLastAsk();
  t('B5 无提问零动作', !r.box._scrollTo && r.box.scrollTop === 500, String(r.box.scrollTop));
})();

console.log('== C. syncScrollBtnPos 双按钮同底线 ==');
(function(){
  const r = run({ composerH: 120 });
  r.api.syncScrollBtnPos();
  t('C1 双按钮 bottom 同步 134px', r.down.style.bottom === '134px' && r.up.style.bottom === '134px',
    JSON.stringify({ down: r.down.style.bottom, up: r.up.style.bottom }));
})();

console.log('== D. 静态锚 ==');
t('D1 index.html ↑ 按钮存在', /<button id="btnScrollUp" title="回到最近一次提问">↑<\/button>/.test(HTML));
t('D2 index.html ↓ 按钮保留', /<button id="btnScrollDown" title="回到底部">↓<\/button>/.test(HTML));
t('D3 桌面 CSS 并排（-62px）', HTML.indexOf('#btnScrollUp{margin-left:-62px}') >= 0);
t('D4 手机断点 CSS（-71px + 42px 组）', HTML.indexOf('#btnScrollUp{margin-left:-71px}') >= 0 && HTML.indexOf('#btnScrollDown,#btnScrollUp{width:42px;height:42px;bottom:113px}') >= 0);
t('D5 blur-off 含 ↑', HTML.indexOf('html.blur-off #btnScrollUp') >= 0);
t('D6 点击绑定 scrollToLastAsk', HTML.indexOf("$('#btnScrollUp').onclick = function(){ scrollToLastAsk() };") >= 0);
function verOf(s){
  const m = String(s).match(/personal agent · v([0-9.]+)/);
  return m ? m[1] : '';
}
t('D7 三处 verText 动态同步（当前 ' + verOf(HTML) + '）', !!verOf(HTML) && verOf(HTML) === verOf(BOOT) && verOf(BOOT) === verOf(POPOUT),
  verOf(HTML) + '/' + verOf(BOOT) + '/' + verOf(POPOUT));
t('D8 queue.js 契约头声明两函数', /@提供[^@]*lastUserMsgEl scrollToLastAsk/.test(QSRC) && /@全局占用[^@]*lastUserMsgEl scrollToLastAsk/.test(QSRC));
t('D9 L-076 防复发：滚动块零 scrollIntoView 调用', BLOCK.indexOf('.scrollIntoView(') < 0);
(function () {
  const v = require('./contract').htmlScriptVersionMap(path.join(ROOT, 'ui'))['src/chat/queue.js'];
  t('D10 缓存破坏 queue.js（当前 ' + (v || '缺失') + '，动态口径 task371-M0#9）', /^p\d+$/.test(v || ''));
})();

console.log('== E. 红对照（旧版 syncScrollBtn 必须测红） ==');
(function(){
  /* 旧版实现：只控制 ↓，没有 ↑ 分支 */
  const oldFn = 'function syncScrollBtn(){\n' +
    '  var b = $(\'#messages\'), btn = $(\'#btnScrollDown\');\n' +
    '  if (!btn || !b) return;\n' +
    '  btn.classList.toggle(\'show\', b.scrollHeight - b.scrollTop - b.clientHeight > 80);\n' +
    '}\n';
  const red = BLOCK.replace(/function syncScrollBtn\(\)\{[\s\S]*?\n\}\nfunction lastUserMsgEl\(/, oldFn + 'function lastUserMsgEl(');
  if (red === BLOCK) { t('E1 红对照构造', false, '未能替换旧实现'); return; }
  const r = run({ scrollTop: 500, scrollHeight: 1600, clientHeight: 600, msgTop: 0, userTop: -50 }, red);
  r.api.syncScrollBtn();
  t('E1 旧实现中部不显示 ↑（红）', r.up._cls.show !== true, JSON.stringify(r.up._cls));
})();

console.log('---');
console.log(pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

/*
 * task311 自测：划词浮层改为「右键呼出」（桌面）/ 触摸端保留长按自动弹
 * 用法：node deploy/selftest-selmenu-rmb.js
 * 覆盖：①桌面鼠标划词不再自动弹 ②触摸选择仍自动弹（稳定判定后） ③右键落在选区框内接管并定位鼠标点
 *       ④右键点选区外保留系统菜单 ⑤右键默认行为折叠选区时用 mousedown 快照兜底 ⑥输入框/编辑器让给原生
 * 做法：从 ui/index.html 切出 onSelChange 与 task311 绑定段，在 vm 里用最小 stub 驱动真实源码。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const pathFn = require('path');

const ROOT = pathFn.resolve(__dirname, '..');
/* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本） */
const html = require('./selftest-load-ui').loadUiSource(pathFn.join(ROOT, 'ui'));

const selStart = html.indexOf('function onSelChange(){');
const selEnd = html.indexOf('function quoteShort(', selStart);
const bindStart = html.indexOf('/* ---------- task311：桌面右键呼出划词浮层');
const bindEnd = html.indexOf('function copyText(', bindStart);
/* 模块化后 task311 的 helper（selRangeRect/pointInSelRect）在 src/ask/desktop.js（bindStart..bindEnd），
   而事件绑定（mousedown 快照 + contextmenu 接管）随启动接线留在 index.html 内联脚本（loadUiSource 末尾）→ 追加提取该绑定段 */
const rmbStart = html.indexOf("document.addEventListener('mousedown', function(e){\n  if (e.button !== 2) return;");
const ctxAt = html.indexOf("document.addEventListener('contextmenu', function(e){", rmbStart);
const rmbEnd = ctxAt < 0 ? -1 : html.indexOf('}, true);', ctxAt) + 8;
if (selStart < 0 || selEnd <= selStart || bindStart < 0 || bindEnd <= bindStart || rmbStart < 0 || ctxAt < 0 || rmbEnd <= rmbStart) {
  console.log('RESULT: FAIL（未能从 ui/index.html 定位 onSelChange / task311 绑定段）');
  process.exit(1);
}
const code = html.slice(selStart, selEnd) + '\n' + html.slice(bindStart, bindEnd) + '\n' + html.slice(rmbStart, rmbEnd);

/* ---------- 最小 stub ---------- */
const listeners = {};
const timers = [];
const shownAt = [];
let showMenuCalls = 0;
let askOk = true;
let curSel = null;

const sandbox = {
  console,
  STABLE_MS: 300,
  _selText: '', _selStamp: 0, _selTimer: null, _touchSelAt: 0, _rmbSel: null,
  __askOk: true,
  window: { getSelection: function () { return curSel }, addEventListener: function () {}, removeEventListener: function () {} },
  $: function () { return null },
  document: {
    addEventListener: function (type, fn, opt) { (listeners[type] = listeners[type] || []).push(fn) },
    removeEventListener: function () {}
  },
  setTimeout: function (fn) { timers.push(fn); return timers.length },
  clearTimeout: function () {},
  askSelAllowed: function (sel) { return !!sandbox.__askOk && !!sel && !sel.__collapsed },
  selMenuOpen: function () { return false },
  closeSelMenu: function () { sandbox._selText = '' },
  showSelMenu: function () { showMenuCalls++ },
  showSelMenuAt: function (x, y) { shownAt.push([x, y]) },
  onSelDismiss: function () {},
  isTouchUI: function () { return false }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
/* 真正的页面在 task311 注释之前就绑定了 selectionchange（该行在提取段外），这里补一份 */
(listeners['selectionchange'] = listeners['selectionchange'] || []).push(vm.runInContext('onSelChange', sandbox));

function selObj(text, rect, collapsed) {
  return {
    rangeCount: 1,
    isCollapsed: !!collapsed,
    __collapsed: !!collapsed,
    anchorNode: {}, toString: function () { return text },
    getRangeAt: function () { return { getBoundingClientRect: function () { return rect } } }
  };
}
const RECT = { left: 100, top: 100, right: 200, bottom: 140 };
const results = [];
function check(name, cond, extra) { results.push({ name: name, ok: !!cond, extra: extra == null ? '' : String(extra) }) }
function fire(type, ev) {
  const fns = listeners[type] || [];
  for (let i = 0; i < fns.length; i++) fns[i](ev || {});
}
function rightDown() {
  fire('mousedown', { button: 2, clientX: 110, clientY: 110 });
}
function ctxEvent(x, y) {
  const ev = {
    clientX: x, clientY: y, defaultPrevented: false, stopped: false,
    preventDefault: function () { this.defaultPrevented = true },
    stopPropagation: function () { this.stopped = true }
  };
  return ev;
}
function reset() { timers.length = 0; shownAt.length = 0; showMenuCalls = 0; sandbox.__askOk = true; sandbox._touchSelAt = 0 }

/* ---------- ① 桌面鼠标划词：selectionchange 不自动弹 ---------- */
reset();
curSel = selObj('hello', RECT, false);
sandbox._touchSelAt = 0;
fire('selectionchange');
check('① 桌面鼠标划词不自动弹（不建稳定计时器）', timers.length === 0, 'timers=' + timers.length);
check('① 且未显示浮层', showMenuCalls === 0 && sandbox._selText === '');

/* ---------- ② 触摸选择：稳定判定后仍自动弹 ---------- */
reset();
curSel = selObj('hello', RECT, false);
sandbox._touchSelAt = Date.now();
fire('selectionchange');
check('② 触摸选择建稳定计时器', timers.length === 1, 'timers=' + timers.length);
if (timers.length) timers[0]();
check('② 计时到点后自动弹（触摸）', showMenuCalls === 1 && sandbox._selText === 'hello', 'calls=' + showMenuCalls);

/* ---------- ③ 右键落在选区框内：接管并定位鼠标点 ---------- */
reset();
curSel = selObj('hello', RECT, false);
rightDown();
let ev = ctxEvent(120, 118);
fire('contextmenu', ev);
check('③ 右键命中选区 → 拦截系统菜单', ev.defaultPrevented === true);
check('③ 浮层显示在鼠标点', shownAt.length === 1 && shownAt[0][0] === 120 && shownAt[0][1] === 118, JSON.stringify(shownAt));
check('③ 缓存选中文本供按钮使用', sandbox._selText === 'hello', sandbox._selText);

/* ---------- ④ 右键点选区外：保留系统菜单 ---------- */
reset();
curSel = selObj('hello', RECT, false);
rightDown();
ev = ctxEvent(600, 400);
fire('contextmenu', ev);
check('④ 右键点选区外不拦截', ev.defaultPrevented === false && shownAt.length === 0);

/* ---------- ⑤ 右键默认行为折叠选区：用 mousedown 快照兜底 ---------- */
reset();
curSel = selObj('hello', RECT, false);
rightDown();                    /* 快照 = hello / RECT */
curSel = selObj('', null, true); /* 浏览器折叠了选区 */
ev = ctxEvent(130, 120);
fire('contextmenu', ev);
check('⑤ 选区被折叠仍弹（快照兜底）', ev.defaultPrevented === true && shownAt.length === 1 && sandbox._selText === 'hello');

/* ---------- ⑥ 输入框/编辑器：让给原生菜单 ---------- */
reset();
curSel = selObj('hello', RECT, false);
sandbox.__askOk = false;
rightDown();
ev = ctxEvent(120, 118);
fire('contextmenu', ev);
check('⑥ 输入框/编辑器不接管右键', ev.defaultPrevented === false && shownAt.length === 0 && sandbox._rmbSel === null);

const fail = results.filter(function (r) { return !r.ok });
results.forEach(function (r) { console.log((r.ok ? 'PASS' : 'FAIL') + ' ' + r.name + (r.extra ? '  [' + r.extra + ']' : '')) });
console.log('----');
console.log('RESULT: ' + (results.length - fail.length) + ' pass / ' + fail.length + ' fail');
process.exit(fail.length ? 1 : 0);

#!/usr/bin/env node
/* task333 输入栏排版自测（发送键移到输入栏最左，对齐 DAG AI Chat 排版）
 *   ① composer-bar 首元素=#btnSend（发送在最左，左手拇指好点），#btnPlus 紧随其后
 *   ② #btnSend 在 composer-bar 内唯一（旧末尾位置零残留）
 *   ③ 待机语音条模式（body.holdmode）几何不变：工具行仍只显示 ＋（发送键隐藏）
 *   ④ 版本号三处同步（动态口径，L-063：禁写死版本字面量）
 *   ⑤ 点名红对照：旧顺序（发送在末尾）必须被判 FAIL
 * 退出码 0=全绿，1=有失败 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const ui = require('./selftest-load-ui').loadUiSource(path.join(root, 'ui'))
  + '\n' + fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (hint ? '  ← ' + hint : '')); }
}

/* 取 composer-bar 区块：块内只有 button/span/select，无嵌套 div，首个 </div> 即块尾 */
function barOf(src) {
  const m = String(src || '').match(/<div class="composer-bar">([\s\S]*?)<\/div>/);
  return m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
}
/* 纯判定：bar 内「发送第一、加号第二」且发送唯一 */
function sendFirst(bar) {
  const noSendLast = !/id="btnMic"[\s\S]*?id="btnSend"/.test(bar);
  const sendFirstPos = /^<button id="btnSend"[^>]*>[\s\S]*?<\/button>\s*<button id="btnPlus"/.test(bar);
  const once = (bar.match(/id="btnSend"/g) || []).length === 1;
  return noSendLast && sendFirstPos && once;
}

const bar = barOf(ui);
ok('① composer-bar 首元素=#btnSend 且 #btnPlus 紧随其后', sendFirst(bar), 'bar=' + bar.slice(0, 120));
ok('② composer-bar 内 #btnSend 唯一（旧末尾位置零残留）',
  (bar.match(/id="btnSend"/g) || []).length === 1);
ok('③ holdmode 待机态仍只显示 ＋（body.holdmode .composer-bar > :not(#btnPlus){display:none}）',
  /body\.holdmode \.composer-bar > :not\(#btnPlus\)\{display:none\}/.test(ui));
ok('④ task333 注释在位（防并列任务编号混淆）', /task333（主人 2026-11-16）：发送键移到输入栏最左/.test(ui));

/* ⑤ 点名红对照（L-108）：旧布局样本必须判 FAIL，防断言退化 */
const oldBar = '<button id="btnPlus" class="round" title="添加上下文">＋</button>'
  + '<span class="grow"></span><button id="btnMic" class="round" title="语音对话">🎙</button>'
  + '<button id="btnSend" class="send" title="发送">↑</button>';
ok('⑤ 红对照：旧顺序（发送在末尾）判 FAIL', sendFirst(oldBar) === false);
const newBar = '<button id="btnSend" class="send" title="发送">↑</button>'
  + '<button id="btnPlus" class="round" title="添加上下文">＋</button>'
  + '<span class="grow"></span><button id="btnMic" class="round" title="语音对话">🎙</button>';
ok('⑤ 绿对照：新顺序样本判 PASS', sendFirst(newBar) === true);

/* ⑥ 版本号三处同步（动态口径，L-063：禁写死版本字面量） */
(function(){
  const mm = ui.match(/personal agent · v[0-9.]+/g) || [];
  ok('⑥ verText 三处且唯一', mm.length === 3 && mm[0] === mm[1] && mm[1] === mm[2], 'got ' + mm.join(','));
})();

console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail === 0 ? 0 : 1);

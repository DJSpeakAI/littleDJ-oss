#!/usr/bin/env node
/* task395 产审 P2-4 自测：回答/任务模式
   覆盖：
   ① 静态锚点：/_answer 端点 / answerWatermark 优先级句 / promptInject 回答态独占（P0-1）/ 前端 answericon·缓存参数
   ② vm 纯函数：answerNormalize（坏档 fail-open=task、合法形状、source 白名单）
      + answerWatermark（answer 态含优先级声明与例外口径、task 态空串=零注入）
      + answerPartsHasWatermark（「【当前模式：回答」与「【当前模式：休息中」完整串互斥） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PROXY = path.join(ROOT, 'server', 'proxy.js');
const src = fs.readFileSync(PROXY, 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'ui', 'index.html'), 'utf8');

const out = { pass: 0, fail: 0, items: [] };
function ok(name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}

/* ---------- ① 静态锚点 ---------- */
ok('A1 /_answer 端点在位', src.indexOf("pn === '/_answer'") >= 0);
ok('A2 水印优先级声明（产审 P0-1）', src.indexOf('本模式优先于休息态/链路模式') >= 0);
ok('A3 例外口径=本轮正文具体执行指令（产审 P1-1）', src.indexOf('主人在本轮消息正文中明确下达具体执行指令') >= 0 && src.indexOf('仅询问做法、讨论方案不算') >= 0);
ok('A4 promptInject 回答态独占 rest（P0-1）', src.indexOf('(!answerOn && rest.on') >= 0);
ok('A5 promptInject 回答态独占 chain（P0-1）', src.indexOf("(!answerOn && chain.mode !== 'full'") >= 0);
ok('A5b answerOn 抑制只看 mode 不带 parts guard（复审 P2-6）', src.indexOf("const answerOn = answer.mode === 'answer'") >= 0 && src.indexOf('answerTxt = (answerOn && !answerPartsHasWatermark(parts))') >= 0);
ok('A6 answerRead fail-open=task', /answerRead[\s\S]{0,600}return answerDefault\(\)/.test(src));
ok('A7 UI 图标随态容器 answericon（P1-2）', HTML.indexOf('class="answericon"') >= 0);
ok('A8 renderAnswer 更新图标', fs.readFileSync(path.join(ROOT, 'ui', 'src', 'core', 'answer-mode.ts'), 'utf8').indexOf("b.querySelector('.answericon')") >= 0);
ok('A9 state.js 缓存参数 p7（P1-3）', HTML.indexOf('/src/core/state.js?v=p7') >= 0);
ok('A10 answer-mode.js 缓存参数 p2（P1-2）', HTML.indexOf('/src/core/answer-mode.js?v=p2') >= 0);

/* ---------- ② vm 纯函数 ---------- */
function grabFn(name) {
  const lines = src.split('\n');
  const start = lines.findIndex(function (l) { return l.indexOf('function ' + name + '(') === 0; });
  if (start < 0) return '';
  let depth = 0, began = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; began = true; }
      else if (ch === '}') depth--;
    }
    if (began && depth === 0 && /^}/.test(lines[i])) return lines.slice(start, i + 1).join('\n');
  }
  return '';
}
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext("const ANSWER_MODES = ['answer', 'task']; const ANSWER_WATERMARK = '【当前模式：回答';" + grabFn('answerDefault') + grabFn('answerNormalize') + grabFn('restPad') + grabFn('answerWatermark') + grabFn('answerPartsHasWatermark'), sandbox);

const norm = sandbox.answerNormalize;
ok('V1 坏档 null → fail-open task', norm(null).mode === 'task');
ok('V2 非法 mode → task', norm({ mode: 'hack' }).mode === 'task');
ok('V3 合法 answer 保留', norm({ mode: 'answer', since: 123, source: 'button' }).mode === 'answer');
ok('V4 source 白名单外归 null', norm({ mode: 'answer', source: 'evil' }).source === null);
ok('V5 since 非数归 null', norm({ mode: 'answer', since: 'abc' }).since === null);

const wm = sandbox.answerWatermark;
ok('V6 task 态零水印（省 token 同 chain full）', wm({ mode: 'task' }) === '' && wm(null) === '' && wm(undefined) === '');
const answerWm = wm({ mode: 'answer', since: 1795430739658, source: 'button' });
ok('V7 answer 水印含前缀与边界', answerWm.indexOf('【当前模式：回答（主人已选') === 0 && answerWm.indexOf('回答模式边界') > 0);
ok('V8 例外句在', answerWm.indexOf('修/改/跑/做/部署/执行/你直接做') > 0);
ok('V9 优先级句在（P0-1）', answerWm.indexOf('本模式优先于休息态/链路模式') > 0 && answerWm.indexOf('不构成本模式例外') > 0);

const has = sandbox.answerPartsHasWatermark;
ok('V10 检测串互斥：休息水印不误判为 answer', !has([{ type: 'text', text: '【当前模式：休息中（主人已授权）】\n休息态边界：…' }]));
ok('V11 answer 水印命中', has([{ type: 'text', text: '前文\n【当前模式：回答（主人已选）】…' }]));
ok('V12 非 text part 忽略', !has([{ type: 'image', text: '【当前模式：回答' }]) && !has('not-array'));

/* ---------- 汇总 ---------- */
console.log(out.items.map(function (it) { return (it.ok ? 'PASS ' : 'FAIL ') + it.name + (it.ok ? '' : '  → ' + it.detail); }).join('\n'));
console.log('RESULT: ' + (out.fail ? 'FAIL' : 'PASS') + '（' + out.pass + ' PASS / ' + out.fail + ' FAIL）');
process.exit(out.fail ? 1 : 0);

#!/usr/bin/env node
/* task218 自测：设置弹窗崩溃修复 + 尺寸自适应/双向滚动/可拖拽 静态断言 + 红对照
   用法：node deploy/selftest-settings-modal.js [--json]
   覆盖：①入口显式零参包装（P0 根因：禁裸引用） ②openSettings 类型防御 ③renderSettings 归一化
        ④settings 类真挂载（防假绿：其它 wide 挂载点计数=2（task251 后仅剩定时任务两页）） ⑤手柄 HTML 默认 hidden
        ⑥拖拽监听 init 一次性三连 + MR_DRAG 守卫 ⑦尺寸夹紧上下限 ⑧记忆键唯一（无 settingsWinFit）
        ⑨.modal.settings 定高 760×720 ⑩.settings-body min-height:0 + 双向 overflow
        ⑪closeModal 清理 settings 类与 inline 尺寸 ⑫窄屏手柄隐藏
        ⑬带参入口包装守卫（裸引用函数签名必须无参） ⑭verText 三处一致 ⑮语法
   纯静态（前端为主，零后端改动），红对照用源码替换模拟 */
'use strict';
const fs = require('fs');
const path = require('path');

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}

/* 模块化后源码锚点走 loadUiSource（按 @order 拼接全部模块+内联脚本）+ index.html 原文（HTML 骨架/CSS/verText 锚点仍在这）；
   rawHtml 仅保留给 <script> 标签扫描（语法检查）用 */
const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
const html = require('./selftest-load-ui').loadUiSource(path.join(__dirname, '..', 'ui')) + '\n' + rawHtml;
const osIdx = html.indexOf('function openSettings(vw){');
const osBody = osIdx < 0 ? '' : html.slice(osIdx, osIdx + 1600);

function checks (src) {
  const oi = src.indexOf('function openSettings(vw){');
  const ob = oi < 0 ? '' : src.slice(oi, oi + 1600);
  const bi = src.indexOf('function bindModalResize(){');
  const bb = bi < 0 ? '' : src.slice(bi, bi + 2200);
  const ci0 = src.indexOf('function swClamp(');
  const sc = ci0 < 0 ? '' : src.slice(ci0, ci0 + 400);
  const ci = src.indexOf('function closeModal(){');
  const cb = ci < 0 ? '' : src.slice(ci, ci + 900);
  const wideAdds = (src.match(/classList\.add\('wide'\)/g) || []).length;
  return [
    ['入口: btnSettings 显式零参包装（禁裸引用 = openSettings）',
      /\$\('#btnSettings'\)\.onclick = function\(\)\{ openSettings\(\) \};/.test(src) && !/\$\('#btnSettings'\)\.onclick = openSettings\s*;/.test(src)],
    ['openSettings: vw 类型防御（事件对象当 vw 时置空）',
      /if \(vw && typeof vw !== 'string'\) vw = '';/.test(ob)],
    ['renderSettings: SETTINGS.view 非字符串/空值回落 apikey（task360 默认页）',
      /typeof SETTINGS\.view !== 'string' \|\| !SETTINGS\.view\) SETTINGS\.view = 'apikey'/.test(src)],
    ['挂载: openSettings 挂 settings 类、不挂 wide，其它 wide 挂载点=2（task251 画像/角色改设置内页后仅剩定时任务两页）',
      /mbox\.classList\.add\('settings'\)/.test(ob) && !/classList\.add\('wide'\)/.test(ob) && wideAdds === 2],
    ['手柄: #modalResize 默认 hidden 且位于 .modal 内',
      /<div class="mr-handle" id="modalResize" hidden/.test(src)],
    ['拖拽: pointermove/pointerup/pointercancel init 一次性 + MR_DRAG 守卫',
      /addEventListener\('pointermove'/.test(bb) && /addEventListener\('pointerup'/.test(bb) && /addEventListener\('pointercancel'/.test(bb) && /if \(!MR_DRAG\) return/.test(bb)],
    ['夹紧: 下限 420×320 / 上限 96vw×90vh',
      /Math\.max\(420/.test(sc) && /Math\.max\(320/.test(sc) && /innerWidth \* 0\.96/.test(sc) && /innerHeight \* 0\.90/.test(sc)],
    ['记忆: 键 littledj.settingsWin 唯一（渐进层 settingsWinFit 已砍）',
      /'littledj\.settingsWin'/.test(src) && !/settingsWinFit/.test(src)],
    ['.modal.settings 定高 760×720',
      /\.modal\.settings\{width:min\(760px,96vw\);height:min\(720px,88vh\)/.test(src)],
    ['.settings-body min-height:0 + 双向 overflow:auto',
      /\.settings-body\{flex:1;min-width:0;min-height:0;overflow:auto/.test(src)],
    ['closeModal: 清 settings 类 + inline 宽高 + 手柄复位',
      /remove\('settings'\)/.test(cb) && /removeProperty\('height'\)/.test(cb) && /mrz\.hidden = true/.test(cb)],
    ['窄屏: ≤600px 手柄 display:none',
      /@media \(max-width:600px\)\{[\s\S]{0,900}\.mr-handle\{display:none\}/.test(src)],
    ['守卫: 裸引用函数签名无参（openStopModal/openSkills/openNotes）',
      /function openStopModal\(\)/.test(src) && /function openSkills\(\)/.test(src) && /function openNotes\(\)/.test(src)],
    ['版本: verText 三处同版本且唯一（动态，不写死）',
      (function(){ var a = (src.match(/personal agent · v[\d.]+/g) || []); return a.length >= 3 && a.filter(function(v,i){ return a.indexOf(v) === i }).length === 1 })()]
  ];
}

checks(html).forEach(function (p) { ok(p[0], p[1]) });

/* 语法 */
const scripts = [...rawHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1] });
let synBad = 0;
scripts.forEach(function (c) { try { new Function(c) } catch (e) { synBad++; console.log('SYNTAX FAIL: ' + e.message) } });
ok('内联脚本语法 OK（' + scripts.length + ' 段）', synBad === 0);

/* 红对照：四处关键实现各自剥掉后，对应断言必须转红 */
const mut1 = html.replace("$('#btnSettings').onclick = function(){ openSettings() };", "$('#btnSettings').onclick = openSettings;");
const mut2 = html.replace("mbox.classList.add('settings')", "mbox.classList.add('wide')");
const mut3 = html.replace('<div class="mr-handle" id="modalResize" hidden', '<div class="mr-handle-off" id="modalResize" hidden');
const mut4 = html.replace(".settings-body{flex:1;min-width:0;min-height:0;overflow:auto", ".settings-body{flex:1;min-width:0;overflow:auto");
const red = []
  .concat(checks(mut1).filter(function (p) { return !p[1] }).map(function (p) { return 'M1:' + p[0] }))
  .concat(checks(mut2).filter(function (p) { return !p[1] }).map(function (p) { return 'M2:' + p[0] }))
  .concat(checks(mut3).filter(function (p) { return !p[1] }).map(function (p) { return 'M3:' + p[0] }))
  .concat(checks(mut4).filter(function (p) { return !p[1] }).map(function (p) { return 'M4:' + p[0] }));
ok('红对照: 剥入口包装/settings 类/手柄/min-height 后对应断言转红（实测 ' + red.length + ' 条）', red.length >= 4, red.join(' | '));

if (process.argv.indexOf('--json') >= 0) console.log(JSON.stringify(out, null, 2));
else {
  out.items.forEach(function (it) {
    console.log((it.ok ? 'PASS' : 'FAIL') + '  ' + it.name + (it.ok ? '' : '   [' + (it.detail || '') + ']'));
  });
  console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
}
process.exit(out.fail ? 1 : 0);

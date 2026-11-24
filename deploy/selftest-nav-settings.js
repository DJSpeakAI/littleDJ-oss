#!/usr/bin/env node
/* task217→task251 自测：主人画像/角色移入设置后的呈现方式
   task217（v0.219）设计=「动作项」独立弹窗 + 「← 设置」返回行；
   task251（v0.254，主人 2026-11-13「点击了角色页之后一级导航没有了，应该在一级导航上呈现」）改回**普通页**：
   点击只切 view，一级导航保持，内容进 settings-body；独立弹窗/返回行/settingsBackView 整体退役。
   用法：node deploy/selftest-nav-settings.js [--json]
   覆盖：①左栏两按钮零残留 ②SETTINGS_NAV 两项顺序/图标 ③通用切页分支（无动作项残留）
        ④renderSettings 含 profile/roles 分发 + 内嵌容器 id ⑤独立弹窗/返回行/settingsBackView 零残留
        ⑥modalSave 复位与画像页绑定 ⑦openSettings(vw) 保留 'sfx' 字面量（P1-3）⑧verText 三处 ⑨语法
   红对照：剥分发分支/复活动作项/改字面量 → 断言转红 */
'use strict';
const fs = require('fs');
const path = require('path');

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}

/* 模块化后源码锚点走 loadUiSource（按 @order 拼接全部模块+内联脚本）+ index.html 原文（CSS/verText 锚点仍在这）；
   rawHtml 仅保留给 <script> 标签扫描（语法检查）用 */
const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
const html = require('./selftest-load-ui').loadUiSource(path.join(__dirname, '..', 'ui')) + '\n' + rawHtml;

function checks (src) {
  const rsI = src.indexOf('function renderSettings(');
  const rs = rsI < 0 ? '' : src.slice(rsI, src.indexOf('\nfunction ', rsI + 10));
  return [
    ['左栏: btnProfile/btnRoles 零残留', !/btnProfile|btnRoles/.test(src)],
    ['设置导航: profile/roles 两项在 apikey 之后', /id: 'apikey'[\s\S]{0,600}id: 'profile', label: '主人画像', ico: '◉'[\s\S]{0,200}id: 'roles', label: '角色', ico: '◇'/.test(src)],
    ['图标: roles 用 ◇（不与 TTS ◈ 冲突）', /id: 'roles', label: '角色', ico: '◇'/.test(src)],
    ['task251: nav 按钮无动作项分支（profile/roles 走通用切页）',
      !/n\.id === 'profile'/.test(src) && !/n\.id === 'roles'/.test(src) &&
      /b2\.onclick = function\(\)\{ SETTINGS\.view = n\.id; renderSettings\(\) \};/.test(src)],
    ['task251: 旧动作项实现零残留（openProfile/openRoles/settingsBackView/pg-back）',
      !/function openProfile|function openRoles|openProfile\(|openRoles\(|settingsBackView = |pg-back-row/.test(src)],
    ['task251: renderSettings 分发 profile 分支（内嵌 #profileWrap + fetchProfile + modalSave 绑保存）',
      /SETTINGS\.view === 'profile'\)\{[\s\S]{0,400}profileWrap[\s\S]{0,200}fetchProfile\(\);[\s\S]{0,200}saveProfile\('手动保存'\)/.test(rs)],
    ['task251: renderSettings 分发 roles 分支（内嵌 #rolesWrap + loadRoles）',
      /SETTINGS\.view === 'roles'\)\{[\s\S]{0,300}rolesWrap[\s\S]{0,200}loadRoles\(\);/.test(rs)],
    ['task251: modalSave onclick 每次重渲复位（防画像绑定残留别页）',
      /sb0\.onclick = function\(\)\{ settingsSave\(false\) \}/.test(rs)],
    ['P1-1 防假绿②: renderProfile/renderRoles 清空目标为 wrap',
      /\$\('#profileWrap'\); if \(!wrap \|\| !PROFILE\.data\) return/.test(src) && /\$\('#rolesWrap'\); if \(!wrap\) return/.test(src)],
    ['P1-3/task360: openSettings(vw) 且保留 \'apikey\' 默认页字面量', /function openSettings\(vw\)\{/.test(src) && /SETTINGS\.view = 'apikey';[^\n]*\n  if \(vw\) SETTINGS\.view = vw;/.test(src)],
    ['guard 跳画像改设置内切页', /pb\.onclick = function\(\)\{ SETTINGS\.view = 'profile'; renderSettings\(\) \}/.test(src)],
    ['task251 CSS: 内嵌限高解除（.settings-body 内 profile/roles body/nav max-height:none）',
      /\.settings-body \.profile-body,\.settings-body \.roles-body\{max-height:none\}/.test(src) &&
      /\.settings-body \.profile-nav,\.settings-body \.roles-nav\{max-height:none\}/.test(src)],
    ['版本: verText 三处同版本无混用', (function(){ var a = (src.match(/personal agent · v[\d.]+/g) || []); return a.length >= 3 && a.filter(function(v,i){ return a.indexOf(v) === i }).length === 1 })()]
  ];
}

checks(html).forEach(function (p) { ok(p[0], p[1]) });

/* 语法 */
const scripts = [...rawHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1] });
let synBad = 0;
scripts.forEach(function (c) { try { new Function(c) } catch (e) { synBad++; console.log('SYNTAX FAIL: ' + e.message) } });
ok('内联脚本语法 OK（' + scripts.length + ' 段）', synBad === 0);

/* 红对照 */
const mut1 = html.replace(/else if \(SETTINGS\.view === 'profile'\)\{[\s\S]*?else if \(SETTINGS\.view === 'roles'\)\{[\s\S]*?loadRoles\(\);\n  \}/, '');
const mut2 = html.replace("    } else {\n      /* task251：profile/roles 从动作项改普通页，与 guard 等同走通用切页分支（一级导航保持） */\n      b2.onclick = function(){ SETTINGS.view = n.id; renderSettings() };\n    }",
  "    } else if (n.id === 'profile'){ b2.onclick = function(){ settingsBackView = SETTINGS.view; closeModal(); setTimeout(openProfile, 80) } } else { b2.onclick = function(){ SETTINGS.view = n.id; renderSettings() } }");
const mut3 = html.replace(/SETTINGS\.view = 'apikey';[^\n]*\n  if \(vw\) SETTINGS\.view = vw;/, "SETTINGS.view = vw || 'apikey';");
const red = []
  .concat(checks(mut1).filter(function (p) { return !p[1] }).map(function (p) { return 'M1:' + p[0] }))
  .concat(checks(mut2).filter(function (p) { return !p[1] }).map(function (p) { return 'M2:' + p[0] }))
  .concat(checks(mut3).filter(function (p) { return !p[1] }).map(function (p) { return 'M3:' + p[0] }));
ok('红对照: 剥分发分支/复活动作项/改走字面量后断言转红（实测 ' + red.length + ' 条）', red.length >= 3, red.join(' | '));

if (process.argv.indexOf('--json') >= 0) console.log(JSON.stringify(out, null, 2));
else {
  out.items.forEach(function (it) {
    console.log((it.ok ? 'PASS' : 'FAIL') + '  ' + it.name + (it.ok ? '' : '   [' + it.detail + ']'));
  });
  console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
}
process.exit(out.fail ? 1 : 0);

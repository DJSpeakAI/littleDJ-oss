#!/usr/bin/env node
/* task248/task250 自测：设置/画像/角色页导航点击后滚动保持 + 滚动条隐藏 + 角色页模型下拉对齐
   用法：node deploy/selftest-settings-nav.js [--json]
   task248：①renderSettings 记录旧 nav.scrollLeft ②渲染后恢复 ③active 不在视野才微调 ④窄屏 nav 无 border-bottom
   task250：⑤恢复逻辑抽公共 navRestoreScroll（settings/profile/roles 三调用点）⑥SETTINGS_NAV_SCROLL 跨弹窗记忆
           ⑦画像/角色导航滚动保持 + 旧「rAF 强制居中」已删 ⑧.profile-nav/.roles-nav 滚动条隐藏
           ⑨角色页模型下拉复活（task75 骨架）且选项与输入框同源同文（labelModel）+ PUT /_roles/model 写回
   红对照：剥恢复行/横杠加回/剥公共调用/剥 labelMap/删强制居中回归 各转红 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name, ok: true }); }
  else { out.fail++; out.items.push({ name, ok: false, detail: detail || '' }); }
}

/* 模块化后源码锚点走 loadUiSource（按 @order 拼接全部模块+内联脚本）+ index.html 原文（CSS 锚点仍在这）；
   rawHtml 仅保留给 <script> 标签扫描（语法检查）用 */
const rawHtml = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
const html = require('./selftest-load-ui').loadUiSource(path.join(__dirname, '..', 'ui')) + '\n' + rawHtml;

function seg (src, fnName, len) {
  const i = src.indexOf('function ' + fnName + '(');
  if (i < 0) return '';
  const j = src.indexOf('\nfunction ', i + 10);
  const end = j < 0 ? src.length : j;
  return src.slice(i, Math.min(end, i + len));
}
function cssRule (src, sel) {
  return (src.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]*\\\}/, ''), 'g')) || []).join(' ') || '';
}

function checks (src) {
  const rs = seg(src, 'renderSettings', 6000);
  const rp = seg(src, 'renderProfile', 6000);
  const rr = seg(src, 'renderRoles', 12000);
  const nv = seg(src, 'navRestoreScroll', 1200);
  const narrow = (src.match(/@media \(max-width:600px\)\{[\s\S]*?\n\}/) || [''])[0];
  const navCss = (narrow.match(/\.settings-nav\{[^}]*\}/) || [''])[0];
  const pfCss = (src.match(/\.profile-nav\{[^}]*\}/) || [''])[0];
  const rlCss = (src.match(/\.roles-nav\{[^}]*\}/) || [''])[0];
  return [
    ['task248 settings: 重建前记录旧导航 scrollLeft（弹窗重开回落跨弹窗记忆）',
      /var navPrev = wrap\.querySelector\('\.settings-nav'\)/.test(rs) && /navScroll = navPrev \? navPrev\.scrollLeft : \(SETTINGS_NAV_SCROLL \|\| 0\)/.test(rs)],
    ['task250 公共函数: navRestoreScroll 存在，active 视野四向微调，禁 scrollIntoView',
      /function navRestoreScroll\(nav, sl, st\)/.test(nv) && /ar\.left < nr\.left/.test(nv) && /ar\.right > nr\.right/.test(nv) &&
      /ar\.top < nr\.top/.test(nv) && /ar\.bottom > nr\.bottom/.test(nv) && !/scrollIntoView/.test(nv)],
    ['task248 settings: 插入新导航后调 navRestoreScroll + scroll 监听跨弹窗记忆',
      /wrap\.appendChild\(nav\);[\s\S]{0,260}navRestoreScroll\(nav, navScroll, 0\)/.test(rs) &&
      /addEventListener\('scroll', function\(\)\{ SETTINGS_NAV_SCROLL = nav\.scrollLeft \}\)/.test(rs)],
    ['task248 窄屏 .settings-nav: border-bottom 已删（横杠去掉）',
      !!navCss && /border-bottom:none/.test(navCss) && !/border-bottom:1px solid/.test(navCss), navCss],
    ['task248-fu1 窄屏 .settings-nav: 滚动条本身已隐藏（「横杠」真身=横滚条）',
      /scrollbar-width:none/.test(navCss) && /-ms-overflow-style:none/.test(navCss) &&
      /\.settings-nav::-webkit-scrollbar\{display:none/.test(narrow) && /overflow-x:auto/.test(navCss), navCss],
    ['task250 profile: 重渲前记导航 scrollLeft/scrollTop，渲染后 navRestoreScroll 恢复',
      /pfNavPrev = wrap\.querySelector\('\.profile-nav'\)/.test(rp) && /pfNavScroll = pfNavPrev \? \{ l: pfNavPrev\.scrollLeft, t: pfNavPrev\.scrollTop \}/.test(rp) &&
      /navRestoreScroll\(nav, pfNavScroll\.l, pfNavScroll\.t\)/.test(rp)],
    ['task250 profile: 旧「rAF 强制居中 active」已删（跳动感来源）',
      rp.indexOf('act.offsetLeft - (nav.clientWidth') < 0 && rp.indexOf('requestAnimationFrame') < 0],
    ['task250 roles: 重渲前记导航滚动，渲染后 navRestoreScroll 恢复',
      /rlNavPrev = wrap\.querySelector\('\.roles-nav'\)/.test(rr) && /rlNavScroll = rlNavPrev \? \{ l: rlNavPrev\.scrollLeft, t: rlNavPrev\.scrollTop \}/.test(rr) &&
      /navRestoreScroll\(nav, rlNavScroll\.l, rlNavScroll\.t\)/.test(rr)],
    ['task250 CSS: .profile-nav / .roles-nav 滚动条隐藏（复制 task248-fu1）',
      /scrollbar-width:none/.test(pfCss) && /scrollbar-width:none/.test(rlCss) &&
      /\.profile-nav::-webkit-scrollbar\{display:none/.test(src) && /\.roles-nav::-webkit-scrollbar\{display:none/.test(src)],
    ['task250 roles: 模型下拉复活（select#roleModelSel + 保存按钮 + ROLE_MODEL_RE）',
      /sel\.id = 'roleModelSel'/.test(rr) && /var save = el\('button', 'role-save', '保存'\)/.test(rr) &&
      /ROLE_MODEL_RE\.test\(model\)/.test(rr) && /var ROLE_MODEL_RE = /.test(src) && /\.role-save\{/.test(src)],
    ['task250/290 roles: 选项与输入框同源同文（别名清单 rolePickModel/visibleModelsForPick + labelModel，无 Key 名另拼）',
      /var rp = rolePickModel\(curModel\);[\s\S]{0,500}o\.textContent = labelModel\(m\);/.test(rr) &&
      /visibleModelsForPick\(\)\.forEach\(function\(m\)\{[\s\S]{0,300}o\.textContent = labelModel\(m\);/.test(rr) &&
      /if \(rp\.autoFix && !ROLES\._autoFixBusy\)/.test(rr) &&
      !/roleModelLabel|roleKeyNames|roleApplyKeyNames/.test(src)],
    ['task250 roles: 未在列表置顶 + 自定义项 + PUT /_roles/model 写回',
      /（未在列表）/.test(rr) && /'__custom__'/.test(rr) && /fetch\('\/_roles\/model'[\s\S]{0,120}method: 'PUT'/.test(rr)],
    ['task256 roles: unchanged toast 回显文件当前值（防「显示 vs 存储」迷惑）',
      /模型未变化：文件当前已是 ' \+ model/.test(rr)],
    ['task258 roles: butler 下拉恢复且与输入框双向联动（S.model 持久化 + 反向重绘）',
      /if \(role\.name === 'butler'\)\{[\s\S]{0,900}bsel[\s\S]{0,400}littledj\.model[\s\S]{0,200}syncModelLabel\(\);[\s\S]{0,80}refreshBillingViews\(\)/.test(rr) &&
      /ROLES\.data && \$\('#rolesWrap'\)\) renderRoles\(\)/.test(src)],
    ['task248 未回归: nav / settings-body 仍是两个独立容器',
      /var nav = el\('div', 'settings-nav'\)/.test(rs) && /var body = el\('div', 'settings-body'\)/.test(rs) && /wrap\.appendChild\(body\);/.test(rs)],
    ['task248 未回归: 子页胶囊 tabs 仍按分组渲染',
      /var tabs = el\('div', 'settings-tabs'\)/.test(rs) && /currentSettingsGroup\(\)/.test(rs)]
  ];
}

checks(html).forEach(([n, c, d]) => ok(n, c, d));

// 语法：内联脚本两段
try {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0, err = '';
  while ((m = re.exec(rawHtml))) {
    n++;
    try { new vm.Script(m[1], { filename: 'ui/index.html#script' + n }); } catch (e) { err = e.message; break; }
  }
  ok('内联脚本语法 OK（' + n + ' 段）', !err, err);
} catch (e) { ok('内联脚本语法 OK', false, e.message); }

// 红对照
const reds = [
  ['剥 task248 恢复调用（settings）', html.replace('navRestoreScroll(nav, navScroll, 0);', ''), c => c.some(([, x]) => x === false)],
  ['横杠加回（border-bottom）', html.replace(/\.settings-nav\{width:100%;flex-direction:row;border-right:none;border-bottom:none/, '.settings-nav{width:100%;flex-direction:row;border-right:none;border-bottom:1px solid var(--line)'), () => true],
  ['剥 profile 恢复调用', html.replace('navRestoreScroll(nav, pfNavScroll.l, pfNavScroll.t);', ''), () => true],
  ['剥 roles 恢复调用', html.replace('navRestoreScroll(nav, rlNavScroll.l, rlNavScroll.t);', ''), () => true],
  ['角色下拉退回只读（剥 labelModel 选项行）', html.replace('    o.textContent = labelModel(m); /* 与输入框 refreshModelOptions 同源同文 */', ''), () => true],
  ['剥 unchanged 回显（退回光杆文案）', html.replace("('模型未变化：文件当前已是 ' + model + '。如果这不是你想要的，请重新在下拉里选好再点保存')", "'模型未变化'"), () => true],
  ['剥 butler 分支（退回人人写回角色卡）', html.replace(/if \(role\.name === 'butler'\)\{[\s\S]*?\n  \} else \{\n  \/\* task250/, '\n  /* task250'), () => true],
  ['画像恢复强制居中（回归对照）', html.replace('navRestoreScroll(nav, pfNavScroll.l, pfNavScroll.t); /* task250：恢复滚动位置；仅 active 不在视野才微调 */', "var act = nav.querySelector('button.active');\n  if (act){ requestAnimationFrame(function(){ try { nav.scrollLeft = act.offsetLeft - (nav.clientWidth - act.offsetWidth) / 2 } catch (e){} }); }"), () => true]
];
let redN = 0;
reds.forEach(([name, red, extra]) => {
  if (red === html) { ok('红对照[' + name + ']：构造失败（替换未命中）', false); return; }
  const r = checks(red);
  const redHit = r.some(([, c]) => c === false);
  ok('红对照：' + name + ' → 断言红', redHit);
  if (redHit) redN++;
});

if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 2)); }
else {
  out.items.forEach(it => console.log((it.ok ? 'PASS  ' : 'FAIL  ') + it.name + (it.ok ? '' : (it.detail ? '  ← ' + it.detail : ''))));
  console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
}
process.exit(out.fail ? 1 : 0);

#!/usr/bin/env node
/* task354 http 下抓屏自动切 https 一次直达自测
 *   A 静态：① 契约头 @提供 含 plgHttpsCapUrl/plgAutoCapFromUrl ② 文件尾自调用
 *          ③ 按钮文案「自动切 https」④ 面板底部说明含 8443 ⑤ verText 三处一致
 *   B 行为(vm)：⑥ http+IP → https:8443 同路径带 plgcap=1 ⑦ 保留原 query（& 拼接）
 *          ⑧ https → 空 ⑨ 非 IP 域名 → 空 ⑩ 已有 plgcap=1 不重复
 *          ⑪ https+?plgcap=1 落地 → 自动开面板+toast+清参 ⑫ https 无参 → 零副作用
 *          ⑬ http+?plgcap=1 → 不触发（协议门禁）
 *   C 红对照：⑭ 删 isIp 判断 → ⑨ 转红 ⑮ 删 https 早退 → ⑧ 转红
 * 退出码 0=全绿，1=有失败，2=装载失败 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let plgSrc = '';
try {
  plgSrc = fs.readFileSync(path.join(root, 'ui/src/app/plugins.js'), 'utf8');
  fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
} catch (e) {
  console.error('装载失败：' + e.message);
  process.exit(2);
}
const uiSrc = require('./selftest-load-ui').loadUiSource(path.join(root, 'ui'))
  + '\n' + fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (hint ? '  ← ' + hint : '')); }
}

/* ---------- A 静态 ---------- */
ok('A1 契约头 @提供 含 plgHttpsCapUrl plgAutoCapFromUrl',
  /@提供[^*]*plgHttpsCapUrl[^*]*plgAutoCapFromUrl/.test(plgSrc.split('\n')[0]));
ok('A2 文件尾自调用 plgAutoCapFromUrl()',
  /\nplgAutoCapFromUrl\(\); \/\* task354/.test(plgSrc));
ok('A3 http 下按钮文案含「自动切 https」（三态拼接）',
  /抓屏截图（Alt\+A）' \+ \(location\.protocol === 'https:' \? '' : ' · 自动切 https'\)/.test(plgSrc));
ok('A4 面板底部说明含 8443 自动切',
  /http 下点按钮会自动切到 https:\/\/本机IP:8443/.test(plgSrc));
(function () {
  const mm = uiSrc.match(/personal agent · v[0-9.]+/g) || [];
  ok('A5 verText 三处且一致（动态口径，L-063）', mm.length === 3 && mm[0] === mm[1] && mm[1] === mm[2], 'got ' + mm.join(','));
})();

/* ---------- B 行为（vm 装载 plugins.js；setTimeout 手动 flush） ---------- */
function mkCtx(loc, hasMd, srcOverride) {
  const calls = { toast: [], open: 0, replaced: 0 };
  const stubs = [];
  const ctx = {
    console: console,
    setTimeout: function (cb) { stubs.push(cb); return 0 },
    clearTimeout: function () {},
    Date: Date,
    navigator: hasMd ? { mediaDevices: { getDisplayMedia: function () {} } } : {},
    location: loc,
    history: { replaceState: function () { calls.replaced++ } },
    document: {
      createElement: function () { return { style: {}, id: '', textContent: '', appendChild: function () {}, remove: function () {}, addEventListener: function () {} } },
      getElementById: function () { return null },
      querySelector: function () { return null },
      addEventListener: function () {}, removeEventListener: function () {},
      head: { appendChild: function () {} },
      body: { appendChild: function () {} }
    },
    File: function () {}, URL: {}, Image: function () {}
  };
  ctx.window = ctx;
  vm.runInContext(srcOverride || plgSrc, vm.createContext(ctx), { filename: 'plugins.js' });
  ctx.plgToast = function (t) { calls.toast.push(String(t)) };
  ctx.openPlugins = function () { calls.open++ };
  return { ctx: ctx, calls: calls, flush: function () { while (stubs.length) stubs.shift()() } };
}

/* ⑥⑦ 原 query 保留与 & 拼接 */
(function () {
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'http:', pathname: '/', search: '?v=0032' });
  ok('B6 http+IP+原query → https:8443 同路径 &plgcap=1',
    t.ctx.plgHttpsCapUrl() === 'https://192.0.2.10:8443/?v=0032&plgcap=1', t.ctx.plgHttpsCapUrl());
})();
(function () {
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'http:', pathname: '/', search: '' });
  ok('B7 http+IP 无query → ?plgcap=1', t.ctx.plgHttpsCapUrl() === 'https://192.0.2.10:8443/?plgcap=1', t.ctx.plgHttpsCapUrl());
})();
/* ⑧ https 不跳 */
(function () {
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'https:', pathname: '/', search: '' });
  ok('B8 https → 不返回跳转 URL', t.ctx.plgHttpsCapUrl() === '', t.ctx.plgHttpsCapUrl());
})();
/* ⑨ 非 IP 域名不跳（外网域名场景） */
(function () {
  const t = mkCtx({ hostname: 'dj.example.com', protocol: 'http:', pathname: '/', search: '' });
  ok('B9 http+非IP域名 → 空（走降级）', t.ctx.plgHttpsCapUrl() === '', t.ctx.plgHttpsCapUrl());
})();
/* ⑩ 已有 plgcap=1 不重复拼 */
(function () {
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'http:', pathname: '/', search: '?plgcap=1' });
  ok('B10 已有 plgcap=1 不重复', t.ctx.plgHttpsCapUrl() === 'https://192.0.2.10:8443/?plgcap=1', t.ctx.plgHttpsCapUrl());
})();
/* ⑪ https 落地自动开面板 + toast + 清参 */
(function () {
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'https:', pathname: '/', search: '?plgcap=1' });
  t.flush();
  ok('B11 落地 ?plgcap=1 → 自动开插件面板 + 引导 toast + 清参',
    t.calls.open === 1 && t.calls.toast.some(function (s) { return s.indexOf('已切到加密页') >= 0 }) && t.calls.replaced === 1,
    JSON.stringify(t.calls));
})();
/* ⑫ https 无参零副作用 */
(function () {
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'https:', pathname: '/', search: '' });
  t.flush();
  ok('B12 https 无参 → 零副作用', t.calls.open === 0 && t.calls.toast.length === 0 && t.calls.replaced === 0);
})();
/* ⑬ http + ?plgcap=1 协议门禁不触发 */
(function () {
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'http:', pathname: '/', search: '?plgcap=1' });
  t.flush();
  ok('B13 http+?plgcap=1 → 协议门禁不触发', t.calls.open === 0 && t.calls.toast.length === 0);
})();

/* ---------- C 红对照（坏源码整文件重装载，直接调 plgHttpsCapUrl） ---------- */
(function () {
  const bad = plgSrc.replace(/var isIp = [^;]+;/, 'var isIp = true;');
  const t = mkCtx({ hostname: 'dj.example.com', protocol: 'http:', pathname: '/', search: '' }, false, bad);
  ok('C14 红对照：删 isIp 判断 → 域名场景返回非空', t.ctx.plgHttpsCapUrl() !== '');
})();
(function () {
  const bad = plgSrc.replace("if (location.protocol === 'https:') return '';", '');
  const t = mkCtx({ hostname: '192.0.2.10', protocol: 'https:', pathname: '/', search: '' }, false, bad);
  ok('C15 红对照：删 https 早退 → https 场景返回非空', t.ctx.plgHttpsCapUrl() !== '');
})();

console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail === 0 ? 0 : 1);

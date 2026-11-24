#!/usr/bin/env node
/* task352 Alt+A 圈屏抓屏自测（对齐 DAG AI Chat「截屏→圈选→标注」心智）
 *   A 静态：① 契约头含 plgCapture/plgSend ② Alt+A 分支走 plgCapture ③ 工具条「发小DJ」
 *          ④ 面板 #plgShot 按钮 ⑤ 降级 toast 含 Ctrl+V ⑥ 抓屏流必停(track.stop)
 *          ⑦ window 挂载 ⑧ plugins.js?v=p3 ⑨ verText 三处动态一致
 *   B 行为(vm)：⑩ 降级(Alt+A)→toast+开面板+弹选图 ⑪ 降级(面板按钮)→只 toast 不弹选图
 *          ⑫ 可用分支→getDisplayMedia→抓帧→停流→plgAnnotate(dataURL)
 *          ⑬ plgSend 正路→addImageFile 收 File+plgClose ⑭ plgSend 无 addImageFile→退回 plgCopy
 *   C 红对照：⑮ 删 keydown 内 plgCapture() → ② 转红 ⑯ 删 data-a="send" → ③ 转红
 * 退出码 0=全绿，1=有失败，2=装载失败 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let plgSrc, uiSrc;
try {
  plgSrc = fs.readFileSync(path.join(root, 'ui/src/app/plugins.js'), 'utf8');
  uiSrc = require('./selftest-load-ui').loadUiSource(path.join(root, 'ui'))
    + '\n' + fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
} catch (e) {
  console.error('装载失败：' + e.message);
  process.exit(2);
}

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (hint ? '  ← ' + hint : '')); }
}

/* ---------- A 静态 ---------- */
ok('A1 契约头 @提供 含 plgCapture 与 plgSend',
  /@提供[^*]*plgCapture[^*]*plgSend/.test(plgSrc.split('\n')[0]));
ok('A2 Alt+A keydown 分支走 plgCapture()（含标注中不抢键）',
  /if \(document\.querySelector\('#plgAnno'\)\) return[\s\S]{0,120}?ev\.preventDefault\(\);[\s\S]{0,80}?plgCapture\(\);/.test(plgSrc));
ok('A3 工具条「➕ 发小DJ」按钮 + bar click send 分支',
  /data-a="send"[\s\S]{0,4000}?a === 'send'\)\{ plgSend\(\) \}/.test(plgSrc));
ok('A4 面板 #plgShot 按钮 → plgCapture(true)',
  /#plgShot/.test(plgSrc) && /plgShot'\)\.onclick = function\(\)\{ plgCapture\(true\) \}/.test(plgSrc));
ok('A5 降级 toast 指路 Ctrl+V（task354：兜底分支保留）', /系统截图后 Ctrl\+V/.test(plgSrc));
ok('A6 抓屏流必停（stopAll + t.stop）',
  /var stopAll = function\(s\)\{ try \{ s\.getTracks\(\)\.forEach\(function\(t\)\{ t\.stop\(\) \}\) \} catch\(e\)\{\} \};/.test(plgSrc));
ok('A7 window 挂载 plgCapture/plgSend',
  /window\.plgCapture = plgCapture; window\.plgSend = plgSend;/.test(plgSrc));
(function () {
  const v = require('./contract').htmlScriptVersionMap(path.join(root, 'ui'))['src/app/plugins.js'];
  ok('A8 index.html 引 plugins.js 带缓存参数（当前 ' + (v || '缺失') + '，动态口径 task371-M0#9）', /^p\d+$/.test(v || ''));
})();
(function () {
  const mm = uiSrc.match(/personal agent · v[0-9.]+/g) || [];
  ok('A9 verText 三处且一致（动态口径，L-063）', mm.length === 3 && mm[0] === mm[1] && mm[1] === mm[2], 'got ' + mm.join(','));
})();

/* ---------- B 行为（vm 跑 plugins.js 顶层声明，函数声明=全局属性可 spy） ---------- */
function syncThen(v) { /* 同步 thenable：resolve 后立即续跑，测试无需等微任务 */
  return { then: function (cb) { cb(v); return { catch: function () {} } } };
}
function mkCtx(nav, loc) {
  const calls = { toast: [], pickClick: 0, open: 0, annotate: [], addImage: [], close: 0, copy: 0, stop: 0, draw: 0, play: 0 };
  const pick = { click: function () { calls.pickClick++ } };
  const ctx = {
    console: console,
    setTimeout: function () { return 0 },
    clearTimeout: function () {},
    Date: Date,
    navigator: nav,
    location: loc || { hostname: '192.0.2.10' }, /* task353/354：http 降级取 hostname 拼 8443 */
    document: {
      createElement: function (tag) {
        if (tag === 'video') return {
          muted: false, playsInline: false, srcObject: null, videoWidth: 1920, videoHeight: 1080, readyState: 2,
          play: function () { calls.play++; return syncThen(); },
          requestVideoFrameCallback: function (cb) { cb(); }
        };
        if (tag === 'canvas') return {
          width: 0, height: 0,
          getContext: function () { return { drawImage: function () { calls.draw++ } }; },
          toDataURL: function () { return 'data:image/png,FAKE' }
        };
        return { style: {}, innerHTML: '', textContent: '', appendChild: function () {}, remove: function () {},
          addEventListener: function () {}, querySelector: function () { return null }, getBoundingClientRect: function () { return { left: 0, top: 0, width: 0, height: 0 } } };
      },
      querySelector: function (sel) { return sel === '#plgPick' ? pick : null; },
      addEventListener: function () {}, removeEventListener: function () {},
      body: { appendChild: function () {} }
    },
    Image: function () {},
    File: function (parts, name, opts) { this.parts = parts; this.name = name; this.type = opts && opts.type; },
    URL: { createObjectURL: function () { return 'blob:x' }, revokeObjectURL: function () {} },
    navigator2: null
  };
  ctx.window = ctx;
  vm.runInContext(plgSrc, vm.createContext(ctx), { filename: 'plugins.js' });
  /* spy 全局函数（顶层函数声明 → 覆盖即生效，L-116 对照：本文件非 IIFE 包裹） */
  ctx.plgToast = function (t) { calls.toast.push(String(t)) };
  ctx.openPlugins = function () { calls.open++ };
  ctx.plgAnnotate = function (src) { calls.annotate.push(src) };
  ctx.plgClose = function () { calls.close++ };
  ctx.plgCopy = function () { calls.copy++ };
  ctx.plgBlob = function (done) { done({ size: 123 }) };
  ctx.addImageFile = function (f) { calls.addImage.push(f) };
  return { ctx: ctx, calls: calls };
}
/* ⑩ http + IP（Alt+A 与面板按钮同路）：task354 自动切 https 一次直达 */
(function () {
  const t = mkCtx({}); /* navigator 无 mediaDevices */
  t.ctx.plgCapture();
  ok('B10 http+IP：toast 提示切加密页 + 不弹选图不开面板', t.calls.toast.some(function (s) { return s.indexOf('加密页') >= 0 }) && t.calls.pickClick === 0 && t.calls.open === 0, JSON.stringify(t.calls.toast));
  ok('B10b 跳转 URL=https:host:8443+plgcap=1', t.ctx.plgHttpsCapUrl() === 'https://192.0.2.10:8443/?plgcap=1', t.ctx.plgHttpsCapUrl());
})();
/* ⑪ http 非 IP 域名：兜底降级（toast 指路 + Alt+A 开面板弹选图） */
(function () {
  const t = mkCtx({}, { hostname: 'example.com', protocol: 'http:', pathname: '/', search: '' });
  t.ctx.plgCapture();
  ok('B11 非IP域名降级(Alt+A)：toast 指路 8443+Ctrl+V + 开面板弹选图', t.calls.toast.some(function (s) { return s.indexOf('8443') >= 0 && s.indexOf('Ctrl+V') >= 0 }) && t.calls.open === 1 && t.calls.pickClick === 1, JSON.stringify(t.calls.toast));
})();
/* ⑪b https 但浏览器不支持 getDisplayMedia：兜底 toast，不跳转不弹选图 */
(function () {
  const t = mkCtx({}, { hostname: '192.0.2.10', protocol: 'https:', pathname: '/', search: '' });
  t.ctx.plgCapture(true);
  ok('B11b https 无 getDisplayMedia(按钮)：兜底 toast 不弹选图', t.calls.toast.some(function (s) { return s.indexOf('Ctrl+V') >= 0 }) && t.calls.pickClick === 0 && t.calls.open === 0, JSON.stringify(t.calls.toast));
})();
/* ⑫ 可用分支：getDisplayMedia → 抓帧 → 停流 → plgAnnotate；task355 整屏约束 */
(function () {
  const track = { stop: function () {} };
  const stream = { getTracks: function () { return [track] } };
  const origStop = track.stop; let stopped = 0;
  track.stop = function () { stopped++; origStop() };
  let gdmOpts = null;
  const t = mkCtx({ mediaDevices: { getDisplayMedia: function (o) { gdmOpts = o; return syncThen(stream) } } });
  t.ctx.plgCapture();
  ok('B12 抓屏：play→drawImage→dataURL 进标注器', t.calls.play === 1 && t.calls.draw === 1 && t.calls.annotate.length === 1 && t.calls.annotate[0] === 'data:image/png,FAKE',
    JSON.stringify({ play: t.calls.play, draw: t.calls.draw, annotate: t.calls.annotate }));
  ok('B12 抓屏：流已停（track.stop 恰一次）', stopped === 1, 'stopped=' + stopped);
  ok('B12b task355 整屏约束：monitor 默认+排除自家标签+分辨率 ideal',
    gdmOpts && gdmOpts.video.displaySurface === 'monitor' && gdmOpts.selfBrowserSurface === 'exclude' &&
    gdmOpts.surfaceSwitching === 'exclude' && gdmOpts.monitorTypeSurfaces === 'include' &&
    gdmOpts.video.width && gdmOpts.video.width.ideal >= 1920 && gdmOpts.video.height && gdmOpts.video.height.ideal >= 1080,
    JSON.stringify(gdmOpts && gdmOpts.video));
})();
/* ⑬ plgSend 正路：addImageFile 收 File + 先收面板 */
(function () {
  const t = mkCtx({});
  t.ctx.PLG.sel = { x: 0, y: 0, w: 100, h: 50 };
  t.ctx.plgSend();
  const f = t.calls.addImage[0];
  ok('B13 plgSend：File（截图-*.png）进 addImageFile 且已收面板',
    t.calls.addImage.length === 1 && f && f.name.indexOf('截图-') === 0 && f.type === 'image/png' && t.calls.close === 1,
    'addImage=' + t.calls.addImage.length + ' close=' + t.calls.close);
})();
/* ⑭ plgSend 无 addImageFile → 退回 plgCopy */
(function () {
  const t = mkCtx({});
  t.ctx.PLG.sel = { x: 0, y: 0, w: 100, h: 50 };
  delete t.ctx.addImageFile;
  t.ctx.plgSend();
  ok('B14 plgSend 无 addImageFile 退回 plgCopy', t.calls.copy === 1 && t.calls.addImage.length === 0);
})();

/* ---------- C 红对照（删关键行必须转红，防断言退化） ---------- */
(function () {
  const bad = plgSrc.replace('    plgCapture(); /* keydown 是用户手势，getDisplayMedia / 文件选择器都认 */', '');
  const re = /if \(document\.querySelector\('#plgAnno'\)\) return[\s\S]{0,120}?ev\.preventDefault\(\);[\s\S]{0,80}?plgCapture\(\);/;
  ok('C15 红对照：删 keydown 内 plgCapture() → A2 判 FAIL', re.test(bad) === false);
})();
(function () {
  const bad = plgSrc.replace('data-a="send"', 'data-a="x"');
  const re = /data-a="send"[\s\S]{0,2200}?a === x27sendx27.\){ plgSend\(\) }/;
  ok('C16 红对照：删 data-a="send" → A3 判 FAIL', re.test(bad) === false);
})();

console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail === 0 ? 0 : 1);

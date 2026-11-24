#!/usr/bin/env node
/* task295 自测：设备通行证免密登录（小DJ 侧）
   覆盖（对照方案稿 rev.3 §九 selftest-pass）：
   ① 静态断言：proxy/ui 锚点、数据面 401 无 WWW-Authenticate 挑战、verText 三处同版本
   ② E2E 主沙箱（AUTH_LOCK_OFF=1 防锁定污染）：壳白名单（task369 起含 /src 前缀放行）+XFO+?v= 剥离 / 白名单外默认 401 /
      /_auth 仅认 cookie / /_login 内网两套+外网只验 auth-ext+Set-Cookie 属性（内网无 Secure、外网有）/
      cookie 过 gate / 篡改·过期·多段·超长·非 hex 红对照 / A3 外网收窄（主密码 401·auth-ext 200·cookie 200）/
      A7a 公网 403 清单+内网对照 / A7b Basic-only（cookie /_vault 401） / _devices 列表+无 Basic 踢除 401 /
      /_logout 吊销即时+SSE(_tui/event) ≤2s 断流 / revoke 后旧 cookie 401 / 路径混淆红对照（//_vault、/api/../_vault、%2f）
   ③ devices.json 损坏 fail-closed：坏档重启 → cookie 全拒 + Basic 兜底 200
   ④ 限流沙箱（AUTH_LOCK_MAX=3）：错密码 3 次锁 429；正确密码锁定期放行（task303-fu1 同源语义）；匿名探针 401 不计数
   沙箱：LITTLEDJ_ROOT 指向临时目录 + 合成 auth.txt/auth-ext.txt（不碰生产凭据与设备表） */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}
const SAND_MAIN = 'sandbox:main-pass-123';
const SAND_EXT = 'sandbox:ext-pass-456';
const MAIN_B64 = Buffer.from(SAND_MAIN).toString('base64');
const EXT_B64 = Buffer.from(SAND_EXT).toString('base64');

function httpReq (port, auth, method, p, obj, header) {
  return new Promise(function (resolve, reject) {
    const data = obj === undefined ? null : JSON.stringify(obj);
    const headers = {};
    if (auth) headers.Authorization = 'Basic ' + auth;
    if (header) Object.assign(headers, header);
    headers['User-Agent'] = headers['User-Agent'] || 'Mozilla/5.0 (selftest-task295)'; /* task359：默认浏览器 UA，防 /_devices 工具过滤误伤本套件设备断言 */
    if (data !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      let b = ''; res.on('data', function (c) { b += c }); res.on('end', function () { resolve({ code: res.statusCode, body: b, headers: res.headers }) });
    });
    req.on('error', function (e) { reject(e) });
    if (data !== null) req.write(data);
    req.end();
  });
}
/* SSE 探针：挂起直到对端断开或超时，返回 {closed, ms} */
function sseProbe (port, cookie, p) {
  return new Promise(function (resolve) {
    const t0 = Date.now();
    const req = http.request({ host: '127.0.0.1', port: port, path: p, method: 'GET', headers: cookie ? { Cookie: cookie } : {} }, function (res) {
      if (res.statusCode !== 200) return resolve({ closed: true, ms: Date.now() - t0, code: res.statusCode });
      res.resume();
      res.on('close', function () { resolve({ closed: true, ms: Date.now() - t0, code: res.statusCode }) });
    });
    req.on('error', function () { resolve({ closed: true, ms: Date.now() - t0, code: 0 }) });
    req.end();
    setTimeout(function () { try { req.destroy() } catch (e) {} resolve({ closed: false, ms: Date.now() - t0, code: 200 }) }, 5000);
  });
}
/* raw socket：发原始 HTTP 请求（测畸形请求目标不崩进程，P0 红对照） */
function rawReq (port, payload) {
  return new Promise(function (resolve) {
    let b = ''
    const sock = net.connect(port, '127.0.0.1', function () { sock.write(payload) })
    sock.on('data', function (c) { b += c })
    sock.on('close', function () { resolve(b) })
    sock.on('error', function () { resolve(b) })
    setTimeout(function () { try { sock.destroy() } catch (e) {} resolve(b) }, 3000)
  })
}
function j (b) { try { return JSON.parse(b) } catch (e) { return null } }
function newSandbox (tag) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-pass-' + tag + '-'));
  fs.mkdirSync(path.join(box, 'config'), { recursive: true });
  fs.mkdirSync(path.join(box, 'data'), { recursive: true });
  fs.writeFileSync(path.join(box, 'config', 'auth.txt'), SAND_MAIN + '\n');
  return box;
}
function spawnProxy (box, port, extraEnv) {
  const env = Object.assign({}, process.env, { LITTLEDJ_PORT: String(port), LITTLEDJ_ROOT: box }, extraEnv || {});
  return spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: env, stdio: 'ignore' });
}
function waitUp (port, tries) {
  const n = tries || 60;
  return new Promise(function (resolve) {
    let i = 0;
    (function t () {
      httpReq(port, null, 'GET', '/_auth').then(function (r) { resolve(true) }).catch(function () {
        i++; if (i >= n) return resolve(false); setTimeout(t, 250);
      });
    })();
  });
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) };
function cookieOf (headers) {
  const sc = headers && headers['set-cookie'];
  if (!sc || !sc.length) return '';
  return String(sc[0]).split(';')[0];
}

async function main () {
  /* ---------- ① 静态断言 ---------- */
  const px = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8');
  /* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本）+ index.html 原文（HTML/CSS/verText 锚点仍在这） */
  const ui = require('./selftest-load-ui').loadUiSource(path.join(__dirname, '..', 'ui'))
    + '\n' + fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  ok('proxy 通行证锚点（dj_pass/_login/_auth/_logout/_devices）', /PASS_COOKIE = 'dj_pass'/.test(px) && /pn === '\/_login'/.test(px) && /pn === '\/_auth'/.test(px) && /pn === '\/_logout'/.test(px) && /pn === '\/_devices'/.test(px));
  ok('proxy A7a/A7b 判定器在位', /function pubnetDeny/.test(px) && /function basicOnlyFace/.test(px) && /PUBNET_DENY_WRITE/.test(px));
  ok('proxy 数据面 401 无 WWW-Authenticate 挑战（主 gate，仅注释中允许出现）', /Auth required/.test(px) && !/['"]WWW-Authenticate['"]/.test(px));
  ok('ui 登录卡片+自愈在位 & 设备区前台退役（task365：djDevicesRender/djDevSec 零命中）', /djLoginMask/.test(ui) && /function renderLoginCard/.test(ui) && /function sseAuthSelfheal/.test(ui) && !/djDevicesRender/.test(ui) && !/djDevSec/.test(ui) && /bootReal/.test(ui));
  const verAll = (ui.match(/personal agent · v[\d.]+/g) || []);
  ok('verText 三处同版本无混用', verAll.length >= 3 && verAll.filter(function (v, i) { return verAll.indexOf(v) === i }).length === 1);
  ok('proxy execAuthed 红线一字未动（仅认 AUTH_EXPECT）', /function execAuthed\(req\) \{\s*return \(req\.headers\['authorization'\] \|\| ''\) === AUTH_EXPECT\s*\}/.test(px));
  /* A8（产出审 P1-4）：push.sh 拒推正则含设备表/密钥 + 样例命中 */
  /* 开源版：push.sh 未随仓库发布，缺失时 A8 读文件项不适用 */
  const pushHere = fs.existsSync(path.join(__dirname, 'push.sh'));
  const pushSrc = pushHere ? fs.readFileSync(path.join(__dirname, 'push.sh'), 'utf8') : '';
  ok('push.sh 拒推正则含 device-key/devices.json', !pushHere || (/device-key\[\^\/\]\*\$/.test(pushSrc) && /devices\\\.json/.test(pushSrc)));
  ok('push.sh 正则样例命中（device-key.txt.bak-task295 / devices.json）', new RegExp('device-key[^/]*$').test('device-key.txt.bak-task295') && new RegExp('devices\\.json$').test('devices.json'));

  /* ---------- ② E2E 主沙箱 ---------- */
  const box1 = newSandbox('e2e');
  fs.writeFileSync(path.join(box1, 'config', 'auth-ext.txt'), SAND_EXT + '\n');
  const P1 = 4300 + Math.floor(Math.random() * 60);
  const proc1 = spawnProxy(box1, P1, { AUTH_LOCK_OFF: '1' });
  const up1 = await waitUp(P1);
  ok('沙箱 proxy 启动就绪', up1 === true);

  /* A4 壳白名单 */
  const shell = await httpReq(P1, null, 'GET', '/');
  ok('未认证 GET / 放行（登录卡片壳）+XFO DENY+no-cache', shell.code === 200 && shell.headers['x-frame-options'] === 'DENY' && /no-cache/.test(String(shell.headers['cache-control'])));
  const shellV = await httpReq(P1, null, 'GET', '/?v=1731');
  ok('壳白名单 ?v= 查询剥离放行', shellV.code === 200);
  const shellIcon = await httpReq(P1, null, 'GET', '/favicon.ico');
  ok('壳白名单 /favicon.ico 放行', shellIcon.code === 200 || shellIcon.code === 404 /* 生产图标存在；沙箱 UI_DIR 共用生产 ui，应 200 */);
  const denyMd = await httpReq(P1, null, 'GET', '/README.md');
  ok('白名单外静态默认 401（README.md）', denyMd.code === 401);
  /* task369 断言同轮反转（L-086）：模块化后 /src/** 属于静态壳——未登录访客拿不到 /src/app/boot.js
     就连登录卡片都渲染不出来，页面只剩静态死壳「打开了没有反应」（2026-11-17 主人实测）。
     数据面仍全程鉴权（下面 /_dirs 401 断言兜底）。 */
  const shellSrc = await httpReq(P1, null, 'GET', '/src/app/boot.js');
  ok('task369：/src 模块匿名可取（登录卡片可达）', shellSrc.code === 200);

  /* 401 无挑战 */
  const noAuth = await httpReq(P1, null, 'GET', '/_dirs');
  ok('数据面 401 无 WWW-Authenticate 挑战头', noAuth.code === 401 && !noAuth.headers['www-authenticate']);

  /* /_auth 仅认 cookie */
  const probeNaked = await httpReq(P1, null, 'GET', '/_auth');
  ok('/_auth 无凭据 401（无挑战）', probeNaked.code === 401 && !probeNaked.headers['www-authenticate']);
  const probeBasic = await httpReq(P1, MAIN_B64, 'GET', '/_auth');
  ok('/_auth 带 Basic 也 401（仅认 cookie，R2-P2-1）', probeBasic.code === 401);

  /* /_login 内网 */
  const badLogin = await httpReq(P1, null, 'POST', '/_login', { user: 'sandbox', pass: 'wrong' });
  ok('/_login 错密码 401 统一文案（不区分用户/密码错）', badLogin.code === 401 && /用户名或密码不对/.test(badLogin.body));
  const loginMain = await httpReq(P1, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123', name: '测试手机' });
  const scMain = loginMain.headers['set-cookie'] && String(loginMain.headers['set-cookie'][0]);
  ok('/_login 内网主密码成功+Set-Cookie 属性（HttpOnly/Lax/无 Secure）', loginMain.code === 200 && /dj_pass=/.test(scMain) && /HttpOnly/.test(scMain) && /SameSite=Lax/.test(scMain) && !/Secure/.test(scMain));
  const ckMain = cookieOf(loginMain.headers);
  const loginExt = await httpReq(P1, null, 'POST', '/_login', { user: 'sandbox', pass: 'ext-pass-456', name: '外网机' });
  ok('/_login 内网 auth-ext 也成功', loginExt.code === 200);

  /* cookie 过 gate */
  const ckDir = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: ckMain });
  ok('cookie 过 gate（/_dirs 200）', ckDir.code === 200);
  const ckProbe = await httpReq(P1, null, 'GET', '/_auth', undefined, { Cookie: ckMain });
  ok('/_auth cookie 200 回 did+name', ckProbe.code === 200 && (j(ckProbe.body) || {}).did && (j(ckProbe.body) || {}).name === '测试手机');

  /* 红对照：篡改/过期/多段/超长 */
  const bad1 = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: ckMain.replace(/.$/, ckMain.slice(-1) === 'a' ? 'b' : 'a') });
  ok('篡改 hmac 尾位 → 401', bad1.code === 401);
  const seg = ckMain.split('.');
  const bad2 = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: seg[0] + '.1000.' + seg[2] });
  ok('过期 exp → 401', bad2.code === 401);
  const bad3 = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: 'dj_pass=' + 'a'.repeat(16) + '.' + String(Date.now() + 864000000) + '.' + 'z'.repeat(64) });
  ok('非 hex 红对照 → 401', bad3.code === 401);
  const bad4 = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: 'dj_pass=xx.yy.zz.uu.vv; ' + ckMain });
  ok('多段畸形不炸且正牌仍认（取有效段）', bad4.code === 200);
  const bad5 = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: 'dj_pass=' + ckMain.slice(8) + 'AAAA' });
  ok('超长畸形 → 401', bad5.code === 401);

  /* A3 外网收窄（X-Real-IP） */
  const wanMain = await httpReq(P1, MAIN_B64, 'GET', '/_dirs', undefined, { 'X-Real-IP': '9.9.9.9' });
  ok('外网模拟+主密码 Basic → 401（A3）', wanMain.code === 401);
  const wanExt = await httpReq(P1, EXT_B64, 'GET', '/_dirs', undefined, { 'X-Real-IP': '9.9.9.9' });
  ok('外网模拟+auth-ext Basic → 200（A3）', wanExt.code === 200);
  const wanCookie = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: ckMain, 'X-Real-IP': '9.9.9.9' });
  ok('外网模拟+cookie → 200（内外网均认）', wanCookie.code === 200);
  const wanLoginMain = await httpReq(P1, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123' }, { 'X-Real-IP': '9.9.9.9' });
  ok('外网 /_login 主密码 → 401（A2 外网只验 auth-ext）', wanLoginMain.code === 401);
  const wanLoginExt = await httpReq(P1, null, 'POST', '/_login', { user: 'sandbox', pass: 'ext-pass-456' }, { 'X-Real-IP': '9.9.9.9' });
  const scWan = wanLoginExt.headers['set-cookie'] && String(wanLoginExt.headers['set-cookie'][0]);
  ok('外网 /_login auth-ext → 200+Secure（A2）', wanLoginExt.code === 200 && /Secure/.test(scWan));

  /* A7a 公网 403 清单 */
  const t1 = await httpReq(P1, EXT_B64, 'PUT', '/_settings/prompts', { x: 1 }, { 'X-Real-IP': '9.9.9.9' });
  ok('A7a：公网 PUT /_settings/prompts → 403', t1.code === 403);
  const t2 = await httpReq(P1, EXT_B64, 'POST', '/_settings/deepseek', { apiKey: 'sk-test' }, { 'X-Real-IP': '9.9.9.9' });
  ok('A7a：公网 POST /_settings/deepseek（换 Key）→ 403', t2.code === 403);
  const t3 = await httpReq(P1, EXT_B64, 'GET', '/_fs/home/read?path=/tmp', undefined, { 'X-Real-IP': '9.9.9.9' });
  ok('A7a：公网 GET /_fs/home/read → 403', t3.code === 403);
  const t4 = await httpReq(P1, EXT_B64, 'POST', '/_fs/rmdir', { p: '/tmp/xx' }, { 'X-Real-IP': '9.9.9.9' });
  ok('A7a：公网 POST /_fs/rmdir → 403', t4.code === 403);
  const t5 = await httpReq(P1, EXT_B64, 'POST', '/_profile', { x: 1 }, { 'X-Real-IP': '9.9.9.9' });
  ok('A7a：公网 POST /_profile → 403', t5.code === 403);
  const c1 = await httpReq(P1, MAIN_B64, 'PUT', '/_settings/prompts', { x: 1 });
  ok('A7a 内网对照：无 XRI 同路径不 403', c1.code !== 403);

  /* A7b Basic-only */
  const b1 = await httpReq(P1, null, 'GET', '/_vault', undefined, { Cookie: ckMain });
  ok('A7b：cookie GET /_vault → 401', b1.code === 401);
  const b2 = await httpReq(P1, MAIN_B64, 'GET', '/_vault');
  ok('A7b 内网对照：Basic GET /_vault → 200（空库）', b2.code === 200);
  const b3 = await httpReq(P1, null, 'GET', '/_settings/deepseek/active', undefined, { Cookie: ckMain });
  ok('A7b：cookie GET /_settings/deepseek/active → 401', b3.code === 401);

  /* _devices */
  const dv = await httpReq(P1, null, 'GET', '/_devices', undefined, { Cookie: ckMain });
  const dvList = (j(dv.body) || {}).devices || [];
  ok('GET /_devices cookie 可达且含已登设备', dv.code === 200 && dvList.length >= 2);
  const kick1 = await httpReq(P1, null, 'POST', '/_devices', { did: dvList[0].did }, { Cookie: ckMain });
  ok('POST /_devices 踢除无 Basic → 401（防被窃 cookie 反踢）', kick1.code === 401);

  /* SSE 断流 + logout 吊销 */
  const sseT0 = Date.now();
  const sseP = sseProbe(P1, ckMain, '/_tui/event');
  await sleep(400);
  const lg = await httpReq(P1, null, 'POST', '/_logout', {}, { Cookie: ckMain });
  ok('/_logout 200+清 cookie', lg.code === 200);
  const sseR = await sseP;
  ok('A6：logout 后 SSE(_tui/event) ≤2s 断流（实测断流 ' + sseR.ms + 'ms）', sseR.closed === true && sseR.ms <= 2500, JSON.stringify(sseR));
  const afterRevoke = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: ckMain });
  ok('吊销后旧 cookie → 401（即时失效）', afterRevoke.code === 401);

  /* 产出审 P1-4/P2-14：other 位断言（设备表在用有效 cookie 前采集） */
  const keySt = fs.statSync(path.join(box1, 'config', 'device-key.txt'));
  ok('A8：device-key.txt other 位为 0', (keySt.mode & 0o007) === 0, 'mode=' + (keySt.mode & 0o777).toString(8));
  /* 产出审 P2-新2：lastSeenAt 5min 节流——新登一台有效设备，窗口内连打不刷新 lastSeenAt（原断言用已吊销 cookie 属假阳性） */
  const loginC = await httpReq(P1, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123', name: '节流探针' });
  const ckC = cookieOf(loginC.headers);
  const readDev = function (nm) {
    try {
      const arr = (JSON.parse(fs.readFileSync(path.join(box1, 'config', 'devices.json'), 'utf8')) || {}).devices || [];
      return arr.filter(function (d) { return d.name === nm })[0] || null;
    } catch (e) { return null }
  };
  const ls0 = readDev('节流探针');
  const devStat0 = fs.statSync(path.join(box1, 'config', 'devices.json'));
  ok('A8：devices.json other 位为 0', (devStat0.mode & 0o007) === 0, 'mode=' + (devStat0.mode & 0o777).toString(8));
  for (let i = 0; i < 3; i++) await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: ckC });
  const ls1 = readDev('节流探针');
  ok('lastSeenAt 5min 节流：窗口内连打不刷新 lastSeenAt/不落盘', ls0 && ls1 && ls0.lastSeenAt === ls1.lastSeenAt && fs.statSync(path.join(box1, 'config', 'devices.json')).mtimeMs === devStat0.mtimeMs);

  /* 路径混淆红对照 */
  const p1 = await httpReq(P1, null, 'GET', '//_vault');
  ok('路径混淆 //_vault → 归一到壳/401，绝不回 vault JSON', p1.code === 401 || (p1.code === 200 && String(p1.headers['content-type'] || '').indexOf('text/html') === 0));
  const p2 = await httpReq(P1, null, 'GET', '/api/../_vault');
  ok('路径混淆 /api/../_vault → 401（gate 前置不绕过）', p2.code === 401);
  const p3 = await httpReq(P1, null, 'GET', '/_vault%2f');
  ok('路径混淆 /_vault%2f → 401/404（不命中 vault）', p3.code === 401 || p3.code === 404);
  const p4 = await httpReq(P1, null, 'GET', '/%2e%2e/vault');
  ok('路径混淆 /%2e%2e/vault → 401/404（不越界）', p4.code === 401 || p4.code === 404);

  /* 匿名探针不计数（锁定关掉的前提下无法测 429，这里测不误伤：连打 10 次仍 401 而非 5xx） */
  let anonOk = true;
  for (let i = 0; i < 10; i++) { const r = await httpReq(P1, null, 'GET', '/_auth'); if (r.code !== 401) anonOk = false }
  ok('匿名 /_auth ×10 全 401（不误伤不熔断）', anonOk === true);
  /* 产出审 P1-1：通用 gate 匿名 401 不计数（旧 PWA SSE 重连场景）——10 次匿名 /_dirs 后仍 401 非 429 */
  let anonGateOk = true;
  for (let i = 0; i < 10; i++) { const r = await httpReq(P1, null, 'GET', '/_dirs'); if (r.code !== 401) anonGateOk = false }
  ok('通用 gate 匿名 /_dirs ×10 全 401 不锁（只计携带凭据失败）', anonGateOk === true);
  /* 产出审 P0 红对照：畸形请求目标不得崩进程（/\ 与 absolute-form 非法端口） */
  const rawBad1 = await rawReq(P1, 'GET /\\ HTTP/1.1\r\nHost: x\r\n\r\n');
  ok('P0 红对照：GET /\\ → 400 不崩', /400 Bad Request/.test(rawBad1), rawBad1.split('\r\n')[0]);
  const rawBad2 = await rawReq(P1, 'GET http://a:99999/ HTTP/1.1\r\nHost: x\r\n\r\n');
  ok('P0 红对照：absolute-form 非法端口 → 400 不崩', /400 Bad Request/.test(rawBad2), rawBad2.split('\r\n')[0]);
  const aliveAfterRaw = await httpReq(P1, null, 'GET', '/_auth');
  ok('P0 红对照：畸形请求后进程存活（/_auth 仍 401）', aliveAfterRaw.code === 401);

  /* ---------- task369：桌面票据登录（/_ticket 须 Basic → 票 URL → 302+Set-Cookie → cookie 过 gate） ---------- */
  const tkAnon = await httpReq(P1, null, 'GET', '/_ticket');
  ok('task369：/_ticket 匿名 401（现签票据须 Basic）', tkAnon.code === 401);
  const tkMain = await httpReq(P1, MAIN_B64, 'GET', '/_ticket');
  const tkBody = j(tkMain.body) || {};
  ok('task369：/_ticket 出票（5 分钟内有效，票面 /_login?e&k 格式）', tkMain.code === 200 && tkBody.ok === true && /^\/_login\?e=\d+&k=[0-9a-f]{64}$/.test(String(tkBody.url || '')) && Number(tkBody.exp) > Date.now());
  const tkGet = await httpReq(P1, null, 'GET', String(tkBody.url || '/'), undefined, { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/157.0.0.0' });
  const tkCookie = String(tkGet.headers['set-cookie'] || '').match(/dj_pass=[^;]+/);
  ok('task369：票据登录 302 回 / + Set-Cookie 90 天', tkGet.code === 302 && tkGet.headers.location === '/' && !!tkCookie);
  if (tkCookie) {
    const tkAuth = await httpReq(P1, null, 'GET', '/_auth', undefined, { Cookie: tkCookie[0] });
    ok('task369：票据 cookie 过 gate（/_auth 200）', tkAuth.code === 200);
    const tkDv = await httpReq(P1, MAIN_B64, 'GET', '/_devices');
    const tkList = (j(tkDv.body) || {}).devices || [];
    ok('task369：票据设备按「Windows 电脑」槽位入表且未吊销', tkList.some(function (d) { return d.name === 'Windows 电脑' && !d.revoked; }));
  }
  const tkBad = await httpReq(P1, null, 'GET', '/_login?e=' + Date.now() + '&k=' + '0'.repeat(64));
  ok('task369：伪造票据 403（红对照）', tkBad.code === 403);

  /* ---------- ③ devices 表 fail-closed 分层：仅主表坏 → .bak 恢复；主表+.bak 全坏 → cookie 全拒 ---------- */
  const ckB = cookieOf(loginExt.headers);
  proc1.kill('SIGKILL');
  await sleep(300);
  fs.writeFileSync(path.join(box1, 'config', 'devices.json'), '{broken json!!');
  const proc2 = spawnProxy(box1, P1, { AUTH_LOCK_OFF: '1' });
  const up2 = await waitUp(P1);
  ok('仅主表坏：proxy 正常启动且 .bak 自动恢复（设计行为）', up2 === true);
  const fbBak = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: ckB });
  ok('仅主表坏：.bak 内旧 cookie 仍有效（恢复成功）', fbBak.code === 200);
  proc2.kill('SIGKILL');
  await sleep(300);
  fs.writeFileSync(path.join(box1, 'config', 'devices.json'), '{broken json!!');
  fs.writeFileSync(path.join(box1, 'config', 'devices.json.bak'), 'also broken ###');
  const proc2b = spawnProxy(box1, P1, { AUTH_LOCK_OFF: '1' });
  const up2b = await waitUp(P1);
  ok('主表+.bak 全坏：proxy 正常启动（fail-closed 不炸）', up2b === true);
  const fb1 = await httpReq(P1, null, 'GET', '/_dirs', undefined, { Cookie: ckB });
  ok('全坏 → cookie 全拒（fail-closed）', fb1.code === 401);
  const fb2 = await httpReq(P1, MAIN_B64, 'GET', '/_dirs');
  ok('全坏 → Basic 兜底照常 200', fb2.code === 200);
  proc2b.kill('SIGKILL');

  /* ---------- ④ 限流沙箱（AUTH_LOCK_MAX=3） ---------- */
  const box2 = newSandbox('lock');
  fs.writeFileSync(path.join(box2, 'config', 'auth-ext.txt'), SAND_EXT + '\n');
  const P2 = 4400 + Math.floor(Math.random() * 60);
  const proc3 = spawnProxy(box2, P2, { AUTH_LOCK_MAX: '3', AUTH_LOCK_MS: '60000' });
  const up3 = await waitUp(P2);
  ok('限流沙箱启动就绪', up3 === true);
  let lockHit = false, retryAfter = false;
  for (let i = 0; i < 5; i++) {
    const r = await httpReq(P2, null, 'POST', '/_login', { user: 'sandbox', pass: 'bad-' + i });
    if (r.code === 429) { lockHit = true; if (r.headers['retry-after']) retryAfter = true }
  }
  ok('错密码 ×N → 429 锁定（含 Retry-After）', lockHit === true && retryAfter === true);
  const unlockTry = await httpReq(P2, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123' });
  ok('锁定期正确密码放行（task303-fu1 同源：输对即解锁）', unlockTry.code === 200, 'code=' + unlockTry.code);
  const afterUnlock = await httpReq(P2, null, 'POST', '/_login', { user: 'sandbox', pass: 'wrong-again' });
  ok('解锁后错密码回 401（计数已清零）', afterUnlock.code === 401);
  /* P2-14：X-Real-IP 分桶独立（1.1.1.1 锁不影响 2.2.2.2） */
  for (let i = 0; i < 3; i++) await httpReq(P2, null, 'POST', '/_login', { user: 'sandbox', pass: 'bad' }, { 'X-Real-IP': '1.1.1.1' });
  const bucketLocked = await httpReq(P2, null, 'POST', '/_login', { user: 'sandbox', pass: 'bad' }, { 'X-Real-IP': '1.1.1.1' });
  const bucketOther = await httpReq(P2, null, 'POST', '/_login', { user: 'sandbox', pass: 'ext-pass-456' }, { 'X-Real-IP': '2.2.2.2' });
  ok('X-Real-IP 分桶：锁 1.1.1.1 不影响 2.2.2.2（外网语义用 auth-ext）', bucketLocked.code === 429 && bucketOther.code === 200, 'locked=' + bucketLocked.code + ' other=' + bucketOther.code);
  /* 产出审 P2-新3：匿名 401 不计数——限流沙箱（AUTH_LOCK_MAX=3）有区分力验证：
     若匿名计数，5 次匿名 /_dirs 后第 6 次会 429；正确行为=始终 401 */
  for (let i = 0; i < 5; i++) await httpReq(P2, null, 'GET', '/_dirs', undefined, { 'X-Real-IP': '3.3.3.3' });
  const anonAfter = await httpReq(P2, null, 'GET', '/_dirs', undefined, { 'X-Real-IP': '3.3.3.3' });
  ok('限流沙箱：5 次匿名 401 后仍 401 非 429（有区分力）', anonAfter.code === 401, 'code=' + anonAfter.code);
  proc3.kill('SIGKILL');

  /* ---------- 汇总 ---------- */
  console.log(JSON.stringify({ suite: 'task295-pass', pass: out.pass, fail: out.fail }, null, 2));
  out.items.filter(function (x) { return !x.ok }).forEach(function (x) { console.log('FAIL: ' + x.name + (x.detail ? ' | ' + x.detail : '')) });
  process.exit(out.fail ? 1 : 0);
}
main().catch(function (e) { console.error('SUITE ERROR: ' + (e && e.stack)); process.exit(2) });

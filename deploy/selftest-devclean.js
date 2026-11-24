#!/usr/bin/env node
/* task359 自测：设备垃圾后台自动清理
   覆盖：
   ① 静态断言：proxy 锚点（isToolUa / TOOL_TTL_MS / 小时巡扫 unref / _devices 过滤）
   ② E2E 沙箱（AUTH_LOCK_OFF=1 + LITTLEDJ_TOOL_TTL_MS=1200 短 TTL）：
      浏览器 UA 登录登记 / 工具 UA（curl）登录登记 / TTL 内工具通行证可用 /
      GET /_devices 不返回工具设备（前台零显示=API 层过滤）/
      TTL 到点 + 登录触发 flush → 工具设备自动吊销（devices.json revoked:true + 旧 cookie 401）/
      浏览器设备不受影响 / malformed Windows UA（Mozilla 前缀）按浏览器归类不自动吊销（分类边界钉死）
   沙箱：LITTLEDJ_ROOT 指向临时目录 + 合成 auth.txt（不碰生产凭据与设备表） */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawn } = require('child_process');

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}
const SAND_MAIN = 'sandbox:main-pass-123';
const MAIN_B64 = Buffer.from(SAND_MAIN).toString('base64');

function httpReq (port, auth, method, p, obj, header) {
  return new Promise(function (resolve, reject) {
    const data = obj === undefined ? null : JSON.stringify(obj);
    const headers = {};
    if (auth) headers.Authorization = 'Basic ' + auth;
    if (header) Object.assign(headers, header);
    if (data !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      let b = ''; res.on('data', function (c) { b += c }); res.on('end', function () { resolve({ code: res.statusCode, body: b, headers: res.headers }) });
    });
    req.on('error', function (e) { reject(e) });
    if (data !== null) req.write(data);
    req.end();
  });
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) };
function cookieOf (headers) {
  const sc = headers && headers['set-cookie'];
  if (!sc || !sc.length) return '';
  return String(sc[0]).split(';')[0];
}
function j (b) { try { return JSON.parse(b) } catch (e) { return null } }
function newSandbox (tag) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-devclean-' + tag + '-'));
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
      httpReq(port, null, 'GET', '/_auth').then(function () { resolve(true) }).catch(function () {
        i++; if (i >= n) return resolve(false); setTimeout(t, 250);
      });
    })();
  });
}

async function main () {
  /* ---------- ① 静态断言 ---------- */
  const px = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8');
  ok('proxy task359 锚点：isToolUa + TOOL_TTL_MS + env 覆盖', /function isToolUa/.test(px) && /TOOL_TTL_MS/.test(px) && /LITTLEDJ_TOOL_TTL_MS/.test(px));
  ok('工具判定口径：非 Mozilla/ 前缀即工具', /!\^\\?\\?\/\^Mozilla\\\//.test(px) || /indexOf\('Mozilla\/'\) !== 0/.test(px) || /\/\^Mozilla\\\/\//.test(px));
  ok('小时级巡扫在位且 unref（不阻退出）', /60 \* 60 \* 1000/.test(px) && /unref/.test(px));
  ok('flush 内工具自动吊销（task359 注释锚）', /task359/.test(px) && /自动吊销|自动清理/.test(px));
  ok('GET /_devices 过滤工具设备（前台零显示=后台做）', /handleDevices/.test(px) && /isToolUa/.test(px));

  /* ---------- ② E2E 沙箱（短 TTL） ---------- */
  const box = newSandbox('e2e');
  const P = 4500 + Math.floor(Math.random() * 60);
  const proc = spawnProxy(box, P, { AUTH_LOCK_OFF: '1', LITTLEDJ_TOOL_TTL_MS: '1200' });
  const up = await waitUp(P);
  ok('沙箱 proxy 启动就绪', up === true);

  const UA_BROWSER = 'Mozilla/5.0 (PC; OpenHarmony 7.0) AppleWebKit/537.36';
  const UA_TOOL = 'curl/8.8.0-DEV';
  const UA_MALFORMED = 'Mozilla/5.0 (Windows NT; Windows NT 10.0; Win64; x64';

  const lgA = await httpReq(P, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123', name: '主力机' }, { 'User-Agent': UA_BROWSER });
  const ckA = cookieOf(lgA.headers);
  ok('浏览器 UA 登录成功', lgA.code === 200 && /dj_pass=/.test(ckA));
  const lgB = await httpReq(P, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123', name: '冒烟机' }, { 'User-Agent': UA_TOOL });
  const ckB = cookieOf(lgB.headers);
  ok('工具 UA 登录成功（测试链不受影响）', lgB.code === 200 && /dj_pass=/.test(ckB));
  const lgM = await httpReq(P, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123', name: '畸形UA机' }, { 'User-Agent': UA_MALFORMED });
  ok('malformed Mozilla 前缀 UA 登录成功', lgM.code === 200);

  const probeB1 = await httpReq(P, null, 'GET', '/_auth', undefined, { Cookie: ckB });
  ok('TTL 内工具通行证可用（/_auth 200）', probeB1.code === 200);

  const dev1 = await httpReq(P, null, 'GET', '/_devices', undefined, { Cookie: ckA });
  const names1 = ((j(dev1.body) || {}).devices || []).map(function (d) { return d.name });
  ok('GET /_devices 不返回工具设备（前台零显示）', dev1.code === 200 && names1.indexOf('冒烟机') < 0);
  ok('GET /_devices 返回浏览器设备（含畸形 UA 机）', names1.indexOf('主力机') >= 0 && names1.indexOf('畸形UA机') >= 0);

  /* TTL 到点（1200ms）后用一次登录触发 flush → 工具设备自动吊销 */
  await sleep(1600);
  const lgC = await httpReq(P, null, 'POST', '/_login', { user: 'sandbox', pass: 'main-pass-123', name: '触发机' }, { 'User-Agent': UA_BROWSER });
  ok('TTL 到点后再登录触发 flush 成功', lgC.code === 200);

  let dj = null;
  try { dj = JSON.parse(fs.readFileSync(path.join(box, 'config', 'devices.json'), 'utf8')) } catch (e) {}
  const byName = {};
  ((dj && dj.devices) || []).forEach(function (d) { byName[d.name] = d });
  ok('devices.json：工具设备已被自动吊销（revoked:true）', byName['冒烟机'] && byName['冒烟机'].revoked === true);
  ok('devices.json：浏览器设备不受影响（revoked:false）', byName['主力机'] && byName['主力机'].revoked === false && byName['畸形UA机'] && byName['畸形UA机'].revoked === false);

  const probeB2 = await httpReq(P, null, 'GET', '/_auth', undefined, { Cookie: ckB });
  ok('工具通行证吊销后即时 401', probeB2.code === 401);
  const probeA2 = await httpReq(P, null, 'GET', '/_auth', undefined, { Cookie: ckA });
  ok('浏览器通行证不受影响（/_auth 200）', probeA2.code === 200);
  const dev2 = await httpReq(P, null, 'GET', '/_devices', undefined, { Cookie: ckA });
  const names2 = ((j(dev2.body) || {}).devices || []).map(function (d) { return d.name });
  ok('吊销后 /_devices 列表仍干净（无冒烟机）', dev2.code === 200 && names2.indexOf('冒烟机') < 0);
  proc.kill('SIGKILL');
  try { fs.rmSync(box, { recursive: true, force: true }) } catch (e) {}

  /* ---------- 汇总 ---------- */
  console.log(JSON.stringify({ suite: 'task359-devclean', pass: out.pass, fail: out.fail }, null, 2));
  out.items.filter(function (x) { return !x.ok }).forEach(function (x) { console.log('FAIL: ' + x.name + (x.detail ? ' | ' + x.detail : '')) });
  process.exit(out.fail ? 1 : 0);
}
main().catch(function (e) { console.error('SUITE ERROR: ' + (e && e.stack)); process.exit(2) });

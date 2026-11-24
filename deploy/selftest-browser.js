#!/usr/bin/env node
/*
 * task245：页内自检机器人 runner（跨端：设备上跑 / Windows 上跑都行）
 *
 * 原理：proxy 只有一个「待跑请求」文件；已打开的页面每 2.5s 接单，在**真实浏览器**里跑断言，
 * 把结果 POST 回 proxy 落盘。本脚本负责下单 + 等结果 + 打印/判定退出码。
 *
 * 用法：
 *   node deploy/selftest-browser.js --suite sidebar
 *   node deploy/selftest-browser.js --suite newproj --base http://127.0.0.1:4097
 *   node deploy/selftest-browser.js --suite dag --base http://192.0.2.10:4097 --auth dj:0000 --json
 *
 * 退出码：0=通过；1=断言失败；2=超时（页面没开/没接单）
 */
'use strict';
const http = require('http');
const https = require('https');
const { URL } = require('url');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const SUITE = arg('suite', '');
const BASE = arg('base', process.env.LITTLEDJ_BASE || 'http://127.0.0.1:4097').replace(/\/$/, '');
const AUTH = arg('auth', process.env.LITTLEDJ_AUTH || '');
const WAIT = Number(arg('wait', '30')) * 1000;
const AS_JSON = process.argv.indexOf('--json') >= 0;

if (!SUITE) {
  console.error('用法：node deploy/selftest-browser.js --suite <sidebar|newproj|dag> [--base URL] [--auth u:p] [--wait 秒] [--json]');
  process.exit(2);
}

function request(method, path, body) {
  return new Promise(function (resolve, reject) {
    const u = new URL(BASE + path);
    const mod = u.protocol === 'https:' ? https : http;
    const data = body == null ? null : Buffer.from(JSON.stringify(body), 'utf8');
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = data.length; }
    if (AUTH) headers.Authorization = 'Basic ' + Buffer.from(AUTH).toString('base64');
    const req = mod.request({
      protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search, method: method, headers: headers, timeout: 15000
    }, function (res) {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', function (c) { buf += c; });
      res.on('end', function () {
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) {}
        resolve({ status: res.statusCode, body: parsed, raw: buf });
      });
    });
    req.on('timeout', function () { req.destroy(new Error('timeout')) });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async function () {
  const q = await request('POST', '/_selftest/request', { suite: SUITE, by: 'selftest-browser' });
  if (q.status !== 200 || !q.body || !q.body.ok) {
    console.error('下单失败：HTTP ' + q.status + ' ' + (q.raw || '').slice(0, 200));
    process.exit(2);
  }
  const id = q.body.id;
  const deadline = Date.now() + WAIT;
  let hit = null;
  while (Date.now() < deadline) {
    await sleep(1200);
    const r = await request('GET', '/_selftest/reports?limit=8');
    const list = (r.body && r.body.reports) || [];
    hit = list.filter(function (x) { return x.id === id })[0] || null;
    if (hit) break;
  }
  if (!hit) {
    const msg = '超时：页面没开或没接单（请在浏览器里打开 ' + BASE + ' 后重试；请求 2 分钟过期）';
    if (AS_JSON) console.log(JSON.stringify({ ok: false, suite: SUITE, id: id, error: msg }, null, 2));
    else console.error('❌ ' + msg);
    process.exit(2);
  }
  if (AS_JSON) {
    console.log(JSON.stringify({ ok: true, suite: SUITE, id: id, pass: hit.pass, assertions: hit.assertions, snapshot: hit.snapshot, file: hit.file }, null, 2));
  } else {
    console.log('套件：' + SUITE + '  请求 id：' + id);
    (hit.assertions || []).forEach(function (a) {
      console.log((a.ok ? 'PASS ' : 'FAIL ') + a.name + (a.extra ? '  [' + a.extra + ']' : ''));
    });
    const snap = hit.snapshot || {};
    console.log('快照：版本 ' + (snap.ver || '?') + ' · 项目行 ' + JSON.stringify(snap.rows || []) + ' · 视口 ' + snap.w + 'x' + snap.h);
    console.log(hit.pass ? 'RESULT: PASS（' + (hit.assertions || []).length + ' 项，真浏览器）' : 'RESULT: FAIL（真浏览器）');
  }
  process.exit(hit.pass ? 0 : 1);
})().catch(function (e) {
  console.error('FAIL: ' + e.message);
  process.exit(2);
});

#!/usr/bin/env node
/* task221 自测：/_exec 端点（DJH 最高权限通道）
   用法：node deploy/selftest-exec.js [--json]
   覆盖：①纯函数（vm 提取）：execIpPrivate 私网判定 / execCutStr 代理对安全截断 / execOutLimiter 边收边截
        ②E2E 隔离实例（临时 ROOT + 自造凭据 + 127.0.0.1 随机端口）：
          401 无凭据 / GET 405 / echo 200 / exit code 透传 / stderr / 超时 timedOut /
          并发 429 / X-Real-IP 403（P0-1 公网穿透闸）/ ext 外网凭据 403（P0-1）/
          cwd 相对 400 / cmd 空 400 / 大输出截断上限 / 审计 jsonl 落盘
        ③红对照：去掉 X-Real-IP 闸的副本必须放行→证明绿版 403 断言有效咬合
   沙箱：LITTLEDJ_ROOT=临时目录 + 自造 auth.txt/auth-ext.txt，绝不读真实密码、不污染生产 data/ */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const vm = require('vm');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-exec-'));
const PROXY = path.join(__dirname, '..', 'server', 'proxy.js');
// 产出审 P2：红对照副本放沙箱（不落工作区），复制 skills + symlink node_modules 保证 require 解析
const RED_DIR = path.join(SANDBOX, 'server-copy');
const RED_COPY = path.join(RED_DIR, 'proxy.js');
const AUTH = 'dj:testpass-221';
const AUTH_EXT = 'djext:extpass-221';

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}
function b64 (s) { return Buffer.from(s).toString('base64'); }

/* ---------- ① 纯函数 vm 提取 ---------- */
const src = fs.readFileSync(PROXY, 'utf8');
function grab (name) {
  const re = new RegExp('function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}');
  const m = src.match(re);
  return m ? m[0] : null;
}
const fnParts = ['execIpPrivate', 'execCutStr', 'execOutLimiter'].map(grab);
const fnSrc = fnParts.filter(Boolean).join('\n');
let pure = null;
if (fnParts.every(Boolean)) {
  const sand = { EXEC_HEAD_KEEP: 60 * 1024, EXEC_TAIL_KEEP: 4 * 1024 };
  vm.createContext(sand);
  try { vm.runInContext(fnSrc, sand); pure = sand; } catch (e) { pure = null; }
}
ok('vm 提取三个纯函数成功', !!pure && typeof pure.execIpPrivate === 'function' && typeof pure.execCutStr === 'function' && typeof pure.execOutLimiter === 'function');

if (pure) {
  const P = pure.execIpPrivate;
  ok('私网判定：127.0.0.1/::1/::ffff:127.0.0.1 放行', P('127.0.0.1') && P('::1') && P('::ffff:127.0.0.1'));
  ok('私网判定：192.168.*/10.* 放行', P('192.168.0.1') && P('10.8.0.5'));
  ok('私网判定：172.16–31 放行、172.32/172.15 拒绝', P('172.16.0.1') && P('172.31.255.1') && !P('172.32.0.1') && !P('172.15.0.1'));
  ok('私网判定：公网/空值拒绝', !P('8.8.8.8') && !P('') && !P('203.0.113.9'));
  ok('私网判定：fe80 链路本地放行', P('fe80::1'));
  const C = pure.execCutStr;
  ok('截断：短串原样', C('abc', 10) === 'abc');
  ok('截断：不把代理对切半（a😀b 截 2 → a）', C('a😀b', 2) === 'a');
  const emoji = '😀😀😀';
  ok('截断：代理对边界安全（无孤立代理）', (function () { const r = C(emoji, 3); return r.length === 2 && !/[\uD800-\uDBFF]$/.test(r) })());
  const L = pure.execOutLimiter();
  L.push('x'.repeat(200000));
  const txt = L.text();
  ok('输出限流：200K 输入 → 头尾保留且含截断标记', txt.length > 60000 && txt.length < 70000 && txt.indexOf('…[截断') > 0);
  const L2 = pure.execOutLimiter();
  L2.push('short');
  ok('输出限流：小输入不加截断标记', L2.text() === 'short');
}

/* ---------- ② E2E 隔离实例 ---------- */
function httpReq (port, auth, method, p, obj, extraHeaders) {
  return new Promise(function (resolve, reject) {
    const data = obj === undefined ? null : JSON.stringify(obj);
    const headers = Object.assign({}, extraHeaders || {});
    if (auth) headers.Authorization = 'Basic ' + auth;
    if (data !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      let b = ''; res.on('data', function (c) { b += c }); res.on('end', function () { resolve({ code: res.statusCode, body: b }) });
    });
    req.on('error', function (e) { reject(e) });
    if (data !== null) req.write(data);
    req.end();
  });
}
function j (b) { try { return JSON.parse(b) } catch (e) { return null } }
function waitReady (port, tries) {
  return new Promise(function (resolve) {
    let n = 0;
    (function tick () {
      httpReq(port, '', 'GET', '/').then(function (r) { resolve(true) }, function () {
        if (++n > (tries || 60)) return resolve(false);
        setTimeout(tick, 150);
      });
    })();
  });
}
function startProxy (port, file) {
  const { spawn } = require('child_process');
  const env = Object.assign({}, process.env, {
    LITTLEDJ_ROOT: SANDBOX,
    LITTLEDJ_PORT: String(port),
    LITTLEDJ_HOST: '127.0.0.1',
    LITTLEDJ_BACKEND_PORT: '1'
  });
  return spawn(process.execPath, [file || PROXY], { env: env, stdio: 'ignore' });
}

async function e2e () {
  fs.mkdirSync(path.join(SANDBOX, 'config'), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'config', 'auth.txt'), AUTH);
  fs.writeFileSync(path.join(SANDBOX, 'config', 'auth-ext.txt'), AUTH_EXT);
  const port = 42000 + Math.floor(Math.random() * 2000);
  const child = startProxy(port);
  try {
    const ready = await waitReady(port);
    ok('E2E 实例就绪（401 探测通过）', ready === true);

    const main = b64(AUTH);
    const ext = b64(AUTH_EXT);

    const r401 = await httpReq(port, '', 'POST', '/_exec', { cmd: 'echo hi' });
    ok('无凭据 401', r401.code === 401, 'code=' + r401.code);

    const rg = await httpReq(port, main, 'GET', '/_exec');
    ok('GET → 405 用法提示', rg.code === 405 && /用法/.test(rg.body));

    const r1 = await httpReq(port, main, 'POST', '/_exec', { cmd: 'echo hi' });
    const d1 = j(r1.body);
    ok('echo hi → 200 code=0 stdout=hi', r1.code === 200 && d1 && d1.ok === true && d1.code === 0 && String(d1.stdout).trim() === 'hi' && d1.timedOut === false);

    const r2 = await httpReq(port, main, 'POST', '/_exec', { cmd: 'exit 3' });
    const d2 = j(r2.body);
    ok('exit 3 → code 透传', r2.code === 200 && d2 && d2.code === 3);

    const r3 = await httpReq(port, main, 'POST', '/_exec', { cmd: 'echo oops >&2' });
    const d3 = j(r3.body);
    ok('stderr 捕获', r3.code === 200 && d3 && String(d3.stderr).trim() === 'oops');

    const t0 = Date.now();
    const r4 = await httpReq(port, main, 'POST', '/_exec', { cmd: 'sleep 5', timeoutMs: 1200 });
    const d4 = j(r4.body);
    const el4 = Date.now() - t0;
    ok('超时 → timedOut:true 且按 1200ms 强杀（1000–4000ms 窗口）', r4.code === 200 && d4 && d4.timedOut === true && el4 >= 1000 && el4 < 4000, 'ms=' + el4);

    // 并发闸：3 个 sleep 2 依次发（间隔 250ms，防慢机调度翻转），第 3 个必须 429
    const p1 = httpReq(port, main, 'POST', '/_exec', { cmd: 'sleep 2' });
    await new Promise(function (r) { setTimeout(r, 250) });
    const p2 = httpReq(port, main, 'POST', '/_exec', { cmd: 'sleep 2' });
    await new Promise(function (r) { setTimeout(r, 250) });
    const p3 = httpReq(port, main, 'POST', '/_exec', { cmd: 'sleep 2' });
    const [c1, c2, c3] = await Promise.all([p1, p2, p3]);
    ok('并发闸：超出 ≤2 的第 3 个 429', c1.code === 200 && c2.code === 200 && c3.code === 429, [c1.code, c2.code, c3.code].join(','));

    const r5 = await httpReq(port, main, 'POST', '/_exec', { cmd: 'echo x' }, { 'X-Real-IP': '1.2.3.4' });
    ok('X-Real-IP（公网反代穿透）→ 403', r5.code === 403, 'code=' + r5.code);

    // 产出审 P2：空值 X-Real-IP（'in' 判定硬化）也必须 403
    const r5b = await httpReq(port, main, 'POST', '/_exec', { cmd: 'echo x' }, { 'X-Real-IP': '' });
    ok('空值 X-Real-IP 头 → 403（in 判定硬化）', r5b.code === 403, 'code=' + r5b.code);

    const r6 = await httpReq(port, ext, 'POST', '/_exec', { cmd: 'echo x' });
    ok('auth-ext 外网凭据 → 403（只认主密码）', r6.code === 403, 'code=' + r6.code);

    const r7 = await httpReq(port, main, 'POST', '/_exec', { cmd: 'pwd', cwd: 'relative/dir' });
    ok('cwd 相对路径 → 400', r7.code === 400);

    const r8 = await httpReq(port, main, 'POST', '/_exec', { cmd: '   ' });
    ok('cmd 空白 → 400', r8.code === 400);

    // 产出审 P2：spawn 异步 error（无效 cwd）→ 500 且审计留痕
    const r8b = await httpReq(port, main, 'POST', '/_exec', { cmd: 'echo x', cwd: '/nonexistent-dir-task221' });
    ok('无效 cwd（spawn error）→ 500', r8b.code === 500, 'code=' + r8b.code);

    const r9 = await httpReq(port, main, 'POST', '/_exec', { cmd: 'yes x | head -c 200000' });
    const d9 = j(r9.body);
    ok('大输出截断：stdout ≤ ~64KB 且带截断标记', r9.code === 200 && d9 && String(d9.stdout).length < 70000 && String(d9.stdout).indexOf('…[截断') > 0, 'len=' + (d9 && String(d9.stdout).length));

    // 审计落盘
    const auditFile = path.join(SANDBOX, 'data', 'exec-audit.jsonl');
    let lines = 0, parseOk = true, hasField = false, hasErr = false;
    try {
      const raw = fs.readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean);
      lines = raw.length;
      raw.forEach(function (ln) { try { const r = JSON.parse(ln); if (typeof r.ts !== 'number' || typeof r.ip !== 'string' || typeof r.cmd !== 'string' || typeof r.ms !== 'number') parseOk = false; if (r.cmd === 'echo hi') hasField = true; if (r.error && r.code === -1) hasErr = true; } catch (e) { parseOk = false } });
    } catch (e) { lines = 0; }
    ok('审计 jsonl 落盘且结构完整（含 echo hi + spawn error 留痕）', lines >= 6 && parseOk && hasField && hasErr, 'lines=' + lines + ' parseOk=' + parseOk + ' hasErr=' + hasErr);

    /* ---------- ③ 红对照：删 X-Real-IP 闸的副本应放行 ---------- */
    // 产出审 P2 硬化后闸形如：if ('x-real-ip' in req.headers) ... —— 须逐字符锚定（含文案），全文件应恰命中 1 次
    const redSrc = src.replace(/^[ \t]*if \('x-real-ip' in req\.headers\) return json\(res, 403, \{ ok: false, error: 'exec 仅限内网使用（公网链路一律拒绝）' \}\)\r?\n/m, '');
    const hitCount = (src.match(/'x-real-ip' in req\.headers/g) || []).length;
    const patched = redSrc !== src;
    ok('红对照：副本已删掉 X-Real-IP 闸（替换命中且全文件唯一）', patched && hitCount === 1, 'patched=' + patched + ' hits=' + hitCount);
    if (patched) {
      // 副本落沙箱：整个 server 目录复制（含 task-derive/skills）+ symlink node_modules，保证 require 解析（工作区零残留）
      fs.mkdirSync(RED_DIR, { recursive: true });
      fs.cpSync(path.join(__dirname, '..', 'server'), RED_DIR, { recursive: true });
      try { fs.symlinkSync(path.join(__dirname, '..', 'node_modules'), path.join(SANDBOX, 'node_modules'), 'dir') } catch (e) {}
      fs.writeFileSync(RED_COPY, redSrc);
      const port2 = port + 100;
      const child2 = startProxy(port2, RED_COPY);
      try {
        const ready2 = await waitReady(port2);
        ok('红对照实例就绪', ready2 === true);
        if (ready2) {
          const rr = await httpReq(port2, main, 'POST', '/_exec', { cmd: 'echo x' }, { 'X-Real-IP': '1.2.3.4' });
          ok('红对照：闸被删后同请求放行 200 → 绿版 403 断言有效咬合', rr.code === 200, 'code=' + rr.code);
        }
      } finally { try { child2.kill('SIGKILL') } catch (e) {} }
    }
  } finally {
    try { child.kill('SIGKILL') } catch (e) {}
    try { if (fs.existsSync(RED_COPY)) fs.unlinkSync(RED_COPY) } catch (e) {}
  }
}

function report (code) {
  if (process.argv.indexOf('--json') >= 0) console.log(JSON.stringify(out, null, 2));
  else {
    out.items.forEach(function (it) { console.log((it.ok ? 'PASS' : 'FAIL') + '  ' + it.name + (it.ok ? '' : '   [' + it.detail + ']')) });
    console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
  }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch (e) {}
  process.exit(code || (out.fail ? 1 : 0));
}

e2e().then(function () { report(out.fail ? 1 : 0) }, function (e) { ok('主流程', false, e && e.stack); report(1) });

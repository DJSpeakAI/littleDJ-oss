#!/usr/bin/env node
/* task216 自测：备忘录（/_notes）端点 + 原子写 + 上限 fail-closed + 前端接线静态断言
   用法：node deploy/selftest-notes.js [--json]
   覆盖：①静态断言（ui 接线/CSS/版本号三处）②E2E 隔离实例：401/GET 空/create/save/404/413/delete
        ③红对照：save 超限 413 后 GET 必须仍旧值（内存单例污染防护）
        ④条数上限 200、单条 64KB 上限、总量 1MB 上限 ⑤文件落盘 + 原子写无 .tmp 残留
   沙箱：LITTLEDJ_ROOT 指向临时目录，绝不污染生产 data/notes.json */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-notes-'));
process.env.LITTLEDJ_ROOT = SANDBOX;

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}

/* ---------- ① 前端静态断言 ---------- */
const UI = path.join(__dirname, '..', 'ui', 'index.html');
const ui = fs.readFileSync(UI, 'utf8');
ok('ui 含 #btnNotes 导航按钮', /id="btnNotes"/.test(ui));
ok('ui 绑定 btnNotes → openNotes', /\$\('#btnNotes'\)\.onclick = openNotes/.test(ui));
ok('ui 含备忘录弹窗骨架 ntWrap', /id="ntWrap"/.test(ui));
ok('ui 含 nt 函数组（openNotes/ntFlush/ntCloseFlush）', /function openNotes\(\)/.test(ui) && /function ntFlush\(cb\)/.test(ui) && /function ntCloseFlush\(\)/.test(ui));
ok('closeModal 已挂钩 ntCloseFlush', /if \(typeof ntCloseFlush === 'function'\) ntCloseFlush\(\)/.test(ui));
ok('ntCloseFlush 在途排队回接（产出审 P1：saving 中新输入不丢）', /function ntCloseFlush\(\)\{[\s\S]{0,160}NT\.dirty && !NT\.saving/.test(ui));
ok('openNotes 隐藏 modalCancel（方案审 P2-1）', /\$\('#modalCancel'\)\.style\.display = 'none'/.test(ui));
ok('openModal 重置 modalCancel 可见性', /\$\('#modalCancel'\)\.style\.display = ''/.test(ui));
ok('CSS 含 .nt-wrap 双栏', /\.nt-wrap\{display:flex/.test(ui));
ok('CSS 含移动端 nt 上下布局', /@media \(max-width:640px\)\{[\s\S]{0,200}\.nt-wrap\{flex-direction:column/.test(ui));
ok('标题输入 maxlength=60（方案审 P2-4）', /ti\.maxLength = 60/.test(ui));
/* L-063：版本断言动态化（写死旧号每次升版必红，task217 触发第三次重犯后统一） */
const verAll = (ui.match(/personal agent · v[\d.]+/g) || []);
ok('verText 三处同版本无混用（≥3 处、唯一版本号）', verAll.length >= 3 && verAll.filter(function(v,i){ return verAll.indexOf(v) === i }).length === 1, 'found ' + verAll.length + ' / uniq ' + verAll.filter(function(v,i){ return verAll.indexOf(v) === i }).length);

/* ---------- 内联脚本语法（vm 等价：new Function） ---------- */
const scripts = [...ui.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1] });
let synBad = 0;
scripts.forEach(function (c) { try { new Function(c) } catch (e) { synBad++; console.log('SYNTAX FAIL: ' + e.message) } });
ok('内联脚本语法 OK（' + scripts.length + ' 段）', synBad === 0);

/* ---------- ② E2E 隔离实例 ---------- */
function httpReq (port, auth, method, p, obj) {
  return new Promise(function (resolve, reject) {
    const data = obj === undefined ? null : JSON.stringify(obj);
    const headers = {};
    if (auth) headers.Authorization = 'Basic ' + auth;
    if (data !== null) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data) }
    const req = http.request({ host: '127.0.0.1', port: port, path: p, method: method, headers: headers }, function (res) {
      let b = ''; res.on('data', function (c) { b += c }); res.on('end', function () { resolve({ code: res.statusCode, body: b }) });
    });
    req.on('error', function (e) { reject(e) });
    if (data !== null) req.write(data);
    req.end();
  });
}
function j (b) { try { return JSON.parse(b) } catch (e) { return null } }

async function e2e () {
  const port = 4160 + Math.floor(Math.random() * 40);
  const env = Object.assign({}, process.env, { LITTLEDJ_PORT: String(port), LITTLEDJ_ROOT: SANDBOX });
  const prodAuth = path.join(require('../server/paths').ROOT, 'config', 'auth.txt');
  try {
    fs.mkdirSync(path.join(SANDBOX, 'config'), { recursive: true });
    if (fs.existsSync(prodAuth)) fs.copyFileSync(prodAuth, path.join(SANDBOX, 'config', 'auth.txt'));
  } catch (e) {}
  const auth = (function () {
    try { return Buffer.from(fs.readFileSync(path.join(SANDBOX, 'config', 'auth.txt'), 'utf8').trim()).toString('base64') } catch (e) { return '' }
  })();
  const child = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: env, stdio: 'ignore' });
  try {
    await new Promise(function (r) { setTimeout(r, 1800) });

    // 401：无鉴权
    const r401 = await httpReq(port, '', 'GET', '/_notes');
    ok('E2E 无鉴权 401', r401.code === 401, 'code=' + r401.code);

    // 空列表
    const rEmpty = await httpReq(port, auth, 'GET', '/_notes');
    const dEmpty = j(rEmpty.body);
    ok('E2E GET 空列表 200 + notes=[]', rEmpty.code === 200 && dEmpty && dEmpty.ok === true && Array.isArray(dEmpty.notes) && dEmpty.notes.length === 0);

    // create
    const r1 = await httpReq(port, auth, 'POST', '/_notes', { op: 'create' });
    const d1 = j(r1.body);
    ok('E2E create 200 + note 结构', r1.code === 200 && d1 && d1.ok && d1.note && /^n[0-9a-z]+$/.test(d1.note.id) && d1.note.createdAt > 0);
    const id1 = d1 && d1.note && d1.note.id;

    // save 改标题+正文（含中文/换行/特殊字符往返）
    const content1 = '第一行\n第二行 <b>&"\'</b> 中文内容 ✓';
    const r2 = await httpReq(port, auth, 'POST', '/_notes', { op: 'save', id: id1, title: '  测试标题  ', content: content1 });
    const d2 = j(r2.body);
    ok('E2E save 200 + 标题 trim', r2.code === 200 && d2 && d2.ok && d2.note.title === '测试标题' && d2.note.content === content1);

    // save 不存在 id → 404
    const r3 = await httpReq(port, auth, 'POST', '/_notes', { op: 'save', id: 'n-not-exist', title: 'x', content: 'y' });
    ok('E2E save 不存在 id → 404', r3.code === 404);

    // save 单条超长 → 413
    const longStr = 'x'.repeat(64 * 1024 + 1);
    const r4 = await httpReq(port, auth, 'POST', '/_notes', { op: 'save', id: id1, title: '测试标题', content: longStr });
    ok('E2E save 单条超 64KB → 413', r4.code === 413);

    // ⚠红对照：413 后 GET 必须仍是旧值（内存单例未被超限请求污染）
    const r5 = await httpReq(port, auth, 'GET', '/_notes');
    const d5 = j(r5.body);
    const note5 = d5 && d5.notes && d5.notes.find(function (x) { return x.id === id1 });
    ok('红对照：超限 413 后 GET 仍旧值（单例未污染）', !!note5 && note5.content === content1 && note5.content.length < 1000, note5 ? 'len=' + note5.content.length : 'note missing');

    // 总量 1MB 上限：16 条各 ~63KB → 第 17 条 save 触发 413
    const chunk = 'y'.repeat(63 * 1024);
    let totalHit = false;
    for (let i = 0; i < 17; i++) {
      const rc = await httpReq(port, auth, 'POST', '/_notes', { op: 'create' });
      const dc = j(rc.body);
      if (!dc || !dc.ok) { totalHit = 'create failed at ' + i; break }
      const rs = await httpReq(port, auth, 'POST', '/_notes', { op: 'save', id: dc.note.id, title: 'bulk' + i, content: chunk });
      if (i === 16) { totalHit = rs.code === 413 ? true : 'code=' + rs.code }
    }
    ok('E2E 总量超 1MB → 413', totalHit === true, String(totalHit));

    // 条数上限 200：补 create 到 200 条后第 201 次 413（当前约 18 条）
    let cntHit = false;
    for (let i = 0; i < 200; i++) {
      const rc = await httpReq(port, auth, 'POST', '/_notes', { op: 'create' });
      const dc = j(rc.body);
      if (rc.code === 413) { cntHit = (dc && /200/.test(String(dc.error || ''))) ? true : 'detail=' + rc.body; break }
    }
    ok('E2E 条数上限 200 → 413', cntHit === true, String(cntHit));

    // delete 存在的 id → 200；再删同 id → 404
    const rd = await httpReq(port, auth, 'POST', '/_notes', { op: 'delete', id: id1 });
    ok('E2E delete 200', rd.code === 200 && (j(rd.body) || {}).ok === true);
    const rd2 = await httpReq(port, auth, 'POST', '/_notes', { op: 'delete', id: id1 });
    ok('E2E delete 不存在 → 404', rd2.code === 404);

    // op 非法 → 400
    const rb = await httpReq(port, auth, 'POST', '/_notes', { op: 'bogus' });
    ok('E2E op 非法 → 400', rb.code === 400);

    // 文件落盘 + 原子写无 .tmp 残留
    const f = path.join(SANDBOX, 'data', 'notes.json');
    let fileOk = false, tmpLeft = [];
    try {
      const disk = JSON.parse(fs.readFileSync(f, 'utf8'));
      fileOk = Array.isArray(disk.list) && disk.list.length > 0 && typeof disk.updatedAt === 'number';
      tmpLeft = fs.readdirSync(path.dirname(f)).filter(function (n) { return n.indexOf('.tmp-') >= 0 });
    } catch (e) { fileOk = 'read fail ' + e.message }
    ok('E2E 落盘 JSON 结构正确', fileOk === true, String(fileOk));
    ok('E2E 原子写无 .tmp 残留', tmpLeft.length === 0, JSON.stringify(tmpLeft));
  } catch (e) {
    ok('E2E 异常', false, e && e.message);
  } finally {
    try { child.kill() } catch (e) {}
  }
}

function report (code) {
  if (process.argv.indexOf('--json') >= 0) console.log(JSON.stringify(out, null, 2));
  else {
    out.items.forEach(function (it) {
      console.log((it.ok ? 'PASS' : 'FAIL') + '  ' + it.name + (it.ok ? '' : '   [' + it.detail + ']'));
    });
    console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
  }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch (e) {}
  process.exit(code || (out.fail ? 1 : 0));
}

e2e().then(function () { report(out.fail ? 1 : 0) }, function (e) { ok('主流程', false, e && e.message); report(1) });

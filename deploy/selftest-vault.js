#!/usr/bin/env node
/* task298 自测：密码本静态加密（/_vault）——合成 fixture，零真实凭据（方案审 r1 P0-1/r2 P1-1 修正）
   覆盖：
   ① 静态断言（ui 接线 / 版本动态口径 / proxy 加密锚点）
   ② E2E 全新安装：首 GET → key 生成 + 空 v2 落盘 + items=[]（r2 P1-3）；CRUD 回归；no-store；磁盘 v2 结构断言（无 items 键）；800 上限；other 位
   ③ 真实 v1 迁移（无 version 字段，r2 P1-2）：20 条合成 → 冷启动迁移 → 全量 deep-equal + .v2bak + 重启重读幂等 + stale tmp 清理
   ④ fail-closed 九态（每态冷启动新进程，r2 P1-4/P1-6）：坏 envelope / 未知 version / vault缺失+key在 / v2缺ct / 坏key / 坏tag / 截断ct / v2+key缺失 / 迁移失败
   ⑤ key 热缓存（r1 P1-1）：运行中删 key → save 409 + 文件 hash 不变
   ⑥ 红对照分层（r2 P1-5）：副本删守卫 → 断言必须转红（loadVault 守卫 / saveVault key 校验）
   沙箱：LITTLEDJ_ROOT 指向临时目录 + 合成 auth.txt（不碰生产 auth/vault），绝不污染生产数据 */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const VC = require(path.join(__dirname, '..', 'server', 'vault-crypto'));

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}
const SAND_AUTH = 'sandbox:test-pass-123';
const SAND_AUTH_B64 = Buffer.from(SAND_AUTH).toString('base64');

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
function j (b) { try { return JSON.parse(b) } catch (e) { return null } }

/* 每个 sandbox：独立 ROOT + 合成 auth.txt（绝不复制生产，r2 P1-1） */
function newSandbox (tag) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-vault-' + tag + '-'));
  fs.mkdirSync(path.join(box, 'config'), { recursive: true });
  fs.mkdirSync(path.join(box, 'data'), { recursive: true });
  fs.writeFileSync(path.join(box, 'config', 'auth.txt'), SAND_AUTH + '\n');
  return box;
}
function spawnProxy (box, port, scriptPath) {
  const env = Object.assign({}, process.env, { LITTLEDJ_PORT: String(port), LITTLEDJ_ROOT: box });
  return require('child_process').spawn(process.execPath, [scriptPath || path.join(__dirname, '..', 'server', 'proxy.js')], { env: env, stdio: 'ignore' });
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) };
function sha256 (p) { try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') } catch (e) { return null } }

/* 合成 fixture（零真实凭据）：v1 20 条 */
function synthItems (n) {
  const arr = [];
  for (let i = 1; i <= n; i++) arr.push({ id: 'v' + String(i).padStart(3, '0'), name: '合成条目 ' + i, cat: i % 3 === 0 ? '测试分类' : '', account: 'synth-user-' + i + '@example.com', password: 'synth-pw-' + i + ' <b>&"\' ✓', note: i % 2 === 0 ? '备注\n第二行 ' + i : '', createdAt: 1700000000000 + i, updatedAt: 1700000000000 + i });
  return arr;
}

async function main () {
  /* ---------- ① 静态断言 ---------- */
  /* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本）+ index.html 原文（HTML 骨架/verText 锚点仍在这） */
  const ui = require('./selftest-load-ui').loadUiSource(path.join(__dirname, '..', 'ui'))
    + '\n' + fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  /* task304：密码本 UI 入口已全量退役——反向断言：界面零密码本引用（对话式管理，/_vault API 保留） */
  ok('ui 零密码本引用（btnVault/vp 函数组/VP 对象全退役）', !/btnVault|openVault|vpRender|vpCloseFlush|vpWrap/.test(ui) && !/var VP = \{ list:/.test(ui));
  ok('备忘录入口不受牵连（btnNotes/openNotes 在）', /id="btnNotes"/.test(ui) && /function openNotes\(\)/.test(ui));
  const verAll = (ui.match(/personal agent · v[\d.]+/g) || []);
  ok('verText 三处同版本无混用', verAll.length >= 3 && verAll.filter(function (v, i) { return verAll.indexOf(v) === i }).length === 1);
  const px = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8');
  ok('proxy 含 vault-crypto 引用 + fail-closed 写闸 + no-store', /require\('\.\/vault-crypto'\)/.test(px) && /e\.vaultFail/.test(px) && /'Cache-Control'/.test(px) && /no-store/.test(px));
  ok('proxy 落盘零明文（saveVault 只写 envelope）', /encryptVault\(key, \{ items: v\.items \}\)/.test(px) && !/writeFileSync\(tmp, JSON\.stringify\(v,/.test(px));

  /* ---------- ② 全新安装 + CRUD E2E ---------- */
  const box1 = newSandbox('fresh');
  const P1 = 4200 + Math.floor(Math.random() * 40);
  const c1 = spawnProxy(box1, P1);
  let id1 = null;
  try {
    await sleep(1800);
    const r401 = await httpReq(P1, '', 'GET', '/_vault');
    ok('E2E 无鉴权 401', r401.code === 401);

    const rEmpty = await httpReq(P1, SAND_AUTH_B64, 'GET', '/_vault');
    const dEmpty = j(rEmpty.body);
    ok('全新安装 GET 200 + items=[]（不留 key-only 假故障）', rEmpty.code === 200 && dEmpty && dEmpty.ok === true && Array.isArray(dEmpty.items) && dEmpty.items.length === 0, 'code=' + rEmpty.code);
    ok('响应带 Cache-Control: no-store', (rEmpty.headers['cache-control'] || '') === 'no-store');
    const keyGen = VC.loadKey(box1);
    ok('全新安装已生成 32B key', !!keyGen && keyGen.length === 32);
    let fresh1 = null;
    try { fresh1 = JSON.parse(fs.readFileSync(path.join(box1, 'data', 'vault.json'), 'utf8')) } catch (e) {}
    ok('全新安装已落空 v2（重启不假故障）', !!fresh1 && fresh1.version === 2 && typeof fresh1.ct === 'string' && fresh1.ct.length > 0);

    const r1 = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'create' });
    const d1 = j(r1.body);
    ok('create 200 + item 结构', r1.code === 200 && d1 && d1.ok && /^v[0-9a-z]+$/.test(d1.item.id));
    id1 = d1 && d1.item && d1.item.id;
    const pw1 = 'P@ss <b>&"\' 中文密码 ✓';
    const r2 = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'save', id: id1, name: '  合成银行  ', cat: ' 测试 ', account: 'synth-acct-000@example.com', password: pw1, note: '第一行\n第二行' });
    const d2 = j(r2.body);
    ok('save 200 + trim + 特殊字符往返', r2.code === 200 && d2 && d2.ok && d2.item.name === '合成银行' && d2.item.password === pw1);
    const r3 = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'save', id: 'v-not-exist', name: 'x' });
    ok('save 不存在 id → 404', r3.code === 404);
    const rCut = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'save', id: id1, name: '名'.repeat(120) });
    ok('name 超 80 字截断', rCut.code === 200 && j(rCut.body).item.name.length === 80);
    const rEN = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'save', id: id1, name: '   ' });
    ok('红对照：空 name 回落「未命名」', rEN.code === 200 && j(rEN.body).item.name === '未命名');

    // 磁盘结构：v2 密文（无 items 键 / iv 12B / tag 16B / ct 可解）+ 无明文特征 + other 位 + 无 tmp
    const disk = JSON.parse(fs.readFileSync(path.join(box1, 'data', 'vault.json'), 'utf8'));
    const ivB = Buffer.from(disk.iv, 'base64'), tagB = Buffer.from(disk.tag, 'base64'), ctB = Buffer.from(disk.ct, 'base64');
    ok('磁盘 v2 结构（无 items 键 / iv 12B / tag 16B / ct>0）', disk.items === undefined && disk.version === 2 && ivB.length === 12 && tagB.length === 16 && ctB.length > 0, JSON.stringify(Object.keys(disk)));
    ok('磁盘零明文特征（合成串不出现）', fs.readFileSync(path.join(box1, 'data', 'vault.json'), 'utf8').indexOf(pw1) < 0 && fs.readFileSync(path.join(box1, 'data', 'vault.json'), 'utf8').indexOf('合成银行') < 0);
    ok('解密 roundtrip（工具级）', (function () { try { const p = VC.decryptVault(VC.loadKey(box1), disk); return p.items.length === 1 && p.items[0].password === pw1 } catch (e) { return false } })());
    const st = fs.statSync(path.join(box1, 'data', 'vault.json'));
    ok('文件权限 other 位不可读（实测 ' + (st.mode & 0o777).toString(8) + '）', (st.mode & 0o007) === 0);
    ok('原子写无 .tmp 残留', fs.readdirSync(path.join(box1, 'data')).filter(function (n) { return n.indexOf('.tmp-') >= 0 }).length === 0);

    // 条数上限 800（当前 1 条补 799）
    let cntHit = false;
    for (let i = 0; i < 800; i++) { const rc = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'create' }); if (rc.code === 413) { cntHit = (j(rc.body) || {}).error ? true : rc.body; break } }
    ok('条数上限 800 → 413', cntHit === true, String(cntHit));
    const rd = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'delete', id: id1 });
    ok('delete 200', rd.code === 200 && (j(rd.body) || {}).ok === true);
    const rb = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'bogus' });
    ok('op 非法 → 400', rb.code === 400);

    /* ⑤ key 热缓存（r1 P1-1.③）：运行中删 key → save 409 + 文件不变 */
    const beforeHash = sha256(path.join(box1, 'data', 'vault.json'));
    fs.unlinkSync(path.join(box1, 'config', 'vault.key'));
    const rk = await httpReq(P1, SAND_AUTH_B64, 'POST', '/_vault', { op: 'create' });
    ok('运行中删 key → create 409 拒写', rk.code === 409, 'code=' + rk.code);
    ok('拒写后文件 hash 不变', sha256(path.join(box1, 'data', 'vault.json')) === beforeHash);
  } catch (e) { ok('②/⑤ 异常', false, e && e.message) }
  finally { try { c1.kill() } catch (e) {} }

  /* ---------- ③ 真实 v1 迁移（无 version 字段）---------- */
  const box2 = newSandbox('migrate');
  const items20 = synthItems(20);
  fs.writeFileSync(path.join(box2, 'data', 'vault.json'), JSON.stringify({ items: items20, updatedAt: 1794000000000 }));
  fs.writeFileSync(path.join(box2, 'data', 'vault.json.tmp-9999'), 'stale garbage'); // stale tmp 清理断言
  const P2 = 4260 + Math.floor(Math.random() * 30);
  const c2 = spawnProxy(box2, P2);
  try {
    await sleep(1800);
    const rm = await httpReq(P2, SAND_AUTH_B64, 'GET', '/_vault');
    const dm = j(rm.body);
    ok('v1(无 version) 冷启动迁移 → GET 200 条数=20', rm.code === 200 && dm && dm.ok && dm.items.length === 20, 'code=' + rm.code);
    ok('迁移全量 deep-equal（内存比对，规范化 JSON 全等）', (function () { try { const p = VC.decryptVault(VC.loadKey(box2), JSON.parse(fs.readFileSync(path.join(box2, 'data', 'vault.json'), 'utf8'))); return JSON.stringify({ items: p.items }) === JSON.stringify({ items: items20 }) } catch (e) { return false } })());
    const disk2 = JSON.parse(fs.readFileSync(path.join(box2, 'data', 'vault.json'), 'utf8'));
    ok('迁移后磁盘为 v2 且 v1 明文消失（无 items 键）', disk2.version === 2 && disk2.items === undefined);
    ok('stale .tmp 已被启动清理', fs.readdirSync(path.join(box2, 'data')).indexOf('vault.json.tmp-9999') < 0);
    ok('.v2bak 密文备份已留', (function () { try { const b = JSON.parse(fs.readFileSync(path.join(box2, 'data', 'vault.json.v2bak'), 'utf8')); return b.version === 2 && typeof b.ct === 'string' } catch (e) { return false } })());
  } catch (e) { ok('③ 异常', false, e && e.message) }
  finally { try { c2.kill() } catch (e) {} }
  // 重启重读幂等（rename 后缓存更新前崩溃态的等价覆盖）
  const c2b = spawnProxy(box2, P2 + 1);
  try {
    await sleep(1800);
    const rr = await httpReq(P2 + 1, SAND_AUTH_B64, 'GET', '/_vault');
    ok('v2 重启重读幂等（条数仍 20）', rr.code === 200 && j(rr.body).items.length === 20);
  } catch (e) { ok('③重启 异常', false, e && e.message) }
  finally { try { c2b.kill() } catch (e) {} }

  /* ---------- ④ fail-closed 九态（每态冷启动新进程）---------- */
  async function fcState (name, setup) {
    const box = newSandbox('fc');
    const port = 4300 + Math.floor(Math.random() * 60);
    setup(box);
    const ch = spawnProxy(box, port);
    try {
      await sleep(1600);
      const rg = await httpReq(port, SAND_AUTH_B64, 'GET', '/_vault');
      const hBefore = sha256(path.join(box, 'data', 'vault.json'));
      const rc = await httpReq(port, SAND_AUTH_B64, 'POST', '/_vault', { op: 'create' });
      const rs = await httpReq(port, SAND_AUTH_B64, 'POST', '/_vault', { op: 'save', id: 'v001', name: 'x' });
      const rd = await httpReq(port, SAND_AUTH_B64, 'POST', '/_vault', { op: 'delete', id: 'v001' });
      const noTmp = fs.readdirSync(path.join(box, 'data')).filter(function (n) { return n.indexOf('.tmp-') >= 0 }).length === 0;
      ok('FC ' + name + '：GET 500 + POST 409×3 + 文件不变 + 无 tmp',
        rg.code === 500 && rc.code === 409 && rs.code === 409 && rd.code === 409 && sha256(path.join(box, 'data', 'vault.json')) === hBefore && noTmp,
        'GET=' + rg.code + ' create=' + rc.code + ' save=' + rs.code + ' del=' + rd.code);
    } catch (e) { ok('FC ' + name + ' 异常', false, e && e.message) }
    finally { try { ch.kill() } catch (e) {} try { fs.rmSync(box, { recursive: true, force: true }) } catch (e) {} }
  }
  const V2GOOD = (function () { const k = crypto.randomBytes(32); const e = VC.encryptVault(k, { items: synthItems(3) }); e.updatedAt = 1; return { keyB64: k.toString('base64'), env: e } })();
  await fcState('坏 envelope JSON', function (b) { fs.writeFileSync(path.join(b, 'data', 'vault.json'), '{not json') });
  await fcState('未知 version', function (b) { fs.writeFileSync(path.join(b, 'data', 'vault.json'), JSON.stringify({ version: 9, items: [1] })) });
  await fcState('vault 缺失 + key 存在', function (b) { fs.writeFileSync(path.join(b, 'config', 'vault.key'), V2GOOD.keyB64 + '\n') });
  await fcState('v2 缺 ct', function (b) { fs.writeFileSync(path.join(b, 'config', 'vault.key'), V2GOOD.keyB64 + '\n'); const e = JSON.parse(JSON.stringify(V2GOOD.env)); delete e.ct; fs.writeFileSync(path.join(b, 'data', 'vault.json'), JSON.stringify(e)) });
  await fcState('坏 key（v2 在）', function (b) { fs.writeFileSync(path.join(b, 'config', 'vault.key'), crypto.randomBytes(16).toString('base64') + '\n'); fs.writeFileSync(path.join(b, 'data', 'vault.json'), JSON.stringify(V2GOOD.env)) });
  await fcState('坏 tag', function (b) { const k = crypto.randomBytes(32); const e = VC.encryptVault(k, { items: synthItems(3) }); e.tag = crypto.randomBytes(16).toString('base64'); e.updatedAt = 1; fs.writeFileSync(path.join(b, 'config', 'vault.key'), k.toString('base64') + '\n'); fs.writeFileSync(path.join(b, 'data', 'vault.json'), JSON.stringify(e)) });
  await fcState('截断 ct', function (b) { const k = crypto.randomBytes(32); const e = VC.encryptVault(k, { items: synthItems(3) }); e.ct = e.ct.slice(0, Math.floor(e.ct.length / 2)); e.updatedAt = 1; fs.writeFileSync(path.join(b, 'config', 'vault.key'), k.toString('base64') + '\n'); fs.writeFileSync(path.join(b, 'data', 'vault.json'), JSON.stringify(e)) });
  await fcState('v2 + key 缺失（不生成新 key）', function (b) { fs.writeFileSync(path.join(b, 'data', 'vault.json'), JSON.stringify(V2GOOD.env)) });
  await fcState('迁移失败（key 路径为目录，v1 保留）', function (b) { fs.writeFileSync(path.join(b, 'data', 'vault.json'), JSON.stringify({ items: synthItems(2), updatedAt: 1 })); fs.mkdirSync(path.join(b, 'config', 'vault.key')) });

  /* ---------- ⑥ 红对照分层（r2 P1-5）：副本删守卫必须转红 ---------- */
  const pxSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8');
  const redBox = newSandbox('red');
  const redPath = path.join(__dirname, '..', 'server', 'proxy-red-tmp.js'); // 放 server/ 下：相对 require 天然可用，跑完删
  fs.writeFileSync(redPath, pxSrc.replace("vaultErrThrow(VAULT_FC + '：未知 version/shape')", 'vaultCache = { items: [], updatedAt: 0 };\n  return vaultCache'));
  const redPort = 4380 + Math.floor(Math.random() * 30);
  fs.writeFileSync(path.join(redBox, 'data', 'vault.json'), JSON.stringify({ version: 9, items: [1] }));
  const cr = spawnProxy(redBox, redPort, redPath);
  try {
    await sleep(1600);
    const rg = await httpReq(redPort, SAND_AUTH_B64, 'GET', '/_vault');
    ok('红对照R1：删 loadVault 守卫 → 未知 version 返回 200 空库（断言可证伪）', rg.code === 200 && j(rg.body).items.length === 0, 'code=' + rg.code + '（若=500 则守卫没删成，测试自误）');
  } catch (e) { ok('红对照R1 异常', false, e && e.message) }
  finally { try { cr.kill() } catch (e) {} }

  const redBox2 = newSandbox('red2');
  const redPath2 = path.join(__dirname, '..', 'server', 'proxy-red2-tmp.js');
  fs.writeFileSync(redPath2, pxSrc.replace("const key = VCRYPTO.loadKey(ROOT)\n  if (!key) vaultErrThrow(VAULT_FC + '：vault.key 缺失/非法，拒写')", "let key = VCRYPTO.loadKey(ROOT)\n  if (!key) key = vaultKeyCache"));
  const redPort2 = 4420 + Math.floor(Math.random() * 30);
  const cr2 = spawnProxy(redBox2, redPort2, redPath2);
  try {
    await sleep(1800);
    await httpReq(redPort2, SAND_AUTH_B64, 'GET', '/_vault'); // 初始化缓存
    fs.unlinkSync(path.join(redBox2, 'config', 'vault.key'));
    const rc = await httpReq(redPort2, SAND_AUTH_B64, 'POST', '/_vault', { op: 'create' });
    ok('红对照R2：删 saveVault key 校验 → 删 key 后 create 200（写闸可证伪）', rc.code === 200, 'code=' + rc.code + '（若=409 则替换没生效，测试自误）');
  } catch (e) { ok('红对照R2 异常', false, e && e.message) }
  finally { try { cr2.kill() } catch (e) {} }

  /* R3（产出审 P1-1 配套）：迁移读回校验恒失败 → fail-closed + v1 不动 + tmp 清理 */
  const redBox3 = newSandbox('red3');
  const redPath3 = path.join(__dirname, '..', 'server', 'proxy-red3-tmp.js');
  fs.writeFileSync(redPath3, pxSrc.replace("if (JSON.stringify({ items: back.items }) !== JSON.stringify({ items: j.items })) throw new Error('读回校验不等')", "if (true) throw new Error('读回校验不等（红对照注入）')"));
  fs.writeFileSync(path.join(redBox3, 'data', 'vault.json'), JSON.stringify({ items: synthItems(2), updatedAt: 1 }));
  const v1Hash = sha256(path.join(redBox3, 'data', 'vault.json'));
  const cr3 = spawnProxy(redBox3, 4460, redPath3);
  try {
    await sleep(1600);
    const rg3 = await httpReq(4460, SAND_AUTH_B64, 'GET', '/_vault');
    const noTmp3 = fs.readdirSync(path.join(redBox3, 'data')).filter(function (n) { return n.indexOf('.tmp-') >= 0 }).length === 0;
    ok('红对照R3：校验恒失败 → GET 500 + v1 hash 不变 + tmp 已清', rg3.code === 500 && sha256(path.join(redBox3, 'data', 'vault.json')) === v1Hash && noTmp3, 'code=' + rg3.code);
  } catch (e) { ok('红对照R3 异常', false, e && e.message) }
  finally { try { cr3.kill() } catch (e) {} try { fs.unlinkSync(redPath3) } catch (e) {} try { fs.rmSync(redBox3, { recursive: true, force: true }) } catch (e) {} }

  /* ---------- 收尾清理 ---------- */
  try { fs.unlinkSync(redPath) } catch (e) {}
  try { fs.unlinkSync(redPath2) } catch (e) {}
  [box1, box2, redBox, redBox2].forEach(function (b) { try { fs.rmSync(b, { recursive: true, force: true }) } catch (e) {} });
}

main().then(function () {
  out.items.forEach(function (it) { console.log((it.ok ? 'PASS' : 'FAIL') + '  ' + it.name + (it.ok ? '' : '   [' + it.detail + ']')) });
  console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
  process.exit(out.fail ? 1 : 0);
}, function (e) { console.log('FATAL ' + (e && e.message)); process.exit(1) });

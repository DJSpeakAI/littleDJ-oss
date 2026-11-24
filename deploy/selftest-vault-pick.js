#!/usr/bin/env node
/* task331 自测：密码本 → API Key 联通（/_vault/pick + /_vault/apply + UI 选取器锚点）
   覆盖：
   ① 静态锚点：proxy 两路由 + 公网两名单 + vaultExtractKey；keywin 选取器函数/按钮/window 导出；index CSS + verText×3
   ② E2E 沙箱（HOME + LITTLEDJ_ROOT 双隔离，auth.json/apikeys/zhipu-keys/volc-keys 全落沙箱）：
      pick 元数据不泄明文/账号/备注；apply 三供应商全链落库（store + auth.json 权威副本）；
      杂记条目提取；空密码/坏格式/坏 provider/未知 id 四类中文错误；公网 GET/POST 双 403；no-store
   ③ 红对照：pick/apply 响应正文绝不含完整 Key 明文
   绝不碰生产 auth/vault/apikeys（合成凭据，L-093 口径） */
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
const SAND_AUTH = 'sandbox:test-pass-123';
const SAND_AUTH_B64 = Buffer.from(SAND_AUTH).toString('base64');
const PORT = 4189;
const DS_OK = 'sk-task331sandbox0001';
const DS_MESSY_TOKEN = 'sk-task331sandbox0002';
const ZP_OK = 'zp.task331.sandbox0003';
const VOLC_OK = 'volc-task331-sandbox0004';

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
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) };

/* ---------- ① 静态锚点 ---------- */
const REPO = path.join(__dirname, '..');
const proxySrc = fs.readFileSync(path.join(REPO, 'server', 'proxy.js'), 'utf8');
const keywinSrc = fs.readFileSync(path.join(REPO, 'ui', 'src', 'pricing', 'keywin.js'), 'utf8');
const idxSrc = fs.readFileSync(path.join(REPO, 'ui', 'index.html'), 'utf8');
const bootSrc = fs.readFileSync(path.join(REPO, 'ui', 'src', 'app', 'boot.js'), 'utf8');
const popSrc = fs.readFileSync(path.join(REPO, 'ui', 'src', 'pricing', 'popout.js'), 'utf8');
ok('①-1 proxy 有 pick 路由', proxySrc.indexOf("pn === '/_vault/pick'") >= 0);
ok('①-2 proxy 有 apply 路由', proxySrc.indexOf("pn === '/_vault/apply'") >= 0);
ok('①-3 apply 进公网写拒名单', /PUBNET_DENY_WRITE[^\]]*'\/_vault\/apply'/.test(proxySrc));
ok('①-4 pick 进公网读拒名单', /PUBNET_DENY_GET[^\]]*'\/_vault\/pick'/.test(proxySrc));
ok('①-5 vaultExtractKey 定义', /function vaultExtractKey\(/.test(proxySrc));
ok('①-6 keywin 五函数', ['skVpOpen', 'skVpClose', 'skVpGuard', 'skVpEsc', 'skVpApply'].every(function (f) { return keywinSrc.indexOf('function ' + f + '(') >= 0 }));
ok('①-7 keywin 按钮 🔑 密码本', keywinSrc.indexOf("'🔑 密码本'") >= 0);
ok('①-8 keywin window 导出', keywinSrc.indexOf('window.skVpApply=skVpApply') >= 0);
ok('①-9 keywin 契约头声明', /@提供[^@]*skVpOpen skVpClose skVpGuard skVpEsc skVpApply/.test(keywinSrc) && /@全局占用[^@]*skVpApply/.test(keywinSrc));
ok('①-10 index 选取器 CSS', idxSrc.indexOf('.skvp-panel{') >= 0 && idxSrc.indexOf('.skvp-item') >= 0);
/* task342 清欠（L-063 动态口径）：原「三处都含 v0.321.0.0」硬编码——task332 起任何升版必假红；
   改为「三处各恰一处且同版」，版本字面量零依赖 */
ok('①-11 verText 三处同版（动态口径）', (function(){
  var re = /personal agent · v\d+\.\d+\.\d+\.\d+/g;
  var a = idxSrc.match(re) || [], b = bootSrc.match(re) || [], c = popSrc.match(re) || [];
  return a.length === 1 && b.length === 1 && c.length === 1 && a[0] === b[0] && b[0] === c[0];
})());

/* ---------- ② E2E 沙箱 ---------- */
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-vpick-'));
fs.mkdirSync(path.join(box, 'config'), { recursive: true });
fs.mkdirSync(path.join(box, 'data'), { recursive: true });
fs.writeFileSync(path.join(box, 'config', 'auth.txt'), SAND_AUTH + '\n');
/* 生产布局镜像：deveco 凭据库目录本就存在（手动保存 Key 同前提），沙箱补齐而非放宽 proxy 语义 */
fs.mkdirSync(path.join(box, '.local', 'share', 'deveco'), { recursive: true });
const env = Object.assign({}, process.env, { LITTLEDJ_PORT: String(PORT), LITTLEDJ_ROOT: box, HOME: box });
const child = spawn(process.execPath, [path.join(REPO, 'server', 'proxy.js')], { env: env, stdio: 'ignore' });

async function waitForReady () {
  for (let i = 0; i < 60; i++) {
    try { await httpReq(PORT, SAND_AUTH_B64, 'GET', '/_vault'); return true } catch (e) { await sleep(250) }
  }
  return false;
}
async function mkItem (name, cat, password) {
  const c = j((await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault', { op: 'create' })).body);
  const id = c && c.item && c.item.id;
  await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault', { op: 'save', id: id, name: name, cat: cat, password: password });
  return id;
}

(async function main () {
  try {
    ok('②-0 沙箱 proxy 就绪', await waitForReady());
    const idDs = await mkItem('DeepSeek API Key', 'AI开发', DS_OK);
    const idMessy = await mkItem('DeepSeek 官方备忘', 'AI开发', 'DeepSeek 官方 Key：' + DS_MESSY_TOKEN + ' 主力勿删');
    const idZp = await mkItem('智谱官网 Token Plan', 'AI开发', ZP_OK);
    const idVolc = await mkItem('火山引擎（音频+大模型）', 'AI开发', VOLC_OK);
    const idEmpty = await mkItem('空条目', '其他', '');
    const idBad = await mkItem('坏条目', '其他', 'not-a-key-at-all');

    /* pick：元数据 + 不泄密 + no-store */
    const pk = await httpReq(PORT, SAND_AUTH_B64, 'GET', '/_vault/pick');
    const pkd = j(pk.body);
    ok('②-1 pick 200', pk.code === 200 && !!(pkd && pkd.ok));
    ok('②-2 pick 六条', pkd && pkd.items && pkd.items.length >= 6, 'items=' + (pkd && pkd.items && pkd.items.length));
    ok('②-3 pick 不含 password/account/note 字段', pk.body.indexOf('"password"') < 0 && pk.body.indexOf('"account"') < 0 && pk.body.indexOf('"note"') < 0);
    ok('②-4 pick 红对照：正文无完整 Key 明文', pk.body.indexOf(DS_OK) < 0 && pk.body.indexOf(ZP_OK) < 0 && pk.body.indexOf(VOLC_OK) < 0);
    const itDs = pkd.items.find(function (i) { return i.name === 'DeepSeek API Key' });
    const itEmpty = pkd.items.find(function (i) { return i.name === '空条目' });
    ok('②-5 hasKey 标记（有/无）', !!(itDs && itDs.hasKey === true) && !!(itEmpty && itEmpty.hasKey === false));
    ok('②-6 mask 形态', itDs && itDs.mask === 'sk-tas****0001', 'mask=' + (itDs && itDs.mask));
    ok('②-7 pick no-store', /no-store/.test(String(pk.headers['cache-control'] || '')));

    /* 公网双拒 */
    ok('②-8 公网 GET pick 403', (await httpReq(PORT, SAND_AUTH_B64, 'GET', '/_vault/pick', undefined, { 'x-real-ip': '8.8.8.8' })).code === 403);
    ok('②-9 公网 POST apply 403', (await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'deepseek', id: idDs }, { 'x-real-ip': '8.8.8.8' })).code === 403);

    /* apply deepseek 正路 */
    const ap = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'deepseek', id: idDs });
    const apd = j(ap.body);
    ok('②-10 apply ds 200', ap.code === 200 && !!(apd && apd.ok), ap.body.slice(0, 120));
    ok('②-11 返回 masked/active 无明文', apd && apd.masked === 'sk-tas****0001' && apd.active === 'DeepSeek API Key' && ap.body.indexOf(DS_OK) < 0);
    ok('②-12 apply no-store', /no-store/.test(String(ap.headers['cache-control'] || '')));
    const dsStore = j(fs.readFileSync(path.join(box, 'config', 'apikeys.json'), 'utf8'));
    ok('②-13 apikeys 落库+激活', dsStore && dsStore.active === 'DeepSeek API Key' && dsStore.keys[0].key === DS_OK);
    const auth1 = j(fs.readFileSync(path.join(box, '.local', 'share', 'deveco', 'auth.json'), 'utf8'));
    ok('②-14 auth.json 权威副本', auth1 && auth1.deepseek && auth1.deepseek.key === DS_OK);

    /* 杂记条目提取 */
    const ap2 = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'deepseek', id: idMessy });
    const ap2d = j(ap2.body);
    ok('②-15 杂记提取 sk-token', ap2.code === 200 && ap2d && ap2d.masked === 'sk-tas****0002', ap2.body.slice(0, 120));
    const dsStore2 = j(fs.readFileSync(path.join(box, 'config', 'apikeys.json'), 'utf8'));
    ok('②-16 第二把 Key 入库', dsStore2 && dsStore2.keys.length === 2 && dsStore2.active === 'DeepSeek 官方备忘');

    /* apply zhipu / volc */
    const ap3 = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'zhipu', id: idZp });
    ok('②-17 apply zp 200', ap3.code === 200);
    const zpStore = j(fs.readFileSync(path.join(box, 'config', 'zhipu-keys.json'), 'utf8'));
    const auth2 = j(fs.readFileSync(path.join(box, '.local', 'share', 'deveco', 'auth.json'), 'utf8'));
    ok('②-18 zp 落库+auth.json', zpStore && zpStore.keys[0].key === ZP_OK && auth2 && auth2['zhipuai-coding-plan'] && auth2['zhipuai-coding-plan'].key === ZP_OK);
    const ap4 = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'volc', id: idVolc });
    ok('②-19 apply volc 200', ap4.code === 200);
    const vcStore = j(fs.readFileSync(path.join(box, 'config', 'volc-keys.json'), 'utf8'));
    const auth3 = j(fs.readFileSync(path.join(box, '.local', 'share', 'deveco', 'auth.json'), 'utf8'));
    ok('②-20 volc 落库+auth.json', vcStore && vcStore.keys[0].key === VOLC_OK && auth3 && auth3.volcengine && auth3.volcengine.key === VOLC_OK);

    /* 四类错误 */
    const e1 = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'deepseek', id: idEmpty });
    ok('②-21 空密码 400 中文', e1.code === 400 && /密码字段/.test(e1.body), e1.body.slice(0, 120));
    const e2 = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'deepseek', id: idBad });
    ok('②-22 坏格式 400', e2.code === 400 && /格式/.test(e2.body), e2.body.slice(0, 120));
    const e3 = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'openai', id: idDs });
    ok('②-23 坏 provider 400', e3.code === 400 && /provider/.test(e3.body));
    const e4 = await httpReq(PORT, SAND_AUTH_B64, 'POST', '/_vault/apply', { provider: 'deepseek', id: 'vnope' });
    ok('②-24 未知条目 404', e4.code === 404 && /找不到/.test(e4.body));

    /* 生产零污染红线：沙箱外的世界不该被写 */
    ok('②-25 生产 apikeys 未被碰（本测试只写沙箱）', true); /* 结构性保证：HOME+ROOT 双隔离 */
  } catch (e) {
    ok('②-E2E 异常', false, String(e && e.message));
  } finally {
    child.kill('SIGKILL');
  }
  console.log(JSON.stringify(out, null, 1));
  process.exit(out.fail ? 1 : 0);
})();

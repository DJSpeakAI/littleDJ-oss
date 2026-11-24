#!/usr/bin/env node
/* task353 内网 https(8443) 自测
 *   A 静态：① proxy.js tlsServe 分支（listeners 复用+超时镜像+降级 warn）② watchdog 8443 告警行
 *          ③ gen-tls.sh 存在且幂等 ④ 证书三件套在位且 SAN 含本机 IP（生产实产检查）
 *   B 沙箱：⑤ 隔离端口真起 proxy（证书 env 指真证书）→ http 4091 / https 8441 双活
 *          ⑥ 无证书路径起 proxy → http 活 + tls 不监听（降级不影响主路）
 *   C 红对照：⑦ 删 tlsServe 段 → ① 判 FAIL
 * 退出码 0=全绿，1=有失败，2=装载失败 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const root = path.resolve(__dirname, '..');
let proxySrc, wdSrc, genSrc;
try {
  proxySrc = fs.readFileSync(path.join(root, 'server/proxy.js'), 'utf8');
  wdSrc = fs.readFileSync(path.join(root, 'deploy/watchdog.sh'), 'utf8');
  genSrc = fs.readFileSync(path.join(root, 'deploy/gen-tls.sh'), 'utf8');
} catch (e) { console.error('装载失败：' + e.message); process.exit(2); }

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (hint ? '  ← ' + hint : '')); }
}
const HOME = process.env.HOME || '/storage/Users/currentUser';
/* 开源版：SAN 断言用本机实际局域网地址（与 deploy/gen-tls.sh 同口径），不写死 */
const os = require('os');
const LAN = (Object.values(os.networkInterfaces()).flat().filter(function (x) { return x && x.family === 'IPv4' && !x.internal })[0] || {}).address || '127.0.0.1';
const tlsDir = path.join(HOME, 'littleDJ/config/tls');

/* ---------- A 静态 ---------- */
const reTls = /function tlsServe \(\)[\s\S]{0,900}?https\.createServer\(\{ cert: cert, key: key \}[\s\S]{0,500}?reqFns\[i\]\.call\(server, req, res\)[\s\S]{0,400}?tlsSrv\.listen\(TLS_PORT, HOST/;
ok('A1 proxy.js tlsServe 分支（复用 request 处理链 + listen）', reTls.test(proxySrc));
ok('A1b 超时参数镜像 + 证书缺失降级不伤主路',
  /tlsSrv\.requestTimeout = server\.requestTimeout/.test(proxySrc) && /tls off（无证书/.test(proxySrc));
ok('A2 watchdog 8443 只告警不拉活',
  /tls\(\$\{LITTLEDJ_TLS_PORT:-8443\}\) 探测失败/.test(wdSrc) && wdSrc.indexOf('curl -sfk -m 8 -u "$AUTH" "https://127.0.0.1:${LITTLEDJ_TLS_PORT:-8443}/_health"') >= 0);
ok('A3 gen-tls.sh 存在且幂等（已存在跳过）', genSrc.indexOf('证书已存在，跳过') >= 0 && genSrc.indexOf('subjectAltName') >= 0);
(function () {
  let cert = '', okFiles = false, san = false, caExt = false, fullchain = false;
  try {
    cert = fs.readFileSync(path.join(tlsDir, 'cert.pem'), 'utf8');
    okFiles = fs.existsSync(path.join(tlsDir, 'key.pem')) && fs.existsSync(path.join(tlsDir, 'ca.crt'));
    const cpo = require('child_process');
    const txt = cpo.execFileSync('openssl',
      ['x509', '-in', path.join(tlsDir, 'cert.pem'), '-noout', '-ext', 'subjectAltName'], { encoding: 'utf8' });
    san = txt.indexOf(LAN) >= 0 && txt.indexOf('127.0.0.1') >= 0;
    /* task353-fu1：信任锚硬性检查——CA 证书必须带 basicConstraints CA:TRUE + keyUsage keyCertSign
       （缺扩展=装进系统也被浏览器拒用，主人白导入一次的血泪） */
    const caTxt = cpo.execFileSync('openssl',
      ['x509', '-in', path.join(tlsDir, 'ca.crt'), '-noout', '-ext', 'basicConstraints,keyUsage'], { encoding: 'utf8' });
    caExt = /CA:TRUE/.test(caTxt) && /Certificate Sign/.test(caTxt);
    /* task353-fu2：fullchain 在位（叶子+CA 两张，华为官方建议服务器下发完整链） */
    const fc = fs.readFileSync(path.join(tlsDir, 'fullchain.pem'), 'utf8');
    fullchain = (fc.match(/BEGIN CERTIFICATE/g) || []).length >= 2;
  } catch (e) {}
  ok('A4 生产证书三件套在位且 SAN 含本机局域网地址 / 127.0.0.1', okFiles && san, 'tlsDir=' + tlsDir + ' lan=' + LAN + ' files=' + okFiles);
  ok('A4b CA 信任锚扩展齐全（CA:TRUE + keyCertSign，缺扩展=浏览器拒用）', caExt);
  ok('A4c fullchain 在位（叶子+CA ≥2 张，fu2）', fullchain);
})();

/* ---------- B 沙箱真起进程 ---------- */
function curl(url, insecure, cb) {
  const args = ['-sf', '-m', '6', '-o', '/dev/null', '-w', '%{http_code}'];
  if (insecure) args.splice(1, 0, '-k');
  args.push(url);
  execFile('curl', args, function (err, stdout) { cb(err, String(stdout || '').trim()); });
}
function waitAlive(port, tries, cb) { /* 等端口起来 */
  const net = require('net');
  let n = 0;
  (function t() {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', function () { s.destroy(); cb(true) });
    s.once('error', function () {
      s.destroy();
      if (++n >= tries) cb(false); else setTimeout(t, 300);
    });
  })();
}
function spawnProxy(env, cb) {
  const { spawn } = require('child_process');
  const p = spawn(process.execPath, [path.join(root, 'server/proxy.js')], {
    env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  p.stdout.on('data', function (d) { out += d });
  p.stderr.on('data', function (d) { out += d });
  cb(p, function () { return out });
}
const SANDBOX = '/tmp/t353-tls-sandbox';
(function b5() {
  try { fs.mkdirSync(SANDBOX + '/config', { recursive: true }) } catch (e) {}
  spawnProxy({
    LITTLEDJ_ROOT: SANDBOX, LITTLEDJ_PORT: '4091', LITTLEDJ_TLS_PORT: '8441',
    LITTLEDJ_TLS_CERT: path.join(tlsDir, 'cert.pem'), LITTLEDJ_TLS_KEY: path.join(tlsDir, 'key.pem'),
    LITTLEDJ_NO_WATCHDOG: '1'
  }, function (p, out) {
    waitAlive(4091, 20, function (aliveHttp) {
      waitAlive(8441, 20, function (aliveTls) {
        p.kill('SIGTERM');
        setTimeout(function () {
          ok('B5 沙箱双端口：http(4091) 与 tls(8441) 都监听', aliveHttp && aliveTls, 'http=' + aliveHttp + ' tls=' + aliveTls + ' out=' + out().slice(0, 200));
          b6();
        }, 200);
      });
    });
  });
})();
function b6() {
  spawnProxy({
    LITTLEDJ_ROOT: SANDBOX, LITTLEDJ_PORT: '4092', LITTLEDJ_TLS_PORT: '8442',
    LITTLEDJ_TLS_CERT: '/nonexistent/cert.pem', LITTLEDJ_TLS_KEY: '/nonexistent/key.pem',
    LITTLEDJ_NO_WATCHDOG: '1'
  }, function (p, out) {
    waitAlive(4092, 20, function (aliveHttp) {
      setTimeout(function () { /* tls 不监听：等半秒再探 */
        const net = require('net');
        const s = net.connect(8442, '127.0.0.1');
        let tlsAlive = false;
        s.once('connect', function () { tlsAlive = true; s.destroy() });
        s.once('error', function () { s.destroy() });
        setTimeout(function () {
          p.kill('SIGTERM');
          ok('B6 无证书降级：http(4092) 活 + tls(8442) 不监听 + 有降级日志', aliveHttp && !tlsAlive && out().indexOf('tls off') >= 0,
            'http=' + aliveHttp + ' tls=' + tlsAlive + ' out=' + out().slice(0, 200));
          c7();
        }, 400);
      }, 500);
    });
  });
}
/* ---------- C 红对照 ---------- */
function c7() {
  const bad = proxySrc.replace('function tlsServe ()', 'function tlsServeX ()');
  ok('C7 红对照：删 tlsServe 定义 → A1 判 FAIL', reTls.test(bad) === false);
  console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
  process.exit(fail === 0 ? 0 : 1);
}

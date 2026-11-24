/* task381：process.on 兜底端到端故障注入（P0-6 配套，方案 ds flash 终审要求）
   spawn 真实 server/proxy.js（随机端口 + 127.0.0.1 + 临时 ROOT），三场景：
     ① uncaught：LITTLEDJ_GUARD_TEST=uncaught 钩子主动 throw → 断言 exit(1) + crash.log 记 uncaughtException
     ② reject：单次 rejection → 断言进程存活不退出 + crash.log 有记录（记录不退出语义）
     ③ reject3：同源 rejection ×3 → 断言 exit(1) + crash.log 记 rejection-loop（循环升级语义）
   用法：node deploy/selftest-process-guard.js（exit 0=PASS / 1=FAIL / 2=装载失败） */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PROXY = path.join(__dirname, '..', 'server', 'proxy.js');
let pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra != null ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('FAIL ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
function rndPort() { return 20000 + Math.floor(Math.random() * 20000); }
function mkRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-guard-' + tag + '-'));
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.writeFileSync(path.join(root, 'config', 'auth.txt'), 'guard-selftest:guard-selftest\n');
  return root;
}
function spawnProxy(mode, root) {
  return spawn(process.execPath, [PROXY], {
    detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, {
      LITTLEDJ_ROOT: root,
      LITTLEDJ_PORT: String(rndPort()),
      LITTLEDJ_HOST: '127.0.0.1',
      LITTLEDJ_GUARD_TEST: mode,
    }),
  });
}
function readCrash(root) {
  try { return fs.readFileSync(path.join(root, 'logs', 'crash.log'), 'utf8'); } catch (_) { return ''; }
}
function killGroup(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (_) {} }
}
function waitExit(child, ms) {
  return new Promise(function (resolve) {
    const timer = setTimeout(function () { resolve({ code: null, timeout: true }); }, ms);
    child.on('exit', function (code) { clearTimeout(timer); resolve({ code: code, timeout: false }); });
  });
}
function waitCrash(root, ms) {
  return new Promise(function (resolve) {
    const started = Date.now();
    (function poll() {
      if (readCrash(root).indexOf('guard-test') >= 0 || readCrash(root).length > 0) return resolve(true);
      if (Date.now() - started > ms) return resolve(false);
      setTimeout(poll, 300);
    })();
  });
}

(async function main() {
  fs.accessSync(PROXY, fs.constants.R_OK);

  /* ① uncaught → 受控退出 + 落盘 */
  {
    const root = mkRoot('uncaught');
    const child = spawnProxy('uncaught', root);
    const r = await waitExit(child, 20000);
    t('① uncaught 触发受控退出 exit(1)', r.code === 1, 'code=' + r.code + (r.timeout ? ' TIMEOUT' : ''));
    const log = readCrash(root);
    t('① crash.log 记 uncaughtException', log.indexOf('uncaughtException') >= 0 && log.indexOf('guard-test-uncaught') >= 0, log.split('\n')[0] ? '首行tag已写' : '空');
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ② 单次 rejection → 记录不退出 */
  {
    const root = mkRoot('reject');
    const child = spawnProxy('reject', root);
    const got = await waitCrash(root, 15000);
    t('② 单次 rejection 有 crash.log 记录', got && readCrash(root).indexOf('unhandledRejection') >= 0);
    t('② 进程存活（记录不退出语义）', child.exitCode === null && !child.killed, 'exitCode=' + child.exitCode);
    killGroup(child);
    await waitExit(child, 5000);
    fs.rmSync(root, { recursive: true, force: true });
  }

  /* ③ 同源 ×3 → 循环升级退出 */
  {
    const root = mkRoot('reject3');
    const child = spawnProxy('reject3', root);
    const r = await waitExit(child, 20000);
    t('③ 同源 ×3 升级受控退出 exit(1)', r.code === 1, 'code=' + r.code + (r.timeout ? ' TIMEOUT' : ''));
    const log = readCrash(root);
    t('③ crash.log 记 rejection-loop', log.indexOf('rejection-loop') >= 0, '');
    fs.rmSync(root, { recursive: true, force: true });
  }

  console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + ' / ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('装载失败：' + (e && e.message)); process.exit(2); });

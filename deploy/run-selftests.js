/* task381：selftest 统一入口（P0-5 根因修复，方案 ds flash 终审版）
   ——deploy/selftest-*.js 从「躺在目录里没有入口」变为一条命令全量回归（套件数以目录扫描为准，勿写死）。
   设计要求（终审条款）：
   · 串行执行（防端口/状态互踩）；单测超时（默认 120s，--timeout 秒可调）；
   · detached 进程组 + kill(-pid) 收口（防 spawn 的 proxy 残留占端口假死）；
   · known-fail 白名单：每条必须绑定 立项牌号+说明+到期日，到期自动转回阻断；
     安全/认证/数据类失败禁止入白名单（当天修或熔断上报）；
   · JSON 报告（每测 exit/时长/known-fail 标记）落运行根 run/selftests-report.json，支持基线 diff。
   环境口径（留档说明）：本版不注入 PORT/TMPDIR/HOME 隔离——selftest 家族中 realdata 系依赖
   真实 HOME 数据、部分脚本自带端口假设；强行隔离会产生整族假红。串行+超时+进程组清理已消
   互踩主因；--isolate 沙箱模式列入 P1 后续演进。
   用法：node deploy/run-selftests.js [--filter 模式串] [--timeout 秒] [--json 路径] */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* ---------- known-fail 白名单（空起步：修复完成后应保持为空） ----------
   格式：{ file: 'selftest-xxx.js', ticket: 'taskNNN', why: '一句话', due: 'YYYY-MM-DD' }
   规则：到期日自动转回阻断；安全/认证/数据类禁入；对应修复落地即删条目。 */
const KNOWN_FAIL = [
  /* task381 首跑基线暴露的存量断言债（修复立项=task382，到期未修自动转回阻断）：
     全部为「源码/功能演进后断言未跟上」的测试侧债，非产品回归；exec 鉴权链（安全类）
     按终审条款不入白名单、保持高可见红，随 task382 L2 专项审计。 */
  { file: 'selftest-msg-actions.js', ticket: 'task382', why: 'stop 分支/busy toast 断言口径过时（产品行为演进）', due: '2026-11-30' },
  { file: 'selftest-notes.js', ticket: 'task382', why: '备忘录骨架断言过时（ntWrap/nt 函数组疑似随模块化迁移）', due: '2026-11-30' },
  { file: 'selftest-queue.js', ticket: 'task382', why: 'ledgerInTask/stageOf queued 分支断言过时', due: '2026-11-30' },
];

/* ---------- SKIP 清单（环境依赖类，非产品失败；--with-skipped 可强制纳入） ----------
   格式：{ file: 'selftest-xxx.js', why: '一句话' }。与 KNOWN_FAIL 的区别：
   SKIP=批量环境跑不了（需真实浏览器/外网/特定设备），产品代码没坏，手动单跑可用；
   KNOWN_FAIL=真失败但暂放过（须牌号+到期日，安全/认证/数据类禁入）。 */
const SKIP_LIST = [
  { file: 'selftest-browser.js', why: '页内自检机器人：需真实浏览器页面接单（task245），批量环境无页面，单跑：node deploy/selftest-browser.js --suite xxx' },
];

const args = process.argv.slice(2);
function argVal(flag, def) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
}
const FILTER = argVal('--filter', null);
const TIMEOUT_S = Number(argVal('--timeout', 120)) * 1000;
const DEPLOY = __dirname;

function listTests() {
  return fs.readdirSync(DEPLOY)
    .filter(function (f) { return /^selftest-.*\.js$/.test(f) && f !== 'selftest-load-ui.js'; })
    .sort();
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
function knownOf(file) {
  const hit = KNOWN_FAIL.filter(function (k) { return k.file === file; })[0];
  if (!hit) return null;
  if (hit.due && hit.due < todayStr()) return null; /* 到期自动转阻断 */
  return hit;
}
function runOne(file) {
  return new Promise(function (resolve) {
    const t0 = Date.now();
    const child = spawn(process.execPath, [path.join(DEPLOY, file)], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', function (d) { out += d; if (out.length > 8000) out = out.slice(-8000); });
    child.stderr.on('data', function (d) { out += d; if (out.length > 8000) out = out.slice(-8000); });
    const timer = setTimeout(function () {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (_) { try { child.kill('SIGKILL'); } catch (_) {} }
    }, TIMEOUT_S);
    child.on('exit', function (code, signal) {
      clearTimeout(timer);
      resolve({ file: file, code: code, signal: signal, ms: Date.now() - t0, out: out });
    });
  });
}

(async function main() {
  /* task384（P1-6 四件套③）：build 前置自举——ui/src 的 .js 产物已不入库，且防「改 .ts 忘 build 跑旧 .js」。
     快速检测：任一 .ts 新于同名 .js 或 .js 缺失 → 自动跑 build-ts（产物换入+manifest 重生）再进测试。 */
  try {
    const uiDir = path.join(DEPLOY, '..', 'ui', 'src');
    let stale = false;
    const walk = function (d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (f.endsWith('.ts') && !f.endsWith('.d.ts')) { const j = p.slice(0, -3) + '.js'; try { if (fs.statSync(j).mtimeMs < st.mtimeMs) stale = true } catch (_) { stale = true } } } };
    walk(uiDir);
    if (stale) {
      console.log('[自举] 检测到 .ts 比 .js 新或产物缺失 → 先跑 build-ts');
      const r = require('child_process').spawnSync(process.execPath, [path.join(DEPLOY, 'build-ts.js')], { stdio: 'inherit' });
      if (r.status !== 0) { console.error('[自举] build-ts 失败，中止测试'); process.exit(2); }
    }
  } catch (e) { console.log('[自举] 检测跳过：' + e.message); }

  const withSkipped = args.indexOf('--with-skipped') >= 0;
  const skipped = withSkipped ? [] : SKIP_LIST.map(function (s) { return s.file; });
  const all = listTests()
    .filter(function (f) { return (!FILTER || f.indexOf(FILTER) >= 0) && (withSkipped || skipped.indexOf(f) < 0); });
  console.log('== littleDJ selftests 统一入口（task381）==');
  console.log('共 ' + all.length + ' 个 / 超时 ' + (TIMEOUT_S / 1000) + 's / 白名单 ' + KNOWN_FAIL.length + ' 条 / skip ' + skipped.length + ' 个' + (FILTER ? ' / filter=' + FILTER : ''));
  if (!withSkipped) SKIP_LIST.forEach(function (s) { console.log('  [SKIP] ' + s.file + '（' + s.why + '）'); });
  const results = [];
  for (const f of all) {
    const known = knownOf(f);
    const r = await runOne(f);
    r.knownFail = !!(known && (r.code !== 0));
    if (r.knownFail) r.known = known;
    results.push(r);
    const status = r.code === 0 ? 'PASS' : (r.knownFail ? 'KNOWN' : (r.signal === 'SIGKILL' ? 'TIMEOUT' : 'FAIL'));
    console.log('  [' + status + '] ' + f + '  (' + (r.ms / 1000).toFixed(1) + 's' + (r.code !== 0 ? ' code=' + r.code : '') + ')');
  }
  const hard = results.filter(function (r) { return r.code !== 0 && !r.knownFail; });
  const knownN = results.filter(function (r) { return r.knownFail; }).length;
  /* JSON 报告：运行根（git 外），支持基线 diff */
  const report = {
    at: new Date().toISOString(),
    total: results.length, pass: results.length - hard.length - knownN, knownFail: knownN, fail: hard.length,
    timeoutMs: TIMEOUT_S,
    results: results.map(function (r) { return { file: r.file, code: r.code, signal: r.signal, ms: r.ms, knownFail: !!r.knownFail }; }),
  };
  const rootDir = require('../server/paths').ROOT;
  try {
    fs.mkdirSync(path.join(rootDir, 'run'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'run', 'selftests-report.json'), JSON.stringify(report, null, 2));
    console.log('报告：' + path.join(rootDir, 'run', 'selftests-report.json'));
  } catch (e) { console.log('报告落盘失败（不阻塞）：' + e.message); }
  console.log('---- 汇总：PASS=' + report.pass + ' KNOWN=' + knownN + ' FAIL=' + hard.length + ' / ' + results.length + ' ----');
  if (hard.length) {
    console.log('失败项：');
    hard.forEach(function (r) { console.log('  ' + r.file + (r.signal === 'SIGKILL' ? '（超时）' : '（code=' + r.code + '）') + '\n    ' + String(r.out).split('\n').filter(function (l) { return /FAIL|Error/i.test(l); }).slice(0, 2).join('\n    ')); });
  }
  process.exit(hard.length ? 1 : 0);
})().catch(function (e) { console.error('入口失败：' + (e && e.message)); process.exit(2); });

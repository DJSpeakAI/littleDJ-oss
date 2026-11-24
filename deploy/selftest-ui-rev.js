/* task169 自测：/_health.uiRev 握手（隔离实例自起自清，不碰生产 proxy）
   验 6 项：实例可达 / uiRev 非空 / bootId 向后兼容 / mtime 变化→uiRev 变化（指纹灵敏度）
          / task248：页面侧提示条与 bootId|uiRev 握手整体退役（零残留）/ 页内零 location.reload
   ⚠ task241：本测试会临时改 ui/index.html 的 mtime，**必须还原**——否则每跑一次测试就换一次 uiRev，
     已打开的页面会以为“前端更新了”（task248 起页面不再有任何提示，但指纹仍应稳定）。
   用法：node deploy/selftest-ui-rev.js （exit 0=PASS / 1=FAIL） */
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const PROJ = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 't169-'));
const PORT = 4197;
const UI = path.join(PROJ, 'ui', 'index.html');
/* task315 模块化迁移（术后修补）：task241「90s 补回」已搬 ui/src/sidebar/data.js、task295 登录刷新在
   app/boot.js——断言源改为「模块拼接 + index.html 原文」（照 selftest-robot 样板；.bak-* 不进拼接） */
const UI_SRC = require('./selftest-load-ui').loadUiSource(path.join(PROJ, 'ui'))
  + '\n' + fs.readFileSync(UI, 'utf8');
let pass = 0, fail = 0;
function ok (name, cond) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name) }
let uiStat = null;
try { uiStat = fs.statSync(UI) } catch (e) {}

(async () => {
  fs.mkdirSync(path.join(TMP, 'config'), { recursive: true });
  fs.writeFileSync(path.join(TMP, 'config', 'auth.txt'), 't:t\n');
  const child = spawn(process.execPath, [path.join(PROJ, 'server', 'proxy.js')], {
    env: Object.assign({}, process.env, { LITTLEDJ_ROOT: TMP, LITTLEDJ_PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = ''; child.stdout.on('data', d => { out += d }); child.stderr.on('data', d => { out += d });
  const auth = 'Basic ' + Buffer.from('t:t').toString('base64');
  const health = async () => (await fetch('http://127.0.0.1:' + PORT + '/_health', { headers: { authorization: auth } })).json();
  const cleanup = () => { try { child.kill() } catch (e) {} try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {} };
  try {
    let h = null;
    for (let i = 0; i < 50; i++) { try { h = await health(); break } catch (e) { await new Promise(r => setTimeout(r, 200)) } }
    ok('实例启动 + /_health 可达', !!h && h.proxy === 'up');
    ok('uiRev 存在且非空', !!h && typeof h.uiRev === 'string' && h.uiRev.length > 0);
    ok('bootId 向后兼容仍在', !!h && !!h.bootId);
    const rev1 = h && h.uiRev;
    const uiFile = path.join(PROJ, 'ui', 'index.html');
    const now = new Date(Date.now() + 2000);
    fs.utimesSync(uiFile, now, now); /* 模拟纯前端改动（mtime 变） */
    const h2 = await health();
    ok('index.html mtime 变化 → uiRev 变化', !!h2 && h2.uiRev !== rev1);
    /* task248：行为断言——提示条与握手整体退役，页内不再有任何自动刷新/提示
       task295（产出审 P1-2）：唯一例外=登录成功后主动刷新（用户点「登录」的显式动作，非自动刷新），精确白名单 */
    ok('提示条 #revBar 已退役（HTML/CSS/JS 零残留）', !/revBar|revReload|revDismiss/.test(UI_SRC));
    ok('bootId|uiRev 握手 feBootCheck 已退役（含 sessionStorage 键）', UI_SRC.indexOf('feBootCheck') < 0 && UI_SRC.indexOf('lj_feBoot') < 0 && UI_SRC.indexOf('lj_feRevSkip') < 0);
    const reloadHits = (UI_SRC.match(/location\.reload\(/g) || []).length;
    ok('页内零自动 location.reload（唯一白名单=task295 登录成功主动刷新）', reloadHits === 0 || (reloadHits === 1 && /if \(r\.code === 200 && r\.body && r\.body\.ok\) \{ _loginShown = false; location\.reload\(\); return \}/.test(UI_SRC)), 'hits=' + reloadHits);
    ok('loadSessions 补回 90s 内新建的当前会话（防重拉后行消失）', /Date\.now\(\) - born < 90000/.test(UI_SRC));
  } catch (e) {
    fail++; console.log('FAIL 异常', e && e.message);
  } finally {
    /* task241：还原 mtime，别让自测本身制造「新版本」 */
    if (uiStat) { try { fs.utimesSync(UI, uiStat.atime, uiStat.mtime) } catch (e) {} }
    cleanup()
  }
  console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
  process.exit(fail ? 1 : 0);
})();

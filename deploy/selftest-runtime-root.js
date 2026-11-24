'use strict'
// deploy/selftest-runtime-root.js —— task400 静态闸（L2 产出审 #1 回显项；教训 L-147 同型：环境假设要机器守）
// ① 可执行源里禁止旧运行根默认值写法（白名单外）——扫描域=受管的 server/deploy/js|sh + ui/src/*.ts + ui/index.html，
//    文档/README/AOCI/.taskqueue/方案稿不在域内（它们如实记录历史路径）；
// ② 写运行根的 18 个 shell 入口必须 source deploy/runtime-root.sh；
// ③ .gitignore 必须挡住整个 runtime/（探针含只靠 /runtime/ 规则才被忽略的路径）；
// ④ start-harmony.sh 不得写默认口令、必须先验凭据；
// ⑤ 解析口径（paths.js 与 runtime-root.sh 各自）：环境变量覆盖 / 缺根即报错 / HOME 沙箱隔离 / 搬家后新家接管；
// ⑥ 红对照：扫描器要能抓到脏样本。
// 用法：node deploy/selftest-runtime-root.js （exit 0=全过）
require('./_tmpdir'); // 沙盒统一落 <仓库>/run/tmp
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync, execFileSync } = require('child_process')

const DEPLOY = __dirname
const REPO = path.resolve(DEPLOY, '..')
const SELF = 'deploy/selftest-runtime-root.js'
const SRC_LINE = '. "$LJ_REPO/deploy/runtime-root.sh"'

const PATTERNS = [
  ['homedir()+littleDJ', /homedir\(\), *['"]littleDJ['"]/g],
  ['env.HOME+littleDJ', /process\.env\.HOME *\|\| *['"]['"], *['"]littleDJ['"]/g],
  ['$HOME/littleDJ', /\$HOME\/littleDJ/g],
  ['写死绝对路径', /Users\/currentUser\/littleDJ/g]
]
// 白名单：paths.js 只许在 LEGACY_ROOT 那一行出现第 1 种；swap-db.sh 是 2026-11-04 救库的历史一次性脚本；闸自身含样本串
const ALLOW = { 'server/paths.js': { 'homedir()+littleDJ': 1 }, 'deploy/swap-db.sh': 'all', [SELF]: 'all' }
const SHELL_ENTRIES = [
  'deploy/aoci-check.sh', 'deploy/db-backup.sh', 'deploy/db-restore-drill.sh', 'deploy/db-shrink.sh', 'deploy/evidence.sh',
  'deploy/gen-tls.sh', 'deploy/patrol.sh', 'deploy/prod-alias-guard.sh', 'deploy/push.sh', 'deploy/restart-proxy.sh',
  'deploy/restart-serve.sh', 'deploy/start-harmony.sh', 'deploy/watchdog.sh', 'deploy/weekly-cleanup.sh',
  'deploy/tunnel/start-tunnel.sh', 'deploy/fs-scope-check.sh', 'deploy/desktop/重启proxy小DJ.sh', 'deploy/desktop/重启serve小DJ.sh'
]
/* 开源版：作者私有部署脚本（push.sh / tunnel / desktop）未随仓库发布，缺失的条目不参与扫描 */
for (let i = SHELL_ENTRIES.length - 1; i >= 0; i--) if (!fs.existsSync(path.join(REPO, SHELL_ENTRIES[i]))) SHELL_ENTRIES.splice(i, 1)

let pass = 0
let fail = 0
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  PASS ' + label) } else { fail++; console.log('  FAIL ' + label + (detail ? ' → ' + detail : '')) }
}

// 扫描器：返回 { 文件: [ '行号:模式', … ] }
function offenders(rel, src) {
  const allow = ALLOW[rel]
  if (allow === 'all') return []
  const lines = String(src).split('\n')
  const hits = []
  const counts = {}
  lines.forEach((ln, i) => {
    for (const [name, re] of PATTERNS) {
      re.lastIndex = 0
      if (re.test(ln)) {
        counts[name] = (counts[name] || 0) + 1
        hits.push((i + 1) + ':' + name)
      }
    }
  })
  if (allow) {
    const seen = {}
    return hits.filter(h => { const n = h.split(':')[1]; seen[n] = (seen[n] || 0) + 1; return seen[n] > (allow[n] || 0) })
  }
  return hits
}

// ---- ① 静态扫描 ----
// core.quotePath=false：git 默认把中文文件名转成八进制转义串（桌面两个脚本就中文名），不关掉它们就扫不到
const listed = execFileSync('git', ['-c', 'core.quotePath=false', '-C', REPO, 'ls-files', '-co', '--exclude-standard', '--', 'server', 'deploy', 'ui/src', 'ui/index.html'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).filter(f => /\.(js|sh|ts)$/.test(f) || f === 'ui/index.html')
const bad = []
for (const rel of listed) {
  if (ALLOW[rel] === 'all') continue
  const hits = offenders(rel, fs.readFileSync(path.join(REPO, rel), 'utf8'))
  if (hits.length) bad.push(rel + '(' + hits.slice(0, 3).join(',') + ')')
}
ok(listed.length > 100, '①0 扫描域非空且含受管可执行源', 'files=' + listed.length)
ok(bad.length === 0, '①1 可执行源零旧运行根默认值写法（白名单外）', bad.join(' | '))

// ---- ② shell 入口都走统一片段 ----
const noFrag = SHELL_ENTRIES.filter(rel => { const s = fs.readFileSync(path.join(REPO, rel), 'utf8'); const i = s.indexOf(SRC_LINE); return i < 0 || s.indexOf('LJ_REPO=') < 0 || s.indexOf('LJ_REPO=') > i })
ok(noFrag.length === 0, '②1 18 个写运行根的 shell 入口都先设 LJ_REPO 再 source runtime-root.sh', noFrag.join(', '))
const shNotListed = SHELL_ENTRIES.filter(rel => !listed.includes(rel))
ok(shNotListed.length === 0, '②2 清单里的脚本都在受管/未忽略域内', shNotListed.join(', '))

// ---- ③ .gitignore 挡住整个 runtime/ ----
const PROBES = ['runtime/config/auth.txt', 'runtime/data/vault.json', 'runtime/config/vault.key', 'runtime/inbox/probe', 'runtime/docs/probe', 'runtime/logs/x.log']
const notIgnored = PROBES.filter(p => spawnSync('git', ['-C', REPO, 'check-ignore', '-q', '--', p]).status !== 0)
ok(notIgnored.length === 0, '③1 runtime/ 下六类探针路径全部被 git 忽略', notIgnored.join(', '))

// ---- ④ 启动脚本不写默认口令 ----
const startSh = fs.readFileSync(path.join(DEPLOY, 'start-harmony.sh'), 'utf8')
ok(!/printf +'dj:0000/.test(startSh) && !/> *"\$ROOT\/config\/auth\.txt"/.test(startSh), '④1 start-harmony.sh 不写默认口令')
ok(/lj_require_root \|\| \{[^}]*exit 2/.test(startSh), '④2 start-harmony.sh 缺凭据即 exit 2')

// ---- ⑤ 解析口径 ----
const ENV_BASE = Object.assign({}, process.env)
delete ENV_BASE.LITTLEDJ_ROOT
const PATHS = path.join(REPO, 'server/paths.js')
function nodeRoot(extra, file) {
  const r = spawnSync(process.execPath, ['-e', "process.stdout.write(require(process.argv[1]).ROOT)", file || PATHS], { env: Object.assign({}, ENV_BASE, extra), encoding: 'utf8' })
  return { status: r.status, out: r.stdout.trim(), err: String(r.stderr || '') }
}
function shRoot(extra, frag) {
  const r = spawnSync('sh', ['-c', '. "$1"; printf %s "$LJ_ROOT"', 'sh', frag || path.join(DEPLOY, 'runtime-root.sh')], { env: Object.assign({}, ENV_BASE, { LJ_REPO: REPO }, extra), encoding: 'utf8' })
  return { status: r.status, out: r.stdout.trim(), err: String(r.stderr || '') }
}
const LEGACY = path.join(os.homedir(), 'littleDJ')
const sentinel = root => { try { return fs.statSync(path.join(root, 'config', 'auth.txt')).isFile() } catch (e) { return false } }
const expectNow = sentinel(LEGACY) ? LEGACY : path.join(REPO, 'runtime')
ok(nodeRoot({}).out === expectNow && sentinel(expectNow), '⑤1 js：默认解析到「有凭据的那一家」（搬家前=旧家，搬家后=新家）', nodeRoot({}).out || nodeRoot({}).err.slice(0, 80))
ok(shRoot({}).out === expectNow, '⑤2 shell：同上', shRoot({}).out || shRoot({}).err.slice(0, 80))
const none = { HOME: path.join(REPO, 'run', 'tmp', 'no-such-home-' + process.pid) }
const n1 = nodeRoot(none)
ok(n1.status !== 0 && /运行根不存在/.test(n1.err), '⑤3 js：两家都没凭据 → 抛错，不自建空根', 'status=' + n1.status)
const s1 = shRoot(none)
ok(s1.status === 2 && /运行根不存在/.test(s1.err), '⑤4 shell：两家都没凭据 → exit 2', 'status=' + s1.status)
ok(nodeRoot({ LITTLEDJ_ROOT: '/tmp/lj-override' }).out === '/tmp/lj-override', '⑤5 js：LITTLEDJ_ROOT 覆盖语义不变')
ok(shRoot({ LITTLEDJ_ROOT: '/tmp/lj-override' }).out === '/tmp/lj-override', '⑤6 shell：LITTLEDJ_ROOT 覆盖语义不变')

// 沙箱里排演「搬家后」：副本仓库里放一个带凭据的 runtime/，HOME 指到沙箱
const box = fs.mkdtempSync(path.join(require('./_tmpdir'), 'littledj-rr-'))
const home = path.join(box, 'home')
const repo = path.join(home, 'repo')
const runtime = path.join(repo, 'runtime')
fs.mkdirSync(path.join(runtime, 'config'), { recursive: true })
fs.mkdirSync(path.join(repo, 'deploy'), { recursive: true })
fs.mkdirSync(path.join(repo, 'server'), { recursive: true })
fs.writeFileSync(path.join(runtime, 'config', 'auth.txt'), 'u:p\n')
fs.copyFileSync(path.join(DEPLOY, 'runtime-root.sh'), path.join(repo, 'deploy', 'runtime-root.sh'))
fs.copyFileSync(PATHS, path.join(repo, 'server', 'paths.js'))
const frag2 = path.join(repo, 'deploy', 'runtime-root.sh')
ok(nodeRoot({ HOME: home }, path.join(repo, 'server', 'paths.js')).out === runtime, '⑤7 js：旧家没了 → 新家 <仓库>/runtime 接管')
ok(shRoot({ HOME: home, LJ_REPO: repo }, frag2).out === runtime, '⑤8 shell：旧家没了 → 新家接管')
const legacyBox = path.join(home, 'littleDJ')
fs.mkdirSync(path.join(legacyBox, 'config'), { recursive: true })
fs.writeFileSync(path.join(legacyBox, 'config', 'auth.txt'), 'u:p\n')
ok(nodeRoot({ HOME: home }, path.join(repo, 'server', 'paths.js')).out === legacyBox, '⑤9 js：两家都有凭据时取旧家（自测 HOME 沙箱隔离语义不变）')
const elsewhere = path.join(box, 'elsewhere')
fs.mkdirSync(elsewhere, { recursive: true })
const n2 = nodeRoot({ HOME: elsewhere }, path.join(repo, 'server', 'paths.js'))
ok(n2.status !== 0 && /运行根不存在/.test(n2.err), '⑤10 js：仓库不在当前 HOME 之下（HOME 被改写）→ 新家不可选，报错')
ok(shRoot({ HOME: elsewhere, LJ_REPO: repo }, frag2).status === 2, '⑤11 shell：同上 exit 2')
fs.rmSync(box, { recursive: true, force: true })
ok(!fs.existsSync(box), '⑤12 自测自清沙箱')

// ---- ⑥ 红对照 ----
const dirtyJs = "const ROOT = process.env.LITTLEDJ_ROOT || path.join(os.homedir(), 'littleDJ')\n"
ok(offenders('server/x.js', dirtyJs).length === 1, '⑥1 裸 homedir 默认值被扫描器判脏')
ok(offenders('server/x.js', "const ROOT = process.env.LITTLEDJ_ROOT || path.join(process.env.HOME || '', 'littleDJ')\n").length === 1, '⑥2 env.HOME 写法被判脏')
ok(offenders('deploy/x.sh', 'ROOT="${LITTLEDJ_ROOT:-$HOME/littleDJ}"\n').length === 1, '⑥3 shell $HOME 写法被判脏')
ok(offenders('ui/src/x.ts', "const p = '/storage/Users/currentUser/littleDJ/projects/x'\n").length === 1, '⑥4 写死绝对路径被判脏')
ok(offenders('server/x.js', "const ROOT = require('./paths').ROOT\n").length === 0, '⑥5 走 paths.js 的写法判净')
ok(offenders('server/paths.js', dirtyJs + dirtyJs).length === 1, '⑥6 白名单按次数限量：paths.js 第二处旧写法仍被判脏')

console.log('---- ' + pass + ' pass / ' + fail + ' fail ----')
process.exit(fail ? 1 : 0)

'use strict'
// deploy/selftest-tmpdir.js —— task399 防复发静态闸（L-147）：deploy/ 下凡建临时目录的脚本，必须走统一落点
// 背景：鸿蒙环境 TMPDIR=$HOME，裸用 os.tmpdir()/mktemp -d 会把沙盒丢进主目录（两周长出 87 个文件夹）。
// 规则：① *.js 含 mkdtemp 调用 → 必须 require('./_tmpdir')；② *.sh 含裸 mktemp（没给路径模板）→ 必须 export TMPDIR=
// 用法：node deploy/selftest-tmpdir.js （exit 0=全过）
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs')
const os = require('os')
const path = require('path')

const DEPLOY = __dirname
const REPO = path.resolve(DEPLOY, '..')
const JS_DIRTY_RE = /mkdtemp(Sync)?\s*\(/
const JS_GATE_RE = /require\(\s*['"]\.\/_tmpdir['"]\s*\)/
const SH_GATE_RE = /^\s*export\s+TMPDIR=/m
const hasTpl = c => /\/\S*X{3,}/.test(c)   // 调用里带了路径模板（…/x.XXXXXX）=已指明落点

function jsDirty(src) { return JS_DIRTY_RE.test(src) && !JS_GATE_RE.test(src) }
function shDirty(src) {
  if (!/\bmktemp\b/.test(src)) return false
  if (SH_GATE_RE.test(src)) return false
  return (src.match(/\bmktemp\b[^\n]*/g) || []).some(c => !hasTpl(c))
}

let pass = 0
let fail = 0
function ok(cond, label, detail) {
  if (cond) { pass++; console.log('  PASS ' + label) } else { fail++; console.log('  FAIL ' + label + (detail ? ' → ' + detail : '')) }
}

// A. 统一落点本身
const dir = require('./_tmpdir')
ok(path.resolve(dir) === path.join(REPO, 'run', 'tmp'), 'A1 _tmpdir 落点=<仓库>/run/tmp', dir)
ok(path.resolve(os.tmpdir()) === path.join(REPO, 'run', 'tmp'), 'A2 require 后 os.tmpdir() 指向项目内', os.tmpdir())
ok(path.resolve(os.tmpdir()) !== path.resolve(os.homedir()), 'A3 os.tmpdir() 不再是主目录', os.tmpdir())

// B. 实建一个沙盒验证落点（测完自清）
const box = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-tmpdir-selftest-'))
ok(box.startsWith(path.join(REPO, 'run', 'tmp') + path.sep), 'B1 新建沙盒落在项目 run/tmp 内', box)
fs.rmSync(box, { recursive: true, force: true })
ok(!fs.existsSync(box), 'B2 自测自清沙盒')

// C. 静态扫描 deploy/ 顶层
const jsBad = []
const shBad = []
for (const f of fs.readdirSync(DEPLOY).sort()) {
  const p = path.join(DEPLOY, f)
  if (!fs.statSync(p).isFile()) continue
  const src = fs.readFileSync(p, 'utf8')
  if (/\.js$/.test(f) && jsDirty(src)) jsBad.push(f)
  if (/\.sh$/.test(f) && shDirty(src)) shBad.push(f)
}
ok(jsBad.length === 0, 'C1 deploy/*.js 建 mkdtemp 沙盒的脚本都带 _tmpdir', jsBad.join(', '))
ok(shBad.length === 0, 'C2 deploy/*.sh 裸 mktemp 的脚本都 export TMPDIR', shBad.join(', '))

// D. 红对照：扫描器本身要能抓到脏样本
ok(jsDirty("const fs = require('fs'); const b = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));"), 'D1 裸 mkdtemp 无 _tmpdir 的 js 被判脏')
ok(!jsDirty("require('./_tmpdir'); const b = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));"), 'D2 带 _tmpdir 的 js 判净')
ok(shDirty('TMP=$(mktemp -d) || exit 2\n'), 'D3 裸 mktemp -d 无 export TMPDIR 的 sh 被判脏')
ok(!shDirty('export TMPDIR="$RUN_DIR"\nTMP=$(mktemp -d) || exit 2\n'), 'D4 export TMPDIR 后判净')
ok(!shDirty('T="$(mktemp /tmp/a.XXXXXX)"\n'), 'D5 给了路径模板的 mktemp 判净')

// E. 巡检脚本锚点
ok(/^\s*export TMPDIR="\$RUN_DIR"$/m.test(fs.readFileSync(path.join(DEPLOY, 'patrol.sh'), 'utf8')), 'E1 patrol.sh 巡检草稿落 $RUN_DIR')

console.log('---- ' + pass + ' pass / ' + fail + ' fail ----')
process.exit(fail ? 1 : 0)

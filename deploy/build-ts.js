// deploy/build-ts.js —— task371 TS→JS 构建器（M0#4，决策 C：临时目录转译 → tsc --noEmit → 全绿换入产物）
// 用法：node deploy/build-ts.js [--ui <uiDir>] [--skip-typecheck]（后者仅极端批显式留档用，不常态使用）
// 铁律：改码只许改 .ts，本脚本是产物 .js 的唯一生成者（禁手改 .js；C11 指纹断言新鲜度）。
// 顺序（N4）：①sucrase 转译到 os.tmpdir() 临时目录（不碰 ui/src）→ ②tsc --noEmit 类型检查（读源，只读）
//            → ③全绿后才把产物换入 ui/src/ 同名 .js + 回填契约头（先剥旧头防双头）+ 写 deploy/build-manifest.json。
// 本批无 .ts 时：转译段空跑 EXIT 0（manifest 写空模块清单，保持确定性）。
// 确定性纪律：manifest 禁时间戳；key 排序固定；sucrase/typescript 精确版本入 manifest（R14）。
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { transform: sucraseTransform } = require('sucrase');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const ROOT = path.join(__dirname, '..');
const uiDir = path.resolve(argVal('--ui') || path.join(ROOT, 'ui'));
const SKIP_TYPECHECK = process.argv.indexOf('--skip-typecheck') >= 0;
const TSCONFIG = path.join(uiDir, 'tsconfig.json');
const MANIFEST_OUT = path.join(ROOT, 'deploy', 'build-manifest.json');
const SUCRASE_VERSION = require('sucrase/package.json').version;

function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

/* ---------- 扫描 .ts 源（排除 *.d.ts） ---------- */
function walkTs(dir, out) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkTs(p, out);
    else if (ent.isFile() && /\.ts$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) out.push(p);
  }
  return out;
}

/* ---------- 契约头剥取/回填 ---------- */
function splitHead(src, rel) {
  const m = src.match(/^\/\*[^\n]*?\*\//); // 首行块注释头（单行形态，与 contract.parseHeader 口径一致）
  if (!m) { console.error('[build-ts] ' + rel + ': 首行不是 /* ... */ 契约头，拒绝构建（迁移文件必须原样保留首行头）'); process.exit(1); }
  return { head: m[0], body: src.slice(m[0].length) };
}

function transpile(rel, tsSrc) {
  const { head, body } = splitHead(tsSrc, rel);
  if (/^\s*\/\*\s*@/.test(body)) { console.error('[build-ts] ' + rel + ': 正文首部残留第二个 @ 契约头（防双头检查失败），请修源'); process.exit(1); }
  let out;
  try {
    out = sucraseTransform(body, { transforms: ['typescript'] }).code; // 只剥类型、保留格式（M0#3 冒烟定稿参数）
  } catch (e) {
    console.error('[build-ts] ' + rel + ': sucrase 转译失败——' + e.message); process.exit(1);
  }
  return head + out; // 回填契约头（单一真相 = .ts 源首行）
}

/* ---------- ① 转译到临时目录 ---------- */
const tsFiles = walkTs(path.join(uiDir, 'src'), []).sort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-build-ts-'));
const built = []; // { rel, jsText }
for (const abs of tsFiles) {
  const rel = path.relative(uiDir, abs).replace(/\\/g, '/').replace(/\.ts$/, '.js'); // 对外恒 .js 相对路径（决策 A2-1）
  const tsSrc = fs.readFileSync(abs, 'utf8');
  const jsText = transpile(rel, tsSrc);
  const tmpOut = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(tmpOut), { recursive: true });
  fs.writeFileSync(tmpOut, jsText);
  built.push({ rel: rel, jsText: jsText });
}

/* ---------- ② tsc --noEmit（读 ui/src 源，只读；本环节不污染工作区） ---------- */
if (!SKIP_TYPECHECK) {
  if (!fs.existsSync(TSCONFIG)) { console.error('[build-ts] 缺 ' + TSCONFIG); process.exit(1); }
  const tscJs = path.join(ROOT, 'node_modules', 'typescript', 'lib', 'tsc.js');
  if (!fs.existsSync(tscJs)) { console.error('[build-ts] 缺 typescript（node_modules/typescript/lib/tsc.js），先 npm install'); process.exit(1); }
  const r = spawnSync(process.execPath, [tscJs, '-p', TSCONFIG, '--noEmit'], { encoding: 'utf8' });
  if (r.status !== 0) {
    console.error('[build-ts] ② tsc --noEmit 红灯，在线产物零污染（未换入），报错如下：');
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    cleanupExit(1);
  }
} else {
  console.log('[build-ts] --skip-typecheck 显式跳过类型检查（须在批次回执留档）');
}

/* ---------- ③ 全绿换入产物 + 写 manifest ---------- */
for (const b of built) {
  const dst = path.join(uiDir, b.rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, b.jsText);
}

const manifest = {
  transpiler: 'sucrase@' + SUCRASE_VERSION,
  typecheck: SKIP_TYPECHECK ? 'skipped' : 'tsc@' + require('typescript/package.json').version,
  configSha256: sha256(fs.readFileSync(TSCONFIG, 'utf8')),
  modules: {}
};
const sorted = {};
for (const b of built.slice().sort(function (a, b2) { return a.rel < b2.rel ? -1 : a.rel > b2.rel ? 1 : 0; })) {
  const tsAbs = path.join(uiDir, b.rel.replace(/\.js$/, '.ts'));
  sorted[b.rel] = {
    jsSha256: sha256(b.jsText),
    tsSha256: sha256(fs.readFileSync(tsAbs, 'utf8'))
  };
}
manifest.modules = sorted;
fs.writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2) + '\n');

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('[build-ts] 完成：转译 ' + built.length + ' 个模块' + (built.length ? '' : '（无 .ts，空跑）') + '，manifest → deploy/build-manifest.json');
process.exit(0);

function cleanupExit(code) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(code);
}

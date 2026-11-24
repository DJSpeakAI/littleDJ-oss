// deploy/gen-manifest.js —— 由模块契约生成 ui/MANIFEST.md 的 AUTO 区
// 用法：node deploy/gen-manifest.js [--ui <uiDir>] [--check]
//   （无 --check）重写 AUTO 区，标记外逐字节不动
//   --check     只比对，不过期则 exit 0，过期 exit 1（打印首个差异）
// 纪律（PLAN-contract.md §3.2）：无成对 AUTO 标记 → error 退出；不替人决定人写区。
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('./contract');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const uiDir = argVal('--ui') || path.join(__dirname, '..', 'ui');
const checkOnly = process.argv.indexOf('--check') >= 0;
const mfPath = path.join(uiDir, 'MANIFEST.md');

function build(uiDirIn) {
  const c = C.readContract(uiDirIn);
  const undeclared = C.listUndeclared(uiDirIn);
  return { contract: c, undeclared: undeclared, section: C.renderAutoSection(c, undeclared) };
}

function main() {
  if (!fs.existsSync(mfPath)) {
    console.error('gen-manifest: 找不到 ' + mfPath);
    process.exit(1);
  }
  const md = fs.readFileSync(mfPath, 'utf8');
  const built = build(uiDir);
  if (!built.contract.ok) {
    console.error('gen-manifest: 契约本身有错误，先修头再生成：');
    for (const e of built.contract.errors) console.error('  - ' + e);
    process.exit(1);
  }
  const composed = C.composeManifest(md, built.section);
  if (!composed.ok) { console.error('gen-manifest: ' + composed.error); process.exit(1); }

  if (checkOnly) {
    if (composed.text === md) {
      console.log('gen-manifest --check: OK（AUTO 区与现算结果逐字节一致，指纹 sha1:' + built.contract.hash + '）');
      process.exit(0);
    }
    const a = md.split('\n'), b = composed.text.split('\n');
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    console.error('gen-manifest --check: 过期（AUTO 区与现算结果不一致，首个差异在 MANIFEST 第 ' + (i + 1) + ' 行）');
    console.error('  文件: ' + JSON.stringify((a[i] || '').slice(0, 160)));
    console.error('  应为: ' + JSON.stringify((b[i] || '').slice(0, 160)));
    console.error('  修法: node deploy/gen-manifest.js');
    process.exit(1);
  }

  fs.writeFileSync(mfPath, composed.text, 'utf8');
  console.log('gen-manifest: 已写入 ' + mfPath);
  console.log('  模块 ' + built.contract.modules.length + ' 个 / 未拆声明 ' + built.undeclared.length + ' 项 / 指纹 sha1:' + built.contract.hash);
  if (built.contract.warnings.length) for (const w of built.contract.warnings) console.log('  [warn] ' + w);
  process.exit(0);
}

if (require.main === module) main();
module.exports = { build: build };

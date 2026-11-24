// deploy/dump-contract.js —— 实时契约查询口（给 AI 用，永不过期）
// 用法：node deploy/dump-contract.js [--ui <uiDir>] [--pretty|--md]
//   默认单行 JSON；--pretty 缩进；--md 输出与 MANIFEST AUTO 区同源的 Markdown
// 纪律：每次现解析模块首行，不读 MANIFEST（GLM 评审 §9-5「实时真相」）。
'use strict';
const path = require('path');
const C = require('./contract');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const uiDir = argVal('--ui') || path.join(__dirname, '..', 'ui');

function build(uiDirIn) {
  const c = C.readContract(uiDirIn);
  const undeclared = C.listUndeclared(uiDirIn);
  const htmlOrder = C.htmlScriptOrder(uiDirIn);
  return {
    generatedAt: new Date().toISOString(),
    ok: c.ok,
    hash: c.hash,
    order: c.order,
    modules: c.modules.map(function (m) {
      return {
        file: m.file, module: m.module, order: m.order,
        provides: m.provides, depends: m.depends, runtimeDepends: m.runtimeDepends,
        dom: m.dom, duties: m.duties, source: m.source
      };
    }),
    provides: Array.from(c.provides),
    undeclaredCount: undeclared.length,
    htmlOrderMatches: htmlOrder.join('|') === c.order.join('|'),
    htmlOrder: htmlOrder,
    errors: c.errors,
    warnings: c.warnings,
    section: C.renderAutoSection(c, undeclared)
  };
}

function main() {
  const out = build(uiDir);
  const md = process.argv.indexOf('--md') >= 0;
  const pretty = process.argv.indexOf('--pretty') >= 0;
  if (md) {
    process.stdout.write(out.section + '\n');
  } else {
    const o = Object.assign({}, out);
    delete o.section;
    process.stdout.write(JSON.stringify(o, null, pretty ? 2 : 0) + '\n');
  }
  process.exit(out.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { build: build };

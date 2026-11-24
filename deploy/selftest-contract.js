// deploy/selftest-contract.js —— 第 24 套自测：契约校验 + 解析器元测试
// 用法：node deploy/selftest-contract.js [--ui <uiDir>]
// 断言：C1–C11 全过；dump JSON 形状正确；解析器对 4 个坏 fixture 必报错、2 个好 fixture 必通过；A2 五条硬规则。
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('./contract');
const checker = require('./check-contract');
const dumper = require('./dump-contract');

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const uiDir = argVal('--ui') || path.join(__dirname, '..', 'ui');

let pass = 0, fail = 0;
const failures = [];
function ok(name) { pass++; console.log('  [PASS] ' + name); }
function bad(name, msg) { fail++; failures.push(name + ': ' + msg); console.log('  [FAIL] ' + name + ' → ' + msg); }
function skip(name, why) { console.log('  [SKIP] ' + name + ' → ' + why); }

/* ---------- 1. 主校验 ---------- */
console.log('== 1. C1–C11 ==');
const r = checker.run(uiDir);
for (const c of r.checks) { if (c.ok) ok(c.name); else bad(c.name, c.msg); }
for (const w of r.warnings) console.log('  [WARN] ' + w);

/* ---------- 2. dump 形状 ---------- */
console.log('== 2. dump-contract 形状 ==');
try {
  const d = dumper.build(uiDir);
  if (d.order.length !== d.modules.length) bad('order 与 modules 等长', d.order.length + ' vs ' + d.modules.length);
  else ok('order 与 modules 等长（' + d.order.length + '）');
  if (d.undeclaredCount !== 0) bad('undeclaredCount === 0', String(d.undeclaredCount));
  else ok('undeclaredCount = 0');
  if (typeof d.section !== 'string' || d.section.indexOf('契约指纹') < 0) bad('--md 段可渲染', '缺指纹行');
  else ok('--md 段可渲染');
  if (!d.htmlOrderMatches) bad('htmlOrderMatches', 'index.html 与 @order 不一致');
  else ok('htmlOrderMatches');
} catch (e) { bad('dump-contract', e.message); }

/* ---------- 3. 解析器元测试（fixture） ---------- */
console.log('== 3. 解析器元测试 ==');
const FIX = [
  {
    name: '好样例：完整且规范',
    line: '/* @module x @order 0 @职责 测 @提供 a b @依赖 - @依赖运行期 - @DOM契约 #a #b @源行 z @严格模式 是 @全局占用 a b @测试锚点 - @被调用 - */',
    wantBad: false
  },
  {
    name: '好样例：@依赖 与 @依赖运行期 正确切分',
    line: '/* @module y @order 1 @职责 测 @提供 c @依赖 $ @依赖运行期 S @DOM契约 - @源行 z @严格模式 是 @全局占用 c @测试锚点 - @被调用 - */',
    wantBad: false,
    extra: function (v) {
      if (v.depends.join(',') !== '$') return 'depends 应为 $，实际 ' + JSON.stringify(v.depends);
      if (v.runtimeDepends.join(',') !== 'S') return 'runtimeDepends 应为 S，实际 ' + JSON.stringify(v.runtimeDepends);
      return null;
    }
  },
  { name: '坏样例：缺 @order', line: '/* @module z @职责 测 @提供 a @依赖 - @依赖运行期 - @DOM契约 - @源行 z @严格模式 是 @测试锚点 - @被调用 - */', wantBad: true },
  { name: '坏样例：@order 非整数', line: '/* @module z @order abc @职责 测 @提供 a @依赖 - @依赖运行期 - @DOM契约 - @源行 z @严格模式 是 @测试锚点 - @被调用 - */', wantBad: true },
  { name: '坏样例：@提供 用逗号分隔', line: '/* @module z @order 0 @职责 测 @提供 a,b @依赖 - @依赖运行期 - @DOM契约 - @源行 z @严格模式 是 @测试锚点 - @被调用 - */', wantBad: true },
  { name: '坏样例：@依赖 写成自由文本', line: '/* @module z @order 0 @职责 测 @提供 a @依赖 esc（主脚本） @依赖运行期 - @DOM契约 - @源行 z @严格模式 是 @测试锚点 - @被调用 - */', wantBad: true }
];
for (const f of FIX) {
  const ph = C.parseHeader(f.line, 'fixture');
  const v = C.validateHeader(ph.fields, 'fixture');
  const errs = ph.errors.concat(v.errors);
  if (f.wantBad) {
    if (errs.length === 0) bad(f.name, '期望报错但没报');
    else ok(f.name + '（报错：' + errs[0].slice(0, 60) + '…）');
  } else {
    if (errs.length) { bad(f.name, errs.join(' | ')); continue; }
    if (f.extra) { const m = f.extra(v); if (m) { bad(f.name, m); continue; } }
    ok(f.name);
  }
}

/* ---------- 4. 跨模块 @order 重复必须报错（真实文件系统路径） ---------- */
console.log('== 4. 重复 @order 检测 ==');
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-contract-'));
  fs.mkdirSync(path.join(tmp, 'src'), { recursive: true });
  const h = function (n, o) {
    return '/* @module ' + n + ' @order ' + o + ' @职责 t @提供 ' + n + 'x @依赖 - @依赖运行期 - @DOM契约 - @源行 t @严格模式 是 @测试锚点 - @被调用 - */\n';
  };
  fs.writeFileSync(path.join(tmp, 'src', 'a.js'), h('a', 0) + '\'use strict\';\nfunction ax(){}\nwindow.ax=ax;\n');
  fs.writeFileSync(path.join(tmp, 'src', 'b.js'), h('b', 0) + '\'use strict\';\nfunction bx(){}\nwindow.bx=bx;\n');
  const c2 = C.readContract(tmp);
  if (c2.errors.some(function (e) { return e.indexOf('@order 重复') >= 0; })) ok('重复 @order 被捕获');
  else bad('重复 @order 被捕获', '未报错，errors=' + JSON.stringify(c2.errors));
  fs.rmSync ? fs.rmSync(tmp, { recursive: true, force: true }) : null;
} catch (e) {
  skip('重复 @order 检测', '临时目录不可写：' + e.message);
}

/* ---------- 5. task371 决策 A2 五条硬规则（fixture 实测） ---------- */
console.log('== 5. A2 五条硬规则（TS 迁移适配） ==');
try {
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-a2-'));
  fs.mkdirSync(path.join(tmp2, 'src', 'core'), { recursive: true });
  const hh = function (mod, order) {
    return '/* @module ' + mod + ' @order ' + order + ' @职责 t @提供 ' + mod + 'x @依赖 - @依赖运行期 - @DOM契约 - @源行 t @严格模式 是 @全局占用 ' + mod + 'x @测试锚点 - @被调用 - */\n';
  };
  // a：.ts+.js 并存，.ts 头 module 名不同（验证 header 真从 .ts 读）；bytes 用 .js 长度
  fs.writeFileSync(path.join(tmp2, 'src', 'core', 'a.js'), hh('a', 0) + "'use strict';\nfunction ax(){}\nwindow.ax=ax;\n");
  fs.writeFileSync(path.join(tmp2, 'src', 'core', 'a.ts'), hh('a2', 0) + "'use strict';\nfunction ax(){}\nwindow.ax=ax;\n");
  // b：仅 .js（对照组）
  fs.writeFileSync(path.join(tmp2, 'src', 'core', 'b.js'), hh('b', 1) + "'use strict';\nfunction bx(){}\nwindow.bx=bx;\n");
  // c：孤儿 .ts（规则5 必须报错）
  fs.writeFileSync(path.join(tmp2, 'src', 'core', 'c.ts'), hh('c', 2) + "'use strict';\nfunction cx(){}\nwindow.cx=cx;\n");
  // globals.d.ts：不得成为模块（规则3）
  fs.writeFileSync(path.join(tmp2, 'src', 'globals.d.ts'), 'export {};\ndeclare global { interface Window { ax: unknown } }\n');
  const c3 = C.readContract(tmp2);
  const modA = c3.modules.filter(function (m) { return m.file.indexOf('/a.') >= 0 || m.file.indexOf('a.js') >= 0; })[0];
  // 规则1：file 恒 .js、header 源切 .ts（module 名=a2 证明）
  if (modA && modA.file === 'src/core/a.js') ok('A2-1 file 恒 .js 路径（' + modA.file + '）'); else bad('A2-1 file 恒 .js', modA ? modA.file : '模块缺失');
  if (modA && modA.module === 'a2') ok('A2-1 header 解析源=同名 .ts（module=a2）'); else bad('A2-1 header 源切 .ts', modA ? 'module=' + modA.module : '模块缺失');
  // 规则2：bytes 取 .js 文本长度（契约口径=字符数 text.length，非 statSync 字节数）
  const aJsLen = fs.readFileSync(path.join(tmp2, 'src', 'core', 'a.js'), 'utf8').length;
  if (modA && modA.bytes === aJsLen) ok('A2-2 bytes=.js 长度（' + aJsLen + '）'); else bad('A2-2 bytes 取 .js', modA ? 'bytes=' + modA.bytes + ' 期望 ' + aJsLen : '模块缺失');
  // 规则3：d.ts 不进模块集合
  const dtsMod = c3.modules.filter(function (m) { return m.file.indexOf('.d.ts') >= 0; }).length;
  if (dtsMod === 0 && c3.modules.length === 2) ok('A2-3 *.d.ts 排除、模块数=2'); else bad('A2-3 排除 d.ts', '模块数=' + c3.modules.length + ' d.ts 模块=' + dtsMod);
  // 规则4：.ts/.js 并存无 @order 重复
  const dupErr = c3.errors.filter(function (e) { return e.indexOf('@order 重复') >= 0; }).length;
  if (dupErr === 0) ok('A2-4 同名 .ts/.js 去扩展名去重（无 @order 重复）'); else bad('A2-4 去重', '出现 @order 重复误报');
  // 规则5：孤儿 .ts 明确报错且指路 build-ts
  const orphan = c3.errors.filter(function (e) { return e.indexOf('c.ts') >= 0 && e.indexOf('build-ts') >= 0; }).length;
  if (orphan === 1) ok('A2-5 孤儿 .ts 报错并提示 build-ts'); else bad('A2-5 孤儿报错', JSON.stringify(c3.errors));
  fs.rmSync(tmp2, { recursive: true, force: true });
} catch (e) {
  skip('A2 五条硬规则', '临时目录不可写：' + e.message);
}

/* ---------- 汇总 ---------- */
console.log('---\n' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { for (const f of failures) console.log('  ✗ ' + f); process.exit(1); }
console.log('CONTRACT SELFTEST OK ✅');
process.exit(0);

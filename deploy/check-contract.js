// deploy/check-contract.js —— 契约全量校验（C1–C11，exit 0/1）
// 用法：node deploy/check-contract.js [--ui <uiDir>] [--json]
// 规格：PLAN-contract.md §3.3。check 与 selftest 共用同一实现（避免两套 vm 模拟漂移）。
// task371 C11（构建产物新鲜度）：有 .ts 的模块，其 .js 必须是 build-ts 新鲜产物（指纹比对），
//   抓两类漂移：①手改 .js 产物（jsSha256 不一致）②改了 .ts 没重建（tsSha256 不一致/首行漂移）。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const C = require('./contract');

function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

function argVal(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
const uiDir = argVal('--ui') || path.join(__dirname, '..', 'ui');

/* 最小 DOM stub：四模块求值期零 DOM 触碰，这里只为防御未来模块在加载期摸 DOM */
function domStub() {
  function el() {
    const node = {
      hidden: false, textContent: '', className: '', src: '', alt: '', value: '', style: {},
      dataset: {}, children: [], parentNode: null, disabled: false, checked: false,
      setAttribute: function () { }, removeAttribute: function () { }, getAttribute: function () { return null; },
      addEventListener: function () { }, removeEventListener: function () { },
      appendChild: function (c) { node.children.push(c); return c; }, removeChild: function () { },
      insertBefore: function (c) { return c; }, replaceChildren: function () { },
      querySelector: function () { return el(); }, querySelectorAll: function () { return []; },
      getElementsByClassName: function () { return []; }, getBoundingClientRect: function () { return { top: 0, left: 0, width: 0, height: 0 }; },
      focus: function () { }, blur: function () { }, click: function () { }, remove: function () { },
      classList: { add: function () { }, remove: function () { }, toggle: function () { }, contains: function () { return false; } }
    };
    return node;
  }
  const doc = {
    querySelector: function () { return el(); },
    querySelectorAll: function () { return []; },
    getElementById: function () { return el(); },
    createElement: function () { return el(); },
    createTextNode: function () { return {}; },
    addEventListener: function () { }, removeEventListener: function () { },
    body: el(), documentElement: el(), head: el()
  };
  return doc;
}

function inlineScriptText(uiDirIn) {
  const html = fs.readFileSync(path.join(uiDirIn, 'index.html'), 'utf8');
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out.join('\n;\n');
}

function loadTrace(uiDirIn, contract) {
  const doc = domStub();
  /* C10 哨兵：模块求值期间摸 DOM 即计数（声明期不该有任何 DOM 访问） */
  let domTouches = 0;
  ['querySelector', 'querySelectorAll', 'getElementById', 'createElement', 'createTextNode', 'addEventListener'].forEach(function (m) {
    const orig = doc[m];
    if (typeof orig !== 'function') return;
    doc[m] = function () { domTouches++; return orig.apply(doc, arguments); };
  });
  const ctx = vm.createContext({ document: doc, console: console });
  ctx.window = ctx;
  let prev = new Set(Object.getOwnPropertyNames(ctx));
  const trace = [];
  for (const mod of contract.modules) {
    const src = fs.readFileSync(path.join(uiDirIn, mod.file), 'utf8');
    domTouches = 0;
    vm.runInContext(src, ctx, { filename: mod.file });
    const now = Object.getOwnPropertyNames(ctx);
    const added = now.filter(function (k) { return !prev.has(k); });
    trace.push({ mod: mod, added: added, snapshot: new Set(now), domTouches: domTouches });
    prev = new Set(now);
  }
  return trace;
}

function run(uiDirIn) {
  const checks = [];
  const errors = [];
  const warnings = [];
  function step(name, fn) {
    try { fn(); checks.push({ name: name, ok: true }); }
    catch (e) { checks.push({ name: name, ok: false, msg: e.message }); errors.push('[' + name + '] ' + e.message); }
  }

  const c = C.readContract(uiDirIn);
  for (const w of c.warnings) warnings.push(w);

  // C1 首行格式 / 必需字段 / token 语法 / 跨模块重复声明
  step('C1 契约头格式与必需字段', function () {
    if (c.errors.length) throw new Error(c.errors.join('\n    '));
  });

  // C2 @order 唯一且连续
  step('C2 @order 唯一且连续', function () {
    const orders = c.modules.map(function (m) { return m.order; }).filter(function (o) { return o != null; }).sort(function (a, b) { return a - b; });
    if (orders.length !== c.modules.length) throw new Error('有模块缺 @order');
    for (let i = 0; i < orders.length; i++) {
      if (orders[i] !== i) throw new Error('期望 0..' + (orders.length - 1) + '，实际 ' + orders.join(','));
    }
  });

  // C3 index.html 的 <script src> 顺序 == @order
  step('C3 index.html 加载顺序', function () {
    const html = C.htmlScriptOrder(uiDirIn);
    const want = c.order;
    if (html.join('|') !== want.join('|')) {
      throw new Error('index.html 与 @order 不一致\n    html : ' + JSON.stringify(html) + '\n    @order: ' + JSON.stringify(want));
    }
  });

  // C4 MANIFEST AUTO 标记
  let manifestMd = null;
  step('C4 MANIFEST AUTO 标记', function () {
    const p = path.join(uiDirIn, 'MANIFEST.md');
    if (!fs.existsSync(p)) throw new Error('找不到 ui/MANIFEST.md');
    manifestMd = fs.readFileSync(p, 'utf8');
    const sp = C.splitManifest(manifestMd);
    if (!sp.ok) throw new Error(sp.error);
  });

  // C5/C6/C7 共用一次 vm 装载（逐模块 diff，报错可归因）
  let trace = null;
  step('C5 @提供 的符号真实挂上 window', function () {
    if (!c.ok) throw new Error('契约头有错误，跳过运行时校验（先修 C1）');
    trace = loadTrace(uiDirIn, c);
    const missing = [];
    for (const t of trace) {
      for (const s of t.mod.provides) if (!t.snapshot.has(s)) missing.push(t.mod.file + ' 声称提供 ' + s + '，实际 window 上不存在');
    }
    if (missing.length) throw new Error(missing.join('\n    '));
  });

  step('C6 不得偷挂未声明的 window 符号', function () {
    if (!trace) throw new Error('C5 未通过，无法校验（依赖同一次装载）');
    const bad = [];
    for (const t of trace) {
      const declared = new Set(t.mod.provides);
      for (const s of t.added) if (!declared.has(s)) bad.push(t.mod.file + ' 新增了未声明符号 ' + s);
    }
    if (bad.length) throw new Error(bad.join('\n    '));
  });

  step('C7 加载期依赖已就绪', function () {
    if (!trace) throw new Error('C5 未通过，无法校验（依赖同一次装载）');
    const bad = [];
    for (const t of trace) {
      for (const d of t.mod.depends) if (!t.snapshot.has(d)) bad.push(t.mod.file + ' 依赖 ' + d + '，求值时 window 上还没有');
    }
    if (bad.length) throw new Error(bad.join('\n    '));
  });

  // C10 模块加载期零副作用（对齐 DJH check-plugins P4：顶层禁止 DOM 副作用）
  step('C10 模块加载期零副作用', function () {
    if (!trace) throw new Error('C5 未通过，无法校验（依赖同一次装载）');
    const bad = [];
    for (const t of trace) {
      if (t.domTouches > 0) bad.push(t.mod.file + ' 加载期摸了 DOM ' + t.domTouches + ' 次（顶层副作用 → 应搬进 index.html 内联 bootstrap）');
    }
    if (bad.length) throw new Error(bad.join('\n    '));
  });

  // C8 运行期依赖在任一模块 @提供 里可寻（warning）
  step('C8 运行期依赖静态可寻', function () {
    if (!c.ok) throw new Error('契约头有错误，跳过');
    const missing = [];
    for (const m of c.modules) {
      for (const d of m.runtimeDepends) {
        if (!c.provides.has(d)) missing.push(m.file + ' 的运行期依赖 ' + d + ' 不在任何模块 @提供（可能拼错）');
      }
    }
    if (missing.length) { for (const x of missing) warnings.push(x); }
  });

  // C9 MANIFEST AUTO 区 == 现算结果（逐字节，P1-4）
  step('C9 MANIFEST 不过期', function () {
    if (!manifestMd) throw new Error('C4 未通过，无法校验');
    const sp = C.splitManifest(manifestMd);
    if (!sp.ok) throw new Error(sp.error);
    const section = C.renderAutoSection(c, C.listUndeclared(uiDirIn));
    if (sp.body.trim() !== section.trim()) throw new Error('AUTO 区与现算结果不一致（文档过期）→ 修法：node deploy/gen-manifest.js');
  });

  // C11 构建产物新鲜度（task371：改码只许改 .ts，.js 只能由 build-ts.js 生成）
  step('C11 构建产物新鲜度', function () {
    const manifestPath = path.join(__dirname, 'build-manifest.json');
    const tsFiles = C.walkTs(path.join(uiDirIn, 'src'));
    if (!fs.existsSync(manifestPath)) {
      if (tsFiles.length) throw new Error('存在 .ts 源但缺 deploy/build-manifest.json（先跑 node deploy/build-ts.js）');
      return; // 无 .ts 无 manifest = 未迁移态，天然通过
    }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { throw new Error('deploy/build-manifest.json 不是合法 JSON（先跑 node deploy/build-ts.js）'); }
    if (!manifest.modules || typeof manifest.modules !== 'object') throw new Error('deploy/build-manifest.json 缺 modules 段（先跑 node deploy/build-ts.js）');
    const errs = [];
    const seen = new Set();
    for (const mod of c.modules) {
      const tsAbs = path.join(uiDirIn, mod.file.replace(/\.js$/, '.ts'));
      if (!fs.existsSync(tsAbs)) continue; // 未迁移模块不查
      seen.add(mod.file);
      const entry = manifest.modules[mod.file];
      if (!entry) { errs.push(mod.file + '：有 .ts 但 build-manifest.json 无此模块记录（先跑 node deploy/build-ts.js）'); continue; }
      const jsText = fs.readFileSync(path.join(uiDirIn, mod.file), 'utf8');
      const tsText = fs.readFileSync(tsAbs, 'utf8');
      if (sha256(jsText) !== entry.jsSha256) errs.push(mod.file + '：.js 与 manifest jsSha256 不一致（禁手改 .js 产物——请改 .ts 后跑 node deploy/build-ts.js）');
      if (sha256(tsText) !== entry.tsSha256) errs.push(mod.file + '：.ts 与 manifest tsSha256 不一致（改了 .ts 没重建——跑 node deploy/build-ts.js）');
      if (tsText.split('\n', 1)[0] !== jsText.split('\n', 1)[0]) errs.push(mod.file + '：.ts 首行与 .js 首行不一致（契约头漂移——跑 node deploy/build-ts.js）');
    }
    for (const key of Object.keys(manifest.modules)) {
      if (!seen.has(key)) errs.push(key + '：manifest 记录存在但 ui/src 已无对应 .ts（重跑 node deploy/build-ts.js 刷新清单）');
    }
    if (errs.length) throw new Error(errs.join('\n    '));
  });

  return { checks: checks, errors: errors, warnings: warnings, ok: errors.length === 0, hash: c.hash };
}

function main() {
  const r = run(uiDir);
  if (process.argv.indexOf('--json') >= 0) {
    process.stdout.write(JSON.stringify({ ok: r.ok, hash: r.hash, checks: r.checks, errors: r.errors, warnings: r.warnings }, null, 2) + '\n');
  } else {
    for (const k of r.checks) console.log((k.ok ? '[PASS] ' : '[FAIL] ') + k.name + (k.ok ? '' : '\n       ' + k.msg.split('\n').join('\n       ')));
    for (const w of r.warnings) console.log('[WARN] ' + w);
    console.log('---\n' + r.checks.filter(function (x) { return x.ok; }).length + '/' + r.checks.length + ' 通过' + (r.ok ? ' ✅' : ' ❌'));
  }
  process.exit(r.ok ? 0 : 1);
}

if (require.main === module) main();
module.exports = { run: run, loadTrace: loadTrace, domStub: domStub };

// deploy/contract.js —— 模块契约的解析器 + 渲染器（唯一读模块首行的地方）
// P1.5 契约自动化：单一真相 = ui/src/**/*.js 的首行声明头。
// task371 决策 A2（TS 迁移适配，五条硬规则）：
//   1. 对外 file/order 恒 .js 相对路径（浏览器实际加载物）；仅 header 解析源在存在同名 .ts 时切到 .ts。
//   2. bytes 恒取 .js 文本长度（指纹语义 = 线上产物）。
//   3. 扫描域排除 *.d.ts（globals.d.ts 不得成为第 52 个「模块」）。
//   4. 模块集合 = .js 文件集合（同名 .ts/.js 天然按去扩展名去重，防 @order 重复）。
//   5. 存在 .ts 但无同名 .js → 明确报错（提示先跑 node deploy/build-ts.js），不静默回落。
// 规格：PLAN-contract.md v2（§3.1）。零依赖、CommonJS、Node ≥12。
// 纪律：本模块不持有任何绝对路径、不在模块级求值 uiDir（P1-2）。
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ALL_KEYS = ['module', 'order', '职责', '提供', '依赖', '依赖运行期', 'DOM契约', '源行', '严格模式', '全局占用', '测试锚点', '被调用'];
const MACHINE_KEYS = ['module', 'order', '提供', '依赖', '依赖运行期', 'DOM契约'];
// 键序：依赖运行期 必须在 依赖 之前（否则被前缀吞掉）
const FIELD_KEYS = ['module', 'order', '职责', '提供', '依赖运行期', '依赖', 'DOM契约', '源行', '严格模式', '全局占用', '测试锚点', '被调用'];
const FIELD_RE = new RegExp('@(' + FIELD_KEYS.join('|') + ')\\s', 'g');

const SYM_TOKEN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const DOM_TOKEN = /^#[A-Za-z][A-Za-z0-9_-]*$/;
const MODULE_NAME = /^[a-z][a-z0-9-]*$/;

/* ---------------- 首行解析 ---------------- */

function parseHeader(line, rel) {
  const errors = [];
  const fields = {};
  const src = String(line || '');
  if (!/^\s*\/\*/.test(src)) {
    errors.push(rel + ': 首行不是 /* ... */ 注释（契约头缺失）');
    return { fields: fields, errors: errors };
  }
  let body = src.replace(/^\s*\/\*/, '').replace(/\*\/\s*$/, ''); // P3-4：切掉尾部 */
  FIELD_RE.lastIndex = 0;
  const marks = [];
  let m;
  while ((m = FIELD_RE.exec(body))) {
    marks.push({ key: m[1], start: m.index, valStart: FIELD_RE.lastIndex });
  }
  if (!marks.length) {
    errors.push(rel + ': 首行注释里没有任何 @字段');
    return { fields: fields, errors: errors };
  }
  for (let i = 0; i < marks.length; i++) {
    const stop = i + 1 < marks.length ? marks[i + 1].start : body.length;
    fields[marks[i].key] = body.slice(marks[i].valStart, stop).trim();
  }
  return { fields: fields, errors: errors };
}

/* ---------------- token 校验 ---------------- */

function tokenList(value, rel, key, errors) {
  const v = String(value == null ? '' : value).trim();
  if (v === '' || v === '-' || v === '无') return [];
  const toks = v.split(/\s+/);
  const out = [];
  for (const t of toks) {
    const bare = t.replace(/^window\./, '');
    if (key === 'DOM契约') {
      if (!DOM_TOKEN.test(bare)) { errors.push(rel + ': @' + key + ' 非法 token「' + t + '」（应为 #id）'); continue; }
      out.push(bare);
    } else {
      if (!SYM_TOKEN.test(bare)) {
        errors.push(rel + ': @' + key + ' 非法 token「' + t + '」（机器字段只能是裸符号，空格分隔；人读说明请移到 @被调用）');
        continue;
      }
      out.push(bare);
    }
  }
  return out;
}

function validateHeader(fields, rel) {
  const errors = [];
  for (const k of MACHINE_KEYS) {
    if (!(k in fields) || String(fields[k]).trim() === '') errors.push(rel + ': 缺必需字段 @' + k);
  }
  if (fields.module && !MODULE_NAME.test(fields.module)) errors.push(rel + ': @module 非法「' + fields.module + '」（应为 [a-z][a-z0-9-]*）');
  let order = null;
  if (fields.order != null) {
    if (!/^\d+$/.test(String(fields.order).trim())) errors.push(rel + ': @order 不是非负整数「' + fields.order + '」');
    else order = parseInt(fields.order, 10);
  }
  const provides = tokenList(fields['提供'], rel, '提供', errors);
  const depends = tokenList(fields['依赖'], rel, '依赖', errors);
  const runtimeDepends = tokenList(fields['依赖运行期'], rel, '依赖运行期', errors);
  const dom = tokenList(fields['DOM契约'], rel, 'DOM契约', errors);
  const warnings = [];
  if (fields['全局占用'] && provides.length) {
    const occ = String(fields['全局占用']).trim() === '-' ? [] : String(fields['全局占用']).trim().split(/\s+/).map(function (s) { return s.replace(/^window\./, ''); });
    const a = occ.slice().sort().join(',');
    const b = provides.slice().sort().join(',');
    if (a !== b) warnings.push(rel + ': @全局占用（' + a + '）与 @提供（' + b + '）不一致');
  }
  return {
    order: order, provides: provides, depends: depends,
    runtimeDepends: runtimeDepends, dom: dom, errors: errors, warnings: warnings
  };
}

/* ---------------- 目录扫描 ---------------- */

function walkJs(dir, base) {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push.apply(out, walkJs(p, base));
    else if (ent.isFile() && /\.js$/.test(ent.name)) out.push(p);
  }
  return out;
}

// task371 A2-3/A2-5：扫 .ts 源（排除 *.d.ts），供 header 源切换与孤儿检测
function walkTs(dir) {
  const out = [];
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push.apply(out, walkTs(p));
    else if (ent.isFile() && /\.ts$/.test(ent.name) && !/\.d\.ts$/.test(ent.name)) out.push(p);
  }
  return out;
}

function relOf(uiDir, abs) {
  return path.relative(uiDir, abs).replace(/\\/g, '/');
}

function moduleFiles(uiDir) {
  return walkJs(path.join(uiDir, 'src'), uiDir).sort();
}

/* ---------------- 读契约 ---------------- */

function readContract(uiDir) {
  const errors = [];
  const warnings = [];
  const modules = [];
  const jsFiles = moduleFiles(uiDir);
  const jsStems = new Set(jsFiles.map(function (abs) { return abs.replace(/\.js$/, ''); }));
  for (const abs of jsFiles) {
    const rel = relOf(uiDir, abs);
    let text = '';
    try { text = fs.readFileSync(abs, 'utf8'); } catch (e) { errors.push(rel + ': 读取失败 ' + e.message); continue; }
    // A2-1/A2-2：bytes 恒取 .js（线上产物指纹）；header 解析源在存在同名 .ts 时切到 .ts（单一真相=TS 源首行）
    const tsAbs = abs.replace(/\.js$/, '.ts');
    let firstLine = text.split('\n', 1)[0];
    if (fs.existsSync(tsAbs)) {
      try { firstLine = fs.readFileSync(tsAbs, 'utf8').split('\n', 1)[0]; }
      catch (e) { errors.push(rel + ': 读取同名 .ts 失败 ' + e.message); }
    }
    const ph = parseHeader(firstLine, rel);
    for (const e of ph.errors) if (errors.indexOf(e) < 0) errors.push(e);
    const v = validateHeader(ph.fields, rel);
    for (const e of v.errors) errors.push(e);
    for (const w of v.warnings) warnings.push(w);
    modules.push({
      file: rel,
      abs: abs,
      module: ph.fields.module || null,
      order: v.order,
      provides: v.provides,
      depends: v.depends,
      runtimeDepends: v.runtimeDepends,
      dom: v.dom,
      duties: ph.fields['职责'] || '',
      source: ph.fields['源行'] || '',
      calls: ph.fields['被调用'] || '',
      anchor: ph.fields['测试锚点'] || '',
      header: firstLine,
      bytes: text.length
    });
  }
  // task371 A2-5：存在 .ts 但无同名 .js → 明确报错（不静默回落）
  for (const tsAbs of walkTs(path.join(uiDir, 'src')).sort()) {
    const stem = tsAbs.replace(/\.ts$/, '');
    if (!jsStems.has(stem)) {
      errors.push(relOf(uiDir, stem + '.ts') + ': 存在 .ts 但无同名 .js（先跑 node deploy/build-ts.js 生成产物）');
    }
  }
  // order 唯一且连续
  const seen = {};
  for (const mod of modules) {
    if (mod.order == null) continue;
    if (seen[mod.order]) errors.push('@order 重复：' + seen[mod.order] + ' 与 ' + mod.file + ' 都声明 ' + mod.order);
    seen[mod.order] = mod.file;
  }
  const orders = modules.map(function (m) { return m.order; }).filter(function (o) { return o != null; }).sort(function (a, b) { return a - b; });
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i) { errors.push('@order 不连续：期望 0..' + (orders.length - 1) + '，实际 ' + orders.join(',')); break; }
  }
  // 跨模块 @提供 重复
  const owner = {};
  for (const mod of modules) {
    for (const s of mod.provides) {
      if (owner[s]) errors.push('符号「' + s + '」被重复声明：' + owner[s] + ' 与 ' + mod.file);
      else owner[s] = mod.file;
    }
  }
  modules.sort(function (a, b) { return (a.order == null ? 1e9 : a.order) - (b.order == null ? 1e9 : b.order); });
  const providesSet = new Set();
  for (const mod of modules) for (const s of mod.provides) providesSet.add(s);
  const hash = crypto.createHash('sha1')
    .update(modules.map(function (m) { return m.file + '\n' + m.header + '\n' + m.bytes; }).join('\n---\n'), 'utf8')
    .digest('hex');
  return {
    modules: modules,
    order: modules.map(function (m) { return m.file; }),
    provides: providesSet,
    hash: hash,
    errors: errors,
    warnings: warnings,
    ok: errors.length === 0
  };
}

function loadOrder(uiDir) { return readContract(uiDir).order; }

function concatModules(uiDir) {
  const c = readContract(uiDir);
  return c.order.map(function (rel) { return fs.readFileSync(path.join(uiDir, rel), 'utf8'); }).join('\n;\n');
}

/* ---------------- index.html 解析 ---------------- */

function htmlScriptOrder(uiDir) {
  const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
  const re = /<script[^>]*\ssrc="([^"]+)"[^>]*>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1].replace(/\?.*$/, '').replace(/^\//, ''));
  return out;
}

// task371 M0#9（L-063 禁写死版本号的正解）：解析 index.html 各 <script src="/src/…?v=pN"> 的当前缓存参数。
// 返回 { 'src/app/plugins.js': 'p6', … }（key 与 htmlScriptOrder 同口径：去头斜杠、不含 query）。
// 供 selftest 断言「模块标签在列且带 ?v=pN」——版本号以 index.html 当前值为准，升 v 不再连带改测试。
function htmlScriptVersionMap(uiDir) {
  const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
  const re = /<script[^>]*\ssrc="(\/src\/[^"?]+)\?v=(p\d+)"/g;
  const out = {};
  let m;
  while ((m = re.exec(html))) out[m[1].replace(/^\//, '')] = m[2];
  return out;
}

// 内联脚本里的顶层声明（行号 = index.html 快照行号）
function listUndeclared(uiDir) {
  const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
  const lines = html.split('\n');
  const out = [];
  let inScript = false;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!inScript && /<script(?![^>]*\bsrc=)[^>]*>/.test(L)) { inScript = true; continue; }
    if (inScript && /<\/script>/.test(L)) { inScript = false; continue; }
    if (!inScript) continue;
    const m = L.match(/^(async\s+function\*?|function\*?|var|const|let)\s+([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (m) out.push({ name: m[2], line: i + 1, kind: m[1].replace(/\s+/g, ' ') });
  }
  return out;
}

/* ---------------- 渲染（gen 与 dump --md 共用，P3-9） ---------------- */

function renderAutoSection(contract, undeclared) {
  const out = [];
  out.push('> 契约指纹：sha1:' + contract.hash + '（自动生成，勿手改）');
  out.push('');
  out.push('## 1. 模块契约（由模块首行声明头生成）');
  out.push('');
  out.push('| # | 文件 | 模块 | 职责 | 提供 | 依赖（加载期） | 依赖（运行期） | DOM契约 | 源行 | 被调用 |');
  out.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const m of contract.modules) {
    out.push('| ' + m.order + ' | `' + m.file + '` | ' + m.module + ' | ' + m.duties + ' | ' +
      (m.provides.join(' ') || '-') + ' | ' + (m.depends.join(' ') || '-') + ' | ' +
      (m.runtimeDepends.join(' ') || '-') + ' | ' + (m.dom.join(' ') || '-') + ' | ' + m.source + ' | ' + m.calls + ' |');
  }
  out.push('');
  out.push('## 2. 加载顺序（唯一真相 = 各模块 `@order`；index.html 的 `<script src>` 由 check-contract C3 校验）');
  out.push('');
  out.push('| 序 | 资源 | 依赖前提 |');
  out.push('|---|---|---|');
  for (const m of contract.modules) {
    out.push('| ' + m.order + ' | `/' + m.file + '` | ' + (m.depends.join(' ') || '无') + ' |');
  }
  out.push('| 末尾 | 主脚本（index.html 内联 IIFE） | 以上全部 |');
  out.push('');
  out.push('## 3. window 符号总表（按 @order 归集）');
  out.push('');
  out.push('| 序 | 符号 | 来源模块 |');
  out.push('|---|---|---|');
  for (const m of contract.modules) for (const s of m.provides) out.push('| ' + m.order + ' | `' + s + '` | `' + m.file + '` |');
  out.push('');
  out.push('## 4. 未拆清单（仍在内联主脚本里的顶层声明，共 ' + undeclared.length + ' 项）');
  out.push('');
  out.push('> 行号 = index.html 快照行号，每次生成重算；P2 扩拆时从此清单选材。');
  out.push('');
  for (const u of undeclared) out.push('L' + u.line + ' ' + u.name);
  return out.join('\n');
}

/* ---------------- MANIFEST AUTO 区（gen 与 check 共用） ---------------- */

const AUTO_START = '<!-- AUTO:START -->';
const AUTO_END = '<!-- AUTO:END -->';

function splitManifest(md) {
  const i = md.indexOf(AUTO_START);
  const j = md.indexOf(AUTO_END);
  if (i < 0 || j < 0 || j < i) {
    return { ok: false, error: 'ui/MANIFEST.md 缺少成对的 ' + AUTO_START + ' / ' + AUTO_END + ' 标记（P1-5：请先建骨架，gen 不替你决定人写区）' };
  }
  return {
    ok: true,
    before: md.slice(0, i + AUTO_START.length),
    body: md.slice(i + AUTO_START.length, j),
    after: md.slice(j)
  };
}

function composeManifest(md, section) {
  const sp = splitManifest(md);
  if (!sp.ok) return sp;
  return { ok: true, text: sp.before + '\n' + section + '\n' + sp.after };
}

module.exports = {
  ALL_KEYS: ALL_KEYS,
  MACHINE_KEYS: MACHINE_KEYS,
  AUTO_START: AUTO_START,
  AUTO_END: AUTO_END,
  parseHeader: parseHeader,
  validateHeader: validateHeader,
  readContract: readContract,
  loadOrder: loadOrder,
  concatModules: concatModules,
  htmlScriptOrder: htmlScriptOrder,
  htmlScriptVersionMap: htmlScriptVersionMap,
  listUndeclared: listUndeclared,
  renderAutoSection: renderAutoSection,
  splitManifest: splitManifest,
  composeManifest: composeManifest,
  moduleFiles: moduleFiles,
  walkTs: walkTs
};

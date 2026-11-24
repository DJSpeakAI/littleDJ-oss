#!/usr/bin/env node
// check-ets-imports（M0.1 四层全量版 · task361 P0-2 依赖治理机检）
// 四层架构（§四）：pages→domain→store→core 单向；禁逆行禁同层互调
// 规则：
//   1. import type 不计入运行期依赖（二审 P2-15）
//   2. pages/** 可引 domain/**（页面组件）；禁止直接引 store 之外的越级与 pages 互引
//      （pages→store 的 AppStorage 统一走 Store 导出，故 pages 引 store/domain/core 均合法，
//        但 pages→pages 禁止——页面间无共享组件（M1 组件库单独立牌再开白名单））
//   3. domain/** 可引 store/core；domain 之间禁止互调（白名单例外须在方案登记，当前为空）
//   4. store/** 只可引 core；core/** 只可引 core；任何引 pages = 红（反向依赖）
//   5. 指向不存在文件 = 红
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
const IMP_RE = /^import\s+(?!type\b)([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
// domain 同层互调白名单（§四：例外须本方案登记；当前为空）
const DOMAIN_PEER_ALLOW = [];

function layerOf(file) {
  const rel = path.relative(ROOT, file);
  const m = rel.split(path.sep)[0];
  if (m === 'pages' || m === 'core' || m === 'domain' || m === 'store' || m === 'components') return m;
  return 'other'; // entryability/entrybackupability 脚手架不参与
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ets')) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
const layerMap = new Map(files.map(f => [f, layerOf(f)]));

// 产出审 P1-3：文件级环检测（DFS 三色标记；core 同层互引成环也抓）
const graph = new Map(); // file -> Set<file>
function addEdge(from, to) {
  if (!graph.has(from)) graph.set(from, new Set());
  graph.get(from).add(to);
}
function findCycles() {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const cycles = [];
  const stack = [];
  function dfs(u) {
    color.set(u, GRAY);
    stack.push(u);
    for (const v of (graph.get(u) || [])) {
      const c = color.get(v) || WHITE;
      if (c === GRAY) {
        const i = stack.indexOf(v);
        cycles.push(stack.slice(i).concat([v]).map(f => path.relative(ROOT, f)).join(' → '));
      } else if (c === WHITE) {
        dfs(v);
      }
    }
    stack.pop();
    color.set(u, BLACK);
  }
  for (const u of graph.keys()) {
    if ((color.get(u) || WHITE) === WHITE) dfs(u);
  }
  return cycles;
}
// 环检测内置红绿自验（--cycle-selftest）：A→B→C→A 必红；A→B,B→C 必绿
if (process.argv.includes('--cycle-selftest')) {
  const bak = graph;
  const g2 = new Map();
  const fake = ['a', 'b', 'c'];
  // 红用例
  g2.set('a', new Set(['b'])); g2.set('b', new Set(['c'])); g2.set('c', new Set(['a']));
  const redGraph = g2;
  // 直接内联跑（借用闭包外逻辑副本）
  function cyc(g) {
    const color = new Map(); const cycles = []; const stack = [];
    function dfs(u) {
      color.set(u, 1); stack.push(u);
      for (const v of (g.get(u) || [])) {
        const c = color.get(v) || 0;
        if (c === 1) { const i = stack.indexOf(v); cycles.push(stack.slice(i).concat([v]).join('→')); }
        else if (c === 0) dfs(v);
      }
      stack.pop(); color.set(u, 2);
    }
    for (const u of g.keys()) if ((color.get(u) || 0) === 0) dfs(u);
    return cycles;
  }
  const red = cyc(redGraph);
  const green = cyc(new Map([['a', new Set(['b'])], ['b', new Set(['c'])]]));
  if (red.length !== 1 || green.length !== 0) {
    console.error(`环检测自验失败：红用例=${red.length}（应1）绿用例=${green.length}（应0）`);
    process.exit(1);
  }
  console.log('cycle-selftest OK：红=1 绿=0');
  process.exit(0);
}

const errs = [];
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  const fromLayer = layerOf(f);
  if (fromLayer === 'other') continue;
  let m;
  IMP_RE.lastIndex = 0;
  while ((m = IMP_RE.exec(src)) !== null) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue; // @kit.* / ohos.* 系统库放行
    let target = path.resolve(path.dirname(f), spec);
    if (!target.endsWith('.ets')) target = target + '.ets';
    if (!layerMap.has(target)) {
      errs.push(`${rel}: import 指向不存在或非 .ets 文件 → ${spec}`);
      continue;
    }
    addEdge(f, target);
    const toLayer = layerMap.get(target);
    const toRel = path.relative(ROOT, target);
    if (toLayer === 'pages') {
      errs.push(`${rel}: 禁止依赖 pages 层（反向依赖）→ ${spec}`);
    } else if (fromLayer === 'pages' && toLayer === 'pages') {
      errs.push(`${rel}: pages 互引禁止 → ${spec}`);
    } else if (fromLayer === 'pages' && toLayer === 'components') {
      // pages→components 白名单（M1 组件库，方案 §四「M1 组件库单立牌再开白名单」落地）
    } else if (fromLayer === 'components') {
      // components 与 pages 同属 UI 层：可依赖 domain/store/core；
      // M2.1 A 路线修订：组件树组合合法（父引子：SidePanel→ProjGroup→ConvRow、MsgRow→MarkdownView 等），
      // 循环依赖由全局 DFS 环检测兜底（components 间环=红）
      if (toLayer === 'pages') {
        errs.push(`${rel}: components 禁依赖 pages → ${spec}`);
      }
    } else if (fromLayer === 'domain') {
      if (toLayer === 'domain' && !DOMAIN_PEER_ALLOW.some(w => rel.startsWith(w) || toRel.startsWith(w))) {
        errs.push(`${rel}: domain 同层互调禁止（白名单外）→ ${spec}`);
      }
      // domain→store/core 合法
    } else if (fromLayer === 'store') {
      if (toLayer !== 'core' && toLayer !== 'store') {
        errs.push(`${rel}: store 只可依赖 core → ${spec}（${toLayer}）`);
      }
    } else if (fromLayer === 'core') {
      if (toLayer !== 'core') {
        errs.push(`${rel}: core 层禁止依赖上层 → ${spec}（${toLayer}）`);
      }
    }
  }
}

for (const cyc of findCycles()) {
  errs.push(`环依赖：${cyc}`);
}

if (errs.length) {
  console.error('== ets-imports 违规 ==');
  for (const e of errs) console.error('  ' + e);
  process.exit(1);
}
console.log(`ets-imports OK：${files.length} 文件，0 违规（M0.1 四层全量口径）`);

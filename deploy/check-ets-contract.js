#!/usr/bin/env node
// check-ets-contract（M0.1 · task361 P2-5 契约机检）
// 规则：各 .ets 模块首行/次行须有「@提供/@依赖」契约注释（沿用 ui/src 契约注释习惯）；
// 与实际 import/export 对账：@依赖 声明的本地模块必须真被 import；漏声明/多声明=红。
// 页面/脚手架豁免：entryability（模板）；pages 允许只有 @提供 无 @依赖。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
const CONTRACT_RE = /@提供\s+(\S+)[^\n]*@依赖\s+([^\n]*)/;
const DEP_RE = /@依赖\s+(.+)/;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ets')) out.push(p);
  }
  return out;
}

const files = walk(ROOT, []);
const errs = [];
for (const f of files) {
  const rel = path.relative(ROOT, f);
  if (rel.startsWith('entryability') || rel.startsWith('entrybackupability')) continue;
  const src = fs.readFileSync(f, 'utf8');
  const head = src.split('\n').slice(0, 6).join('\n');
  const m = head.match(CONTRACT_RE);
  if (!m) {
    errs.push(`${rel}: 首部缺 @提供/@依赖 契约注释`);
    continue;
  }
  const deps = (m[2] || '').split(/[\s,]+/).filter(x => x && x !== '-' && !x.includes('（') && !x.startsWith('core/events'));
  // 汇总真实 import 的本地模块名
  const impRe = /^import\s+(?!type\b)[\s\S]*?from\s+['"](\.[^'"]+)['"]/gm;
  let im = null;
  const importedBases = new Set();
  while ((im = impRe.exec(src)) !== null) {
    const base = path.basename(im[1]).replace(/\.ets$/, '');
    importedBases.add(base);
  }
  for (const d of deps) {
    const short = d.split('/').pop();
    if (short && !importedBases.has(short)) {
      errs.push(`${rel}: @依赖 声明了 ${d} 但未 import`);
    }
  }
  // 产出审 P1-3：反向对账——import 了本地模块但 @依赖 未声明（系统库豁免；core/events 前置声明常被压缩，豁免）
  for (const base of importedBases) {
    if (base === 'events') continue;
    const declared = deps.some(d => d.split('/').pop() === base);
    if (!declared) {
      errs.push(`${rel}: import 了 ${base} 但 @依赖 未声明`);
    }
  }
}

if (errs.length) {
  console.error('== ets-contract 违规 ==');
  for (const e of errs) console.error('  ' + e);
  process.exit(1);
}
console.log(`ets-contract OK：${files.length} 文件契约对账通过`);

#!/usr/bin/env node
// selftest-m1-parser（M1 行为断言 · task361 产出审 P1-8）
// 方案：parser 不可直接 require（ArkTS 语法），用「node 参照实现（与源码逐段结构同构，B 组锚逐条锁定）
// + PWA 黄金值」跑真行为断言；ChatService 的 edLines/statsFromPatch 同法；附红对照。
// ⚠S：参照实现与源码的结构锚（B 组）是「同构性」的唯一保证——改 parser/ChatService 对应段必跑本套件。
'use strict';
const fs = require('fs');
const path = require('path');

const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

// ---------- 参照实现（与 entry 源码同构；黄金值来自 PWA 行为） ----------
function refParseInline(s) {
  const out = [];
  let rest = s;
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
  while (rest !== '') {
    const m = rest.match(re);
    if (m === null || m.index === undefined) { out.push({ kind: 'plain', text: rest, url: '' }); break; }
    if (m.index > 0) out.push({ kind: 'plain', text: rest.slice(0, m.index), url: '' });
    if (m[1] !== undefined) out.push({ kind: 'code', text: m[1], url: '' });
    else if (m[2] !== undefined) out.push({ kind: 'bold', text: m[2], url: '' });
    else if (m[3] !== undefined && m[4] !== undefined) out.push({ kind: 'link', text: m[3], url: m[4] });
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}
function refParseBlocks(seg, tokens) {
  const lines = seg.split('\n');
  let para = null, list = null;
  const closeList = () => { list = null; };
  for (const raw of lines) {
    if (raw.trim() === '') { para = null; closeList(); continue; }
    let m;
    if ((m = raw.match(/^###\s+/))) { para = null; closeList(); const t2 = { kind: 'heading', level: 3, spans: refParseInline(raw.slice(4)) }; tokens.push(t2); continue; }
    if ((m = raw.match(/^##\s+/))) { para = null; closeList(); tokens.push({ kind: 'heading', level: 2, spans: refParseInline(raw.slice(3)) }); continue; }
    if ((m = raw.match(/^#\s+/))) { para = null; closeList(); tokens.push({ kind: 'heading', level: 1, spans: refParseInline(raw.slice(2)) }); continue; }
    if ((m = raw.match(/^\s*[-*+]\s+/))) {
      para = null;
      if (list === null || list.ordered) { closeList(); list = { kind: 'list', ordered: false, items: [] }; tokens.push(list); }
      list.items.push(refParseInline(raw.replace(/^\s*[-*+]\s+/, ''))); continue;
    }
    if ((m = raw.match(/^\s*\d+\.\s+/))) {
      para = null;
      if (list === null || !list.ordered) { closeList(); list = { kind: 'list', ordered: true, items: [] }; tokens.push(list); }
      list.items.push(refParseInline(raw.replace(/^\s*\d+\.\s+/, ''))); continue;
    }
    if ((m = raw.match(/^\s*>\s?/))) { para = null; closeList(); tokens.push({ kind: 'quote', spans: refParseInline(raw.replace(/^\s*>\s?/, '')) }); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) { para = null; closeList(); tokens.push({ kind: 'hr' }); continue; }
    if (list !== null) closeList(); // ← P1-2 修复位：段落打断列表
    if (para === null) { para = { kind: 'para', lines: [] }; tokens.push(para); }
    para.lines.push(refParseInline(raw));
  }
}
function refParseMd(src) {
  const text = String(src == null ? '' : src);
  const blocks = text.split('```');
  const tokens = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i % 2 === 1) {
      let body = blocks[i];
      const nl = body.indexOf('\n');
      if (nl >= 0 && body.slice(0, nl).length < 24 && body.slice(0, nl).trim() !== '') body = body.slice(nl + 1);
      const head = blocks[i].slice(0, nl >= 0 ? nl : blocks[i].length);
      tokens.push({ kind: 'code', lang: nl >= 0 && head.length < 24 ? head.trim() : '', code: body.replace(/\n$/, '') });
    } else {
      refParseBlocks(blocks[i], tokens);
    }
  }
  return tokens;
}
function refStatsFromPatch(txt) {
  const out = []; let cur = '';
  String(txt == null ? '' : txt).split('\n').forEach(l => {
    if (/^\+\+\+ /.test(l)) {
      const f = l.slice(4).trim().replace(/^[ab]\//, '');
      cur = (!f || f === '/dev/null') ? '' : f;
      if (cur) out.push({ file: cur, adds: 0, dels: 0 });
      return;
    }
    if (!cur) return;
    if (l.charAt(0) === '+' && !/^\+\+\+/.test(l)) out[out.length - 1].adds++;
    else if (l.charAt(0) === '-' && !/^---/.test(l)) out[out.length - 1].dels++;
  });
  return out;
}
function refEdLines(s) {
  if (typeof s !== 'string' || s === '') return 0;
  const a = s.split('\n');
  if (a[a.length - 1] === '') a.pop(); // ← P1-1 修复位
  return a.length;
}

console.log('== A parser 行为黄金值（参照实现） ==');
let tk = refParseMd('```js\nconsole.log(1)\n```');
t('A1 代码块语言剥离+正文去尾换行', tk.length === 1 && tk[0].kind === 'code' && tk[0].lang === 'js' && tk[0].code === 'console.log(1)');
tk = refParseMd('## 标题');
t('A2 h2', tk[0].kind === 'heading' && tk[0].level === 2 && tk[0].spans[0].text === '标题');
tk = refParseMd('- a\n普通行\n- b');
t('A3 列表/段落/列表交替不并（PWA 黄金，P1-2）', tk.map(x => x.kind).join(',') === 'list,para,list');
tk = refParseMd('- a\n1. b');
t('A4 ul/ol 分开', tk.length === 2 && tk[0].ordered === false && tk[1].ordered === true);
const spans = refParseInline('`c` **b** [t](https://x.com)');
t('A5 行内 code/bold/link', spans.length === 5 && spans[0].kind === 'code' && spans[2].kind === 'bold' && spans[4].kind === 'link' && spans[4].url === 'https://x.com');
tk = refParseMd('> 引用\n\n---\n尾巴');
t('A6 quote+hr+para', tk.map(x => x.kind).join(',') === 'quote,hr,para');
tk = refParseMd('```\n无语言\n```');
t('A7 无语言代码块 lang 空', tk[0].kind === 'code' && tk[0].lang === '');

console.log('== B ChatService 行为黄金值 ==');
const patch2 = '--- a/a.txt\n+++ b/a.txt\n@@\n+line1\n+line2\n-old\n--- a/b.txt\n+++ b/b.txt\n@@\n+only\n';
const r2 = refStatsFromPatch(patch2);
t('B1 双文件 patch 黄金（a:+2/−1 b:+1/−0，P1-3）', r2.length === 2 && r2[0].file === 'a.txt' && r2[0].adds === 2 && r2[0].dels === 1 && r2[1].file === 'b.txt' && r2[1].adds === 1 && r2[1].dels === 0);
t('B2 edLines 黄金（"a\\nb\\n"=2，P1-1）', refEdLines('a\nb\n') === 2 && refEdLines('a\nb') === 2 && refEdLines('') === 0);
const rDev = refStatsFromPatch('+++ /dev/null\n+x');
t('B3 /dev/null 跳过（PWA 同构）', rDev.length === 0);

console.log('== C 源码结构锚（参照实现同构性锁定） ==');
const parser = fs.readFileSync(path.join(ETS, 'core', 'markdown', 'parser.ets'), 'utf8');
const chat = fs.readFileSync(path.join(ETS, 'domain', 'chat', 'ChatService.ets'), 'utf8');
t('C1 parser 段落打断列表=closeList（非 closePara）', /if \(list !== null\) \{\s*closeList\(\);/.test(parser));
t('C2 parser 块解析逐行扫（split 换行）', parser.includes("split('\\n')"));
t('C3 edLines pop 语义在源码', /lines\[lines\.length - 1\] === ''[\s\S]{0,80}pop\(\)/.test(chat));
t('C4 statsFromPatch 逐行扫 +++ 在源码（[ab]/剥离+/dev/null）', chat.includes("replace(/^[ab]\\//, '')") && chat.includes("'/dev/null'"));
t('C5 user 消息同走 md（P1-6，无 role 前置）', /if \(txt\.trim\(\) !== ''\) \{\s*\n\s*item\.tokens = mdTokensOf\(txt\);/.test(chat));
t('C6 edit 兜底分支在源码（oldString/newString 估算，对齐 PWA）', chat.includes('oldString') && chat.includes('按替换文本行数估算'));

console.log('== D P1 修复锚 ==');
t('D1 edOpenMids 展开记忆（P1-5）', chat.includes('edOpenMids') && chat.includes('setEdOpen'));
const ecv = fs.readFileSync(path.join(ETS, 'components', 'EditCardView.ets'), 'utf8');
t('D2 EditCardView 接线（读 card.open+toggle 写记忆+头点击）', ecv.includes('aboutToAppear') && ecv.includes('ChatService.setEdOpen'));
const idx = fs.readFileSync(path.join(ETS, 'pages', 'Index.ets'), 'utf8');
t('D3 重登 ctx 幂等补拉（P1-4）', /aboutToAppear[\s\S]{0,260}ChatService\.ctxStart\(\)/.test(idx));
t('D4 登出清三态（P1-4）', /setCtxUsed\(0\)[\s\S]{0,80}setQueueCount\(0\)[\s\S]{0,80}setSseState\('idle'\)/.test(idx));

console.log('== E 红对照（旧 bug 形态必红） ==');
t('E1 旧 statsFromPatch（diff --git 分块）零残留', !chat.includes('diff --git'));
t('E2 Map 索引取值零残留（editMap[）', !/editMap\[/.test(chat));
t('E3 死代码零残留（lastToken/K_BP）', !parser.includes('lastToken') && !fs.readFileSync(path.join(ETS, 'store', 'Store.ets'), 'utf8').includes('K_BP'));
// E4：参照实现注入 P1-2 旧 bug（closeList→noop）后 A3 必红（证明 A3 有判别力）
function refBuggy(seg) {
  const tokens = [];
  const lines = seg.split('\n');
  let para = null, list = null;
  for (const raw of lines) {
    if (raw.trim() === '') { para = null; list = null; continue; }
    if (/^\s*[-*+]\s+/.test(raw)) {
      para = null;
      if (list === null || list.ordered) { list = { kind: 'list', ordered: false, items: [] }; tokens.push(list); }
      list.items.push(refParseInline(raw.replace(/^\s*[-*+]\s+/, ''))); continue;
    }
    // 旧 bug：段落不关 list
    if (para === null) { para = { kind: 'para', lines: [] }; tokens.push(para); }
    para.lines.push(refParseInline(raw));
  }
  return tokens;
}
t('E4 判别力（注入旧 bug 后 list,para,list 变形）', refBuggy('- a\n普通行\n- b').map(x => x.kind).join(',') !== 'list,para,list');

console.log(`\nM1 parser/behavior: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

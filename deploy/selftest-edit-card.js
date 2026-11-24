/*
 * task239 自测：本轮改文件汇总卡（diff 卡）
 * 用法：node deploy/selftest-edit-card.js
 * 覆盖：patch 文本分文件计数 / edit 的 filediff 精确值 / write 行数 / 失败不计 / 按轮聚合去重 /
 *       卡片骨架与折叠 / 两个渲染点接线 / CSS 落位
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const pathFn = require('path');

const ROOT = pathFn.resolve(__dirname, '..');
/* 模块化后源码锚点走 loadUiSource（按 @order 拼接全部模块+内联脚本）；CSS 锚点仍在 index.html 原文里 */
const html = require('./selftest-load-ui').loadUiSource(pathFn.join(ROOT, 'ui'))
  + '\n' + fs.readFileSync(pathFn.join(ROOT, 'ui/index.html'), 'utf8');

const start = html.indexOf('function _edLines(');
/* task310 顺修：原边界到 renderMessage(，task300 在中间插入 msgMetaText（内部 aliasOf 读 localStorage）
   导致 ⑤「纯展示」误报（其函数头注释也含 localStorage 字样）；边界收敛到该函数前的注释块起点 */
const msgMetaAt = html.indexOf('function msgMetaText(');
const end = msgMetaAt > start ? html.lastIndexOf('/*', msgMetaAt) : html.indexOf('function renderMessage(');
if (start < 0 || end < 0 || end <= start) {
  console.log('RESULT: FAIL（未能从 ui/index.html 定位 diff 卡函数块）');
  process.exit(1);
}
const code = html.slice(start, end);

/* ---------- 极简 DOM stub（只要 el/classList/appendChild/title 够用） ---------- */
/* task340：classList 改从 className 派生（浏览器原生语义：className 字符串与 classList 自动同步）——
   旧 stub 两套状态互不相通，renderEditCard 经 className 传初始类（默认 collapsed）时 contains 恒 false 假红 */
function makeNode(tag) {
  const node = {
    tagName: tag, className: '', textContent: '', title: '', children: [], onclick: null, dataset: {},
    classList: {
      add(c) { const s = node.className.split(/\s+/).filter(Boolean); if (s.indexOf(c) < 0) { s.push(c); node.className = s.join(' ') } },
      remove(c) { node.className = node.className.split(/\s+/).filter(Boolean).filter(function (x) { return x !== c }).join(' ') },
      toggle(c) { node.classList.contains(c) ? node.classList.remove(c) : node.classList.add(c) },
      contains(c) { return node.className.split(/\s+/).filter(Boolean).indexOf(c) >= 0 }
    },
    appendChild(c) { this.children.push(c); return c },
    _text() { return (this.textContent || '') + this.children.map(function (x) { return x._text() }).join('') }
  };
  return node;
}
const sandbox = {
  console,
  el: function (tag, cls, text) {
    const n = makeNode(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.__api = { _edLines: _edLines, statsFromPatch: statsFromPatch, fileStatsOfPart: fileStatsOfPart, buildEditCards: buildEditCards, relFile: relFile, renderEditCard: renderEditCard, _ecOpenMids: _ecOpenMids };', sandbox);
const api = sandbox.__api;

const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra == null ? '' : String(extra) }) }

/* ---------- 1. patch 文本分文件计数 ---------- */
const PATCH = [
  'Index: /p/a.js', '===', '--- /p/a.js', '+++ /p/a.js', '@@ -1,2 +1,3 @@', ' keep', '+add1', '+add2', '-gone',
  '--- /p/b.md', '+++ /p/b.md', '@@ -1 +1 @@', '-old', '+new'
].join('\n');
const pa = api.statsFromPatch(PATCH);
check('①patch 按 +++ 分文件', pa.length === 2 && pa[0].file === '/p/a.js' && pa[1].file === '/p/b.md', JSON.stringify(pa));
check('①patch 逐文件 +/- 计数（跳过 ---/+++ 头）', pa[0].adds === 2 && pa[0].dels === 1 && pa[1].adds === 1 && pa[1].dels === 1, JSON.stringify(pa));

/* ---------- 2. fileStatsOfPart：三类工具 ---------- */
const editPart = { type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath: '/p/x.js', oldString: 'a\nb', newString: 'a\nb\nc' }, metadata: { filediff: { file: '/p/x.js', additions: 5, deletions: 2 } } } };
const e1 = api.fileStatsOfPart(editPart);
check('②edit 优先用 filediff 精确值', e1 && e1[0].adds === 5 && e1[0].dels === 2, JSON.stringify(e1));
const editNoFd = { type: 'tool', tool: 'edit', state: { status: 'completed', input: { filePath: '/p/y.js', oldString: 'a\nb', newString: 'a\nb\nc' }, metadata: {} } };
const e2 = api.fileStatsOfPart(editNoFd);
check('②edit 缺 filediff 时按替换文本行数兜底（+3/−2）', e2 && e2[0].adds === 3 && e2[0].dels === 2, JSON.stringify(e2));
const writePart = { type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: '/p/new.md', content: 'l1\nl2\nl3\n' }, metadata: { exists: false } } };
const e3 = api.fileStatsOfPart(writePart);
check('②write 新增行数=内容行数（尾部空行不计）', e3 && e3[0].adds === 3 && e3[0].dels === 0 && e3[0].note === '新建文件', JSON.stringify(e3));
const writeOver = { type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: '/p/old.md', content: 'a\nb' }, metadata: { exists: true } } };
check('②write 覆盖已存在文件时 note 标注覆盖（不虚报删除行）', api.fileStatsOfPart(writeOver)[0].note.indexOf('覆盖') >= 0, JSON.stringify(api.fileStatsOfPart(writeOver)));
const patchPart = { type: 'tool', tool: 'patch', state: { status: 'completed', input: { patchText: PATCH }, metadata: {} } };
check('②patch 工具走 statsFromPatch', api.fileStatsOfPart(patchPart).length === 2, JSON.stringify(api.fileStatsOfPart(patchPart)));
check('②失败/中断的工具不计入', api.fileStatsOfPart({ type: 'tool', tool: 'edit', state: { status: 'error', input: { filePath: '/p/z' }, metadata: {} } }) === null);
check('②非文件写入类工具（bash/read）返回 null', api.fileStatsOfPart({ type: 'tool', tool: 'bash', state: { status: 'completed', input: {} } }) === null);

/* ---------- 3. buildEditCards：按轮聚合、挂到最后一条 assistant、同文件合并 ---------- */
const msgs = [
  { info: { id: 'u1', role: 'user' }, parts: [] },
  { info: { id: 'a1', role: 'assistant' }, parts: [editPart] },
  { info: { id: 'a2', role: 'assistant' }, parts: [{ type: 'text', text: 'done' }, editPart] },
  { info: { id: 'u2', role: 'user' }, parts: [] },
  { info: { id: 'a3', role: 'assistant' }, parts: [writePart] },
  { info: { id: 'u3', role: 'user' }, parts: [] },
  { info: { id: 'a4', role: 'assistant' }, parts: [{ type: 'text', text: 'no edits' }] }
];
const cards = api.buildEditCards(msgs);
check('③同一轮两处改同一文件合并成一行（+10/−4）', cards['a2'] && cards['a2'].files.length === 1 && cards['a2'].adds === 10 && cards['a2'].dels === 4, JSON.stringify(cards['a2']));
check('③卡片只挂该轮最后一条 assistant（a1 不挂）', !cards['a1'] && !!cards['a2'], Object.keys(cards).join(','));
check('③下一轮 write 独立成卡（+3/−0）', cards['a3'] && cards['a3'].adds === 3 && cards['a3'].files[0].file === '/p/new.md', JSON.stringify(cards['a3']));
check('③没有改动的轮次不产卡', !cards['a4'], Object.keys(cards).join(','));

/* ---------- 4. relFile / renderEditCard ---------- */
check('④路径只显示末两段', api.relFile('/storage/Users/currentUser/project/littleDJ/ui/index.html') === 'ui/index.html', api.relFile('/storage/Users/currentUser/project/littleDJ/ui/index.html'));
const card = api.renderEditCard(cards['a2'], 'a2');
check('④卡头「已编辑 1 个文件」+ +10 −4', card._text().indexOf('已编辑 1 个文件') >= 0 && card._text().indexOf('+10') >= 0 && card._text().indexOf('−4') >= 0, card._text());
check('④明细行带完整路径 title', card.children[1].children[0].title === '/p/x.js', card.children[1].children[0].title);
check('④task340 默认折叠（初始含 collapsed）', card.classList.contains('collapsed'), JSON.stringify(card.classList.set));
card.children[0].onclick();
check('④点卡头展开（collapsed 移除 + 记忆 _ecOpenMids）', !card.classList.contains('collapsed') && !!api._ecOpenMids['a2'], JSON.stringify(api._ecOpenMids));
const rebuilt = api.renderEditCard(cards['a2'], 'a2'); /* task340：模拟全量重渲（轮询/SSE 校准 innerHTML 重建） */
check('④task340 重渲后按记忆保持展开（轮询不弹回）', !rebuilt.classList.contains('collapsed'), JSON.stringify(rebuilt.classList.set));
rebuilt.children[0].onclick();
check('④再点折叠（记忆清除）', rebuilt.classList.contains('collapsed') && !api._ecOpenMids['a2'], JSON.stringify(api._ecOpenMids));
const fresh2 = api.renderEditCard(cards['a2'], 'a2');
check('④清除记忆后重渲回归默认折叠', fresh2.classList.contains('collapsed'), JSON.stringify(fresh2.classList.set));
const noMid = api.renderEditCard(cards['a3']); /* 无 mid（防御路径）：默认折叠、点击不炸 */
check('④无 mid 防御：默认折叠且可点击', noMid.classList.contains('collapsed') && (noMid.children[0].onclick(), true) && noMid.classList.contains('collapsed') === false, JSON.stringify(noMid.classList.set));

/* ---------- 5. 静态接线 ---------- */
check('⑤renderMessage 在 opt.edits 时挂卡（task340 传 mid）', /if \(opt && opt\.edits && opt\.edits\.files && opt\.edits\.files\.length\) wrap\.appendChild\(renderEditCard\(opt\.edits, info\.id\)\)/.test(html), '未挂载/未传 mid');
const calls = (html.match(/renderMessage\(m, \{ edits: _ecm2?\[\(m\.info \|\| \{\}\)\.id\] \}\)/g) || []).length;
check('⑤两个渲染点（openSession / refreshCurrent）都传 edits', calls === 2, 'count=' + calls);
check('⑤CSS 六条已落（.editcard/.ec-h/.ec-row/.ec-add/.ec-del/折叠）', /\.editcard\{/.test(html) && /\.ec-h\{/.test(html) && /\.ec-row\{/.test(html) && /\.ec-add\{color:var\(--accent\)\}/.test(html) && /\.ec-del\{color:var\(--err\)\}/.test(html) && /\.editcard\.collapsed \.ec-list\{display:none\}/.test(html), 'CSS 缺失');
check('⑤纯展示：块内不出现 fetch/write 类副作用', !/fetch\(/.test(code) && !/localStorage/.test(code), '出现副作用调用');

let fail = 0;
results.forEach(r => { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')) });
console.log(fail ? 'RESULT: FAIL（' + fail + '/' + results.length + '）' : 'RESULT: PASS（' + results.length + '/' + results.length + '）');
process.exit(fail ? 1 : 0);

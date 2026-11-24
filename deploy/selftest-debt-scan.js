#!/usr/bin/env node
/* task164 第一遍静态扫描：零引用函数 / HTML id / CSS 类 / 调试残留 / 定时器
   用法：node deploy/selftest-debt-scan.js [--json]
   判定口径：
   - 函数：声明处 1 次命中 + 全文件其余引用 0 次 = 疑似零引用（事件 onclick='fn()' 字符串也算引用）
   - id：HTML 里 id="x" 且 JS 里 $('#x')/'#x'/getElementById 无命中 = 疑似无引用
   - CSS 类：.cls{} 定义且模板里 'cls' 无命中 = 疑似无引用（宽松：任何文本命中即算用）
   - 定时器：setInterval 计数 vs clearInterval 计数（人工复核，非硬断言）*/
const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');

const out = { zeroRefFns: [], deadIds: [], deadCss: [], debugResidue: [], timers: {}, suspicious: [] };

/* --- 1. 零引用函数 --- */
const fnDecls = [];
const fnRe = /function\s+([A-Za-z_$][\w$]*)\s*\(/g;
let m;
while ((m = fnRe.exec(ui))) fnDecls.push({ name: m[1], idx: m.index });
const fnNames = [...new Set(fnDecls.map(f => f.name))];
/* 模板函数（buildXxx/renderXxx 等）可能由字符串引用，先收集全部字符串字面量 */
const strLits = (ui.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || []).join('\n');
for (const name of fnNames) {
  if (name === '$$') continue; /* 正则元字符工具函数，第一遍已人工核实在用 */
  const re = new RegExp('\\b' + name.replace(/\$/g, '\\$') + '\\b', 'g');
  const count = (ui.match(re) || []).length;
  const inStr = strLits.includes(name);
  if (count <= 1 && !inStr) {
    /* task164：排除 IIFE（(function name(){...})() 名字只出现一次但立即执行） */
    const at = ui.indexOf('function ' + name);
    if (at >= 0 && ui.slice(at, at + 2000).includes('})()')) continue;
    out.zeroRefFns.push(name);
  }
}

/* --- 2. HTML id 无引用 --- */
const idDecls = [];
const idRe = /\bid="([A-Za-z_][\w-]*)"/g;
while ((m = idRe.exec(ui))) idDecls.push(m[1]);
for (const id of new Set(idDecls)) {
  /* task164 御史 P2-3：删未用的 useRe 死变量，实际判定走 hitHash */
  const hitHash = ui.includes("'" + id + "'") || ui.includes('"' + id + '"') || ui.includes('`' + id + '`');
  /* id= 出现本身算声明；再排除 HTML 内 label for 等属性复用 */
  if (!hitHash) out.deadIds.push(id);
}

/* --- 3. CSS 类无引用（动态拼接族白名单：JS 以 '前缀' + 变量 拼类名；blur-off=注释自证的控制台对照实验开关） --- */
const DYN_PREFIX = ['lv', 'stage-', 'ctxp-', 'm-']; /* task164 御史 P2-3：'nd-' 随任务行退役已无对应类，去冗余；task191 补 ctxp-（task189 会话行百分比 pill 动态 'ctxp-'+info.lvl）；task197 补 m-（'conv-mode m-' + S.chain.mode 动态拼接，L-055 复发） */
const CSS_ALLOW = ['blur-off'];
const style = ui.match(/<style>([\s\S]*?)<\/style>/) || ['', ''];
function outsideStr(u, st) { return u.slice(0, st.index) + u.slice(st.index + st[1].length); }
const cssClasses = new Set();
const clsRe = /\.([A-Za-z_][\w-]*)\s*[{,:\s]/g;
while ((m = clsRe.exec(style[1]))) cssClasses.add(m[1]);
const outside = outsideStr(ui, style);
for (const c of cssClasses) {
  const dyn = DYN_PREFIX.some(p => c.startsWith(p) && (outside.includes(p + "' +") || outside.includes(p + '" +')))
    || (c.startsWith('mrole-') && outside.includes("' m' + childRoleClass")); /* task191：task173-fu1 消息容器角色类由 'm'+childRoleClass(rk) 派生，非 '前缀'+变量 形态，单列识别 */
  if (dyn) continue; /* 动态拼接类：白名单放行 */
  if (CSS_ALLOW.includes(c)) continue;
  if (!outside.includes(c)) out.deadCss.push(c);
}

/* --- 4. 调试残留 --- */
const dbgRes = [
  /console\.(log|debug|info|warn|error|trace)\(/g,
  /debugger\b/g,
  /TODO(?!\s*[：:]?\s*$)/g,
  /FIXME/g,
  /\bXXX\b/g
];
const names = ['console.*', 'debugger', 'TODO', 'FIXME', 'XXX'];
dbgRes.forEach((re, i) => {
  const lines = [];
  ui.split('\n').forEach((l, ln) => { re.lastIndex = 0; if (re.test(l)) lines.push(ln + 1); });
  if (lines.length) out.debugResidue.push({ kind: names[i], lines: lines.slice(0, 30), count: lines.length });
});

/* --- 5. 定时器 --- */
const si = (ui.match(/setInterval\(/g) || []).length;
const ci = (ui.match(/clearInterval\(/g) || []).length;
const st = (ui.match(/setTimeout\(/g) || []).length;
const ct = (ui.match(/clearTimeout\(/g) || []).length;
out.timers = { setInterval: si, clearInterval: ci, setTimeout: st, clearTimeout: ct };

/* --- 6. 可疑语义（退役入口残留；task164 起任务行渲染层亦退役） --- */
const retired = ['hideMode', 'taskRowsBtn', 'setHideTaskRows', 'convFilter', 'renderButlerSection', 'butlerSectOpen', 'navTasksRow', 'synthetic', 'showTaskRows'];
for (const r of retired) {
  const lines = [];
  ui.split('\n').forEach((l, ln) => {
    const t = l.trim();
    if (l.includes(r) && !t.startsWith('/*') && !t.startsWith('*') && !t.startsWith('//')) lines.push(ln + 1); /* 注释行不计（退役说明注释合规） */
  });
  if (lines.length) out.suspicious.push({ token: r, lines: lines.slice(0, 15), count: lines.length });
}

if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  console.log('== 零引用函数（疑似）==');
  console.log(out.zeroRefFns.join(', ') || '(无)');
  console.log('== HTML id 无引用（疑似）==');
  console.log(out.deadIds.join(', ') || '(无)');
  console.log('== CSS 类无引用（疑似）==');
  console.log(out.deadCss.join(', ') || '(无)');
  console.log('== 调试残留 ==');
  out.debugResidue.forEach(d => console.log(d.kind + ': ' + d.count + ' 处 ' + JSON.stringify(d.lines)));
  console.log('== 定时器 ==', JSON.stringify(out.timers));
  console.log('== 退役语义残留 ==');
  out.suspicious.forEach(s => console.log(s.token + ': ' + s.count + ' 处 行' + JSON.stringify(s.lines)));
}

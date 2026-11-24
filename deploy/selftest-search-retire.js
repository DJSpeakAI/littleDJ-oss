/* task342 左栏搜索按钮退役自测（纯静态 + 源码锚 + 点名红对照，无需浏览器）
   用法：node deploy/selftest-search-retire.js  （exit 0=PASS / 1=FAIL）
   背景：主人 2026-11-16 口述「这里的查询按钮删除他」——左栏「项目」标题行 ⌕ 搜索入口整链退役。
   覆盖：①HTML 入口/搜索行零残留且 ＋ 新建项目仍在 ②处理函数/S.search/childMatchesQ 零引用
        ③appendChildRows 形参与调用点回到 3 参 ④buildSidebarCtx 零参、ctx.q/search/all 删除
        ⑤三处 verText 同版 ⑥点名红对照（人为注入 btnSearch 必须被抓到） */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI = path.join(ROOT, 'ui');
const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
const read = f => fs.readFileSync(path.join(UI, 'src', f), 'utf8');
const rows = read('sidebar/rows.js');
const children = read('sidebar/children.js');
const actions = read('sidebar/actions.js');
const state = read('core/state.js');
const follow = read('task/follow.js');
const boot = read('app/boot.js');
const popout = read('pricing/popout.js');

let pass = 0, fail = 0;
function ok(name, cond){ if (cond){ pass++; console.log('  [PASS] ' + name) } else { fail++; console.log('  [FAIL] ' + name) } }

console.log('== task342 左栏搜索按钮退役 ==');

/* ① HTML：搜索入口/搜索行零残留；＋ 新建项目仍在 */
ok('①1 btnSearch 零残留', html.indexOf('btnSearch') < 0);
ok('①2 searchRow 零残留', html.indexOf('searchRow') < 0);
ok('①3 #search 输入框零残留', html.indexOf('id="search"') < 0 && html.indexOf("$('#search')") < 0);
ok('①4 「搜索会话」文案零残留', html.indexOf('搜索会话') < 0);
ok('①5 ＋ 新建项目入口保留', /<button id="btnMkProj"[^>]*>＋<\/button>/.test(html));

/* ② 处理函数与过滤链零引用 */
ok('②1 S.search 零引用（state/rows/follow）', !/S\.search/.test(state + rows + follow));
ok('②2 childMatchesQ 零定义/零调用', !/function childMatchesQ/.test(children) && !/childMatchesQ\s*\(/.test(rows + actions));
ok('②3 childMatchesQ 不再挂 window', children.indexOf('window.childMatchesQ') < 0);
ok('②4 rows.js 不再声明 q 变量', !/var q = /.test(rows) && !/ctx\.q\b/.test(rows));
ok('②5 actions.js 无 q 形参/命中筛', !/appendChildRow(s)?\([^)]*\bq\b/.test(actions) && !/if \(q\) list/.test(actions));

/* ③ appendChildRows 形参与调用点回到 3 参 */
ok('③1 appendChildRows 定义 3 参', /function appendChildRows\(container, pid, level\)\{/.test(actions));
ok('③2 appendChildRows 调用均为 3 参', !/appendChildRows\([^)]*,\s*q\s*\)/.test(rows + actions) && (rows + actions).indexOf('appendChildRows(') >= 0);
ok('③3 appendChildRow 定义 3 参', /function appendChildRow\(container, c, level\)\{/.test(actions));

/* ④ buildSidebarCtx 零参 + 搜索字段删除 */
ok('④1 buildSidebarCtx 零参定义', /function buildSidebarCtx\(\)\{/.test(rows));
ok('④2 ctx 无 q/search/all 字段', !/q: q, search: !!q/.test(rows) && !/all: !!q/.test(rows) && !/search: !!q/.test(rows));
ok('④3 renderProjRow 无 q 形参', /function renderProjRow\(proj, ico, openKey, isImport, ledgerSet, liveSet, grouped, ctx\)\{/.test(rows));

/* ④b 静态源码锚：任务注释在位（防未来静默回加） */
ok('④4 task342 注释锚（rows/follow）', rows.indexOf('task342') >= 0 && follow.indexOf('task342') >= 0);
ok('④5 列表项不再有「没有匹配的对话」', rows.indexOf('没有匹配的对话') < 0);

/* ⑤ verText 三处同版（L-063 动态口径：禁写死版本字面量——并行占号会打红他人自测） */
const vHtml = /id="verText">personal agent · (v[\d.]+)</.exec(html);
const vBoot = /verText'\)\.textContent = 'personal agent · (v[\d.]+)'/.exec(boot);
const vPop = /verText'\); if \(vt\) vt\.textContent = 'personal agent · (v[\d.]+)'/.exec(popout);
const vMatch = !!(vHtml && vBoot && vPop
  && /^v\d+\.\d+\.\d+\.\d+$/.test(vHtml[1])
  && vHtml[1] === vBoot[1] && vBoot[1] === vPop[1]);
ok('⑤1 verText 三处一致且格式合法（动态口径）', vMatch);

/* ⑤b 模块缓存参数已刷新（改动模块不可回退旧 pN；动态口径 task371-M0#9） */
(function () {
  const VMSR = require('./contract').htmlScriptVersionMap(UI);
  const need = ['src/core/state.js', 'src/sidebar/rows.js', 'src/sidebar/children.js', 'src/sidebar/actions.js', 'src/task/follow.js'];
  const miss = need.filter(function (k) { return !/^p\d+$/.test(VMSR[k] || ''); });
  ok('⑤2 改动模块缓存参数刷新（' + need.map(function (k) { return k.split('/').pop() + '=' + (VMSR[k] || '缺失'); }).join(' ') + '）', miss.length === 0);
})();

/* ⑥ 点名红对照：人为把 btnSearch 注入 HTML / S.search 注入 rows，检查器必须变红 */
function looksRetired(h, r, c){
  return h.indexOf('btnSearch') < 0 && h.indexOf('searchRow') < 0 && !/S\.search/.test(r) && !/function childMatchesQ/.test(c);
}
const red1 = looksRetired(html + '<button id="btnSearch">⌕</button>', rows, children);
const red2 = looksRetired(html, rows + '\nvar x = S.search;', children);
const red3 = looksRetired(html, rows, children + '\nfunction childMatchesQ(c, q){ return true }');
ok('⑥1 红对照：注入 btnSearch 被抓', red1 === false);
ok('⑥2 红对照：注入 S.search 被抓', red2 === false);
ok('⑥3 红对照：注入 childMatchesQ 被抓', red3 === false);

console.log('----');
console.log('RESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '（' + pass + ' 通过 / ' + fail + ' 失败）');
process.exit(fail === 0 ? 0 : 1);

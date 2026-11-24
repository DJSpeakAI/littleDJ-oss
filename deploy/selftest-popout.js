/* task206 自测：比价大屏弹出独立窗口（?popout=pricing）
   验 3 组：①popoutParseQ 纯函数（vm 跑真源码，含空串/白名单外/前缀边界）
          ②静态断言（popout CSS/启动守卫/手势常量/工具栏入口/版本号两处）
          ③红对照（删 bootstrap 早退 + sysTimersStart 守卫的副本必须转红）
   用法：node deploy/selftest-popout.js （exit 0=PASS / 1=FAIL / 2=源码装载失败） */
const fs = require('fs'), vm = require('vm'), path = require('path');
const UI = process.env.UI_PATH || path.join(__dirname, '..', 'ui', 'index.html');
/* task328 连坐修复：模块化后函数在 ui/src（loadUiSource 拼模块+index.html 内联），旧正则零改动继续生效 */
/* task328 连坐修复：模块（@order 拼接）在前 + index.html 全文（style/内联脚本）在后——
   不可再叠 loadUiSource（它已含内联脚本），否则内联段重复出现两遍，红对照只删得掉一处。 */
const html = require('./contract').concatModules(path.dirname(UI)) + '\n' + fs.readFileSync(UI, 'utf8');

let pass = 0, fail = 0;
function ok (name, cond) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name) }

/* ---------- ① popoutParseQ 纯函数（从真源码切出两段，vm 净跑） ---------- */
const popSrc = [
  (html.match(/var POP_TABS = \{[^\n]*\};/) || [''])[0],
  (html.match(/function popoutParseQ\(search\)\{[\s\S]*?\n\}/) || [''])[0]
].join('\n');
if (!/POP_TABS/.test(popSrc) || !/popoutParseQ/.test(popSrc)) {
  console.log('FAIL 装载：popoutParseQ 源码未找到（ui 结构变动？）');
  process.exit(2);
}
const box = {};
vm.createContext(box);
vm.runInContext(popSrc + '; this.__f = popoutParseQ;', box);
ok('popoutParseQ("?popout=pricing") = "pricing"', box.__f('?popout=pricing') === 'pricing');
ok('popoutParseQ("") 返回空（10 套 vm 自测以 location.search:"" 桩加载，不得误入 popout 分支）', !box.__f(''));
ok('popoutParseQ("?popout=tasks") 返回空（白名单外）', box.__f('?popout=tasks') === '');
ok('popoutParseQ("?popout=pricing&x=1") = "pricing"', box.__f('?popout=pricing&x=1') === 'pricing');
ok('popoutParseQ("?x=1&popout=pricing") = "pricing"（& 分隔）', box.__f('?x=1&popout=pricing') === 'pricing');
ok('popoutParseQ("?popout=Pricing") 返回空（大小写敏感）', box.__f('?popout=Pricing') === '');
ok('popoutParseQ("?popout=apikey&prov=volc") = "apikey" 且 POP_PROV=volc（task328）', box.__f('?popout=apikey&prov=volc') === 'apikey' && box.POP_PROV === 'volc');

/* ---------- ①-b task278：prNormCtx 纯函数（网抓上下文文本归一，vm 跑真源码） ---------- */
const ctxSrc = (html.match(/function prNormCtx\(s\)\{[\s\S]*?\n\}/) || [''])[0];
if (!/prNormCtx/.test(ctxSrc)) {
  console.log('FAIL 装载：prNormCtx 源码未找到（ui 结构变动？）');
  process.exit(2);
}
const box278 = {};
vm.createContext(box278);
vm.runInContext(ctxSrc + '; this.__n = prNormCtx;', box278);
[
  ['输入长度 [0, 32K)', '[0,32K)'],
  ['输入长度 ≥32K', '≥32K'],
  ['输入 [0, 32K)，输出 [0, 0.2K)', '入[0,32K)·出[0,0.2K)'],
  ['输入长度 [32K, 128K)', '[32K,128K)'],
  ['1M（[1m] 后缀）', '1M([1m] 后缀)'],
  ['200K', '200K'],
  ['—', '—']
].forEach(function (c) { ok('prNormCtx(' + c[0] + ') = ' + c[1], box278.__n(c[0]) === c[1]) });

/* ---------- ② 静态断言（同一组断言既验绿版，也做红对照） ---------- */
function checks (src) {
  return [
    ['CSS: body.popout 单列全宽', /body\.popout #app\{grid-template-columns:minmax\(0,1fr\)\}/.test(src)],
    ['CSS: 弹出页隐藏 sidebar/main', /body\.popout #sidebar,body\.popout #main\{display:none\}/.test(src)],
    ['CSS: 弹出页 #right 压过移动端 fixed 抽屉', /body\.popout #right\{border-left:none;display:flex;position:static;inset:auto\}/.test(src)],
    ['CSS: 黑屏修复——(2,2,1) 反压初始 noright 挡板（fu1/fu2）', /body\.popout #app\.noright #right\{display:flex\}/.test(src)],
    ['CSS: 弹出页隐藏 phantom 分隔条 .splitter（fu2）', /body\.popout \.splitter\{display:none\}/.test(src)],
    ['CSS: 弹出页隐藏页签行', /body\.popout \.tabs\{display:none\}/.test(src)],
    ['CSS: 长按提示条 .pr-pop-hint', /\.pr-pop-hint\{position:fixed/.test(src)],
    ['启动: bootstrap 首部 POP_TAB 早退进 bootPopout', /if \(POP_TAB\)\{ bootPopout\(\); return \}/.test(src)],
    ['启动: bootPopout 摘除初始 noright（黑屏根因，fu1）', /var app = \$\('#app'\); if \(app\) app\.classList\.remove\('noright'\)/.test(src)],
    ['启动: 顶层 sysBind/sysTimersStart 显式跳过（早退够不着；task245 页内自检 + task271 清单轮询同句挂 POP_TAB 守卫）', /if \(!POP_TAB\)\{ sysBind\(\); sysTimersStart\(\);/.test(src) && /setInterval\(stPoll, 2500\)/.test(src) && /todoLoad\(false\) \}, 5000\)/.test(src)],
    ['启动: 移动端返回哨兵跳过', /if \(!POP_TAB && isMobile\(\)/.test(src)],
    ['守卫: sysTimersStart 首行 POP_TAB return（挡 /_watch 轮询+响铃链）', /function sysTimersStart\(\)\{\n  if \(POP_TAB\) return;/.test(src)],
    ['守卫: kaStart 首行 POP_TAB return（防双窗口保活双响）', /function kaStart\(\)\{\n  if \(POP_TAB\) return;/.test(src)],
    ['守卫: popstate 跳过（不垫哨兵不翻译）', /window\.addEventListener\(\'popstate\', function\(\)\{\n  if \(POP_TAB\) return;/.test(src)],
    ['手势: 长按 550ms / 拖出 18px 常量', /POP_LONG_MS = 550, POP_DRAG_PX = 18/.test(src)],
    ['手势: pointerup 手势内开窗（防弹窗拦截）', /addEventListener\('pointerup', function\(\)\{[\s\S]{0,400}popoutOpen\(it\.tab\)/.test(src)],
    ['手势: 长按/拖出后吞掉切页签 click', /popSuppressClick = true;/.test(src)],
    ['开窗: 具名窗口复用 + 尺寸参数（task229：sz 可选，默认 1280×880；task236 前置居中计算 popWinPlace）', /var _pl = popWinPlace\(sz \|\| 'width=1280,height=880', 1280, 880\)/.test(src) && /window\.open\('\?popout=' \+ tab, 'ljPopout_' \+ tab, _pl\.feats\)/.test(src) && /popWinAfter\(w, _pl\)/.test(src)],
    ['开窗: 被拦截时 toast 兜底', /浏览器拦截了弹出窗口/.test(src)],
    ['入口: 比价工具栏「⤢ 大屏」按钮（popout 页自身不显示）', /'⤢ 大屏'/.test(src) && /big\.onclick = function\(\)\{ popoutOpen\('pricing'\) \};/.test(src) && /if \(!POP_TAB\)\{ \/\* task206/.test(src)],
    ['大屏页: 5 分钟静默校新 + pagehide 回收', /300000/.test(src) && /pagehide/.test(src)],
    ['CSS: 右栏比价表格自滚收口（task207 横条可见）', /#pricingWrapBox\{overflow:auto;max-height:calc\(var\(--vvh,100dvh\) - 250px\)\}/.test(src)],
    ['版本: verText 三处同版本无混用（≥3 处、唯一版本号）', (function(){ var a = (src.match(/personal agent · v[\d.]+/g) || []); return a.length >= 3 && a.filter(function(v,i){ return a.indexOf(v) === i }).length === 1 })()],
    ['task215: apikey 页签白名单 + prov 参数解析', /POP_TABS = \{ pricing: 1, apikey: 1 \}/.test(src) && /&prov=\(ds\|zp\|volc\)/.test(src) && /POP_PROV = m\[2\] \|\| ''/.test(src)],
    ['task215: 供应商 Key 窗开窗 + bootPopout apikey 分支（单卡渲染）', /function popoutOpenKey\(prov\)\{/.test(src) && /POP_TAB === 'apikey'/.test(src) && /skRenderKeyWin\(POP_PROV, 'keyWinWrap'\)/.test(src)],
    ['task229: 无 prov 渲染供应商列表页（skRenderProvList + 模型对比按钮）', /else skRenderProvList\('keyWinWrap'\);/.test(src) && /function skRenderProvList\(wrapId, embed\)\{/.test(src) && /'📊 模型对比'/.test(src)],
    ['task212: 模型名中文括注拆 remark 标签', /!m\.remark && typeof m\.name === 'string'/.test(src) && /pr-tag/.test(src)],
    ['task278: prNormCtx 归一上下文列（单元格走函数）', /function prNormCtx\(s\)\{/.test(src) && /prNormCtx\(m\.contextText\)/.test(src)],
    ['task278: 分段同名续行「〃」+ .pr-cont 灰字', /rows\[gi\]\._cont =/.test(src) && /class="pr-cont"/.test(src) && /\.pr-cont\{color:var\(--faint\)/.test(src)],
    ['task278: 免费模型挂「免费」灰标签', /m\.free \? ' <span class="pr-tag">免费<\/span>'/.test(src)],
    ['task213: 单位上移表头（PRMETA.u=tokens/元-百万 + .pr-hunit）', /u: 'tokens'/.test(src) && /u: '元\/百万'/.test(src) && /pr-hunit/.test(src)],
    ['task213: 元价/折元单元格撤行内「元」小字', !/' <span class="pr-unit">元<\/span>'/.test(src)],
    ['task213: 撤 task212 前端 tokens 注入（1M tokens 零残留）', !/1M tokens/.test(src) && !/32K tokens\)/.test(src)],
    ['task213: 积分行（未折元）保留行内积分标注（跨量纲）', /' <span class="pr-unit">' \+ esc\(unit\) \+ '<\/span>'/.test(src)],
    ['task212: 积分⇄元切换按钮 + 自定汇率持久化', /⇄ 显示元/.test(src) && /littledj\.prRate/.test(src) && /littledj\.prUnitCny/.test(src)],
    ['task212: 说明行含高峰时段 5 折口径', /周一至周五 14:00–18:00/.test(src) && /5 折/.test(src)],
    ['task211: 大屏页首次渲染后窗口收高（消除下方空白）', /function popoutFitOnce\(\)\{/.test(src) && /if \(POP_TAB\) setTimeout\(popoutFitOnce, 60\)/.test(src) && /window\.resizeTo/.test(src)],
    ['task211: 收高只做一次（SK.popFitted 闸）', /SK\.popFitted = true/.test(src) && /if \(!POP_TAB \|\| SK\.popFitted\) return/.test(src)],
    /* task370：主人二次报「模型对比下面一大坨黑色空间」——resizeTo 收窗在标签页/手动拉窗时失效，改纯布局兜底 */
    ['task370: 大屏页 rightBody 竖向 flex 撑满', /body\.popout #rightBody\{display:flex;flex-direction:column\}/.test(src)],
    ['task370: 比价面板吃满剩余高度（#pricingWrap flex:1）', /body\.popout #rightBody > \.pr-panel#pricingWrap\{flex:1;min-height:0\}/.test(src)],
    ['task370: 表格盒弹性填满且不超容器（flex:1 + max-height:100%）', /body\.popout #pricingWrapBox\{flex:1 1 auto;min-height:0;max-height:100%\}/.test(src)],
    ['task370: apikey 页面板不拉伸（flex:none 护住 Key 管理页）', /body\.popout #rightBody > \.pr-panel\{flex:none\}/.test(src)],
    ['版本: ui 无 v0.208.2.0 残留', !/v0\.208\.2\.0/.test(src)],
    ['task208: 弹窗比价无 340px 最小高（下方空白根因）', !/\.pr-wrap\{[^}]*min-height:340px/.test(src)],
    ['task208: 列元数据 PRMETA 单一真源 9 列', /var PRMETA = \[[\s\S]*?\{ k: 'link'/.test(src)],
    ['task208: 表头渲染带 colgroup 列宽', /colgroup[\s\S]{0,200}prWidthOf\(k\)/.test(src)],
    ['task208: 拖动换位（桌面）+ 长按菜单（触屏）', /prThDown[\s\S]*?pointerType !== 'mouse'[\s\S]*?prColMenu/.test(src)],
    ['task208: 列宽/列序 localStorage 持久化', /littledj\.prCols/.test(src) && /littledj\.prColW/.test(src)],
    ['task208: 关弹窗收口列菜单', /closeModal[\s\S]{0,800}prColMenuClose/.test(src)],
    ['task209: 「最划算」标记与 pr-best 类零残留', !/最划算/.test(src) && !/pr-best/.test(src)],
    ['task209: GLM Token Plan 按 [1m] 拆行（普通/[1m] 各一）', /\/Token\\s\*Plan\/i\.test\(p\.provider/.test(src) && /m2\.name = m\.name \+ '\[1m\]'/.test(src)],
    ['task210 P1-1: 列宽拖拽 pointercancel 兜底 + 监听摘除', /addEventListener\('pointercancel', up\)/.test(src) && /removeEventListener\('pointercancel', up\)/.test(src)],
    ['task210 P2-1: prOrder 脏数据去重', /out\.indexOf\(k\) < 0/.test(src)],
    ['task210 P2-3: 列菜单随滚动关闭', /addEventListener\('scroll', prColMenuClose, true\)/.test(src) && /removeEventListener\('scroll', prColMenuClose, true\)/.test(src)],
    ['task224: popout 页零台账轮询（7009 定时器带 POP_TAB 守卫）', /setInterval\(function\(\)\{\n  if \(POP_TAB\) return;[^\n]*\n  if \(document\.hidden && !kaActive\(\)\) return;[^\n]*\n  loadTaskLedger\(false\);\n\}, 10000\);/.test(src)],
    ['task224: bootPopout 统一设 S.tab（apikey 分支不再回落默认 tasks）', /function bootPopout\(\)\{[\s\S]{0,700}S\.tab = POP_TAB;/.test(src) && (src.match(/S\.tab = POP_TAB/g) || []).length === 1]
  ];
}
checks(html).forEach(function (p) { ok(p[0], p[1]) });

/* ---------- ③ 红对照：删早退分支 + sysTimersStart 守卫 + noright 摘除，对应断言必须转红 ---------- */
let mut = html.replace('if (POP_TAB){ bootPopout(); return }', '');
mut = mut.replace('function sysTimersStart(){\n  if (POP_TAB) return;', 'function sysTimersStart(){');
mut = mut.replace("var app = $('#app'); if (app) app.classList.remove('noright'); ", '');
const redFail = checks(mut).filter(function (p) { return !p[1] }).map(function (p) { return p[0] });
ok('红对照: 删早退+守卫+noright 摘除后至少 3 条断言转红（实测 ' + redFail.length + ' 条）', redFail.length >= 3);

/* ---------- ③-b task224 红对照：按断言名点名验证，防「新增断言失效靠旧 3 条兜底转绿」 ---------- */
const A224 = 'task224: popout 页零台账轮询（7009 定时器带 POP_TAB 守卫）';
const B224 = 'task224: bootPopout 统一设 S.tab（apikey 分支不再回落默认 tasks）';
function namedRed (src, name) {
  const hit = checks(src).filter(function (p) { return p[0] === name })[0];
  return !!(hit && hit[1] === false);
}
/* task328 连坐修复：模块化后 html 含 ui/src 模块（keepalive 也有 setInterval+POP_TAB 守卫），
   红对照必须按 task224 注释点名定位台账 7009 块，不能再抓「第一个 setInterval+守卫」。 */
const noA = html.replace(/setInterval\(function\(\)\{\n  if \(POP_TAB\) return; \/\* task224[^\n]*\n/, 'setInterval(function(){\n');
ok('红对照: 删 7009 守卫行后「A224」点名转红', namedRed(noA, A224));
const noB = html.replace('  S.tab = POP_TAB; /* task224：', '  /* task224：');
ok('红对照: 删 bootPopout 的 S.tab 赋值后「B224」点名转红', noB !== html && namedRed(noB, B224));

/* ---------- ③-c task278 点名红对照：撤掉上下文归一调用 / 免费标签 → 对应断言转红 ---------- */
const C278 = 'task278: prNormCtx 归一上下文列（单元格走函数）';
const noNorm = html.replace("esc(prNormCtx(m.contextText) || '—')", "esc(m.contextText || '—')");
ok('红对照: 撤 prNormCtx 调用后「C278」点名转红', noNorm !== html && namedRed(noNorm, C278));
const D278 = 'task278: 分段同名续行「〃」+ .pr-cont 灰字';
const noCont = html.replace('rows[gi]._cont = ', 'rows[gi]._contNoop = ');
ok('红对照: 撤 _cont 标记后「D278」点名转红', noCont !== html && namedRed(noCont, D278));
const E278 = 'task278: 免费模型挂「免费」灰标签';
const noFree = html.replace("(m.free ? ' <span class=\"pr-tag\">免费</span>' : '')", '');
ok('红对照: 撤免费标签后「E278」点名转红', noFree !== html && namedRed(noFree, E278));

/* ---------- ③-d task304：弹窗版比价搜索栏/表头冻结（滚动容器下沉 #prTableBox） ---------- */
ok('task304: .pr-wrap overflow:hidden（滚动下沉，搜索栏/说明行恒可见）', /\.pr-wrap\{[^}]*overflow:hidden/.test(html));
ok('task304: #prTableBox 表格盒自滚（flex:1 + min-height:0 + overflow:auto）', /#prTableBox\{flex:1;min-height:0;overflow:auto\}/.test(html));
ok('task304: 表头 sticky 作用域含弹窗版 #prTableBox', /#pricingWrapBox \.pr-table thead th, #prTableBox \.pr-table thead th\{position:sticky;top:0/.test(html));
const noFrz1 = html.replace('max-height:78vh;overflow:hidden;text-align:left}', 'max-height:78vh;overflow:auto;text-align:left}');
ok('红对照: overflow:hidden 还原 auto 后冻结断言转红', noFrz1 !== html && !/\.pr-wrap\{[^}]*overflow:hidden/.test(noFrz1));
const noFrz2 = html.replace('#prTableBox{flex:1;min-height:0;overflow:auto}', '#prTableBox{}');
ok('红对照: 撤 #prTableBox 自滚规则后断言转红', noFrz2 !== html && !/#prTableBox\{flex:1;min-height:0;overflow:auto\}/.test(noFrz2));
const noFrz3 = html.replace('#pricingWrapBox .pr-table thead th, #prTableBox .pr-table thead th{position:sticky', '#pricingWrapBox .pr-table thead th{position:sticky');
ok('红对照: sticky 作用域缩回 #pricingWrapBox 后断言转红', noFrz3 !== html && !/#pricingWrapBox \.pr-table thead th, #prTableBox \.pr-table thead th\{position:sticky;top:0/.test(noFrz3));

/* ---------- ③-e task370：大屏页撑满视口（防「下方黑色空白」复发回归锚） ---------- */
const F370 = 'task370: 比价面板吃满剩余高度（#pricingWrap flex:1）';
const noFill = html.replace('body.popout #rightBody > .pr-panel#pricingWrap{flex:1;min-height:0}', 'body.popout #rightBody > .pr-panel#pricingWrap{}');
ok('红对照: 撤 #pricingWrap flex:1 撑满规则后「F370」点名转红', noFill !== html && namedRed(noFill, F370));
const G370 = 'task370: 表格盒弹性填满且不超容器（flex:1 + max-height:100%）';
const noBoxFill = html.replace('body.popout #pricingWrapBox{flex:1 1 auto;min-height:0;max-height:100%}', 'body.popout #pricingWrapBox{}');
ok('红对照: 撤表格盒弹性规则后「G370」点名转红', noBoxFill !== html && namedRed(noBoxFill, G370));

console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail ? 1 : 0);

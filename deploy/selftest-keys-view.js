/* task214/task215/task229 自测：API Key 管理入口链（设置 → API Key → 供应商列表页 → 点供应商 → 独立 Key 窗）
   验 3 组：① 纯函数（vm 跑真源码：skKvScope / skKvDraftGet / skKvDraftSet / skKvAliasKey / skKvModelOptions / skProvId）
            ② 静态断言（设置动作项 / 列表页 / skRenderKeyWin 单卡 / provider 可点 / apikey 页签 / 退役零残留 / 草稿 / 刷新 / 版本）
            ③ 红对照（撤 provider 绑定 + 页签白名单 + 容器化 helper + 列表页分支后必须转红）
   用法：node deploy/selftest-keys-view.js （exit 0=PASS / 1=FAIL / 2=源码装载失败） */
const fs = require('fs'), vm = require('vm'), path = require('path');
const UI = process.env.UI_PATH || path.join(__dirname, '..', 'ui', 'index.html');
/* task328 连坐修复：模块化（task315）后函数源码在 ui/src 各模块——用 loadUiSource 拼模块+index.html 内联段，
   旧正则断言零改动继续生效（同 task315 迁移 14 套自测的口径；此套此前漏迁，装载失败伪装成 PASS 教训记 task328 牌）。 */
/* task328 连坐修复：模块（@order 拼接）在前 + index.html 全文（style/内联脚本）在后——
   不可再叠 loadUiSource（它已含内联脚本），否则内联段重复出现两遍，红对照只删得掉一处。 */
const html = require('./contract').concatModules(path.dirname(UI)) + '\n' + fs.readFileSync(UI, 'utf8');

let pass = 0, fail = 0;
function ok (name, cond) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name) }

/* ---------- ① 纯函数（从真源码切段，vm 净跑） ---------- */
function grab (re) { const m = html.match(re); return m ? m[0] : '' }
const fnSrc = [
  grab(/function skKvScope\(scope\)\{[\s\S]*?\n\}/),
  grab(/function skKvDraftGet\(prov, f\)\{[^\n]*\n/),
  grab(/function skKvDraftSet\(prov, f, v\)\{[^\n]*\n/),
  grab(/function skKvAliasKey\(prov, mid\)\{[\s\S]*?\n\}/),
  grab(/function skKvModelOptions\(prov\)\{[\s\S]*?\n\}/),
  grab(/function skProvId\(provider\)\{[\s\S]*?\n\}/),
  grab(/function prCell\(r, k, ri\)\{[\s\S]*?\n\}/), /* task348：供应商列点击渲染 */
  grab(/function esc\(s\)\{[^\n]*\n/)
].join('\n');
if (!/skKvScope/.test(fnSrc) || !/skKvAliasKey/.test(fnSrc) || !/skKvModelOptions/.test(fnSrc) || !/skProvId/.test(fnSrc) || !/prCell/.test(fnSrc)) {
  console.log('FAIL 装载：task214/215/347 纯函数源码未找到（ui 结构变动？）');
  process.exit(2);
}
const box = { SK: { kvDraft: { ds: { name: '', key: '' }, zp: { name: '', key: '' } }, prWrap: 'prWrap' }, SETTINGS: {} };
box.$ = function (sel) { return sel === '#prWrap' ? { id: 'prWrap' } : (sel === '#pricingWrap' ? { id: 'pricingWrap' } : null) };
box.zpModelList = function () { return [{ modelID: 'glm-5.3', name: 'GLM-5.3' }] };
box.volcModelList = function () { return [['doubao-seed-1-6-250615', 'Doubao Seed 1.6']] }; /* task328 */
vm.createContext(box);
vm.runInContext(fnSrc + '; this.__scope=skKvScope; this.__dg=skKvDraftGet; this.__ds=skKvDraftSet; this.__ak=skKvAliasKey; this.__mo=skKvModelOptions; this.__pid=skProvId; this.__pr=prCell;', box);
ok('skKvScope("pricingWrap") 解析容器', box.__scope('pricingWrap') && box.__scope('pricingWrap').id === 'pricingWrap');
ok('skKvScope(默认) 回落 SK.prWrap', box.__scope(null) && box.__scope(null).id === 'prWrap');
ok('skKvScope(元素对象) 原样返回（窗内容器 DOM 隔离）', (function () { const o = { querySelector: function () { return null } }; return box.__scope(o) === o })());
ok('skKvScope("不存在") 返回 null 不抛错', box.__scope('nope') === null);
ok('skKvDraftGet 空草稿返回空串', box.__dg('ds', 'name') === '');
box.__ds('ds', 'name', '主人'); box.__ds('ds', 'key', 'sk-x');
ok('skKvDraftSet/Get 往返：name', box.__dg('ds', 'name') === '主人');
ok('skKvDraftSet/Get 往返：key', box.__dg('ds', 'key') === 'sk-x');
ok('skKvDraftGet 未设的供应商返回空串', box.__dg('zp', 'key') === '');
ok('skKvAliasKey(ds) = deepseek/<model>', box.__ak('ds', 'deepseek-flash') === 'deepseek/deepseek-flash');
ok('skKvAliasKey(zp) = zhipuai-coding-plan/<model>', box.__ak('zp', 'glm-5.3') === 'zhipuai-coding-plan/glm-5.3');
ok('skKvModelOptions(ds) 两模型', box.__mo('ds').length === 2 && box.__mo('ds')[0][0] === 'deepseek-flash');
ok('skKvModelOptions(zp) 走 zpModelList', box.__mo('zp').length === 1 && box.__mo('zp')[0][0] === 'glm-5.3');
ok('skKvModelOptions(volc) 走 volcModelList（task328）', box.__mo('volc').length === 1 && box.__mo('volc')[0][0] === 'doubao-seed-1-6-250615');
ok('skKvAliasKey(volc) = volcengine/<model>（task328，与 serve providerID 对齐）', box.__ak('volc', 'doubao-seed-1-6-250615') === 'volcengine/doubao-seed-1-6-250615');
/* task215：供应商 → Key 管理提供方 */
ok('skProvId(DeepSeek 官方) = ds', box.__pid('DeepSeek 官方') === 'ds');
ok('skProvId(GLM Token Plan) = zp', box.__pid('智谱 GLM Token Plan') === 'zp');
ok('skProvId(火山方舟) = volc（task328）', box.__pid('火山方舟（火山引擎）') === 'volc');
ok('skProvId(按量智谱官方) = 空（无 Key 路由不可点）', box.__pid('智谱官方（按量计费）') === '');
ok('skProvId(空/null) 不抛错返回空', box.__pid('') === '' && box.__pid(null) === '');
/* task348（主人令）：比价表火山行点击直达 Key 管理窗——未接入也须可点（去配 Key 的路径） */
const cellVolcOff = box.__pr({ provider: '火山方舟（火山引擎）', linked: false, m: {} }, 'provider');
const cellVolcOn = box.__pr({ provider: '火山方舟（火山引擎）', linked: true, m: {} }, 'provider');
const cellUnknown = box.__pr({ provider: '智谱官方（按量计费）', linked: false, m: {} }, 'provider');
ok('task348: 火山未接入仍渲染可点链接（data-prov=volc）', /class="pr-prov-link"/.test(cellVolcOff) && /data-prov="volc"/.test(cellVolcOff) && /点击去配置 API Key/.test(cellVolcOff));
ok('task348: 火山已接入点击语义=管理 Key + 已接入徽标', /点击管理 API Key/.test(cellVolcOn) && /已接入 ✓/.test(cellVolcOn));
ok('task348: 无 Key 管理供应商仍不可点（不误开空窗）', !/pr-prov-link/.test(cellUnknown) && /该供应商无 API Key 管理/.test(cellUnknown));

/* ---------- ② 静态断言 ---------- */
function checks (src) {
  return [
    ['撤视图切换: pr-seg/prView/skRenderKeys 零残留', !/pr-seg|SK\.prView|skRenderKeys/.test(src)],
    ['Key 管理窗: skRenderKeyWin 按 prov 渲染（ds/zp/volc 单卡 + 双卡兜底）', /function skRenderKeyWin\(prov, wrapId\)\{/.test(src) && /var provs = \(prov === 'ds' \|\| prov === 'zp' \|\| prov === 'volc'\) \? \[prov\] : \['ds', 'zp'\]/.test(src)],
    ['task328: 供应商列表三家（DeepSeek / GLM / 火山方舟）', /\[\['ds', 'DeepSeek 官方'[\s\S]*?\['volc', '火山方舟（火山引擎）'[\s\S]*?\]\]\.forEach/.test(src)],
    ['task328: 火山 Key 路由族（GET/POST + test/active/delete）', /fetch\('\/_settings\/volc'\)/.test(src) && /'\/_settings\/volc\/test'/.test(src) && /'\/_settings\/volc\/active'/.test(src) && /'\/_settings\/volc\/delete'/.test(src)],
    ['task328: 火山编辑卡（Key 输入 + 连通测试 + 豆包模型表）', /火山方舟（火山引擎）/.test(src) && /function volcModelList\(\)/.test(src) && /doubao-seed-1-6-250615/.test(src) && /function testVolc\(/.test(src)],
    ['Key 卡复用: skKvCard(p, wrapId) 循环 + 上下文区块', /provs\.forEach\(function\(p\)\{ g\.appendChild\(skKvCard\(p, wrapId\)\) \}\);/.test(src) && /skKvCtxCard\(wrapId\)/.test(src)],
    ['GLM 额度类容器化（kv-zp-q5val/qwval）', /kv-zp-q5val/.test(src) && /kv-zp-qwval/.test(src)],
    ['容器查询 helper: skKvEl 定义 + 测试/切换函数使用', /function skKvEl\(scope, cls\)/.test(src) && /skKvEl\(scope, 'kv-zp-test'\)/.test(src) && /skKvEl\(scope, 'kv-ds-test'\)/.test(src)],
    ['草稿: SK.kvDraft + oninput 实时写 + 渲染回填', /kvDraft: \{ ds: \{ name: '', key: '' \}, zp: \{ name: '', key: '' \} \}/.test(src) && /nInp\.oninput = function\(\)\{ skKvDraftSet\(prov, 'name', nInp\.value\) \}/.test(src) && /kInp\.value = skKvDraftGet\(prov, 'key'\)/.test(src)],
    ['手动刷新: 卡片 ⟳（大屏页无自动轮询）+ Key 窗零 setInterval', /guard-btn kc-rf/.test(src) && (function () { const i = src.indexOf('function skRenderKeyWin(prov, wrapId){'); const j = src.indexOf('function skRenderPricing(wrapId){'); const seg = src.slice(i, j > i ? j : i + 6000); return !/setInterval/.test(seg) })()],
    ['task272: 设置页 API Key 内嵌（切 view 不弹窗）', /\{ id: 'apikey', label: 'API Key', ico: '⚿' \}/.test(src) && /if \(n\.id === 'apikey'\)\{[\s\S]{0,200}SETTINGS\.view = 'apikey'/.test(src) && !/popoutOpen\('apikey'/.test(src)],
    ['task229: 列表页渲染（skRenderProvList + 上「模型对比」按钮弹比价大窗）', /function skRenderProvList\(wrapId, embed\)\{/.test(src) && /'📊 模型对比'/.test(src) && /cmp\.onclick = function\(\)\{ popoutOpen\('pricing'\) \};/.test(src)],
    ['task272: 供应商卡 embed 双路（内嵌切编辑页 / popout 兜底）+ Key 数徽标', /card\.onclick = embed/.test(src) && /SETTINGS\.keyProv = cfg\[0\]; renderSettings\(\)/.test(src) && /popoutOpenKey\(cfg\[0\]\)/.test(src) && /kvls-' \+ cfg\[0\] \+ '-cnt/.test(src) && /尚未添加 Key/.test(src) && /加载失败/.test(src)],
    ['task272: 内嵌页两态渲染 + 返回列表 + 容器收口', /function renderKeyEmbedPage\(body\)\{/.test(src) && /skRenderProvList\('keyEmbedBox', true\)/.test(src) && /skRenderKeyWin\(prov, 'keyEmbedBox'\)/.test(src) && /‹ 返回 API Key 管理/.test(src)],
    ['task275: 内嵌页渲染时机——body 入文档后再渲染（防游离 DOM 查询不到容器白屏）', /wrap\.appendChild\(body\);\s*\/\* task275[\s\S]{0,600}if \(SETTINGS\.view === 'apikey'\) renderKeyEmbedPage\(body\);/.test(src)],
    ['task229: bootPopout apikey 双路（有 prov 单卡 / 无 prov 列表页）', /if \(POP_PROV === 'ds' \|\| POP_PROV === 'zp' \|\| POP_PROV === 'volc'\) skRenderKeyWin\(POP_PROV, 'keyWinWrap'\);/.test(src) && /else skRenderProvList\('keyWinWrap'\);/.test(src)],
    ['task272: popoutOpen 尺寸参数保留（默认 1280×880 不变），apikey 开窗调用零残留', /function popoutOpen\(tab, sz\)\{/.test(src) && /sz \|\| 'width=1280,height=880'/.test(src) && !/popoutOpen\('apikey'/.test(src)],
    ['task229-fu1: 列表页范围提示 + SETTINGS oa 死字段清零', /仅列出支持 Key 管理的供应商/.test(src) && !/oa: null/.test(src)],
    ['task360: 设置默认页=API Key（openSettings 初始 apikey，原 sfx 组 id 无渲染分支=空白）', /function openSettings[\s\S]{0,1200}SETTINGS\.view = 'apikey'/.test(src)],
    ['settingsSave 收口为仅关闭弹窗', /function settingsSave\(closeAfter\)\{\n  closeModal\(\);\n\}/.test(src)],
    ['旧硬编码 id 零残留（mDsKeyName/mDsKey/mDsCtx/dsTestResult/zpTestResult/btnTestDs/btnTestZp/dsBalance/zpQ5Val）', !/mDsKeyName|mDsCtx|dsTestResult|zpTestResult|btnTestDs|btnTestZp|dsBalance|zpQ5Val|zpQWVal/.test(src) && !/mDsKey['"]/.test(src)],
    ['退役函数零残留（renderApiKeyPage/renderZhipuPage/settingsSnapshot/updateSettingsDirty/markSettingsClean/saveZhipuSettings/applyModelChoice/saveAliasDrafts）', !/renderApiKeyPage|renderZhipuPage|settingsSnapshot|updateSettingsDirty|markSettingsClean|saveZhipuSettings|applyModelChoice|saveAliasDrafts/.test(src)],
    ['退役状态零残留（SETTINGS.dirty/baseline/aliasDraft/dsModelCur/zpModelCur）', !/SETTINGS\.dirty|SETTINGS\.baseline|SETTINGS\.aliasDraft|SETTINGS\.dsModelCur|SETTINGS\.zpModelCur/.test(src)],
    ['别名即时保存（task337：走 setModelAliases 单源上行，refreshModelOptions 已内置）', /function skKvSaveAlias\(prov, scope\)\{[\s\S]{0,600}setModelAliases\(al\)/.test(src) && !/skKvSaveAlias[\s\S]{0,600}littledj\.modelAlias/.test(src)],
    ['ctx 兜底即时保存（littledj.contextK + updateUsage）', /function skKvSaveCtx\(scope\)\{[\s\S]{0,300}littledj\.contextK[\s\S]{0,120}updateUsage\(S\.lastMsgs \|\| \[\]\)/.test(src)],
    ['loadDs/loadZp 纯数据回调（无 settingsWrap 重渲依赖）', /function loadDsSettings\(cb\)\{[\s\S]{0,300}if \(cb\) cb\(d\);/.test(src) && !/settingsWrap'\) && \$\(#overlay'|settingsWrap'\) && \$\(_overlay/.test(src)],
    ['余额/额度与胶囊同源（S.balance）+ 独立窗可用', /function skKvBalance\(scope\)\{[\s\S]{0,200}S\.balance/.test(src)],
    ['task214 P0-1 保活: Key 卡用量统计入口（kv-usage → closeModal+openUsageStats）', /guard-btn kv-usage/.test(src) && /ub\.onclick = function\(\)\{ closeModal\(\); openUsageStats\(\) \}/.test(src) && /openUsageStats\(\) \};/.test(src)],
    ['task215: 空态文案指新入口链（设置 → API Key → 点供应商）', /设置 → API Key → 点供应商 → 别名/.test(src) && !/比价页 → ⚿ Key/.test(src)],
    ['task215 产出审 P1-1: 旧入口文案全仓零残留（含注释维度）', !/比价页 → ⚿ Key/.test(src) && !/已移至 比价页/.test(src)],
    ['task360: SETTINGS 初始 view=apikey（默认页=API Key；task214 P1-B「禁 apikey 字面量」随 apikey 成为合法内嵌页而退役）', /var SETTINGS = \{ view: 'apikey'/.test(src)],
    ['task214 P2-1 保活: 保存成功后 name 草稿同步清空', /skKvDraftSet\(prov, 'key', ''\); skKvDraftSet\(prov, 'name', ''\);/.test(src)],
    ['task215: provider 列可点（skProvId + data-prov + 绑定 + popoutOpenKey）', /function skProvId\(provider\)/.test(src) && /data-prov="' \+ pid/.test(src) && /prBindProvLinks\(box\);/.test(src) && /function popoutOpenKey\(prov\)\{/.test(src)],
    ['task348: 未接入也可点（pid 即链接，title 两态区分；不再绑定 linked）', /var nameHtml = pid\s*\n/.test(src) && /点击去配置 API Key（独立窗口）/.test(src) && !/var nameHtml = \(pid && r\.linked\)/.test(src)],
    ['task215: apikey 页签（白名单 + prov 解析 + bootPopout 分支 + 单卡渲染）', /POP_TABS = \{ pricing: 1, apikey: 1 \}/.test(src) && /&prov=\(ds\|zp\|volc\)/.test(src) && /POP_TAB === 'apikey'/.test(src) && /skRenderKeyWin\(POP_PROV, 'keyWinWrap'\)/.test(src)],
    ['task228: OpenAI Key 库退役零残留（无 oa 卡片/测试链/加载函数）', !/function testOpenai/.test(src) && !/kv-oa-/.test(src) && !/function loadOaSettings/.test(src) && !/'oa'/.test(src)],
    ['task215: Key 窗样式（pr-prov-link + kvwin，零新增 hex）', /\.pr-prov-link\{color:var\(--accent\)/.test(src) && /\.kvwin\{max-width:680px/.test(src)],
    ['版本: verText 三处同版本无混用（≥3 处、唯一版本号）', (function(){ var a = (src.match(/personal agent · v[\d.]+/g) || []); return a.length >= 3 && a.filter(function(v,i){ return a.indexOf(v) === i }).length === 1 })()]
  ];
}
checks(html).forEach(function (p) { ok(p[0], p[1]) });

/* ---------- ③ 红对照：撤 provider 绑定 + 页签白名单 + 容器化 helper 后必须转红 ---------- */
let mut = html.replace("  prBindProvLinks(box);\n", "");
mut = mut.replace("var POP_TABS = { pricing: 1, apikey: 1 };", "var POP_TABS = { pricing: 1 };");
mut = mut.replace("function skKvEl(scope, cls){ var s = skKvScope(scope); return s ? s.querySelector('.' + cls) : null }", '');
mut = mut.replace("else skRenderProvList('keyWinWrap');", ''); /* task229：撤列表页分支 */
mut = mut.replace("else skRenderProvList('keyEmbedBox', true);", ''); /* task272：撤内嵌列表分支 */
mut = mut.replace('    var nameHtml = pid\n', '    var nameHtml = pid && r.linked\n'); /* task348：回退「未接入也可点」 */
const redFail = checks(mut).filter(function (p) { return !p[1] }).map(function (p) { return p[0] });
ok('红对照: 撤 provider 绑定 + apikey 白名单 + skKvEl + 列表页分支后至少 3 条断言转红（实测 ' + redFail.length + ' 条）', redFail.length >= 3);

console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail ? 1 : 0);

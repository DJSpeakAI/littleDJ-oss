#!/usr/bin/env node
/* task283 自测：比价表别名列核心纯函数
   用法：node deploy/selftest-alias-key.js
   覆盖：①prAliasKeyOf 名称归一（GLM 大写→serve 小写 modelID；[1m] 行归基础模型；DeepSeek 原名直通；未知供应商空串）
        ②S.models 缺失时小写兜底（与 zpModelList 兜底同口径）
        ③prOrder 旧列序迁移（无 alias 键 → 插到 model 后；自定义含 alias 序 → 尊重不重排）
   沙箱：vm 提取 ui 真源码函数，零 DOM 依赖 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiSource } = require('./selftest-load-ui.js');

const UI_DIR = process.env.UI_DIR || path.join(__dirname, '..', 'ui');
const src = loadUiSource(UI_DIR);

function grab (name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('源码未找到函数：' + name);
  let depth = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1) }
  }
  throw new Error('函数未闭合：' + name);
}

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }) }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }) }
}

/* ---- 沙箱：S.models 用真实 serve 口径（小写 modelID），补 el/$ 等未被纯函数引用的桩 ---- */
const LS = {}; /* task289-fu1：真 Map 桩——aliasOf/下拉过滤断言需读回写盘结果 */
const sandbox = {
  S: {
    model: { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3' }, /* task289-fu2：下拉过滤兜底项断言用 */
    models: [
      { providerID: 'deepseek', modelID: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
      { providerID: 'deepseek', modelID: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
      { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3', name: 'GLM-5.3' },
      { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }
    ]
  },
  localStorage: {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : null },
    setItem: function (k, v) { LS[k] = String(v) },
    removeItem: function (k) { delete LS[k] }
  },
  console: console
};
vm.createContext(sandbox);
vm.runInContext([grab('skProvId'), grab('prAliasKeyOf'), grab('getModelAliases'), grab('modelKey'), grab('aliasOf'), grab('visibleModelsForPick'), grab('rolePickModel')].join('\n') + '\nthis.__pk = prAliasKeyOf; this.__gma = getModelAliases; this.__ao = aliasOf; this.__vmp = visibleModelsForPick; this.__rpm = rolePickModel;', sandbox);
const pk = sandbox.__pk;

/* ① 归一 */
ok('GLM-5.3 → zhipuai-coding-plan/glm-5.3（大写归一）', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3' } }) === 'zhipuai-coding-plan/glm-5.3');
ok('GLM-5.3[1m] 独立别名 key（task288-fu1：[1m] 是独立形态，不归基础模型）', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3[1m]' } }) === 'zhipuai-coding-plan/glm-5.3[1m]');
ok('GLM-5.3-Flash → glm-5.3-flash', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3-Flash' } }) === 'zhipuai-coding-plan/glm-5.3-flash');
ok('GLM-5.3-Flash[1m] 独立别名 key', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3-Flash[1m]' } }) === 'zhipuai-coding-plan/glm-5.3-flash[1m]');
ok('deepseek-flash → deepseek/deepseek-flash', pk({ provider: 'DeepSeek 官方', m: { name: 'deepseek-flash' } }) === 'deepseek/deepseek-flash');
ok('deepseek-v4-pro → deepseek/deepseek-v4-pro', pk({ provider: 'DeepSeek 官方', m: { name: 'deepseek-v4-pro' } }) === 'deepseek/deepseek-v4-pro');
ok('未知供应商 → 空串（无别名入口）', pk({ provider: '某第三方', m: { name: 'x' } }) === '');

ok('普通行与 [1m] 行别名 key 必须不同（task288-fu1）', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3' } }) !== pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3[1m]' } }));

/* task289：尾部圆括号备注剥离（全角+半角）——带备注匹配必落空、别名会存进漂移 key 致三入口分裂 */
ok('全角备注剥离：GLM-5.3-Flash（含视觉理解 MCP）→ 命中 glm-5.3-flash（task289 三入口一致）', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3-Flash（含视觉理解 MCP）' } }) === 'zhipuai-coding-plan/glm-5.3-flash');
ok('半角备注剥离：deepseek-v4-pro (new) → deepseek-v4-pro（task289）', pk({ provider: 'DeepSeek 官方', m: { name: 'deepseek-v4-pro (new)' } }) === 'deepseek/deepseek-v4-pro');
ok('备注剥离不影响 [1m] 独立形态（方括号不剥，task288-fu1 保持）', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3[1m]' } }) === 'zhipuai-coding-plan/glm-5.3[1m]');
ok('圆括号+方括号并存：GLM-5.3[1m]（备注）→ 剥圆保方 = glm-5.3[1m]', pk({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3[1m]（备注）' } }) === 'zhipuai-coding-plan/glm-5.3[1m]');

/* ② S.models 缺失兜底 */
sandbox.S.models = [];
const pk2 = vm.runInContext(grab('prAliasKeyOf') + '\n;this.__pk2 = prAliasKeyOf;', Object.assign(sandbox, {})), dummy = 0;
const f2 = sandbox.__pk2;
ok('S.models 空：GLM-5.3 小写兜底 glm-5.3', f2({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3' } }) === 'zhipuai-coding-plan/glm-5.3');
ok('S.models 空：[1m] 后缀保留兜底（独立 key）', f2({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3[1m]' } }) === 'zhipuai-coding-plan/glm-5.3[1m]');
ok('S.models 空：带备注名兜底也剥（备注不进 key，task289）', f2({ provider: 'GLM Token Plan', m: { name: 'GLM-5.3-Flash（含视觉理解 MCP）' } }) === 'zhipuai-coding-plan/glm-5.3-flash');

/* ③ prOrder 迁移 */
sandbox.SK = { prOrder: ['provider', 'model', 'context', 'input', 'hit', 'output', 'conc', 'api', 'link'] };
sandbox.PRMETA = [
  { k: 'provider' }, { k: 'model' }, { k: 'alias' }, { k: 'context' }, { k: 'input' },
  { k: 'hit' }, { k: 'output' }, { k: 'conc' }, { k: 'api' }, { k: 'link' }
];
vm.runInContext(grab('prOrder') + '\n;this.__po = prOrder;', sandbox);
const po = sandbox.__po;
const order1 = po();
ok('旧列序升级：alias 插到 model 紧跟位（不甩末列）', order1.indexOf('alias') === order1.indexOf('model') + 1, JSON.stringify(order1));
sandbox.SK.prOrder = ['provider', 'model', 'context', 'alias', 'input', 'hit', 'output', 'conc', 'api', 'link'];
const order2 = po();
ok('用户自定义含 alias 的列序 → 原样尊重', order2.indexOf('alias') === 3, JSON.stringify(order2));

/* ④ task289-fu2（主人裁决「以别名为准」）：aliasOf [1m] 兜底回退 + 下拉只列有別名的模型 */
const ao = sandbox.__ao, vmp = sandbox.__vmp;
sandbox._aliasMap = { 'zhipuai-coding-plan/glm-5.3[1m]': 'GLM 5.3 官方', 'deepseek/deepseek-flash': 'DS4.1Flash 官方' };
ok('aliasOf：基础 key 空时回退 [1m] 拆行别名（主人填在 [1m] 行也生效，task289-fu2）', ao({ providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3' }) === 'GLM 5.3 官方');
sandbox._aliasMap = { 'zhipuai-coding-plan/glm-5.3': '基础优先', 'zhipuai-coding-plan/glm-5.3[1m]': '[1m]值' };
ok('aliasOf：基础 key 有值时优先基础（两行存储独立不串）', ao({ providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3' }) === '基础优先');
sandbox._aliasMap = {};
ok('aliasOf：无任何别名返回空串', ao({ providerID: 'deepseek', modelID: 'deepseek-v4-pro' }) === '');
/* 下拉清单：以别名为准 */
sandbox.S.models = [
  { providerID: 'deepseek', modelID: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
  { providerID: 'deepseek', modelID: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3', name: 'GLM-5.3' },
  { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }
];
sandbox.S.model = { providerID: 'deepseek', modelID: 'deepseek-v4-pro' };
sandbox._aliasMap = { 'deepseek/deepseek-flash': 'DS4.1Flash 官方' };
let vml = vmp();
ok('下拉只列有別名的模型（以别名为准，task289-fu2）', vml.length === 2, vml.map(function(m){ return m.modelID }).join(','));
ok('有別名的模型在列（deepseek-flash）', vml.some(function(m){ return m.modelID === 'deepseek-flash' }));
ok('没别名的模型不出现（glm-5.3-flash，不需要用=不显示）', !vml.some(function(m){ return m.modelID === 'glm-5.3-flash' }));
ok('当前选中模型无别名时保留为选项（防下拉显示错位）', vml.some(function(m){ return m.modelID === 'deepseek-v4-pro' }));
sandbox._aliasMap = { 'zhipuai-coding-plan/glm-5.3[1m]': 'GLM 5.3 官方', 'deepseek/deepseek-flash': 'DS4.1Flash 官方' };
vml = vmp();
ok('别名填在 [1m] 行，基础模型也进下拉（fallback 生效，task289-fu2）', vml.some(function(m){ return m.modelID === 'glm-5.3' }));
sandbox._aliasMap = {};
vml = vmp();
ok('无任何别名时兜底全量（防空白下拉无从选择）', vml.length === 4, String(vml.length));

/* ⑤ task290（主人裁决）：角色页下拉=别名清单 + 无别名自动默认官方（glm-5.3）并写回 */
const rpm = sandbox.__rpm;
sandbox.S.models = [
  { providerID: 'deepseek', modelID: 'deepseek-flash', name: 'DeepSeek V4.1 Flash' },
  { providerID: 'deepseek', modelID: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3', name: 'GLM-5.3' },
  { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3-flash', name: 'GLM-5.3-Flash' }
];
sandbox._aliasMap = { 'deepseek/deepseek-flash': 'DS4.1Flash 官方', 'zhipuai-coding-plan/glm-5.3[1m]': 'GLM 5.3 官方' };
let r1 = rpm('deepseek/deepseek-flash');
ok('角色模型有别名 → 不自动改写（autoFix 空，task290）', r1.autoFix === '' && r1.sel === 'deepseek/deepseek-flash', JSON.stringify(r1));
ok('角色清单=纯别名清单 2 项（含 [1m] 回退的 glm-5.3，不混输入框兜底项）', r1.list.length === 2, String(r1.list.length));
let r2 = rpm('deepseek/deepseek-v4-pro');
ok('角色模型无别名 → 自动默认官方 glm-5.3（主人原则：没别名不能用，task290）', r2.autoFix === 'zhipuai-coding-plan/glm-5.3' && r2.sel === 'zhipuai-coding-plan/glm-5.3', JSON.stringify(r2.autoFix));
let r5 = rpm('openai/gpt-x');
ok('角色存已退役/未知模型 → 默认官方（task290）', r5.autoFix === 'zhipuai-coding-plan/glm-5.3', String(r5.autoFix));
sandbox._aliasMap = { 'deepseek/deepseek-flash': 'DS4.1Flash 官方' };
let r3 = rpm('zhipuai-coding-plan/glm-5.3-flash');
ok('官方也无别名时 → 默认清单第一个可用模型（deepseek-flash）', r3.autoFix === 'deepseek/deepseek-flash', String(r3.autoFix));
sandbox._aliasMap = {};
let r4 = rpm('deepseek/deepseek-v4-pro');
ok('全无别名 → 不强制改写（防误写，清单全量兜底）', r4.autoFix === '' && r4.list.length === 4, r4.autoFix + '/' + r4.list.length);

/* 报告 */
out.items.forEach(function (it) { console.log((it.ok ? 'PASS' : 'FAIL') + '  ' + it.name + (it.ok ? '' : '   [' + it.detail + ']')) });
console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
process.exit(out.fail ? 1 : 0);

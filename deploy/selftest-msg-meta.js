/* selftest-msg-meta.js —— task300 消息尾部元信息（模型别名 + 缓存命中）纯函数自测
   抽取 ui/index.html 的 msgMetaText（字面量在 function renderMessage 之前），
   用 stub aliasOf 验证格式/口径与缺源不编数；exit 0=PASS / 1=FAIL / 2=装载失败。
   用法：node deploy/selftest-msg-meta.js */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
/* task381：抽取源由「直读 ui/index.html」改为 selftest-load-ui 拼接串（ui/src/*.js 产物+内联）——
   msgMetaText/renderMessage 已迁入 ts 模块产物，直读 index.html 恒 MISS（与 edge-swipe 同因）。 */
const UI_DIR = process.env.UI_DIR || path.join(__dirname, '..', 'ui');
const html = require('./selftest-load-ui').loadUiSource(UI_DIR);

const start = html.indexOf('function msgMetaText(info){');
const end = html.indexOf('function renderMessage(m, opt){', start);
if (start < 0 || end <= start) { console.log('FAIL 抽取失败：msgMetaText（锚点 renderMessage 前）'); process.exit(2) }
const src = html.slice(start, end);

const ctx = {
  console,
  /* 别名桩：只对 glm-5.3 命中，验证「有别名用别名」；其余返回空验证回落原始 modelID */
  aliasOf: function (m) {
    return (m && m.providerID === 'zhipuai-coding-plan' && m.modelID === 'glm-5.3') ? 'GLM-5.3 官方' : '';
  }
};
vm.createContext(ctx);
try { new vm.Script(src + '\nthis.__msgMetaText = msgMetaText;').runInContext(ctx) } catch (e) {
  console.log('FAIL 装载：' + e.message); process.exit(2)
}
const msgMetaText = ctx.__msgMetaText;

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; return }
  fail++; console.log('FAIL ' + label + '：got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want))
}

/* 1. 真实形状：有别名 + 有缓存 + 无成本 */
const real = {
  modelID: 'glm-5.3', providerID: 'zhipuai-coding-plan',
  tokens: { input: 52, output: 92, reasoning: 615, cache: { read: 11072, write: 0 } },
  cost: null
};
eq('真实形状→别名 + 缓存命中（四舍五入整数）', msgMetaText(real), '共消耗 144 tokens · GLM-5.3 官方 · 缓存命中 100%');

/* 2. 1000+ tokens 走 k 格式 */
eq('千级 tokens→1.5k', msgMetaText({ tokens: { input: 1000, output: 523 }, modelID: 'm' }), '共消耗 1.5k tokens · m');

/* 3. 缺别名→回落原始 modelID（provider 不匹配桩） */
eq('缺别名→原始 modelID', msgMetaText({ modelID: 'deepseek-v4', providerID: 'deepseek', tokens: { input: 10, output: 5 } }), '共消耗 15 tokens · deepseek-v4');

/* 4. 缺 cache 字段→不显示缓存段（缺源不编数） */
eq('缺 cache→无缓存段', msgMetaText({ modelID: 'm', tokens: { input: 10, output: 5 } }), '共消耗 15 tokens · m');

/* 5. cache.read=0 → 如实显示 0%（字段在，不跳过） */
eq('cache.read=0→缓存命中 0%', msgMetaText({ modelID: 'm', tokens: { input: 100, output: 5, cache: { read: 0 } } }), '共消耗 105 tokens · m · 缓存命中 0%');

/* 6. input+cache.read=0 → 分母为 0 不显示缓存段（防 NaN） */
eq('分母 0→不显示缓存段', msgMetaText({ modelID: 'm', tokens: { input: 0, output: 5, cache: { read: 0 } } }), '共消耗 5 tokens · m');

/* 7. 无 modelID/model → 不显示模型段 */
eq('无模型字段→只显示消耗', msgMetaText({ tokens: { input: 1, output: 2 } }), '共消耗 3 tokens');

/* 8. 有数值成本→末尾追加 $ */
eq('成本→$0.0012', msgMetaText({ modelID: 'm', tokens: { input: 10, output: 5 }, cost: 0.0012 }), '共消耗 15 tokens · m · $0.0012');

/* 9. 无 tokens（用户消息/旧消息）→ 空串，不生成 meta 行 */
eq('无 tokens→空串', msgMetaText({ modelID: 'm' }), '');
eq('info 缺失→空串', msgMetaText(null), '');

/* 10. aliasOf 抛异常也必须 fail-open 回落原始 modelID（localStorage 坏数据防线） */
const ctx2 = { console, aliasOf: function () { throw new Error('boom') } };
vm.createContext(ctx2);
try { new vm.Script(src + '\nthis.__msgMetaText = msgMetaText;').runInContext(ctx2) } catch (e) { console.log('FAIL 装载2：' + e.message); process.exit(2) }
eq('aliasOf 抛错→回落 modelID', ctx2.__msgMetaText({ modelID: 'm', tokens: { input: 1, output: 1 } }), '共消耗 2 tokens · m');

console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail ? 1 : 0);

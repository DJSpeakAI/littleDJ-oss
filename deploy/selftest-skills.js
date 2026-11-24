#!/usr/bin/env node
/* task194 自测：定时 skill 调度器 + 模型比价解析 + 端点 E2E
   用法：node deploy/selftest-skills.js [--json]
   覆盖：①computeNextRun/FirstRun 四种频率 ②parseDeepSeek 真实表格结构（含共享单元格）
        ③tick 触发/禁用跳过/running 互斥 ④运行日志白名单（凭据不落）⑤HTTP 端点（401/200 结构）
   沙箱：LITTLEDJ_ROOT 指向临时目录，绝不污染生产 skills.json / skills.jsonl */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { spawnSync } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-skills-'));
process.env.LITTLEDJ_ROOT = SANDBOX;

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}

const scheduler = require(path.join(__dirname, '..', 'server', 'skills', 'scheduler.js'));
const mp = require(path.join(__dirname, '..', 'server', 'skills', 'model-pricing.js'));
const T = scheduler._test;

/* ---------- ① 时间计算 ---------- */
const d1 = new Date('2026-11-10T06:00:00+08:00').getTime();
ok('daily 08:00 未到 → 今天 08:00', T.computeNextRun({ mode: 'daily', time: '08:00' }, d1) === new Date('2026-11-10T08:00:00+08:00').getTime());
const d2 = new Date('2026-11-10T09:00:00+08:00').getTime();
ok('daily 08:00 已过 → 明天 08:00', T.computeNextRun({ mode: 'daily', time: '08:00' }, d2) === new Date('2026-11-11T08:00:00+08:00').getTime());
const d3 = new Date('2026-11-10T08:00:00+08:00').getTime();
ok('every3days 基准 11-10 08:00 → 11-13 08:00', T.computeNextRun({ mode: 'every3days', time: '08:00' }, d3) === new Date('2026-11-13T08:00:00+08:00').getTime());
ok('weekly 基准 11-10 08:00 → 11-17 08:00', T.computeNextRun({ mode: 'weekly', time: '08:00' }, d3) === new Date('2026-11-17T08:00:00+08:00').getTime());
ok('monthly 基准 11-10 08:00 → 12-10 08:00', T.computeNextRun({ mode: 'monthly', time: '08:00' }, d3) === new Date('2026-12-10T08:00:00+08:00').getTime());
const d4 = new Date('2027-01-31T09:00:00+08:00').getTime();
const mNext = new Date(T.computeNextRun({ mode: 'monthly', time: '08:00' }, d4));
ok('monthly 月末 clamp（1-31 → 2 月末）', mNext.getMonth() === 1 && mNext.getDate() >= 28);
ok('parseTime 非法 → 08:00 兜底', JSON.stringify(T.parseTime('xx')) === JSON.stringify({ hh: 8, mm: 0 }));
ok('parseTime 25:99 → clamp 23:59', JSON.stringify(T.parseTime('25:99')) === JSON.stringify({ hh: 23, mm: 59 }));
const f1 = T.computeFirstRun({ time: '08:00' }, new Date('2026-11-10T06:00:00+08:00').getTime());
ok('首次启用未到点 → 今天', f1 === new Date('2026-11-10T08:00:00+08:00').getTime());
const f2 = T.computeFirstRun({ time: '08:00' }, new Date('2026-11-10T10:00:00+08:00').getTime());
ok('首次启用已过点 → 明天', f2 === new Date('2026-11-11T08:00:00+08:00').getTime());

/* ---------- ② 解析器（真实结构样例：键|模型列 + 价格档位×时段 + 共享单元格） ---------- */
const SAMPLE = '<table>' +
  '<tr><td>模型</td><td>deepseek-flash(1)</td><td>deepseek-v4-pro</td></tr>' +
  '<tr><td>上下文长度</td><td>1M</td></tr>' +
  '<tr><td>输出长度</td><td>最大 384K</td></tr>' +
  '<tr><td>价格</td><td>百万tokens输入（缓存命中）</td><td>空闲时段</td><td>0.02元</td><td>0.15元</td></tr>' +
  '<tr><td>高峰时段</td><td>0.04元</td><td>0.30元</td></tr>' +
  '<tr><td>百万tokens输入（缓存未命中）</td><td>空闲时段</td><td>1元</td><td>4.5元</td></tr>' +
  '<tr><td>高峰时段</td><td>2元</td><td>9.0元</td></tr>' +
  '<tr><td>百万tokens输出</td><td>空闲时段</td><td>4元</td><td>13.5元</td></tr>' +
  '<tr><td>高峰时段</td><td>8元</td><td>27.0元</td></tr>' +
  '<tr><td>并发限制(3)</td><td>2500</td><td>500</td></tr>' +
  '</table>' +
  '<table><tr><td>API</td><td>计费单位</td><td>价格</td></tr><tr><td>Search</td><td>每 1,000 次</td><td>5元</td></tr></table>' +
  /* task307：DS 全家桶 API 能力价目表（TTS/ASR 四列含限时折扣；OCR 三列） */
  '<table><tr><td>项目</td><td>计费单位</td><td>价格</td></tr><tr><td>文件解析 、 OCR API</td><td>每 1,000 页</td><td>1.5元</td></tr></table>' +
  '<table><tr><td>API</td><td>计费单位</td><td>刊例价</td><td>限时折扣价（5 折）</td></tr>' +
  '<tr><td>语音合成（TTS）</td><td>每 10,000 字符</td><td>3元</td><td>1.5元</td></tr>' +
  '<tr><td>语音识别（ASR）</td><td>每小时音频</td><td>0.78元</td><td>0.39元</td></tr></table>';
let P = null;
try { P = mp._test.parseDeepSeek(SAMPLE, 'https://example.test/pricing') } catch (e) { ok('解析不抛错', false, e.message) }
if (P) {
  ok('解析模型数=5（2 对话模型 + task307 TTS/ASR/OCR 能力行）', P.models.length === 5);
  ok('模型名去角标', P.models[0].name === 'deepseek-flash' && P.models[1].name === 'deepseek-v4-pro');
  ok('共享单元格：上下文 1M 两模型都有', P.models[0].contextText === '1M' && P.models[1].contextText === '1M');
  ok('共享单元格：输出长度', P.models[1].maxOutputText === '最大 384K');
  ok('价格 inputHit offpeak/peak', P.models[0].price.inputHit.offpeak === 0.02 && P.models[1].price.inputHit.peak === 0.3);
  ok('价格 inputMiss', P.models[0].price.inputMiss.offpeak === 1 && P.models[1].price.inputMiss.peak === 9);
  ok('价格 output', P.models[0].price.output.offpeak === 4 && P.models[1].price.output.peak === 27);
  ok('并发限制分列', P.models[0].limits.concurrency === '2500' && P.models[1].limits.concurrency === '500');
  ok('integration 已接入（硬编码映射）', P.integration.linked === true && P.integration.providerKey === 'deepseek');
  ok('对话模型 category=text（能力行见 task307 组断言）', P.models.slice(0, 2).every(function (m) { return m.category === 'text' }));
  ok('extras 收录 Search', P.extras.length === 4 && P.extras[0].api === 'Search');
  /* task307：能力价 → 比价行（主人定规「所有模型都要进比价」） */
  const mTTS = P.models.filter(function (m) { return /^DeepSeek TTS/.test(m.name) })[0];
  const mASR = P.models.filter(function (m) { return /^DeepSeek ASR/.test(m.name) })[0];
  const mOCR = P.models.filter(function (m) { return /^DeepSeek OCR/.test(m.name) })[0];
  ok('TTS 进比价行（audio 类·output 3 元/万字·unit 标签）', !!(mTTS && mTTS.category === 'audio' && mTTS.price.output.offpeak === 3 && mTTS.price.output.peak === 3 && mTTS.price.unit === '每10,000字符'));
  ok('TTS 限时折扣写备注列（task345：上下文列不混介绍）', !!(mTTS && /限时 5 折 1\.5 元\/万字/.test(mTTS.note) && mTTS.contextText === ''));
  ok('ASR 进比价行（audio 类·0.78 元/小时·折扣 0.39 写备注）', !!(mASR && mASR.category === 'audio' && mASR.price.output.peak === 0.78 && /限时 5 折 0\.39 元\/小时/.test(mASR.note) && mASR.contextText === ''));
  ok('OCR 进比价行（image 类·1.5 元/千页·介绍写备注）', !!(mOCR && mOCR.category === 'image' && mOCR.price.output.peak === 1.5 && /图文混排/.test(mOCR.note) && mOCR.contextText === ''));
  ok('能力行 name 带中文括注（UI 拆灰标签）', !!(mTTS && /（语音合成）/.test(mTTS.name)));
  ok('无表格 HTML 抛错', (function () { try { mp._test.parseDeepSeek('<div>nothing</div>'); return false } catch (e) { return true } })());
}

/* ---------- ②b task281：zhipu 按量源退役零残留（parseZhipu 已撤，防复发断言） ---------- */
ok('parseZhipu 已退役（_test 无此键）', mp._test.parseZhipu === undefined);
ok('DEFAULTS 无 zhipu 源（deepseek/zhipu-plan/volc-ark 三源口径，task303）', mp.defaults.sources.every(function (s) { return s.id !== 'zhipu' }) && mp.defaults.sources.length === 3);
ok('退役终扫：源码无 parseZhipu 函数定义', (function () {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'skills', 'model-pricing.js'), 'utf8');
  return /function parseZhipu\s*\(/.test(src) === false;
})());
/* ---------- ②d task348：接入状态读时自愈（主人目检「火山 Key 已录仍显未接入」） ---------- */
const IOF = mp._test.integrationOf;
ok('task348: integrationOf 三家映射（DeepSeek/GLM/火山）', !!(IOF({ provider: 'DeepSeek 官方' }).providerKey === 'deepseek' && IOF({ provider: 'GLM Token Plan' }).providerKey === 'zhipuai-coding-plan' && IOF({ provider: '火山方舟（火山引擎）' }).providerKey === 'volcengine'));
ok('task348: 火山 integration.linked=true（Key 已接入·serve provider 在册）', !!(IOF({ provider: '火山方舟（火山引擎）' }).linked === true));
ok('task348: 未知供应商 integrationOf 返回 null 不误判', mp._test.integrationOf({ provider: '某野供应商' }) === null && mp._test.integrationOf(null) === null);
(function () {
  const dir = path.dirname(mp._test.LATEST);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(mp._test.LATEST, JSON.stringify({ updatedAt: '2026-11-16T00:00:00.000Z', providers: [
      { provider: 'DeepSeek 官方', integration: { linked: false, providerKey: '', note: '旧' }, models: [] },
      { provider: 'GLM Token Plan', integration: { linked: false, providerKey: '', note: '旧' }, models: [] },
      { provider: '火山方舟（火山引擎）', integration: { linked: false, providerKey: '', note: '未接入（旧缓存）' }, models: [] }
    ] }));
    const d = mp.readLatest();
    ok('task348: readLatest 以当前映射覆盖旧缓存（火山 linked=true）', !!(d && d.providers[2].integration.linked === true && d.providers[2].integration.providerKey === 'volcengine'));
    ok('task348: readLatest 不动业务字段（provider 名/updatedAt 原样）', !!(d && d.providers[2].provider === '火山方舟（火山引擎）' && d.updatedAt === '2026-11-16T00:00:00.000Z'));
  } catch (e) {
    ok('task348: 读时自愈夹具可写', false, e.message);
  } finally {
    try { fs.rmSync(mp._test.LATEST, { force: true }) } catch (e) {}
  }
})();
/* ---------- ②c parseZhipuPlan（task207：Coding Plan 抵扣系数表=HTML table 含 rowSpan，按产品名锚定） ---------- */
const SAMPLE_ZPP = '<p>doc</p><table>' +
  '<thead><tr><th>产品类型</th><th>产品名称</th><th>Input 抵扣系数</th><th>Cached Input 抵扣系数</th><th>Output 抵扣系数</th></tr></thead>' +
  '<tbody>' +
  '<tr><td rowSpan="2">模型</td><td>GLM-5.3</td><td>6.9</td><td>1.7</td><td>24</td></tr>' +
  '<tr><td>GLM-5.3-Flash（含视觉理解 MCP）</td><td>2.3</td><td>0.56</td><td>8</td></tr>' +
  '<tr><td rowSpan="3">MCP 工具</td><td>联网搜索</td><td>—</td><td>—</td><td>1.2</td></tr>' +
  '<tr><td>网页读取</td><td>—</td><td>—</td><td>1.2</td></tr>' +
  '<tr><td>开源仓库</td><td>—</td><td>—</td><td>1.2</td></tr>' +
  '</tbody></table>';
let ZPP = null;
try { ZPP = mp._test.parseZhipuPlan(SAMPLE_ZPP, 'https://example.test/zp-plan') } catch (e) { ok('tokenplan 解析不抛错', false, e.message) }
if (ZPP) {
  ok('tokenplan 模型数=2（MCP 行不进）', ZPP.models.length === 2 && ZPP.models.every(function (m) { return /^GLM-/.test(m.name) }));
  ok('tokenplan providerKey=zhipuai-coding-plan 且已接入', ZPP.providerKey === 'zhipuai-coding-plan' && ZPP.integration.linked === true);
  ok('tokenplan 系数→积分区间 5 折（6.9→3.45~6.9 / 1.7→0.85~1.7 / 24→12~24）',
    ZPP.models[0].price.inputMiss.offpeak === 3.45 && ZPP.models[0].price.inputMiss.peak === 6.9 &&
    ZPP.models[0].price.inputHit.offpeak === 0.85 && ZPP.models[0].price.inputHit.peak === 1.7 &&
    ZPP.models[0].price.output.offpeak === 12 && ZPP.models[0].price.output.peak === 24);
  ok('tokenplan rowSpan 错位免疫（Flash 行 4 格仍解析）', ZPP.models[1].price.inputMiss.offpeak === 1.15 && ZPP.models[1].price.output.peak === 8);
  ok('tokenplan price.unit=积分 且上下文=1M', ZPP.models[0].price.unit === '积分' && /1M/.test(ZPP.models[0].contextText));
  ok('tokenplan note 含档位与 92% 口径', /92%/.test(ZPP.note) && /Pro/.test(ZPP.note) && /Lite/.test(ZPP.note));
  ok('tokenplan 无表格抛错', (function () { try { mp._test.parseZhipuPlan('no table'); return false } catch (e) { return true } })());
  ok('tokenplan 无系数表头抛错', (function () { try { mp._test.parseZhipuPlan('<table><tr><td>a</td><td>b</td></tr></table>'); return false } catch (e) { return true } })());
}

/* ---------- ②d task303：parseVolcArk（火山方舟 ace-table · 值推进算法 + 时段合并 + 常规表唯一） ----------
   fixture 合成（L-093：禁真实数据），覆盖真实页面全部结构坑：
   sticky 副本(aria-hidden)/空占位续行/无占位续行/rowspan/空闲高峰行(先普通行/首现新建)/不适用旧价/全角表头/批量表不收 */
const SAMPLE_VA = (function () {
  const td = function (v, rs) { return '<td' + (rs ? ' rowspan="' + rs + '"' : '') + '>' + v + '</td>' };
  const tr = function () { return '<tr>' + Array.prototype.join.call(arguments, '') + '</tr>' };
  const stickyCopy = '<table aria-hidden="true" class="ace-table volc-doceditor-table-sticky-header-table">' +
    tr(td('模型名称​'), td('条件​K token'), td('输入(非音频)​元/M token'), td('输出​元/M token')) +
    tr(td('doubao-x'), td('-'), td('999'), td('999')) + '</table>'; /* 副本行：若被收录则条目×2 转红 */
  const regular = '<table class="ace-table volc-doceditor-table-mode-list">' +
    tr(td('模型名称​'), td('条件​输入长度：K token​'), td('输入(非音频)​元/M token​'), td('输入(音频)​元/M token​'), td('缓存存储​元/M token/小时​'), td('缓存命中(非音频)​元/M token​'), td('输出​元/M token​')) +
    tr(td('doubao-seed-2.0-pro', 3), td('输入长度 [0, 32]​'), td('3.2'), td('-'), td('0.017'), td('0.64'), td('16.0')) +
    tr(td(''), td('输入长度 (32, 128]​'), td('4.8'), td('-'), td('0.017'), td('0.96'), td('24.0')) + /* 空占位续行（rowspan+空td 双保险形态） */
    tr(td('输入长度 (128, 256]​'), td('9.6'), td('-'), td('0.017'), td('1.92'), td('48.0')) + /* 无占位续行（首格即条件） */
    tr(td('glm-5.3-flash'), td('-'), td('0.80'), td('-'), td('0.017'), td('0.23'), td('2.80')) +
    tr(td('deepseek-v4-1-flash'), td('空闲时段'), td('1.00'), td('-'), td('0.017'), td('0.02'), td('4.00')) +
    tr(td(''), td('高峰时段'), td('2.00'), td('-'), td('0.017'), td('0.04'), td('8.00')) + /* 时段行跟在普通名行后 → 合并进同条目 */
    tr(td('kimi-k3.1-pro'), td('空闲时段'), td('13.00'), td('-'), td('0.017'), td('1.30'), td('68.00')) + /* 时段行首现（无前置普通行）→ 新建条目 */
    tr(td(''), td('高峰时段'), td('26.00'), td('-'), td('0.017'), td('2.60'), td('136.00')) +
    tr(td('old-model调整前价格，2026-08-21 起不适用'), td('-'), td('1.00'), td('-'), td('-'), td('-'), td('2.00')) + /* 旧价行过滤 */
    '</table>';
  const batch = '<table class="ace-table volc-doceditor-table-mode-list">' + /* 全角表头批量推理表（页面顺序在后，不得被收） */
    tr(td('模型名称'), td('条件K token'), td('输入（非音频）元/M token'), td('输入（音频）元/M token'), td('缓存命中（非音频）元/M token'), td('输出元/M token')) +
    tr(td('doubao-seed-2.0-pro'), td('输入长度 [0, 32]'), td('1.6'), td('-'), td('0.32'), td('8.00')) +
    '</table>';
  return stickyCopy + regular + batch;
})();
let VA = null;
try { VA = mp._test.parseVolcArk(SAMPLE_VA, 'https://example.test/volc') } catch (e) { ok('volc 解析不抛错', false, e.message) }
if (VA) {
  const byName = function (n) { return VA.models.filter(function (m) { return m.name === n }) };
  ok('volc 副本行未收录（aria-hidden 排除）', byName('doubao-x').length === 0);
  ok('volc 条目数=6（pro 三档 + glm + ds + kimi，旧价行滤掉）', VA.models.length === 6, JSON.stringify(VA.models.map(function (m) { return m.name })));
  ok('volc 空占位续行回溯（pro 三档齐全）', (function () { const p = byName('doubao-seed-2.0-pro'); return p.length === 3 && p[0].contextText === '输入长度 [0, 32]' && p[1].contextText === '输入长度 (32, 128]' && p[2].contextText === '输入长度 (128, 256]' })());
  ok('volc 无占位续行取值（(128,256] in=9.6）', byName('doubao-seed-2.0-pro')[2].price.inputMiss.offpeak === 9.6);
  ok('volc rowspan 首行取值（[0,32] hit=0.64）', byName('doubao-seed-2.0-pro')[0].price.inputHit.offpeak === 0.64);
  ok('volc "−" 条件 → contextText 空', byName('glm-5.3-flash')[0].contextText === '');
  ok('volc 零宽字符清洗（模型名无 U+200B）', VA.models.every(function (m) { return m.name.indexOf('\u200B') < 0 }));
  ok('volc 时段行合并进普通条目（ds 1~2 / 4~8）', (function () { const d = byName('deepseek-v4-1-flash')[0]; return d.price.inputMiss.offpeak === 1 && d.price.inputMiss.peak === 2 && d.price.output.offpeak === 4 && d.price.output.peak === 8 })());
  ok('volc 时段行首现新建条目（kimi 13~26）', (function () { const k = byName('kimi-k3.1-pro')[0]; return k.price.inputMiss.offpeak === 13 && k.price.inputMiss.peak === 26 && k.contextText === '' })());
  ok('volc 「不适用」旧价行过滤', byName('old-model调整前价格，2026-08-21 起不适用').length === 0);
  ok('volc 只收常规表（批量推理全角表头表不收，pro 无第 4 档 1.6）', byName('doubao-seed-2.0-pro').every(function (m) { return m.price.inputMiss.offpeak !== 1.6 }));
  ok('volc 无分时段模型 offpeak=peak（glm 单值 0.8）', byName('glm-5.3-flash')[0].price.inputMiss.offpeak === 0.8 && byName('glm-5.3-flash')[0].price.inputMiss.peak === 0.8);
  ok('volc provider/providerKey/已接入口径（task348：Key+serve provider 就位）', VA.provider === '火山方舟（火山引擎）' && VA.providerKey === 'volc-ark' && VA.integration.linked === true && VA.integration.providerKey === 'volcengine');
  ok('volc note 含口径说明（常规/分档/时段）', /常规/.test(VA.note) && /分档/.test(VA.note) && /时段/.test(VA.note));
  ok('volc extras 收录缓存存储', VA.extras.length === 1 && VA.extras[0].api === '缓存存储');
  ok('volc 无表格抛错', (function () { try { mp._test.parseVolcArk('<div>nothing</div>'); return false } catch (e) { return true } })());
  ok('volc 无定价表头抛错', (function () { try { mp._test.parseVolcArk('<table><tr><td>模型</td><td>a</td></tr></table>'); return false } catch (e) { return true } })());
  /* task307：源级 headers + 瘦版免疫轮抓（火山 CDN 边缘随机回 0 表格瘦版——本地服务器模拟：首轮瘦版二轮完整版，fetchDoc 应轮抓到完整版） */
  (function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'skills', 'model-pricing.js'), 'utf8')
    ok('task307 HEADER_SETS：浏览器头集 + volc-ark 三轮计划（CDN 瘦版免疫）', /'volc-ark': \['browser', null, 'browser'\]/.test(src) && /function fetchDoc/.test(src) && /fetchDoc\(src\.url, 25000, src\.id\)/.test(src))
    let hits = 0
    const probe = require('http').createServer(function (q, r) {
      hits++
      const thin = hits === 1 /* 首轮瘦版（0 表格） */
      r.writeHead(200, { 'Content-Type': 'text/html' })
      r.end(thin ? '<html><body>thin client-render</body></html>' : '<table><tr><td>模型名称</td><td>条件</td><td>输入(非音频)元/M</td><td>输出元/M</td></tr><tr><td>doubao-x</td><td>-</td><td>1</td><td>2</td></tr></table>')
    })
    probe.listen(0, '127.0.0.1', function () {
      mp._test.fetchDoc('http://127.0.0.1:' + probe.address().port + '/x', 5000, 'volc-ark').then(function (body) {
        ok('task307 fetchDoc 首轮瘦版自动换头重抓（二轮拿完整表）', hits === 2 && /doubao-x/.test(body))
        probe.close()
      }, function (e) { ok('task307 fetchDoc 轮抓', false, e.message); probe.close() })
    })
    const seen = []
    const probe2 = require('http').createServer(function (q, r) {
      seen.push(String(q.headers['user-agent'] || ''))
      r.writeHead(200); r.end('<table><tr><td>模型名称</td><td>x</td></tr></table>')
    })
    probe2.listen(0, '127.0.0.1', function () {
      mp._test.fetchText('http://127.0.0.1:' + probe2.address().port + '/y', 5000, 0, { 'User-Agent': 'ua-override-test' }).then(function () {
        ok('task307 fetchText 第四参 headers 生效（服务器实收覆盖 UA）', seen.length === 1 && seen[0] === 'ua-override-test')
        probe2.close()
      }, function (e) { ok('task307 fetchText headers 生效', false, e.message); probe2.close() })
    })
  })()
  /* 红对照（源码锚，task281 ②b 风格）：空占位回溯 / 时段合并 / 副本排除三关键逻辑在源码必在——撤任一则上方行为断言转红 */
  ok('volc 源码逻辑锚（lastName 回溯/时段 slot/aria-hidden）', (function () {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'skills', 'model-pricing.js'), 'utf8');
    return /\|\| lastName/.test(src) && /'offpeak' : 'peak'/.test(src) && /aria-hidden="true"/.test(src);
  })());
}
/* migrateConfig：沙箱幂等迁移（含 task281 残留 zhipu 源退役自愈） */
(function () {
  const cfgFile = path.join(SANDBOX, 'config', 'skills.json');
  fs.mkdirSync(path.dirname(cfgFile), { recursive: true });
  fs.writeFileSync(cfgFile, JSON.stringify({ version: 1, skills: { 'model-pricing': { settings: { sources: [
    { id: 'deepseek', name: 'DeepSeek 官方', url: 'x', enabled: false, credential: {} },
    { id: 'zhipu', name: 'GLM 官方（智谱）', url: 'x', enabled: true, credential: {} } /* task281：存量残留，应被退役删除 */
  ], schedule: { mode: 'daily', time: '08:00', enabled: true } } } } }));
  ok('migrate 首跑成功', mp._test.migrateConfig() === true);
  let cfg2 = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const zs = cfg2.skills['model-pricing'].settings.sources;
  ok('task281 残留 zhipu 源被退役删除', zs.every(function (s) { return s.id !== 'zhipu' }));
  ok('migrate 按 id 补齐 zhipu-plan + volc-ark（task207/303 · 三源口径）', zs.length === 3 && zs[1].id === 'zhipu-plan' && zs[1].enabled === true && zs[2].id === 'volc-ark' && zs[2].enabled === true);
  ok('migrate 不动既有源（保留禁用语义）', zs[0].id === 'deepseek' && zs[0].enabled === false);
  ok('migrate 幂等', mp._test.migrateConfig() === true && JSON.parse(fs.readFileSync(cfgFile, 'utf8')).skills['model-pricing'].settings.sources.length === 3);
})();

/* ---------- ③ tick 行为（沙箱） ---------- */
let ran = 0;
scheduler.register({ id: 'fake', name: '假 skill', defaults: { schedule: { mode: 'daily', time: '08:00', enabled: true } }, run: async function () { ran++; return { ok: true, count: 1 } } });
T.setCfgForTest({ version: 1, skills: {} });
const cfg0 = T.getCfg();
scheduler.tick(Date.now());
const st0 = cfg0.skills.fake.state;
ok('tick 首次填 nextRunAt', st0.nextRunAt > Date.now());
// 手动设到期 → tick 触发
st0.nextRunAt = Date.now() - 1000;
scheduler.tick(Date.now());
setTimeout(function () {
  ok('到期 tick 触发 run', ran === 1, 'ran=' + ran);
  const st1 = cfg0.skills.fake.state;
  ok('运行后 nextRunAt 落在未来', st1.nextRunAt > Date.now());
  ok('lastResult 记录 ok/count', st1.lastResult && st1.lastResult.ok === true && st1.lastResult.count === 1);
  // 禁用不触发
  cfg0.skills.fake.settings.schedule.enabled = false;
  st1.nextRunAt = Date.now() - 1000;
  scheduler.tick(Date.now());
  setTimeout(function () {
    ok('禁用后不触发', ran === 1, 'ran=' + ran);
    // running 互斥
    const st2 = cfg0.skills.fake.state;
    st2.running = true;
    cfg0.skills.fake.settings.schedule.enabled = true;
    st2.nextRunAt = Date.now() - 1000;
    scheduler.tick(Date.now());
    setTimeout(function () {
      ok('running 中不重入', ran === 1, 'ran=' + ran);
      st2.running = false;
      // 失败注入 → 日志白名单
      scheduler.register({ id: 'badskill', name: '坏 skill', defaults: { schedule: { mode: 'daily', time: '08:00', enabled: true }, secret: { pass: 'SUPER_SECRET_PASSWORD' } }, run: async function () { throw new Error('boom ' + 'x'.repeat(400)) } });
      const b = scheduler.listSkills().filter(function (x) { return x.id === 'badskill' })[0];
      ok('listSkills 掩码凭据（无明文）', JSON.stringify(b.settings).indexOf('SUPER_SECRET_PASSWORD') >= 0 ? false : true);
      scheduler.runNow('badskill');
      setTimeout(function () {
        const logFile = path.join(SANDBOX, 'logs', 'skills.jsonl');
        const logText = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
        ok('日志已写', logText.length > 0);
        ok('日志不含凭据明文', logText.indexOf('SUPER_SECRET_PASSWORD') < 0);
        ok('日志错误截断≤300', (function () {
          const lines = logText.trim().split('\n');
          const last = JSON.parse(lines[lines.length - 1]);
          return String(last.error || '').length <= 300 && last.ok === false;
        })());
        // stop/start 幂等
        let threw = false;
        try { scheduler.start(); scheduler.stop(); scheduler.stop() } catch (e) { threw = true }
        ok('start/stop 幂等不抛错', !threw);
        // 产出审 P1-1 回归锚：进程死亡残留 running:true → start() 必须复位
        T.getCfg().skills.fake.state.running = true;
        T.getCfg().skills.fake.state.runningSince = Date.now();
        scheduler.start();
        const st4 = T.getCfg().skills.fake.state;
        ok('start 复位残留 running（P1-1）', st4.running === false && st4.runningSince === 0);
        scheduler.stop();
        // 产出审 P1-2 回归锚：环形重定向 5 跳上限（本地 302 环）
        const httpSrv = require('http').createServer(function (q, r) {
          r.writeHead(302, { Location: q.url === '/a' ? '/b' : '/a' }); r.end();
        });
        httpSrv.listen(0, '127.0.0.1', function () {
          const prt = httpSrv.address().port;
          mp._test.fetchText('http://127.0.0.1:' + prt + '/a', 5000).then(function () {
            ok('重定向上限（P1-2）', false, '应当报错却成功');
            httpSrv.close(); e2e();
          }, function (e) {
            ok('重定向上限（P1-2）', /重定向超过 5 跳/.test(String(e && e.message)), String(e && e.message));
            httpSrv.close(); e2e();
          });
        });
      }, 400);
    }, 150);
  }, 150);
}, 300);

/* ---------- ⑤ E2E：隔离实例（沙箱 ROOT + 随机端口，只读 GET + 401） ---------- */
function e2e () {
  const port = 4110 + Math.floor(Math.random() * 40);
  const env = Object.assign({}, process.env, { LITTLEDJ_PORT: String(port), LITTLEDJ_ROOT: SANDBOX });
  // L-093（task298 教训）：沙箱凭据一律合成串，禁复制生产 auth.txt（旧版 copyFileSync 已撤）
  const sandboxAuth = 'littledj-test:littledj-test';
  try {
    fs.mkdirSync(path.join(SANDBOX, 'config'), { recursive: true });
    fs.writeFileSync(path.join(SANDBOX, 'config', 'auth.txt'), sandboxAuth + '\n');
  } catch (e) {}
  const child = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: env, stdio: 'ignore' });
  let done = false;
  const finish = function (code) {
    if (done) return; done = true;
    try { child.kill() } catch (e) {}
    report(code);
  };
  const auth = (function () {
    try { return Buffer.from(fs.readFileSync(path.join(SANDBOX, 'config', 'auth.txt'), 'utf8').trim()).toString('base64') } catch (e) { return '' }
  })();
  setTimeout(function () {
    const get = function (p, cb) {
      http.get({ host: '127.0.0.1', port: port, path: p, headers: auth ? { Authorization: 'Basic ' + auth } : {} }, function (res) {
        let b = ''; res.on('data', function (c) { b += c }); res.on('end', function () { cb(null, res.statusCode, b) });
      }).on('error', function (e) { cb(e) });
    };
    get('/_skills', function (err, code, body) {
      if (err) { ok('E2E /_skills 可达', false, err.message); return finish(1) }
      ok('E2E /_skills 200', code === 200);
      try {
        const d = JSON.parse(body);
        ok('E2E /_skills 返回 model-pricing', (d.skills || []).some(function (s) { return s.id === 'model-pricing' }));
        ok('E2E /_skills 结构含 schedule/nextRunAt', !!(d.skills && d.skills[0] && d.skills[0].schedule && d.skills[0].nextRunAt !== undefined));
      } catch (e) { ok('E2E /_skills JSON', false, e.message) }
      get('/_pricing', function (err2, code2) {
        if (err2) { ok('E2E /_pricing 可达', false, err2.message); return finish(1) }
        ok('E2E /_pricing 无数据 404', code2 === 404);
        // 无鉴权 401
        http.get({ host: '127.0.0.1', port: port, path: '/_skills' }, function (res) {
          ok('E2E 无鉴权 401', res.statusCode === 401);
          res.resume();
          finish(out.fail ? 1 : 0);
        }).on('error', function (e) { ok('E2E 401 探测', false, e.message); finish(1) });
      });
    });
  }, 1800);
}

function report (code) {
  if (process.argv.indexOf('--json') >= 0) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    out.items.forEach(function (it) {
      console.log((it.ok ? 'PASS' : 'FAIL') + '  ' + it.name + (it.ok ? '' : '   [' + it.detail + ']'));
    });
    console.log('\n' + out.pass + ' pass / ' + out.fail + ' fail');
  }
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch (e) {}
  process.exit(code || (out.fail ? 1 : 0));
}

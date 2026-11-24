/* task386 自测：右上角「额度」面板 = djh 同款全量积分板（DJH 快照 config/score-snapshot.json 只读消费）。
   需求（主人 2026-11-19）：「你去看 djh 的右上角的积分 她很全的，你能否抄袭他 把他的这些积分里面的内容 api key 什么的都弄进来 呢 和 djh 一样」。
   覆盖：A 快照全字段渲染 12 条 + B 实时接口优先 3 条 + C 无数据兜底 3 条 + D 当前模型计费口径 3 条 + E 轮询/端点静态锚 4 条。
   用法：node deploy/selftest-score-panel.js   （EXIT=0 全绿） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'ui/src/sys/status.js'), 'utf8');
const TODO = fs.readFileSync(path.join(ROOT, 'ui/src/sys/todo.js'), 'utf8');
const PROXY = fs.readFileSync(path.join(ROOT, 'server/proxy.js'), 'utf8');
let pass = 0, fail = 0;
function t(name, cond, detail){
  if (cond){ pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + (detail ? ' :: ' + detail : '')); }
}

function mkEl(tag, cls, text){
  const node = {
    tag: tag, className: cls || '', textContent: text == null ? '' : String(text), style: {}, children: [],
    appendChild: function (c){ this.children.push(c); return c }
  };
  return node;
}
function flat(n){
  let s = n.textContent ? String(n.textContent) : '';
  (n.children || []).forEach(function (c){ s += '|' + flat(c) });
  return s;
}

/* 完整快照 = 当前 config/score-snapshot.json 实测形状（2026-11-19 18:00 推送） */
const SNAP = {
  at: 1763544000000,
  ds: { ok: true, text: '￥88.88', currency: 'CNY', amount: 88.88 },
  glm: { ok: true, fiveHour: { percentage: 19.4 }, week: { percentage: 37.8 } },
  cloud: { accounts: { volc: { ok: true, balance: 12.34 }, tencent: { ok: true, balance: 56.78 }, aliyun: { ok: true, balance: 9.9 }, huawei: { ok: true, balance: 3.21 } } },
  cn: { ok: true, granted: true, amount: 30, balance: 368 },
  intl: { ok: true, granted: false, amount: 30, balance: 1000 },
  wb: { ok: true, checkedIn: true, streak: 8, totalCredits: 813.2, creditsTotal: 1200, dailyCredit: 100 },
  bz: { ok: true, balance: 466.1 },
  or: { ok: false, error: '缺少 OPENROUTER_API_KEY' },
  ms: { ok: true, granted: true, magicube: 0, earned: 250, today: [{ item: '注册并登录', state: '今日已完成', amount: 200 }] }
};

function run(opt){
  opt = opt || {};
  const sandbox = {
    console: console,
    S: { balance: opt.balance || '', model: { providerID: opt.providerID || 'zhipuai-coding-plan' } },
    el: mkEl,
    window: {},
    document: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC + '\n;this.__fn = { sysPanelQuo: sysPanelQuo, modelBilling: modelBilling, SYS: SYS, sysScoreAmt: sysScoreAmt };', sandbox);
  const fn = sandbox.__fn;
  fn.SYS.scr = (opt.scr === undefined ? SNAP : opt.scr);
  fn.SYS.scrErr = opt.scrErr || '';
  fn.SYS.quotaOk = !!opt.quotaOk;
  fn.SYS.zp5 = opt.zp5 || '';
  fn.SYS.zpW = opt.zpW || '';
  const p = mkEl('div');
  fn.sysPanelQuo(p);
  return { text: flat(p), bk: fn.modelBilling(), amt: fn.sysScoreAmt };
}

console.log('A. 快照全字段渲染（djh 同款 11 项）');
var a = run({});
t('A1 DeepSeek 余额 ￥ 88.88', /DeepSeek 余额\|￥ 88\.88/.test(a.text), a.text);
t('A2 GLM 5 小时 19.4%', /GLM 5 小时\|19\.4%/.test(a.text), a.text);
t('A3 GLM 本周 37.8%', /GLM 本周\|37\.8%/.test(a.text), a.text);
t('A4 火山方舟 ￥ 12.34', /火山方舟\|￥ 12\.34/.test(a.text), a.text);
t('A5 腾讯云 ￥ 56.78', /腾讯云\|￥ 56\.78/.test(a.text), a.text);
t('A6 阿里云 ￥ 9.90', /阿里云\|￥ 9\.90/.test(a.text), a.text);
t('A7 华为云 ￥ 3.21', /华为云\|￥ 3\.21/.test(a.text), a.text);
t('A8 RH 中国站 积分 368.00 + 已领 30', /RH 中国站\|积分 368\.00/.test(a.text) && /☑ 已领 30 分/.test(a.text), a.text);
t('A9 RH 海外站 积分 1000.00 + 未领 30', /RH 海外站\|积分 1000\.00/.test(a.text) && /☐ 未领 30 分/.test(a.text), a.text);
t('A10 WorkBuddy 连签 8 天 + 积分 813.20 + 已领 100', /WorkBuddy（连签 8 天）\|积分 813\.20/.test(a.text) && /☑ 已领 100 分/.test(a.text), a.text);
t('A11 BreezeBlue 积分 466.10', /BreezeBlue\|积分 466\.10/.test(a.text), a.text);
t('A11b OpenRouter 无 Key → 「—」', /OpenRouter\|—/.test(a.text), a.text);
t('A11c 魔搭 =「今日已完成 · 魔粒 0.00」+ ☑ 已领', /魔搭 ModelScope\|今日已完成 · 魔粒 0\.00/.test(a.text) && /☑ 已领/.test(a.text), a.text);
t('A12 快照同步时间标注=YYYY-MM-DD HH:MM', /快照同步 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(a.text), a.text);
t('A12b 2025 年旧快照 → 显式「已过期」+等源恢复提示（task386-fu3）', /已过期 .*（DJH 推送中断，等源恢复；DS\/GLM 为实时）/.test(a.text), a.text);
var fresh = run({ scr: Object.assign({}, SNAP, { at: Date.now() }) });
t('A12c 新鲜快照 → 不显示「已过期」', fresh.text.indexOf('已过期') < 0, fresh.text);
var liveRun = run({ scr: Object.assign({}, SNAP, { at: Date.now(), source: 'djh-live' }) });
t('A12d source=djh-live → 「实时 · DJH 同步 HH:MM:SS」', /实时 · DJH 同步 \d{2}:\d{2}:\d{2}（60s 缓存）/.test(liveRun.text), liveRun.text);

console.log('B. 实时接口优先（DS 余额 / GLM 配额）');
var b = run({ balance: '¥ 273.57', quotaOk: true, zp5: '82', zpW: '56' });
t('B1 DeepSeek 用实时余额 ¥ 273.57', /DeepSeek 余额\|¥ 273\.57/.test(b.text), b.text);
t('B2 GLM 5 小时用实时 82%', /GLM 5 小时\|82%/.test(b.text), b.text);
t('B3 GLM 本周用实时 56%', /GLM 本周\|56%/.test(b.text), b.text);

console.log('C. 无数据兜底（不编数字、不吐旧「数据源缺失」）');
var c = run({ scr: null, scrErr: '数据还没同步' });
t('C1 各余额行全部「—」', /DeepSeek 余额\|—/.test(c.text) && /火山方舟\|—/.test(c.text) && /BreezeBlue\|—/.test(c.text), c.text);
t('C2 显示「积分快照：数据还没同步」', /积分快照：数据还没同步/.test(c.text), c.text);
t('C3 全文零「数据源缺失」旧文案', c.text.indexOf('数据源缺失') < 0, c.text);

console.log('D. 计费口径与胶囊文案（task386-fu1：面板删「当前模型计费」、胶囊「额度」→「积分」）');
var d1 = run({});
t('D1 面板零「当前模型计费」段', d1.text.indexOf('当前模型计费') < 0, d1.text);
t('D2 面板零「当前 Key」行', d1.text.indexOf('当前 Key') < 0, d1.text);
t('D3 modelBilling GLM amount 不再「数据源缺失」', d1.bk.amount.indexOf('数据源缺失') < 0 && d1.bk.kind === 'quota', JSON.stringify(d1.bk));
var d4 = run({ providerID: 'deepseek', balance: '' });
t('D4 DS 模型无实时余额 → 快照兜底「余额 ￥ 88.88」', d4.bk.kind === 'balance' && /88\.88/.test(d4.bk.brief), JSON.stringify(d4.bk));
const HTML = fs.readFileSync(path.join(ROOT, 'ui/index.html'), 'utf8');
t('D5 胶囊静态文案=「积分」二字（零数字，task386-fu2）', /id="sysPQuo"[^>]*title="积分：[^"]*">积分</.test(HTML) && !/id="sysPQuo"[^>]*>积分 [^<]/.test(HTML), '');
t('D6 status.js 胶囊拼装=「积分」（零金额/百分比）', SRC.indexOf("sysSetPill('#sysPQuo', '积分');") >= 0, '');

console.log('E. 轮询与端点静态锚');
t('E1 todo.js 慢轮询同节拍调用 sysFetchScore', TODO.indexOf('fetchBalance(); sysFetchQuota(); sysFetchScore();') >= 0, '');
t('E2 status.js 导出 sysFetchScore 挂 window', SRC.indexOf('window.sysFetchScore=sysFetchScore') >= 0, '');
t('E3 proxy.js /_score 端点存在且只读 GET', PROXY.indexOf("pn === '/_score' && req.method === 'GET'") >= 0, '');
t('E4 端点读 score-snapshot.json（禁写）', PROXY.indexOf("path.join(ROOT, 'config', 'score-snapshot.json')") >= 0, '');

console.log('---');
console.log(pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/* task374 自测：boot 注入按项目拆分（公共段 + 项目专属段）
   覆盖：
   ① 静态锚点：proxy.js 关键符号 / 3s 竞速预热 / API projects 字段 / 首前缀红线不变
   ② vm 纯函数：projectBootKey 消毒（.. 穿越/中文/空）+ projectBootText 三分支
      （已配置读文件 / 登记项目惰性生成模板 / 未登记空 text）+ injectBootText 组装
      （专属段拼装 / 首前缀「【开工三查（自动注入」红线 / 无目录只公共段 / 未配置短提示）
   ③ 配置面：boot.md 公共段去 littleDJ 专属化 + boot-projects/ 四项目专属段非空 */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PROXY = path.join(ROOT, 'server', 'proxy.js');
const RUNTIME_PROMPTS = path.join(require('../server/paths').ROOT, 'config', 'prompts');
const src = fs.readFileSync(PROXY, 'utf8');

const out = { pass: 0, fail: 0, items: [] };
function ok(name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}

/* ---------- ① 静态锚点 ---------- */
ok('A1 PROJECT_BOOT_DIR 定义', src.indexOf("const PROJECT_BOOT_DIR = path.join(PROMPTS_DIR, 'boot-projects')") >= 0);
ok('A2 核心函数在位', src.indexOf('function projectBootKey(') >= 0 && src.indexOf('function projectBootText(') >= 0 && src.indexOf('function sessionDirOf(') >= 0);
ok('A3 injectBootText 注入专属段', /injectBootText[\s\S]{0,900}项目专属段（/.test(src));
ok('A4 首前缀红线不变', src.indexOf("'【开工三查（自动注入 · 仅本会话首条 · 入口 PWA）】\\n' + boot") >= 0);
ok('A5 入口 3s 竞速预热', /Promise\.race\(\[\s*\n\s*new Promise\(function \(r\) \{ sessionDirOf/.test(src) && src.indexOf('setTimeout(r, 3000)') >= 0);
ok('A6 end 回调 async 化', src.indexOf('req.on(\'end\', async function () {') >= 0);
ok('A7 /_settings/prompts projects 字段', src.indexOf('const projBoots = listProjects().map') >= 0 && src.indexOf('projects: projBoots') >= 0);
ok('A8 task374 留痕注释', src.indexOf('task374：boot 注入按项目拆分') >= 0);
// P1-1（御审）：BOOT_SEED 与公共段同口径（含归属铁律、无 littleDJ 旧专属路径）
const seedSeg = (function () { const i = src.indexOf('const BOOT_SEED'); const j = src.indexOf('].join(\'\\n\')', i); return i >= 0 && j > i ? src.slice(i, j) : '' })();
ok('A9 BOOT_SEED 含归属铁律', seedSeg.indexOf('项目归属铁律') >= 0 && seedSeg.indexOf('禁止跨项目改文件') >= 0);
ok('A10 BOOT_SEED 无旧专属路径', seedSeg.indexOf('管家系') < 0 && seedSeg.indexOf('.taskqueue') < 0 && seedSeg.indexOf('版本号规范') < 0);
ok('A14 BOOT_SEED 无项目名字样', seedSeg.indexOf('littleDJ') < 0); // 二审 P2-2：种子与公共段零项目名残留
ok('A15 BOOT_SEED 专属红线优先级句', seedSeg.indexOf('项目专属红线见专属段') >= 0);
// P1-2/P2-5（御审）：listProjects 异常降级 + 模板 0600 建档
ok('A11 projectBootText 兜 listProjects 异常', /try \{\s*\n\s*proj = listProjects\(\)\.filter/.test(src));
ok('A12 模板写盘 mode 0o600', src.indexOf("fs.writeFileSync(file, text, { mode: 0o600 })") >= 0);
// P2-3（御审）：预热仅 boot-state 未标记会话
ok('A13 预热收窄 needDirWarm', src.indexOf('needDirWarm = !loadBootState()[sid]') >= 0);

/* ---------- ② vm 纯函数 ---------- */
// 顶层函数体切分：起点=「function <name>(」所在行，终点=下一个列 0 的 '}' 行
function grabFn(name) {
  const lines = src.split('\n');
  const start = lines.findIndex(function (l) { return l.indexOf('function ' + name + '(') === 0; });
  if (start < 0) return '';
  let depth = 0, began = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; began = true; }
      else if (ch === '}') depth--;
    }
    if (began && depth === 0 && /^}/.test(lines[i])) return lines.slice(start, i + 1).join('\n');
  }
  return '';
}
const fnKey = grabFn('projectBootKey');
const fnTemplate = grabFn('projectBootTemplate');
const fnText = grabFn('projectBootText');
const fnInject = grabFn('injectBootText');
ok('B0 函数体提取非空', !!(fnKey && fnTemplate && fnText && fnInject), [fnKey, fnTemplate, fnText, fnInject].map(function (s) { return s.length }).join('/'));

const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'littledj-bootproj-'));
const boxPrompts = path.join(tmp, 'prompts');
const projDir = path.join(boxPrompts, 'boot-projects');
fs.mkdirSync(projDir, { recursive: true });

const sandbox = {
  path: path, fs: fs, console: console,
  PROJECT_BOOT_DIR: projDir,
  PROJECT_BOOT_KEY_RE: /^[\w.\- ]{1,64}$|^[<>:"/\\|?*·\u4e00-\u9fff][\u4e00-\u9fff\w.\- ]{0,63}$/,
  PROMPTS_LOG: path.join(boxPrompts, 'changelog.md'),
  listProjects: function () { return [{ name: 'Bar', path: '/x/Bar' }, { name: 'DAG AI Chat', path: '/storage/Users/currentUser/project/DAG_AI_Chat' }]; }
};
vm.createContext(sandbox);
vm.runInContext(fnKey + '\n' + fnTemplate + '\n' + fnText + '\n' + fnInject, sandbox);
const S = sandbox;

// projectBootKey 消毒（path.basename 已归一化穿越段：'../etc'→'etc' 无穿越风险；纯 '..' 显式拒绝）
ok('B1 key 穿越归一与拒绝', S.projectBootKey('../etc') === 'etc' && S.projectBootKey('/a/..') === '' && S.projectBootKey('..') === '');
ok('B2 key 空与点拒绝', S.projectBootKey('') === '' && S.projectBootKey('.') === '');
ok('B3 key 英文目录', S.projectBootKey('/storage/Users/currentUser/project/DAG_AI_Chat') === 'DAG_AI_Chat');
ok('B4 key 中文目录', S.projectBootKey('/home/x/projects/日常') === '日常');
ok('B5 key 路径分隔拒绝', S.projectBootKey('/a/b/c') === 'c'); // basename 语义：取末段

// projectBootText 三分支
fs.writeFileSync(path.join(projDir, 'Foo.md'), '# 项目专属段：Foo（手工配置）\n\n- 内容');
const rFoo = S.projectBootText('/x/Foo');
ok('B6 已配置读文件', !!(rFoo && rFoo.text.indexOf('手工配置') >= 0 && rFoo.key === 'Foo'));
const rBar = S.projectBootText('/x/Bar');
const barFile = path.join(projDir, 'Bar.md');
ok('B7 登记项目惰性生成模板', !!(rBar && rBar.name === 'Bar' && rBar.text.indexOf('自动生成模板') >= 0 && fs.existsSync(barFile)), JSON.stringify({ name: rBar && rBar.name, file: fs.existsSync(barFile) }));
ok('B8 模板含归属默认规则', !!(rBar && rBar.text.indexOf('只做本项目任务') >= 0 && rBar.text.indexOf('/x/Bar') >= 0));
const rNope = S.projectBootText('/x/Nope');
ok('B9 未登记目录 text 空', !!(rNope && rNope.key === 'Nope' && rNope.text === '' && !fs.existsSync(path.join(projDir, 'Nope.md'))));
ok('B10 非法 key 返回 null', S.projectBootText('') === null);
// P1-2（御审）：listProjects 抛错 → 不抛出、按未登记降级 text=''（用无文件的 Nope 目录，确保真走 listProjects 分支）
S.listProjects = function () { throw new Error('boom') };
let threw = false, rBoom = null;
try { rBoom = S.projectBootText('/x/Nope') } catch (e) { threw = true }
ok('B17 listProjects 异常降级不抛', !threw && !!(rBoom && rBoom.key === 'Nope' && rBoom.text === '') && !fs.existsSync(path.join(projDir, 'Nope.md')));
S.listProjects = function () { return [{ name: 'Bar', path: '/x/Bar' }, { name: 'DAG AI Chat', path: '/storage/Users/currentUser/project/DAG_AI_Chat' }] };

// injectBootText 组装（stub 依赖）
S.readPrompt = function () { return '# 公共段（测试）'; };
S.peekHandoff = function () { return ''; };
S.bootLedgerText = S.bootBoardText = S.bootPatrolText = function () { return ''; };
S.sessionDirCache = new Map();
fs.writeFileSync(path.join(projDir, 'littleDJ.md'), '# 项目专属段：littleDJ（沙箱）\n\n- verText 规则占位');
S.sessionDirCache.set('ses_a', '/storage/Users/currentUser/project/littleDJ');
S.sessionDirCache.set('ses_b', '/x/Nope');
const injA = S.injectBootText([{ type: 'text', text: '你好' }], 'ses_a', '');
ok('B11 首条含专属段标记', injA.parts[0].text.indexOf('——— 项目专属段（littleDJ）———') >= 0);
ok('B12 首前缀红线（worldview 判据）', injA.parts[0].text.indexOf('【开工三查（自动注入') === 0);
ok('B13 公共段在前专属段在后', injA.parts[0].text.indexOf('公共段（测试）') < injA.parts[0].text.indexOf('项目专属段（littleDJ）'));
ok('B14 尾部分隔线保留', injA.parts[0].text.indexOf('——— 主人本轮消息 ———') >= 0);
const injNo = S.injectBootText([{ type: 'text', text: 'hi' }], 'ses_zz', '');
ok('B15 无目录只公共段', injNo.parts[0].text.indexOf('项目专属段') < 0 && injNo.parts[0].text.indexOf('公共段（测试）') >= 0);
const injB = S.injectBootText([{ type: 'text', text: 'hi' }], 'ses_b', '');
ok('B16 未配置短提示', injB.parts[0].text.indexOf('未配置') >= 0 && injB.parts[0].text.indexOf('/x/Nope') >= 0 && injB.parts[0].text.indexOf('boot-projects/Nope.md') >= 0);

/* ---------- ③ 配置面 ---------- */
const bootMd = fs.readFileSync(path.join(RUNTIME_PROMPTS, 'boot.md'), 'utf8');
ok('C1 公共段含归属铁律', bootMd.indexOf('项目归属铁律') >= 0);
ok('C2 公共段去 littleDJ 专属（版本号规范）', bootMd.indexOf('版本号规范.md') < 0);
ok('C3 公共段去 littleDJ 专属（push.sh）', bootMd.indexOf('push.sh') < 0);
ok('C4 公共段去 littleDJ 专属（管家系台账路径）', bootMd.indexOf('管家系') < 0);
const projFiles = ['littleDJ.md', 'DAG_AI_Chat.md', 'DJH.md', '日常.md'];
projFiles.forEach(function (f) {
  const t = fs.readFileSync(path.join(RUNTIME_PROMPTS, 'boot-projects', f), 'utf8');
  ok('C5 专属段非空 ' + f, !!t.trim());
});
ok('C6 littleDJ 段含 verText 规则', fs.readFileSync(path.join(RUNTIME_PROMPTS, 'boot-projects', 'littleDJ.md'), 'utf8').indexOf('verText') >= 0);
ok('C7 DAG 段指路 AGENTS.md', fs.readFileSync(path.join(RUNTIME_PROMPTS, 'boot-projects', 'DAG_AI_Chat.md'), 'utf8').indexOf('AGENTS.md') >= 0);
ok('C8 公共段零项目名残留（二审 P2-2）', bootMd.indexOf('littleDJ') < 0);
ok('C9 littleDJ 段含入口分流（PWA/TUI）', fs.readFileSync(path.join(RUNTIME_PROMPTS, 'boot-projects', 'littleDJ.md'), 'utf8').indexOf('PWA=派单不执行') >= 0);
// task375：worldview 公共化 + littleDJ 世界观走仓库根 AGENTS.md（serve 自动注入）+ DJH/日常专属段实写
const worldMd = fs.readFileSync(path.join(RUNTIME_PROMPTS, 'worldview.md'), 'utf8');
ok('C10 worldview 纯公共化（无管家系专属）', worldMd.indexOf('大管家') < 0 && worldMd.indexOf('push.sh') < 0 && worldMd.indexOf('DAG AI Chat 任何文件') < 0);
ok('C11 worldview 含通用骨架', worldMd.indexOf('各项目通用') >= 0 && worldMd.indexOf('项目专属规则优先于本段') >= 0);
const agentsMd = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8');
ok('C12 littleDJ AGENTS.md 世界观在位', agentsMd.indexOf('大管家铁律') >= 0 && agentsMd.indexOf('入口分流') >= 0 && agentsMd.indexOf('休息态') >= 0 && agentsMd.indexOf('交付四件套') >= 0);
const djhMd = fs.readFileSync(path.join(RUNTIME_PROMPTS, 'boot-projects', 'DJH.md'), 'utf8');
ok('C13 DJH 段含双 DJ 协作+环境事实（task375 御审 P1-1：正名 E:\\DJH）', djhMd.indexOf('gh-backup') >= 0 && djhMd.indexOf('claim') >= 0 && djhMd.indexOf('E:\\DJH') >= 0 && djhMd.indexOf('ssh') >= 0);
ok('C13b DJH 段操作性路径零旧名（唯一豁免=正名叙述句，二审 P2-4 增强：次数==1 且邻近「正名」）', (djhMd.match(/E:\\dsh/g) || []).length === 1 && djhMd.indexOf('E:\\dsh 正名') >= 0 && djhMd.indexOf('E:\\dsh\\') < 0);
ok('C13c DJH 段含保留例外+opencode 分工', djhMd.indexOf('变量名不改') >= 0 && djhMd.indexOf('opencode 只当打字机') >= 0 && djhMd.indexOf('小活不开 opencode') >= 0);
ok('C13d DJH 外网域名=djh（二审 P1-1：dj 为 littleDJ 域名禁入）', djhMd.indexOf('djh.example.com') >= 0 && djhMd.indexOf('dj.example.com') < 0);
const dailyMd = fs.readFileSync(path.join(RUNTIME_PROMPTS, 'boot-projects', '日常.md'), 'utf8');
ok('C14 日常段宽松模式+底线', dailyMd.indexOf('宽松') >= 0 && dailyMd.indexOf('免正式工程流程') >= 0 && dailyMd.indexOf('别的项目') >= 0);

/* ---------- 收尾 ---------- */
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ pass: out.pass, fail: out.fail, items: out.items.filter(function (i) { return !i.ok }) }, null, 2));
process.exit(out.fail ? 1 : 0);

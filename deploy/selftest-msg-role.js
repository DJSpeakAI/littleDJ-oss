/* task173 对话消息头角色署名亲测工具（无需浏览器）：
   从 ui/index.html 抽取角色映射与 sessionRole* 函数，断言 8 类角色 + 回落口径；
   真实数据校验：拉后端会话列表，确认线上出现的每个 agent 都能映射为中文角色名。
   用法：node deploy/selftest-msg-role.js  （exit 0=PASS / 1=FAIL / 2=脚本装载失败）
   凭据只读 <运行根>/config/auth.txt，脚本内不打印凭据值。 */
const fs = require('fs'), vm = require('vm'), http = require('http'), os = require('os'), path = require('path');
/* task381：抽取源由「直读 ui/index.html」改为 selftest-load-ui 拼接串——sessionRole* 已迁入
   ts 模块产物，直读 index.html 恒 MISS（与 edge-swipe 同因）；锚点 task239 注释随模块保留在拼接串。 */
const UI_DIR = process.env.UI_DIR || path.join(__dirname, '..', 'ui');
const html = require('./selftest-load-ui').loadUiSource(UI_DIR);
/* task381：CSS 断言读 index.html 原文——拼接串只含 JS 模块产物+内联脚本，不含 <style> 区 */
const htmlRaw = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');

function grab(re, name) {
  const m = html.match(re);
  if (!m) { console.log('FAIL 抽取失败：' + name); process.exit(2) }
  return m[0];
}
/* task277：消息头头像方块退役（主人「把对话里面的 icon 去掉」）——抽取锚点改为 sessionRoleKey 起、
   task239 注释止；MSG_ROLE_AVA/sessionRoleAva 已退役，改断负向「不再渲染 ava」。 */
const _roleStart = html.indexOf('function sessionRoleKey(');
const _roleEnd = html.indexOf('/* ---------- task239：本轮改了哪些文件');
if (_roleStart < 0 || _roleEnd < 0 || _roleEnd <= _roleStart) {
  console.log('FAIL 抽取失败：sessionRoleKey/Label（锚点 task239 注释）');
  process.exit(2)
}
const src = [
  grab(/var CHILD_ROLE_LABEL = \{[\s\S]*?\};/, 'CHILD_ROLE_LABEL'),
  grab(/var CHILD_ROLE_CLASS = \{[\s\S]*?\};/, 'CHILD_ROLE_CLASS'),
  grab(/function childRoleClass\(key\)\{[\s\S]*?\n\}/, 'childRoleClass'),
  grab(/function isButlerSession\(sess\)\{[\s\S]*?\n\}/, 'isButlerSession'),
  html.slice(_roleStart, _roleEnd)
].join('\n');

const ctx = { console };
vm.createContext(ctx);
try { new vm.Script(src).runInContext(ctx) } catch (e) { console.log('FAIL 装载：' + e.message); process.exit(2) }

let pass = 0, fail = 0;
function eq(label, got, want) {
  if (String(got) === String(want)) { pass++; return }
  fail++; console.log('FAIL ' + label + '：got=' + got + ' want=' + want)
}

const cases = [
  [{ agent: 'butler' }, '大管家', 'role-butler'],
  [{ agent: 'steward' }, '小管家', 'role-steward'],
  [{ agent: 'secretariat' }, '枢机', 'role-secretariat'],
  [{ agent: 'writer' }, '执笔', 'role-writer'],
  [{ agent: 'censor-plan' }, '御史·方案审', 'role-censor-plan'],   /* task265 新键 */
  [{ agent: 'censor-output' }, '御史·产出审', 'role-censor-output'], /* task265 新键 */
  [{ agent: 'censor-deepseek' }, '御史·方案审', 'role-censor-ds'],  /* task265 退役键：历史会话兜底锚 */
  [{ agent: 'censor-glm' }, '御史·产出审', 'role-censor-glm'],      /* task265 退役键：历史会话兜底锚 */
  [{ agent: 'build' }, '子代理', 'role-aux'],
  [{ agent: 'explore' }, '探查', 'role-aux'],
  [{ agent: 'general' }, '通用', 'role-aux'],
  [{ agent: null, pwa: 1 }, '大管家', 'role-butler'],              /* 根会话缺 agent：正证据回落 */
  [{ agent: null, parentID: 'ses_x' }, '子代理', 'role-aux'],        /* 子会话缺 agent：子代理，不冒充 little DJ */
  [{ agent: null, parentID: 'ses_x', pwa: 1 }, '子代理', 'role-aux'],/* parentID 优先于 pwa */
  [{ agent: null }, '大管家', 'role-butler'],                       /* task263 对齐现口径：无 parentID 且 pwa!==0（缺省视为 PWA 根会话）⇒ 大管家 */
  [{ agent: '' }, '大管家', 'role-butler'],
  [null, 'little DJ', ''],
];
cases.forEach(function (c) {
  const sess = c[0];
  eq(JSON.stringify(sess) + ' label', ctx.sessionRoleLabel(sess), c[1]);
  const k = ctx.sessionRoleKey(sess);
  eq(JSON.stringify(sess) + ' class', k ? ctx.childRoleClass(k) : '', c[2]);
});

/* 未知 agent 保留原名（有信息量），不吞成 little DJ */
eq('未知角色 label', ctx.sessionRoleLabel({ agent: 'some-new-role' }), 'some-new-role');
eq('未知角色 class', ctx.childRoleClass('some-new-role'), 'role-unknown');

/* 渲染点静态断言：助手消息头确实走 sessionRole* */
if (html.indexOf("who.appendChild(el('b', null, sessionRoleLabel(S.current)))") < 0) {
  fail++; console.log('FAIL renderMessage 未接入 sessionRoleLabel')
} else pass++;
/* task277 负向防复发：消息头不再渲染头像方块（主人「把对话里面的 icon 去掉」） */
if (html.indexOf("el('span', 'ava'") >= 0) {
  fail++; console.log('FAIL renderMessage 仍渲染 ava 头像方块（task277 已退役）')
} else pass++;
if (html.indexOf("who.appendChild(el('span', 'ava'") >= 0) {
  fail++; console.log('FAIL 仍有 ava 挂载点（task277 已退役）')
} else pass++;
if (html.indexOf('function sessionRoleAva(') >= 0 || html.indexOf('var MSG_ROLE_AVA') >= 0) {
  fail++; console.log('FAIL sessionRoleAva/MSG_ROLE_AVA 未退役干净')
} else pass++;
if (html.indexOf("if (rk) wrap.className += ' m' + childRoleClass(rk)") < 0) {
  fail++; console.log('FAIL renderMessage 未按角色加 mrole-* 类名')
} else pass++;
/* task173-fu1：容器类必须是 mrole-* 前缀，禁止直接挂 role-*（全局 .role-* 带 background 会把整条消息染底） */
if (html.indexOf("wrap.className += ' ' + childRoleClass(rk)") >= 0) {
  fail++; console.log('FAIL 消息容器仍直接挂 role-*（会命中全局徽章背景样式）')
} else pass++;

/* 角色样式表完整性：每个角色都要有 b 的着色规则（task277：ava 规则已随头像退役） */
['role-steward', 'role-secretariat', 'role-writer', 'role-censor-ds', 'role-censor-glm', 'role-censor-plan', 'role-censor-output', 'role-butler', 'role-aux', 'role-unknown'].forEach(function (r) {
  if (htmlRaw.indexOf('.msg.m' + r + ' .who b{') < 0) { fail++; console.log('FAIL 缺 CSS .msg.m' + r + ' .who b') } else pass++;
  if (html.indexOf('.msg.m' + r + ' .who .ava{') >= 0) { fail++; console.log('FAIL CSS .msg.m' + r + ' .who .ava 未退役') } else pass++;
});

/* 真实数据：线上 agent 必须 100% 命中中文角色名 */
function realData(cb) {
  const f = path.join(require('../server/paths').ROOT, 'config', 'auth.txt');
  if (!fs.existsSync(f)) return cb('skip')
  const s = fs.readFileSync(f, 'utf8').trim(), i = s.indexOf(':');
  if (i < 0) return cb('skip')
  const auth = 'Basic ' + Buffer.from(s.slice(0, i) + ':' + s.slice(i + 1)).toString('base64');
  const req = http.get({ host: '127.0.0.1', port: 4098, path: '/session?limit=500', headers: { authorization: auth }, timeout: 4000 }, function (r) {
    let b = ''; r.on('data', c => b += c);
    r.on('end', function () {
      try { cb(null, JSON.parse(b)) } catch (e) { cb('skip') }
    })
  });
  req.on('timeout', function () { req.destroy(); cb('skip') });
  req.on('error', function () { cb('skip') });
}
realData(function (err, list) {
  if (err) { console.log('SKIP 真实数据（' + err + '）') }
  else {
    const agents = [...new Set((list || []).map(function (s) { return s.agent }).filter(Boolean))];
    let miss = agents.filter(function (a) { return ctx.CHILD_ROLE_LABEL[a] === undefined && a !== 'butler' });
    if (miss.length) { fail++; console.log('FAIL 线上未知 agent：' + miss.join(',')) }
    else pass++;
    console.log('真实会话 ' + (list || []).length + ' 条，agent 集合=[' + agents.join(', ') + ']');
    if ((list || []).some(function (s) { return s.agent === 'butler' }) && ctx.sessionRoleLabel({ agent: 'butler' }) !== '大管家') {
      fail++; console.log('FAIL 真实 butler 未映射为大管家')
    } else pass++;
  }
  console.log((fail ? 'FAIL' : 'PASS') + ' ' + pass + ' pass / ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
});

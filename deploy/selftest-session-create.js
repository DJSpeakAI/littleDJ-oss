/*
 * 建会话健壮化自测（task238）
 * 用法：node deploy/selftest-session-create.js
 * 背景：真机实锤 POST /api/session 已 200 落库，紧随的 GET /_sessions 在公网链路失败 →
 *       旧代码整链 catch，界面弹「建对话失败：Failed to fetch」，会话其实已建好。
 * 覆盖：①正常链路 ②POST 网络失败但会话已建成 → 当成功 ③POST 网络失败且确实没建成 → 说人话报错
 *       ④拉列表首次失败自动重试成功 ⑤HTTP 错误原样透出 ⑥大管家指针逻辑保留 ⑦cb 失败路径不弹 alert
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const pathFn = require('path');

const ROOT = pathFn.resolve(__dirname, '..');
/* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本） */
const html = require('./selftest-load-ui').loadUiSource(pathFn.join(ROOT, 'ui'));
const start = html.indexOf('function findJustCreatedSession(');
const end = html.indexOf('function inferBusy(');
if (start < 0 || end < 0 || end <= start) {
  console.log('RESULT: FAIL（未能从 ui/index.html 定位 task238 建会话函数块）');
  process.exit(1);
}
const code = html.slice(start, end);

const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra == null ? '' : String(extra) }) }

function makeSandbox() {
  const sb = {
    console,
    S: { sessions: [], current: null, activeButlerSid: '', busyBy: {} },
    _localNewSids: {},
    alert: (m) => { sb.__alert = String(m) },
    openSession: (s) => { sb.__opened = s },
    renderSidebar: () => { sb.__renders = (sb.__renders || 0) + 1 },
    markActiveButler: (id) => { sb.__marked = id },
    scheduleSidebar: () => { sb.__scheduled = (sb.__scheduled || 0) + 1 },
    isButlerSession: () => true,
    fmtTime: () => '16:17',
    api: null,
    loadSessions: null,
    setTimeout
  };
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(code + '\nthis.__api = { createSession: createSession, findJustCreatedSession: findJustCreatedSession, netErrText: netErrText };', sb);
  return sb;
}
const netErr = () => new TypeError('Failed to fetch');
const okSession = (id, abs, created) => ({ id: id, directory: abs, title: '新对话 16:17', time: { created: created || Date.now() - 1000 } });

(async function () {
  const ABS = '/storage/Users/currentUser/project/DAG_AI_Chat';

  /* ①正常链路 */
  {
    const sb = makeSandbox();
    let sess = okSession('s1', ABS);
    sb.api = () => Promise.resolve(sess);
    sb.loadSessions = () => { sb.S.sessions = [sess]; return Promise.resolve() };
    let got = null;
    sb.__api.createSession(ABS, (s) => { got = s });
    await new Promise(r => setTimeout(r, 30));
    check('①正常：打开会话且 cb 拿到会话', got && got.id === 's1' && sb.__opened && sb.__opened.id === 's1', JSON.stringify(sb.__opened && sb.__opened.id));
    check('①正常：不弹 alert', sb.__alert === undefined, sb.__alert);
  }

  /* ②POST 网络失败，但会话其实已建成 → 当成功（本轮真机场景） */
  {
    const sb = makeSandbox();
    sb.api = () => Promise.reject(netErr());
    sb.loadSessions = () => { sb.S.sessions = [okSession('s2', ABS)]; return Promise.resolve() };
    let got = null;
    sb.__api.createSession(ABS, (s) => { got = s });
    await new Promise(r => setTimeout(r, 60));
    check('②POST 失败但已落库：无 alert、cb 收到真会话、会话被打开', sb.__alert === undefined && got && got.id === 's2' && sb.__opened && sb.__opened.id === 's2', (sb.__alert || '') + ' | ' + (got && got.id));
  }

  /* ③POST 网络失败且确实没建成 → 说人话提示刷新 */
  {
    const sb = makeSandbox();
    sb.api = () => Promise.reject(netErr());
    sb.loadSessions = () => { sb.S.sessions = []; return Promise.resolve() };
    sb.__api.createSession(ABS);
    await new Promise(r => setTimeout(r, 60));
    check('③真失败：alert 说明网络中断并提示刷新页面', /网络中断/.test(sb.__alert || '') && /刷新页面/.test(sb.__alert || ''), sb.__alert);
    check('③真失败：不再甩裸 Failed to fetch', !/^建对话失败：Failed to fetch$/.test(sb.__alert || ''), sb.__alert);
  }

  /* ④POST 成功，但拉列表首次失败 → 自动重试一次后成功 */
  {
    const sb = makeSandbox();
    const sess = okSession('s4', ABS);
    let calls = 0;
    sb.api = () => Promise.resolve(sess);
    sb.loadSessions = () => {
      calls++;
      if (calls === 1) return Promise.reject(netErr());
      sb.S.sessions = [sess];
      return Promise.resolve();
    };
    let got = null;
    sb.__api.createSession(ABS, (s) => { got = s });
    await new Promise(r => setTimeout(r, 800));
    check('④拉列表抖动：重试后仍打开会话、无 alert', sb.__alert === undefined && got && got.id === 's4' && calls === 2, 'calls=' + calls + ' | ' + (sb.__alert || ''));
  }

  /* ⑤HTTP 错误（非网络）原样透出，不冒充网络中断 */
  {
    const sb = makeSandbox();
    sb.api = () => Promise.reject(new Error('HTTP 500 {"error":"boom"}'));
    sb.loadSessions = () => { sb.S.sessions = []; return Promise.resolve() };
    sb.__api.createSession(ABS);
    await new Promise(r => setTimeout(r, 60));
    check('⑤后端 500：alert 带后端原文', /HTTP 500/.test(sb.__alert || '') && !/网络中断/.test(sb.__alert || ''), sb.__alert);
  }

  /* ⑥原有「大管家指针」逻辑保留：同目录 + 非子会话 → markActiveButler + scheduleSidebar */
  {
    const sb = makeSandbox();
    const sess = okSession('s6', ABS);
    sb.S.current = { id: 'old', directory: ABS };
    sb.S.activeButlerSid = 'old';
    sb.api = () => Promise.resolve(sess);
    sb.loadSessions = () => { sb.S.sessions = [sess]; return Promise.resolve() };
    sb.__api.createSession(ABS);
    await new Promise(r => setTimeout(r, 30));
    check('⑥指针逻辑：markActiveButler 被调用', sb.__marked === 's6' && (sb.__scheduled || 0) >= 1, sb.__marked + ' / ' + sb.__scheduled);
  }

  /* ⑦带 cb 的失败路径：回调报错、不弹 alert（自动新开链依赖） */
  {
    const sb = makeSandbox();
    sb.api = () => Promise.reject(new Error('HTTP 400 bad'));
    sb.loadSessions = () => { sb.S.sessions = []; return Promise.resolve() };
    let err = null;
    sb.__api.createSession(ABS, (s, e) => { err = e });
    await new Promise(r => setTimeout(r, 60));
    check('⑦cb 失败路径：回调拿到错误且不弹 alert', err && /HTTP 400/.test(err.message) && sb.__alert === undefined, err && err.message);
  }

  /* ⑨task240：服务端列表没带上刚建的会话（慢半拍）→ 乐观插入 + 当场重绘，左栏不再「点了没反应」 */
  {
    const sb = makeSandbox();
    const sess = okSession('s9', ABS);
    sb.api = () => Promise.resolve(sess);
    sb.loadSessions = () => { sb.S.sessions = []; return Promise.resolve() };  // 服务端列表缺这条
    let got = null;
    sb.__api.createSession(ABS, (s) => { got = s });
    await new Promise(r => setTimeout(r, 40));
    const inList = (sb.S.sessions || []).some(x => x.id === 's9');
    check('⑨列表缺新会话时：乐观插入 S.sessions 且 pwa=1', inList && (sb.S.sessions.find(x => x.id === 's9') || {}).pwa === 1, JSON.stringify(sb.S.sessions));
    check('⑨仍打开会话 + 至少重绘一次 + 无 alert', got && got.id === 's9' && (sb.__renders || 0) >= 1 && sb.__alert === undefined, 'renders=' + sb.__renders + ' alert=' + sb.__alert);
  }

  /* ⑩列表里已有时不重复插入（防两行同名） */
  {
    const sb = makeSandbox();
    const sess = okSession('s10', ABS);
    sb.api = () => Promise.resolve(sess);
    sb.loadSessions = () => { sb.S.sessions = [sess]; return Promise.resolve() };
    sb.__api.createSession(ABS);
    await new Promise(r => setTimeout(r, 40));
    check('⑩列表已含该会话：不重复插入（S.sessions 长度仍 1）', (sb.S.sessions || []).length === 1, (sb.S.sessions || []).length);
  }

  /* ⑪task242：空会话（pwa 未知）也要算大管家会话，否则刷新后左栏只剩当前会话 */
  check('⑪isButlerSession 判据为 pwa !== 0（空会话不再被过滤）', /function isButlerSession\(sess\)\{\s*return !!\(sess && !sess\.parentID && sess\.pwa !== 0\);/.test(html), '判据仍是 pwa === 1');
  /* ⑫task243：默认项目不再硬优先隐藏项目「日常」；新建对话下拉不列隐藏项目 */
  check('⑫defaultProjectName 优先当前项目且不硬编码「日常」', (function () {
    var i = html.indexOf('function defaultProjectName(');
    if (i < 0) return false;
    var body = html.slice(i, html.indexOf('function projConvs(', i));
    return body.indexOf('S.current') >= 0 && body.indexOf("'日常'") < 0 && body.indexOf('_projRowHidden') >= 0;
  })(), '默认项目逻辑未改');
  check('⑫新建对话下拉过滤隐藏项目', /_projRowHidden\(p\)\)\{ seen\[p\.name\] = 1; all\.push\(p\) \}/.test(html), '下拉未过滤');
  /* ⑧静态：文案与重试常量在位 */
  const src = html;
  check('⑧源码含拉列表重试封装 loadSessionsRetry(1)', /loadSessionsRetry\(1\)/.test(src), '未接重试');
  check('⑧源码含「网络中断」中文兜底文案', /网络中断（/.test(src), '文案缺失');

  let fail = 0;
  results.forEach(r => { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')) });
  console.log(fail ? 'RESULT: FAIL（' + fail + '/' + results.length + '）' : 'RESULT: PASS（' + results.length + '/' + results.length + '）');
  process.exit(fail ? 1 : 0);
})();

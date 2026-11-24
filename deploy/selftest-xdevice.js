/* task338 跨端状态同步轮询亲测工具（无需浏览器）：node VM 跑 loadUiSource 全模块 + spy 注入，
   断言【纯函数 diff 族】（xdeviceHiddenKey/xdeviceDiffHidden/xdeviceSessKey/xdeviceDiffSessions）+
   【行为链】（P0-1 hidden-only→renderSidebar；P0-2 先探后标/已忙跳过/限3；P1-3 降级保留；
   P1-7 息屏跳过）+【源码锚】（挂载/守卫/防乐观标忙回流）+ 红对照（RC=1 删锚必 FAIL）。
   用法：node deploy/selftest-xdevice.js  （exit 0=PASS / 1=FAIL / 2=装载失败） */
const vm = require('vm');
const fs = require('fs');
const path = require('path');
let m = require('./selftest-load-ui').loadUiSource(path.join(__dirname, '..', 'ui'));
/* spy 注入：整个拼接包在一个大 IIFE 里（闭包绑定优先于 window），必须在 IIFE 尾部注入点覆盖闭包变量 */
const _inj = m.lastIndexOf('})();');
m = m.slice(0, _inj) + `
;window.__calls = { api: [], markBusy: [] };
api = function(url){
  var id = String(url).match(/session\\/([^\\/]+)\\/message/);
  window.__calls.api.push(String(url));
  if (id && window.__apiFail && window.__apiFail.indexOf(id[1]) >= 0) return Promise.reject(new Error('net fail'));
  return Promise.resolve(window.__apiMsgs || [])
};
markBusy = function(sid, busy){ window.__calls.markBusy.push([sid, busy]); S.busyBy[sid] = busy };
inferBusy = function(msgs){ return window.__inferRet !== false };
renderSidebar = function(){ window.__rs = (window.__rs || 0) + 1 };
loadSessions = function(){ window.__ls = (window.__ls || 0) + 1; return Promise.resolve() };
` + m.slice(_inj);

/* ---------- DOM stub（与 selftest-task-panel.js 同源骨架，xdevice 不渲染故精简） ---------- */
function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag||'').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {},
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0,
    get classList(){ const s = e._cls; return {
      add: (...a)=>a.forEach(x=>s.add(x)), remove: (...a)=>a.forEach(x=>s.delete(x)),
      toggle:(x,f)=>{ (f===undefined? !s.has(x):f)? s.add(x):s.delete(x) }, contains:(x)=>s.has(x) } },
    get className(){ return [...e._cls].join(' ') },
    set className(v){ e._cls = new Set(String(v||'').split(/\s+/).filter(Boolean)) },
    get textContent(){ return e.children.length ? e.children.map(c=>c.textContent).join('') : e._text },
    set textContent(v){ e._text = String(v==null?'':v); e.children = [] },
    get innerHTML(){ return '' }, set innerHTML(v){ if (v === '') e.children = [] }, replaceChildren(...nodes){ e.children = []; (nodes||[]).forEach(function(n){ e.appendChild(n) }) },
    appendChild(c){ return c }, insertBefore(c){ return c }, removeChild(c){ return c }, remove(){},
    contains(){ return false }, addEventListener(t,f){ (e.listeners[t] = e.listeners[t]||[]).push(f) },
    removeEventListener(){}, dispatchEvent(){ return true },
    setAttribute(k,v){ e.attrs[k]=v }, getAttribute(k){ return e.attrs[k] },
    getBoundingClientRect(){ return { top:0, left:0, width:0, height:0 } },
    querySelector(){ return null }, querySelectorAll(){ return [] }, closest(){ return null },
  };
  return e;
}
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: false, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(){ return mkEl('div') }, querySelectorAll(){ return [] }, getElementById(){ return mkEl('div') },
  addEventListener(){}, removeEventListener(){},
};
/* 可控响应台：fetch 按 url 分发，行为用例随时改写 */
const state = {
  hiddenResp: { ok: true, hidden: [] },
  sessResp: [],
  inferBusyRet: true,
  apiMsgs: [],
};
const calls = { fetch: [], api: [], renderSidebar: 0, loadSessions: 0, markBusy: [] };
function fetchStub(url){
  calls.fetch.push(String(url));
  const resp = (obj) => ({ ok: true, status: 200, json: () => Promise.resolve(obj) });
  if (String(url).indexOf('/_hidden-sessions') >= 0) return Promise.resolve(resp(state.hiddenResp));
  if (String(url).indexOf('/_sessions') >= 0) return Promise.resolve(resp(state.sessResp));
  return Promise.resolve(resp({ ok: true }));
}
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const m2 = {}; return { getItem: k => (k in m2 ? m2[k] : null), setItem: (k,v)=>{ m2[k]=String(v) }, removeItem: k=>{ delete m2[k] } } };
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN, setTimeout: (f)=>0, clearTimeout(){}, setInterval: ()=>0, clearInterval(){},
  fetch: fetchStub, document: doc, navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() } },
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '', hash: '', reload(){} },
  localStorage: storage(), sessionStorage: storage(),
  alert(){}, confirm: () => true, prompt: () => null,
  EventSource: ES, WebSocket: ES, MutationObserver: class { observe(){} disconnect(){} }, ResizeObserver: class { observe(){} disconnect(){} },
  IntersectionObserver: class { observe(){} disconnect(){} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: f => 0, cancelAnimationFrame(){}, matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  history: { pushState(){}, replaceState(){} }, performance: { now: () => Date.now() },
  innerWidth: 1400, innerHeight: 900, addEventListener(){}, removeEventListener(){}, atob: s => s, btoa: s => s,
  AbortController: class { constructor(){ this.signal = {} } abort(){} },
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }
sandbox.__apiMsgs = []; sandbox.__inferRet = true;

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))) }
}
function eq(name, got, want){ ok(name, got === want, got) }
const flush = () => new Promise(r => setImmediate(r));

setImmediate(async () => {
  const X = sandbox.xdeviceReconcile ? {
    key: sandbox.xdeviceHiddenKey, diffH: sandbox.xdeviceDiffHidden, skey: sandbox.xdeviceSessKey, diffS: sandbox.xdeviceDiffSessions,
    applyH: sandbox.xdeviceApplyHidden, applyS: sandbox.xdeviceApplySessions, probe: sandbox.xdeviceProbe, rec: sandbox.xdeviceReconcile,
  } : null;
  if (!X || typeof sandbox.xdeviceReconcile !== 'function'){ console.error('FAIL xdevice 模块未加载'); process.exit(1) }
  const S = sandbox.S;

  /* ---------- ① 纯函数：hidden 键集 ---------- */
  eq('①-键集排序', X.key(['b','a','c']), 'a,b,c');
  eq('①-增变化', X.diffH('a,b', ['a','b','c']), true);
  eq('①-删变化', X.diffH('a,b', ['a']), true);
  eq('①-无变化', X.diffH('a,b', ['b','a']), false);
  eq('①-空对空', X.diffH('', []), false);

  /* ---------- ② 纯函数：sessions diff ---------- */
  const mk = (id, tu, title, cc) => ({ id, time: { updated: tu }, title: title || '', childCount: cc || 0 });
  eq('②-签名含四字段', X.skey(mk('s1', 100, 'T', 2)), 's1|100|T|2');
  const seen1 = { s1: X.skey(mk('s1', 100, 'T', 2)) };
  eq('②-无变化', X.diffS(seen1, [mk('s1', 100, 'T', 2)]).changed, false);
  const d2 = X.diffS(seen1, [mk('s1', 200, 'T', 2)]);
  ok('②-tu 变化触发', d2.changed && d2.woke.join() === 's1', d2);
  const d3 = X.diffS(seen1, [mk('s1', 100, 'T2', 2)]);
  ok('②-title 变化触发（P2-2）', d3.changed && d3.woke.join() === 's1', d3);
  const d4 = X.diffS(seen1, [mk('s1', 100, 'T', 5)]);
  ok('②-childCount 变化触发（P2-2）', d4.changed && d4.woke.join() === 's1', d4);
  const d5 = X.diffS(seen1, []);
  ok('②-会话消失触发', d5.changed, d5);
  const d6 = X.diffS(null, [mk('s1', 1), mk('s2', 2)]);
  ok('②-首跑全 woke', d6.changed && d6.woke.sort().join() === 's1,s2', d6);

  /* ---------- ③ 行为：hidden-only 变化 → renderSidebar（P0-1 主诉②闭环） ----------
     模块闭包变量（_xdTick/_xdSessSeen/_xdHiddenMemo）不可外部预置（window 导出=初值拷贝），
     一律函数行为驱动：第一轮建基线（首跑拉 sessions），第二轮只改 hidden 响应（tick 节拍不拉 sessions） */
  sandbox.__rs = 0;
  S.hidden = {};
  const sessNow = [mk('k1', 100, 'A', 0)];
  state.hiddenResp = { ok: true, hidden: [] };
  state.sessResp = sessNow;
  X.rec(); await flush(); await flush(); /* 基线轮：memo/_xdSessSeen 建立 */
  sandbox.__rs = 0; calls.fetch.length = 0;
  state.hiddenResp = { ok: true, hidden: ['gone1'] }; /* 只改 hidden */
  X.rec(); await flush(); await flush();
  ok('③-hidden-only 后 renderSidebar 被调（P0-1）', sandbox.__rs >= 1, sandbox.__rs);
  eq('③-S.hidden 更新', S.hidden.gone1, 1);
  ok('③-本轮未拉 /_sessions（节拍）', !calls.fetch.some(u => u.indexOf('/_sessions') >= 0), calls.fetch);
  sandbox.__k1EverProbed = sandbox.__calls.api.some(u => u.indexOf('/k1') >= 0); /* ⑦c 快照：首跑候选 k1 有没有被动过（此刻日志尚全） */

  /* ---------- ④ 行为：降级保留旧值（P1-3）——降级轮不动，下一轮正常响应才更新 ---------- */
  calls.fetch.length = 0;
  state.hiddenResp = { ok: true, hidden: ['x'], warning: 'partial-read' };
  X.rec(); await flush(); await flush();
  eq('④-降级不覆盖 S.hidden', S.hidden.gone1, 1);
  state.hiddenResp = { ok: true, hidden: ['gone1', 'gone2'] };
  X.rec(); await flush(); await flush();
  eq('④-恢复后正常更新（降级轮确未写入）', S.hidden.gone2, 1);

  /* ---------- ⑤ 行为：先探后标（P0-2）——applyS 喂变化列表驱动真实探测队列 ---------- */
  calls.api.length = 0; sandbox.__calls.api.length = 0; sandbox.__calls.markBusy.length = 0;
  S.busyBy = { busy1: true };
  sandbox.__apiMsgs = [{ info: {} }]; sandbox.__inferRet = true; sandbox.__apiFail = [];
  /* 产出审 P0-1：S_ENDED 必须在 probe 前预置目标键——原「probe 后才建空对象」断言恒真（假绿） */
  sandbox.S_ENDED = { idle9: 1 };
  X.applyS([mk('busy1', 500, 'B', 0), mk('idle9', 900, 'I', 0)]); await flush();
  X.probe(); await flush();
  eq('⑤-已忙跳过探测（busy1 不进 api）', sandbox.__calls.api.filter(u => u.indexOf('busy1') >= 0).length, 0);
  eq('⑤-未忙走 api 探测', sandbox.__calls.api.filter(u => u.indexOf('idle9') >= 0).length, 1);
  ok('⑤-inferBusy true → markBusy(idle9,true)', sandbox.__calls.markBusy.some(x => x[0] === 'idle9' && x[1] === true), sandbox.__calls.markBusy);
  eq('⑤-标忙清 S_ENDED（预置过 idle9）', sandbox.S_ENDED.idle9, undefined);
  /* 边界：window.S_ENDED 不可用时标忙不抛（xdevice 有 guard） */
  sandbox.__calls.markBusy.length = 0; S.busyBy = {};
  var _seBak = sandbox.S_ENDED; sandbox.S_ENDED = undefined;
  let noThrow = true;
  try { X.applyS([mk('nose', 999, 'N', 0)]); await flush(); X.probe(); await flush(); } catch(e){ noThrow = false }
  ok('⑤-S_ENDED 缺席不抛', noThrow);
  sandbox.S_ENDED = _seBak;

  /* ---------- ⑥ 行为：不忙弃权（L-049 宁缺勿假） ---------- */
  sandbox.__calls.api.length = 0; sandbox.__calls.markBusy.length = 0;
  sandbox.__inferRet = false;
  X.applyS([mk('calm1', 700, 'C', 0)]); await flush();
  X.probe(); await flush();
  eq('⑥-inferBusy false 不标忙', sandbox.__calls.markBusy.filter(x => x[0] === 'calm1').length, 0);
  ok('⑥-确已探测（防假绿）', sandbox.__calls.api.some(u => u.indexOf('calm1') >= 0), calls.api);

  /* ---------- ⑦ 行为：探测限 3、候选跨轮保留（P1-2）——两轮 probe 消化 5 候选 ---------- */
  sandbox.__calls.api.length = 0; sandbox.__inferRet = false;
  S.busyBy = {};
  X.applyS([mk('p1',1),mk('p2',2),mk('p3',3),mk('p4',4),mk('p5',5)]); await flush(); /* 5 候选全进队 */
  X.probe(); await flush(); /* 本轮 ≤3 */
  eq('⑦-本轮探测恰 3', sandbox.__calls.api.length, 3);
  X.probe(); await flush(); /* 跨轮续探剩余 */
  eq('⑦-跨轮补探剩余 2（不永久漏标）', sandbox.__calls.api.length, 5);
  X.probe(); await flush(); /* 队列耗尽后不再探测 */
  eq('⑦-队列耗尽零探测', sandbox.__calls.api.length, 5);

  /* ---------- ⑦b 产出审 P1-2：探测失败重入队（≤2 次重试），恢复后仍能标忙 ---------- */
  sandbox.__calls.api.length = 0; sandbox.__calls.markBusy.length = 0;
  S.busyBy = {}; sandbox.__inferRet = true; sandbox.__apiFail = ['flaky1'];
  X.applyS([mk('flaky1', 800, 'F', 0)]); await flush();
  X.probe(); await flush(); /* 首探失败（api reject） */
  eq('⑦b-首探失败零标忙', sandbox.__calls.markBusy.filter(x => x[0] === 'flaky1').length, 0);
  X.probe(); await flush(); /* 重入队后再探（仍失败→第 2 次重试） */
  ok('⑦b-失败重入队再探', sandbox.__calls.api.filter(u => u.indexOf('flaky1') >= 0).length >= 2, sandbox.__calls.api);
  sandbox.__apiFail = []; /* 网络恢复 */
  X.probe(); await flush();
  ok('⑦b-恢复后补探标忙', sandbox.__calls.markBusy.some(x => x[0] === 'flaky1' && x[1] === true), sandbox.__calls.markBusy);

  /* ---------- ⑦c 产出审 P1-1：首跑只建基线不探测（防 164 根探测洪峰） ----------
     k1 只在 ③ 基线轮（首跑）出现过——③ 段尾快照其探测史，此刻日志已被 ⑦ 清零，读快照防假绿 */
  eq('⑦c-首跑候选未入探测（k1 全程零 api）', sandbox.__k1EverProbed, false);

  /* ---------- ⑦d 产出审 P1-3：空 sessions 响应不清栏（loadSessions 不触发、memo 不推进） ---------- */
  sandbox.__ls = 0;
  const _sessBak = state.sessResp;
  state.sessResp = [];
  sandbox.__calls.api.length = 0; S.busyBy = {};
  X.applyS([]); await flush(); /* 空数组（memo 非空）→ guard 拒绝 */
  eq('⑦d-空响应不触发 loadSessions（不清栏）', sandbox.__ls, 0);
  state.sessResp = _sessBak;
  X.applyS([mk('k1', 300, 'A2', 0)]); await flush(); /* 恢复正常 */
  ok('⑦d-恢复后变化照常驱动', sandbox.__ls >= 1, sandbox.__ls);

  /* ---------- ⑧ 行为：息屏整轮跳过 / 回屏恢复（P1-7） ---------- */
  doc.hidden = true; calls.fetch.length = 0;
  X.rec(); await flush();
  eq('⑧-息屏（无保活）整轮跳过', calls.fetch.length, 0);
  doc.hidden = false;
  state.sessResp = sessNow; state.hiddenResp = { ok: true, hidden: ['gone1', 'gone2'] };
  X.rec(); await flush(); await flush();
  ok('⑧-回屏恢复拉取（hidden 必达）', calls.fetch.some(u => u.indexOf('/_hidden-sessions') >= 0), calls.fetch);

  /* ---------- ⑧B task390：hidden 顺序镜像 + 同键集换序也重绘 ---------- */
  sandbox.__rs = 0;
  X.applyH({ ok: true, hidden: ['a', 'b'] });
  eq('⑧B-hiddenOrder 镜像服务端顺序（task390）', (S.hiddenOrder || []).join(','), 'a,b');
  eq('⑧B-S.hidden 映射同步', !!(S.hidden.a && S.hidden.b), true);
  const _rs1 = sandbox.__rs;
  X.applyH({ ok: true, hidden: ['b', 'a'] }); /* 同键集、仅顺序变 */
  eq('⑧B-同键集换序也重绘（task390）', sandbox.__rs, _rs1 + 1);
  eq('⑧B-换序后 order 更新', (S.hiddenOrder || []).join(','), 'b,a');

  /* ---------- ⑨ 源码锚（挂载/守卫/防回流）---------- 产出审 P2：红对照=真删锚副本（非反转断言） */
  const idx0 = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const xd0 = fs.readFileSync(path.join(__dirname, '..', 'ui', 'src', 'stream', 'xdevice.js'), 'utf8');
  const rc = process.env.RC === '1';
  const idx = rc
    ? idx0.replace(/setInterval\(xdeviceReconcile, XDEV_TICK_MS\)[^\n]*/, '').replace(/<script src="\/src\/stream\/xdevice\.js\?v=[^"]*"><\/script>/, '')
    : idx0;
  const xd = rc
    ? xd0.replace('XDEV_FETCH_TIMEOUT_MS = 8000', 'XDEV_FETCH_TIMEOUT_MS = 0').replace("return; /* popout 页零跨端轮询", "return BROKEN; /* popout 页零跨端轮询").replace('!_xdSessSeen || !Object.keys(_xdSessSeen).length', '!_xdSessSeen')
    : xd0;
  const A = (name, cond, extra) => ok(name, cond, extra);
  A('⑨-定时器挂载', idx.indexOf('setInterval(xdeviceReconcile, XDEV_TICK_MS') >= 0);
  A('⑨-script 注入', idx.indexOf('/src/stream/xdevice.js?v=') >= 0);
  A('⑨-@order 50（plugins 49 后追加）', xd.indexOf('@order 50') >= 0);
  A('⑨-POP_TAB 守卫', xd.indexOf('POP_TAB') >= 0 && xd.indexOf('return; /* popout 页零跨端轮询') >= 0);
  A('⑨-息屏保活守卫', xd.indexOf('document.hidden && !') >= 0 && xd.indexOf('kaActive') >= 0);
  A('⑨-fetch 8s 超时（P1-5）', xd.indexOf('XDEV_FETCH_TIMEOUT_MS = 8000') >= 0);
  A('⑨-hidden 显式 renderSidebar（P0-1）', xd.indexOf('renderSidebar(); /* P0-1') >= 0);
  A('⑨-先探后标 inferBusy（P0-2）', xd.indexOf('inferBusy(msgs)') >= 0);
  A('⑨-防乐观标忙回流（禁 busyEvAt 直写）', xd.indexOf('S.busyEvAt[') < 0);
  A('⑨-降级保留（P1-3）', xd.indexOf('d.warning') >= 0);
  A('⑨-hiddenOrder 顺序镜像（task390）', xd.indexOf('S.hiddenOrder = d.hidden.slice()') >= 0);
  A('⑨-息屏换序回补 flag（task390）', xd.indexOf('_xdNeedReload = true; /* 息屏：回前台补一次') >= 0);
  A('⑨-首跑空基线防洪峰（复审 P1-4）', xd.indexOf('!_xdSessSeen || !Object.keys(_xdSessSeen).length') >= 0);

  console.log(rc ? '\n[红对照] 应有 FAIL（锚删除必咬合）' : '');
  console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + '（task338 xdevice：' + pass + ' PASS / ' + fail + ' FAIL）');
  process.exit(fail ? 1 : 0);
});

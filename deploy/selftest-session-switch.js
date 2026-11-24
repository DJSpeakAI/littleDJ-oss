/* task312 会话切换丝滑直显亲测工具（无需浏览器）：node VM 全量装载 ui + 最小 DOM/可控 fetch。
   断言：缓存命中同步直出（无「加载中」）、忙态/不完整离场不缓存、网络返回/空会话写缓存、
        LRU/2000 条护栏、指纹相同不动 DOM、更新方向才重渲染、旧响应/旧数据不回滚、
        校准失败静默保留缓存、忙态离场后重开退回「加载中」。
   用法：node deploy/selftest-session-switch.js （exit 0=PASS / 1=FAIL / 2=装载失败） */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const uiDir = path.join(__dirname, '..', 'ui');
/* 模块化后源码锚点走 loadUiSource（按 @order 拼接全部模块+内联脚本），与装载串 m 同源 */
const html = require('./selftest-load-ui').loadUiSource(uiDir);
let m = html;
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, openSession: openSession, refreshCurrent: refreshCurrent, msgCachePut: msgCachePut, msgCacheDrop: msgCacheDrop, msgsFingerprint: msgsFingerprint, msgsIsNewer: msgsIsNewer, renderSessionMessages: renderSessionMessages, setStickBottom: function(v){ _stickBottom = !!v } };\n" + m.slice(_i);

/* ---------- DOM stub（在 multisel stub 基础上补 #messages/HTML 文本） ---------- */
function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag||'').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {}, _html: '',
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 0, innerWidth: 0,
    get classList(){ const s = e._cls; return {
      add: (...a)=>a.forEach(x=>s.add(x)), remove: (...a)=>a.forEach(x=>s.delete(x)),
      toggle:(x,f)=>{ (f===undefined? !s.has(x):f)? s.add(x):s.delete(x) }, contains:(x)=>s.has(x) } },
    get className(){ return [...e._cls].join(' ') },
    set className(v){ e._cls = new Set(String(v||'').split(/\s+/).filter(Boolean)) },
    get textContent(){ return e.children.length ? e.children.map(c=>c.textContent).join('') : (e._text || e._html) },
    set textContent(v){ e._text = String(v==null?'':v); e.children = [] },
    get innerHTML(){ return e._html }, set innerHTML(v){ e._html = String(v==null?'':v); e.children = [] },
    replaceChildren(...nodes){ e.children = []; (nodes||[]).forEach(function(n){ e.appendChild(n) }) },
    appendChild(c){ if (!c) return c; if (c.__isFrag){ c.children.slice().forEach(x=>e.appendChild(x)); return c }
      if (c.parent) { const i = c.parent.children.indexOf(c); if (i>=0) c.parent.children.splice(i,1) }
      c.parent = e; e.children.push(c); return c },
    insertBefore(c,ref){ if (!c) return c; const i = e.children.indexOf(ref); c.parent = e;
      if (i<0) e.children.push(c); else e.children.splice(i,0,c); return c },
    removeChild(c){ const i = e.children.indexOf(c); if (i>=0) e.children.splice(i,1); return c },
    remove(){ if (e.parent) e.parent.removeChild(e) },
    contains(x){ let p = x; while (p){ if (p === e) return true; p = p.parent } return false },
    addEventListener(t,f){ (e.listeners[t] = e.listeners[t]||[]).push(f) },
    removeEventListener(){}, dispatchEvent(){ return true },
    setAttribute(k,v){ e.attrs[k]=v }, getAttribute(k){ return e.attrs[k] },
    getBoundingClientRect(){ return { top:0, left:0, right:0, bottom:0, width:0, height:0, x:0, y:0 } },
    setPointerCapture(){}, releasePointerCapture(){}, focus(){}, select(){}, blur(){}, click(){}, scrollIntoView(){}, setSelectionRange(){}, reset(){}, submit(){}, toggleAttribute(){},
    querySelector(sel){ return qsel(e, sel)[0] || null }, querySelectorAll(sel){ return qsel(e, sel) },
    closest(){ return null }, firstChild(){ return e.children[0]||null },
  };
  return e;
}
function matchesSel(el, part){
  if (!el || !el.tagName) return false;
  if (part.indexOf('[') >= 0) return false;
  const segs = part.match(/([#.]?[\w-]+)/g) || [];
  let ok = true;
  for (const s of segs){
    if (s[0] === '#'){ if (el.attrs.id !== s.slice(1)) { ok = false; break } }
    else if (s[0] === '.'){ if (!el._cls.has(s.slice(1))) { ok = false; break } }
    else { if (el.tagName !== s.toUpperCase()) { ok = false; break } }
  }
  return ok;
}
function walk(el, out){ el.children.forEach(c=>{ out.push(c); walk(c, out) }); return out }
function qsel(root, sel){
  const parts = sel.split(/\s+/).filter(Boolean);
  const all = walk(root, []);
  return all.filter(el => {
    let i = parts.length - 1;
    if (!matchesSel(el, parts[i])) return false;
    for (let j = i-1; j >= 0; j--){
      let found = false; let p = el.parent;
      while (p){ if (matchesSel(p, parts[j])){ found = true; break } p = p.parent }
      if (!found) return false;
    }
    return true;
  });
}
const byId = {};
function idEl(id){ return byId[id] = byId[id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() }
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: true, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'), createElementNS: (ns,t) => mkEl(t),
  createTextNode: t => { const e = mkEl('#text'); e._text = String(t); return e },
  querySelector(sel){
    if (sel && sel[0] === '#') return idEl(sel.slice(1));
    const hit = qsel(doc.body, sel)[0]; if (hit) return hit;
    if (String(sel).indexOf('[') >= 0) return null; /* 属性选择器不造假日节点 */
    return (byId[sel] = byId[sel] || mkEl('div'));
  },
  querySelectorAll(sel){ if (sel && sel[0] === '#') return [idEl(sel.slice(1))]; if (sel.indexOf('[') >= 0) return []; return qsel(doc.body, sel) },
  getElementById(id){ return idEl(id) },
  addEventListener(){}, removeEventListener(){},
};
const pending = {};
function deferred(){ let resolve, reject; const p = new Promise((res, rej)=>{ resolve = res; reject = rej }); return { p, resolve, reject } }
const resp = (obj) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(obj), text: () => Promise.resolve('') });
function fetchStub(url, opt){
  const u = String(url);
  if (u.indexOf('/api/session/') >= 0 && /\/message$/.test(u)){
    const d = deferred(); (pending[u] = pending[u] || []).push(d); return d.p;
  }
  if (u.indexOf('/api/agent') >= 0) return Promise.resolve(resp([]));
  if (u.indexOf('/_conv-order') >= 0) return Promise.resolve(resp({ order: {} }));
  return new Promise(()=>{}); /* 其余请求一律挂起，隔离副作用 */
}
function respond(sid, msgs){ const k = '/api/session/' + sid + '/message'; const d = (pending[k] || []).shift(); if (!d) throw new Error('no pending fetch ' + k); d.resolve(resp(msgs)) }
function failFetch(sid, err){ const k = '/api/session/' + sid + '/message'; const d = (pending[k] || []).shift(); if (!d) throw new Error('no pending fetch ' + k); d.reject(err || new Error('network down')) }
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const mm = {}; return { getItem: k => (k in mm ? mm[k] : null), setItem: (k,v)=>{ mm[k]=String(v) }, removeItem: k=>{ delete mm[k] } } };
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
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }

const tick = () => new Promise(r => setImmediate(r));
const ticks = async (n) => { for (let i=0;i<(n||5);i++) await tick() };
let fail = 0;
const A = (name, ok, extra) => { console.log('[' + name + ']', extra !== undefined ? extra + ' ' : '', ok ? 'PASS' : 'FAIL'); if (!ok) fail = 1 };
const DIR = '/storage/Users/currentUser/project/littleDJ';
const msg = (id, role, text, t) => ({ info: { id, role, time: { created: t || 1000, updated: t || 1000 } }, parts: [{ id: 'p-' + id, type: 'text', text: text || id }] });

(async () => {
  await ticks(3);
  const T = sandbox.__T, S = T.S;
  S.sessions = []; S.projects = [{ name: 'littleDJ', path: DIR }]; S.imports = []; S.order = [];
  S.children = {}; S.childParent = {}; S.hidden = {}; S.pending = {}; S.userMids = {};
  const msgs1 = [msg('m1', 'user', 'hi', 1000), msg('m2', 'assistant', 'hello', 2000)];
  const msgs2 = msgs1.concat([msg('m3', 'assistant', 'world', 3000)]);
  const box = doc.querySelector('#messages');
  const reset = (sid, msgs, opt) => {
    opt = opt || {};
    S.current = { id: sid, title: sid, directory: DIR };
    S.lastMsgs = msgs || []; S._lastMsgsSid = sid; S._msgsComplete = true;
    S.busyBy = {}; if (opt.busy) S.busyBy[sid] = true;
    S.msgCache = {}; if (opt.cache) T.msgCachePut(sid, opt.cache);
    S.busy = !!S.busyBy[sid]; box.innerHTML = ''; box.children = [];
  };

  /* ① 缓存命中：同步直出，无「加载中」（API 暂不 resolve） */
  reset('C1', [], { cache: msgs1 });
  T.openSession(S.current);
  A('①缓存命中无加载中', box._html.indexOf('加载中') < 0 && box.children.length === 2, 'children=' + box.children.length + ' html=' + box._html.slice(0, 20));

  /* ② 未命中：仍显示「加载中…」 */
  reset('C2', []);
  T.openSession(S.current);
  A('②未命中显示加载中', box._html.indexOf('加载中') >= 0, box._html.slice(0, 30));

  /* ③ 忙态离场不写缓存并删条目；完整且空闲离场写缓存 */
  reset('L1', msgs1, { busy: true });
  T.msgCachePut('L1', msgs1); /* 预置旧缓存：忙态离场必须删条目 */
  T.openSession({ id: 'L2', title: 'L2', directory: DIR });
  A('③忙态离场不缓存', !S.msgCache['L1'], 'keys=' + Object.keys(S.msgCache).join(','));
  reset('L1b', msgs1, { busy: false });
  T.openSession({ id: 'L2b', title: 'L2b', directory: DIR });
  A('③空闲完整离场写缓存', !!S.msgCache['L1b'] && S.msgCache['L1b'].msgs.length === 2 && S.msgCache['L1b'].msgs[0].info.role === 'user', 'keys=' + Object.keys(S.msgCache).join(','));

  /* ④ 网络返回写缓存；空会话写 [] 不串台 */
  reset('N1', []);
  T.openSession(S.current); respond('N1', msgs1); await ticks(6);
  A('④网络返回写缓存', !!S.msgCache['N1'] && S.msgCache['N1'].msgs.length === 2, 'len=' + (S.msgCache['N1'] && S.msgCache['N1'].msgs.length));
  reset('N2', msgs1);
  T.openSession(S.current); respond('N2', []); await ticks(6);
  A('④空会话缓存空数组', !!S.msgCache['N2'] && S.msgCache['N2'].msgs.length === 0 && S.lastMsgs.length === 0, 'cache=' + JSON.stringify(S.msgCache['N2'] && S.msgCache['N2'].msgs));

  /* ⑤ LRU 15 */
  S.msgCache = {};
  for (let i = 0; i <= 15; i++) T.msgCachePut('LRU' + i, [msg('x' + i, 'assistant', 'x', i)]);
  const lruKeys = Object.keys(S.msgCache);
  A('⑤LRU 保留 15 淘汰最旧', lruKeys.length === 15 && !S.msgCache['LRU0'] && !!S.msgCache['LRU15'], 'n=' + lruKeys.length);

  /* ⑥ >2000 条不缓存 */
  S.msgCache = {};
  T.msgCachePut('BIG', new Array(2001).fill(0).map((_, i) => msg('b' + i, 'assistant', 'b', i)));
  A('⑥>2000 条不缓存', !S.msgCache['BIG']);

  /* ⑦ 指纹相同 → DOM 节点 identity 不变 */
  reset('F1', [], { cache: msgs1 });
  T.openSession(S.current);
  const firstNode = box.children[0];
  respond('F1', msgs1.map(x => JSON.parse(JSON.stringify(x)))); await ticks(6);
  A('⑦指纹相同不重渲染', box.children[0] === firstNode && box.children.length === 2, 'same=' + (box.children[0] === firstNode));

  /* ⑧ 指纹更新 → 重渲染 + 写缓存 */
  reset('F2', [], { cache: msgs1 });
  T.openSession(S.current);
  T.setStickBottom(false);
  box.scrollHeight = 1000; box.scrollTop = 100; box.clientHeight = 500; /* 非贴底：重渲染必须保持阅读位置 */
  respond('F2', msgs2); await ticks(6);
  A('⑧更新方向重渲染+滚动保持', box.children.length === 3 && S.msgCache['F2'].msgs.length === 3 && box.scrollTop === 100, 'children=' + box.children.length + ' scrollTop=' + box.scrollTop);

  /* ⑨ 旧响应（切走后）→ 不渲染、不写缓存 */
  reset('O1', []);
  T.openSession(S.current);
  T.openSession({ id: 'O2', title: 'O2', directory: DIR });
  respond('O1', msgs1); await ticks(6);
  A('⑨旧响应不串台', S.current.id === 'O2' && !S.msgCache['O1'], 'cur=' + S.current.id + ' has=' + !!S.msgCache['O1']);

  /* ⑩ 空会话缓存同步直出空态 */
  reset('E1', [], { cache: [] });
  T.openSession(S.current);
  A('⑩空会话缓存直出空态', box._html.indexOf('empty-logo') >= 0 && box._html.indexOf('加载中') < 0, box._html.slice(0, 30));

  /* ⑪ 校准失败静默保留缓存 */
  reset('R1', [], { cache: msgs1 });
  T.openSession(S.current);
  const rNode = box.children[0];
  failFetch('R1', new Error('net down')); await ticks(6);
  A('⑪校准失败保留缓存', box.children[0] === rNode && box.children.length === 2 && box._html.indexOf('加载失败') < 0, 'children=' + box.children.length);

  /* ⑫ 更旧响应 → 不回滚、不覆盖缓存 */
  reset('S1', [], { cache: msgs1 });
  T.openSession(S.current);
  respond('S1', [msgs1[0]]); await ticks(6);
  A('⑫更旧响应不回滚', box.children.length === 2 && S.msgCache['S1'].msgs.length === 2, 'children=' + box.children.length + ' cache=' + S.msgCache['S1'].msgs.length);

  /* ⑬ 忙态离场后重开 → 退回「加载中」，绝不直显半截 */
  reset('T1', msgs1, { busy: true });
  T.openSession({ id: 'T2', title: 'T2', directory: DIR });
  T.openSession({ id: 'T1', title: 'T1', directory: DIR });
  A('⑬忙态离场重开无缓存', box._html.indexOf('加载中') >= 0 && !S.msgCache['T1'], box._html.slice(0, 30));

  /* ---------- 源码锚点 + 点名红对照（退回旧代码必须转红） ---------- */
  const anchors = [
    ['①缓存命中直出分支', 'renderSessionMessages(sess, _cached.msgs, {});'],
    ['③忙态离场删条目', 'else msgCacheDrop(_leaveSid);'],
    ['③离场只缓存完整快照', '!S.busyBy[_leaveSid]) msgCachePut(_leaveSid, S.lastMsgs);'],
    ['⑬忙态离场删条目', 'else msgCacheDrop(_leaveSid);'],
    ['⑨旧响应 seq 守卫', '_seq !== S._openSeq'],
    ['⑪校准失败静默', 'if (_fromCache){ _suppressScroll = false; syncSseBanner(); syncScrollBtn(); return; }'],
    ['⑫只按更新方向重渲染', 'if (!msgsIsNewer(fresh, cur)) return;'],
  ];
  function checks(src){ return anchors.map(([n, s]) => [n, src.indexOf(s) >= 0]) }
  function namedRed(src, name){ const hit = checks(src).filter(p => p[0] === name)[0]; return !!(hit && hit[1] === false) }
  checks(html).forEach(([n, ok]) => A('源码锚点 ' + n, ok));
  anchors.forEach(([n, anchor]) => {
    const removed = anchor === '_seq !== S._openSeq'
      ? html.replace(/_seq !== S\._openSeq/g, '\u0000')
      : html.replace(anchor, '\u0000');
    A('红对照 删除「' + n + '」→ 点名转红', removed !== html && namedRed(removed, n));
  });

  console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS（会话切换秒开缓存 + 校准/防串台）');
  process.exit(fail);
})().catch(e => { console.error('RUN-FAIL', e && e.stack || e); process.exit(2) });

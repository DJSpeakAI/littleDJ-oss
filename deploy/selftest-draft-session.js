#!/usr/bin/env node
/* task391 输入框草稿按会话隔离自测（每个对话框记自己的输入内容）
 *   ① draftStash/draftRestore/draftDrop/draftSwitch/draftTrim 数据侧语义
 *   ② openSession 真路径：A 打字→切 B（B 空）→ B 打字→切回 A（A 草稿原样）；同 id 不清空
 *   ③ restoreDraft 守卫：非当前会话只写槽不动 DOM；S.current=null 不抛
 *   ④ 静态接线：send draftDrop / handoff carry 分支 / clearCurrentAfterRemove stash / addImageFile 异步归属守卫
 *   ⑤ 版本号三处同步（动态口径，L-063：禁写死版本字面量）
 *   ⑥ 红对照：无槽 draftRestore 必须清空（防「草稿跟人走」复现）
 * 退出码 0=全绿，1=有失败，2=装载失败 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let ui;
try {
  ui = require('./selftest-load-ui').loadUiSource(path.join(root, 'ui'));
} catch (e) { console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }
const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (hint ? '  ← ' + hint : '')); }
}

/* ---------- DOM stub（与 selftest-multisel-keepopen.js 同构） ---------- */
function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag||'').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {},
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '', placeholder: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 0,
    get classList(){ const s = e._cls; return {
      add: (...a)=>a.forEach(x=>s.add(x)), remove: (...a)=>a.forEach(x=>s.delete(x)),
      toggle:(x,f)=>{ (f===undefined? !s.has(x):f)? s.add(x):s.delete(x) }, contains:(x)=>s.has(x) } },
    get className(){ return [...e._cls].join(' ') },
    set className(v){ e._cls = new Set(String(v||'').split(/\s+/).filter(Boolean)) },
    get textContent(){ return e.children.length ? e.children.map(c=>c.textContent).join('') : e._text },
    set textContent(v){ e._text = String(v==null?'':v); e.children = [] },
    get innerHTML(){ return '' }, set innerHTML(v){ if (v === '') e.children = [] },
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
  for (const s of segs){
    if (s[0] === '#'){ if (el.attrs.id !== s.slice(1)) return false }
    else if (s[0] === '.'){ if (!el._cls.has(s.slice(1))) return false }
    else { if (el.tagName !== s.toUpperCase()) return false }
  }
  return true;
}
function walk(el, out){ el.children.forEach(c=>{ out.push(c); walk(c, out) }); return out }
function qsel(rootEl, sel){
  const parts = String(sel||'').split(/\s+/).filter(Boolean);
  const all = walk(rootEl, []);
  return all.filter(el => {
    const last = parts[parts.length - 1];
    if (!matchesSel(el, last)) return false;
    for (let j = parts.length - 2; j >= 0; j--){
      let found = false; let p = el.parent;
      while (p){ if (matchesSel(p, parts[j])){ found = true; break } p = p.parent }
      if (!found) return false;
    }
    return true;
  });
}
const elCache = {};
const inputEl = mkEl('textarea'); inputEl.attrs.id = 'input';
const attachRow = mkEl('div'); attachRow.attrs.id = 'attachRow';
const messagesEl = mkEl('div'); messagesEl.attrs.id = 'messages';
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: false, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(sel){
    if (sel === '#input') return inputEl;
    if (sel === '#attachRow') return attachRow;
    if (sel === '#messages') return messagesEl;
    return qsel(doc.body, sel)[0] || (elCache[sel] = elCache[sel] || (()=>{ const x = mkEl('div'); if (String(sel)[0]==='#') x.attrs.id = String(sel).slice(1); return x })());
  },
  querySelectorAll(sel){ if (String(sel).indexOf('[') >= 0) return []; return qsel(doc.body, sel) },
  getElementById(id){ return doc.querySelector('#' + id) },
  addEventListener(){}, removeEventListener(){},
};
function fetchStub(url){
  const u = String(url);
  const resp = (obj) => ({ ok: true, status: 200, json: () => Promise.resolve(obj), text: () => Promise.resolve('') });
  if (/\/message$/.test(u)) return Promise.resolve(resp([]));
  if (/\/_queue/.test(u)) return Promise.resolve(resp({ items: [], count: 0 }));
  if (/\/_board/.test(u)) return Promise.resolve(resp({ tasks: [] }));
  if (/\/_ctxmap/.test(u)) return Promise.resolve(resp({ map: {} }));
  if (/\/_tasks/.test(u)) return Promise.resolve(resp({ tasks: [], counts: {} }));
  return Promise.resolve(resp({}));
}
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k,v)=>{ m[k]=String(v) }, removeItem: k=>{ delete m[k] } } };
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN,
  setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
  fetch: fetchStub, document: doc,
  navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() } },
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '', hash: '', reload(){} },
  localStorage: storage(), sessionStorage: storage(),
  alert(){}, confirm: () => true, prompt: () => null,
  EventSource: ES, WebSocket: ES, MutationObserver: class { observe(){} disconnect(){} }, ResizeObserver: class { observe(){} disconnect(){} },
  IntersectionObserver: class { observe(){} disconnect(){} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: () => 0, cancelAnimationFrame(){}, matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  history: { pushState(){}, replaceState(){} }, performance: { now: () => Date.now() },
  innerWidth: 1400, innerHeight: 900, addEventListener(){}, removeEventListener(){}, atob: s => s, btoa: s => s,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* 注入 __T：暴露被测函数（在末尾 IIFE 收尾前插入，函数均在作用域内） */
let m = ui;
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i)
  + "\n;window.__T={get S(){return S}, draftStash:draftStash, draftRestore:draftRestore, draftDrop:draftDrop, draftSwitch:draftSwitch, draftTrim:draftTrim, restoreDraft:restoreDraft, openSession:openSession};\n"
  + m.slice(_i);
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }

const tick = () => new Promise(r => setImmediate(r));
(async () => {
  await tick(); await tick(); await tick();
  const T = sandbox.__T;
  const S = T.S;
  const DIR = '/storage/Users/currentUser/project/littleDJ';
  S.sessions = []; S.projects = [{ name: 'littleDJ', path: DIR }]; S.imports = []; S.order = [];
  S.current = null; S.atts = []; S.files = []; S.drafts = {}; S.hidden = {};
  S.view = 'projects'; S.projOpen = {}; S.focusProjOpen = {}; S.convOrder = {}; S.busyBy = {};

  const mkSess = (id, title) => ({ id, title: title || id, directory: DIR, parentID: '', pwa: 1, time: { created: Date.now(), updated: Date.now() } });
  const A = mkSess('A', '会话甲'), B = mkSess('B', '会话乙');
  inputEl.value = '';

  /* ① 数据侧：stash / drop / trim */
  inputEl.value = 'hello A';
  S.atts = [{ name: 'img.png', mime: 'image/png', url: 'data:x' }];
  S.files = [{ name: 'a.txt', size: 3, mime: 'text/plain', text: 'abc' }];
  const attsRef = S.atts, filesRef = S.files;
  T.draftStash('A');
  ok('① draftStash 存 text/atts/files',
    S.drafts.A && S.drafts.A.text === 'hello A' && S.drafts.A.atts.length === 1 && S.drafts.A.files.length === 1,
    JSON.stringify(S.drafts.A));
  ok('① stash 对 atts/files 做 slice（槽与 S.atts 数组不同引用；元素浅共享=文本附件回填设计）',
    S.drafts.A.atts !== attsRef && S.drafts.A.files !== filesRef && attsRef[0].name === 'img.png');
  inputEl.value = ''; S.atts = []; S.files = [];
  T.draftStash('A');
  ok('① 空输入 stash 删槽', !S.drafts.A);

  inputEl.value = 'x'; S.drafts = {};
  T.draftDrop('A');
  ok('① draftDrop 无槽安全', !S.drafts.A);

  /* ① draftSwitch：prev≠next 存 prev、返回 next 槽；carry 非空返回 null 且不 stash */
  inputEl.value = 'A text';
  S.drafts = { B: { text: 'B draft', atts: [], files: [], at: 1 } };
  let slot = T.draftSwitch('A', 'B');
  ok('① draftSwitch 切换：prev 入槽 + 返回 next 槽', S.drafts.A && S.drafts.A.text === 'A text' && slot && slot.text === 'B draft',
    JSON.stringify({ A: S.drafts.A, slot }));
  ok('① draftSwitch 取 next 槽时刷 at（防 LRU 淘汰正在打开的旧槽）', slot.at > 1);
  let s2 = T.draftSwitch('A', 'B', { text: 'carry' });
  ok('① draftSwitch carry 非空返回 null 且不覆盖 prev 槽', s2 === null && S.drafts.A.text === 'A text');

  /* ① draftTrim：>40 淘汰最旧；附件只保最近 6 槽 */
  S.drafts = {};
  for (let i = 0; i < 45; i++) S.drafts['s' + i] = { text: 't' + i, atts: [], files: [], at: i + 1 };
  T.draftTrim();
  const keys = Object.keys(S.drafts);
  ok('① draftTrim 槽数上限 40（淘汰最旧）', keys.length === 40 && !S.drafts.s0 && !!S.drafts.s44, 'count=' + keys.length);
  S.drafts = {};
  for (let i = 0; i < 9; i++) S.drafts['t' + i] = { text: 'x', atts: [{ name: 'p' }], files: [], at: i + 1 };
  T.draftTrim();
  const withAtt = Object.keys(S.drafts).filter(k => S.drafts[k].atts.length).sort();
  ok('① draftTrim 附件只保最近 6 槽（旧槽保 text 丢附件）',
    withAtt.length === 6 && withAtt.indexOf('t3') >= 0 && withAtt.indexOf('t2') < 0 && S.drafts.t0.text === 'x', withAtt.join(','));

  /* ③ draftRestore 语义 + 红对照 */
  inputEl.value = 'stale'; S.atts = [{ name: 'old' }]; S.files = [{ name: 'old.txt' }];
  T.draftRestore(null, false);
  ok('⑥ 红对照：无槽 restore 清空输入与附件（防草稿跟人走复现）',
    inputEl.value === '' && S.atts.length === 0 && S.files.length === 0);
  inputEl.value = 'keep me'; S.atts = []; S.files = [];
  T.draftRestore(null, true);
  ok('③ keepEmpty=true 无槽不动输入框（首开/归档后保护）', inputEl.value === 'keep me');
  inputEl.value = ''; S.atts = []; S.files = [];
  T.draftRestore({ text: 'restored', atts: [{ name: 'n' }], files: [], at: 0 }, false);
  ok('③ 有槽 restore 回填 text/atts/files', inputEl.value === 'restored' && S.atts.length === 1);

  /* ② openSession 真路径 */
  S.current = A; S.atts = []; S.files = []; S.drafts = {}; S.busyBy = {};
  inputEl.value = '甲草稿'; S.atts = [{ name: 'pin', mime: 'image/png', url: 'data:y' }];
  try { T.openSession(B) } catch(e){ ok('② openSession 切 B 不抛', false, e && e.message) }
  await tick(); await tick();
  ok('② A→B：B 无槽 → 输入框空、附件清空', inputEl.value === '' && S.atts.length === 0);
  ok('② A→B：A 草稿已入槽', S.drafts.A && S.drafts.A.text === '甲草稿' && S.drafts.A.atts.length === 1, JSON.stringify(S.drafts.A));
  inputEl.value = '乙草稿';
  try { T.openSession(A) } catch(e){ ok('② openSession 切回 A 不抛', false, e && e.message) }
  await tick(); await tick();
  ok('② B→A：A 草稿原样恢复（text+附件）', inputEl.value === '甲草稿' && S.atts.length === 1 && S.atts[0].name === 'pin');
  ok('② B→A：B 草稿入槽', S.drafts.B && S.drafts.B.text === '乙草稿');
  inputEl.value = '甲草稿·续'; S.atts = [];
  try { T.openSession(A) } catch(e){ ok('② openSession 同 id 不抛', false, e && e.message) }
  await tick(); await tick();
  ok('② 同 id openSession 不覆盖输入（不 stash 不 restore）', inputEl.value === '甲草稿·续' && S.drafts.A.text === '甲草稿');

  /* ③ restoreDraft 守卫（P0-1）：非当前会话只写槽不动 DOM */
  S.current = B; inputEl.value = 'B 正在打';
  S.pending = { A: { text: 'A 的失败原文', echo: [], localId: 'p1', at: Date.now() } };
  S.drafts = {};
  try { T.restoreDraft('A') } catch(e){ ok('③ S.current≠A 时 restoreDraft 不抛', false, e && e.message) }
  ok('③ 非当前会话：只写 A 槽，不动 B 输入框', inputEl.value === 'B 正在打' && S.drafts.A && S.drafts.A.text === 'A 的失败原文',
    JSON.stringify({ v: inputEl.value, A: S.drafts.A }));
  S.current = null;
  try { T.restoreDraft('A') } catch(e){ ok('③ S.current=null 时 restoreDraft 不抛', false, e && e.message) }
  ok('③ S.current=null：不抛且槽不被二次污染', S.drafts.A.text === 'A 的失败原文');

  /* ④ 静态接线断言 */
  const srcOf = (f) => fs.readFileSync(path.join(root, 'ui/src/chat', f), 'utf8');
  const sendSrc = srcOf('send.ts'), msgSrc = srcOf('messages.ts'), handSrc = srcOf('handoff.ts'), attSrc = srcOf('attachments.ts');
  const actSrc = fs.readFileSync(path.join(root, 'ui/src/sidebar/actions.ts'), 'utf8');
  ok('④ send(): 清空后 draftDrop（try/catch 包裹）', /draftDrop\(S\.current\.id\)/.test(sendSrc) && /try\s*\{\s*draftDrop/.test(sendSrc));
  ok('④ restoreDraft: 当前会话守卫 + 非当前只写槽', /String\(S\.current\.id\)\s*===\s*id|S\.current\.id\s*===\s*sid/.test(sendSrc) && /只写.*槽|不动 DOM/.test(sendSrc));
  ok('④ openSession: draftSwitch 一次 + 同 id 不 restore',
    /draftSwitch\(/.test(msgSrc) && /_switching/.test(msgSrc) && /!S\._draftCarry/.test(msgSrc));
  ok('④ handoff: carry 分支内 draftDrop(srcSid)+draftStash', /if \(opts\.carryDraft\)\{[\s\S]{0,400}draftDrop\(srcSid\)[\s\S]{0,400}draftStash\(/.test(handSrc));
  ok('④ clearCurrentAfterRemove: 归档前 draftStash 当前会话 + 清空输入',
    /draftStash\(S\.current\.id\)/.test(actSrc) && /autoGrow\(\)/.test(actSrc));
  ok('④ addImageFile: 捕获发起 sid + 异步归属守卫（切走写回原槽）',
    /var _sid = \(S\.current && S\.current\.id\)/.test(attSrc) && /draftTrim\(\)/.test(attSrc) && /原对话草稿|写回/.test(attSrc));

  /* ⑤ 版本号三处同步（动态口径） */
  const readRel = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  const hits = [
    (html.match(/personal agent · v[0-9.]+/g) || []),
    (readRel('ui/src/app/boot.js').match(/personal agent · v[0-9.]+/g) || []),
    (readRel('ui/src/pricing/popout.js').match(/personal agent · v[0-9.]+/g) || []),
  ];
  const all = [].concat(hits[0], hits[1], hits[2]);
  ok('⑤ 版本号三处全量恰 3 处', all.length === 3, 'got=' + all.length + ' ' + all.join(' | '));
  ok('⑤ 版本号三处同值且格式四段式', all.length === 3 && all.every(x => x === all[0]) && /v\d+\.\d+\.\d+\.\d+/.test(all[0]), all.join(' | '));

  console.log('\n==== ' + (fail ? 'FAIL' : 'PASS') + ' ' + pass + ' passed, ' + fail + ' failed ====');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('RUN-FAIL', e && e.stack || e); process.exit(2) });

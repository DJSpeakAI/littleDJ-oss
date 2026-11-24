/* task187 多选保持展开原样亲测工具（无需浏览器）：node VM 跑 ui/index.html 内联脚本 + 最小 DOM stub。
   断言：进多选后已展开根的子行不再消失（旧 bug）、未展开不强展、子行点击不切会话、
        复选框仍只覆盖根会话、子行 caret 折叠/展开照常、退出多选恢复原交互。
   用法：node deploy/selftest-multisel-keepopen.js （exit 0=PASS / 1=FAIL / 2=脚本装载失败） */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.env.UI_PATH || '/storage/Users/currentUser/project/littleDJ/ui/index.html', 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, renderSidebar: renderSidebar, enterMultiSel: enterMultiSel, exitMultiSel: exitMultiSel, toggleConvOpen: toggleConvOpen, openSession: openSession };\n" + m.slice(_i);

/* ---------- DOM stub（与 selftest-sidebar-order.js 同构） ---------- */
function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag||'').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {},
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 0, innerWidth: 0,
    get classList(){ const s = e._cls; return {
      add: (...a)=>a.forEach(x=>s.add(x)), remove: (...a)=>a.forEach(x=>s.delete(x)),
      toggle:(x,f)=>{ (f===undefined? !s.has(x):f)? s.add(x):s.delete(x) }, contains:(x)=>s.has(x) } },
    get className(){ return [...e._cls].join(' ') },
    set className(v){ e._cls = new Set(String(v||'').split(/\s+/).filter(Boolean)) },
    get textContent(){ return e.children.length ? e.children.map(c=>c.textContent).join('') : e._text },
    set textContent(v){ e._text = String(v==null?'':v); e.children = [] },
    get innerHTML(){ return '' }, set innerHTML(v){ if (v === '') e.children = [] }, replaceChildren(...nodes){ e.children = []; (nodes||[]).forEach(function(n){ e.appendChild(n) }) },
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
const elCache = {};
const navBody = mkEl('div'); navBody.attrs.id = 'navBody';
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: true, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(sel){ if (sel === '#navBody') return navBody; return qsel(doc.body, sel)[0] || (elCache[sel] = elCache[sel] || (()=>{ const e = mkEl('div'); if (sel[0]==='#') e.attrs.id = sel.slice(1); return e })()) },
  querySelectorAll(sel){ if (sel.indexOf('[') >= 0) return []; return qsel(doc.body, sel) },
  getElementById(id){ if (id === 'navBody') return navBody; return elCache['#'+id] = elCache['#'+id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() },
  addEventListener(){}, removeEventListener(){},
};
function fetchStub(url, opt){
  const u = String(url);
  const resp = (obj) => ({ ok: true, status: 200, json: () => Promise.resolve(obj), text: () => Promise.resolve('') });
  if (u.indexOf('/_conv-order') >= 0 && (!opt || !opt.method || opt.method === 'GET')) return Promise.resolve(resp({ order: {} }));
  return Promise.resolve(resp({ ok: true }));
}
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k,v)=>{ m[k]=String(v) }, removeItem: k=>{ delete m[k] } } };
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
(async () => {
  await tick(); await tick(); await tick();
  const T = sandbox.__T, S = T.S, ctx = T;
  const DIR = '/storage/Users/currentUser/project/littleDJ';
  const mk = (id, title, pwa, created) => ({ id, title, pwa, directory: DIR, parentID: '', time: { created, updated: created }, childCount: 2 });
  /* B1=展开的根（有子 C1/C2）；B0=未展开的根（有子 C3） */
  /* task247：当前项目只并入今天的其它大管家根（历史空会话不刷屏），夹具时间戳改为今天，
     否则 B0（1970 年）会被口径过滤，复选框断言只剩 1 个。 */
  S.sessions = [ mk('B1','根A·已展开',1,Date.now()-1000), mk('B0','根B·未展开',1,Date.now()-2000) ];
  S.projects = [{ name: 'littleDJ', path: DIR }]; S.imports = []; S.order = [];
  S.current = S.sessions[0];
  S.view = 'projects'; S.search = ''; S.projOpen = {}; S.convOrder = {};
  S.multiSel = { on: false, ids: {}, busy: false };
  S.convOpen = { B1: 1 }; /* 根A 已展开 */
  S.children = {
    B1: [ { id: 'C1', title: '小管家任务 (@steward subagent)', agent: 'steward', parentID: 'B1', directory: DIR, time: { created: 2100, updated: 2200 } },
          { id: 'C2', title: '执笔任务 (@writer subagent)', agent: 'writer', parentID: 'B1', directory: DIR, time: { created: 2300, updated: 2400 } } ],
    B0: [ { id: 'C3', title: '御史任务 (@censor-output subagent)', agent: 'censor-output', parentID: 'B0', directory: DIR, time: { created: 1100, updated: 1200 } } ],
  };
  S.childrenLoading = {}; S.childrenErr = {}; S.childrenDirty = {}; S.hidden = {};

  const subRows = () => walk(navBody, []).filter(e => e._cls.has('conv-sub'))
    .map(e => e.dataset.sid || '').filter(Boolean);
  const checks = () => walk(navBody, []).filter(e => e._cls.has('conv-check'));
  let fail = 0;
  const A = (name, ok, extra) => { console.log('[' + name + ']', extra !== undefined ? extra + ' ' : '', ok ? 'PASS' : 'FAIL'); if (!ok) fail = 1; };

  /* ① 基线：非多选，根A 展开 → 子行 C1/C2 渲染 */
  ctx.renderSidebar();
  A('①非多选 根A子行可见', subRows().join(',').indexOf('C1') >= 0 && subRows().join(',').indexOf('C2') >= 0, subRows().join(','));

  /* ② 主诉场景：进多选 → 根A 子行保持渲染（旧 bug：强制折叠消失） */
  ctx.enterMultiSel(); await tick(); await tick();
  const sAfter = subRows();
  A('②多选 根A子行保持', sAfter.join(',').indexOf('C1') >= 0 && sAfter.join(',').indexOf('C2') >= 0, sAfter.join(','));

  /* ③ 未展开的根B：多选下不强展（C3 不出现） */
  A('③多选 根B不强展', sAfter.join(',').indexOf('C3') < 0, sAfter.join(','));

  /* ④ 复选框只覆盖根会话：2 根 = 2 个 conv-check，子行无数框 */
  A('④复选框仅根行', checks().length === 2, 'checks=' + checks().length);

  /* ⑤ 多选下点子行不切会话（openSession 不被调，S.current 不变） */
  const subRowEl = walk(navBody, []).find(e => e._cls.has('conv-sub') && e.dataset.sid === 'C1');
  let clickOk = false;
  if (subRowEl && typeof subRowEl.onclick === 'function'){ subRowEl.onclick(); clickOk = (S.current && S.current.id === 'B1'); }
  A('⑤子行点击不切会话', clickOk, 'current=' + (S.current && S.current.id));

  /* ⑥ 多选下子行 caret 折叠照常（toggleConvOpen → 子行消失；再展开恢复） */
  ctx.toggleConvOpen('B1');
  A('⑥子行caret折叠生效', subRows().indexOf('C1') < 0, subRows().join(','));
  ctx.toggleConvOpen('B1');
  A('⑥子行caret再展开', subRows().join(',').indexOf('C1') >= 0, subRows().join(','));

  /* ⑦ 根行勾选语义不变：点根行 → ids 更新 */
  const rootRow = walk(navBody, []).find(e => e._cls.has('item') && e._cls.has('conv-child') && (e.children.find(c => c._cls.has('t')) || {}).textContent.indexOf('根A') >= 0);
  let pickOk = false;
  if (rootRow && typeof rootRow.onclick === 'function'){ rootRow.onclick(); pickOk = !!S.multiSel.ids['B1']; }
  A('⑦根行点击勾选', pickOk, 'ids=' + Object.keys(S.multiSel.ids).join(','));

  /* ⑧ 退出多选：子行照常、非多选点击恢复 openSession */
  ctx.exitMultiSel(); await tick();
  A('⑧退出后子行可见', subRows().join(',').indexOf('C1') >= 0, subRows().join(','));
  const subRowEl2 = walk(navBody, []).find(e => e._cls.has('conv-sub') && e.dataset.sid === 'C1');
  let reopenOk = false;
  if (subRowEl2 && typeof subRowEl2.onclick === 'function'){ subRowEl2.onclick(); reopenOk = (S.current && S.current.id === 'C1'); }
  A('⑧退出后子行可打开', reopenOk, 'current=' + (S.current && S.current.id));

  console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS（多选保持展开原样 + 勾选语义不变）');
  process.exit(fail);
})().catch(e => { console.error('RUN-FAIL', e && e.stack || e); process.exit(2) });

/* task390 左栏「归档会话列表」亲测工具（node VM，无需浏览器）
   覆盖：①栏目渲染/默认展开 ②最近 10 条截断且最新在前 ③解析口径（不在内存的跳过/暂不可读）
        ④多选态收起 ⑤P0 防御（hiddenOrder 缺失不抛） ⑥折叠记忆 ⑦恢复成功/失败 ⑧固定红对照
   用法：node deploy/selftest-archive-list.js  （exit 0=PASS / 1=FAIL / 2=装载失败） */
const fs = require('fs'), vm = require('vm'), path = require('path');
const RAW = require('./selftest-load-ui').loadUiSource(path.join(__dirname, '..', 'ui'));
/* 主脚本是 IIFE：在收尾前注入测试钩子（闭包变量覆盖优先于 window，勿靠 window 覆盖） */
const _I = RAW.lastIndexOf('})();');
const INJ = `
;window.__ORIG_RS = renderSidebar;
window.__CALLS = { toast: '', opened: null, rs: 0 };
toast = function(t){ window.__CALLS.toast = String(t) };
openSession = function(s){ window.__CALLS.opened = s && s.id };
renderSidebar = function(){ window.__CALLS.rs++; return window.__ORIG_RS.apply(null, arguments) };
window.__T = { get S(){return S}, renderSidebar: renderSidebar, renderArchiveSection: renderArchiveSection, buildArchiveRow: buildArchiveRow, restoreSession: restoreSession };
`;
const BASE = RAW.slice(0, _I) + INJ + RAW.slice(_I);

/* ---------- DOM stub（与 selftest-sidebar-order 同源骨架） ---------- */
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
    let node = el, i = parts.length - 1;
    if (!matchesSel(node, parts[i])) return false;
    for (let j = i-1; j >= 0; j--){
      let found = false; let p = node.parent;
      while (p){ if (matchesSel(p, parts[j])){ found = true; break } p = p.parent }
      if (!found) return false;
    }
    return true;
  });
}

/* ---------- 环境构造：每个 sandbox 独立（红对照不污染主套件） ---------- */
function buildEnv(src, opts){
  opts = opts || {};
  const navBody = mkEl('div'); navBody.attrs.id = 'navBody';
  const elCache = {};
  const doc = {
    body: mkEl('body'), documentElement: mkEl('html'), hidden: false, title: '',
    createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
    querySelector(sel){ if (sel === '#navBody') return navBody; return qsel(doc.body, sel)[0] || (elCache[sel] = elCache[sel] || (()=>{ const e = mkEl('div'); if (sel[0]==='#') e.attrs.id = sel.slice(1); return e })()) },
    querySelectorAll(sel){ if (sel.indexOf('[') >= 0) return []; return qsel(doc.body, sel) },
    getElementById(id){ if (id === 'navBody') return navBody; return elCache['#'+id] = elCache['#'+id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() },
    addEventListener(){}, removeEventListener(){},
  };
  const fetchLog = [];
  const env = { hiddenMode: opts.hiddenMode || 'ok' };
  function fetchStub(url, opt){
    fetchLog.push({ url: String(url), method: (opt && opt.method) || 'GET', body: opt && opt.body });
    const u = String(url);
    const resp = (obj, ok) => ({ ok: ok !== false, status: ok === false ? 500 : 200, json: () => Promise.resolve(obj), text: () => Promise.resolve(JSON.stringify(obj)) });
    if (u.indexOf('/_hidden-sessions') >= 0 && opt && opt.method === 'POST'){
      if (env.hiddenMode === 'fail') return Promise.resolve(resp({ ok: false, error: '模拟网络失败' }, false));
      return Promise.resolve(resp({ ok: true, action: 'restore', changed: 1, hidden: [] }));
    }
    return Promise.resolve(resp({ ok: true }));
  }
  class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
  const storage = () => { const mm = {}; return { getItem: k => (k in mm ? mm[k] : null), setItem: (k,v)=>{ mm[k]=String(v) }, removeItem: k=>{ delete mm[k] } } };
  const sandbox = {
    console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN,
    setTimeout: (f)=>0, clearTimeout(){}, setInterval: ()=>0, clearInterval(){},
    fetch: fetchStub, document: doc, navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() } },
    location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '', hash: '', reload(){} },
    localStorage: storage(), sessionStorage: storage(),
    alert(t){ env.alert = String(t) }, confirm: () => true, prompt: () => null,
    EventSource: ES, WebSocket: ES, MutationObserver: class { observe(){} disconnect(){} }, ResizeObserver: class { observe(){} disconnect(){} },
    IntersectionObserver: class { observe(){} disconnect(){} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: f => 0, cancelAnimationFrame(){}, matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
    history: { pushState(){}, replaceState(){} }, performance: { now: () => Date.now() },
    innerWidth: 1400, innerHeight: 900, addEventListener(){}, removeEventListener(){}, atob: s => s, btoa: s => s,
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try { vm.runInContext(src, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }
  return { sandbox, navBody, fetchLog, env };
}
const tick = () => new Promise(r => setImmediate(r));
let pass = 0, fail = 0;
function chk(name, ok, extra){ if (ok) { pass++; console.log('  PASS', name); } else { fail++; console.log('  FAIL', name, extra == null ? '' : '| ' + extra); } }

(async () => {
  const E = buildEnv(BASE);
  await tick(); await tick(); await tick();
  const T = E.sandbox.__T, S = T.S;
  const DIR = '/storage/Users/currentUser/project/DAG_AI_Chat';
  const mk = (id, title, created) => ({ id, title, pwa: 1, directory: DIR, parentID: '', time: { created: created || 1795000000000, updated: created || 1795000000000 } });
  function reset(){
    S.sessions = []; S.children = {}; S.projects = []; S.imports = []; S.order = []; S.convOrder = {};
    S.current = null; S.view = 'projects'; S.multiSel = { on: false, ids: {}, busy: false };
    S.archiveSectOpen = true; S.tuiSectOpen = true; S.hidden = {}; S.hiddenOrder = []; S.archiveRestored = []; S._restoring = {};
  }
  const rowsOf = (frag) => frag.children.filter(c => c._cls.has('item') && c._cls.has('conv-child'));

  /* ---------- ① 基础渲染 + 默认展开 ---------- */
  reset();
  S.sessions = [mk('a','甲'), mk('b','乙'), mk('c','丙')];
  S.hidden = { a:1, b:1, c:1 }; S.hiddenOrder = ['a','b','c'];
  let frag = T.renderArchiveSection({});
  chk('① 有归档时渲染栏目', !!frag && frag.children.length === 4, frag && frag.children.length);
  chk('① 标题含总数', !!frag && frag.children[0].textContent.indexOf('归档会话列表（3）') >= 0, frag && frag.children[0].textContent);
  chk('① 默认展开显示 3 行', !!frag && rowsOf(frag).length === 3, frag && rowsOf(frag).length);

  /* ---------- ② 折叠记忆 ---------- */
  S.archiveSectOpen = false;
  frag = T.renderArchiveSection({});
  chk('② 折叠后只留标题', !!frag && frag.children.length === 1 && rowsOf(frag).length === 0);
  const head = frag.children[0];
  head.onclick();
  chk('② 点击标题翻转展开态', S.archiveSectOpen === true);
  chk('② 折叠态写 localStorage=1', E.sandbox.localStorage.getItem('littledj.archiveSectOpen') === '1', E.sandbox.localStorage.getItem('littledj.archiveSectOpen'));

  /* ---------- ③ 最近 10 条截断 + 最新在前 ---------- */
  reset();
  const ids = [], sess = [];
  for (let i = 1; i <= 12; i++){ const id = 's' + i; ids.push(id); sess.push(mk(id, '会话' + i)); }
  S.sessions = sess; S.hidden = {}; ids.forEach(id => S.hidden[id] = 1); S.hiddenOrder = ids.slice();
  frag = T.renderArchiveSection({});
  const rows = rowsOf(frag);
  chk('③ 12 条只渲染最近 10 行', rows.length === 10, rows.length);
  chk('③ 最新（尾部）排最前', rows.length && rows[0].children.find(c => c._cls.has('t')).textContent === '会话12', rows.length && rows[0].children.find(c => c._cls.has('t')).textContent);
  chk('③ 最旧截断', rows.length && rows[rows.length-1].children.find(c => c._cls.has('t')).textContent === '会话3', rows.length && rows[rows.length-1].children.find(c => c._cls.has('t')).textContent);
  chk('③ 超 10 条出现提示', frag.children.some(c => c._cls.has('proj-empty') && c.textContent.indexOf('仅显示最近 10 条') >= 0));

  /* ---------- ④ 行内容：标题 + 项目名 + 恢复按钮 ---------- */
  const r0 = rows[0];
  chk('④ 行含项目名 pill', r0.children.some(c => c._cls.has('arch-proj') && c.textContent === 'DAG_AI_Chat'), r0.textContent);
  chk('④ 行含恢复按钮', r0.children.some(c => c._cls.has('conv-restore') && c.textContent === '恢复'));

  /* ---------- ⑤ 解析口径：不在内存跳过 / 全不可解析给提示 ---------- */
  reset();
  S.sessions = [mk('x','可解析')];
  S.hidden = { x:1, ghost:1 }; S.hiddenOrder = ['x','ghost'];
  frag = T.renderArchiveSection({});
  chk('⑤ 已删除会话跳过不占行', rowsOf(frag).length === 1 && rowsOf(frag)[0].children.find(c => c._cls.has('t')).textContent === '可解析', rowsOf(frag).length);
  S.sessions = [];
  frag = T.renderArchiveSection({});
  chk('⑤ 全不可解析给暂不可读', frag.children.some(c => c._cls.has('proj-empty') && c.textContent.indexOf('不在本端列表') >= 0), frag.textContent);

  /* ---------- ⑥ P0 防御：hiddenOrder 缺失不抛 ---------- */
  reset();
  S.sessions = [mk('a','甲')]; S.hidden = { a:1 };
  delete S.hiddenOrder;
  let threw = false;
  try { frag = T.renderArchiveSection({}); } catch(e){ threw = true }
  chk('⑥ hiddenOrder 缺失不抛', threw === false);
  chk('⑥ 缺失时按不可解析提示', !threw && frag.children.some(c => c._cls.has('proj-empty') && c.textContent.indexOf('不在本端列表') >= 0));

  /* ---------- ⑦ 空归档 / 多选态 ---------- */
  reset();
  chk('⑦ 空归档不渲染栏目', T.renderArchiveSection({}) === null);
  S.sessions = [mk('a','甲')]; S.hidden = { a:1 }; S.hiddenOrder = ['a']; S.multiSel.on = true;
  chk('⑦ 多选态收起栏目', T.renderArchiveSection({}) === null);
  S.multiSel.on = false;

  /* ---------- ⑧ 恢复成功（有当前会话：只恢复不打开） ---------- */
  reset();
  S.sessions = [mk('a','甲'), mk('b','乙')]; S.hidden = { a:1, b:1 }; S.hiddenOrder = ['a','b'];
  S.current = S.sessions[0];
  E.sandbox.__CALLS = { toast: '', opened: null, rs: 0 };
  const rsBefore = E.fetchLog.length;
  T.restoreSession(S.sessions[1]);
  await tick(); await tick();
  const post = E.fetchLog.slice(rsBefore).filter(f => f.url.indexOf('/_hidden-sessions') >= 0 && f.method === 'POST')[0];
  const body = post && JSON.parse(post.body);
  chk('⑧ 发 POST restore 且 ids 正确', !!(body && body.action === 'restore' && body.ids && body.ids.length === 1 && body.ids[0] === 'b'), post && post.body);
  chk('⑧ 本地 hidden 移除', !S.hidden.b);
  chk('⑧ 本地 hiddenOrder 移除', S.hiddenOrder.join(',') === 'a');
  chk('⑧ 有当前会话时不打开', E.sandbox.__CALLS.opened === null);
  chk('⑧ toast 文案含标题', E.sandbox.__CALLS.toast.indexOf('已恢复：乙') >= 0, E.sandbox.__CALLS.toast);
  chk('⑧ renderSidebar 计数 +1', E.sandbox.__CALLS.rs === 1, E.sandbox.__CALLS.rs);
  chk('⑧ 刚恢复临时行入列', (S.archiveRestored || []).some(function(x){ return x.id === 'b' }), JSON.stringify((S.archiveRestored||[]).map(function(x){return x.id})));

  /* ---------- ⑨ 恢复成功（无当前会话：兜底打开） ---------- */
  reset();
  S.sessions = [mk('a','甲')]; S.hidden = { a:1 }; S.hiddenOrder = ['a']; S.current = null;
  E.sandbox.__CALLS = { toast: '', opened: null, rs: 0 };
  T.restoreSession(S.sessions[0]);
  await tick(); await tick();
  chk('⑨ 无当前会话时兜底打开', E.sandbox.__CALLS.opened === 'a');

  /* ---------- ⑩ 恢复失败：不假装成功 ---------- */
  reset();
  S.sessions = [mk('a','甲')]; S.hidden = { a:1 }; S.hiddenOrder = ['a'];
  E.env.hiddenMode = 'fail';
  E.sandbox.__CALLS = { toast: '', opened: null, rs: 0 };
  T.restoreSession(S.sessions[0]);
  await tick(); await tick();
  chk('⑩ 失败不改本地 hidden', S.hidden.a === 1 && S.hiddenOrder.join(',') === 'a');
  chk('⑩ 失败不提示已恢复', E.sandbox.__CALLS.toast.indexOf('已恢复') < 0);
  chk('⑩ 失败走 alert 报错', (E.env.alert || '').indexOf('恢复失败') >= 0, E.env.alert);
  E.env.hiddenMode = 'ok';

  /* ---------- ⑩B 刚恢复临时行（产出审 P1-1）：可达入口 + 二次点击打开 ---------- */
  reset();
  S.sessions = [mk('ghost','历史会话')]; S.hidden = {}; S.hiddenOrder = [];
  S.archiveRestored = [S.sessions[0]];
  frag = T.renderArchiveSection({});
  const rrow = frag && frag.children.filter(c => c._cls.has('arch-restored'))[0];
  chk('⑩B 刚恢复行渲染', !!rrow, frag && frag.children.map(c=>c.className).join('|'));
  chk('⑩B 行含「已恢复」与打开按钮', !!rrow && rrow.textContent.indexOf('已恢复：') >= 0 && rrow.children.some(c => c._cls.has('conv-restore') && c.textContent === '打开'));
  E.sandbox.__CALLS = { toast: '', opened: null, rs: 0 };
  const openBtn = rrow && rrow.children.find(c => c._cls.has('conv-restore'));
  openBtn.onclick({ stopPropagation(){} });
  chk('⑩B 点打开调 openSession', E.sandbox.__CALLS.opened === 'ghost', E.sandbox.__CALLS.opened);
  chk('⑩B 打开后临时行移除', (S.archiveRestored || []).length === 0, (S.archiveRestored||[]).length);

  /* ---------- ⑪ 源码锚：renderSidebar 挂载顺序（归档在 TUI 前） ---------- */
  const srcRows = fs.readFileSync(path.join(__dirname, '..', 'ui', 'src', 'sidebar', 'rows.ts'), 'utf8');
  const iArch = srcRows.indexOf('var archFrag = renderArchiveSection(ctx)');
  const iTui = srcRows.indexOf('if (tuiFrag) body.appendChild(tuiFrag)');
  chk('⑪ 归档区挂载在 TUI 分区之前', iArch >= 0 && iTui >= 0 && iArch < iTui, 'arch@' + iArch + ' tui@' + iTui);

  /* ---------- ⑫ 红对照（固定一种）：ARCHIVE_LIST_MAX 10→11 必须让「只渲染 10 行」失败 ---------- */
  const rcSrc = BASE.split('var ARCHIVE_LIST_MAX = 10;').join('var ARCHIVE_LIST_MAX = 11;');
  let rcOk = false;
  try {
    const R = buildEnv(rcSrc);
    await tick(); await tick();
    const S2 = R.sandbox.__T.S;
    S2.sessions = []; S2.children = {}; S2.projects = []; S2.imports = []; S2.order = []; S2.convOrder = {};
    S2.current = null; S2.view = 'projects'; S2.multiSel = { on: false, ids: {}, busy: false };
    S2.archiveSectOpen = true; S2.tuiSectOpen = true; S2.hidden = {}; S2.hiddenOrder = [];
    const ids2 = [], sess2 = [];
    for (let i = 1; i <= 12; i++){ const id = 'r' + i; ids2.push(id); sess2.push({ id, title: 'R' + i, pwa: 1, directory: DIR, parentID: '', time: { created: 1, updated: 1 } }) }
    S2.sessions = sess2; ids2.forEach(id => S2.hidden[id] = 1); S2.hiddenOrder = ids2.slice();
    const f2 = R.sandbox.__T.renderArchiveSection({});
    const n2 = f2.children.filter(c => c._cls.has('item') && c._cls.has('conv-child')).length;
    rcOk = (n2 !== 10); /* 改 11 后渲染 11 行 → 证明原断言「10 行」有牙齿 */
    console.log('  [红对照] ARCHIVE_LIST_MAX=11 时渲染行数=' + n2 + '（期望 !=10 → ' + (rcOk ? '已证 FAIL 有效' : '红对照失效') + '）');
  } catch(e){ rcOk = false; console.log('  [红对照] 装载失败', e && e.message) }
  chk('⑫ 红对照已验（预期 FAIL 生效）', rcOk);

  console.log('\n== task390 归档会话列表自测：' + pass + ' 通过 / ' + fail + ' 失败 ==');
  process.exit(fail ? 1 : 0);
})();

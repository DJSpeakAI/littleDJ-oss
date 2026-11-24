/* task178 拖拽加载文件专项自测（node VM 装载 ui/index.html 真代码 + DOM/FileReader stub）
   覆盖：文件分类判定 / 大小与数量闸 / 附件落位 / 拼装正文顺序 / hasFilesTypes 容错 / qAutoGrow 安全
   用法：node deploy/selftest-file-drop.js   （exit 0=PASS / 1=断言失败 / 2=装载失败）
   红对照：UI_PATH=旧版 node deploy/selftest-file-drop.js → LOAD-FAIL(2)（旧版无 handleDropFiles 等符号） */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.env.UI_PATH || '/storage/Users/currentUser/project/littleDJ/ui/index.html', 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, isTextFile: isTextFile, addTextFile: addTextFile, fmtKB: fmtKB, handleDropFiles: handleDropFiles, hasFilesTypes: hasFilesTypes, qAutoGrow: qAutoGrow, queuePrompt: queuePrompt, send: send };\n" + m.slice(_i);

/* ---------- DOM stub（复用 selftest-sidebar-order 骨架，精简） ---------- */
function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag||'').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {},
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 0,
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
  for (const s of segs){
    if (s[0] === '#'){ if (el.attrs.id !== s.slice(1)) return false }
    else if (s[0] === '.'){ if (!el._cls.has(s.slice(1))) return false }
    else { if (el.tagName !== s.toUpperCase()) return false }
  }
  return true;
}
function walk(el, out){ out = out || []; el.children.forEach(c=>{ out.push(c); walk(c, out) }); return out }
function qsel(root, sel){
  const parts = sel.split(/\s+/).filter(Boolean);
  return walk(root, []).filter(el => {
    let node = el, i = parts.length - 1;
    if (!matchesSel(node, parts[i])) return false;
    for (let j = i-1; j >= 0; j--){ let found = false, p = node.parent;
      while (p){ if (matchesSel(p, parts[j])){ found = true; break } p = p.parent } if (!found) return false }
    return true;
  });
}
const elCache = {};
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: true, title: '', activeElement: null,
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(sel){ return qsel(doc.body, sel)[0] || (elCache[sel] = elCache[sel] || (()=>{ const e = mkEl('div'); if (sel[0]==='#') e.attrs.id = sel.slice(1); return e })()) },
  querySelectorAll(sel){ if (sel.indexOf('[') >= 0) return []; return qsel(doc.body, sel) },
  getElementById(id){ return elCache['#'+id] = elCache['#'+id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() },
  addEventListener(){}, removeEventListener(){},
};
const fetchLog = [];
function fetchStub(url, opt){
  fetchLog.push({ url: String(url), method: (opt && opt.method) || 'GET', body: opt && opt.body });
  const resp = (obj) => ({ ok: true, status: 200, json: () => Promise.resolve(obj), text: () => Promise.resolve('') });
  return Promise.resolve(resp({ ok: true, data: [] }));
}
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
class FR { /* FileReader stub：readAsText 读 __text，异步回 onload */
  constructor(){ this.result = null; this.onload = null; this.onerror = null }
  readAsText(f){ this.result = (f && f.__text != null) ? f.__text : ('内容:' + ((f && f.name) || '')); const s = this; setImmediate(()=>{ if (s.onload) s.onload({ target: { result: s.result } }) }) }
  readAsDataURL(f){ this.result = 'data:' + ((f && f.type) || 'image/png') + ';base64,AA'; const s = this; setImmediate(()=>{ if (s.onload) s.onload({ target: { result: s.result } }) }) }
}
const storage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k,v)=>{ m[k]=String(v) }, removeItem: k=>{ delete m[k] } } };
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN, setTimeout: (f)=>0, clearTimeout(){}, setInterval: ()=>0, clearInterval(){},
  fetch: fetchStub, document: doc, navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() } },
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '', hash: '', reload(){} },
  localStorage: storage(), sessionStorage: storage(),
  alert(){}, confirm: () => true, prompt: () => null, FileReader: FR,
  EventSource: ES, WebSocket: ES, MutationObserver: class { observe(){} disconnect(){} }, ResizeObserver: class { observe(){} disconnect(){} },
  IntersectionObserver: class { observe(){} disconnect(){} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: f => 0, cancelAnimationFrame(){}, matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  history: { pushState(){}, replaceState(){} }, performance: { now: () => Date.now() },
  innerWidth: 1400, innerHeight: 900, addEventListener(){}, removeEventListener(){}, atob: s => s, btoa: s => s,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', (e && e.stack) || e); process.exit(2) }

const tick = () => new Promise(r => setImmediate(r));
let fails = 0;
const ok = (name, cond) => { if (!cond) fails++; console.log((cond ? 'PASS' : 'FAIL') + ' ' + name) };
function mkFile(name, size, opts){
  opts = opts || {};
  return { name, size: size == null ? 10 : size, type: opts.type != null ? opts.type : '', __text: opts.text };
}
(async () => {
  await tick(); await tick(); await tick();
  const T = sandbox.__T, S = T.S;
  const DIR = '/storage/Users/currentUser/project/littleDJ';

  /* ① isTextFile 分类 */
  ok('①1 .md 入白名单', T.isTextFile(mkFile('a.md')));
  ok('①2 .txt 入白名单', T.isTextFile(mkFile('b.txt')));
  ok('①3 .py 入白名单', T.isTextFile(mkFile('c.py')));
  ok('①4 text/* mime 兜底', T.isTextFile(mkFile('noext', 10, { type: 'text/plain' })));
  ok('①5 图片拒收', !T.isTextFile(mkFile('x.png', 10, { type: 'image/png' })));
  ok('①6 pdf 拒收', !T.isTextFile(mkFile('y.pdf')));
  ok('①7 无扩展名无 mime 拒收', !T.isTextFile(mkFile('noext2')));

  /* ② fmtKB */
  ok('②1 512B', T.fmtKB(512) === '512 B');
  ok('②2 2KB', T.fmtKB(2048) === '2 KB');
  ok('②3 1.5MB', T.fmtKB(1572864) === '1.5 MB');

  /* ③ 大小/数量闸 + 附件落位 */
  S.files = []; S.atts = [];
  S.current = { id: 'S1', directory: DIR, title: 't', pwa: 1, time: { created: 1, updated: 1 } };
  S.files = [];
  T.addTextFile(mkFile('big.md', 256 * 1024 + 1));
  await tick();
  ok('③1 超 256KB 拒收', S.files.length === 0);
  T.addTextFile(mkFile('ok.md', 100, { text: '# hi' }));
  await tick();
  ok('③2 正常加入 S.files', S.files.length === 1 && S.files[0].name === 'ok.md' && S.files[0].text === '# hi');
  for (let i = 0; i < 6; i++) T.addTextFile(mkFile('f' + i + '.txt', 10, { text: 'x' }));
  await tick(); await tick();
  ok('③3 上限 5 个（6 次加入后仍 5）', S.files.length === 5);

  /* ④ handleDropFiles 无会话不加载 */
  S.files = []; S.current = null;
  T.handleDropFiles([mkFile('a.md', 10, { text: 'x' })]);
  await tick();
  ok('④1 无当前会话不加载', S.files.length === 0);

  /* ⑤ 拼装正文顺序：引用 > 正文 > 文件块（queuePrompt → 发出的 parts[0].text） */
  S.current = { id: 'S1', directory: DIR, title: 't', pwa: 1, time: { created: 1, updated: 1 } };
  S.quote = { text: '引用内容', at: Date.now() };
  S.files = []; fetchLog.length = 0;
  T.queuePrompt('正文内容', [], [{ name: 'a.md', text: 'AAA' }, { name: 'b.txt', text: 'BBB' }]);
  await tick(); await tick(); await tick();
  const hit = fetchLog.filter(f => f.body && String(f.body).indexOf('--- 文件：a.md ---') >= 0)[0];
  let sent = '';
  try { sent = String(JSON.parse(hit.body).parts[0].text || '') } catch(e){ sent = '' }
  const iq = sent.indexOf('引用内容'), it = sent.indexOf('正文内容'), ia = sent.indexOf('--- 文件：a.md ---'), ib = sent.indexOf('--- 文件：b.txt ---');
  ok('⑤1 发出请求含文件块', !!hit);
  ok('⑤2 顺序=引用>正文>文件a>文件b', iq >= 0 && it > iq && ia > it && ib > ia);
  ok('⑤3 单 text part（不新增独立 text part）', !hit || JSON.parse(hit.body).parts.filter(p => p.type === 'text').length === 1);

  /* ⑥ hasFilesTypes 容错（数组 / DOMStringList 风格 / null） */
  ok('⑥1 数组含 Files', T.hasFilesTypes(['Files']));
  ok('⑥2 类 DOMStringList contains', T.hasFilesTypes({ contains: x => x === 'Files', length: 1 }));
  ok('⑥3 null 安全', !T.hasFilesTypes(null));
  ok('⑥4 空数组', !T.hasFilesTypes([]));

  /* ⑦ qAutoGrow 安全（无 style 元素不抛错） */
  let grew = true;
  try { T.qAutoGrow(null); T.qAutoGrow({}) } catch(e){ grew = false }
  ok('⑦1 null/空对象不抛错', grew);

  /* ⑧ send 空守卫：无文本无图但有文本附件 → 应放行（不 return） */
  S.files = [{ name: 'x.md', size: 10, text: 'Z' }]; S.atts = [];
  const inputEl = sandbox.document.getElementById('input');
  inputEl.value = '';
  fetchLog.length = 0;
  T.send();
  await tick(); await tick();
  ok('⑧1 纯文本附件可发送（有请求发出）', fetchLog.some(f => f.body && String(f.body).indexOf('--- 文件：x.md ---') >= 0));
  ok('⑧2 发送后 S.files 已清空', S.files.length === 0);

  console.log(fails === 0 ? 'RESULT: PASS' : ('RESULT: FAIL(' + fails + ')'));
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('RUNTIME-FAIL', (e && e.stack) || e); process.exit(2) });

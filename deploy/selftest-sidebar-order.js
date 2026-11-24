/* task146 左栏排序亲测工具（无需浏览器）：在 node VM 里跑 ui/index.html 内联脚本 + 最小 DOM stub，
   直接调用 renderSidebar / dragConvTo / 排序模式，断言「拖完顺序是否真的变了」与「是否发出 /_conv-order」。
   用法：node deploy/selftest-sidebar-order.js  （exit 0=PASS / 1=FAIL / 2=脚本装载失败）
   注意：脚本内含 IIFE 注入钩子（window.__T），改 ui 结构时若钩子行号变动需同步 __T 导出函数名。 */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.env.UI_PATH || '/storage/Users/currentUser/project/littleDJ/ui/index.html', 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
/* 主脚本是 IIFE：在收尾前注入测试钩子 */
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, renderSidebar: renderSidebar, dragConvTo: dragConvTo, enterSortMode: enterSortMode, moveConv: moveConv, exitSortMode: exitSortMode, openSession: openSession, togglePinConv: togglePinConv, convPins: convPins, isPinnedConv: isPinnedConv };\n" + m.slice(_i);

/* ---------- DOM stub ---------- */
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
  const tok = part.replace(/\[.*?\]/g,'').match(/^([a-zA-Z0-9-]*)([#.][\w-]+)*$/);
  if (part.indexOf('[') >= 0) return false; /* 属性选择器不测 */
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
  return all.filter(el => { /* 只支持「祖先链 + 末段」近似匹配（本项目够用） */
    let node = el, i = parts.length - 1;
    if (!matchesSel(node, parts[i])) return false;
    for (let j = i-1; j >= 0; j--){
      let found = false; let p = node.parent;
      while (p){ if (matchesSel(p, parts[j])){ found = true; break } p = p.parent }
      if (!found) return false; node = node;
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
const fetchLog = [];
function fetchStub(url, opt){
  fetchLog.push({ url: String(url), method: (opt && opt.method) || 'GET', body: opt && opt.body });
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
  const mk = (id, title, pwa, created) => ({ id, title, pwa, directory: DIR, parentID: '', time: { created, updated: created } });
  S.sessions = [ mk('B0','Butler0',1,1000), mk('B1','Butler1',1,2000), mk('T1','TuiS1',0,3000), mk('T2','TuiS2',0,4000), mk('T3','TuiS3',0,5000) ];
  S.projects = [{ name: 'littleDJ', path: DIR }]; S.imports = []; S.order = [];
  S.current = S.sessions[1]; /* B1 为当前根（focus 视图） */
  S.view = 'projects'; S.tuiSectOpen = true; S.projOpen = {}; S.multiSel = { on:false, ids:{}, busy:false };
  ctx.renderSidebar();
  const rowsOf = () => walk(navBody, []).filter(e => e._cls.has('item') && e._cls.has('conv-child'))
    .map(e => e.children.find(c => c._cls.has('t'))?.textContent || '?').filter(t => t !== '?');
  console.log('[初始顺序]', rowsOf().join(' | '));
  /* 回归①：大管家行互拖（应仍然生效） */
  ctx.dragConvTo('B0', 'B1', true); /* B0 拖到 B1 之后，顺序应变为 B1,B0 */
  await tick();
  console.log('[拖 B0→B1 后]', rowsOf().join(' | '));
  const butlerOk = rowsOf().filter(t => t.indexOf('大管家') === 0)[0] === '大管家 · Butler1';
  /* 模拟：把 T3 拖到 T1 之后（drop → dragConvTo('T3','T1',true)） */
  ctx.dragConvTo('T3', 'T1', true);
  await tick();
  console.log('[拖 T3→T1 后]', rowsOf().join(' | '));
  const posts = fetchLog.filter(f => f.url.indexOf('/_conv-order') >= 0 && f.method === 'POST');
  console.log('[POST /_conv-order]', JSON.stringify(posts.map(p => p.body)));
  const tui = rowsOf().filter(t => t.indexOf('TUI') === 0);
  /* 回归②：TUI 排序模式（↑↓） */
  ctx.enterSortMode('__tui__');
  /* P1-2：「完成」按钮必须出现在 TUI 分区标题上（手机端无 ESC 的退出通道） */
  const doneBtn = walk(navBody, []).some(e => e.children.some(c => c._cls.has('sort-done')));
  const tuiRows = walk(navBody, []).filter(e => e._cls.has('item') && e._cls.has('conv-child') && (e.children.find(c=>c._cls.has('t'))||{}).textContent && (e.children.find(c=>c._cls.has('t')).textContent).indexOf('TUI') === 0);
  const hasMv = tuiRows.length && tuiRows.every(r => r.children.some(c => c._cls.has('sort-mv')));
  const before = rowsOf().filter(t=>t.indexOf('TUI')===0).join(',');
  ctx.moveConv('T3', -1); /* T3 上移一位：T1,T3,T2 → T3,T1,T2 */
  const after = rowsOf().filter(t=>t.indexOf('TUI')===0).join(',');
  ctx.exitSortMode('__tui__');
  await tick();
  const mvOk = rowsOf().filter(t=>t.indexOf('TUI')===0).join(',') !== before;
  /* P1-2：「完成」按钮必须出现在 TUI 分区标题上（手机端无 ESC 的退出通道） */
  console.log('[TUI 排序模式] ↑↓渲染=' + (hasMv?'PASS':'FAIL') + ' | 上移前=' + before + ' | 上移后=' + after + ' | 变动=' + (mvOk?'PASS':'FAIL') + ' | 完成按钮=' + (doneBtn?'PASS':'FAIL'));
  /* ---------- task147 场景③：新建会话（排序表外）置顶 + 拖拽转正 + TUI 区同语义 ---------- */
  const posts3before = fetchLog.filter(f => f.url.indexOf('/_conv-order') >= 0 && f.method === 'POST').length;
  S.convOrder = { 'littleDJ': ['B1','B0'] }; /* 模拟主人排过序：B1,B0 */
  /* task247：当前项目只并入「今天」的其它大管家根（历史空会话不再刷屏），夹具时间戳必须是今天，
     否则会被口径过滤成 0 行（旧夹具用 1000/2000/9000 毫秒=1970 年）。 */
  const N3 = Date.now();
  S.sessions = [ mk('B0','Butler0',1,N3-9000), mk('B1','Butler1',1,N3-5000), mk('B2','NewButler',1,N3-1000),
                 mk('T1','TuiS1',0,N3-8000), mk('T2','TuiS2',0,N3-7000), mk('T3','TuiS3',0,N3-6000) ]
    .sort((a,b)=>b.time.created-a.time.created); /* loadSessions 同款 created 降序 */
  S.current = S.sessions.find(x=>x.id==='B1'); /* B1 当前根（focus 视图） */
  ctx.renderSidebar();
  const butlerRows3 = rowsOf().filter(t => t.indexOf('大管家') === 0);
  const newTopOk = butlerRows3.length === 3 && butlerRows3[0] === '大管家 · NewButler' && butlerRows3[1] === '大管家 · Butler1' && butlerRows3[2] === '大管家 · Butler0';
  console.log('[场景③ 置顶]', butlerRows3.join(' | '), newTopOk ? 'PASS' : 'FAIL');
  /* 拖转正：B2（表外新建）拖到 B1 前 → 不再 toast 拒绝，POST 表应为 B2,B1,B0 */
  ctx.dragConvTo('B2', 'B1', false);
  await tick();
  const posts3 = fetchLog.filter(f => f.url.indexOf('/_conv-order') >= 0 && f.method === 'POST').slice(posts3before);
  const body3 = posts3.length ? JSON.parse(posts3[posts3.length-1].body) : null;
  const dragOk = !!(body3 && body3.ids && body3.ids.join(',') === 'B2,B1,B0');
  console.log('[场景③ 拖转正 POST]', JSON.stringify(body3 && body3.ids || null), dragOk ? 'PASS' : 'FAIL');
  /* TUI 区表外置顶：__tui__ 表 [T2,T1]，T3 表外 → 应置顶，表内保持 T2,T1 */
  S.convOrder['__tui__'] = ['T2','T1'];
  ctx.renderSidebar();
  const tuiRows3 = rowsOf().filter(t => t.indexOf('TUI') === 0);
  const tuiTopOk = tuiRows3.length === 3 && tuiRows3[0] === 'TUI · TuiS3' && tuiRows3[1] === 'TUI · TuiS2' && tuiRows3[2] === 'TUI · TuiS1';
  console.log('[场景③ TUI 置顶]', tuiRows3.join(' | '), tuiTopOk ? 'PASS' : 'FAIL');
  /* ---------- task161 场景④：项目列表恒可见（焦点视图 / 无当前会话 两态都要能看见所有项目） ---------- */
  const projRowsOf = () => walk(navBody, []).filter(e => e._cls.has('item') && !e._cls.has('conv-child'))
    .map(e => (e.children.find(c => c._cls.has('t')) || {}).textContent || '').filter(t => !!t);
  const DIR2 = '/storage/Users/currentUser/project/others';
  S.projects = [{ name: 'littleDJ', path: DIR }, { name: 'others', path: DIR2 }];
  S.imports = []; S.order = []; S.convOrder = {}; S.projOpen = {};
  S.sessions = [ mk('B1', 'Butler1', 1, 2000) ];
  S.current = S.sessions[0]; /* 当前会话在 littleDJ，others 无会话 */
  ctx.renderSidebar();
  const pr4a = projRowsOf();
  const focusBothOk = pr4a.indexOf('littleDJ') >= 0 && pr4a.indexOf('others') >= 0;
  /* P2-2（御史）：empty 态 + 残留展开项目（S.projOpen）→ 原 1940 行 ctx.root.virtual 会崩，必须不抛错 */
  S.projOpen = { 'littleDJ': true, 'others': true };
  S.current = null; /* 无当前会话态 */
  let crash4 = false;
  try { ctx.renderSidebar() } catch(e){ crash4 = true; console.log('[场景④ 崩溃]', e && e.message) }
  const pr4b = projRowsOf();
  const emptyBothOk = !crash4 && pr4b.indexOf('littleDJ') >= 0 && pr4b.indexOf('others') >= 0;
  const projVisOk = focusBothOk && emptyBothOk;
  console.log('[场景④ 焦点视图两项目]', pr4a.join(' | '), focusBothOk ? 'PASS' : 'FAIL');
  console.log('[场景④ 无会话两项目]', pr4b.join(' | '), emptyBothOk ? 'PASS' : 'FAIL');
  /* ---------- task168/172 场景⑤：聚焦视图非当前项目展开态（默认收起 + 主人掌控） ----------
     task168：点 others 会话 → littleDJ 不再读持久 projOpen 全量刷屏（图1 bug）；
     task172：切会话不再清空展开态——刚离开的项目保持展开（主人定「我让它折叠才折叠」），
     focusProjOpen 持久化 localStorage，手动收起后不被擅自翻开。 */
  const projRowEl = (name) => walk(navBody, []).find(e => e._cls.has('item') && !e._cls.has('conv-child') && ((e.children.find(c => c._cls.has('t')) || {}).textContent === name));
  const convRows5 = () => walk(navBody, []).filter(e => e._cls.has('item') && e._cls.has('conv-child'))
    .map(e => (e.children.find(c => c._cls.has('t')) || {}).textContent || '').filter(t => !!t);
  const DIR2b = '/storage/Users/currentUser/project/others';
  const mkIn = (id, title, created, dir) => ({ id, title, pwa: 1, directory: dir, parentID: '', time: { created, updated: created } });
  S.projects = [{ name: 'littleDJ', path: DIR }, { name: 'others', path: DIR2b }];
  S.imports = []; S.order = []; S.convOrder = {}; S.sortProj = null; S.multiSel = { on:false, ids:{}, busy:false };
  const _now5 = Date.now();
  S.sessions = [ mkIn('B1', 'Butler1', _now5 - 60000, DIR), mkIn('O1', 'Other1', _now5 - 30000, DIR2b), mkIn('O2', 'Other2', _now5 - 10000, DIR2b) ];
  S.projOpen = { littleDJ: true, others: true }; /* 模拟被污染的持久残留——旧版在此全量展开 littleDJ=图1 bug */
  S.focusProjOpen = {};
  S.current = S.sessions[1]; /* 当前会话在 others（复现主人操作） */
  ctx.renderSidebar();
  const r5 = convRows5();
  const othersOnlyOk = r5.join('|').indexOf('Other1') >= 0 && r5.join('|').indexOf('Butler1') < 0;
  console.log('[场景⑤ 点others会话后]', r5.join(' | '), othersOnlyOk ? 'PASS' : 'FAIL');
  const head5 = projRowEl('littleDJ');
  let expandOk = false, collapseOk = false, keepOpenOk = false, noReopenOk = false, persistOk = false;
  if (head5 && typeof head5.onclick === 'function'){
    head5.onclick(); /* 手动展开 littleDJ：应显示其会话、且持久 projOpen 不被翻转 */
    const r5b = convRows5();
    expandOk = r5b.join('|').indexOf('Butler1') >= 0 && S.projOpen.littleDJ === true;
    console.log('[场景⑤ 手动展开littleDJ]', r5b.join(' | '), expandOk ? 'PASS' : 'FAIL');
    projRowEl('littleDJ').onclick(); /* 再点收起 */
    const r5c = convRows5();
    collapseOk = r5c.join('|').indexOf('Butler1') < 0;
    console.log('[场景⑤ 再点收起]', collapseOk ? 'PASS' : 'FAIL');
    ctx.openSession(S.sessions[0]); /* 切回 littleDJ 会话（task172）：others 是刚离开的项目 → 保持展开 */
    await tick(); await tick();
    const r5d = convRows5();
    keepOpenOk = r5d.join('|').indexOf('Butler1') >= 0 && r5d.join('|').indexOf('Other1') >= 0 && S.focusProjOpen.others === true;
    console.log('[场景⑤ 切回littleDJ，others保持展开]', r5d.join(' | '), keepOpenOk ? 'PASS' : 'FAIL');
    /* task172：主人切去 others 后手动收起 littleDJ，再在 others 内部切换会话（O1→O2）→ littleDJ 不被擅自翻开 */
    ctx.openSession(S.sessions[1]); /* 去 others 的 O1（leaving=littleDJ → 保持展开） */
    await tick(); await tick();
    projRowEl('littleDJ') && projRowEl('littleDJ').onclick(); /* 主人手动收起 littleDJ（非当前 → true→false） */
    const collapsedLj = convRows5().join('|').indexOf('Butler1') < 0;
    ctx.openSession(S.sessions[2]); /* others 内部切换 O1→O2：leaving=others 自身 → littleDJ 不动 */
    await tick(); await tick();
    const r5e = convRows5();
    noReopenOk = collapsedLj && r5e.join('|').indexOf('Butler1') < 0 && !S.focusProjOpen.littleDJ;
    console.log('[场景⑤ 手动收起后不被擅自翻开]', r5e.join(' | '), noReopenOk ? 'PASS' : 'FAIL');
    persistOk = false;
    try { persistOk = JSON.parse(sandbox.localStorage.getItem('littledj.focusProjOpen') || '{}').littleDJ === false } catch(e){}
    console.log('[场景⑤ focusProjOpen 已持久化]', persistOk ? 'PASS' : 'FAIL');
  } else { console.log('[场景⑤ 分组标题未找到 onclick，无法测] FAIL'); }
  const scene5Ok = othersOnlyOk && expandOk && collapseOk && keepOpenOk && noReopenOk && persistOk;
  /* ---------- task171 场景⑥：非当前项目点开只列「今天」的会话，数字=实际行数 ----------
     主人 2026-11-10：「在 others 选中 07:20 的会话，再点开 littleDJ 的项目，就出现这个（一堆 11-9/11-4 的老会话）」。
     口径：聚焦视图下非当前项目只列今天的大管家会话；无当前会话态同口径（task342：搜索入口退役，遗留 S.search 也不放量历史）；
     「N 对话」= 展开后实际行数（当前项目=当前对话树；非当前=今天的会话）。 */
  const dirLj = DIR, dirOt = '/storage/Users/currentUser/project/others';
  const mkP = (id, title, pwa, created, dir) => ({ id, title, pwa, directory: dir, parentID: '', time: { created, updated: created } });
  const cnt6 = (name) => { const r = projRowEl(name); const mEl = r && r.children.find(c => c._cls.has('m')); return mEl ? Number(String(mEl.textContent).replace(/[^\d]/g, '')) : NaN };
  const NOW6 = Date.now(), YDAY6 = NOW6 - 26 * 3600 * 1000; /* 26 小时前 = 昨天（必定不是今天） */
  S.projects = [{ name: 'littleDJ', path: dirLj }, { name: 'others', path: dirOt }];
  S.imports = []; S.order = []; S.convOrder = {}; S.sortProj = null; S.multiSel = { on:false, ids:{}, busy:false };
  S.focusProjOpen = {}; S.projOpen = {};
  S.sessions = [ mkP('B1','ButlerToday',1,NOW6-60000,dirLj), mkP('Y1','ButlerYest',1,YDAY6,dirLj),
                 mkP('T1','TuiS1',0,NOW6-40000,dirLj), mkP('O1','Other1',1,NOW6-30000,dirOt) ];
  S.current = S.sessions[3]; /* 当前在 others，littleDJ 为非当前项目（主人报障场景） */
  ctx.renderSidebar();
  const cntLj = cnt6('littleDJ'), cntOt = cnt6('others');
  const focusCountOk = cntLj === 1 && cntOt === 1; /* littleDJ 只有今天的 1 条；昨天的 Y1 不计 */
  console.log('[场景⑥ 聚焦视图计数] littleDJ=' + cntLj + ' others=' + cntOt, focusCountOk ? 'PASS' : 'FAIL');
  projRowEl('littleDJ').onclick(); /* 点开非当前项目：只该出现今天的会话 */
  const rows6 = convRows5().join('|');
  const noOldOk = rows6.indexOf('ButlerToday') >= 0 && rows6.indexOf('ButlerYest') < 0;
  console.log('[场景⑥ 点开非当前项目]', rows6.replace(/\|/g, ' | ').slice(0, 120), noOldOk ? 'PASS' : 'FAIL');
  S.current = null; /* 无当前会话态：同口径 */
  ctx.renderSidebar();
  const rows6b = convRows5().join('|');
  const emptyOk = cnt6('littleDJ') === 1 && rows6b.indexOf('ButlerYest') < 0;
  console.log('[场景⑥ 无会话态] littleDJ=' + cnt6('littleDJ') + ' 含昨天会话=' + (rows6b.indexOf('ButlerYest') >= 0), emptyOk ? 'PASS' : 'FAIL');
  S.search = 'yest'; /* task342：搜索入口退役——即使遗留字段仍在，过滤链已删，历史不得被放量 */
  ctx.renderSidebar();
  const searchRetiredOk = convRows5().join('|').indexOf('ButlerYest') < 0;
  delete S.search;
  console.log('[场景⑥ 搜索退役后历史不放量]', searchRetiredOk ? 'PASS' : 'FAIL');
  const scene6Ok = focusCountOk && noOldOk && emptyOk && searchRetiredOk;
  /* ---------- task179 场景⑦：子会话行折叠箭头判据（叶子角色不画假 ▸） ----------
     主人 2026-11-10：「子代理、御史之类的不应该有这个折叠箭头」，修了好几轮仍是假箭头。
     口径：已知子列表非空才画；未加载时叶子角色（censor 家族 / writer / child / general / explore）不画；
     大管家/小管家/枢机/未知 + build（库内有带孙的 build 子会话）仍乐观画，保住深层展开通道。 */
  const mkC = (id, agent, title) => ({ id, agent, title, parentID: 'B1', time: { created: NOW6, updated: NOW6 } });
  S.projects = [{ name: 'littleDJ', path: dirLj }];
  S.imports = []; S.order = []; S.convOrder = {}; S.sortProj = null; S.multiSel = { on:false, ids:{}, busy:false };
  S.focusProjOpen = {}; S.projOpen = {}; S.view = 'projects'; S.busyBy = {};
  S.sessions = [ mkP('B1','ButlerToday',1,NOW6-60000,dirLj) ];
  S.current = S.sessions[0]; S._treeOpenedFor = 'B1'; S.treeRootId = 'B1';
  S.children = {
    B1: [ mkC('S1','steward','小管家在跑'), mkC('C1','censor-output','御史·产出审 产出'),
          mkC('W1','writer','执笔写码'), mkC('B9','build','子代理带孙'),
          mkC('U1','steward','未加载的小管家'), mkC('U2','censor-plan','未加载的御史'),
          mkC('R1','build','task181 方案审 (@censor-plan subagent)'),
          mkC('R2','build','task180 产出审 (@censor-glm subagent)') ],
    S1: [ mkC('X1','secretariat','枢机') ],   /* 已知有子 → 画 */
    B9: [ mkC('X2','writer','执笔') ],        /* build 已知有子 → 必须画（方案审 P1-1：不得当叶子） */
    C1: [],                                   /* 御史已知无子 → 不画 */
    W1: []                                    /* 执笔已知无子 → 不画 */
  };
  S.childParent = {}; S.convOpen = { B1: 1 };
  ctx.renderSidebar();
  const subRow = (sid) => walk(navBody, []).find(e => e._cls.has('conv-sub') && e.dataset.sid === sid);
  const hasCaret = (sid) => {
    const r = subRow(sid); if (!r) return null;
    const c = r.children.find(x => x._cls.has('conv-sub-caret'));
    return !!(c && c.textContent === '▸');
  };
  const caretOk = hasCaret('S1') === true && hasCaret('C1') === false && hasCaret('W1') === false &&
                  hasCaret('B9') === true && hasCaret('U1') === true && hasCaret('U2') === false;
  /* task182：角色标签后缀优先——agent=build 但 title 带 (@censor-plan subagent) → 显示御史·方案审；
     task265：历史旧键后缀 (@censor-glm subagent) 同样命中（退役键兜底）；
     无后缀的 build 仍显示中性「子代理」。 */
  const roleTagOf = (sid) => {
    const r = subRow(sid); if (!r) return null;
    const t = r.children.find(x => x._cls.has('conv-sub-tag'));
    return t ? t.textContent : null;
  };
  const roleOk = roleTagOf('R1') === '御史·方案审' && roleTagOf('R2') === '御史·产出审' && roleTagOf('B9') === '子代理';
  console.log('[场景⑧ 角色后缀优先] build+后缀=' + roleTagOf('R1') + ' build无后缀=' + roleTagOf('B9'), roleOk ? 'PASS' : 'FAIL');
  const scene8Ok = roleOk;
  console.log('[场景⑦ 子行箭头] 小管家有子=' + hasCaret('S1') + ' 御史已加载空=' + hasCaret('C1') +
              ' 执笔已加载空=' + hasCaret('W1') + ' build有子=' + hasCaret('B9') +
              ' 小管家未加载=' + hasCaret('U1') + ' 御史未加载=' + hasCaret('U2'), caretOk ? 'PASS' : 'FAIL');
  const scene7Ok = caretOk;
  /* ---------- task200 场景⑨：会话置顶（显示层 pin first，逻辑序/重排基准不受污染） ---------- */
  S.convOrder = {}; S.sortProj = null; S._lastConvOrder = {};
  const N9 = Date.now();
  S.sessions = [ mk('B0','Butler0',1,N9-3000), mk('B1','Butler1',1,N9-2000), mk('B2','Butler2',1,N9-1000) ]
    .sort((a,b)=>b.time.created-a.time.created); /* task247：今天时间戳（旧夹具 1970 会被「今天」口径滤掉） */
  S.current = S.sessions.find(x=>x.id==='B1');
  S.projects = [{ name:'littleDJ', path: DIR }]; S.imports = []; S.order = []; S.convOpen = {};
  S.multiSel = { on:false, ids:{}, busy:false }; S.focusProjOpen = {}; S.projOpen = {}; S.view = 'projects'; S.busyBy = {};
  S.children = {}; S.childParent = {}; S.tuiSectOpen = true;
  ctx.renderSidebar();
  const pinRowsOf = () => rowsOf().filter(t => t.indexOf('大管家') >= 0 || t.indexOf('📌') === 0);
  const seq0 = pinRowsOf().join(',');
  const posts9before = fetchLog.filter(f => f.url.indexOf('/_conv-order') >= 0 && f.method === 'POST').length;
  ctx.togglePinConv(S.sessions.find(x=>x.id==='B0'));
  await tick();
  const seqPinned = pinRowsOf().join(',');
  const posts9 = fetchLog.filter(f => f.url.indexOf('/_conv-order') >= 0 && f.method === 'POST').slice(posts9before);
  const pBody = posts9.length ? JSON.parse(posts9[posts9.length-1].body) : null;
  const pinPostOk = !!(pBody && pBody.projKey === '__pins__' && (pBody.ids||[]).join(',') === 'B0');
  const pinFirstOk = seqPinned.indexOf('📌 大管家 · Butler0') === 0; /* 被置顶行必须排最前且带 📌 */
  const logicalOk = (S._lastConvOrder['littleDJ']||[]).join(',') === 'B2,B1,B0'; /* 逻辑序快照未被 pin 污染 */
  /* 排序模式：置顶行冻结 ↑↓（无 sort-mv），移动/拖动被守卫拦下 */
  ctx.enterSortMode('littleDJ');
  const sortRows = walk(navBody, []).filter(e => e._cls.has('item') && e._cls.has('conv-child'));
  const rowOf = (title) => sortRows.find(e => ((e.children.find(c=>c._cls.has('t'))||{}).textContent||'').indexOf(title) >= 0);
  const pinnedRow = rowOf('Butler0'), freeRow = rowOf('Butler2');
  const freezeOk = !!pinnedRow && !pinnedRow.children.some(c=>c._cls.has('sort-mv')) &&
                   !!freeRow && freeRow.children.some(c=>c._cls.has('sort-mv'));
  const posts9b = fetchLog.filter(f => f.url.indexOf('/_conv-order') >= 0 && f.method === 'POST').length;
  ctx.moveConv('B0', -1); /* 置顶行 moveConv → 守卫拒绝 */
  ctx.dragConvTo('B0', 'B1', false); /* 置顶行拖动 → 守卫拒绝 */
  const guardOk = fetchLog.filter(f => f.url.indexOf('/_conv-order') >= 0 && f.method === 'POST').length === posts9b;
  ctx.exitSortMode('littleDJ');
  await tick();
  /* 取消置顶 → 显示序回逻辑序（B2,B1,B0） */
  ctx.togglePinConv(S.sessions.find(x=>x.id==='B0'));
  await tick();
  const seqRestored = pinRowsOf().join(',');
  const restoreOk = seqRestored === seq0;
  /* TUI 分区 pin：T2 置顶 → TUI 第一行 */
  S.sessions.push( mk('T1','TuiS1',0,1000), mk('T2','TuiS2',0,2000) );
  S.convOrder = { '__tui__': ['T1','T2'] };
  ctx.togglePinConv(S.sessions.find(x=>x.id==='T2'));
  await tick();
  const tuiRows9 = rowsOf().filter(t => t.indexOf('TUI') === 0 || t.indexOf('📌 TUI') === 0);
  const tuiPinOk = tuiRows9.length === 2 && tuiRows9[0].indexOf('📌 TUI · TuiS2') === 0;
  /* convPins 兜底：非数组键不炸 */
  S.convOrder['__pins__'] = 'garbage';
  const pinsFallbackOk = ctx.convPins().length === 0;
  console.log('[场景⑨ 置顶] 初始=' + seq0 + ' | pin后=' + seqPinned + ' | 取消后=' + seqRestored,
              (pinFirstOk && restoreOk ? 'PASS' : 'FAIL'));
  console.log('[场景⑨ 逻辑序快照]', (S._lastConvOrder['littleDJ']||[]).join(','), logicalOk ? 'PASS' : 'FAIL');
  console.log('[场景⑨ POST]', JSON.stringify(pBody && {projKey:pBody.projKey, ids:pBody.ids}), pinPostOk ? 'PASS' : 'FAIL');
  console.log('[场景⑨ 排序模式冻结]', '置顶行无↑↓=' + freezeOk + ' 移动/拖动被拦=' + guardOk, (freezeOk && guardOk) ? 'PASS' : 'FAIL');
  console.log('[场景⑨ TUI 置顶]', tuiRows9.join(' | '), tuiPinOk ? 'PASS' : 'FAIL');
  console.log('[场景⑨ convPins 非数组兜底]', pinsFallbackOk ? 'PASS' : 'FAIL');
  const scene9Ok = pinFirstOk && restoreOk && logicalOk && pinPostOk && freezeOk && guardOk && tuiPinOk && pinsFallbackOk;
  /* ---------- task276 场景⑩：项目行「＋」新建对话（主人 2026-11-14 口述） ----------
     口径：项目行右侧「N 对话」左边常驻一个 .proj-add；点它直接为**该项目**建会话（POST /session 目录=项目路径），
     不触发项目折叠；多选态隐藏（与 ⋯ 一致）；排序模式显示「完成」时不出加号。 */
  S.projects = [{ name: 'littleDJ', path: dirLj }, { name: 'others', path: dirOt }];
  S.imports = []; S.order = []; S.convOrder = {}; S.sortProj = null; S.multiSel = { on:false, ids:{}, busy:false };
  S.focusProjOpen = {}; S.projOpen = {}; S.view = 'projects'; S.busyBy = {}; S.children = {};
  S.sessions = [ mkP('B1','ButlerToday',1,NOW6-60000,dirLj) ];
  S.current = S.sessions[0];
  ctx.renderSidebar();
  const projRow276 = (name) => walk(navBody, []).find(e => e._cls.has('item') && !e._cls.has('conv-child') && ((e.children.find(c => c._cls.has('t')) || {}).textContent === name));
  const ljRow = projRow276('littleDJ');
  const addBtn = ljRow && ljRow.children.find(c => c._cls.has('proj-add'));
  const mIdx = ljRow ? ljRow.children.findIndex(c => c._cls.has('m')) : -1;
  const addIdx = ljRow ? ljRow.children.indexOf(addBtn) : -1;
  const addPlacedOk = !!addBtn && mIdx >= 0 && addIdx >= 0 && addIdx === mIdx - 1; /* 加号紧挨「N 对话」左边 */
  const openBefore276 = JSON.stringify(S.focusProjOpen);
  const posts276before = fetchLog.filter(f => /\/session\?/.test(f.url) && f.method === 'POST').length;
  let clickErr276 = null;
  if (addBtn && typeof addBtn.onclick === 'function'){
    try { addBtn.onclick({ stopPropagation(){} }) } catch(e){ clickErr276 = e }
  }
  await tick();
  const sessPost276 = fetchLog.filter(f => /\/session\?/.test(f.url) && f.method === 'POST').slice(posts276before);
  const addWiredOk = !clickErr276 && sessPost276.length === 1 && String(sessPost276[0].url).indexOf(encodeURIComponent(dirLj)) >= 0;
  const noToggleOk = JSON.stringify(S.focusProjOpen) === openBefore276; /* 点加号不改折叠态 */
  /* 多选态：不渲染加号 */
  S.multiSel = { on:true, ids:{}, busy:false };
  ctx.renderSidebar();
  const multiHiddenOk = !(projRow276('littleDJ') || { children: [] }).children.some(c => c._cls.has('proj-add'));
  /* 排序模式：只出「完成」，不出加号 */
  S.multiSel = { on:false, ids:{}, busy:false };
  ctx.enterSortMode('littleDJ');
  const sortRow276 = projRow276('littleDJ');
  const sortNoAddOk = !!sortRow276 && !sortRow276.children.some(c => c._cls.has('proj-add')) && sortRow276.children.some(c => c._cls.has('sort-done'));
  ctx.exitSortMode('littleDJ');
  await tick();
  console.log('[场景⑩ 项目行＋] 位置=' + (addPlacedOk ? '在N对话左侧' : '异常') +
              ' 点击建会话=' + (addWiredOk ? sessPost276[0] && sessPost276[0].url : (clickErr276 ? 'ERR:' + clickErr276.message : '未发出')) +
              ' 不改折叠=' + noToggleOk + ' 多选隐藏=' + multiHiddenOk + ' 排序模式无加号=' + sortNoAddOk,
              (addPlacedOk && addWiredOk && noToggleOk && multiHiddenOk && sortNoAddOk) ? 'PASS' : 'FAIL');
  const scene10Ok = addPlacedOk && addWiredOk && noToggleOk && multiHiddenOk && sortNoAddOk;
  const pass = butlerOk && tui.length === 3 && tui[1] === 'TUI · TuiS3' && newTopOk && dragOk && tuiTopOk && projVisOk && scene5Ok && scene6Ok && scene7Ok && scene8Ok && scene9Ok && scene10Ok;
  console.log('[回归①大管家行]', butlerOk ? 'PASS' : 'FAIL');
  console.log(pass ? 'RESULT: PASS（TUI 拖拽排序生效 + 新建会话置顶）' : 'RESULT: FAIL（见上方 FAIL 行）');
  process.exit(pass ? 0 : 1);
})();

/* task169 真数据侧栏自测（无需浏览器）：拉 4097 真实 /_sessions + /_hidden-sessions，
   在 node VM 里装载 ui/index.html + DOM stub，用「真实 572 会话 + 真实 hidden + 模拟脏 projOpen」
   复现主人操作三场景：
     A 点 others 会话 → littleDJ 分组应收起（0 会话行，bug 时=81 行刷屏）
     B 点 littleDJ 分组标题 → 手动展开 81 行 / 再点收起 0 行 / 持久 projOpen 不被翻转
     C 切回 littleDJ 会话（openSession）→ others 收起 + littleDJ 精简（当前根+butler 根）
   用法：node deploy/selftest-realdata-sidebar.js  （UI_PATH=旧文件 可做红对照，场景A 应 FAIL）
   依赖：本机 4097 proxy 在跑；凭据运行时读 ~/littleDJ/config/auth.txt，不硬编码。 */
const fs = require('fs'), vm = require('vm'), path = require('path');
const AUTH = fs.readFileSync(path.join(process.env.HOME || '', 'littleDJ/config/auth.txt'), 'utf8').trim();
const BASE = 'http://127.0.0.1:4097';
/* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本）+ index.html 原文 */
const html = require('./selftest-load-ui').loadUiSource(path.dirname(process.env.UI_PATH || path.join(__dirname, '..', 'ui/index.html')))
  + '\n' + fs.readFileSync(process.env.UI_PATH || path.join(__dirname, '..', 'ui/index.html'), 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, renderSidebar: renderSidebar, openSession: openSession };\n" + m.slice(_i); /* task265：feBootCheck 已于 task241 退役，导出行同步摘除（此前本套件 LOAD-FAIL 不可用） */

/* ---------- DOM stub（与 selftest-sidebar-order.js 同款） ---------- */
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
    querySelector(sel){ return null }, querySelectorAll(sel){ return [] },
    closest(){ return null },
  };
  return e;
}
function walk(el, out){ el.children.forEach(c=>{ out.push(c); walk(c, out) }); return out }
const elCache = {};
const navBody = mkEl('div'); navBody.attrs.id = 'navBody';
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: true, title: '',
  visibilityState: 'visible',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(sel){ if (sel === '#navBody') return navBody; return elCache[sel] = elCache[sel] || (()=>{ const e = mkEl('div'); if (sel[0]==='#') e.attrs.id = sel.slice(1); return e })() },
  querySelectorAll(sel){ return [] },
  getElementById(id){ if (id === 'navBody') return navBody; return elCache['#'+id] = elCache['#'+id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() },
  addEventListener(){}, removeEventListener(){},
};
function fetchStub(url, opt){
  const u = String(url);
  if (u.indexOf('/_conv-order') >= 0 && (!opt || !opt.method || opt.method === 'GET')) return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({order:{}}), text:()=>Promise.resolve('') });
  if (u.indexOf('/session/') >= 0 && u.indexOf('/message') >= 0) return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve([]), text:()=>Promise.resolve('') });
  if (u.indexOf('/_hidden-sessions') >= 0) return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({ok:true,version:0,hidden:[]}), text:()=>Promise.resolve('') });
  return Promise.resolve({ ok:true, status:200, json:()=>Promise.resolve({ok:true}), text:()=>Promise.resolve('') });
}
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k,v)=>{ m[k]=String(v) }, removeItem: k=>{ delete m[k] } } };
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN, setTimeout: (f)=>0, clearTimeout(){}, setInterval: ()=>0, clearInterval(){},
  fetch: fetchStub, document: doc, navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() } },
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '', hash: '', reload(){ if (sandbox.__reloads != null) sandbox.__reloads++ } },
  localStorage: storage(), sessionStorage: storage(),
  alert(){}, confirm: () => true, prompt: () => null,
  EventSource: ES, WebSocket: ES, MutationObserver: class { observe(){} disconnect(){} }, ResizeObserver: class { observe(){} disconnect(){} },
  IntersectionObserver: class { observe(){} disconnect(){} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: f => 0, cancelAnimationFrame(){}, matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  history: { pushState(){}, replaceState(){} }, performance: { now: () => Date.now() },
  innerWidth: 1400, innerHeight: 900, addEventListener(){}, removeEventListener(){}, atob: s => s, btoa: s => s,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox; sandbox.__reloads = 0;
vm.createContext(sandbox);
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }

const tick = () => new Promise(r => setImmediate(r));
(async () => {
  const H = { authorization: 'Basic ' + Buffer.from(AUTH).toString('base64') };
  const [sessRes, hidRes] = await Promise.all([
    fetch(BASE + '/_sessions', { headers: H }), fetch(BASE + '/_hidden-sessions', { headers: H })
  ]);
  const raw = await sessRes.json();
  const hid = await hidRes.json();
  const sessions = (Array.isArray(raw) ? raw : (raw.sessions || []))
    .slice().sort((a,b)=>((b.time&&b.time.created)||0)-((a.time&&a.time.created)||0)); /* loadSessions 同款 created 降序 */
  const hiddenIds = (hid && (hid.hidden || hid.ids)) || [];
  const hiddenMap = {}; hiddenIds.forEach(id => { hiddenMap[id] = 1 });

  const T = sandbox.__T, S = T.S;
  const DIR_L = '/storage/Users/currentUser/project/littleDJ', DIR_O = '/storage/Users/currentUser/project/others';
  S.sessions = sessions; S.projects = [{ name: 'littleDJ', path: DIR_L }, { name: 'others', path: DIR_O }];
  S.imports = []; S.order = []; S.convOrder = {}; S.hidden = hiddenMap;
  S.projOpen = { littleDJ: true, others: true };   /* 模拟主人被污染的持久残留（最坏情况） */
  S.focusProjOpen = {}; S.multiSel = { on:false, ids:{}, busy:false }; S.sortProj = null;
  S.view = 'projects'; S.search = '';

  const projRowEl = (name) => walk(navBody, []).find(e => e._cls.has('item') && !e._cls.has('conv-child') && ((e.children.find(c => c._cls.has('t')) || {}).textContent === name));
  const convRowsIn = () => {
    /* 返回 {项目名: 该分组下渲染的会话行数}——按分组标题行分段统计
       task381：sect-sub（TUI 分区标题）也是边界——TUI 区行(.item.conv-child)不能漏归到上一个项目组
       （真实现象：others 后紧跟 TUI 区 3 行今天的 TUI 会话，被算进 others → C 场景假红） */
    const out = {}; let cur = '(顶部)';
    walk(navBody, []).forEach(e => {
      if (e._cls.has('sect-sub')){ cur = '(tui)'; return }
      if (e._cls.has('item') && !e._cls.has('conv-child')){ const t = (e.children.find(c => c._cls.has('t')) || {}).textContent; if (t) { cur = t; out[cur] = out[cur] || 0 } }
      else if (e._cls.has('item') && e._cls.has('conv-child')) out[cur] = (out[cur] || 0) + 1;
    });
    return out;
  };
  /* task247：A 场景必须挑一条未隐藏的 others 会话——旧脚本没判 hidden，真实数据里恰好命中 hidden 项，
     导致 others 恒 0 行、永久 FAIL（方案审 P1-3）。pwa!==0 与 isButlerSession 口径一致。 */
  const othersSess = sessions.find(s => s.directory === DIR_O && !hiddenMap[s.id] && s.pwa !== 0);
  const ldSess = sessions.find(s => s.directory === DIR_L && s.pwa === 1 && !hiddenMap[s.id]);
  /* task247：当前项目并入口径=当前根+今天且 pwa!==0 的其它根（历史空会话不再并入） */
  const isTodayTs = (ts) => { if (!ts) return false; const d = new Date(ts), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() };
  /* task332：口径与 rows.js todayButlerConv 同步——「今天创建 或 今天聊过（updated）」，
     跨午夜/隔天续聊的活跃会话不再被判「非今天」蒸发（主人 2026-11-16 报障）。 */
  const todayOrActive = (s) => isTodayTs(s.time && s.time.created) || isTodayTs(s.time && s.time.updated);
  /* task381：项目分组判据对齐 renderProjRow→projConvs（mobile.js）：directory 全等 OR baseName(directory)===项目名。
     旧期望公式只有全等分支，真实数据里 basename 同名异径会话（「…/others」之类）被渲染端并入组、期望端漏数
     → C 场景「others=2 应=0」假红。三个计数公式（ldTodayRoots/ldTodayN/othersTodayN/ldExpectedC）统一走 inProj。 */
  const baseName = (d) => String(d || '').split('/').pop();
  const inProj = (s, dir, name) => s.directory === dir || baseName(s.directory) === name;
  const ldTodayRoots = sessions.filter(s => inProj(s, DIR_L, 'littleDJ') && !s.parentID && s.pwa !== 0 && !hiddenMap[s.id] && todayOrActive(s)).length;
  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '  [' + extra + ']' : '')) };
  console.log('真实数据：会话 ' + sessions.length + ' 个 / hidden ' + hiddenIds.length + ' 个 / littleDJ 会话 ' + sessions.filter(s=>s.directory===DIR_L).length + ' / 今天可见根 ' + ldTodayRoots);

  /* 场景A：主人操作复现——点 others 里的会话 */
  S.current = othersSess;
  T.renderSidebar();
  const rowsA = convRowsIn();
  ok('A 点 others 会话后 littleDJ 收起（0 行，bug 时 81 行）', rowsA.littleDJ === 0, 'littleDJ=' + rowsA.littleDJ + ' others=' + rowsA.others);
  ok('A others 当前项目精简展开（>=1 行）', rowsA.others >= 1, 'others=' + rowsA.others);

  /* 场景B：手动展开 littleDJ / 收起 / 持久态不翻转（task171 口径：展开只列今天的 butler 会话） */
  const ldTodayN = sessions.filter(s => inProj(s, DIR_L, 'littleDJ') && !s.parentID && s.pwa !== 0 && !hiddenMap[s.id] && todayOrActive(s)).length;
  const head = projRowEl('littleDJ');
  let expandOk = false, collapseOk = false, projKeep = false;
  if (head && typeof head.onclick === 'function'){
    head.onclick();
    const rowsB = convRowsIn();
    expandOk = rowsB.littleDJ === ldTodayN;
    ok('B 手动展开 littleDJ（今天 ' + ldTodayN + ' 行，task171 口径）', expandOk, 'littleDJ=' + rowsB.littleDJ + ' 应=' + ldTodayN);
    const head2 = projRowEl('littleDJ'); head2.onclick();
    const rowsB2 = convRowsIn();
    collapseOk = rowsB2.littleDJ === 0;
    ok('B 再点收起', collapseOk, 'littleDJ=' + rowsB2.littleDJ);
    projKeep = S.projOpen.littleDJ === true;
    ok('B 持久 projOpen 未被翻转（仍 true）', projKeep);
  } else ok('B 分组标题可点击', false);

  /* 场景C：切回 littleDJ 会话（openSession 真函数）——task172：others 是刚离开的项目 → 保持展开（今天的会话） */
  T.openSession(ldSess);
  await tick(); await tick();
  const rowsC = convRowsIn();
  const othersTodayN = sessions.filter(s => inProj(s, DIR_O, 'others') && !s.parentID && s.pwa !== 0 && !hiddenMap[s.id] && todayOrActive(s)).length;
  /* task247 新口径：当前根 1 + 今天（task332：或今天活跃）且非当前根的其它大管家根（历史空会话已切除） */
  const ldExpectedC = 1 + sessions.filter(s => inProj(s, DIR_L, 'littleDJ') && !s.parentID && s.pwa !== 0 && !hiddenMap[s.id] && todayOrActive(s) && s.id !== ldSess.id).length;
  ok('C 切回 littleDJ 后 others 保持展开（今天 ' + othersTodayN + ' 行）', rowsC.others === othersTodayN, 'others=' + rowsC.others + ' 应=' + othersTodayN);
  ok('C littleDJ 精简=当前根+今天的其它根（' + ldExpectedC + ' 行，历史空会话不再刷屏）', rowsC.littleDJ === ldExpectedC, 'littleDJ=' + rowsC.littleDJ + ' 应=' + ldExpectedC);
  ok('C focusProjOpen 标记刚离开项目（others=true）', S.focusProjOpen.others === true);

  /* 场景E（task247 方案审 P1-2）：今天的 pwa 缺失空会话仍要并入——锁死 task242「空会话刷新消失」不复发。
     造一条今天的空会话插进根集，当前项目展开行数应 +1；走完立即移除，不污染后续场景。 */
  const fake = { id: 'ses_selftest_today_empty', directory: DIR_L, pwa: undefined, parentID: '', title: '新对话 空自测', time: { created: Date.now(), updated: Date.now() } };
  S.sessions.unshift(fake);
  T.renderSidebar();
  const rowsE = convRowsIn();
  ok('E 今天的 pwa 缺失空会话仍并入当前项目（task242 不复发）', rowsE.littleDJ === ldExpectedC + 1, 'littleDJ=' + rowsE.littleDJ + ' 应=' + (ldExpectedC + 1));
  S.sessions = S.sessions.filter(x => x.id !== fake.id);
  T.renderSidebar();

  /* 场景F（task247 主人主诉）：当前项目的折叠箭头必须真能折叠/展开（旧版点击直接 return=死键） */
  const headC = projRowEl('littleDJ');
  if (headC && typeof headC.onclick === 'function'){
    headC.onclick();
    const rowsF1 = convRowsIn().littleDJ || 0;
    ok('F 当前项目标题点一下收起（0 行）', rowsF1 === 0, 'littleDJ=' + rowsF1);
    const headC2 = projRowEl('littleDJ');
    headC2.onclick();
    const rowsF2 = convRowsIn().littleDJ || 0;
    ok('F 再点一下展开（恢复 ' + ldExpectedC + ' 行）', rowsF2 === ldExpectedC, 'littleDJ=' + rowsF2 + ' 应=' + ldExpectedC);
  } else ok('F 当前项目标题可点击', false);

  /* 场景G（task247 产出审 P1-1）：主人「折叠 littleDJ → 点 DAG 会话」高频流——刚折叠的项目不能被弹开；
     切回 littleDJ 会话时又必须自动展开（进入侧兜底不能一起砍掉）。 */
  const headG = projRowEl('littleDJ');
  if (headG && typeof headG.onclick === 'function'){
    headG.onclick(); /* 折叠当前项目 */
    T.openSession(othersSess);
    await tick(); await tick();
    const gRows = convRowsIn().littleDJ || 0;
    ok('G 折叠后切走不被强制弹开（显式 false 被尊重）', S.focusProjOpen.littleDJ === false && gRows === 0, 'state=' + S.focusProjOpen.littleDJ + ' littleDJ=' + gRows);
    T.openSession(ldSess);
    await tick(); await tick();
    const gRows2 = convRowsIn().littleDJ || 0;
    ok('G 切回后所在项目自动展开', gRows2 === ldExpectedC, 'littleDJ=' + gRows2 + ' 应=' + ldExpectedC);
  } else ok('G 当前项目标题可点击', false);


  /* 场景D（feBootCheck 自动刷新端到端）已于 task265 整段退役：feBootCheck 在 task241「取消自动整页刷新」
     时随 bootId 握手链一并退役，本套件自此 LOAD-FAIL/TypeError 不可用（存量陈旧，HEAD 基线同样挂）。
     自动刷新语义已死，无等价断言可写；侧栏场景 A/B/C/E/F/G 与本段无耦合，直接删除。 */

  console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
  process.exit(fail ? 1 : 0);
})();

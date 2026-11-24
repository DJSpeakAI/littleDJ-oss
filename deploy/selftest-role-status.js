/* task188 角色状态语义亲测工具（无需浏览器）：node VM 跑 ui/index.html 内联脚本 + 最小 DOM stub。
   断言：小管家/枢机 idle 但子代在跑 → 「等待中」（含深层孙代、auto-done 不覆盖、childParent 断链走 children 池兜底）；
        人工 done 仍「已完成」；大管家行 full/flat/direct「空闲中」（task190）、unknown/TUI「已完成」。
   用法：node deploy/selftest-role-status.js （exit 0=PASS / 1=FAIL / 2=脚本装载失败）
   红对照：ROLE_RC=1 时禁用 _waitDesc 分支（模拟修复前）→ 等待中用例应 FAIL。 */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.env.UI_PATH || '/storage/Users/currentUser/project/littleDJ/ui/index.html', 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
if (process.env.ROLE_RC === '1'){ /* 红对照：抹掉等待中分支 */
  m = m.replace("if (_waitDesc[c.id]) return { txt: '等待中', cls: 'wait' };", "/* RC: 等待中分支已禁用 */");
  if (m.indexOf('/* RC: 等待中分支已禁用 */') < 0){ console.error('RC 注入失败'); process.exit(2) }
}
if (process.env.ROLE_RC === '2'){ /* task219 红对照：台账直连源整体禁用（⑬ 应 FAIL） */
  m = m.replace("if (!t || t.state !== 'running' || t.inTask === false || !t.runnerSession) return;", "if (true) return; /* RC219: 台账源整体禁用 */");
  if (m.indexOf('/* RC219: 台账源整体禁用 */') < 0){ console.error('RC2 注入失败'); process.exit(2) }
}
if (process.env.ROLE_RC === '3'){ /* task219 红对照：抹掉首帧中性态（⑭ 应 FAIL） */
  m = m.replace("((TASKS && TASKS.at) ? '空闲中' : '同步中')", "'空闲中'");
  if (m.indexOf("? '空闲中' : '同步中'") >= 0){ console.error('RC3 注入失败'); process.exit(2) }
}
if (process.env.ROLE_RC === '4'){ /* task262 红对照：抹掉 idle 置 S_ENDED 后的重绘（模拟修复前）→ ⒂ 首条应 FAIL */
  m = m.replace("S_ENDED[evSid] = 1; _lastIdleAt = Date.now(); scheduleSidebar();", "S_ENDED[evSid] = 1; _lastIdleAt = Date.now();");
  if (m.indexOf("_lastIdleAt = Date.now(); scheduleSidebar();") >= 0){ console.error('RC4 注入失败'); process.exit(2) }
}
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, get TASKS(){return TASKS}, get S_ENDED(){return S_ENDED}, renderSidebar: renderSidebar, childStatusInfo: childStatusInfo, computeWaitDesc: computeWaitDesc, markBusy: markBusy, handleEvent: handleEvent };\n" + m.slice(_i);

/* ---------- DOM stub（与 selftest-multisel-keepopen.js 同构） ---------- */
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
    setAttribute(k,v){ e.attrs[k]=v; if (k === 'class') e._cls = new Set(String(v||'').split(/\s+/).filter(Boolean)) }, getAttribute(k){ return e.attrs[k] },
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
  createElementNS: (ns, t) => mkEl(t), /* task276 补：task274 运行中行转圈 svg 走 createElementNS，stub 缺它 → 本自测 RUN-FAIL（既有缺口） */
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
const RC = process.env.ROLE_RC === '1';
(async () => {
  await tick(); await tick(); await tick();
  const T = sandbox.__T, S = T.S;
  const DIR = '/storage/Users/currentUser/project/littleDJ';
  const NOW = Date.now();
  const mk = (id, title, pwa, created) => ({ id, title, pwa, directory: DIR, parentID: '', time: { created, updated: NOW }, childCount: 1 });
  const child = (id, title, agent, pid) => ({ id, title, agent, parentID: pid, directory: DIR, time: { created: NOW, updated: NOW } });

  /* 数据：根A(大管家) → 小管家S1 → 枢机J1 → 执笔W1；根T(TUI) */
  S.sessions = [ mk('A','大管家根',1, NOW-3000), mk('T','TUI会话',0, NOW-2000) ];
  S.projects = [{ name: 'littleDJ', path: DIR }]; S.imports = []; S.order = []; S.convOrder = {};
  S.current = S.sessions[0]; S.view = 'projects'; S.search = ''; S.projOpen = {}; S.hidden = {};
  S.multiSel = { on:false, ids:{}, busy:false }; S.sortProj = null;
  S.convOpen = { A: 1, S1: 1, J1: 1 };
  S.children = {
    A: [ child('S1','小管家任务 (@steward subagent)','steward','A') ],
    S1: [ child('J1','枢机任务 (@secretariat subagent)','secretariat','S1') ],
    J1: [ child('W1','执笔任务 (@writer subagent)','writer','J1') ],
  };
  S.childrenLoading = {}; S.childrenErr = {}; S.childrenDirty = {};
  S.childParent = {}; /* ①起先断链：只靠 children 池反查（P1-2 场景） */
  S.busyBy = {}; S.busyReady = {}; S.idleSeenAt = {}; S.idleEpoch = {}; S.lastBusyEpoch = {};
  S.chain = { mode: 'full', since: null, unknown: false };
  S.tuiSectOpen = true; S.focusProjOpen = {}; S.activeButlerSid = 'A';
  S.liveRunner = {};
  const setTasks = (list, etas) => { T.TASKS.list = list || []; T.TASKS.etas = etas || {}; T.TASKS.at = Date.now() }; /* task219：模拟「台账已加载」，否则首帧中性态会吞掉 ⑧-⑫ 的根行文案断言（方案审 P1-3） */

  let fail = 0;
  const A_ = (name, ok, extra) => { console.log('[' + name + ']', extra !== undefined ? extra + ' ' : '', ok ? 'PASS' : 'FAIL'); if (!ok) fail = 1 };

  /* ① 小管家 idle + 子代 busyBy → 等待中 */
  S.busyBy = { W1: true }; setTasks([]);
  T.renderSidebar();
  A_('①孙代在跑→小管家等待中', T.childStatusInfo(S.children.A[0]).txt === '等待中', T.childStatusInfo(S.children.A[0]).txt);
  A_('①枢机同样等待中', T.childStatusInfo(S.children.S1[0]).txt === '等待中', T.childStatusInfo(S.children.S1[0]).txt);
  A_('①执笔自身执行中', T.childStatusInfo(S.children.J1[0]).txt === '执行中', T.childStatusInfo(S.children.J1[0]).txt);

  /* ② fin auto-done + 子代 busy → 仍等待中（方案审 P1-1） */
  setTasks([{ id: 'A', runnerSession: 'S1', state: 'done', overrideNote: 'auto-done · 末条助手已完成' }]);
  T.renderSidebar();
  A_('②auto-done不压等待中', T.childStatusInfo(S.children.A[0]).txt === '等待中', T.childStatusInfo(S.children.A[0]).txt);

  /* ③ 人工 done + 子代 busy → 已完成（override 定夺优先） */
  setTasks([{ id: 'A', runnerSession: 'S1', state: 'done', overrideNote: '主人手动标记完成' }]);
  T.renderSidebar();
  A_('③人工done保持已完成', T.childStatusInfo(S.children.A[0]).txt.indexOf('已完成') === 0, T.childStatusInfo(S.children.A[0]).txt);

  /* ④ fin interrupted → 已中断（最高优先） */
  setTasks([{ id: 'A', runnerSession: 'S1', state: 'interrupted', overrideNote: '' }]);
  T.renderSidebar();
  A_('④interrupted优先', T.childStatusInfo(S.children.A[0]).txt.indexOf('已中断') === 0, T.childStatusInfo(S.children.A[0]).txt);

  /* ⑤ 全员 idle + S_ENDED → 已完成（不误伤；P2-2：S_ENDED 经 __T 导出置位，确保真走该分支） */
  S.busyBy = {}; setTasks([]); S.idleSeenAt = {}; S.idleEpoch = {};
  T.S_ENDED['S1'] = 1;
  T.renderSidebar();
  const s5 = T.childStatusInfo(S.children.A[0]);
  A_('⑤S_ENDED路径→已完成', s5.txt.indexOf('已完成') === 0, s5.txt);
  try { delete T.S_ENDED['S1'] } catch(e){}

  /* ⑥ 自身 busyBy → 执行中（第一优先） */
  S.busyBy = { S1: true };
  T.renderSidebar();
  A_('⑥自身忙仍执行中', T.childStatusInfo(S.children.A[0]).txt === '执行中', T.childStatusInfo(S.children.A[0]).txt);

  /* ⑦ childParent 全断 + children 池可反查 → 仍等待中（P1-2 主修） */
  S.busyBy = { W1: true }; S.childParent = {}; setTasks([]);
  T.renderSidebar();
  A_('⑦断链走池兜底仍等待中', T.childStatusInfo(S.children.A[0]).txt === '等待中', T.childStatusInfo(S.children.A[0]).txt);

  /* ⑧ 大管家行 idle 文案：full/flat/direct→空闲中；只 unknown/TUI→已完成；busy→圈圈+is-running
     （task190：direct 亲自做模式下大管家同为常驻管家——底下御史在审核时也应「空闲中」；
      task274：执行中改为行左侧转圈圈，右侧不再有「执行中」文字标签，断言随语义更新 2026-11-14） */
  const rootRow = (title) => walk(navBody, []).find(e => e._cls.has('item') && e._cls.has('conv-child') && ((e.children.find(c => c._cls.has('t')) || {}).textContent || '').indexOf(title) >= 0);
  const rootSt = (title, pwa) => {
    const row = rootRow(title);
    const st = row && row.children.find(c => c._cls.has('conv-st'));
    return st ? st.textContent : '(none)';
  };
  S.busyBy = {};
  S.chain = { mode: 'full', since: null, unknown: false }; T.renderSidebar();
  A_('⑧大管家 full→空闲中', rootSt('大管家根') === '空闲中', rootSt('大管家根'));
  S.chain = { mode: 'flat', since: null, unknown: false }; T.renderSidebar();
  A_('⑧大管家 flat→空闲中', rootSt('大管家根') === '空闲中', rootSt('大管家根'));
  S.chain = { mode: 'direct', since: null, unknown: false }; T.renderSidebar();
  A_('⑧大管家 direct→空闲中', rootSt('大管家根') === '空闲中', rootSt('大管家根'));
  /* ⑧b task197（主人 2026-11-10 定，推翻 task190 旧口径）：direct 模式 + 手下子代理（W1=writer）在跑
     → 大管家行「等待中」（亲自模式下大管家=执行者本身，任务未收口≈不能布置新命令）；
     五角色/压扁模式同样场景仍是「空闲中」（常驻调度，可接新单） */
  S.busyBy = { W1: true }; T.renderSidebar();
  A_('⑧b direct+孙代在跑→等待中', rootSt('大管家根') === '等待中', rootSt('大管家根'));
  S.chain = { mode: 'flat', since: null, unknown: false }; T.renderSidebar();
  A_('⑧b flat+孙代在跑→仍空闲中', rootSt('大管家根') === '空闲中', rootSt('大管家根'));
  S.chain = { mode: 'direct', since: null, unknown: false };
  S.busyBy = {};
  S.chain = { mode: 'full', since: null, unknown: true }; T.renderSidebar();
  A_('⑧chain unknown→已完成', rootSt('大管家根') === '已完成', rootSt('大管家根'));
  S.chain = { mode: 'full', since: null, unknown: false }; T.renderSidebar();
  A_('⑧TUI行仍已完成', rootSt('TUI会话') === '已完成', rootSt('TUI会话'));
  S.busyBy = { A: true }; T.renderSidebar();
  A_('⑧大管家 busy→执行中（task274：圈圈+is-running 承担，无文字标签）', (function(){ const r = rootRow('大管家根'); return !!r && r._cls.has('is-running') && r.children.some(c => c._cls.has('conv-spin')) && !r.children.some(c => c._cls.has('conv-st')) })(), (function(){ const r = rootRow('大管家根'); return r ? ('run=' + r._cls.has('is-running') + ' spin=' + r.children.some(c => c._cls.has('conv-spin'))) : '(none)' })());

  /* ⑨ 等待中态 ETA 徽标仍渲染 */
  S.busyBy = { W1: true }; setTasks([], { S1: { minutes: 10, deadline: Date.now() + 600000 } });
  T.renderSidebar();
  const etaEl = walk(navBody, []).find(e => e._cls.has('conv-sub-eta'));
  A_('⑨等待中态ETA仍显示', !!etaEl, etaEl ? etaEl.textContent : '(none)');

  /* ⑩ task190：状态标签分色类——根行 idle/done，子行 live/wait/inter/stall；busy 行由 task274 圈圈承担 */
  const rootEl = (title) => {
    const row = rootRow(title);
    return row && row.children.find(c => c._cls.has('conv-st'));
  };
  S.busyBy = {}; S.chain = { mode: 'direct', since: null, unknown: false }; T.renderSidebar();
  A_('⑩direct空闲→idle类', !!rootEl('大管家根') && rootEl('大管家根')._cls.has('idle'), rootEl('大管家根') && rootEl('大管家根').className);
  S.busyBy = { A: true }; T.renderSidebar();
  A_('⑩busy→run类（task274：无 conv-st，is-running+conv-spin 承担）', (function(){ const r = rootRow('大管家根'); return !!r && r._cls.has('is-running') && r.children.some(c => c._cls.has('conv-spin')) && !r.children.some(c => c._cls.has('conv-st')) })(), (function(){ const r = rootRow('大管家根'); return r ? ('run=' + r._cls.has('is-running') + ' spin=' + r.children.some(c => c._cls.has('conv-spin'))) : '(none)' })());
  S.busyBy = {}; S.chain = { mode: 'full', since: null, unknown: true }; T.renderSidebar();
  A_('⑩已完成→done类', !!rootEl('大管家根') && rootEl('大管家根')._cls.has('done'), rootEl('大管家根') && rootEl('大管家根').className);
  S.chain = { mode: 'full', since: null, unknown: false };
  setTasks([{ id: 'A', runnerSession: 'S1', state: 'interrupted', overrideNote: '' }]);
  A_('⑩已中断cls=inter', T.childStatusInfo(S.children.A[0]).cls === 'inter', T.childStatusInfo(S.children.A[0]).cls);
  setTasks([]); S.busyBy = { S1: true };
  A_('⑩执行中cls=live', T.childStatusInfo(S.children.A[0]).cls === 'live', T.childStatusInfo(S.children.A[0]).cls);
  S.busyBy = { W1: true }; T.renderSidebar();
  A_('⑩等待中cls=wait', T.childStatusInfo(S.children.A[0]).cls === 'wait', T.childStatusInfo(S.children.A[0]).cls);
  /* 疑似中断：子会话自身最后活动 >45min 且无终态行 */
  const oldChild = { id: 'OLD', title: '老子会话 (@writer subagent)', agent: 'writer', parentID: 'A', directory: DIR, time: { created: NOW - 7200000, updated: NOW - 3600000 } };
  S.children.A = [oldChild]; S.busyBy = {}; S.childParent = {}; setTasks([]);
  A_('⑩疑似中断cls=stall', T.childStatusInfo(oldChild).cls === 'stall', T.childStatusInfo(oldChild).cls);
  S.children.A = [ child('S1','小管家任务 (@steward subagent)','steward','A') ]; S.childParent = {}; /* 复原 */

  /* ⑪ task197：链路模式徽标只挂大管家行（TUI 行不挂）；状态标签右锚为行末元素
     （task199：大管家行时间戳已删——主人 2026-11-10 定「父行时间也取消」，子行时间 task198 已删；
      TUI 行保留时间戳，状态标签仍排在时间之后） */
  S.busyBy = {}; S.chain = { mode: 'direct', since: null, unknown: false }; T.renderSidebar();
  const rowByTitle = (title) => walk(navBody, []).find(e => e._cls.has('item') && e._cls.has('conv-child') && ((e.children.find(c => c._cls.has('t')) || {}).textContent || '').indexOf(title) >= 0);
  const butlerRow = rowByTitle('大管家根'), tuiRow = rowByTitle('TUI会话');
  const butlerMode = butlerRow && butlerRow.children.find(c => c._cls.has('conv-mode'));
  A_('⑪大管家行有模式徽标', !!butlerMode && butlerMode.textContent.indexOf('亲自') >= 0, butlerMode ? butlerMode.textContent : '(none)');
  A_('⑪模式徽标类=m-direct', !!butlerMode && butlerMode._cls.has('m-direct'), butlerMode ? butlerMode.className : '(none)');
  A_('⑪TUI行无模式徽标', !!tuiRow && !tuiRow.children.some(c => c._cls.has('conv-mode')), tuiRow ? 'ok' : '(no row)');
  const _kids = butlerRow ? butlerRow.children : [];
  const _iM = _kids.findIndex(c => c._cls.has('m') && c.tagName === 'SPAN');
  const _iSt = _kids.findIndex(c => c._cls.has('conv-st'));
  A_('⑪大管家行无时间戳（task199）', _iM === -1, 'mIdx=' + _iM);
  const _iMore = _kids.findIndex(c => c._cls.has('item-more'));
  const _iActs = _kids.findIndex(c => c._cls.has('conv-acts'));
  /* task274：⋯/归档/置顶 已收进 .conv-acts 操作组（⋯ 不再直挂行末），右锚改为「conv-st 紧随 conv-acts 之前」 */
  A_('⑪父行状态为右锚（task274：操作组 conv-acts 在其后）', _iSt >= 0 && (_iActs === -1 ? _iSt === _kids.length - 1 : _iSt === _iActs - 1), 'stIdx=' + _iSt + ' actsIdx=' + _iActs + ' moreIdx=' + _iMore);
  const _tuiKids = tuiRow ? tuiRow.children : [];
  const _tuiM = _tuiKids.findIndex(c => c._cls.has('m') && c.tagName === 'SPAN');
  const _tuiSt = _tuiKids.findIndex(c => c._cls.has('conv-st'));
  A_('⑪TUI行保留时间戳', _tuiM >= 0, 'mIdx=' + _tuiM);
  A_('⑪TUI行状态排在时间之后', _tuiM >= 0 && _tuiSt > _tuiM, 'stIdx=' + _tuiSt + ' mIdx=' + _tuiM);

  /* ⑫ task201：runner 子会话事件的状态链放行（拦截块不再吞 busy/父链 → 大管家「空闲中→等待中」自动更新） */
  {
    S.current = { id: 'CUR0', title: '当前会话', pwa: 1, directory: '', time: { created: 1, updated: 1 } };
    S.sessions = [S.current]; S.busyBy = {}; S.childParent = {};
    const R1 = 'RN1';
    setTasks([{ id: R1, runnerSession: R1, state: 'active', title: 'r1', phase: '', progress: '', updated: Date.now() }]);
    T.handleEvent({ type: 'session.status', properties: { sessionID: R1, status: { type: 'busy' } } });
    A_('⑫runner status busy→busyBy 置位', S.busyBy[R1] === true, String(S.busyBy[R1]));
    T.handleEvent({ type: 'session.updated', properties: { info: { id: R1, parentID: 'PARENT' } } });
    A_('⑫runner updated→childParent 回填', S.childParent[R1] === 'PARENT', String(S.childParent[R1]));
    const _len = (S.sessions || []).length;
    T.handleEvent({ type: 'session.updated', properties: { info: { id: 'GHOST', parentID: 'PARENT' } } });
    A_('⑫未加载会话不 push（防幽灵行）', (S.sessions || []).length === _len, 'len=' + (S.sessions || []).length + '/' + _len);
    T.handleEvent({ type: 'session.idle', properties: { sessionID: R1 } });
    A_('⑫runner idle→busyBy 释放', S.busyBy[R1] === false, String(S.busyBy[R1]));
    const R2 = 'RN2';
    setTasks([{ id: R2, runnerSession: R2, state: 'active', title: 'r2', phase: '', progress: '', updated: Date.now() }]);
    S.busyBy = {};
    T.handleEvent({ type: 'message.part.delta', properties: { sessionID: R2 } });
    A_('⑫runner delta→busyBy 置位', S.busyBy[R2] === true, String(S.busyBy[R2]));
    const R3 = 'RN3';
    setTasks([{ id: R3, runnerSession: R3, state: 'active', title: 'r3', phase: '', progress: '', updated: Date.now() }]);
    S.busyBy = {};
    T.handleEvent({ type: 'message.updated', properties: { sessionID: R3, info: { id: 'M1', role: 'assistant', time: { completed: Date.now() } } } });
    A_('⑫runner message.updated 不标忙（防乱序误标）', S.busyBy[R3] === undefined, String(S.busyBy[R3]));
  }

  /* ⑬ task219（主人 2026-11-11 报障）：台账直连边——caret 未展开（children/childParent 皆空）时，
     在跑 runner 的根行仍须「等待中」，不再恒显「空闲中」。反向断言：归档行（inTask=false）不得标等待中（方案审 P1-1）。 */
  {
    const _keepKids = S.children, _keepPar = S.childParent;
    S.sessions = [ mk('A','大管家根',1, NOW-3000), mk('T','TUI会话',0, NOW-2000) ]; /* ⑫ 段把 sessions 缩成 CUR0，此处复原根集 */
    S.current = S.sessions[0]; S.convOpen = {};
    S.children = {}; S.childParent = {}; S.busyBy = {}; S.busyReady = {};
    S.chain = { mode: 'direct', since: null, unknown: false };
    setTasks([{ id: 'A', runnerSession: 'RUNX', state: 'running', inTask: true, stale: '', title: 'x', updated: NOW }]);
    T.renderSidebar();
    A_('⑬未展开+台账在跑→根行等待中', rootSt('大管家根') === '等待中', rootSt('大管家根'));
    setTasks([{ id: 'A', runnerSession: 'RUNY', state: 'running', inTask: false, stale: 'archived', title: 'y', updated: NOW }]);
    T.renderSidebar();
    A_('⑬归档行不标等待中', rootSt('大管家根') === '空闲中', rootSt('大管家根'));
    S.children = _keepKids; S.childParent = _keepPar;
  }

  /* ⑭ task219：台账首拉未回（TASKS.at===0）→ 中性「同步中」；首拉返回后恢复「空闲中」（L-049 宁缺勿假）。 */
  {
    S.busyBy = {}; S.chain = { mode: 'direct', since: null, unknown: false };
    const _keepAt = T.TASKS.at;
    setTasks([]); T.TASKS.at = 0;
    T.renderSidebar();
    A_('⑭首拉未回→同步中(非空闲中)', rootSt('大管家根') === '同步中', rootSt('大管家根'));
    T.TASKS.at = _keepAt; T.renderSidebar();
    A_('⑭台账已回→恢复空闲中', rootSt('大管家根') === '空闲中', rootSt('大管家根'));
  }

  /* ⒂ task262：完成标签瞬时链（方案审 P1-1 锁死）——
     a) session.idle 置 S_ENDED 必须伴随 scheduleSidebar（busyBy 幂等闸会吞 markBusy 的重绘、navSidebarSig 指纹又不含 S_ENDED，缺则标签等 10s 轮询 = 主人主诉根因）；
     b) 两处任务终局点（pwaAgentBell 收口 / dingRunnerIdle 命中）强拉台账；
     c) loadTaskLedger pendForce 合并 + recheck 复核（P1-2）。ROLE_RC=4 抹掉 a) 的 scheduleSidebar → 首条应 FAIL */
  {
    A_('⒂idle置S_ENDED伴随重绘', /session\.idle'\)\{ S_ENDED\[evSid\] = 1; _lastIdleAt = Date\.now\(\); scheduleSidebar\(\); \}/.test(m));
    A_('⒂pwaAgentBell收口强拉台账', /if \(m\[1\] && !S_ENDED\[m\[1\]\]\)\{[\s\S]{0,400}?loadTaskLedger\(true\)/.test(m));
    A_('⒂runner终局强拉台账', /dingRunnerIdle\(p\.sessionID\)[\s\S]{0,120}?loadTaskLedger\(true\)/.test(m));
    A_('⒂pendForce合并存在', /TASKS\.pendForce = true[\s\S]{0,1400}?if \(TASKS\.pendForce\)\{ TASKS\.pendForce = false; loadTaskLedger\(true\)/.test(m));
    A_('⒂recheck复核存在', /force && !recheck\)\{ setTimeout\(function\(\)\{ loadTaskLedger\(true, true\) \}, 1500\)/.test(m));
  }

  if (RC){
    /* 红对照：等待中分支禁用时，①⑦ 必须 FAIL（断言咬得住） */
    console.log('RC 模式：以上 ①⑦ 应 FAIL — 结果 ' + (((T.childStatusInfo(S.children.A[0]).txt) === '等待中') ? '未咬合(异常)' : '咬合正常'));
  }
  /* task219 红对照：ROLE_RC=2 时 ⑬ 应 FAIL、ROLE_RC=3 时 ⑭ 应 FAIL（看上方逐条结果 + 退出码 1 即咬合） */
  console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS（等待中/空闲中语义 + auto-done 不覆盖 + 断链兜底）');
  process.exit(fail);
})().catch(e => { console.error('RUN-FAIL', e && e.stack || e); process.exit(2) });

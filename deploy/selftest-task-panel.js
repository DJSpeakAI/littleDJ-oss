/* task156 右栏任务面板亲测工具（无需浏览器）：在 node VM 里跑 ui/index.html 内联脚本 + 最小 DOM stub，
   断言【数据层纯函数族】（taskModel / stageOf / stageLabel/waiting 五态）+【排序层/常驻语义】（ORDERS/taskStageRank）。task334：折叠族已退役。
   用法：node deploy/selftest-task-panel.js  （exit 0=PASS / 1=FAIL / 2=脚本装载失败）
   注意：脚本内含 IIFE 注入钩子（window.__T），改 ui 结构时若钩子行号变动需同步 __T 导出函数名。 */
const vm = require('vm');
/* task269：DJH P1 拆包后 $/esc/md/IV 等已拆至 ui/src/ 模块，vm 裸跑内联脚本会 $ is not defined——
   接 selftest-load-ui 共享加载器（按 @order 拼模块+内联主脚本），与 sidebar-order 等 8 套同款（L-073 外部产物过验收） */
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
/* 主脚本是 IIFE：在收尾前注入测试钩子 */
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { taskModel: taskModel, stageOf: stageOf, stageLabel: stageLabel, taskTerminalState: taskTerminalState, S_ENDED: S_ENDED, collectLiveTasks: collectLiveTasks, ORDERS: ORDERS, taskStageRank: taskStageRank, setTaskManualPos: setTaskManualPos, taskOrderMode: taskOrderMode, taskUnits: taskUnits, renderTaskUnits: renderTaskUnits, renderTaskUnitCard: renderTaskUnitCard, taskCardSubline: taskCardSubline, enterTaskManual: enterTaskManual, cancelTaskManual: cancelTaskManual, saveTaskManual: saveTaskManual, moveTaskUnit: moveTaskUnit, dragTaskTo: dragTaskTo, taskManualOrderKeys: taskManualOrderKeys, setTaskOrderMode: setTaskOrderMode, setTaskFilter: setTaskFilter, refreshTaskConvOrder: refreshTaskConvOrder, taskFilter: function(){ return _taskFilter }, isTaskManualEditing: function(){ return _taskOrderEditing }, tasksInFlightNow: tasksInFlightNow, taskFollowCandidate: taskFollowCandidate, ledgerActiveSids: ledgerActiveSids, runningUnits: runningUnits, TASKS: TASKS, S: S };\n" + m.slice(_i);

/* ---------- DOM stub（与 selftest-sidebar-order.js 同源骨架） ---------- */
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
  return all.filter(el => {
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
  const resp = (obj) => ({ ok: true, status: 200, json: () => Promise.resolve(obj), text: () => Promise.resolve('') });
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

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))) }
}
function eq(name, got, want){ ok(name, got === want, got) }

setImmediate(() => {
  const T = sandbox.__T;
  if (!T || typeof T.taskModel !== 'function'){ console.error('FAIL 注入钩子缺失（__T）'); process.exit(1) }
  const model = T.taskModel, stageOf = T.stageOf, stageLabel = T.stageLabel, S_ENDED = T.S_ENDED;

  /* ---------- ① 合并去重：同 sid 台账行 + live 行 → 恰好一条且 source='both' ---------- */
  const ledger1 = [
    { id: 'L1', runnerSession: 'sidA', state: 'running', inTask: true, lastEventAt: 1000,
      title: '台账标题', etaMinutes: 15, etaDeadline: 9999999, etaOverdueMin: 2, runnerAgent: 'writer', step: 1 },
  ];
  const live1 = [
    { sid: 'sidA', state: 'running', live: true, updated: 2000, title: '实时标题',
      phase: '子代理执行中', elapsed: 5000, progress: 'p1' },
  ];
  const m1 = model(ledger1, live1);
  eq('①-数量', m1.length, 1);
  eq('①-key', m1[0] && m1[0].key, 'sid:sidA');
  eq('①-source', m1[0] && m1[0].source, 'both');
  eq('①-live', m1[0] && m1[0].live, true);
  eq('①-eta', m1[0] && m1[0].etaMinutes, 15);
  eq('①-phase取实时', m1[0] && m1[0].phase, '子代理执行中');
  eq('①-at取大', m1[0] && m1[0].at, 2000);

  /* ---------- ② 无 sid 台账行单列 ---------- */
  const m2 = model([{ id: 'L2', state: 'running', inTask: true, lastEventAt: 50 }], []);
  eq('②-数量', m2.length, 1);
  eq('②-key', m2[0] && m2[0].key, 'ledger:L2');
  eq('②-source', m2[0] && m2[0].source, 'ledger');
  eq('②-sid空', m2[0] && m2[0].sid, '');

  /* ---------- ③ 四态 stage 判定 ---------- */
  eq('③-active', stageOf({ state: 'running', stale: 'active', live: true }), 'active');
  eq('③-quiet', stageOf({ state: 'running', stale: 'quiet', staleMinutes: 7 }), 'quiet');
  eq('③-stalled', stageOf({ state: 'running', stale: 'stalled', staleMinutes: 20, live: false }), 'stalled');
  eq('③-stalled但有live真值→active', stageOf({ state: 'running', stale: 'stalled', live: true }), 'active');
  eq('③-ended-done', stageOf({ state: 'done', stale: 'active' }), 'ended');
  eq('③-ended-interrupted', stageOf({ state: 'interrupted' }), 'ended');
  eq('③-ended-failed', stageOf({ state: 'failed' }), 'ended');
  eq('③-ended-完成注入', (function(){ S_ENDED['sidZ'] = 1; var r = stageOf({ state: 'running', sid: 'sidZ' }); delete S_ENDED['sidZ']; return r })(), 'ended');
  /* 模型层终态：live 已 done 而台账仍 running → 收口 ended */
  const m3 = model([{ id: 'L3', runnerSession: 'sidB', state: 'running', inTask: true }],
                   [{ sid: 'sidB', state: 'done', live: true, ended: true }]);
  eq('③-模型live收口', m3[0] && m3[0].stage, 'ended');

  /* ---------- ④ stageLabel 文案 ---------- */
  eq('④-在跑', stageLabel('active', {}), '在跑');
  eq('④-静默Nm', stageLabel('quiet', { staleMinutes: 7 }), '静默 7m');
  eq('④-疑似中断', stageLabel('stalled', { staleMinutes: 20 }), '疑似中断（静默 20m）');
  eq('④-完成', stageLabel('ended', { state: 'done' }), '完成');
  eq('④-中断', stageLabel('ended', { state: 'interrupted' }), '中断');
  eq('④-失败', stageLabel('ended', { state: 'failed' }), '失败');

  /* ---------- ⑤ 坏数据容错（null/缺字段不抛） ---------- */
  let noThrow = true, r5 = null;
  try {
    r5 = model(null, null);
    eq('⑤-空输入', r5.length, 0);
    r5 = model([null, {}, { id: 'bad' }, { id: 'L4', inTask: true }], [null, {}, { sid: '' }]);
    eq('⑤-坏行过滤后数量', r5.length, 1);
    eq('⑤-坏行key', r5[0] && r5[0].key, 'ledger:L4');
    eq('⑤-stageOf(null)', stageOf(null), 'active');
    eq('⑤-stageLabel空', stageLabel('active', null), '在跑');
  } catch(e){ noThrow = false; console.log('  异常：' + (e && e.stack || e)) }
  ok('⑤-坏数据不抛', noThrow);

  /* ---------- ⑥ 三模式排序（§3.2 ORDERS，唯一比较器族） ---------- */
  const uu = (k, st, at) => ({ key: k, stage: st, at, updated: at });
  const raw = [uu('a', 'ended', 500), uu('b', 'quiet', 400), uu('c', 'active', 300), uu('d', 'stalled', 200)];
  const orderOf = (cmp) => raw.slice().sort(cmp).map(x => x.key).join(',');
  eq('⑥-active 排序（在跑>静默>疑似中断>已结束，再按 at 降序）', orderOf(T.ORDERS.active), 'c,b,d,a');
  eq('⑥-recent 排序（纯 at 降序）', orderOf(T.ORDERS.recent), 'a,b,c,d');
  T.setTaskManualPos({ a: 0, d: 1, c: 2, b: 3 });
  eq('⑥-manual 排序（pos 优先）', orderOf(T.ORDERS.manual), 'a,d,c,b');
  /* 同等 at：manual 用 pos 决胜；active 对同权重保持输入序（稳定） */
  const tie = [uu('x', 'active', 100), uu('y', 'active', 100)];
  T.setTaskManualPos({ y: 0, x: 5 });
  eq('⑥-manual 同 at 用 pos 决胜', tie.slice().sort(T.ORDERS.manual).map(x => x.key).join(','), 'y,x');
  eq('⑥-active 同 at 稳定', tie.slice().sort(T.ORDERS.active).map(x => x.key).join(','), 'x,y');
  eq('⑥-比较器同键返 0', T.ORDERS.active(tie[0], tie[0]) === 0 && T.ORDERS.recent(tie[0], tie[0]) === 0 && T.ORDERS.manual(tie[0], tie[0]) === 0, true);
  T.setTaskManualPos({});
  eq('⑥-默认模式', T.taskOrderMode(), 'active');

  /* ---------- ⑦ task334：折叠族已退役——waiting 五态判定 + 已结束常驻语义 ---------- */
  const NOW = 1000000000000;
  eq('⑦-waiting 判 stage=waiting', T.stageOf({ key: 'w', state: 'waiting', at: NOW, updated: NOW }), 'waiting');
  eq('⑦-waiting 不算终态', T.taskTerminalState('waiting'), false);
  eq('⑦-waiting 文案带短语', T.stageLabel('waiting', { overrideNote: '测试台无限循环监督' }), '🟡 等待中·测试台无限循环监督');
  eq('⑦-waiting 文案无短语', T.stageLabel('waiting', {}), '🟡 等待中');
  eq('⑦-waiting 长短语截断(>12字)', T.stageLabel('waiting', { overrideNote: '一二三四五六七八九十一二三四五' }), '🟡 等待中·一二三四五六七八九十一二…');
  eq('⑦-五态排序 active<waiting<quiet', T.taskStageRank({ stage: 'active' }) < T.taskStageRank({ stage: 'waiting' }) && T.taskStageRank({ stage: 'waiting' }) < T.taskStageRank({ stage: 'quiet' }), true);
  eq('⑦-waiting 排在 ended 前', T.taskStageRank({ stage: 'waiting' }) < T.taskStageRank({ stage: 'ended' }), true);

  /* ---------- ⑧ DOM stub 渲染：task334 已结束常驻不折叠 + waiting 卡片 ---------- */
  let renderOk = true;
  try {
    const nowMs = Date.now();
    T.TASKS.list = [
      { id: 'K1', state: 'running', inTask: true, lastEventAt: nowMs - 1000, title: '在跑1' },
      { id: 'K2', state: 'running', inTask: true, lastEventAt: nowMs - 2000, title: '在跑2' },
      { id: 'K3', state: 'done', inTask: true, lastEventAt: nowMs - 600000, title: '早结束' },
      { id: 'K4', state: 'waiting', inTask: true, lastEventAt: nowMs - 300000, title: '等待中任务', overrideNote: '测试台无限循环监督' },
    ];
    T.TASKS.etas = {};
    T.S.lastMsgs = []; T.S._lastMsgsSid = ''; T.S.current = { id: 'curK' }; T.S.sessions = [];
    T.renderTaskUnits(T.taskUnits(), true);
    const rb = sandbox.document.querySelector('#rightBody');
    const all = walk(rb, []);
    const cards = all.filter(e => e._cls.has('tcard'));
    const keys = cards.map(c => c.dataset.tkey).sort();
    const foldHead = all.filter(e => e._cls.has('tc-ended-h'))[0];
    ok('⑧-折叠段头已退役（不存在）', !foldHead, foldHead ? foldHead.textContent : null);
    eq('⑧-卡片全量常驻（4张全在）', cards.length, 4);
    eq('⑧-早结束卡片可见', keys.indexOf('ledger:K3') >= 0, true);
    eq('⑧-waiting 卡片可见', keys.indexOf('ledger:K4') >= 0, true);
    const wCard = cards.filter(c => c.dataset.tkey === 'ledger:K4')[0];
    ok('⑧-waiting 卡片类', !!(wCard && wCard._cls.has('waiting')), wCard ? Array.from(wCard._cls).join(',') : null);
    /* task334 P1-3：等待中卡必须有「解除等待」按钮（防死状态）——stub 无 tag 字段，按 tagName 判 */
    const wActs = wCard ? walk(wCard, []).filter(e => e.tagName === 'BUTTON' && String(e._text || '').indexOf('解除等待') >= 0) : [];
    ok('⑧-waiting 卡有解除等待按钮', wActs.length >= 1, wActs.length);
  } catch(e){ renderOk = false; console.log('  渲染异常：' + (e && e.stack || e)) }
  ok('⑧-渲染不抛', renderOk);

  /* ---------- ⑨ 分组不改排序：同一枢机组跨排序位置时仍按全局顺序渲染 ---------- */
  let orderOk = true;
  try {
    T.TASKS.list = []; T.S.sessions = []; T.S.lastMsgs = [];
    const us = [
      { key: 'u1', lid: 'G1', title: 'A', state: 'running', updated: 300, at: 300, stage: 'active', artifacts: [] },
      { key: 'u2', lid: 'G2', title: 'B', state: 'running', updated: 500, at: 500, stage: 'active', artifacts: [] },
      { key: 'u3', lid: 'G1', title: 'C', state: 'running', updated: 100, at: 100, stage: 'active', artifacts: [] },
    ];
    T.renderTaskUnits(us, true);
    const rb2 = sandbox.document.querySelector('#rightBody');
    const seq = walk(rb2, []).filter(e => e._cls.has('tcard')).map(c => c.dataset.tkey).join(',');
    eq('⑨-分组不改全局排序', seq, 'u2,u1,u3');
  } catch(e){ orderOk = false; console.log('  分组渲染异常：' + (e && e.stack || e)) }
  ok('⑨-分组渲染不抛', orderOk);

  /* ---------- ⑩ S4 §3.3：手动模式保存 / 回读 / 回滚 / 坏档容错 ---------- */
  (async () => {
    let s4ok = true;
    try {
      T.TASKS.list = [
        { id: 'M1', state: 'running', inTask: true, lastEventAt: 3000, title: '任务一' },
        { id: 'M2', state: 'running', inTask: true, lastEventAt: 2000, title: '任务二' },
        { id: 'M3', state: 'done', inTask: true, lastEventAt: 1000, title: '任务三' },
      ];
      T.TASKS.etas = {};
      T.S.lastMsgs = []; T.S.sessions = []; T.S.current = { id: 'curM' }; T.S.convOrder = {};
      T.S._lastMsgsSid = '';
      sandbox.localStorage.removeItem('littledj.taskOrderMode');
      T.setTaskManualPos({});
      T.setTaskOrderMode('recent');
      eq('⑩-初始模式 recent', T.taskOrderMode(), 'recent');
      T.enterTaskManual();
      eq('⑩-进入手动 editing', T.isTaskManualEditing(), true);
      const tb0 = walk(sandbox.document.querySelector('#rightBody'), []).filter(e => e._cls.has('taskbar'))[0];
      const tb0btn = tb0 ? walk(tb0, []).filter(e => e.tagName === 'BUTTON').map(e => e.textContent) : [];
      ok('⑩-工具条含 手动/保存/取消', !!tb0 && tb0btn.indexOf('⇅ 手动') >= 0 && tb0btn.indexOf('保存') >= 0 && tb0btn.indexOf('取消') >= 0, tb0btn);
      eq('⑩-进入手动初始顺序（按进入前 recent）', T.taskManualOrderKeys(T.taskUnits()).join(','), 'ledger:M1,ledger:M2,ledger:M3');
      T.moveTaskUnit('ledger:M3', -1);
      T.moveTaskUnit('ledger:M3', -1);
      eq('⑩-上移两次后的顺序', T.taskManualOrderKeys(T.taskUnits()).join(','), 'ledger:M3,ledger:M1,ledger:M2');
      /* 保存：POST /_conv-order 的 ids 顺序必须与当前手动顺序一致 */
      const okSave = await T.saveTaskManual();
      eq('⑩-保存返回 true', okSave, true);
      const posts = fetchLog.filter(x => x.method === 'POST' && x.url === '/_conv-order');
      const saveBody = posts.length ? JSON.parse(posts[posts.length - 1].body) : null;
      eq('⑩-保存 projKey', saveBody && saveBody.projKey, '__tasks__');
      eq('⑩-保存 ids 顺序', saveBody && saveBody.ids.join(','), 'ledger:M3,ledger:M1,ledger:M2');
      eq('⑩-保存后退出编辑', T.isTaskManualEditing(), false);
      eq('⑩-保存后模式 manual', T.taskOrderMode(), 'manual');
      eq('⑩-保存后缓存回写', (T.S.convOrder['__tasks__'] || []).join(','), 'ledger:M3,ledger:M1,ledger:M2');

      /* 回读：模拟服务端返回另一顺序 → manual 排序按它生效 */
      const oldFetch = sandbox.fetch;
      sandbox.fetch = (url, opt) => {
        if (String(url) === '/_conv-order' && (!opt || !opt.method || opt.method === 'GET')){
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ order: { __tasks__: ['ledger:M2', 'ledger:M3', 'ledger:M1'] } }) });
        }
        return oldFetch(url, opt);
      };
      const okRead = await T.refreshTaskConvOrder();
      sandbox.fetch = oldFetch;
      eq('⑩-回读成功', okRead, true);
      eq('⑩-回读后 manual 排序跟随服务端', T.taskManualOrderKeys(T.taskUnits()).join(','), 'ledger:M2,ledger:M3,ledger:M1');

      /* 取消回滚：进入手动→改序→取消 → 恢复进入前的快照（且不写服务端） */
      const postCountBefore = fetchLog.filter(x => x.method === 'POST' && x.url === '/_conv-order').length;
      T.enterTaskManual();
      T.moveTaskUnit('ledger:M1', -1);
      eq('⑩-取消前已改序', T.taskManualOrderKeys(T.taskUnits()).join(','), 'ledger:M2,ledger:M1,ledger:M3');
      T.cancelTaskManual();
      eq('⑩-取消后恢复快照', T.taskManualOrderKeys(T.taskUnits()).join(','), 'ledger:M2,ledger:M3,ledger:M1');
      eq('⑩-取消后退出编辑', T.isTaskManualEditing(), false);
      eq('⑩-取消后模式回快照', T.taskOrderMode(), 'manual');
      eq('⑩-取消不写服务端', fetchLog.filter(x => x.method === 'POST' && x.url === '/_conv-order').length, postCountBefore);

      /* 保存失败：模式不变、保留当前手动顺序、返回 false */
      T.setTaskOrderMode('active');
      T.enterTaskManual();
      T.moveTaskUnit('ledger:M3', -1);
      const keepOrder = T.taskManualOrderKeys(T.taskUnits()).join(',');
      const oldFail = sandbox.fetch;
      sandbox.fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ ok: false, error: 'mock 500' }) });
      const okFail = await T.saveTaskManual();
      sandbox.fetch = oldFail;
      eq('⑩-保存失败返回 false', okFail, false);
      eq('⑩-保存失败仍在编辑', T.isTaskManualEditing(), true);
      eq('⑩-保存失败模式不变', T.taskOrderMode(), 'manual');
      eq('⑩-保存失败保留手动顺序', T.taskManualOrderKeys(T.taskUnits()).join(','), keepOrder);
      T.cancelTaskManual();
      eq('⑩-失败后取消回滚模式 active', T.taskOrderMode(), 'active');

      /* 坏档容错：null / 非数组 / 非 JSON 响应都不抛 */
      let badNoThrow = true;
      const oldBad = sandbox.fetch;
      try {
        sandbox.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ order: null }) });
        await T.refreshTaskConvOrder();
        sandbox.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ order: { __tasks__: 'bad' } }) });
        await T.refreshTaskConvOrder();
        sandbox.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) });
        await T.refreshTaskConvOrder();
        sandbox.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ order: { __tasks__: [] } }) });
        const cleared = await T.refreshTaskConvOrder();
        eq('⑩-空数组回读成功', cleared, true);
        eq('⑩-空数组清除后回落时间序', T.taskManualOrderKeys(T.taskUnits()).join(','), 'ledger:M1,ledger:M2,ledger:M3');
      } catch(e){ badNoThrow = false }
      sandbox.fetch = oldBad;
      ok('⑩-坏档容错不抛', badNoThrow);

      /* 筛选只影响显示不改排序：在跑=非 ended；已结束=ended */
      T.setTaskOrderMode('recent');
      T.setTaskFilter('running');
      T.renderTaskUnits(T.taskUnits(), true);
      let rb3 = sandbox.document.querySelector('#rightBody');
      let cards3 = walk(rb3, []).filter(e => e._cls.has('tcard')).map(c => c.dataset.tkey).sort();
      eq('⑩-筛选在跑只显示未结束', cards3.join(','), 'ledger:M1,ledger:M2');
      T.setTaskFilter('ended');
      T.renderTaskUnits(T.taskUnits(), true);
      rb3 = sandbox.document.querySelector('#rightBody');
      const endCards3 = walk(rb3, []).filter(e => e._cls.has('tcard')).map(c => c.dataset.tkey).sort();
      const foldHead3 = walk(rb3, []).filter(e => e._cls.has('tc-ended-h'))[0];
      /* task334：折叠段已退役——ended 筛选下已结束卡片直接常驻可见 */
      eq('⑩-筛选已结束只留已结束卡片（常驻不折叠）', endCards3.join(','), 'ledger:M3');
      ok('⑩-折叠段头已退役（不存在）', !foldHead3, foldHead3 ? foldHead3.textContent : null);
      T.setTaskFilter('all');
    } catch(e){ s4ok = false; console.log('  S4 异常：' + (e && e.stack || e)) }
    ok('⑩-S4 手动模式链路不抛', s4ok);

    /* ---------- ⑪ S5 §3.4 卡片瘦身结构（头部/次行/折叠区/状态胶囊/≥3 卡） ---------- */
    let s5ok = true;
    try {
      T.TASKS.list = []; T.TASKS.etas = {}; T.S.sessions = []; T.S.lastMsgs = []; T.S.current = { id: 'curS5' };
      T.setTaskFilter('all'); T.setTaskManualPos({});
      sandbox.localStorage.setItem('littledj.taskOrderMode', 'active');
      const nowS5 = Date.now();
      const longText = '一二三四五六七八九十'.repeat(8); /* 80 字，验证截 60 + 省略号 */
      const units = [
        { key: 'sid:c1', lid: 'curS5', sid: 'c1', runnerAgent: 'writer', title: '卡片A', state: 'running', stage: 'active',
          at: nowS5 - 1000, updated: nowS5 - 1000, live: true, lastEventText: longText, progress: '进度A',
          artifacts: ['a.txt'], etaMinutes: 10, etaOverdueMin: 0 },
        { key: 'sid:c2', lid: 'curS5', sid: 'c2', title: '卡片B', state: 'running', stage: 'active',
          at: nowS5 - 2000, updated: nowS5 - 2000, lastEventText: '', progress: '进度B内容', artifacts: [] },
        { key: 'sid:c3', lid: 'curS5', sid: 'c3', title: '卡片C', state: 'running', stage: 'quiet', staleMinutes: 7,
          at: nowS5 - 3000, updated: nowS5 - 3000, progress: '进度C', artifacts: [] },
      ];
      T.renderTaskUnits(units, true);
      const rb5 = sandbox.document.querySelector('#rightBody');
      const all5 = walk(rb5, []);
      const cards5 = all5.filter(e => e._cls.has('tcard'));
      ok('⑪-首屏 ≥3 张卡可见', cards5.length >= 3, cards5.length);
      const cardA = cards5.filter(c => c.dataset.tkey === 'sid:c1')[0];
      const cardB = cards5.filter(c => c.dataset.tkey === 'sid:c2')[0];
      const headA = cardA ? walk(cardA, []).filter(e => e._cls.has('tcard-h'))[0] : null;
      ok('⑪-头部存在', !!headA);
      ok('⑪-角色徽标', !!headA && walk(headA, []).some(e => e._cls.has('tcard-role') && e._cls.has('role-writer') && e.textContent === '执笔'), headA ? headA.textContent : null);
      const pillA = headA ? walk(headA, []).filter(e => e._cls.has('tcard-st'))[0] : null;
      ok('⑪-状态胶囊走 stageLabel+stage类', !!pillA && pillA.textContent === '在跑' && pillA._cls.has('stage-active'), pillA ? { text: pillA.textContent, cls: [...pillA._cls] } : null);
      const subA = cardA ? walk(cardA, []).filter(e => e._cls.has('tcard-sub'))[0] : null;
      ok('⑪-次行最新一句截 60 字', !!subA && subA.textContent.length === 61 && subA.textContent.slice(-1) === '…', subA ? { len: subA.textContent.length } : null);
      const subB = cardB ? walk(cardB, []).filter(e => e._cls.has('tcard-sub'))[0] : null;
      ok('⑪-次行回落进度', !!subB && subB.textContent === '进度B内容', subB ? subB.textContent : null);
      const bodyA = cardA ? walk(cardA, []).filter(e => e._cls.has('tcard-b'))[0] : null;
      ok('⑪-折叠区存在且默认收起', !!bodyA && cardA._cls.has('open') === false);
      const bodyTxt = bodyA ? bodyA.textContent : '';
      const bodyBtns = bodyA ? walk(bodyA, []).filter(e => e.tagName === 'BUTTON').map(e => e.textContent) : [];
      ok('⑪-折叠区含阶段/ETA/产物/打开子会话', bodyTxt.indexOf('阶段：') >= 0 && bodyTxt.indexOf('预计 10 分钟') >= 0 && bodyTxt.indexOf('a.txt') >= 0 && bodyBtns.indexOf('打开子会话') >= 0, { bodyTxt, bodyBtns });
      /* 首屏结构瘦身：卡内直接可见行只有头部 + 次行（折叠区默认 display:none） */
      const visibleRows = cardA ? cardA.children.filter(c => !c._cls.has('tcard-b')).length : -1;
      eq('⑪-首屏仅头部+次行', visibleRows, 2);
      /* 四态胶囊文案（直接调 renderTaskUnitCard，验证全部走 stageLabel） */
      const pillOf = (u) => { const c = T.renderTaskUnitCard(u, {}); const p = walk(c, []).filter(e => e._cls.has('tcard-st'))[0]; return p ? p.textContent : ''; };
      eq('⑪-静默胶囊文案', pillOf({ key: 'q', title: 'q', state: 'running', stage: 'quiet', staleMinutes: 7 }), '静默 7m');
      eq('⑪-疑似中断胶囊文案', pillOf({ key: 's', title: 's', state: 'running', stage: 'stalled', staleMinutes: 20 }), '疑似中断（静默 20m）');
      eq('⑪-完成胶囊文案', pillOf({ key: 'e', title: 'e', state: 'done', stage: 'ended', ended: true }), '完成');
      /* 折叠区按钮组齐备：顺延 / 标记完成 / 标记中断 / 打开子会话 */
      const cBtn = T.renderTaskUnitCard({ key: 'b', lid: 'L', sid: 'S', title: 'btn', state: 'running', stage: 'active', markable: true, etaMinutes: 10, etaOverdueMin: 3, artifacts: [] }, {});
      const btnTexts = walk(cBtn, []).filter(e => e.tagName === 'BUTTON').map(e => e.textContent);
      ok('⑪-按钮组含 顺延/完成/中断/打开子会话', ['顺延 10m', '标记完成', '标记中断', '打开子会话'].every(t => btnTexts.indexOf(t) >= 0), btnTexts);
    } catch(e){ s5ok = false; console.log('  S5 异常：' + (e && e.stack || e)) }
    ok('⑪-S5 卡片瘦身结构不抛', s5ok);

    /* ---------- ⑪-b 回归（task158）：live-only 单元（有 sid、无 lid）不得因 mkBtn 作用域崩溃 ---------- */
    let s5b = true;
    try {
      const cLive = T.renderTaskUnitCard({ key: 'live:x', sid: 'S1', title: 'live-only', state: 'running', stage: 'active', live: true, artifacts: [] }, {});
      const bt = walk(cLive, []).filter(e => e.tagName === 'BUTTON').map(e => e.textContent);
      ok('⑪b-live-only 单元含「打开子会话」', bt.indexOf('打开子会话') >= 0, bt);
    } catch(e){ s5b = false; console.log('  live-only 渲染异常：' + (e && e.stack || e)) }
    ok('⑪b-live-only 单元渲染不抛', s5b);

    /* ---------- ⑫ S6 §3.5 四调用点统一 stage 口径 + 两出口收口 ---------- */
    let s6ok = true;
    try {
      const liveMsg = (sid, status) => ({ info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'task',
        state: { status: status || 'running', metadata: { sessionId: sid }, time: { start: 1 } } }] });
      const keySet = (o) => Object.keys(o).sort().join(',');

      /* ① runningUnits：只算 active（quiet/stalled/ended 均不计） */
      T.S.lastMsgs = []; T.S.busyBy = {}; T.TASKS.etas = {};
      T.TASKS.list = [
        { id: 'R1', state: 'running', inTask: true, stale: 'active', lastEventAt: 1, title: '跑' },
        { id: 'R2', state: 'running', inTask: true, stale: 'quiet', staleMinutes: 7, lastEventAt: 1, title: '静默' },
        { id: 'R3', state: 'running', inTask: true, stale: 'stalled', staleMinutes: 20, lastEventAt: 1, title: '疑中' },
        { id: 'R4', state: 'done', inTask: true, stale: 'active', lastEventAt: 1, title: '结束' },
      ];
      eq('⑫-runningUnits 只算 active', T.runningUnits().map(u => u.key).sort().join(','), 'ledger:R1');

      /* ② ledgerActiveSids（无 live 真值）：active 锁；quiet/stalled/终态不锁 */
      eq('⑫-ledgerActiveSids 无 live：仅 active 锁', keySet(T.ledgerActiveSids()), 'R1');

      /* ②b stalled 台账行但有 live 真值 → 按 live 判 active（行为变更：旧口径不锁） */
      T.S.lastMsgs = [liveMsg('rsid', 'running')];
      T.TASKS.list = [{ id: 'R3', runnerSession: 'rsid', state: 'running', inTask: true, stale: 'stalled', staleMinutes: 20, lastEventAt: 1 }];
      const lockLive = T.ledgerActiveSids();
      ok('⑫-ledgerActiveSids 有 live 真值时 stalled 按 active 锁', !!lockLive['R3'] && !!lockLive['rsid'], lockLive);

      /* ②c 已收口（S_ENDED）但台账仍 running → 不锁（行为变更：减少误锁） */
      T.S.lastMsgs = [];
      T.TASKS.list = [{ id: 'R5', runnerSession: 'endedSid', state: 'running', inTask: true, stale: 'active', lastEventAt: 1 }];
      T.S_ENDED['endedSid'] = 1;
      const lockEnded = T.ledgerActiveSids();
      ok('⑫-ledgerActiveSids 已收口(S_ENDED)不锁', !lockEnded['R5'] && !lockEnded['endedSid'], lockEnded);
      delete T.S_ENDED['endedSid'];

      /* ③ taskFollowCandidate：仅 active 跟随 */
      const fc = (o) => T.taskFollowCandidate(Object.assign({ lid: 'L' }, o));
      eq('⑫-follow active 跟随', fc({ state: 'running', stale: 'active' }), true);
      eq('⑫-follow quiet 不跟随', fc({ state: 'running', stale: 'quiet', staleMinutes: 7 }), false);
      eq('⑫-follow stalled 不跟随', fc({ state: 'running', stale: 'stalled', staleMinutes: 20 }), false);
      eq('⑫-follow ended 不跟随', fc({ state: 'done' }), false);
      eq('⑫-follow archived 不跟随', fc({ state: 'running', stale: 'archived' }), false);
      eq('⑫-follow 无 lid 不跟随', T.taskFollowCandidate({ state: 'running' }), false);

      /* ④ tasksInFlightNow：active + 台账非 stalled 在途（task376 补强：quiet 也算，防子代理跑完一轮
         S_ENDED 提前判死导致自动交接抢跑；stalled 静默≥15min 仍排除，防僵尸卡死交接） */
      T.S.lastMsgs = []; T.S.busyBy = {};
      T.TASKS.list = [
        { id: 'F1', runnerSession: 'fa', state: 'running', inTask: true, stale: 'active', lastEventAt: 1 },
        { id: 'F2', runnerSession: 'fq', state: 'running', inTask: true, stale: 'quiet', staleMinutes: 7, lastEventAt: 1 },
        { id: 'F3', runnerSession: 'fs', state: 'running', inTask: true, stale: 'stalled', staleMinutes: 20, lastEventAt: 1 },
        { id: 'F4', runnerSession: 'fd', state: 'done', inTask: true, stale: 'active', lastEventAt: 1 },
      ];
      eq('⑫-inFlight active+quiet 算、stalled/终态不算', T.tasksInFlightNow().sort().join(','), 'fa,fq');
      T.TASKS.list = []; T.S.lastMsgs = [liveMsg('flive', 'running')];
      eq('⑫-inFlight 含 live active', T.tasksInFlightNow().join(','), 'flive');
      T.S.lastMsgs = []; T.S.busyBy = { bs: 1 }; T.S_ENDED['bs'] = 1;
      eq('⑫-inFlight busyBy 已收口不计', T.tasksInFlightNow().length, 0);
      delete T.S_ENDED['bs']; T.S.busyBy = {};


      /* ⑥ 坏档不抛：四调用点 + 两出口喂 null/缺字段 */
      let bad6 = true;
      try {
        const keepList = T.TASKS.list, keepBusy = T.S.busyBy, keepMsgs = T.S.lastMsgs;
        T.TASKS.list = null; T.S.busyBy = null; T.S.lastMsgs = null;
        T.runningUnits(); T.ledgerActiveSids(); T.tasksInFlightNow();
        T.taskFollowCandidate(null);
        T.TASKS.list = keepList; T.S.busyBy = keepBusy; T.S.lastMsgs = keepMsgs;
      } catch(e){ bad6 = false; console.log('  S6 坏档异常：' + (e && e.stack || e)) }
      ok('⑫-坏档不抛（四调用点+出口）', bad6);
    } catch(e){ s6ok = false; console.log('  S6 异常：' + (e && e.stack || e)) }
    ok('⑫-S6 四调用点 stage 口径一致', s6ok);

    /* ---------- ⑬ S6b：taskUnits 改走 taskModel 显式合并（退役 key 前缀 hack） ---------- */
    let s6bok = true;
    try {
      const liveMsg2 = (sid, started, callID) => ({ info: { role: 'assistant' }, parts: [{ type: 'tool', tool: 'task', callID: callID || '',
        state: { status: 'running', metadata: sid ? { sessionId: sid } : {}, time: { start: started } } }] });
      T.S.busyBy = {}; T.TASKS.etas = {};
      T.S._lastMsgsSid = 'ownerS'; T.S.current = { id: 'curT' };
      T.S.lastMsgs = [ liveMsg2('sidA', 2500), liveMsg2('sidC', 2000), liveMsg2('', 1000, 'callX') ];
      T.TASKS.list = [
        { id: 'A1', runnerSession: 'sidA', state: 'running', inTask: true, stale: 'active', lastEventAt: 5000, title: '合并A', etaMinutes: 12, level: 'L1', step: 1 },
        { id: 'B1', state: 'running', inTask: true, stale: 'active', lastEventAt: 4000, title: '无sid台账', level: 'L2', step: 1 },
        { id: 'A1dup', runnerSession: 'sidA', state: 'running', inTask: true, stale: 'active', lastEventAt: 3000, title: '同sid重复台账', step: 1 },
      ];
      const liveArr = T.collectLiveTasks();
      const mod = T.taskModel(T.TASKS.list, liveArr);
      const tu = T.taskUnits();
      /* a) 单元集合 / source / stage 与 taskModel 完全一致 */
      eq('⑬-数量与taskModel一致', tu.length, mod.length);
      eq('⑬-单元集合与taskModel一致', tu.map(u => u.key).sort().join(','), mod.map(u => u.key).sort().join(','));
      const tuByKey = {}; tu.forEach(u => { tuByKey[u.key] = u });
      eq('⑬-source 与 taskModel 一致', mod.every(x => tuByKey[x.key] && tuByKey[x.key].source === x.source), true);
      eq('⑬-stage 与 taskModel 一致', mod.every(x => tuByKey[x.key] && tuByKey[x.key].stage === x.stage), true);
      /* b) 同 sid 台账（A1 + A1dup）+ live 合成恰好一条，不再因前缀 hack 丢失/重复 */
      eq('⑬-同sid不重复', tu.filter(u => u.sid === 'sidA').length, 1);
      const ua = tuByKey['sid:sidA'];
      ok('⑬-同sid合成source=both/字段合并', !!ua && ua.source === 'both' && ua.live === true && ua.lid === 'A1' && ua.etaMinutes === 12 && ua.phase === '子代理执行中' && ua.elapsed > 0,
        ua && { source: ua.source, live: ua.live, lid: ua.lid, eta: ua.etaMinutes, phase: ua.phase, elapsed: ua.elapsed });
      /* c) 无 sid 台账 → 合法兜底键 ledger:<id>（taskModel 显式兜底，非去重 hack） */
      const ub = tuByKey['ledger:B1'];
      ok('⑬-无sid台账单列ledger键', !!ub && ub.lid === 'B1' && ub.sid === '' && ub.live === false && ub.level === 'L2', ub && { lid: ub.lid, sid: ub.sid, live: ub.live });
      /* d) live-only 单元保留归属 ownerSid，key 不重复 */
      eq('⑬-live-only(sid)保留ownerSid', (tuByKey['sid:sidC'] || {}).ownerSid, 'ownerS');
      eq('⑬-live-only(无sid)保留ownerSid', (tuByKey['live:callX'] || {}).ownerSid, 'ownerS');
      eq('⑬-key 无重复', new Set(tu.map(u => u.key)).size, tu.length);
      /* e) 对外字段 shape 齐备（供消费方兼容） */
      const need = ['key','title','state','stage','phase','progress','artifacts','level','sid','lid','ownerSid','runnerAgent','markable','overridden','ended','live','updated','at','stale','staleMinutes','elapsed','lastEventText','etaMinutes','etaDeadline','etaOverdueMin','source'];
      eq('⑬-字段齐备', tu.every(u => need.every(k => Object.prototype.hasOwnProperty.call(u, k))), true);
      /* f) 排序基线：已结束置底，其次可标记置顶，其余按 updated 降序 */
      eq('⑬-排序基线', tu.map(u => u.key).join(','), 'sid:sidA,ledger:B1,sid:sidC,live:callX');
      /* g) 坏档容错：null/缺字段台账与消息不抛 */
      let bad13 = true;
      try {
        T.TASKS.list = [null, {}, { id: 'bad' }, { id: 'x', inTask: false }];
        T.S.lastMsgs = [{}, { info: { role: 'assistant' }, parts: [{}] }];
        const r13 = T.taskUnits();
        eq('⑬-坏档不生成幽灵行', r13.length, 0);
      } catch(e){ bad13 = false; console.log('  ⑬ 坏档异常：' + (e && e.stack || e)) }
      ok('⑬-坏档容错不抛', bad13);
      /* 复位 */
      T.S._lastMsgsSid = ''; T.S.lastMsgs = []; T.TASKS.list = [];
    } catch(e){ s6bok = false; console.log('  S6b 异常：' + (e && e.stack || e)) }
    ok('⑬-S6b taskUnits 走 taskModel 显式合并', s6bok);

    console.log('\nRESULT: ' + (fail ? 'FAIL' : 'PASS') + '（数据层+排序+waiting+手动排序 ' + pass + ' 项通过，' + fail + ' 项失败）');
    process.exit(fail ? 1 : 0);
  })();
});

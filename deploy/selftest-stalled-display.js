/* task159 疑似中断显示层终态自测（无需浏览器/proxy 进程）：
   A. ui/index.html childStatusInfo——台账终态优先（interrupted→已中断 / done→已完成），
      busy 优先级、非终态行不误吃、无匹配走原兜底（回归）。
   B. server/proxy.js bootLedgerText——已标记 interrupted 行文案「已中断…可 reopen」，
      不再出现「待人工标记」；未标记 stalled 行原文案不变（回归）；done 行仍被过滤。
   用法：node deploy/selftest-stalled-display.js （exit 0=PASS / 1=FAIL / 2=装载失败）
   红对照：把 ui 的 fin 终态分支注释掉跑 ⑴⑵ 应 FAIL；把 proxy 的 interrupted 分支删掉跑 ⑻ 应 FAIL。 */
const fs = require('fs'), vm = require('vm');
const UI = process.env.UI_PATH || '/storage/Users/currentUser/project/littleDJ/ui/index.html';
const PX = process.env.PX_PATH || '/storage/Users/currentUser/project/littleDJ/server/proxy.js';

/* ================= A. UI：childStatusInfo ================= */
/* task269：接 selftest-load-ui 共享加载器（DJH P1 拆包后 $ 已在 ui/src/core/dom.js）。
   ⚠S：UI_PATH 语义收窄为「dirname(UI) 须为工作区 ui/ 目录（含 src/ 四模块）」——
   指向无 src/ 的快照副本会 ENOENT，红对照请直接改工作区源文件再跑。 */
let m = require('./selftest-load-ui').loadUiSource(require('path').dirname(UI));
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { childStatusInfo: childStatusInfo, S: S, TASKS: TASKS, S_ENDED: S_ENDED };\n" + m.slice(_i);

/* DOM stub（与 selftest-task-panel.js 同源骨架） */
function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag||'').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {},
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 0,
    get classList(){ const s = e._cls; return {
      add: (...a)=>a.forEach(x=>s.add(x)), remove:(...a)=>a.forEach(x=>s.delete(x)),
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
    querySelector(sel){ return null }, querySelectorAll(sel){ return [] }, closest(){ return null },
  };
  return e;
}
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: true, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(){ return mkEl('div') }, querySelectorAll(){ return [] },
  getElementById(id){ const e = mkEl('div'); e.attrs.id = id; return e },
  addEventListener(){}, removeEventListener(){},
};
function fetchStub(){ return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, tasks: [], etas: {} }), text: () => Promise.resolve('') }) }
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k,v)=>{ s[k]=String(v) }, removeItem: k=>{ delete s[k] } } };
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
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL-UI', e && e.stack || e); process.exit(2) }

/* ================= B. proxy：bootLedgerText（函数体提取 + 依赖 stub） ================= */
function extractFn(src, name){
  const idx = src.indexOf('function ' + name + '(');
  if (idx < 0) throw new Error('fn not found: ' + name);
  let depth = 0, started = false;
  for (let i = idx; i < src.length; i++){
    const ch = src[i];
    if (ch === '{'){ depth++; started = true }
    else if (ch === '}'){ depth--; if (started && depth === 0) return src.slice(idx, i + 1) }
  }
  throw new Error('unbalanced braces: ' + name);
}
const pxSrc = fs.readFileSync(PX, 'utf8');
let bootFnSrc;
try { bootFnSrc = extractFn(pxSrc, 'bootLedgerText') } catch(e){ console.error('LOAD-FAIL-PX', e.message); process.exit(2) }
/* 派生/覆盖层 stub：测试自行喂行，applyOverrides 透传（行上 state 已是 applyOverrides 后语义） */
const pxBag = { rows: [] };
const pxSandbox = {
  deriveTasksCached: function(){ return { ok: true, tasks: pxBag.rows } },
  applyOverrides: function(tasks){ return tasks },
};
pxSandbox.window = pxSandbox;
vm.createContext(pxSandbox);
try { vm.runInContext(bootFnSrc + '\n;__out = bootLedgerText;', pxSandbox, { filename: 'proxy-bootLedger.js' }) } catch(e){ console.error('LOAD-FAIL-PX2', e && e.stack || e); process.exit(2) }
const bootLedgerText = pxSandbox.__out;

/* ================= 断言 ================= */
let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('PASS ' + name) }
  else { fail++; console.log('FAIL ' + name + (extra === undefined ? '' : ' → ' + JSON.stringify(extra))) }
}

setImmediate(() => {
  const T = sandbox.__T;
  if (!T || typeof T.childStatusInfo !== 'function'){ console.error('FAIL 注入钩子缺失（__T.childStatusInfo）'); process.exit(1) }
  const csi = T.childStatusInfo, S = T.S, TASKS = T.TASKS;
  const MIN = 60000, now = Date.now();

  /* ---------- ⑴ 台账 interrupted（匹配 runnerSession）→ 已中断，不再疑似 ---------- */
  TASKS.list = [{ id: 'root1', runnerSession: 'childX', state: 'interrupted', stale: 'stalled' }];
  delete S.busyBy['childX'];
  let r1 = csi({ id: 'childX', time: { updated: now - 40 * MIN } });
  ok('⑴-interrupted→已中断', r1 && r1.txt.indexOf('已中断') === 0, r1);
  ok('⑴-不再疑似', r1 && r1.txt.indexOf('疑似中断') < 0, r1);

  /* ---------- ⑴b interrupted 走 id 匹配分支（P2-3：补组合覆盖） ---------- */
  TASKS.list = [{ id: 'childQ', runnerSession: 'otherRunner', state: 'interrupted', stale: 'stalled' }];
  let r1b = csi({ id: 'childQ', time: { updated: now - 50 * MIN } });
  ok('⑴b-id匹配→已中断', r1b && r1b.txt.indexOf('已中断') === 0, r1b);

  /* ---------- ⑵ 台账 done（匹配行 id）→ 已完成 ---------- */
  TASKS.list = [{ id: 'root2', runnerSession: 'childY', state: 'done', stale: 'stalled' }];
  let r2 = csi({ id: 'root2', time: { updated: now - 60 * MIN } });
  ok('⑵-done→已完成', r2 && r2.txt.indexOf('已完成') === 0, r2);
  /* ⑵b task198：已完成不再带时间戳（主人只看状态）+ cls=done 供 pill 分色 */
  ok('⑵b-已完成无时间戳', r2 && r2.txt === '已完成', r2 && r2.txt);
  ok('⑵b-已完成cls=done', r2 && r2.cls === 'done', r2 && r2.cls);

  /* ---------- ⑶ 无台账匹配 + 静默 60min（>45min 阈值）→ 兜底疑似中断（回归，task180 阈值 15→45） ---------- */
  TASKS.list = [];
  let r3 = csi({ id: 'childZ', time: { updated: now - 60 * MIN } });
  ok('⑶-无匹配仍疑似中断', r3 && r3.txt.indexOf('疑似中断') === 0, r3);
  /* ---------- ⑶b task180 新增：静默 40min（15~45min 区间）→「静默 40m」，不再假告警 ---------- */
  let r3b = csi({ id: 'childZ', time: { updated: now - 40 * MIN } });
  ok('⑶b-40min只显示静默', r3b && r3b.txt.indexOf('静默') === 0 && r3b.txt.indexOf('疑似中断') < 0, r3b);

  /* ---------- ⑷ busy 优先于台账终态 ---------- */
  TASKS.list = [{ id: 'root1', runnerSession: 'childX', state: 'interrupted', stale: 'stalled' }];
  S.busyBy['childX'] = now;
  let r4 = csi({ id: 'childX', time: { updated: now - 40 * MIN } });
  ok('⑷-busy最优先', r4 && r4.txt === '执行中', r4);
  delete S.busyBy['childX'];

  /* ---------- ⑸ 台账行 state=running（非终态）→ 不误吃，走原兜底 ---------- */
  TASKS.list = [{ id: 'root1', runnerSession: 'childX', state: 'running', stale: 'stalled' }];
  let r5 = csi({ id: 'childX', time: { updated: now - 60 * MIN } });
  ok('⑸-running行不误吃', r5 && r5.txt.indexOf('疑似中断') === 0, r5);

  /* ---------- ⑹ upd=0 + interrupted → 已中断且不炸（fmtTime 不被触发的分支） ---------- */
  TASKS.list = [{ id: 'root1', runnerSession: 'childX', state: 'interrupted', stale: 'stalled' }];
  let r6 = null, threw6 = false;
  try { r6 = csi({ id: 'childX', time: {} }) } catch(e){ threw6 = true }
  ok('⑹-无updated不炸', !threw6 && r6 && r6.txt === '已中断', threw6 ? String(threw6) : r6);

  /* ---------- ⑺ 静默 5min 无终态 → 静默 5m（原逻辑回归） ---------- */
  TASKS.list = [];
  let r7 = csi({ id: 'childW', time: { updated: now - 5 * MIN } });
  ok('⑺-短静默原样', r7 && r7.txt === '静默 5m', r7);

  /* ---------- ⒀ task181：历史 runner（无自身行）+ 父根行 done + 子更新早于父收口 → 级联已完成 ---------- */
  TASKS.list = [{ id: 'pRootA', runnerSession: 'latestA', state: 'done', overrideAt: now - 30 * MIN }];
  S.childParent['histA'] = 'pRootA';
  let r13 = csi({ id: 'histA', time: { updated: now - 74 * MIN } });
  ok('⒀-父done级联已完成', r13 && r13.txt.indexOf('已完成') === 0 && r13.txt.indexOf('疑似中断') < 0, r13);

  /* ---------- ⒁ 父根行 interrupted → 不级联（方案审 P1-1），仍疑似中断 ---------- */
  TASKS.list = [{ id: 'pRootB', runnerSession: 'latestB', state: 'interrupted', overrideAt: now - 30 * MIN }];
  S.childParent['histB'] = 'pRootB';
  let r14 = csi({ id: 'histB', time: { updated: now - 74 * MIN } });
  ok('⒁-父interrupted不级联', r14 && r14.txt.indexOf('疑似中断') === 0, r14);

  /* ---------- ⒂ 父 done 但子更新晚于父收口（会话被复用继续工作）→ 时序护栏不级联（方案审 P1-2） ---------- */
  TASKS.list = [{ id: 'pRootC', runnerSession: 'latestC', state: 'done', overrideAt: now - 90 * MIN }];
  S.childParent['histC'] = 'pRootC';
  let r15 = csi({ id: 'histC', time: { updated: now - 74 * MIN } });
  ok('⒂-复用后不级联', r15 && r15.txt.indexOf('疑似中断') === 0, r15);

  /* ---------- ⒃ 自身有任务行（running）优先，不被父 done 级联覆盖 ---------- */
  TASKS.list = [
    { id: 'ownR', runnerSession: 'otherR', state: 'running' },
    { id: 'pRootD', runnerSession: 'latestD', state: 'done', overrideAt: now - 30 * MIN },
  ];
  S.childParent['ownR'] = 'pRootD';
  let r16 = csi({ id: 'ownR', time: { updated: now - 74 * MIN } });
  ok('⒃-自身行优先不级联', r16 && r16.txt.indexOf('疑似中断') === 0, r16);

  /* ---------- ⑻ bootLedgerText：interrupted+note → 已中断…可 reopen，无「待人工标记」 ---------- */
  pxBag.rows = [{
    id: 'rootA', title: '任务甲', state: 'interrupted', stale: 'stalled', staleMinutes: 39, step: 5,
    runnerSession: 'runA', inTask: true, overrideNote: 'auto-reap（静默 39m）',
  }];
  let t8 = bootLedgerText('/dev/null');
  ok('⑻-已中断文案', t8.indexOf('已中断') >= 0, t8);
  ok('⑻-带标记来源', t8.indexOf('auto-reap（静默 39m）') >= 0, t8);
  ok('⑻-提示可reopen', t8.indexOf('可 reopen 续做') >= 0, t8);
  ok('⑻-不再待人工标记', t8.indexOf('待人工标记') < 0, t8);
  ok('⑻-note含静默时不再重复', (t8.match(/静默/g) || []).length === 1, t8);

  /* ---------- ⑼ bootLedgerText：未标记 stalled → 原文案（回归） ---------- */
  pxBag.rows = [{
    id: 'rootB', title: '任务乙', state: 'running', stale: 'stalled', staleMinutes: 20, step: 2,
    runnerSession: 'runB', inTask: true,
  }];
  let t9 = bootLedgerText('/dev/null');
  ok('⑼-未标记仍疑似', t9.indexOf('疑似中断（静默 20 分钟，待人工标记完成/中断）') >= 0, t9);

  /* ---------- ⑽ bootLedgerText：running+quiet/fresh → flag 行原样（回归；quiet=静默、fresh=活跃） ---------- */
  pxBag.rows = [
    { id: 'rootC', title: '任务丙', state: 'running', stale: 'quiet', staleMinutes: 3, step: 1, runnerSession: 'runC', inTask: true },
    { id: 'rootC2', title: '任务丙二', state: 'running', stale: 'fresh', staleMinutes: null, step: 1, runnerSession: 'runC2', inTask: true },
  ];
  let t10 = bootLedgerText('/dev/null');
  ok('⑽-quiet静默原样', t10.indexOf('running · 静默 3 分钟') >= 0, t10);
  ok('⑽-fresh活跃原样', t10.indexOf('running · 活跃') >= 0, t10);

  /* ---------- ⑾ bootLedgerText：done 行仍被过滤（回归 pick 语义） ---------- */
  pxBag.rows = [
    { id: 'rootD', title: '任务丁', state: 'done', stale: 'quiet', staleMinutes: 1, step: 9, runnerSession: 'runD', inTask: true },
    { id: 'rootE', title: '任务戊', state: 'interrupted', stale: 'stalled', staleMinutes: 45, step: 3, runnerSession: 'runE', inTask: true },
  ];
  let t11 = bootLedgerText('/dev/null');
  ok('⑾-done被过滤', t11.indexOf('rootD') < 0, t11);
  ok('⑾-interrupted保留', t11.indexOf('rootE') >= 0, t11);

  /* ---------- ⑿ bootLedgerText：interrupted 无 note → 文案格式正确 ---------- */
  pxBag.rows = [{
    id: 'rootF', title: '任务己', state: 'interrupted', stale: 'stalled', staleMinutes: 51, step: 1,
    runnerSession: 'runF', inTask: true, overrideNote: '',
  }];
  let t12 = bootLedgerText('/dev/null');
  ok('⑿-无note格式', t12.indexOf('已中断（静默 51 分钟，可 reopen 续做）') >= 0, t12);

  console.log('\n== task159 selftest-stalled-display: ' + pass + ' PASS / ' + fail + ' FAIL ==');
  process.exit(fail ? 1 : 0);
});

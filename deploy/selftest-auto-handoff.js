/* task186 红档交接自动开工 · 亲测工具（node VM + 最小 DOM stub，无需浏览器）
   断言清单（对应任务牌检查点 / 方案审 P1-1、P1-2）：
   A 落盘成功 → 自动发送开工指令（含 KICK 前缀，不含摘要全文）
   B 落盘失败 → 开工指令消息体内嵌摘要全文（双保险）
   C 切走守卫 + 落盘成功 → 不发送 + toast「摘要自动带上」
   D 切走守卫 + 落盘失败 → 不发送 + toast「未落盘」
   E manual 带草稿 → 草稿留在输入框（自动指令不吃稿）
   F handoff 空（auto+设置关闭）→ 不发送
   G 落盘 pending 期间 → 二次调用被 _handoffBusy 拦下返回 false（P1-1 忙锁覆盖）
   H sendHandoffKick 清 S.quote 残留
   I 台账口径补强：S_ENDED 提前判死的在途行仍计入（stalled 除外 / 终态除外）
   J 自动交接成功 → 注销源会话（abort + /_queue/pause + 退役登记）
   K manual 交接不退役（手动新开≠红档退役）
   L 复燃复核：交接后源会话又生成 → 再次 abort；无新活动不重复
   M 在已退役会话手动发消息 → 自动解冻（resume + 清登记）
   用法：node deploy/selftest-auto-handoff.js  （exit 0=PASS / 1=FAIL / 2=装载失败） */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.env.UI_PATH || '/storage/Users/currentUser/project/littleDJ/ui/index.html', 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, get busy(){return _handoffBusy}, handoffNewSession: handoffNewSession, sendHandoffKick: sendHandoffKick, tasksInFlightNow: tasksInFlightNow, retireCheckOnce: retireCheckOnce, send: send, KICK: AUTO_HANDOFF_KICK };\n" + m.slice(_i);

/* ---------- DOM stub（同 selftest-sidebar-order 骨架） ---------- */
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
  for (const s of segs){
    if (s[0] === '#'){ if (el.attrs.id !== s.slice(1)) return false }
    else if (s[0] === '.'){ if (!el._cls.has(s.slice(1))) return false }
    else { if (el.tagName !== s.toUpperCase()) return false }
  }
  return true;
}
function walk(el, out){ el.children.forEach(c=>{ out.push(c); walk(c, out) }); return out }
function qsel(root, sel){
  const parts = sel.split(/\s+/).filter(Boolean);
  const all = walk(root, []);
  return all.filter(el => {
    let node = el, i = parts.length - 1;
    if (!matchesSel(node, parts[i])) return false;
    for (let j = i-1; j >= 0; j--){
      let found = false, p = node.parent;
      while (p){ if (matchesSel(p, parts[j])){ found = true; break } p = p.parent }
      if (!found) return false;
    }
    return true;
  });
}
const elCache = {};
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: false, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(sel){ return qsel(doc.body, sel)[0] || (elCache[sel] = elCache[sel] || (()=>{ const e = mkEl('div'); if (sel[0]==='#') e.attrs.id = sel.slice(1); return e })()) },
  querySelectorAll(sel){ if (sel.indexOf('[') >= 0) return []; return qsel(doc.body, sel) },
  getElementById(id){ return elCache['#'+id] = elCache['#'+id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() },
  addEventListener(){}, removeEventListener(){},
};

/* ---------- fetch mock（可配置 /_handoff 成败与挂起） ---------- */
const DIR = '/storage/Users/currentUser/project/littleDJ';
const F = { handoffMode: 'ok', pendingResolve: null, prompts: [], handoffs: [], sessN: 0, msgs: [] };
const fetchLog = [];
const resp = (obj, ok) => ({ ok: ok !== false, status: ok === false ? 500 : 200, headers: { get: () => 'application/json' }, json: () => Promise.resolve(obj), text: () => Promise.resolve(JSON.stringify(obj || {})) });
function fetchStub(url, opt){
  const u = String(url), method = (opt && opt.method) || 'GET', body = opt && opt.body;
  fetchLog.push({ url: u, method: method, body: body });
  if (u.indexOf('/_handoff') >= 0){
    F.handoffs.push(body ? JSON.parse(body) : null);
    if (F.handoffMode === 'fail') return Promise.resolve(resp({}, false));
    if (F.handoffMode === 'pending') return new Promise(function(res){ F.pendingResolve = function(ok){ res(ok === false ? resp({}, false) : resp({ ok: true })) } });
    return Promise.resolve(resp({ ok: true }));
  }
  if (/\/_queue\/(pause|resume)/.test(u)) return Promise.resolve(resp({ ok: true }));
  if (/\/api\/session\/[^/?]+\/abort/.test(u)) return Promise.resolve(resp({ ok: true }));
  if (/\/api\/session\/[^/?]+\/message/.test(u)) return Promise.resolve(resp(F.msgs));
  if (u.indexOf('/api/session?') === 0 && method === 'POST'){
    F.sessN++;
    return Promise.resolve(resp({ id: 'new-sess-' + F.sessN, title: '新对话', directory: DIR, time: { created: Date.now(), updated: Date.now() } }));
  }
  if ((u === '/api/session' || u.indexOf('/api/session?') === 0) && method === 'GET') return Promise.resolve(resp([]));
  if (/\/api\/session\/[^/?]+\/prompt_async/.test(u)){ F.prompts.push(JSON.parse(body)); return Promise.resolve(resp({})) }
  if (/\/api\/agent/.test(u)) return Promise.resolve(resp([{ name: 'butler', mode: 'primary' }]));
  if (/\/_board/.test(u)) return Promise.resolve(resp({ ok: true, text: '', updatedAt: 0 }));
  if (/\/_sessions/.test(u)) return Promise.resolve(resp([]));
  return Promise.resolve(resp({ ok: true }));
}
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k,v)=>{ m[k]=String(v) }, removeItem: k=>{ delete m[k] } } };
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN,
  setTimeout: ()=>0, clearTimeout(){}, setInterval: ()=>0, clearInterval(){},
  fetch: fetchStub, document: doc,
  navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() }, vibrate: () => true },
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '', hash: '', reload(){} },
  localStorage: storage(), sessionStorage: storage(),
  alert(){}, confirm: () => true, prompt: () => null,
  Audio: class { constructor(){} play(){ return Promise.resolve() } pause(){} load(){} },
  EventSource: ES, WebSocket: ES, MutationObserver: class { observe(){} disconnect(){} }, ResizeObserver: class { observe(){} disconnect(){} },
  IntersectionObserver: class { observe(){} disconnect(){} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: f => 0, cancelAnimationFrame(){}, matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  history: { pushState(){}, replaceState(){} }, performance: { now: () => Date.now() },
  innerWidth: 1400, innerHeight: 900, addEventListener(){}, removeEventListener(){}, atob: s => s, btoa: s => s,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }

const tick = (n) => new Promise(async r => { for (let i = 0; i < (n || 3); i++) await new Promise(x => setImmediate(x)); r() });
let PASS = 0, FAIL = 0;
function ck(name, cond, extra){ if (cond){ PASS++; console.log('  PASS ' + name) } else { FAIL++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')) } }
const toastTxt = () => (doc.getElementById('toast') || {}).textContent || '';

(async () => {
  await tick(5);
  const T = sandbox.__T, S = T.S;
  const src = { id: 'src-b1', title: '大管家源', pwa: 1, directory: DIR, parentID: '', time: { created: 1000, updated: 1000 } };
  const other = { id: 'other-tui', title: 'TUI', pwa: 0, directory: DIR, parentID: '', time: { created: 900, updated: 900 } };
  function reset(mode){
    S.sessions = [src, other]; S.current = src; S.ctxPct = 25; S.atts = []; S.files = []; S.lastMsgs = [];
    S.busyBy = {}; S.pending = {}; S.quote = null; S._autoHandoffDoneFor = '';
    S._autoHandoffPending = ''; S._autoHandoffPendingAt = 0;
    S._retiredSids = {};
    sandbox.TASKS.list = [];
    Object.keys(sandbox.S_ENDED).forEach(function(k){ delete sandbox.S_ENDED[k] });
    F.msgs = [];
    doc.getElementById('input').value = '';
    doc.getElementById('toast').textContent = '';
    F.handoffMode = mode || 'ok'; F.pendingResolve = null;
    FETCH_MARK = fetchLog.length; PROMPT_MARK = F.prompts.length; HANDOFF_MARK = F.handoffs.length;
  }
  let FETCH_MARK = 0, PROMPT_MARK = 0, HANDOFF_MARK = 0;
  const newPrompts = () => F.prompts.slice(PROMPT_MARK);
  const textOf = (p) => ((p && p.parts && p.parts[0] && p.parts[0].text) || '');

  /* 场景 A：落盘成功 → 短指令（不带摘要全文） */
  console.log('[A] 落盘成功 → 自动开工指令');
  reset('ok');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(12);
  const pa = newPrompts();
  ck('A1 发出且仅一条开工指令', pa.length === 1, 'n=' + pa.length);
  ck('A2 指令含 KICK 前缀', textOf(pa[0]).indexOf('【自动交接·程序发送') === 0);
  ck('A3 指令不含摘要全文（走注入）', textOf(pa[0]).indexOf('【上一会话交接摘要') < 0);
  ck('A4 /_handoff 落盘被调用', F.handoffs.length - HANDOFF_MARK === 1);
  ck('A5 忙锁已释放', T.busy === false);
  ck('A6 toast 提示正在开工', toastTxt().indexOf('正在开工') >= 0, toastTxt());

  /* 场景 B：落盘失败 → 摘要内嵌消息体 */
  console.log('[B] 落盘失败 → 摘要内嵌开工指令');
  reset('fail');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(12);
  const pb = newPrompts();
  ck('B1 发出开工指令', pb.length === 1, 'n=' + pb.length);
  ck('B2 指令内嵌摘要全文', textOf(pb[0]).indexOf('【上一会话交接摘要') >= 0);
  ck('B3 忙锁已释放', T.busy === false);

  /* 场景 C：切走 + 落盘成功 → 不发送，toast「摘要自动带上」 */
  console.log('[C] 切走守卫 + 落盘成功');
  reset('pending');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(8);
  S.current = other; /* 模拟落盘窗口内主人切走 */
  if (F.pendingResolve) F.pendingResolve();
  await tick(8);
  ck('C1 未向别的会话发指令', newPrompts().length === 0);
  ck('C2 toast 提示发一条消息激活', toastTxt().indexOf('摘要自动带上') >= 0, toastTxt());
  ck('C3 忙锁已释放', T.busy === false);

  /* 场景 D：切走 + 落盘失败 → toast「未落盘」 */
  console.log('[D] 切走守卫 + 落盘失败');
  reset('pending');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(8);
  S.current = other;
  if (F.pendingResolve) F.pendingResolve(false);
  await tick(8);
  ck('D1 未发送', newPrompts().length === 0);
  ck('D2 toast 提示摘要未落盘', toastTxt().indexOf('未落盘') >= 0, toastTxt());

  /* 场景 E：manual 带草稿 → 草稿留在输入框 */
  console.log('[E] manual 草稿不被吃');
  reset('ok');
  doc.getElementById('input').value = '我的草稿ABC';
  T.handoffNewSession({ source: 'manual', confirmDraft: true, carryDraft: true, cooldown: false });
  await tick(12);
  ck('E1 输入框草稿原样保留', doc.getElementById('input').value === '我的草稿ABC', doc.getElementById('input').value);
  ck('E2 开工指令已发出', newPrompts().length === 1);
  ck('E3 toast 提示正在开工', toastTxt().indexOf('正在开工') >= 0, toastTxt());

  /* 场景 F：handoff 空（auto + 设置关闭）→ 不发送 */
  console.log('[F] 交接摘要关闭 → 不发送');
  reset('ok');
  sandbox.localStorage.setItem('littledj.handoff', '0');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(12);
  ck('F1 未发送开工指令', newPrompts().length === 0);
  ck('F2 未调用 /_handoff', F.handoffs.length - HANDOFF_MARK === 0);
  ck('F3 忙锁已释放', T.busy === false);
  sandbox.localStorage.removeItem('littledj.handoff');

  /* 场景 G：落盘 pending 期间二次调用被忙锁拦下（P1-1） */
  console.log('[G] 落盘窗口忙锁覆盖（P1-1）');
  reset('pending');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(8);
  const second = T.handoffNewSession({ source: 'manual', confirmDraft: false, carryDraft: false, cooldown: false });
  ck('G1 落盘 pending 期间二次调用返回 false', second === false);
  ck('G2 忙锁仍占用', T.busy === true);
  if (F.pendingResolve) F.pendingResolve();
  await tick(10);
  ck('G3 首次流程完成后忙锁释放', T.busy === false);
  ck('G4 仅一次开工指令', newPrompts().length === 1, 'n=' + newPrompts().length);

  /* 场景 H：sendHandoffKick 清 S.quote 残留 */
  console.log('[H] S.quote 残留清理');
  const S2 = T.S;
  S2.current = { id: 'hh', directory: DIR }; S2.quote = { text: '被引用的划词' };
  const r = T.sendHandoffKick({ id: 'hh' }, '摘要X', true);
  ck('H1 返回 sent', r && r.sent === true);
  ck('H2 S.quote 已清', S2.quote === null);

  /* 场景 I：台账口径补强——子代理跑完一轮（S_ENDED=1 → stage ended）仍须算在途（task376 根因） */
  console.log('[I] 台账口径补强：S_ENDED 提前判死不吞在途');
  reset('ok');
  sandbox.TASKS.list = [{ id: 'root-i', title: '在途任务', state: 'running', stale: 'quiet', runnerSession: 'runner-i', inTask: true }];
  sandbox.S_ENDED['runner-i'] = 1;
  const infI = T.tasksInFlightNow();
  ck('I1 台账 running + S_ENDED 仍计入在途', infI.indexOf('runner-i') >= 0, JSON.stringify(infI));
  sandbox.TASKS.list = [{ id: 'root-i2', title: '僵尸', state: 'running', stale: 'stalled', runnerSession: 'runner-i2', inTask: true }];
  Object.keys(sandbox.S_ENDED).forEach(function(k){ delete sandbox.S_ENDED[k] });
  ck('I2 stalled（静默≥15min）不卡交接', T.tasksInFlightNow().indexOf('runner-i2') < 0);
  sandbox.TASKS.list = [{ id: 'root-i3', title: '已完', state: 'done', stale: 'active', runnerSession: 'runner-i3', inTask: true }];
  ck('I3 终态行不计入', T.tasksInFlightNow().indexOf('runner-i3') < 0);

  /* 场景 J：自动交接成功 → 注销源会话（abort + pause + 登记） */
  console.log('[J] 自动交接成功 → 注销源会话');
  reset('ok');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(12);
  const logsJ = fetchLog.slice(FETCH_MARK);
  const abortsJ = logsJ.filter(x => /\/api\/session\/src-b1\/abort/.test(x.url));
  const pausesJ = logsJ.filter(x => x.url === '/_queue/pause');
  ck('J1 已 abort 源会话', abortsJ.length === 1, 'n=' + abortsJ.length);
  ck('J2 已冻结源会话队列', pausesJ.length === 1 && JSON.parse(pausesJ[0].body).session === 'src-b1');
  ck('J3 退役登记已写入', !!T.S._retiredSids['src-b1']);

  /* 场景 K：manual 交接不注销源会话（手动新开是主人主动搬，不是红档退役） */
  console.log('[K] manual 交接不退役');
  reset('ok');
  T.handoffNewSession({ source: 'manual', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(12);
  ck('K1 无退役登记', !T.S._retiredSids['src-b1']);
  ck('K2 无 abort 调用', fetchLog.slice(FETCH_MARK).filter(x => /\/abort/.test(x.url)).length === 0);

  /* 场景 L：复燃复核——源会话交接后又生成 → 再次拉闸；无新活动不重复 */
  console.log('[L] 复燃复核');
  reset('ok');
  T.handoffNewSession({ source: 'auto', confirmDraft: false, carryDraft: false, cooldown: false });
  await tick(12);
  T.S._retiredSids['src-b1'] = Date.now() - 5000;
  F.msgs = [{ info: { role: 'assistant', time: { created: Date.now(), completed: Date.now() } }, parts: [] }];
  const abortBefore = fetchLog.filter(x => /src-b1\/abort/.test(x.url)).length;
  T.retireCheckOnce('src-b1');
  await tick(6);
  ck('L1 复燃 → 再次 abort', fetchLog.filter(x => /src-b1\/abort/.test(x.url)).length === abortBefore + 1);
  const markL = fetchLog.length;
  F.msgs = [{ info: { role: 'assistant', time: { created: 1, completed: 1 } }, parts: [] }];
  T.retireCheckOnce('src-b1');
  await tick(6);
  ck('L2 无新活动不重复 abort', fetchLog.slice(markL).filter(x => /abort/.test(x.url)).length === 0);

  /* 场景 M：在已退役会话手动发消息 → 自动解冻（防消息入队卡死） */
  console.log('[M] 退役会话手动发消息自动解冻');
  reset('ok');
  T.S.current = src; T.S._retiredSids['src-b1'] = Date.now();
  doc.getElementById('input').value = '继续干活';
  const markM = fetchLog.length;
  T.send();
  await tick(6);
  ck('M1 退役登记已解除', !T.S._retiredSids['src-b1']);
  ck('M2 已调用 /_queue/resume', fetchLog.slice(markM).some(x => x.url === '/_queue/resume'));

  console.log('\n[结果] PASS=' + PASS + ' FAIL=' + FAIL + ' → ' + (FAIL ? 'FAIL' : 'PASS'));
  process.exit(FAIL ? 1 : 0);
})();

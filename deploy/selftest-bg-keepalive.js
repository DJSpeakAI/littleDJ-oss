/* task193 息屏/后台完成音保活自测（无需浏览器）：node VM 跑 ui/index.html 内联脚本 + 最小 DOM stub。
   断言：
     ① kaEnabled 默认开、littledj.bgKeepAlive='0' 关、坏值（非 '0'）容错回落开
     ② kaStart 建循环近无声音轨（loop + volume>0 + MediaSession 元数据）+ 预渲染 WAV 通道就绪
     ③ kaStop 暂停且清 MediaSession
     ④ hidden+保活中 playDing 走 WAV <audio>（元素可出声、音量随 dingVol）；**播放 promise 被拒 → 入 _pendDing 待补播（产出审 P1-1）**；保活关+hidden 无通知 API → 原页面音路径（ctx 挂起 → _pendDing）
     ⑤ bgSnapTake/bgMissCheck：快照内任务转 done/interrupted → 按「其他角色/子代理」音色补一声（默认「无」静音）、10s 节流、seenTaskIds 不双响、30min 外作废
   盲区（未覆盖，红绿靠真机）：10s 轮询门控行 inline 表达式、visibilitychange 分支的 timer 撤销、sse.onerror 挂点——这三处是纯 DOM 事件绑定，stub 无法驱动，改动时须人工核对 + 真机验证。
   用法：node deploy/selftest-bg-keepalive.js （exit 0=PASS / 1=FAIL / 2=脚本装载失败） */
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(process.env.UI_PATH || '/storage/Users/currentUser/project/littleDJ/ui/index.html', 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, get TASKS(){return TASKS}, get KA(){return KA}, get _bgMiss(){return _bgMiss}, get _pendDing(){return _pendDing}, get seenTaskIds(){return seenTaskIds}, kaEnabled: kaEnabled, kaActive: kaActive, kaStart: kaStart, kaStop: kaStop, kaRenderWavs: kaRenderWavs, playDing: playDing, bgSnapTake: bgSnapTake, bgMissCheck: bgMissCheck, getDingVol: getDingVol, setAgentSoundAt: function(v){ _agentSoundAt = v }, get KA_WAV(){ return KA.wav }, clearPendDing: function(){ _pendDing = null } };\n" + m.slice(_i);

/* ---------- DOM stub（与 selftest-multisel-keepopen.js 同构） ---------- */
function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag||'').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {},
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 0, innerWidth: 0,    paused: true, loop: false, volume: 1, preload: '', src: '',
    play(){ /* task262 ⑦b：被拒时保持 paused=true（对齐真机 NotAllowedError 语义——否则自愈退避循环第二轮守卫 sees paused=false 提前收口） */
      if (sandbox && sandbox.__REJECT_PLAY) return Promise.reject(new Error('blocked'));
      this.paused = false; if (this.tagName === 'AUDIO') AUDIO_PLAYS.push({ el: this, at: Date.now() }); return Promise.resolve() },
    pause(){ this.paused = true },
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
    removeChild(c){ const i = e.children.indexOf(c); if (i>=0) e.children.splice(i,1) },
    remove(){ if (e.parent) e.parent.removeChild(e) },
    contains(x){ let p = x; while (p){ if (p === e) return true; p = p.parent } return false },
    addEventListener(t,f){ (e.listeners[t] = e.listeners[t]||[]).push(f) },
    removeEventListener(){}, dispatchEvent(){ return true },
    setAttribute(k,v){ e.attrs[k]=v }, getAttribute(k){ return e.attrs[k] },
    getBoundingClientRect(){ return { top:0, left:0, right:0, bottom:0, width:0, height:0, x:0, y:0 } },
    setPointerCapture(){}, releasePointerCapture(){}, focus(){}, select(){}, blur(){}, click(){}, scrollIntoView(){}, setSelectionRange(){}, reset(){}, submit(){}, toggleAttribute(){},
    querySelector(){ return null }, querySelectorAll(){ return [] }, closest(){ return null }, firstChild(){ return e.children[0]||null },
  };
  return e;
}
const elCache = {};
const navBody = mkEl('div'); navBody.attrs.id = 'navBody';
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: true, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(sel){ if (sel === '#navBody') return navBody; return elCache[sel] = elCache[sel] || (()=>{ const e = mkEl('div'); if (sel[0]==='#') e.attrs.id = sel.slice(1); return e })() },
  querySelectorAll(){ return [] },
  getElementById(id){ if (id === 'navBody') return navBody; return elCache['#'+id] = elCache['#'+id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() },
  addEventListener(){}, removeEventListener(){},
};
function fetchStub(url){
  const resp = (obj) => ({ ok: true, status: 200, json: () => Promise.resolve(obj), text: () => Promise.resolve('') });
  return Promise.resolve(resp({ ok: true, tasks: [], etas: {} }));
}
class ES { constructor(){ } addEventListener(){} close(){} }
const storage = () => { const s = {}; return { getItem: k => (k in s ? s[k] : null), setItem: (k,v)=>{ s[k]=String(v) }, removeItem: k=>{ delete s[k] } } };

/* 音频桩：Audio 实例记录 play 次数与音量；AudioContext 恒 suspended（模拟手机后台策略） */
let AUDIO_PLAYS = [];
const AudioStub = class {
  constructor(){ this.paused = true; this.volume = 1; this.loop = false; this.src = ''; AUDIO_PLAYS.push({ el: this, at: Date.now() }) }
  play(){ this.paused = false; return Promise.resolve() }
  pause(){ this.paused = true }
};
let blobN = 0;
/* task262 沙箱升级：mediaSession 记录对象 / MediaMetadata 捕获 artwork / Notification 构造记录 / setTimeout 记录桩（方案审 P2-3） */
const NOTIFS = [];
class NotifStub { constructor(t, o){ NOTIFS.push({ t, o: o || {} }) } close(){} }
NotifStub.permission = 'granted';
NotifStub.requestPermission = () => Promise.resolve('granted');
const MS = { metadata: null, playbackState: '', handlers: {}, setActionHandler(name, f){ this.handlers[name] = f } };
const TIMERS = [];
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map, parseInt, parseFloat, isNaN,
  setTimeout: (f, ms) => { TIMERS.push({ f, ms }); return TIMERS.length }, clearTimeout(){},
  setInterval: ()=>0, clearInterval(){},
  fetch: fetchStub, document: doc, navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() }, mediaSession: MS },
  Notification: NotifStub,
  location: { href: 'http://127.0.0.1/', origin: 'http://127.0.0.1', protocol: 'http:', hostname: '127.0.0.1', pathname: '/', search: '', hash: '', reload(){} },
  localStorage: storage(), sessionStorage: storage(),
  alert(){}, confirm: () => true, prompt: () => null,
  EventSource: ES, WebSocket: ES, MutationObserver: class { observe(){} disconnect(){} }, ResizeObserver: class { observe(){} disconnect(){} },
  IntersectionObserver: class { observe(){} disconnect(){} }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: f => 0, cancelAnimationFrame(){}, matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  history: { pushState(){}, replaceState(){} }, performance: { now: () => Date.now() },
  innerWidth: 1400, innerHeight: 900, addEventListener(){}, removeEventListener(){}, atob: s => s, btoa: s => s,
  Audio: AudioStub, MediaMetadata: class { constructor(o){ this.title = o && o.title; this.artist = o && o.artist; this.album = o && o.album; this.artwork = (o && o.artwork) || [] } },
  URL: { createObjectURL: () => 'blob:fake-' + (++blobN) },
  Blob: class { constructor(parts, opt){ this.parts = parts; this.type = opt && opt.type } },
  DataView, ArrayBuffer, Uint8Array, Uint16Array, Int16Array, Float32Array,
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch(e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }

/* WAV 头断言用：直接在沙箱里重放 kaSilentSrc 的字节（借 KA.srcCache 为 blob 假 URL，改手工构一段真 WAV 验 RIFF 结构） */
const tick = () => new Promise(r => setImmediate(r));
(async () => {
  await tick(); await tick(); await tick();
  const T = sandbox.__T;
  let pass = 0, fail = 0;
  const ok = (name, cond, detail) => { if (cond){ pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail === undefined ? '' : '| ' + detail) } };

  /* ① 开关语义 */
  ok('① 默认开启', T.kaEnabled() === true);
  sandbox.localStorage.setItem('littledj.bgKeepAlive', '0');
  ok('① 显式关闭', T.kaEnabled() === false);
  sandbox.localStorage.setItem('littledj.bgKeepAlive', '1');
  ok('① 显式开启', T.kaEnabled() === true);
  sandbox.localStorage.removeItem('littledj.bgKeepAlive');
  ok('① 清键回落默认开', T.kaEnabled() === true);
  sandbox.localStorage.setItem('littledj.bgKeepAlive', 'abc');
  ok('① 坏值容错回落开', T.kaEnabled() === true);
  sandbox.localStorage.removeItem('littledj.bgKeepAlive');

  /* ② kaStart：建轨+循环+近无声+MediaSession；关态 kaStart 不建 */
  sandbox.localStorage.setItem('littledj.bgKeepAlive', '0');
  T.kaStart();
  ok('② 关态不建轨', T.KA.el === null);
  sandbox.localStorage.setItem('littledj.bgKeepAlive', '1');
  T.kaStart();
  ok('② 建轨+循环+近无声', !!T.KA.el && T.KA.el.loop === true && T.KA.el.volume > 0 && T.KA.el.volume <= 0.05, T.KA.el && ('vol=' + T.KA.el.volume));
  ok('② kaActive 生效', T.kaActive() === true);
  ok('② MediaSession 元数据', sandbox.navigator.mediaSession.metadata && sandbox.navigator.mediaSession.metadata.title === '小DJ 监听中');

  /* ③ kaStop */
  T.kaStop();
  ok('③ 停止后暂停+清元数据', T.KA.el.paused === true && !sandbox.navigator.mediaSession.metadata);
  T.kaStart(); /* 复启供后续用 */

  /* ④ hidden 下 playDing 通道选择 */
  AUDIO_PLAYS = [];
  sandbox.localStorage.setItem('littledj.dingVol', '80');
  T.KA.wav.ding = 'blob:ding-wav'; /* 模拟已预渲染 */
  doc.hidden = true; /* stub 初始即 hidden，双保险 */
  T.playDing('ding');
  ok('④ hidden+保活走 WAV 元素', AUDIO_PLAYS.length >= 1 && AUDIO_PLAYS[AUDIO_PLAYS.length - 1].el.src === 'blob:ding-wav' && !T._pendDing, 'plays=' + AUDIO_PLAYS.length);
  ok('④ WAV 元素音量随 dingVol', AUDIO_PLAYS.length >= 1 && AUDIO_PLAYS[AUDIO_PLAYS.length - 1].el.volume === 0.8, AUDIO_PLAYS.length && ('vol=' + AUDIO_PLAYS[AUDIO_PLAYS.length - 1].el.volume));
  T.kaStop();
  T.playDing('ding');
  ok('④ 保活停+无 Notification API → 原路径挂起入队', !!T._pendDing, '_pendDing=' + JSON.stringify(T._pendDing));
  /* 产出审 P1-1：WAV play() promise 被拒（真机常见：自动播放策略）→ 必须落 _pendDing，不许静默丢 */
  T.clearPendDing();
  T.kaStop(); T.kaStart();
  sandbox.__REJECT_PLAY = true;
  T.playDing('ding');
  await tick(); await tick();
  ok('④ WAV 播放被拒 → 入待播队列', !!T._pendDing && T._pendDing.soundId === 'ding', JSON.stringify(T._pendDing));
  sandbox.__REJECT_PLAY = false;
  T.clearPendDing();
  T.kaStart();

  /* ⑤ 快照补响 */
  T.TASKS.list = [ { id: 't1', state: 'running' }, { id: 't2', state: 'running' } ];
  T.bgSnapTake();
  ok('⑤ 快照收录在跑任务', !!(T._bgMiss && T._bgMiss.ids.t1 && T._bgMiss.ids.t2));
  T.seenTaskIds.add('t1'); /* 模拟 SSE 注入已响过 */
  /* 方案审 P1-1：补响镜像「其他角色/子代理」音色——默认「无」时不得硬播大管家 ding */
  sandbox.localStorage.removeItem('littledj.agentSound');
  AUDIO_PLAYS = [];
  T.TASKS.list = [ { id: 't1', state: 'done' }, { id: 't2', state: 'done' } ];
  T.bgMissCheck();
  ok('⑤ 子代理音=「无」（默认）补响静音', AUDIO_PLAYS.length === 0, 'plays=' + AUDIO_PLAYS.length);
  /* 配了音色则按该音色补响（bell 而非 ding） */
  sandbox.localStorage.setItem('littledj.agentSound', 'bell');
  T.KA.wav.bell = 'blob:bell-wav';
  T.seenTaskIds.clear();
  T.TASKS.list = [ { id: 't5', state: 'running' } ];
  T.bgSnapTake();
  AUDIO_PLAYS = [];
  T.TASKS.list = [ { id: 't5', state: 'done' } ];
  T.bgMissCheck();
  ok('⑤ 补响用子代理音色非 ding', AUDIO_PLAYS.length === 1 && AUDIO_PLAYS[0].el.src === 'blob:bell-wav', 'plays=' + AUDIO_PLAYS.length + ' src=' + (AUDIO_PLAYS[0] && AUDIO_PLAYS[0].el.src));
  /* 10s 节流窗：连续两批补响只响一次 */
  T.seenTaskIds.clear();
  T.TASKS.list = [ { id: 't6', state: 'running' }, { id: 't7', state: 'running' } ];
  T.bgSnapTake();
  AUDIO_PLAYS = [];
  T.TASKS.list = [ { id: 't6', state: 'done' }, { id: 't7', state: 'done' } ];
  T.bgMissCheck();
  ok('⑤ 10s 节流窗内不连响', AUDIO_PLAYS.length === 0, 'plays=' + AUDIO_PLAYS.length);
  /* interrupted 也补（把节流窗推回过去） */
  T.seenTaskIds.clear();
  T.setAgentSoundAt(0);
  T.TASKS.list = [ { id: 't3', state: 'running' } ];
  T.bgSnapTake();
  AUDIO_PLAYS = [];
  T.TASKS.list = [ { id: 't3', state: 'interrupted' } ];
  T.bgMissCheck();
  ok('⑤ interrupted 同样补响', AUDIO_PLAYS.length === 1);
  /* 30 分钟外不翻旧账 */
  sandbox.localStorage.setItem('littledj.agentSound', 'bell');
  T.seenTaskIds.clear();
  T.TASKS.list = [ { id: 't4', state: 'running' } ];
  T.bgSnapTake();
  T._bgMiss.at = Date.now() - 31 * 60 * 1000;
  AUDIO_PLAYS = [];
  T.TASKS.list = [ { id: 't4', state: 'done' } ];
  T.bgMissCheck();
  ok('⑤ 30min 外快照作废不响', AUDIO_PLAYS.length === 0 && !T._bgMiss);
  /* 快照不存在时零副作用 */
  AUDIO_PLAYS = [];
  T.bgMissCheck();
  ok('⑤ 无快照零副作用', AUDIO_PLAYS.length === 0);

  /* ⑥ task262：MediaSession 完整化——锁屏媒体卡片要件（artwork512+album+播放态+handlers） */
  T.kaStart();
  const md = MS.metadata;
  ok('⑥ 元数据含 artwork512', !!(md && md.artwork && md.artwork[0] && md.artwork[0].src === '/icon-512.png' && md.artwork[0].sizes === '512x512'), JSON.stringify(md && md.artwork));
  ok('⑥ 元数据含 album', !!(md && md.album === 'littleDJ'));
  ok('⑥ 播放态 playing（在播时）', MS.playbackState === 'playing', MS.playbackState);
  ok('⑥ handlers 注册 play/pause', !!(MS.handlers.play && MS.handlers.pause), Object.keys(MS.handlers).join(','));
  MS.handlers.pause();
  ok('⑥ 卡片暂停→userPaused+停播', T.KA.userPaused === true && T.KA.el.paused === true, 'up=' + T.KA.userPaused + ' paused=' + T.KA.el.paused);
  ok('⑥ 用户暂停态 playbackState 不谎报 playing', MS.playbackState !== 'playing' || T.KA.el.paused === false, MS.playbackState);
  MS.handlers.play();
  ok('⑥ 卡片播放→清 userPaused+复播', T.KA.userPaused === false && T.KA.el.paused === false, 'up=' + T.KA.userPaused + ' paused=' + T.KA.el.paused);
  T.kaStop();
  ok('⑥ kaStop→播放态 none+清元数据', MS.playbackState === 'none' && !MS.metadata, MS.playbackState);

  /* ⑦ task262：保活音轨暂停自愈（方案审 P1-3：触发时复核三守卫 + kaStop 撤定时器） */
  T.kaStart();
  T.KA.el.pause(); /* 模拟系统/省电策略按住音轨 */
  (T.KA.el.listeners.pause || []).forEach(f => f());
  ok('⑦ 系统暂停(hidden+开+非用户)→安排自愈', T.KA.healT !== null, 'healT=' + T.KA.healT);
  T.kaStop();
  ok('⑦ kaStop 撤自愈定时器', T.KA.healT === null);
  T.kaStart();
  T.KA.userPaused = true; T.KA.el.pause();
  (T.KA.el.listeners.pause || []).forEach(f => f());
  ok('⑦ 用户暂停→不自愈（尊重意愿）', T.KA.healT === null);
  T.KA.userPaused = false;
  doc.hidden = false; T.kaStart(); T.KA.el.pause();
  (T.KA.el.listeners.pause || []).forEach(f => f());
  ok('⑦ 前台暂停→不自愈（正常路径）', T.KA.healT === null);
  doc.hidden = true; T.kaStart();

  /* ⑦b task262 产出审 P1-2：定时器体行为断言——flush 桩定时器真跑（用户暂停不被拉回 / play 恒拒退避序列 1s→2s→4s / 5 次上限放弃）。
     咬合原理：若定时器体内三守卫被删，用户暂停场景 flush 后 KA.el 会被 play() 拉回（paused=false）→ 首条 FAIL。 */
  const runTimer = (i) => { const t = TIMERS[i]; if (t && typeof t.f === 'function') t.f() };
  /* 场景一：系统暂停已排自愈 → 退避窗口内用户按了暂停 → 定时器体复核不拉回 */
  T.kaStart();
  T.KA.el.pause(); (T.KA.el.listeners.pause || []).forEach(f => f());
  const h0 = TIMERS.length - 1; /* 刚安排的自愈定时器下标（记录型桩：push 后 length-1 即该 timer id-1） */
  T.KA.userPaused = true; /* 退避窗口内用户经媒体卡片按了暂停 */
  runTimer(h0); await tick(); await tick();
  ok('⑦b 定时器体复核：用户暂停不被拉回', T.KA.el.paused === true && T.KA.healT === null, 'paused=' + T.KA.el.paused + ' healT=' + T.KA.healT);
  /* 场景二：play 恒拒（自动播放策略）→ 退避序列 1000→2000→4000，第 5 次后放弃 */
  T.kaStart();
  sandbox.__REJECT_PLAY = true;
  T.KA.el.pause(); (T.KA.el.listeners.pause || []).forEach(f => f());
  const seq0 = Math.max(0, TIMERS.length - 1); /* 第一个自愈定时器=刚 push 的末位（产出审 P1-2：slice 起点须含首个 1000ms） */
  let cur = TIMERS.length - 1;
  for (let k = 0; k < 8; k++){ runTimer(cur); for (let w = 0; w < 4; w++) await tick(); cur = TIMERS.length - 1; if (T.KA.healT === null) break }
  const waits = TIMERS.slice(seq0).map(t => t.ms);
  ok('⑦b 退避序列 1s→2s→4s→…', waits.length >= 3 && waits[0] === 1000 && waits[1] === 2000 && waits[2] === 4000, JSON.stringify(waits));
  ok('⑦b 连续失败 5 次后放弃', T.KA.healT === null && waits.length <= 6, 'healT=' + T.KA.healT + ' waits=' + JSON.stringify(waits)); /* 5 次 play 尝试 + 第 6 个定时器体判定超限放弃（不再续排） */
  sandbox.__REJECT_PLAY = false;
  T.kaStop(); T.kaStart();

  /* ⑧ task262：WAV 播放被拒→降级系统通知（方案审 P1-4：构造式在安卓系可能静默，桌面兜底；正常出声不发防双响） */
  T.KA.wav.ding = 'blob:ding-wav';
  sandbox.__REJECT_PLAY = true;
  NOTIFS.length = 0; T.clearPendDing();
  T.playDing('ding');
  await tick(); await tick(); await tick();
  ok('⑧ 被拒→入待播+降级通知', !!T._pendDing && NOTIFS.length === 1 && /小 DJ/.test(NOTIFS[0].t), 'pend=' + JSON.stringify(T._pendDing) + ' notifs=' + NOTIFS.length);
  sandbox.__REJECT_PLAY = false;
  NOTIFS.length = 0; T.clearPendDing();
  T.playDing('ding');
  await tick();
  ok('⑧ 正常出声不发通知（防双响）', NOTIFS.length === 0 && !T._pendDing, 'notifs=' + NOTIFS.length);

  console.log(`\n== task193+task262 selftest-bg-keepalive: ${pass} PASS / ${fail} FAIL ==`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS-FAIL', e && e.stack || e); process.exit(2) });

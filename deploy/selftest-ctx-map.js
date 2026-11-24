/* task189 会话行上下文百分比自测（无需浏览器）：
   A. proxy 纯函数（ctxRowValue / ctxMapAbsorb / ctxMapPrune，vm 抽取真代码）
   B. UI 侧（vm sandbox 跑 ui/index.html 内联脚本：pill 渲染 / 无值不渲染 / 窗口匹配回落 / 指纹 / L-048 反向断言）
   C. E2E（可选，E2E=1 时打真实 proxy：/_ctxmap 200 结构 + 无鉴权 401；需新代码 proxy 已重启）
   用法：node deploy/selftest-ctx-map.js   （exit 0=PASS / 1=FAIL / 2=装载失败） */
const fs = require('fs'), vm = require('vm'), path = require('path'), os = require('os');
const ROOT = process.env.LITTLEDJ_ROOT || '/storage/Users/currentUser/project/littleDJ';
let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  PASS  ' + name) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')) }
}

/* ---------- A. proxy 纯函数 ---------- */
console.log('[A] proxy 纯函数');
const proxySrc = fs.readFileSync(ROOT + '/server/proxy.js', 'utf8');
const a0 = proxySrc.indexOf('const CTX_MAP_WINDOW_MS');
const a1 = proxySrc.indexOf('// 缓存语义（P1-1）');
if (a0 < 0 || a1 < 0){ console.error('LOAD-FAIL: 抽不到 ctx* 函数段'); process.exit(2) }
const fnSrc = proxySrc.slice(a0, a1);
const pctx = {};
try { vm.runInNewContext(fnSrc + '\n;globalThis.__C = { CTX_MAP_WINDOW_MS: CTX_MAP_WINDOW_MS };', pctx, { filename: 'ctx-fn.js' }) } catch (e){ console.error('LOAD-FAIL', e); process.exit(2) }
const { ctxRowValue, ctxMapAbsorb, ctxMapPrune } = pctx;
const CTX_MAP_WINDOW_MS = pctx.__C.CTX_MAP_WINDOW_MS;

ok('assistant+prompt>0 → u=input+cache.read+output', (() => {
  const v = ctxRowValue({ rl: 'assistant', ti: 100, tcr: 900, tout: 50, tc: 10, p: 'deepseek', m: 'deepseek-flash' });
  return v && v.u === 1050 && v.tc === 10 && v.p === 'deepseek' && v.m === 'deepseek-flash';
})());
ok('user 角色 → null', ctxRowValue({ rl: 'user', ti: 100, tcr: 0, tout: 0 }) === null);
ok('assistant 但 prompt=0 → null（input+cache.read=0）', ctxRowValue({ rl: 'assistant', ti: 0, tcr: 0, tout: 99 }) === null);

const m1 = {};
let mt = ctxMapAbsorb(m1, [
  { sid: 'S1', tc: 100, rl: 'assistant', ti: 10, tcr: 0, tout: 1 },
  { sid: 'S1', tc: 200, rl: 'assistant', ti: 20, tcr: 0, tout: 2 },
  { sid: 'S2', tc: 150, rl: 'assistant', ti: 30, tcr: 0, tout: 3 }
]);
ok('聚合取每会话 tc 最大行', m1.S1.u === 22 && m1.S2.u === 33, JSON.stringify(m1));
ok('maxTc 返回全窗最大 tc', mt === 200, String(mt));
const m2 = {};
ctxMapAbsorb(m2, [
  { sid: 'S3', tc: 100, rl: 'assistant', ti: 10, tcr: 0, tout: 1 },
  { sid: 'S3', tc: 200, rl: 'assistant', ti: 0, tcr: 0, tout: 0 } /* 更新但是无值（中断） */
]);
ok('更新行无值不覆盖旧有效值（与 updateUsage 同构）', m2.S3 && m2.S3.u === 11 && m2.S3.tc === 100, JSON.stringify(m2.S3));

const now = 1000000000000;
const m3 = { old: { u: 1, tc: now - CTX_MAP_WINDOW_MS - 2 * 3600000 }, edge: { u: 2, tc: now - CTX_MAP_WINDOW_MS - 1800000 }, fresh: { u: 3, tc: now - 1000 } };
ctxMapPrune(m3, now);
ok('窗口边界：滑出 4 天硬边界删、3 天内与 3.5 天（缓冲内）留', !m3.old && !!m3.edge && !!m3.fresh, JSON.stringify(Object.keys(m3)));

/* ---------- B. UI vm ---------- */
console.log('[B] UI 渲染（vm sandbox）');
/* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本）+ index.html 原文 */
const html = require('./selftest-load-ui').loadUiSource(ROOT + '/ui')
  + '\n' + fs.readFileSync(ROOT + '/ui/index.html', 'utf8');
let m = require('./selftest-load-ui').loadUiSource(require('path').join(__dirname, '..', 'ui'));
const _i = m.lastIndexOf('})();');
m = m.slice(0, _i) + "\n;window.__T = { get S(){return S}, renderSidebar: renderSidebar, buildConvRow: buildConvRow, appendChildRow: appendChildRow, navSidebarSig: navSidebarSig, convCtxPill: convCtxPill, ctxLevel: ctxLevel, convCtxInfo: convCtxInfo };\n" + m.slice(_i);

function mkEl(tag){
  const e = {
    __isFrag: tag === '#frag', tagName: String(tag || '').toUpperCase(), children: [], parent: null,
    _cls: new Set(), dataset: {}, attrs: {},
    style: { setProperty(){}, removeProperty(){}, getPropertyValue(){ return '' }, cssText: '' },
    listeners: {}, _text: '', hidden: false, value: '', checked: false, disabled: false, type: '', title: '',
    onclick: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0, clientWidth: 0, innerWidth: 0,
    get classList(){ const s = e._cls; return {
      add: (...a)=>a.forEach(x=>s.add(x)), remove: (...a)=>a.forEach(x=>s.delete(x)),
      toggle:(x,f)=>{ (f===undefined? !s.has(x):f)? s.add(x):s.delete(x) }, contains:(x)=>s.has(x) } },
    get className(){ return [...e._cls].join(' ') },
    set className(v){ e._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)) },
    get textContent(){ return e.children.length ? e.children.map(c=>c.textContent).join('') : e._text },
    set textContent(v){ e._text = String(v == null ? '' : v); e.children = [] },
    get innerHTML(){ return '' }, set innerHTML(v){ if (v === '') e.children = [] }, replaceChildren(...nodes){ e.children = []; (nodes||[]).forEach(function(n){ e.appendChild(n) }) },
    appendChild(c){ if (!c) return c; if (c.__isFrag){ c.children.slice().forEach(x=>e.appendChild(x)); return c }
      if (c.parent){ const i = c.parent.children.indexOf(c); if (i >= 0) c.parent.children.splice(i, 1) }
      c.parent = e; e.children.push(c); return c },
    insertBefore(c, ref){ if (!c) return c; const i = e.children.indexOf(ref); c.parent = e;
      if (i < 0) e.children.push(c); else e.children.splice(i, 0, c); return c },
    removeChild(c){ const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); return c },
    remove(){ if (e.parent) e.parent.removeChild(e) },
    contains(x){ let p = x; while (p){ if (p === e) return true; p = p.parent } return false },
    addEventListener(t, f){ (e.listeners[t] = e.listeners[t] || []).push(f) },
    removeEventListener(){}, dispatchEvent(){ return true },
    setAttribute(k, v){ e.attrs[k] = v }, getAttribute(k){ return e.attrs[k] },
    getBoundingClientRect(){ return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } },
    setPointerCapture(){}, releasePointerCapture(){}, focus(){}, select(){}, blur(){}, click(){}, scrollIntoView(){}, setSelectionRange(){}, reset(){}, submit(){}, toggleAttribute(){},
    querySelector(sel){ return qsel(e, sel)[0] || null }, querySelectorAll(sel){ return qsel(e, sel) },
    closest(){ return null }, firstChild(){ return e.children[0] || null },
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
    else if (el.tagName !== s.toUpperCase()) return false;
  }
  return true;
}
function qsel(root, sel){
  const parts = sel.split(/\s+/).filter(Boolean);
  const all = [];
  (function walk(el){ el.children.forEach(c=>{ all.push(c); walk(c) }) })(root);
  return all.filter(el => {
    let node = el, i = parts.length - 1;
    if (!matchesSel(node, parts[i])) return false;
    for (let j = i - 1; j >= 0; j--){
      let found = false, p = node.parent;
      while (p){ if (matchesSel(p, parts[j])){ found = true; break } p = p.parent }
      if (!found) return false;
    }
    return true;
  });
}
const navBody = mkEl('div'); navBody.attrs.id = 'navBody';
const elCache = {};
const doc = {
  body: mkEl('body'), documentElement: mkEl('html'), hidden: true, title: '',
  createElement: t => mkEl(t), createDocumentFragment: () => mkEl('#frag'),
  querySelector(sel){ if (sel === '#navBody') return navBody; return qsel(doc.body, sel)[0] || (elCache[sel] = elCache[sel] || (()=>{ const e = mkEl('div'); if (sel[0] === '#') e.attrs.id = sel.slice(1); return e })()) },
  querySelectorAll(sel){ return sel.indexOf('[') >= 0 ? [] : qsel(doc.body, sel) },
  getElementById(id){ if (id === 'navBody') return navBody; return elCache['#' + id] = elCache['#' + id] || (()=>{ const e = mkEl('div'); e.attrs.id = id; return e })() },
  addEventListener(){}, removeEventListener(){},
};
const fetchLog = [];
function fetchStub(url, opt){
  fetchLog.push({ url: String(url), method: (opt && opt.method) || 'GET' });
  const resp = obj => ({ ok: true, status: 200, json: () => Promise.resolve(obj), text: () => Promise.resolve('') });
  if (String(url).indexOf('/_ctxmap') >= 0) return Promise.resolve(resp({ ok: true, map: {} }));
  if (String(url).indexOf('/_conv-order') >= 0) return Promise.resolve(resp({ order: {} }));
  return Promise.resolve(resp({ ok: true }));
}
class ES { constructor(){ this.listeners = {} } addEventListener(){} close(){} }
const storage = () => { const mm = {}; return { getItem: k => (k in mm ? mm[k] : null), setItem: (k, v)=>{ mm[k] = String(v) }, removeItem: k=>{ delete mm[k] } } };
const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Promise, parseInt, parseFloat, isNaN,
  setTimeout: f => 0, clearTimeout(){}, setInterval: ()=>0, clearInterval(){},
  fetch: fetchStub, document: doc,
  navigator: { userAgent: 'node', maxTouchPoints: 0, clipboard: { writeText: () => Promise.resolve() } },
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
try { vm.runInContext(m, sandbox, { filename: 'ui-inline.js' }) } catch (e){ console.error('LOAD-FAIL', e && e.stack || e); process.exit(2) }
const T = sandbox.__T, S = T.S;

/* 场景准备：模型窗口 1M（deepseek-flash），兜底 contextK=1000 → 1M */
S.models = [{ providerID: 'deepseek', modelID: 'deepseek-flash', name: 'Flash', pname: 'DeepSeek', ctx: 1000000 }];
S.ctxMap.map = {
  S_small: { u: 50000, tc: 100, p: 'deepseek', m: 'deepseek-flash' },   /* 5% → ok */
  S_hot: { u: 300000, tc: 200, p: 'deepseek', m: 'deepseek-flash' },    /* 30% → danger */
  S_unknown: { u: 100000, tc: 300, p: 'gone', m: 'gone-model' }        /* 模型不匹配 → 兜底 1M → 10% ok */
};

const sess = id => ({ id, title: 'T' + id, pwa: 1, directory: '/x', parentID: '', time: { created: 1, updated: 2 } });

/* B1 根行 pill：正常/告警/兜底 */
const rowOk = T.buildConvRow(sess('S_small'), {});
const pillOk = rowOk.children.find(c => c._cls.has('conv-ctx'));
ok('根行 pill 文本 = 5%', pillOk && pillOk.textContent === '5%', pillOk && pillOk.textContent);
ok('根行 pill 档位类 ctxp-ok', pillOk && pillOk._cls.has('ctxp-ok'));
ok('L-048 反向断言：pill 不挂裸 ctx-ok/warn/danger 类', pillOk && !pillOk._cls.has('ctx-ok') && !pillOk._cls.has('ctx-warn') && !pillOk._cls.has('ctx-danger'));
const rowHot = T.buildConvRow(sess('S_hot'), {});
const pillHot = rowHot.children.find(c => c._cls.has('conv-ctx'));
ok('根行 30% → ctxp-danger', pillHot && pillHot._cls.has('ctxp-danger') && pillHot.textContent === '30%', pillHot && pillHot.textContent);
const rowUnk = T.buildConvRow(sess('S_unknown'), {});
const pillUnk = rowUnk.children.find(c => c._cls.has('conv-ctx'));
ok('模型不匹配 → 兜底 1M 窗口，10% ctxp-ok', pillUnk && pillUnk.textContent === '10%' && pillUnk._cls.has('ctxp-ok'), pillUnk && pillUnk.textContent);
const rowNone = T.buildConvRow(sess('S_none'), {});
ok('无数据会话不渲染 pill', !rowNone.children.some(c => c._cls.has('conv-ctx')));

/* B2 子行 pill（小管家等角色） */
S.children['P1'] = [{ id: 'S_small', title: '小管家方案审 (@steward subagent)', agent: 'steward', parentID: 'P1', time: { created: 3, updated: 4 } }];
const box = mkEl('div');
T.appendChildRow(box, S.children['P1'][0], 1, '');
const subRow = box.children[0];
const subPill = subRow.children.find(c => c._cls.has('conv-sub-ctx'));
ok('子行 pill 渲染（conv-sub-ctx）文本 5%', subPill && subPill.textContent === '5%' && subPill._cls.has('ctxp-ok'), subPill && subPill.textContent);
ok('子行仍含角色徽章（pill 未挤掉 steward 标签）', subRow.children.some(c => c._cls.has('role-steward')));
const box2 = mkEl('div');
T.appendChildRow(box2, { id: 'S_none', title: '御史 (@censor-output subagent)', agent: 'censor-output', parentID: 'P1', time: { created: 3, updated: 4 } }, 1, '');
ok('子行无数据不渲染 pill', !box2.children[0].children.some(c => c._cls.has('conv-sub-ctx')));

/* B3 指纹：ver++ 驱动 navSidebarSig 变化 */
const sigA = T.navSidebarSig();
S.ctxMap.ver++;
const sigB = T.navSidebarSig();
ok('ctxMap.ver 入 navSidebarSig（ver++ 指纹必变）', sigA !== sigB);

/* B4 阈值：红档阈值可调（localStorage ctxThreshold） */
sandbox.localStorage.setItem('littledj.ctxThreshold', '32'); /* warnLow=27：30% 落 20<pct≤32.5 区间 → warn */
const info = T.convCtxInfo('S_hot');
ok('阈值 32 时 30% 为 warn', info && info.lvl === 'warn', info && info.lvl);
sandbox.localStorage.removeItem('littledj.ctxThreshold');

/* B5 task362：红档提醒横幅退役（静态锚 + vm 挂载；保留红档快照供自动交接） */
const srcCtx = fs.readFileSync(ROOT + '/ui/src/chat/context.js', 'utf8');
const srcHtml = fs.readFileSync(ROOT + '/ui/index.html', 'utf8');
ok('B5-1 提醒横幅文案/样式/旧函数名零残留', (srcCtx + srcHtml).indexOf('继续对话会降智') < 0 && (srcCtx + srcHtml).indexOf('ctxDangerBanner') < 0 && (srcCtx + srcHtml).indexOf('.ctx-banner') < 0);
ok('B5-2 快照函数改名 syncCtxDangerState 并已挂 window（旧名不可达）', typeof sandbox.syncCtxDangerState === 'function' && typeof sandbox.syncCtxDangerBanner === 'undefined' && typeof sandbox.CTX_BANNER_ID === 'undefined');
(function () {
  const v = require('./contract').htmlScriptVersionMap(ROOT + '/ui')['src/chat/context.js'];
  ok('B5-3 context.js 缓存参数在位（当前 ' + (v || '缺失') + '，动态口径 task371-M0#9）', /^p\d+$/.test(v || ''));
})();

/* ---------- C. E2E（可选） ---------- */
(async () => {
  console.log('[C] E2E' + (process.env.E2E === '1' ? '' : '（未开启，设 E2E=1 跑真实端点）'));
  if (process.env.E2E === '1'){
    const authFile = path.join(require('../server/paths').ROOT, 'config', 'auth.txt');
    const auth = fs.existsSync(authFile) ? fs.readFileSync(authFile, 'utf8').trim() : '';
    const base = process.env.LITTLEDJ_E2E_BASE || 'http://127.0.0.1:4097';
    const hdr = { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') };
    try {
      const r401 = await fetch(base + '/_ctxmap');
      ok('无鉴权 → 401', r401.status === 401, String(r401.status));
      const t0 = Date.now();
      const r = await fetch(base + '/_ctxmap', { headers: hdr });
      const d = await r.json();
      const cost = Date.now() - t0;
      ok('鉴权 GET → 200 且 ok:true', r.status === 200 && d.ok === true, r.status + ' ' + JSON.stringify(d).slice(0, 120));
      ok('响应含 map 对象与非空条目', d.map && typeof d.map === 'object' && Object.keys(d.map).length > 0, 'count=' + (d.count || 0));
      const first = d.map && Object.keys(d.map)[0] ? d.map[Object.keys(d.map)[0]] : null;
      ok('条目结构 {u,tc,p,m} 且 u>0', first && first.u > 0 && first.tc > 0 && typeof first.p === 'string' && typeof first.m === 'string', JSON.stringify(first));
      const t1 = Date.now();
      const r2 = await fetch(base + '/_ctxmap', { headers: hdr });
      await r2.json();
      ok('二次请求走缓存（<200ms）', Date.now() - t1 < 200, (Date.now() - t1) + 'ms');
      console.log('  INFO  首拉 ' + cost + 'ms（首扫一次性，之后增量/缓存）');
    } catch (e){ ok('E2E 请求异常', false, String(e && e.message || e)) }
  }
  console.log('\n结果：PASS ' + pass + ' / FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();

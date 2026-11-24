/* task275 自测（真行为）：设置内嵌页渲染时机 —— 防「点 API Key 右侧空白」复发
   背景：task272 把 API Key 改成设置内嵌页，renderSettings 在 body 尚未 append 进文档时就调
   renderKeyEmbedPage → skRenderProvList 内部 $('#'+wrapId) 用 document.querySelector 查不到
   #keyEmbedBox ⇒ 静默 return，页面白屏（主人 2026-11-14 截图报障）。原 selftest-keys-view 全是
   静态正则断言，抓不到这个「时序」缺陷。
   做法：迷你 DOM 桩 + vm 跑**真源码** renderSettings / renderKeyEmbedPage / skRenderProvList，
   断言 apikey 页渲染完成后 #keyEmbedBox 已连接进文档且内含「API Key 管理」标题与两张供应商卡；
   红对照：把渲染调用挪回 append 之前，同一断言必须转红。
   用法：node deploy/selftest-settings-embed-dom.js （exit 0=PASS / 1=FAIL / 2=源码装载失败） */
const fs = require('fs'), path = require('path'), vm = require('vm');
const UI = process.env.UI_PATH || path.join(__dirname, '..', 'ui', 'index.html');
const DOM = path.join(__dirname, '..', 'ui', 'src', 'core', 'dom.js');
/* task328 连坐修复：模块化后函数在 ui/src（loadUiSource 拼模块+index.html 内联），旧提取逻辑零改动生效 */
/* task328 连坐修复：模块（@order 拼接）在前 + index.html 全文（style/内联脚本）在后——
   不可再叠 loadUiSource（它已含内联脚本），否则内联段重复出现两遍，红对照只删得掉一处。 */
const html = require('./contract').concatModules(path.dirname(UI)) + '\n' + fs.readFileSync(UI, 'utf8');
const domSrc = fs.readFileSync(DOM, 'utf8');

let pass = 0, fail = 0;
function ok (name, cond) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name) }

function extractFn (src, name) {
  const key = 'function ' + name + '(';
  const i = src.indexOf(key);
  if (i < 0) return '';
  let d = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1) }
  }
  return '';
}

/* ---------- 迷你 DOM（只实现本链路用到的 API：appendChild / querySelector(#id,.cls) / textContent） ---------- */
function mkDom () {
  function Node (tag) {
    this.tag = tag; this.children = []; this.parent = null;
    this.className = ''; this.id = ''; this._text = '';
    this.style = {}; this.disabled = false; this.title = ''; this.onclick = null;
  }
  Node.prototype.appendChild = function (c) { c.parent = this; this.children.push(c); return c };
  Node.prototype.addEventListener = function () {};
  Node.prototype._all = function (acc) {
    this.children.forEach(function (c) { acc.push(c); c._all(acc) });
    return acc;
  };
  Node.prototype.querySelector = function (sel) {
    const all = this._all([]);
    if (sel.charAt(0) === '#') {
      const id = sel.slice(1);
      return all.filter(function (n) { return n.id === id })[0] || null;
    }
    if (sel.charAt(0) === '.') {
      const c = sel.slice(1);
      return all.filter(function (n) { return (' ' + n.className + ' ').indexOf(' ' + c + ' ') >= 0 })[0] || null;
    }
    return null;
  };
  Object.defineProperty(Node.prototype, 'textContent', {
    get: function () { return this._text },
    set: function (v) { this.children = []; this._text = String(v) }
  });
  Object.defineProperty(Node.prototype, 'innerHTML', {
    get: function () { return '' },
    set: function () { this.children = []; this._text = '' }
  });
  Node.prototype.replaceChildren = function (...nodes) { this.children = []; this._text = ''; (nodes || []).forEach(n => this.children.push(n)) } /* task387：mock 跟进 replaceChildren */
  const doc = new Node('#document');
  doc.body = new Node('body'); doc.body.parent = doc; doc.children.push(doc.body);
  return {
    document: {
      createElement: function (t) { return new Node(t) },
      querySelector: function (s) { return doc.querySelector(s) },
      body: doc.body
    },
    root: doc
  };
}

/* ---------- 从真源码装函数，vm 净跑 ---------- */
function run (src, viewOverride) {
  const fnNames = ['renderSettings', 'renderKeyEmbedPage', 'skRenderProvList', 'skKvKeys',
    'navRestoreScroll', 'currentSettingsGroup'];
  const fns = fnNames.map(function (n) { return extractFn(src, n) });
  const elSrc = extractFn(domSrc, 'el');
  const $Src = extractFn(domSrc, '$');
  if (!fns[0] || !fns[1] || !elSrc || !$Src) return { loadFail: true };

  const dom = mkDom();
  const ctx = {
    document: dom.document,
    console: console,
    setTimeout: function () {},
    POP_TAB: null,
    POP_PROV: '',
    SETTINGS: { view: viewOverride || 'apikey', keyProv: '', ds: null, zp: null, volc: null },
    SETTINGS_NAV_SCROLL: 0,
    SETTINGS_NAV: [
      { id: 'apikey', label: 'API Key', ico: '⚿' },
      { id: 'profile', label: '主人画像', ico: '◉' },
      { id: 'roles', label: '角色', ico: '◇' },
      { id: 'sfx', label: '音效', ico: '♪', children: [{ id: 'tts-pwa', label: 'PWA' }, { id: 'tts-tui', label: 'TUI' }] },
      { id: 'guard', label: '约束管理', ico: '⛨' }
    ],
    renderTtsPwaPage: function () {}, renderVoicePage: function () {}, renderTtsTuiPage: function () {},
    renderTtsProviderPage: function () {}, renderGuardPage: function () {},
    renderTtsProviderPlaceholder: undefined,
    loadTtsProviders: function () {},
    skRenderKeyWin: function () {},
    loadDsSettings: function (cb) { if (cb) cb({ keys: [] }) },
    loadZpSettings: function (cb) { if (cb) cb({ keys: [] }) },
    loadVolcSettings: function (cb) { if (cb) cb({ keys: [] }) }, /* task328：火山方舟卡同链渲染 */
    loadGuard: function () {},
    fetchProfile: function () {}, fetchBalance: function () {}, loadRoles: function () {},
    popoutOpen: function () {}, popoutFitOnce: function () {},
    toast: function () {},
    esc: function (s) { return String(s == null ? '' : s) }
  };
  vm.createContext(ctx);
  try {
    vm.runInContext(elSrc + '\n' + $Src + '\n' + fns.join('\n') + '\n;this.__renderSettings = renderSettings;', ctx);
  } catch (e) {
    return { loadFail: true, err: e.message };
  }
  /* 搭一个最小设置弹窗：settingsWrap 在文档内，modalSave 在文档内 */
  const wrap = ctx.document.createElement('div'); wrap.id = 'settingsWrap';
  const save = ctx.document.createElement('button'); save.id = 'modalSave';
  dom.document.body.appendChild(wrap); dom.document.body.appendChild(save);
  try {
    ctx.__renderSettings();
  } catch (e) {
    return { err: e.message };
  }
  const box = dom.document.querySelector('#keyEmbedBox');
  const cards = box ? box._all([]).filter(function (n) { return (' ' + n.className + ' ').indexOf(' kvls-card ') >= 0 }) : [];
  const tabsNode = wrap._all([]).filter(function (n) { return (' ' + n.className + ' ').indexOf(' settings-tabs ') >= 0 })[0]; /* task360：组内子页签行（view 落组内子页时才渲染） */
  return {
    connected: !!box,
    hasTitle: !!(box && box.querySelector('.kvls-title') && box.querySelector('.kvls-title').textContent === 'API Key 管理'),
    hasCards: cards.length > 0,
    cardCount: cards.length,
    viewAfter: ctx.SETTINGS.view, /* task360：renderSettings 规范化后的 view（组 id 应回落组内首子页） */
    hasTabs: !!tabsNode
  };
}

/* ---------- 正向：修复后的源码必须渲染出内嵌列表 ---------- */
const good = run(html);
if (good.loadFail) { console.log('FAIL 装载：renderSettings/renderKeyEmbedPage/skRenderProvList 源码未找到（ui 结构变动？）' + (good.err ? ' ' + good.err : '')); process.exit(2) }
ok('【真行为】设置切 apikey：不抛错', !good.err);
ok('【真行为】#keyEmbedBox 渲染后已连接进文档（修 task275 白屏根因）', good.connected);
ok('【真行为】列表页标题「API Key 管理」上屏', good.hasTitle);
ok('【真行为】三张供应商卡上屏（DeepSeek / GLM / 火山方舟，task328）', good.cardCount === 3);

/* ---------- 红对照：把 apikey 渲染挪回 body append 之前，必须转红 ---------- */
const badOrder = html.replace(
  /  wrap\.appendChild\(body\);\n  \/\* task275[\s\S]*?\n  if \(SETTINGS\.view === 'apikey'\) renderKeyEmbedPage\(body\);/,
  "  if (SETTINGS.view === 'apikey') renderKeyEmbedPage(body);\n  wrap.appendChild(body);"
);
ok('红对照样本构造成功（顺序已还原为修复前）', badOrder !== html);
const bad = run(badOrder);
/* 修复前顺序下：box 空壳随后仍会随 body 入文档，但 skRenderProvList 已静默 return ⇒ 标题/卡片永不渲染（白屏） */
ok('【红对照】修复前顺序：游离 DOM 下渲染器查不到容器，静默 return（白屏复现）', bad && !bad.err && bad.connected === true && !bad.hasTitle && !bad.hasCards);

/* ---------- task360：view 落组 id（'sfx'）自动回落组内首子页，杜绝空白页（防复发真行为锚） ---------- */
const sfxRun = run(html, 'sfx');
ok('【真行为】view=组id(sfx)：规范化到组内首子页 tts-pwa（task360 根治空白）', sfxRun && !sfxRun.err && sfxRun.viewAfter === 'tts-pwa');
ok('【真行为】view=组id(sfx)：组内子页签行上屏（非空白页）', sfxRun && sfxRun.hasTabs === true);
/* 红对照：剥掉规范化段，同一断言必须转红（证明是源码在规范化，不是 fixture 副作用） */
const noNorm = html.replace(/  \/\* task360 防复发[\s\S]*?break; \}\n  \}\n/, '');
ok('红对照样本构造成功（规范化段已剥除）', noNorm !== html);
const sfxBad = run(noNorm, 'sfx');
ok('【红对照】无规范化：view 停在 sfx、无子页签（空白页复现）', sfxBad && !sfxBad.err && sfxBad.viewAfter === 'sfx' && sfxBad.hasTabs === false);

console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail ? 1 : 0);

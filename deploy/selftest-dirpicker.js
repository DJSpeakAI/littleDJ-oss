/*
 * 文件夹选择器仿真自测（task152 · 依据教训 L-033：前端交互必须能跑起来才算验证）
 * 用法：node deploy/selftest-dirpicker.js
 * 覆盖：渲染结构 / 路径输入跳转 / 筛选过滤 / 子目录进入 / 错误时保留输入框
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const pathFn = require('path');

const ROOT = pathFn.resolve(__dirname, '..');
/* 模块化后源码锚点走 loadUiSource（按 @order 拼接全部模块+内联脚本）+ index.html 原文（HTML 骨架/CSS 锚点仍在这） */
const html = require('./selftest-load-ui').loadUiSource(pathFn.join(ROOT, "ui"))
  + '\n' + fs.readFileSync(pathFn.join(ROOT, "ui/index.html"), "utf8");

/* ---------- 1. 从 index.html 抽出选择器函数体（task235：起点前移到 registerFolder，覆盖登记链） ---------- */
const start = html.indexOf('function registerFolder(');
const end = html.indexOf('function askNewProject(');
if (start < 0 || end < 0 || end <= start) {
  console.log('RESULT: FAIL（未能从 ui/index.html 定位选择器函数块）');
  process.exit(1);
}
const code = html.slice(start, end);

/* ---------- 2. 极简 DOM stub ---------- */
function makeEl(id) {
  const el = {
    id: id, tagName: 'div', className: '', _html: '', value: '', title: '',
    style: {}, onclick: null, oninput: null, onkeydown: null, attrs: {},
    getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = String(v); }
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); this._scan(); }
  });
  el._scan = function () {
    // 注册带 id 的子元素（取 value 属性）
    const re = /id="([\w-]+)"([^>]*)>/g;
    let m;
    while ((m = re.exec(this._html))) {
      const child = registry[m[1]] || (registry[m[1]] = makeEl(m[1]));
      const vm2 = /value="([^"]*)"/.exec(m[2]);
      child.value = vm2 ? vm2[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&') : '';
      const title = /title="([^"]*)"/.exec(m[2]);
      child.title = title ? title[1] : '';
      child.hidden = /(^|\s)hidden(\s|$)/.test(m[2].trim());
    }
  };
  return el;
}
const registry = {};
function seed(id) {
  const k = String(id).replace(/^#/, '');
  return registry[k] || (registry[k] = makeEl(k));
}

const sandbox = {
  console,
  _picker: null,
  $: function (sel) { return sel.charAt(0) === '#' ? (registry[sel.slice(1)] || null) : null },
  $$: function (sel) {
    // 仅本条测试用：抽 .dirrow 行
    if (/\.dirrow$/.test(sel)) {
      registry.__rows = registry.__rows || [];
      return registry.__rows;
    }
    if (/\.dirchip$/.test(sel)) return registry.__chips || [];
    return [];
  },
  fetch: null, // 每个场景注入
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] }) },
  openModal: function () {}, closeModal: function () {},
  renderPickerList: null,
  /* task235 Ⓖ：registerFolder 登记链依赖的全局 mock */
  S: { projects: [], imports: [], root: '' },
  toast: function (t) { sandbox.__lastToast = String(t) },
  setView: function (v) { sandbox.__view = v },
  samePath: function (a, b) { return String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '') },
  pickProjectName: function (p) { const s = String(p).replace(/\/+$/, ''); return s.split('/').pop() || '未命名' },
  alert: function (msg) { sandbox.__lastAlert = String(msg) },
  loadProjects: function () { return Promise.resolve() },
  scheduleSidebar: function () { sandbox.__schedCalls = (sandbox.__schedCalls || 0) + 1 }
};
sandbox.__schedCalls = 0; sandbox.__lastAlert = '';
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code + '\nthis.__api = { pickFolder: pickFolder, loadPicker: loadPicker, jumpPicker: jumpPicker, renderPicker: renderPicker, renderPickerList: renderPickerList, toggleNewDir: toggleNewDir, submitNewDir: submitNewDir, registerFolder: registerFolder, projParentDir: projParentDir, validateNewProjName: validateNewProjName, createProject: createProject, flashProjectRow: flashProjectRow };', sandbox);
const api = sandbox.__api;

/* ---------- 3. 场景 ---------- */
function fakeTree() {
  return {
    '/storage/Users/currentUser': {
      path: '/storage/Users/currentUser', parent: null,
      entries: [
        { name: 'Desktop', path: '/storage/Users/currentUser/Desktop' },
        { name: 'Documents', path: '/storage/Users/currentUser/Documents' },
        { name: 'Download', path: '/storage/Users/currentUser/Download' },
        { name: 'deveco', path: '/storage/Users/currentUser/deveco' }
      ]
    },
    '/storage/Users/currentUser/Desktop': {
      path: '/storage/Users/currentUser/Desktop', parent: '/storage/Users/currentUser',
      entries: [{ name: 'projA', path: '/storage/Users/currentUser/Desktop/projA' }]
    }
  };
}
let lastUrl = '', lastBody = '', lastMkdirUrl = '', mkdirOk = true;
function setFetch(ok) {
  sandbox.fetch = function (url, opt) {
    lastUrl = url;
    if (String(url).indexOf('/_fs/mkdir') >= 0) {
      lastMkdirUrl = url;
      lastBody = opt && opt.body ? String(opt.body) : '';
      const body = JSON.parse(lastBody || '{}');
      if (!mkdirOk) return Promise.resolve({ json: function () { return Promise.resolve({ error: '同名文件夹已存在' }) } });
      fakeTree()['/storage/Users/currentUser/' + body.name] = { path: '/storage/Users/currentUser/' + body.name, parent: '/storage/Users/currentUser', entries: [] };
      return Promise.resolve({ json: function () { return Promise.resolve({ ok: true, path: '/storage/Users/currentUser/' + body.name }) } });
    }
    const q = url.indexOf('?path=');
    const p = q >= 0 ? decodeURIComponent(url.slice(q + 6)) : '/storage/Users/currentUser';
    const d = ok ? fakeTree()[p] : { error: '无法浏览该目录（默认只允许用户主目录）' };
    return Promise.resolve({ json: function () { return Promise.resolve(d || { error: 'bad path' }) } });
  };
}
const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra || '' }) }

(async function () {
  /* 场景①：渲染 —— 大字号结构 + 快捷位置 + 筛选框 + 路径输入框 */
  seed('#dirPicker'); seed('#dirListBox'); seed('#dirPathInput'); seed('#dirFilter');
  sandbox._picker = { path: '', parent: null, onPick: null, onCancel: null, seq: 0, entries: [], q: '' };
  setFetch(true);
  api.loadPicker('');
  await new Promise(r => setTimeout(r, 10));
  const dp = registry.dirPathInput, dl = registry.dirListBox;
  check('①路径输入框存在且带当前路径', dp && dp.value === '/storage/Users/currentUser', dp && dp.value);
  check('①列表渲染 4 个目录行', (dl._html.match(/class="dirrow"/g) || []).length === 4);
  check('①快捷位置芯片 3 个（Desktop/Documents/Download，deveco 不在白名单）', (registry.dirPicker._html.match(/class="dirchip"/g) || []).length === 3, String((registry.dirPicker._html.match(/class="dirchip"/g) || []).length));
  check('①筛选输入框存在', !!registry.dirFilter);
  check('①路径栏为 input（可编辑）而非静态 div', /id="dirPathInput"[^>]*type="text"/.test(registry.dirPicker._html));

  /* 场景②：筛选过滤（不请求服务端） */
  const before = lastUrl;
  api.renderPickerList.call(null);
  sandbox._picker.q = 'do';
  api.renderPickerList();
  check('②筛选 do → 只剩 2 行（Documents/Download）', (dl._html.match(/class="dirrow"/g) || []).length === 2, String((dl._html.match(/class="dirrow"/g) || []).length));
  check('②筛选不重新请求服务端', lastUrl === before);
  sandbox._picker.q = 'zzz';
  api.renderPickerList();
  check('②无匹配有提示文案', /没有匹配/.test(dl._html));
  sandbox._picker.q = '';

  /* 场景③：路径输入跳转 */
  registry.dirPathInput.value = '/storage/Users/currentUser/Desktop';
  api.jumpPicker();
  await new Promise(r => setTimeout(r, 10));
  check('③路径跳转请求带正确 path', lastUrl.indexOf('path=%2Fstorage%2FUsers%2FcurrentUser%2FDesktop') >= 0 || lastUrl === '/_fs/browse?path=' + encodeURIComponent('/storage/Users/currentUser/Desktop'), lastUrl);
  check('③跳转后目录行=projA', /projA/.test(dl._html));
  check('③跳转后 q 清空', sandbox._picker.q === '');
  check('③有上级按钮', /id="dirUp"/.test(registry.dirPicker._html));

  /* 场景④：错误路径 —— 列表区报错但输入框仍在（可继续改） */
  setFetch(false);
  registry.dirPathInput.value = '/storage/root/nope';
  api.jumpPicker();
  await new Promise(r => setTimeout(r, 10));
  check('④错误时列表区显示错误', /无法浏览该目录/.test(dl._html));
  check('④错误时路径输入框仍在（不整体替换）', /id="dirPathInput"/.test(registry.dirPicker._html) && !!registry.dirPathInput);

  /* 场景⑤：新建文件夹 */
  setFetch(true);
  sandbox._picker = { path: "/storage/Users/currentUser", parent: null, onPick: null, onCancel: null, seq: 0, entries: [], q: "" };
  api.loadPicker("");
  await new Promise(r => setTimeout(r, 10));
  check("⑤新建文件夹按钮存在", !!registry.dirNewBtn);
  check("⑤新建输入行默认隐藏", registry.dirNewRow.hidden === true);
  api.toggleNewDir(true);
  check("⑤点按钮后输入行展开并清空", registry.dirNewRow.hidden === false && registry.dirNewName.value === "");
  registry.dirNewName.value = "新项目";
  lastUrl = ""; lastBody = ""; lastMkdirUrl = "";
  api.submitNewDir();
  await new Promise(r => setTimeout(r, 10));
  check("⑤创建请求打到 /_fs/mkdir", lastMkdirUrl.indexOf("/_fs/mkdir") >= 0, lastMkdirUrl);
  check("⑤请求体带当前目录与新名字", /"path":"\/storage\/Users\/currentUser"/.test(lastBody) && /"name":"新项目"/.test(lastBody), lastBody);
  check("⑤创建成功不再 browse 停留（task233：直达确认链）", lastUrl.indexOf("browse") < 0, lastUrl);

  /* ⑤b：重名错误 → 原地报错不跳转（task233 后 ⑤ 已走确认链清空 _picker，须重置） */
  sandbox._picker = { path: "/storage/Users/currentUser", parent: null, onPick: null, onCancel: null, seq: 0, entries: [], q: "" };
  registry.dirNewRow.hidden = false;
  registry.dirNewName.value = "新项目";
  mkdirOk = false;
  lastUrl = "";
  api.submitNewDir();
  await new Promise(r => setTimeout(r, 10));
  check("⑤b重名时错误显示在输入行", /同名文件夹已存在/.test(registry.dirNewErr.textContent), registry.dirNewErr.textContent);
  check("⑤b重名时不跳转目录", lastUrl.indexOf("browse") < 0, lastUrl);

  /* ⑤c：空名字前端拦截，不发请求 */
  mkdirOk = true;
  registry.dirNewName.value = "   ";
  lastUrl = "";
  api.submitNewDir();
  await new Promise(r => setTimeout(r, 10));
  check("⑤c空名字不发请求并提示", lastUrl === "" && /请先输入/.test(registry.dirNewErr.textContent), lastUrl + " | " + registry.dirNewErr.textContent);

  /* ⑤d：含斜杠拦截 */
  registry.dirNewName.value = "a/b";
  lastUrl = "";
  api.submitNewDir();
  await new Promise(r => setTimeout(r, 10));
  check("⑤d斜杠名字前端拦截", lastUrl === "" && /不能包含斜杠/.test(registry.dirNewErr.textContent), registry.dirNewErr.textContent);

  /* ---------- Ⓕ task233：新建文件夹=项目（创建成功即自动走「选择此文件夹」确认链） ---------- */
  const srcAll = html; // 与装载同源的完整源码（Ⓔ/Ⓕ 静态断言共用）
  let f_picked = null, f_cancelled = false, f_closed = 0;
  sandbox.closeModal = function () { f_closed++ };
  sandbox._picker = { path: "/storage/Users/currentUser", parent: null, onPick: function (p) { f_picked = p }, onCancel: function () { f_cancelled = true }, seq: 0, entries: [], q: "" };
  mkdirOk = true;
  registry.dirNewName.value = "任务233测试";
  lastUrl = "";
  api.submitNewDir();
  await new Promise(r => setTimeout(r, 10));
  check("Ⓕa创建成功即触发确认链 onPick(新路径)", f_picked === "/storage/Users/currentUser/任务233测试", String(f_picked));
  check("Ⓕb确认链关闭弹窗 closeModal 被调", f_closed === 1, String(f_closed));
  check("Ⓕc不再停留弹窗（无二次 browse 请求）", lastUrl.indexOf("browse") < 0, lastUrl);
  check("Ⓕd确认路径不误触 onCancel", !f_cancelled, String(f_cancelled));
  check("Ⓕe确认后 _picker 已清空（防后续误操作）", sandbox._picker === null, String(sandbox._picker));
  /* 创建失败 → 留在弹窗不触发确认链 */
  f_picked = null; f_closed = 0;
  sandbox._picker = { path: "/storage/Users/currentUser", parent: null, onPick: function (p) { f_picked = p }, onCancel: null, seq: 0, entries: [], q: "" };
  mkdirOk = false;
  registry.dirNewName.value = "又一个";
  api.submitNewDir();
  await new Promise(r => setTimeout(r, 10));
  check("Ⓕf创建失败留在弹窗不触发确认链", f_picked === null && f_closed === 0, f_picked + "|" + f_closed);
  /* pickerConfirm 与手动确认同构：手动路径（modalOk）也走同一函数 */
  check("Ⓕg手动确认与自动确认共用 pickerConfirm（源码断言）", /openModal\('选择项目文件夹',[\s\S]*?pickerConfirm, '选择此文件夹'\)/.test(srcAll), "pickerConfirm 未挂到 openModal");
  /* 文案同步（task233 语义上屏） */
  check("Ⓕh占位文案含「创建并登记」", /placeholder="新项目文件夹名，回车即创建并登记为项目"/.test(srcAll), "placeholder 未更新");
  check("Ⓕititle 同步新建即项目语义（task236 改为「输入名字直接建」）", /id="btnMkProj"\s+title="新建项目：输入名字直接建（也可选已有文件夹登记）"/.test(srcAll), "title 未更新");

  /* ---------- Ⓔ task160：＋新建项目入口恒显（主人报障：对话视图下找不到创建新项目入口） ---------- */
  check("Ⓔa按钮HTML无hidden", !/id="btnMkProj"[^>]*\shidden/.test(srcAll), 'btnMkProj 仍带 hidden');
  check("Ⓔb无视图显隐切换残留", !/btnMkProj'\)\.hidden\s*=/.test(srcAll), '仍存在 btnMkProj.hidden 赋值');
  check("Ⓔc入口绑定存在", /\$\('#btnMkProj'\)\.onclick\s*=\s*askNewProject/.test(srcAll), 'onclick 绑定缺失');
  check("Ⓔdtask236：＋直接开「新建项目」小窗（不再只开文件夹选择器）", /function askNewProject\(\)\{[\s\S]{0,2000}?openModal\('新建项目'/.test(srcAll), '函数链断裂');
  check("Ⓔetitle含新建项目指引", /id="btnMkProj"\s+title="新建项目/.test(srcAll), 'title 未更新');

  /* ---------- Ⓖ task235：登记成功后左栏补帧（主人同主诉第二轮「还是不显示」） ----------
     断点回顾：mProjAdd（新建对话弹窗内＋）入口 registerFolder 成功后仅重开 askNewTaskDialog，
     无左栏重绘；且 navSidebarSig 指纹不含项目列表 → SSE/轮询补帧永不感知。 */
  let g_cbName = null, g_cbPath = null, g_importUrl = '', g_importBody = '';
  sandbox.S.projects = [{ name: '日常', path: '/lj-sandbox/projects/日常' }];
  sandbox.S.imports = [{ name: 'littleDJ', path: '/storage/Users/currentUser/project/littleDJ' }];
  sandbox.fetch = function (url, opt) {
    if (String(url).indexOf('/_import') >= 0) {
      g_importUrl = url; g_importBody = (opt && opt.body) ? String(opt.body) : '';
      const b = JSON.parse(g_importBody || '{}');
      /* 模拟服务端落盘 + loadProjects 拉回：新登记条目进 S.imports（hit 分支可命中） */
      if (!sandbox.S.imports.some(function (x) { return sandbox.samePath(x.path, b.path) })) sandbox.S.imports.push({ name: b.name, path: b.path });
      return Promise.resolve({ json: function () { return Promise.resolve({ ok: true, name: b.name, path: b.path }) } });
    }
    return Promise.resolve({ json: function () { return Promise.resolve({ projects: sandbox.S.projects, imports: sandbox.S.imports, order: [], root: '' }) } });
  };
  const g_schedBefore = sandbox.__schedCalls;
  await api.registerFolder('/storage/Users/currentUser/project/others', function (n, p) { g_cbName = n; g_cbPath = p });
  await new Promise(r => setTimeout(r, 10));
  check("Ⓖa登记请求打到 /_import 且带 name/path", g_importUrl.indexOf('/_import') >= 0 && /"name":"others"/.test(g_importBody), g_importUrl + ' | ' + g_importBody);
  check("Ⓖb登记成功 cb 收到 (name, path)", g_cbName === 'others' && g_cbPath === '/storage/Users/currentUser/project/others', g_cbName + ',' + g_cbPath);
  check("Ⓖc登记成功后 scheduleSidebar 补帧被调（治 mProjAdd 入口左栏不刷新）", sandbox.__schedCalls > g_schedBefore, 'before=' + g_schedBefore + ' after=' + sandbox.__schedCalls);
  /* hit 分支：同路径已登记 → 秒回 cb 不发请求不补帧（数据没变） */
  g_cbName = null; g_importUrl = ''; const g_schedHit = sandbox.__schedCalls;
  await api.registerFolder('/storage/Users/currentUser/project/others/', function (n, p) { g_cbName = n; g_cbPath = p });
  await new Promise(r => setTimeout(r, 10));
  check("Ⓖd已登记路径（含尾斜杠）秒回 hit 分支不再登记", g_cbName === 'others' && g_importUrl === '', g_cbName + ' | ' + g_importUrl);
  check("Ⓖehit 分支无数据变化不补帧", sandbox.__schedCalls === g_schedHit, 'before=' + g_schedHit + ' after=' + sandbox.__schedCalls);
  /* 静态断言：指纹含项目列表（治 SSE/轮询补帧永不感知——navSidebarSig 函数体） */
  const sigStart = srcAll.indexOf('function navSidebarSig(');
  const sigEnd = srcAll.indexOf('function scheduleSidebar(');
  const sigBody = sigStart >= 0 && sigEnd > sigStart ? srcAll.slice(sigStart, sigEnd) : '';
  check("ⒼfnavSidebarSig 指纹含项目列表（S.projects.concat(S.imports)）", /S\.projects[\s\S]*?concat[\s\S]*?S\.imports/.test(sigBody), '指纹未纳入项目列表');
  check("Ⓖg指纹段含 name~path 语义", /name \+ '~' \+ x\.path/.test(sigBody), '指纹段形态不符');
  /* mProjAdd 两入口源码在位（补帧挂在 registerFolder 内，两入口同受益） */
  const mprojPairs = srcAll.match(/registerFolder\(path, function\(name\)\{ askNewTaskDialog\(name\) \}\)/g) || [];
  check("ⒼhmProjAdd 两入口（弹窗＋/空项目兜底）均走 registerFolder 链", mprojPairs.length === 2, 'count=' + mprojPairs.length);

  /* ---------- Ⓗ task236：＋新建项目一步到位（主人 2026-11-12 报障「我增加一个文件夹，
     这里应该显示项目里面新增的一个项目」） ----------
     口径：名字校验与服务端 NAME_RE 同源；建目录→登记→左栏补帧一条链；错误原地报错不静默。 */
  sandbox.S.root = '/lj-sandbox';
  sandbox.S.projects = [{ name: '日常', path: '/lj-sandbox/projects/日常' }];
  sandbox.S.imports = [{ name: 'littleDJ', path: '/storage/Users/currentUser/project/littleDJ' }];
  check("Ⓗa项目父目录=数据根/projects", api.projParentDir() === '/lj-sandbox/projects', api.projParentDir());
  check("Ⓗb空名字前端拦截", /请先输入项目名/.test(api.validateNewProjName('   ')), api.validateNewProjName('   '));
  check("Ⓗc斜杠名字前端拦截", /只能用中英文/.test(api.validateNewProjName('a/b')), api.validateNewProjName('a/b'));
  check("Ⓗd中文名字放行", api.validateNewProjName('读书笔记') === '', api.validateNewProjName('读书笔记'));
  check("Ⓗe同名项目前端拦截", /已经有同名项目/.test(api.validateNewProjName('日常')), api.validateNewProjName('日常'));

  /* Ⓗf：建目录（projects 目录内自动登记，不再 /_import）→ 回填列表 → 回调 (name, path) */
  let h_urls = [], h_bodies = [], h_err = null, h_name = null, h_path = null, h_loads = 0;
  sandbox.loadProjects = function () { h_loads++; return Promise.resolve() };
  sandbox.fetch = function (url, opt) {
    h_urls.push(String(url));
    h_bodies.push(opt && opt.body ? String(opt.body) : '');
    const body = opt && opt.body ? JSON.parse(String(opt.body)) : {};
    if (String(url).indexOf('/_fs/mkdir') >= 0) return Promise.resolve({ json: () => Promise.resolve({ ok: true, path: '/lj-sandbox/projects/' + body.name }) });
    if (String(url).indexOf('/_import') >= 0) return Promise.resolve({ json: () => Promise.resolve({ ok: true, name: body.name, path: body.path }) });
    return Promise.resolve({ json: () => Promise.resolve({}) });
  };
  await api.createProject('我的新项目', (m) => { h_err = m }, (n, p) => { h_name = n; h_path = p });
  await new Promise(r => setTimeout(r, 10));
  check("Ⓗf建目录请求带 <数据根>/projects + 名字", h_urls[0] === '/_fs/mkdir' && /"path":"\/storage\/Users\/currentUser\/littleDJ\/projects"/.test(h_bodies[0]) && /"name":"我的新项目"/.test(h_bodies[0]), h_urls[0] + ' | ' + h_bodies[0]);
  check("Ⓗgtask236-fu1：projects 目录内建好即登记，不再发 /_import（否则左栏两行同名）", h_urls.length === 1 && h_urls.indexOf('/_import') < 0, h_urls.join(' | '));
  check("Ⓗh回调拿到 (name, path)，且回填了一次项目列表", h_name === '我的新项目' && h_path === '/lj-sandbox/projects/我的新项目' && h_loads === 1, h_name + ' | ' + h_path + ' | loads=' + h_loads);
  check("Ⓗi全程无错误回调", h_err === null, String(h_err));

  /* Ⓗj：mkdir 失败 → 只报错，不回填、不回调成功 */
  h_urls = []; h_err = null; h_name = null; h_loads = 0;
  sandbox.fetch = function (url, opt) {
    h_urls.push(String(url));
    if (String(url).indexOf('/_fs/mkdir') >= 0) return Promise.resolve({ json: () => Promise.resolve({ error: '同名文件夹已存在' }) });
    return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
  };
  await api.createProject('重名', (m) => { h_err = m }, () => { h_name = '不该回调' });
  await new Promise(r => setTimeout(r, 10));
  check("Ⓗj建目录失败原地报错、不回填列表", /同名文件夹已存在/.test(String(h_err)) && h_urls.indexOf('/_import') < 0 && h_name === null && h_loads === 0, String(h_err) + ' | ' + h_urls.join(','));

  /* Ⓗk：静态断言——小窗骨架 + 高亮 + 「选已有文件夹」旧路仍在 */
  const askStart = srcAll.indexOf('function askNewProject(');
  const askBody = askStart >= 0 ? srcAll.slice(askStart, srcAll.indexOf('function submitNewProject(', askStart)) : '';
  check("Ⓗk小窗含名字输入 mkProjName + 主按钮「创建」", /id="mkProjName"/.test(askBody) && /openModal\('新建项目'[\s\S]*?submitNewProject, '创建'\)/.test(askBody), '骨架缺失');
  check("Ⓗl小窗保留「选已有文件夹」次入口", /id="mkProjPick"/.test(askBody) && /pickFolder\(/.test(askBody), '旧路被拆掉');
  check("Ⓗm新建成功后关窗 + 切项目视图 + toast + 高亮新行", /function submitNewProject\(\)\{[\s\S]*?closeModal\(\);[\s\S]*?setView\('projects'\);[\s\S]*?toast\([\s\S]*?flashProjectRow\(nm\)/.test(srcAll), '成功收尾链缺失');
  check("Ⓗn高亮行滚进视野且 2.6s 后自动收尾（状态存 _flashProj，防重绘冲掉类）", /function flashProjectRow\([\s\S]*?_flashProj = \{ name: String\(name \|\| ''\), until: Date\.now\(\) \+ 2600 \}[\s\S]*?scrollIntoView\([\s\S]*?\}, 2600\)/.test(srcAll), '高亮实现不符');
  check("Ⓗn2renderProjRow 每帧按 _flashProj 补 .proj-new（重绘不再把高亮冲掉）", /if \(_flashProj && _flashProj\.name && _flashProj\.name === proj\.name && Date\.now\(\) < _flashProj\.until\) it\.classList\.add\('proj-new'\)/.test(srcAll), '补类未落');
  check("ⒽoCSS 有 .item.proj-new 高亮规则（复用既有色变量，零新增 hex）", /\.item\.proj-new\{background:var\(--card2\);box-shadow:inset 0 0 0 1px var\(--accent\)\}/.test(srcAll), 'CSS 未落');
  check("Ⓗp小窗内按钮行样式 .mkproj-actions 已落", /\.mkproj-actions\{display:flex/.test(srcAll), 'CSS 未落');
  check("Ⓗq主按钮提交期间置灰防连点（createProject 前 disabled=true）", /var ok = \$\('#modalOk'\); if \(ok\) ok\.disabled = true;/.test(srcAll), '防连点缺失');
  /* Ⓗr：路径级去重（projects 自动扫描 ∪ imports）——本轮真机 E2E 实锤左栏画两行同名 */
  const peStart = srcAll.indexOf('function projectEntries(');
  const peBody = peStart >= 0 ? srcAll.slice(peStart, srcAll.indexOf('function clearDropMarks(', peStart)) : '';
  check("ⒽrprojectEntries 按路径去重 imports（防左栏两行同名项目）", /seenPath\[_normProjPath\(p && p\.path\)\] = 1/.test(peBody) && /if \(k && seenPath\[k\]\) return;/.test(peBody), '去重未落');
  /* Ⓗs/Ⓗt task237：主人要把 DAG AI Chat 放回左栏（进去修它的 bug）；选已有文件夹要给回执 */
  const hidStart = srcAll.indexOf('var HIDDEN_PROJECT_PATHS');
  const hidBody = hidStart >= 0 ? srcAll.slice(hidStart, srcAll.indexOf('function _normProjPath(', hidStart)) : '';
  check("ⒽsHIDDEN_PROJECT_PATHS 不再吞掉 DAG_AI_Chat（主人 2026-11-12 指令）", hidBody && !/DAG_AI_Chat/.test(hidBody), '仍被隐藏');
  /* Ⓗs2：只撤 path 隐藏不够——HIDE_GROUP_TITLES 若仍含它会渲染成「有行没名字」的白条（真机 E2E 实锤 rows=["littleDJ","","others"]） */
  const hgtStart = srcAll.indexOf('var HIDE_GROUP_TITLES');
  const hgtBody = hgtStart >= 0 ? srcAll.slice(hgtStart, srcAll.indexOf('\n', hgtStart)) : '';
  check("Ⓗs2HIDE_GROUP_TITLES 不再抹掉 DAG AI Chat 的标题", hgtBody && !/DAG_AI_Chat/.test(hgtBody), '标题仍被隐藏');
  check("Ⓗt「选已有文件夹」成功后有 toast 回执（旧行为已登记项秒回、界面零变化）", /registerFolder\(path, function\(nm\)\{[\s\S]{0,400}?toast\('已登记项目「' \+ nm \+ '」，左栏已更新'/.test(srcAll), '回执缺失');
  let fail = 0;
  results.forEach(r => { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')) });
  console.log(fail ? 'RESULT: FAIL（' + fail + '/' + results.length + '）' : 'RESULT: PASS（' + results.length + '/' + results.length + '）');
  process.exit(fail ? 1 : 0);
})();

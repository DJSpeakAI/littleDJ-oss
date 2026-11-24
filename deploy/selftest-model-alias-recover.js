#!/usr/bin/env node
/* task343 自测：syncModelAliasBoot 的 .bak 一次性恢复（误清事故自愈）+ 写入门槛/主动清空防复活
   用法：node deploy/selftest-model-alias-recover.js
   覆盖：①服务端空 + 本机 .bak 有值 → 恢复并上行，写 bakRestored
        ①b 旧 localStorage 是空对象 {} → 不覆盖 .bak（保住唯一恢复源）
        ②bakRestored 已存在 → 不自动复活（主人主动清空后保持空）
        ③服务端非空 → 服务端胜，.bak 不抢占
        ④GET 失败 → 只兜底渲染、_aliasSynced=false、写入被拒（不拿 .bak 冒险覆盖）
        ⑤主人确认清空成功 → 写 bakRestored；再次 boot 不从 .bak 复活
   沙箱：vm 跑 data.js 真源码 syncModelAliasBoot/setModelAliases + aliasMerge，fetch/localStorage/toast 用桩 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiSource } = require('./selftest-load-ui.js');

const UI_DIR = process.env.UI_DIR || path.join(__dirname, '..', 'ui');
const src = loadUiSource(UI_DIR);

function grab (name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('源码未找到函数：' + name);
  let depth = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1) }
  }
  throw new Error('函数未闭合：' + name);
}

const out = { pass: 0, fail: 0 };
function ok (name, cond, detail) {
  if (cond) { out.pass++; console.log('PASS ' + name) }
  else { out.fail++; console.log('FAIL ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const aliasMerge = new Function('return (' + grab('aliasMerge') + ')')();
const bootSrc = grab('syncModelAliasBoot');
const setSrc = grab('setModelAliases');

function makeLS (LS) {
  return {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(LS, k) ? LS[k] : null },
    setItem: function (k, v) { LS[k] = String(v) },
    removeItem: function (k) { delete LS[k] }
  };
}

function runBoot (env) {
  const LS = env.LS || {};
  const posts = [], toasts = [];
  const sandbox = {
    localStorage: makeLS(LS),
    fetch: function (url, opts) {
      if (!opts) {
        if (env.getFail) return Promise.reject(new Error('HTTP 500'));
        return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, alias: env.server || {} }) } });
      }
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve({ ok: true, count: 0 }) } });
    },
    aliasMerge: aliasMerge,
    /* 用真 aliasPostVerified 会再走 fetch；这里桩掉并记录「上行 map」，直接模拟成功 count */
    aliasPostVerified: function (al, force) {
      posts.push({ alias: al, force: !!force });
      return Promise.resolve({ ok: true, count: Object.keys(al || {}).length });
    },
    toast: function (s) { toasts.push(s) },
    refreshModelOptions: function () {},
    _aliasMap: {},
    _aliasSynced: false
  };
  vm.createContext(sandbox);
  vm.runInContext('var _aliasMap = {}; var _aliasSynced = false;\n' + bootSrc + '\nthis.__boot = syncModelAliasBoot; this.__state = function(){ return { map: _aliasMap, synced: _aliasSynced } };', sandbox);
  return sandbox.__boot().then(function () {
    const st = sandbox.__state();
    return { map: st.map, synced: st.synced, posts: posts, toasts: toasts, LS: LS };
  });
}

function runSet (env) {
  const LS = env.LS || {};
  const posts = [], toasts = [];
  const sandbox = {
    localStorage: makeLS(LS),
    aliasPostVerified: function (al, force) {
      posts.push({ alias: al, force: !!force });
      var r = env.postResult;
      if (typeof r === 'function') r = r(al, force);
      return Promise.resolve(r || { ok: true, count: Object.keys(al || {}).length });
    },
    toast: function (s) { toasts.push(s) },
    refreshModelOptions: function () {},
    window: { confirm: function () { return env.confirm !== false } },
    _stBusy: false
  };
  vm.createContext(sandbox);
  var mapJson = JSON.stringify(env.map || {});
  var synced = (env.synced !== false) ? 'true' : 'false';
  var busy = env.testBusy ? 'true' : 'false';
  vm.runInContext('var _aliasMap = ' + mapJson + '; var _aliasSynced = ' + synced + '; var _stBusy = ' + busy + ';\n' + setSrc + '\nthis.__set = setModelAliases; this.__state = function(){ return { map: _aliasMap, synced: _aliasSynced } };', sandbox);
  return sandbox.__set(env.next || {}).then(function (res) {
    return { res: res, map: sandbox.__state().map, posts: posts, toasts: toasts, LS: LS };
  });
}

(async function () {
  /* ① 服务端空 + .bak 3 条 → 恢复并上行 */
  const bak = {
    'zhipuai-coding-plan/glm-5.3': 'GLM 5.3',
    'zhipuai-coding-plan/glm-5.3-flash': 'GLM Flash',
    'deepseek/deepseek-v4-pro': 'DS Pro'
  };
  const LS1 = {};
  LS1['littledj.modelAlias.bak'] = JSON.stringify(bak);
  const r1 = await runBoot({ LS: LS1, server: {} });
  ok('①服务端空 + .bak 3 条 → 内存恢复 3 条', Object.keys(r1.map).length === 3 && r1.map['deepseek/deepseek-v4-pro'] === 'DS Pro', JSON.stringify(r1.map));
  ok('①恢复后上行 3 条（POST 一次）', r1.posts.length === 1 && Object.keys(r1.posts[0].alias).length === 3, JSON.stringify(r1.posts[0] && r1.posts[0].alias));
  ok('①恢复后写 bakRestored 标记（防复活）', !!r1.LS['littledj.modelAlias.bakRestored'], String(r1.LS['littledj.modelAlias.bakRestored']));
  ok('①恢复成功 toast 提示', r1.toasts.some(function (s) { return /已从本机备份恢复 3 条/.test(s) }), JSON.stringify(r1.toasts));
  ok('①_aliasSynced 置位', r1.synced === true, String(r1.synced));

  /* ①b 旧 localStorage 是空对象 {} → 不覆盖 .bak（御审 P1-3） */
  const LS1b = {};
  LS1b['littledj.modelAlias.bak'] = JSON.stringify(bak);
  LS1b['littledj.modelAlias'] = '{}';
  const r1b = await runBoot({ LS: LS1b, server: {} });
  const bak1b = JSON.parse(LS1b['littledj.modelAlias.bak'] || '{}');
  ok('①b local={} 不覆盖 .bak（保住唯一恢复源）', Object.keys(bak1b).length === 3, JSON.stringify(bak1b));
  ok('①b 仍从 .bak 恢复 3 条', Object.keys(r1b.map).length === 3, JSON.stringify(r1b.map));

  /* ①c 部分 local（1 条）不覆盖旧 .bak（3 条）→ 合并为并集（御审 P2-2） */
  const LS1c = {};
  LS1c['littledj.modelAlias.bak'] = JSON.stringify(bak);
  LS1c['littledj.modelAlias'] = JSON.stringify({ 'deepseek/deepseek-flash': 'L' });
  const r1c = await runBoot({ LS: LS1c, server: {} });
  const bak1c = JSON.parse(LS1c['littledj.modelAlias.bak'] || '{}');
  ok('①c local 1 条 + bak 3 条 → .bak 合并为并集 4 条', Object.keys(bak1c).length === 4 && bak1c['deepseek/deepseek-flash'] === 'L', JSON.stringify(bak1c));
  ok('①c 本次上行只用 local 1 条（不把 bak 当待迁数据）', r1c.posts.length === 1 && Object.keys(r1c.posts[0].alias).length === 1, JSON.stringify(r1c.posts[0] && r1c.posts[0].alias));

  /* ② 同一 LS（bakRestored 已存在）再 boot → 不自动复活 */
  const r2 = await runBoot({ LS: r1.LS, server: {} });
  ok('②bakRestored 已存在 → 不再从 .bak 恢复', Object.keys(r2.map).length === 0, JSON.stringify(r2.map));
  ok('②不再上行（零 POST）', r2.posts.length === 0, String(r2.posts.length));

  /* ③ 服务端非空 → 服务端胜，.bak 不抢占 */
  const server3 = { 'deepseek/deepseek-flash': '服务端新值' };
  const LS3 = {};
  LS3['littledj.modelAlias.bak'] = JSON.stringify(bak);
  const r3 = await runBoot({ LS: LS3, server: server3 });
  ok('③服务端非空 → 服务端值保留', Object.keys(r3.map).length === 1 && r3.map['deepseek/deepseek-flash'] === '服务端新值', JSON.stringify(r3.map));
  ok('③服务端非空 → 零上行', r3.posts.length === 0, String(r3.posts.length));

  /* ④ GET 失败 → 本地/pending 兜底，不拿 .bak 冒险 */
  const LS4 = {};
  LS4['littledj.modelAlias.bak'] = JSON.stringify(bak);
  const r4 = await runBoot({ LS: LS4, getFail: true });
  ok('④GET 失败 → 空兜底（不恢复 .bak，下轮再迁）', Object.keys(r4.map).length === 0, JSON.stringify(r4.map));
  ok('④GET 失败 → 零上行', r4.posts.length === 0, String(r4.posts.length));
  ok('④GET 失败 → _aliasSynced=false（禁写，御审 P1-1）', r4.synced === false, String(r4.synced));
  const r4set = await runSet({ LS: r4.LS, map: {}, synced: false, next: { 'a/b': 'x' } });
  ok('④未水化保存被拒（零 POST、ok:false）', r4set.res.ok === false && r4set.posts.length === 0, JSON.stringify(r4set.res));

  /* ⑤ 主人确认清空成功 → 写 bakRestored；再 boot 不复活（御审 P1-2） */
  const LS5 = {};
  LS5['littledj.modelAlias.bak'] = JSON.stringify(bak);
  const r5 = await runSet({ LS: LS5, map: { 'deepseek/deepseek-flash': 'X' }, synced: true, next: {}, confirm: true, postResult: { ok: true, count: 0 } });
  ok('⑤确认清空成功（res.ok、内存为空）', r5.res.ok === true && Object.keys(r5.map).length === 0, JSON.stringify(r5.res));
  ok('⑤清空成功写 bakRestored（防复活）', !!LS5['littledj.modelAlias.bakRestored'], String(LS5['littledj.modelAlias.bakRestored']));
  const r5b = await runBoot({ LS: LS5, server: {} });
  ok('⑤清空后刷新不从 .bak 复活', Object.keys(r5b.map).length === 0 && r5b.posts.length === 0, JSON.stringify(r5b.map));

  /* ⑥ 网络 reject → 返回 ok:false，不抛 unhandledrejection（御审 P1-5） */
  const r6 = await runSet({ LS: {}, map: { 'a/b': 'x' }, synced: true, next: { 'a/b': 'y' }, postResult: function(){ return Promise.reject(new Error('net')) } });
  ok('⑥网络 reject → resolve ok:false（不抛 unhandled）', r6.res.ok === false && r6.posts.length === 1, JSON.stringify(r6.res));

  /* ⑦ 页内自检（_stBusy）临时清空不写 bakRestored，不能阻断主人真机 .bak 恢复 */
  const LS7 = {};
  LS7['littledj.modelAlias.bak'] = JSON.stringify(bak);
  const r7 = await runSet({ LS: LS7, map: { 'deepseek/deepseek-flash': 'X' }, synced: true, next: {}, confirm: false, testBusy: true, postResult: { ok: true, count: 0 } });
  ok('⑦页内自检临时清空不写 bakRestored', r7.res.ok === true && !LS7['littledj.modelAlias.bakRestored'], String(LS7['littledj.modelAlias.bakRestored']));

  /* ⑧ 确认清空后 POST 响应丢失 → 仍写 bakRestored（防服务端已空却被 .bak 复活，御审 P2-1） */
  const LS8 = {};
  LS8['littledj.modelAlias.bak'] = JSON.stringify(bak);
  const r8 = await runSet({ LS: LS8, map: { 'deepseek/deepseek-flash': 'X' }, synced: true, next: {}, confirm: true, postResult: function(){ return Promise.reject(new Error('resp-lost')) } });
  ok('⑧清空响应丢失也写 bakRestored（不复活）', r8.res.ok === false && !!LS8['littledj.modelAlias.bakRestored'], String(LS8['littledj.modelAlias.bakRestored']));

  console.log('\nRESULT: ' + (out.fail ? 'FAIL' : 'PASS') + '（' + out.pass + ' PASS / ' + out.fail + ' FAIL）');
  process.exit(out.fail ? 1 : 0);
})().catch(function (e) {
  console.log('FAIL 异常：' + (e && e.stack || e));
  process.exit(1);
});

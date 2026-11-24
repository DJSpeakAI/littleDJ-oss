#!/usr/bin/env node
/* task343 自测：服务端别名库写保护（写前备份 / 拒空覆写 / force / 原子落盘）
   用法：node deploy/selftest-model-alias-server.js
   沙箱：从 server/proxy.js 提取真函数，CONFIG 指向 run/selftest/alias-<pid>（不碰真实 config） */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROXY = path.join(__dirname, '..', 'server', 'proxy.js');
const proxySrc = fs.readFileSync(PROXY, 'utf8');
const TMP = path.join(require('os').tmpdir(), 'lj-alias-server-' + process.pid);
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

function grab (name) {
  const i = proxySrc.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('源码未找到函数：' + name);
  let depth = 0;
  const j = proxySrc.indexOf('{', i);
  for (let k = j; k < proxySrc.length; k++) {
    if (proxySrc[k] === '{') depth++;
    else if (proxySrc[k] === '}') { depth--; if (!depth) return proxySrc.slice(i, k + 1) }
  }
  throw new Error('函数未闭合：' + name);
}

const out = { pass: 0, fail: 0 };
function ok (name, cond, detail) {
  if (cond) { out.pass++; console.log('PASS ' + name) }
  else { out.fail++; console.log('FAIL ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const consts = [
  'const MODEL_ALIAS_FILE = ' + JSON.stringify(path.join(TMP, 'model-alias.json')) + ';',
  'const MODEL_ALIAS_BAK = ' + JSON.stringify(path.join(TMP, 'model-alias.json.bak')) + ';',
  (proxySrc.match(/const ALIAS_KEY_RE = [^\n]+/) || ['const ALIAS_KEY_RE = /^$/'])[0]
].join('\n');

const sandbox = {
  fs: fs,
  path: path,
  readJson: function (file, def) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return def }
  },
  CONFIG: TMP
};
vm.createContext(sandbox);
vm.runInContext(consts + '\n' + [
  grab('cleanAliasMap'),
  grab('readModelAlias'),
  grab('readModelAliasSavedAt'),
  grab('writeModelAlias')
].join('\n') + '\nthis.__write = writeModelAlias; this.__read = readModelAlias; this.__savedAt = readModelAliasSavedAt;', sandbox);

const file = path.join(TMP, 'model-alias.json');
const bak = path.join(TMP, 'model-alias.json.bak');
const write = sandbox.__write;
const read = sandbox.__read;
const savedAt = sandbox.__savedAt;

(function () {
  /* ① 首次写两条：无旧库 → 不产生 .bak */
  const a = write({ 'deepseek/deepseek-flash': '小快闪', 'zhipuai-coding-plan/glm-5.3': 'GLM 5.3' });
  ok('①首次写两条 count=2', Object.keys(a).length === 2 && Object.keys(read()).length === 2, JSON.stringify(a));
  ok('①首次无旧库 → 不产生 .bak', !fs.existsSync(bak), bak);
  ok('①GET savedAt 有值', savedAt() > 0, String(savedAt()));

  /* ② 第二次写一条：旧库非空 → 写前备份 2 条 */
  write({ 'deepseek/deepseek-v4-pro': 'DS Pro' });
  const bakJson = JSON.parse(fs.readFileSync(bak, 'utf8'));
  ok('②写前备份 .bak = 上一版 2 条', Object.keys(bakJson.alias).length === 2 && bakJson.alias['deepseek/deepseek-flash'] === '小快闪', JSON.stringify(bakJson.alias));
  ok('②当前库 = 新写 1 条', Object.keys(read()).length === 1 && read()['deepseek/deepseek-v4-pro'] === 'DS Pro', JSON.stringify(read()));

  /* ③ 空覆写无 force → 抛 ALIAS_EMPTY_GUARD，库不变 */
  let guard = null;
  try { write({}) } catch (e) { guard = e }
  ok('③空覆写无 force → ALIAS_EMPTY_GUARD', !!guard && guard.code === 'ALIAS_EMPTY_GUARD', guard && guard.message);
  ok('③守卫失败后库不变（仍 1 条）', Object.keys(read()).length === 1, JSON.stringify(read()));

  /* ④ 空覆写带 force → 允许清空，清空前备份 1 条 */
  const c = write({}, { force: true });
  ok('④force 清空成功 count=0', Object.keys(c).length === 0 && Object.keys(read()).length === 0, JSON.stringify(read()));
  const bak2 = JSON.parse(fs.readFileSync(bak, 'utf8'));
  ok('④force 清空前 .bak = 被清的 1 条', Object.keys(bak2.alias).length === 1 && bak2.alias['deepseek/deepseek-v4-pro'] === 'DS Pro', JSON.stringify(bak2.alias));

  /* ⑤ 原子落盘：无 .tmp 残留；脏 key 清洗；200 上限 */
  ok('⑤原子写无 .tmp 残留', !fs.existsSync(file + '.tmp'), file + '.tmp');
  const d = write({ 'BAD KEY': 'x', 'deepseek/deepseek-flash': 'ok' });
  ok('⑤脏 key 清洗（只留合法 key）', Object.keys(d).length === 1 && d['deepseek/deepseek-flash'] === 'ok', JSON.stringify(d));
  let over = null;
  const big = {}; for (let i = 0; i < 201; i++) big['a/m' + i] = 'x';
  try { write(big) } catch (e) { over = e }
  ok('⑤条目上限 200 仍生效', !!over && /别名条目超限/.test(over.message), over && over.message);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\nRESULT: ' + (out.fail ? 'FAIL' : 'PASS') + '（' + out.pass + ' PASS / ' + out.fail + ' FAIL）');
  process.exit(out.fail ? 1 : 0);
})();

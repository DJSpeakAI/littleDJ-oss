#!/usr/bin/env node
/*
 * task246 自测：跨机 claim 锁（临时裸仓 + 临时工作仓，不碰真实仓库）
 * 覆盖：占锁 / 他人被拒 / check 退出码 / 过期接管 / 释放 / 工作区零污染（含脏工作区）
 * 用法：node deploy/selftest-claim.js
 */
'use strict';
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLAIM = path.resolve(__dirname, 'claim.js');
/* 临时仓必须放在「自己拥有」的目录：鸿蒙 PC 的 $HOME 在 /storage（FUSE 映射成 20001006），
   git 会对里面的仓报 dubious ownership 且 safe.directory=* 也压不住子进程 → 优先用 /tmp */
function mkTmp() {
  const bases = [process.env.LITTLEDJ_TMPDIR, '/tmp', os.tmpdir()].filter(Boolean);
  for (const b of bases) { try { if (fs.existsSync(b)) return fs.mkdtempSync(path.join(b, 'lj-claim-')) } catch (e) {} }
  throw new Error('没有可用的临时目录');
}
const TMP = mkTmp();
const ORIGIN = path.join(TMP, 'origin.git');
const WORK = path.join(TMP, 'work');
const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra == null ? '' : String(extra).slice(0, 200) }) }

/* 鸿蒙 PC 上 git 会对临时目录（含本地裸仓 origin）报 dubious ownership →
   所有 git 调用带 -c safe.directory=*，并用 GIT_CONFIG_* 环境变量让子进程（receive-pack）也认 */
const SAFE_ENV = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*' };
function sh(cmd, args, cwd) { return execFileSync(cmd, args, { cwd: cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: Object.assign({}, process.env, SAFE_ENV) }) }
function git(cwd, args) { return sh('git', ['-c', 'safe.directory=*'].concat(args), cwd) }
function gitRaw(args, opt) { return execFileSync('git', ['-c', 'safe.directory=*'].concat(args), Object.assign({}, opt, { env: Object.assign({}, process.env, SAFE_ENV, (opt && opt.env) || {}) })) }
function claim(args, holder) {
  try {
    const out = execFileSync('node', [CLAIM].concat(args), {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        LITTLEDJ_REPO: WORK, LITTLEDJ_HOLDER: holder,
        GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: '*'
      })
    });
    return { code: 0, out: out };
  } catch (e) {
    return { code: (e.status == null ? -1 : e.status), out: String(e.stdout || ''), err: String(e.stderr || '') };
  }
}

try {
  /* 准备：裸仓 + 工作仓（master 分支） */
  fs.mkdirSync(ORIGIN, { recursive: true });
  git(ORIGIN, ['init', '--bare', '-q']);
  git(TMP, ['init', '-q', '-b', 'master', WORK]);
  git(WORK, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-q', '-m', 'init']);
  git(WORK, ['remote', 'add', 'origin', ORIGIN]);
  git(WORK, ['push', '-q', '-u', 'origin', 'master']);

  const before = git(WORK, ['status', '--porcelain']);

  /* ① 首次占锁 */
  const c1 = claim(['claim', 'ui-index-html', '--task', 'task246', '--minutes', '30'], 'hosta#a');
  check('① A 首次占锁成功（exit 0）', c1.code === 0, c1.out + c1.err);
  check('① 远端 locks 分支出现 locks/ui-index-html.json（不动业务分支）', git(ORIGIN, ['show', 'locks:locks/ui-index-html.json']).indexOf('hosta#a') >= 0);
  check('① 业务分支 master 未被锁提交污染', git(ORIGIN, ['rev-parse', 'master']).trim() === git(WORK, ['rev-parse', 'origin/master']).trim());

  /* ② 他人占锁被拒 */
  const c2 = claim(['claim', 'ui-index-html', '--task', 'taskX', '--minutes', '30'], 'hostb#b');
  check('② B 抢同一把锁被拒（exit 3）', c2.code === 3, c2.out + c2.err);
  check('② 被拒时回显持有者', (c2.out + c2.err).indexOf('hosta#a') >= 0, c2.out + c2.err);

  /* ③ check 退出码语义 */
  const k1 = claim(['check', 'ui-index-html'], 'hostb#b');
  check('③ B check → exit 1（他人持有）', k1.code === 1, k1.out);
  const k2 = claim(['check', 'ui-index-html'], 'hosta#a');
  check('③ A check → exit 0（我持有）', k2.code === 0, k2.out);
  const k3 = claim(['check', 'no-such-lock'], 'hostb#b');
  check('③ 无锁 check → exit 0（空闲）', k3.code === 0, k3.out);

  /* ④ 过期锁可被接管（直接往 origin 的 locks 分支写一把已过期的锁：locks 分支只有 locks/ 一层） */
  const expired = JSON.stringify({ slug: 'ui-index-html', holder: 'hostz#z', at: Date.now() - 7200000, until: Date.now() - 3600000, untilISO: new Date(Date.now() - 3600000).toISOString(), task: 'taskOld' }, null, 2) + '\n';
  const iblob = gitRaw(['-C', WORK, 'hash-object', '-w', '--stdin'], { input: expired, encoding: 'utf8' }).trim();
  const isub = gitRaw(['-C', WORK, 'mktree'], { input: '100644 blob ' + iblob + '\tui-index-html.json\n', encoding: 'utf8' }).trim();
  const itree = gitRaw(['-C', WORK, 'mktree'], { input: '040000 tree ' + isub + '\tlocks\n', encoding: 'utf8' }).trim();
  const locksTip = git(ORIGIN, ['rev-parse', 'locks']).trim();
  const isha = git(WORK, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit-tree', itree, '-p', locksTip, '-m', 'expired lock']).trim();
  git(WORK, ['push', '-q', 'origin', isha + ':refs/heads/locks']);
  const c3 = claim(['claim', 'ui-index-html', '--task', 'task246b', '--minutes', '30'], 'hostb#b');
  check('④ 过期锁被 B 接管（exit 0 且提示接管过期锁）', c3.code === 0 && c3.out.indexOf('接管了过期锁') >= 0, c3.out + c3.err);

  /* ⑤ 释放：非持有者不许，持有者可以 */
  const r0 = claim(['release', 'ui-index-html'], 'hosta#a');
  check('⑤ 非持有者释放被拒（exit 3）', r0.code === 3, r0.out + r0.err);
  const r1 = claim(['release', 'ui-index-html'], 'hostb#b');
  check('⑤ 持有者释放成功（exit 0）', r1.code === 0 && r1.out.indexOf('已释放') >= 0, r1.out + r1.err);
  const after = claim(['status', 'ui-index-html', '--json'], 'hostb#b');
  check('⑤ 释放后 status 无锁', after.code === 0 && after.out.indexOf('"claim": null') >= 0, after.out);

  /* ⑥ 工作区零污染：claim/release 全程不动 working tree 与 index */
  const afterStatus = git(WORK, ['status', '--porcelain']);
  check('⑥ claim/release 不改工作区（status 前后一致）', before === afterStatus, JSON.stringify({ before: before, after: afterStatus }));

  /* ⑦ 脏工作区下占锁也安全（不清空未提交改动） */
  fs.writeFileSync(path.join(WORK, 'dirty.txt'), '未提交的改动\n');
  const c4 = claim(['claim', 'docs-readme', '--task', 'task246c'], 'hosta#a');
  check('⑦ 脏工作区也能占锁（exit 0）', c4.code === 0, c4.out + c4.err);
  check('⑦ 脏文件仍在（未被 reset/清空）', fs.existsSync(path.join(WORK, 'dirty.txt')) && git(WORK, ['status', '--porcelain']).indexOf('dirty.txt') >= 0);

  /* ⑧ 不同 slug 可并存 */
  const c5 = claim(['claim', 'ui-appjs', '--task', 'task246d'], 'hostb#b');
  const st = claim(['status', '--json'], 'hosta#a');
  check('⑧ 两把不同的锁可并存', c5.code === 0 && st.code === 0 && (st.out.match(/"slug":/g) || []).length >= 2, st.out.slice(0, 200));

  let fail = 0;
  results.forEach(function (r) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')) });
  console.log('');
  console.log(fail ? 'RESULT: FAIL（' + fail + '/' + results.length + '）' : 'RESULT: PASS（' + results.length + '/' + results.length + '）');
  process.exit(fail ? 1 : 0);
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
}

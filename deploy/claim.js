#!/usr/bin/env node
/*
 * task246：跨机单写者 claim 锁（用 git 当仲裁，而不是本地文件锁）
 *
 * 为什么不用文件锁：`deploy/pre-commit-lock.sh` 只拦「在这个仓库里提交的人」——外部写入者（DJH/Windows）、
 * DevEco Code、另一台机器上的会话都不认它；2026-11-12 真实撞过（DJH 改 ui/index.html 时，设备上另一个
 * 大管家会话正在改 docs，只能手工 stash/还原）。git 是唯一双方都认的仲裁：锁就是 origin 上的一个文件。
 *
 * 实现要点（零工作区污染）：锁用 git plumbing 直接造 commit 并 push 到当前分支，
 * **不动工作区、不动 index**——所以 claim 失败也不会把别人未提交的改动搞乱。
 *
 * 用法：
 *   node deploy/claim.mjs claim ui-index-html --task task246 [--minutes 60] [--note "改＋新建项目"] [--holder 名字]
 *   node deploy/claim.mjs status [ui-index-html] [--json]
 *   node deploy/claim.mjs release ui-index-html [--json]
 *   node deploy/claim.mjs check ui-index-html        # 退出码：0 空闲/我持有；1 他人持有；2 出错
 *
 * 退出码：claim → 0 成功（新占或续期）/ 3 他人持有 / 4 网络或推送失败
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');

const ROOT = process.env.LITTLEDJ_REPO ? path.resolve(process.env.LITTLEDJ_REPO) : path.resolve(__dirname, '..');
const IDENT = (process.env.LITTLEDJ_HOLDER || (os.hostname() + '#' + (process.env.USERNAME || process.env.USER || 'user'))).toLowerCase();
const SLUG_RE = /^[a-z0-9._\/-]{1,80}$/;

function argv() { return process.argv.slice(2); }
function flag(name, def) { const a = argv(); const i = a.indexOf('--' + name); return i >= 0 && a[i + 1] && a[i + 1].charAt(0) !== '-' ? a[i + 1] : def; }
function has(name) { return argv().indexOf('--' + name) >= 0; }
function pos() { const a = argv(); const out = []; for (let i = 0; i < a.length; i++) { if (a[i].charAt(0) === '-') { if (a[i + 1] && a[i + 1].charAt(0) !== '-') i++; continue; } out.push(a[i]); } return out; }

function git(args, input, timeoutMs) {
  return execFileSync('git', ['-C', ROOT].concat(args), {
    encoding: 'utf8', input: input == null ? undefined : input,
    stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    timeout: timeoutMs || 0,
    env: Object.assign({}, process.env, {
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'littledj-claim',
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'claim@littleDJ.local'
    })
  }).trim();
}
function tryGit(args, input, timeoutMs) {
  try { return { ok: true, out: git(args, input, timeoutMs) } } catch (e) { return { ok: false, out: '', err: String((e.stderr || e.message || '')).slice(0, 300) } }
}
/* task246-fu5：锁不再落在业务分支上（每 claim/release 两个提交会把业务历史弄脏）；
   改用专用分支 `locks`（origin/locks），与业务分支完全隔离——历史干净，跨机照旧可仲裁。 */
const LOCK_BRANCH = process.env.LITTLEDJ_LOCK_BRANCH || 'locks';
function branch() { return { remote: 'origin', branch: LOCK_BRANCH, ref: 'origin/' + LOCK_BRANCH } }
/* 网络操作一律带上限（鸿蒙 PC 的 GitHub 链路会间歇卡死；超时=按缓存引用判，fail-open） */
const NET_TIMEOUT = Number(process.env.LITTLEDJ_CLAIM_TIMEOUT || 12000);
function fetchQuiet() { return tryGit(['fetch', '--quiet', 'origin'], null, NET_TIMEOUT) }

function readClaimRemote(slug, ref) {
  const r = tryGit(['show', ref + ':locks/' + slug + '.json']);
  if (!r.ok) return null;
  try { return JSON.parse(r.out) } catch (e) { return null }
}
function lockJson(slug, holder, minutes, task, note, prev) {
  const now = Date.now();
  return JSON.stringify({
    slug: slug, holder: holder, task: task || '', note: note || '',
    at: now, atISO: new Date(now).toISOString(),
    until: now + minutes * 60000, untilISO: new Date(now + minutes * 60000).toISOString(),
    prev: prev ? { holder: prev.holder, until: prev.until } : null,
    host: os.hostname(), pid: process.pid
  }, null, 2) + '\n';
}
/* 用 plumbing 造新 commit：只改 locks/<slug>.json，工作区与 index 一律不动。
   注意：mktree 造的是「locks 目录子树」，必须再嵌回 base 的根树（否则会把整个仓库根树替换掉——踩过）。 */
function commitLockChange(slug, content, baseSha, message) {
  const locksLines = [];
  const locksTree = tryGit(['ls-tree', baseSha, 'locks/']);
  if (locksTree.ok && locksTree.out) {
    locksTree.out.split('\n').forEach(function (l) {
      const m = /^(\d+)\s+(blob|tree)\s+([0-9a-f]+)\t(.+)$/.exec(l);
      if (!m) return;
      const name = m[4].replace(/^locks\//, '');
      if (name === slug + '.json') return;            // 同名覆盖
      locksLines.push(m[1] + ' ' + m[2] + ' ' + m[3] + '\t' + name);
    });
  }
  if (content != null) {
    const blob = git(['hash-object', '-w', '--stdin'], content);
    locksLines.push('100644 blob ' + blob + '\t' + slug + '.json');
  }
  if (!locksLines.length) locksLines.push('100644 blob ' + git(['hash-object', '-w', '--stdin'], '') + '\t.gitkeep');
  const locksTreeSha = git(['mktree'], locksLines.join('\n') + '\n');

  /* 把 locks 子树嵌回根树 */
  const rootLines = [];
  let sawLocks = false;
  const rootTree = tryGit(['ls-tree', baseSha]);
  if (rootTree.ok && rootTree.out) {
    rootTree.out.split('\n').forEach(function (l) {
      const m = /^(\d+)\s+(blob|tree|commit)\s+([0-9a-f]+)\t(.+)$/.exec(l);
      if (!m) return;
      if (m[4] === 'locks') {
        sawLocks = true;
        rootLines.push('040000 tree ' + locksTreeSha + '\tlocks');
        return;
      }
      rootLines.push(m[1] + ' ' + m[2] + ' ' + m[3] + '\t' + m[4]);
    });
  }
  if (!sawLocks) rootLines.push('040000 tree ' + locksTreeSha + '\tlocks');
  const rootTreeSha = git(['mktree'], rootLines.join('\n') + '\n');
  const args2 = ['-c', 'user.name=littledj-claim', '-c', 'user.email=claim@littleDJ.local', 'commit-tree', rootTreeSha];
  if (baseSha) args2.push('-p', baseSha);
  args2.push('-m', message);
  return git(args2);
}
function pushCommit(sha, br) {
  return tryGit(['push', 'origin', sha + ':refs/heads/' + br], null, NET_TIMEOUT);
}

function doClaim(slug) {
  const minutes = Math.max(1, Math.min(24 * 60, Number(flag('minutes', '60')) || 60));
  const task = flag('task', '');
  const note = flag('note', '');
  const holder = (flag('holder', IDENT) || IDENT).toLowerCase();
  fetchQuiet();
  const br = branch();
  for (let attempt = 1; attempt <= 3; attempt++) {
    /* 锁分支可能还不存在：首把锁用根提交（不带 -p），不是错误 */
    const baseProbe = tryGit(['rev-parse', br.ref]);
    const baseSha = baseProbe.ok ? baseProbe.out : '';
    if (!baseProbe.ok && String(baseProbe.err).indexOf('unknown revision') < 0 && String(baseProbe.err).indexOf('Needed a single revision') < 0) return { code: 4, error: '读不到远端锁分支 ' + br.ref + '（离线？）' + baseProbe.err };
    const cur = readClaimRemote(slug, br.ref);
    const now = Date.now();
    if (cur && Number(cur.until) > now && String(cur.holder).toLowerCase() !== holder) {
      return { code: 3, error: '被占用', claim: cur };
    }
    const body = lockJson(slug, holder, minutes, task, note, cur);
    const sha = commitLockChange(slug, body, baseSha, 'lock(' + slug + '): claim by ' + holder + ' for ' + minutes + 'm' + (task ? ' [' + task + ']' : ''));
    const p = pushCommit(sha, br.branch);
    if (p.ok) return { code: 0, slug: slug, holder: holder, untilISO: JSON.parse(body).untilISO, sha: sha, attempt: attempt, stoleExpired: !!(cur && Number(cur.until) <= now) };
    /* 推送撞车（别人先占了）：重新 fetch 再判一次，最多 3 轮；本地零残留（工作区没动过） */
    fetchQuiet();
  }
  return { code: 4, error: '推送连续被拒（并发争抢），稍后重试' };
}

function doRelease(slug) {
  const holder = (flag('holder', IDENT) || IDENT).toLowerCase();
  fetchQuiet();
  const br = branch();
  const baseProbe = tryGit(['rev-parse', br.ref]);
  if (!baseProbe.ok) return { code: 4, error: '读不到远端锁分支（离线？）：' + (baseProbe.err || '') };
  const base = { out: baseProbe.out };
  const cur = readClaimRemote(slug, br.ref);
  if (!cur) return { code: 0, released: false, note: '本来就没有锁' };
  if (String(cur.holder).toLowerCase() !== holder && !has('force')) {
    return { code: 3, error: '锁不是你的，不能释放（--force 强拆）', claim: cur };
  }
  const sha = commitLockChange(slug, null, base.out, 'lock(' + slug + '): release by ' + holder);
  const p = pushCommit(sha, br.branch);
  if (p.ok) return { code: 0, released: true, sha: sha };
  return { code: 4, error: '推送失败：' + (p.err || '') };
}

function doStatus(slug) {
  fetchQuiet();
  const br = branch();
  if (!slug) {
    const list = tryGit(['ls-tree', '--name-only', br.ref, 'locks/']);
    const out = [];
    if (list.ok && list.out) {
      list.out.split('\n').filter(function (x) { return /\.json$/.test(x) }).forEach(function (f) {
        const c = readClaimRemote(f.replace(/^locks\//, '').replace(/\.json$/, ''), br.ref);
        if (c) out.push(c);
      });
    }
    return { code: 0, claims: out, me: IDENT, now: Date.now() };
  }
  return { code: 0, slug: slug, claim: readClaimRemote(slug, br.ref), me: IDENT, now: Date.now() };
}

function main() {
  const cmd = (argv()[0] || '').toLowerCase();
  const args = pos().slice(1);
  if (['claim', 'release', 'check', 'status'].indexOf(cmd) < 0) {
    console.error('用法：node deploy/claim.mjs <claim|release|check|status> <slug> [--task t] [--minutes 60] [--note ..] [--json]');
    process.exit(2);
  }
  const needSlug = cmd !== 'status' || args[0];
  if (needSlug && (!args[0] || !SLUG_RE.test(args[0]))) { console.error('slug 不合法（1-80 位小写字母数字 . _ / -）'); process.exit(2) }
  const json = has('json');
  let r;
  if (cmd === 'claim') r = doClaim(args[0]);
  else if (cmd === 'release') r = doRelease(args[0]);
  else if (cmd === 'check') {
    const s = doStatus(args[0]);
    const c = s.claim;
    const held = !!(c && Number(c.until) > Date.now() && String(c.holder).toLowerCase() !== IDENT);
    if (json) console.log(JSON.stringify({ held: held, claim: c, me: IDENT }, null, 2));
    else console.log(held ? ('🔒 被 ' + c.holder + ' 持有到 ' + c.untilISO + (c.task ? ' [' + c.task + ']' : '')) : '🔓 空闲（或我持有）');
    process.exit(held ? 1 : 0);
  }
  else r = doStatus(args[0]);

  if (json) console.log(JSON.stringify(r, null, 2));
  else {
    if (cmd === 'claim') {
      if (r.code === 0) console.log('✅ 已占锁：' + r.slug + ' → ' + r.holder + ' 到 ' + r.untilISO + (r.stoleExpired ? '（接管了过期锁）' : '') + ' · sha=' + String(r.sha).slice(0, 8));
      else console.log('❌ ' + r.error + (r.claim ? '：' + r.claim.holder + ' 到 ' + r.claim.untilISO + (r.claim.task ? ' [' + r.claim.task + ']' : '') : ''));
    } else if (cmd === 'release') {
      if (r.code === 0) console.log(r.released ? '✅ 已释放：' + args[0] : '· ' + r.note);
      else console.log('❌ ' + r.error);
    } else {
      const c = r.claim;
      console.log(c ? ('🔒 ' + c.slug + '：' + c.holder + ' 到 ' + c.untilISO + (c.task ? ' [' + c.task + ']' : '')) : '🔓 ' + (args[0] || '(无锁)') + '：空闲');
    }
  }
  process.exit(r.code === undefined ? 0 : r.code);
}
main();

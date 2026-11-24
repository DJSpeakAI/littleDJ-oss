#!/usr/bin/env node
/* task375 自测：wake 拉回选会话逻辑（P1-3 防复发）
   方法：从 deploy/restart-serve.sh 提取真实内联 node 脚本（防「测试副本与生产漂移」），
   把数据源从 curl 换成固定样本，断言筛选输出。
   样本覆盖：空 rootTu 回退 lastEventAt / 2h 边界内外 / state 不参与（done 但活跃照样选）/
   非 littleDJ 目录排除 / rootTu 新于 lastEventAt（主会话干活场景，2026-11-18 事故位） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SH = path.join(__dirname, 'restart-serve.sh');
const sh = fs.readFileSync(SH, 'utf8');

const out = { pass: 0, fail: 0, items: [] };
function ok(name, cond, detail) {
  if (cond) { out.pass++; out.items.push({ name: name, ok: true }); }
  else { out.fail++; out.items.push({ name: name, ok: false, detail: detail || '' }); }
}

/* ① 静态锚：新筛选在位 + 旧 state 筛已退役 + hold 态排除（二审 P1-3） */
ok('A1 筛选用 freshness（含 rootTu）', sh.indexOf('Math.max(Number(t.lastEventAt)||0,Number(t.rootTu)||0)') >= 0);
ok('A2 旧 state===running 筛已退役', sh.indexOf("t.stale!=='archived'&&t.state==='running'") < 0);
ok('A3 2h 窗口', sh.indexOf('2*3600*1000') >= 0);
ok('A4 task375 修复注释留痕', sh.indexOf('task375 修复') >= 0);
ok('A5 手工 hold 态排除在位（waiting/queued/interrupted）', sh.indexOf("t.state!=='waiting'&&t.state!=='queued'&&t.state!=='interrupted'") >= 0);

/* ② 提取内联 node 脚本（多行 WAKE 快照那个），数据源替换为固定样本后真跑 */
const lines = sh.split('\n');
const startIdx = lines.findIndex(function (l) { return l.indexOf('| node -e "') >= 0; });
const endIdx = lines.findIndex(function (l) { return l.indexOf('})" 2>/dev/null)') >= 0; });
ok('B0 内联脚本提取成功', startIdx >= 0 && endIdx > startIdx, 'start=' + startIdx + ' end=' + endIdx);
const inline = startIdx >= 0 && endIdx > startIdx ? (lines.slice(startIdx + 1, endIdx).join('\n') + '\n})') : '';
if (inline) {
  const m = { 1: inline };
  const now = Date.now();
  const H = 3600 * 1000;
  const mk = (id, dir, lastEventAt, rootTu, title, state) => ({ id, directory: dir, lastEventAt, rootTu: rootTu, title: title || id, state: state || 'running' });
  const samples = [
    // 事故位：真正在途的大管家——state 被 auto-done 误标、lastEventAt 停在子代理完成、rootTu=1 分钟前（主会话在干活）→ 必须选中它
    mk('ses_LIVE_butler', '/storage/Users/currentUser/project/littleDJ', now - 40 * 60 * 1000, now - 1 * 60 * 1000, '在途大管家（事故位）', 'done'),
    // 陈年 state 卡 running、3h 无任何活动 → 排除（2h 窗口外）
    mk('ses_STALE_running', '/storage/Users/currentUser/project/littleDJ', now - 3 * H, now - 3 * H, '陈年 running'),
    // 5 分钟前活跃的其他会话 → 候选但排第二
    mk('ses_RECENT_other', '/storage/Users/currentUser/project/littleDJ', now - 5 * 60 * 1000, now - 5 * 60 * 1000, '五分钟前'),
    // 非 littleDJ 目录（DAG 等）→ 排除
    mk('ses_DAG_dir', '/storage/Users/currentUser/project/DAG_AI_Chat', now - 1 * 60 * 1000, now - 1 * 60 * 1000, 'DAG 会话'),
    // 无 rootTu 字段（旧数据行）→ 回退 lastEventAt：1.5h 前在窗口内可候选
    { id: 'ses_NO_rootTu', directory: '/storage/Users/currentUser/project/littleDJ', lastEventAt: now - 90 * 60 * 1000, title: '旧数据无rootTu' },
    // 2h 边界外 1 分钟 → 排除
    mk('ses_EDGE_out', '/storage/Users/currentUser/project/littleDJ', now - (2 * H + 60 * 1000), now - (2 * H + 60 * 1000), '两小时外一点'),
    // 二审 P1-3：手工 hold 态（task334 waiting）即使 rootTu 新鲜也必须排除——hold 语义=等待中勿叫醒
    mk('ses_HOLD_waiting', '/storage/Users/currentUser/project/littleDJ', now - 2 * 60 * 1000, now - 2 * 60 * 1000, '等待中勿收口', 'waiting'),
    mk('ses_HOLD_queued', '/storage/Users/currentUser/project/littleDJ', now - 2 * 60 * 1000, now - 2 * 60 * 1000, '排队挂起', 'queued')
  ];
  const payload = JSON.stringify({ tasks: samples });
  // 内联脚本自带 let raw=''+stdin 读取链：只注入 process.stdin 桩（data 吞样本、end 立即触发），不重复声明
  let printed = '';
  const __payloadStr = payload;
  let __dataCb = null;
  const sandbox = {
    console: { log: function (s) { printed += s } },
    process: {
      stdin: {
        on: function (ev, cb) {
          if (ev === 'data') { __dataCb = cb; }
          else if (ev === 'end') { if (__dataCb) __dataCb(__payloadStr); cb(); }
          return this; // 内联脚本链式 .on('data',…).on('end',…)
        }
      },
      stdout: { write: function () {} },
      argv: []
    }
  };
  vm.createContext(sandbox);
  const wrapped = m[1];
  try {
    vm.runInContext(wrapped, sandbox);
    ok('B1 脚本真跑无异常', true);
  } catch (e) {
    ok('B1 脚本真跑无异常', false, String(e && e.message));
  }
  ok('B2 事故位选中（done 但 rootTu 新鲜）', printed.indexOf('ses_LIVE_butler') === 0, printed.slice(0, 60));
  ok('B3 陈年 running 不再霸榜', printed.indexOf('ses_STALE_running') < 0);
  ok('B4 非 littleDJ 目录排除', printed.indexOf('ses_DAG_dir') < 0);
  ok('B5 2h 外排除（含边界外样本）', printed.indexOf('ses_EDGE_out') < 0);
  ok('B6 排序=新鲜度优先（rootTu 1min > recent 5min，按快照串短名顺序）', printed.indexOf('E_butler') >= 0 && printed.indexOf('NT_other') >= 0 && printed.indexOf('E_butler') < printed.indexOf('NT_other'), printed.slice(0, 120));
  ok('B7 手工 hold 态排除（waiting/queued 即使新鲜也不叫醒）', printed.indexOf('ses_HOLD_waiting') < 0 && printed.indexOf('LD_waiting') < 0 && printed.indexOf('LD_queued') < 0 && printed.indexOf('HOLD') < 0);
}

console.log(JSON.stringify({ pass: out.pass, fail: out.fail, items: out.items.filter(function (i) { return !i.ok }) }, null, 2));
process.exit(out.fail ? 1 : 0);

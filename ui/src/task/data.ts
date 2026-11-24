/* @module data @order 28 @职责 任务数据归一化 + 排序层 @提供 _taskManualPos ORDERS taskTerminalState stageOf stageLabel taskModel taskStageRank taskUnitAt setTaskManualPos taskManualPosOf taskOrderMode @依赖 - @依赖运行期 S_ENDED ledgerInTask @DOM契约 - @严格模式 是 @全局占用 _taskManualPos ORDERS taskTerminalState stageOf stageLabel taskModel taskStageRank taskUnitAt setTaskManualPos taskManualPosOf taskOrderMode @源行 ui/index.html L7340-L7470 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task156 §3.1：数据层归一化（纯函数，供新渲染/单测使用；旧 taskUnits 本步保留不消费） ---------- */
/* 终态判定：done/interrupted/failed/abandoned 视为已结束 */
function taskTerminalState(st){
  return st === 'done' || st === 'interrupted' || st === 'failed' || st === 'abandoned';
}
/* 四态唯一判据：ended > stalled（无 live 真值）> quiet > active */
function stageOf(u){
  if (!u) return 'active';
  var st = u.state || '';
  /* task254：排队态最优先（旧 runner 可能在 S_ENDED 里，排队语义以台账为准） */
  if (st === 'queued') return 'queued';
  /* task334：显式等待中（op=hold 挂后台任务型）——先于终态判（waiting 是 override 硬信号，不走 S_ENDED 归并） */
  if (st === 'waiting') return 'waiting';
  var sid = u.sid || u.runnerSession || '';
  if (u.ended || taskTerminalState(st) || (sid && S_ENDED[sid])) return 'ended';
  if (u.stale === 'stalled' && !u.live) return 'stalled';
  if (u.stale === 'quiet') return 'quiet';
  return 'active';
}
/* 状态文案唯一出口：在跑 / 等待中 / 静默 Nm / 疑似中断 / 完成 / 中断 / 失败 */
function stageLabel(stage, u){
  u = u || {};
  if (stage === 'ended'){
    var st = u.state || '';
    if (st === 'interrupted') return '中断';
    if (st === 'failed') return '失败';
    if (st === 'abandoned') return '已放弃';
    return '完成';
  }
  /* task334：等待中（挂后台任务）——note 短语直出（如「测试台无限循环监督」），上限 12 字 */
  if (stage === 'waiting'){
    var wn = String(u.overrideNote || '').replace(/\s+/g, ' ').trim();
    if (wn && wn.length > 12) wn = wn.slice(0, 12) + '…';
    return '🟡 等待中' + (wn ? '·' + wn : '');
  }
  if (stage === 'stalled') return '疑似中断' + (u.staleMinutes ? '（静默 ' + u.staleMinutes + 'm）' : '');
  if (stage === 'quiet') return '静默 ' + (Number(u.staleMinutes) || 0) + 'm';
  if (stage === 'queued') return '⏳ 等待' + (u.queuePos ? ' #' + u.queuePos : '中');
  return '在跑';
}
/* 按 sid 建表合并台账+实时：台账提供 markable/overridden/eta，实时提供 elapsed/phase；
   同 sid 两源合成 source='both'；无 sid 的台账行按 ledger:<id> 单列（替代旧 key 前缀 hack 的新路径） */
function taskModel(ledger, live){
  var bySid = {}, out = [];
  function blank(){
    return { key: '', sid: '', parentSid: '', role: '', runnerAgent: '', title: '',
      state: '', stage: 'active', ended: false, markable: false, live: false,
      source: '', at: 0, etaMinutes: 0, etaDeadline: 0, etaOverdueMin: 0,
      progress: '', artifacts: [], overridden: false, phase: '', elapsed: 0,
      stale: '', staleMinutes: null, updated: 0, lastEventText: '' };
  }
  function ensure(sid){
    var u = bySid[sid];
    if (!u){ u = blank(); u.key = 'sid:' + sid; u.sid = sid; bySid[sid] = u; out.push(u) }
    return u;
  }
  (ledger || []).forEach(function(t){
    if (!t || !ledgerInTask(t)) return;
    var sid = t.runnerSession || '';
    var u;
    if (sid) u = ensure(sid);
    else { u = blank(); u.key = 'ledger:' + t.id; out.push(u) }
    u.source = (u.source === 'live') ? 'both' : 'ledger';
    u.title = u.title || t.title || '(未命名任务)';
    u.state = t.state || u.state || '';
    u.stale = t.stale || u.stale || '';
    if (t.staleMinutes != null) u.staleMinutes = t.staleMinutes;
    u.markable = !!t.markable || (t.state === 'running' && ledgerInTask(t));
    u.overridden = (t.state === 'done' || t.state === 'interrupted') && Number(t.overrideAt) > 0;
    /* task334：overrideNote 透传（waiting 行 stageLabel 直出挂后台短语） */
    if (t.overrideNote) u.overrideNote = String(t.overrideNote);
    u.role = t.role || u.role || '';
    u.runnerAgent = t.runnerAgent || u.runnerAgent || '';
    u.parentSid = t.parentSid || t.parentID || u.parentSid || '';
    u.etaMinutes = Number(t.etaMinutes) || u.etaMinutes || 0;
    u.etaDeadline = Number(t.etaDeadline) || u.etaDeadline || 0;
    u.etaOverdueMin = Number(t.etaOverdueMin) || u.etaOverdueMin || 0;
    /* task254：排队/开工标记透传（队列分区与位次计算用） */
    if (t.queueDirectory) u.queueDirectory = String(t.queueDirectory);
    if (t.queueAt) u.queueAt = Number(t.queueAt) || 0;
    if (t.queueTitle) u.queueTitle = String(t.queueTitle);
    if (t.taskRunning) u.taskRunning = true;
    u.progress = t.progress || u.progress || '';
    u.lastEventText = t.lastEventText || u.lastEventText || '';
    if (Array.isArray(t.artifacts) && t.artifacts.length) u.artifacts = t.artifacts;
    u.at = Math.max(u.at || 0, Number(t.lastEventAt) || Number(t.updated) || 0);
    u.updated = u.at;
  });
  (live || []).forEach(function(l, i){
    if (!l) return;
    var sid = l.sid || '';
    /* 坏数据容错：无 sid 且无任何标识/内容的空对象不生成幽灵行 */
    if (!sid && !l.key && !l.title && !l.state) return;
    var u;
    if (sid) u = ensure(sid);
    else {
      u = blank(); u.key = l.key || ('live:' + i); u.sid = ''; out.push(u);
    }
    u.live = true;
    u.source = (u.source === 'ledger') ? 'both' : 'live';
    u.title = u.title || l.title || '任务';
    /* 实时终态是正证据：台账仍 running 时按实时收口；
       task334 R2 P1-B：显式 waiting（override 硬信号）不被 live 终态盖回——否则发起会话卡片显「完成」且丢「解除等待」按钮 */
    if (u.state !== 'waiting' && taskTerminalState(l.state)) u.state = l.state;
    else if (!u.state) u.state = l.state || '';
    u.phase = l.phase || u.phase || '';
    u.progress = l.progress || u.progress || '';
    u.elapsed = Number(l.elapsed) || 0;
    u.at = Math.max(u.at || 0, Number(l.updated) || 0);
    u.updated = u.at;
    if (l.ended) u.ended = true;
  });
  out.forEach(function(u){
    u.ended = !!(u.ended || taskTerminalState(u.state || '') || (u.sid && S_ENDED[u.sid]));
    u.stage = stageOf(u);
    u.ended = (u.stage === 'ended');
  });
  return out;
}
/* ---------- task156 §3.2：排序层（唯一比较器族；分组只影响视觉标题，不改排序） ---------- */
/* 五态排序权重（task334 +waiting）：在跑 > 等待中 > 静默 > 疑似中断 > 已结束 */
function taskStageRank(u){
  var s = (u && u.stage) || stageOf(u);
  return s === 'active' ? 0 : (s === 'waiting' ? 1 : (s === 'quiet' ? 2 : (s === 'stalled' ? 3 : 4)));
}
function taskUnitAt(u){ return Number((u && (u.at || u.updated)) || 0) }
/* 手动模式位置表（key→序号）；S4 从 /_conv-order 的 __tasks__ 键回读后注入，本步只留接口 */
var _taskManualPos = {};
function setTaskManualPos(map){ _taskManualPos = (map && typeof map === 'object') ? map : {} }
function taskManualPosOf(k){
  var v = _taskManualPos[k];
  return (typeof v === 'number' && v === v) ? v : 1e15;
}
var ORDERS = {
  active: function(a, b){ return (taskStageRank(a) - taskStageRank(b)) || (taskUnitAt(b) - taskUnitAt(a)) },
  recent: function(a, b){ return taskUnitAt(b) - taskUnitAt(a) },
  manual: function(a, b){ return (taskManualPosOf(a && a.key) - taskManualPosOf(b && b.key)) || (taskUnitAt(b) - taskUnitAt(a)) }
};
function taskOrderMode(){
  try { var m = String(localStorage.getItem('littledj.taskOrderMode') || ''); if (ORDERS[m]) return m } catch(e){}
  return 'active';
}
window._taskManualPos=_taskManualPos; window.ORDERS=ORDERS; window.taskTerminalState=taskTerminalState; window.stageOf=stageOf; window.stageLabel=stageLabel; window.taskModel=taskModel; window.taskStageRank=taskStageRank; window.taskUnitAt=taskUnitAt; window.setTaskManualPos=setTaskManualPos; window.taskManualPosOf=taskManualPosOf; window.taskOrderMode=taskOrderMode;

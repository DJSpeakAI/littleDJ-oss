/* @module ledger @order 27 @职责 右栏任务台账 @提供 TASKS TASK_ACTIVE_STATES showPermission respond ledgerActiveSids liveRunningSids lockHint isSessionLocked fmtDur fmtAgo loadTaskLedger fetchLedgerNow markLedgerState taskReceiptState noteTaskCompletions collectLiveTasks ledgerInTask @依赖 - @依赖运行期 S api stageOf renderTasks navSidebarSig _navSig scheduleSidebar bgMissCheck renderSidebar toast S_ENDED CHILD_STALE_MS @DOM契约 - @严格模式 是 @全局占用 TASKS TASK_ACTIVE_STATES showPermission respond ledgerActiveSids liveRunningSids lockHint isSessionLocked fmtDur fmtAgo loadTaskLedger fetchLedgerNow markLedgerState taskReceiptState noteTaskCompletions collectLiveTasks ledgerInTask @源行 ui/index.html L7134-L7339 @测试锚点 - @被调用 - */
'use strict';
/* ---------- permission ---------- */
function showPermission(p){
  var b = document.querySelector('.permbanner'); if (b) b.remove();
  var div = el('div', 'permbanner');
  div.appendChild(el('span', null, '🔐 请求执行：' + (p.permission || p.title || '操作')));
  div.appendChild(el('span', 'grow'));
  var allow = el('button', null, '允许'); var deny = el('button', null, '拒绝');
  var pid = p.id || p.permissionID;
  allow.onclick = function(){ respond(pid, 'always'); div.remove() };
  deny.onclick = function(){ respond(pid, 'reject'); div.remove() };
  div.appendChild(allow); div.appendChild(deny);
  $('#composer').insertBefore(div, $('#composer').firstChild);
}
function respond(pid, reply){
  if (!S.current) return;
  api('/session/' + S.current.id + '/permissions/' + pid, { method: 'POST', body: { reply: reply } }).catch(function(e){ alert(e.message) });
}

/* ---------- right panel ---------- */
var TASKS = { at: 0, list: [], etas: {}, loading: false, degraded: false, degradedReason: '', degradedHint: '', pendForce: false }; /* task262：pendForce=loading 中强拉的合并标记（方案审 P1-2） */
/* 判据四件套：多选删除前的占用判定（台账 + 实时 + 本机会话三源合一） */
var TASK_ACTIVE_STATES = ['running', 'waiting']; /* task334 P2-10：waiting 入锁——挂后台任务期间防误归档/删除（主人手动收走先解除等待） */
function ledgerActiveSids(){
  var s = {};
  var liveBySid = {};
  collectLiveTasks().forEach(function(l){ if (l.sid) liveBySid[l.sid] = l });
  (TASKS.list || []).forEach(function(t){
    /* B：step=0 纯聊天会话不算运行中任务，普通会话交给 busyBy/live 兜底 */
    if (!(TASK_ACTIVE_STATES.indexOf(t.state) >= 0 && ledgerInTask(t))) return;
    /* task156 S6：统一走 stageOf 四态判据——有 live 真值时按 live 判 active，否则 stalled/quiet 不算 active。
       ⚠行为变更：旧口径 t.stale !== 'stalled'（stalled 一律不锁、quiet/S_ENDED 仍锁），新口径按 stage 收口。详见任务牌 S6「行为变更」段。
       task334 R2 P1-A：waiting（op=hold 显式等待中）直锁——override 硬信号优先于 stage 门（stageOf(waiting)!=='active' 会把锁挡掉，防误删承诺不能靠加枚举落空） */
    var isWaiting = t.state === 'waiting';
    var lu = t.runnerSession ? liveBySid[t.runnerSession] : null;
    var probe = { state: t.state, stale: t.stale || '', sid: t.runnerSession || '', live: !!(lu && !lu.ended), ended: !!(lu && lu.ended) };
    if (!isWaiting && stageOf(probe) !== 'active') return;
    s[t.id] = 1;
    if (t.runnerSession) s[t.runnerSession] = 1;
  });
  return s;
}
function liveRunningSids(){
  var s = {};
  collectLiveTasks().forEach(function(u){ if (u.sid && u.state === 'running') s[u.sid] = 1 });
  return s;
}
/* C-1：按锁定来源给如实文案；busyBy 保留决议原文，台账/实时来源给出可照做的解锁路径 */
function lockHint(sid, ledgerSet, liveSet){
  if (S.busyBy[sid]) return '任务执行中，先停止再归档';
  if ((ledgerSet && ledgerSet[sid]) || (liveSet && liveSet[sid])) return '台账显示该会话近期有任务活动；确认无任务后，可先在任务面板标记完成/中断，再回来归档';
  return '';
}
function isSessionLocked(sid, ledgerSet, liveSet){
  return !!lockHint(sid, ledgerSet, liveSet);
}
function fmtDur(ms){
  var s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + 's';
  var m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + 'm' + (r ? r + 's' : '');
  return Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0') + 'm';
}
function fmtAgo(ts){
  if (!ts) return '时间未知';
  var d = Math.max(0, Date.now() - Number(ts));
  if (d < 60000) return '刚刚';
  if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
  if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
  return Math.floor(d / 86400000) + ' 天前';
}
function loadTaskLedger(force?, recheck?){
  var now = Date.now();
  if (TASKS.loading){ if (force) TASKS.pendForce = true; return } /* task262 方案审 P1-2：loading 中强拉不丢请求——合并标记，完成后立即补拉 */
  if (!force && now - TASKS.at < 2000) return;
  TASKS.loading = true;
  fetch('/_tasks').then(function(r){ return r.json() }).then(function(d){
    TASKS.at = Date.now(); TASKS.loading = false;
    TASKS.list = (d && Array.isArray(d.tasks)) ? d.tasks : [];
    TASKS.etas = (d && d.etas && typeof d.etas === 'object') ? d.etas : {}; // task119：ETA 映射（首帧兜底，冷启动恒有 {}）
    /* 台账降级：ok:false 时响应体带 degraded/reason/hint，正常响应自动清空 */
    TASKS.degraded = !!(d && d.degraded);
    TASKS.degradedReason = (d && d.reason) || '';
    TASKS.degradedHint = (d && d.hint) || '';
    if (S.tab === 'tasks' && !document.hidden) renderTasks();
    if (navSidebarSig() !== _navSig && !document.hidden) scheduleSidebar(); // T09：台账同步并入 200ms 节流；task70 F1-2：指纹未变不重建左栏；task193 方案审 P2-4：息屏（保活中轮询照跑）不重绘不可见 UI
    bgMissCheck(); // task193：断线/息屏漏事件的快照补响检查
    if (TASKS.pendForce){ TASKS.pendForce = false; loadTaskLedger(true); return } /* task262 P1-2：合并的强拉立即补 */
    if (force && !recheck){ setTimeout(function(){ loadTaskLedger(true, true) }, 1500) } /* task262 P1-2：proxy auto-reap 异步 probe（~117ms+）首拉可能仍是 running，1.5s 复核一次（两连拉封顶：recheck 拉不再续） */
  }).catch(function(){
    TASKS.loading = false; TASKS.at = Date.now();
    TASKS.pendForce = false; /* task262 产出审 P2-⑧：网络失败也复位合并标记，防残留触发下一拍无谓补拉 */
  });
}
/* 强制台账读取：不走 2s 节流、不碰 TASKS.loading；三重校验任一失败即抛错，由上层决定是否放行 */
function fetchLedgerNow(){
  return fetch('/_tasks').then(function(r){
    if (!r.ok) throw new Error('台账读取失败（HTTP ' + r.status + '）');
    return r.json();
  }).then(function(d){
    if (!d || d.ok !== true) throw new Error('台账暂不可用：' + ((d && (d.hint || d.reason)) || '未知原因'));
    if (!Array.isArray(d.tasks)) throw new Error('台账数据格式异常（tasks 非数组）');
    TASKS.at = Date.now(); TASKS.list = d.tasks;
    TASKS.etas = (d.etas && typeof d.etas === 'object') ? d.etas : {}; // task119：强刷同步 ETA 映射
    if (S.multiSel.on) renderSidebar();
    scheduleSidebar(); // task119 P1-5：ETA/超时更新无条件并入左栏节流刷新（指纹未变时零重建）
    return d.tasks;
  });
}
/* C-2：人工解锁——POST /_tasks 新 schema {sessionId, op}；成功后强刷台账并重渲染
   task119：扩 op='eta'（顺延，body 追加 etaMinutes 等 extra 字段）；eta 写入成功后强刷降级不弹假失败（P1-5②） */
function markLedgerState(sessionId, op, extra?){
  var label = op === 'interrupt' ? '中断' : (op === 'reopen' ? '恢复' : (op === 'eta' ? '顺延' : '完成'));
  var payload = { sessionId: sessionId, op: op };
  if (extra && typeof extra === 'object') Object.keys(extra).forEach(function(k){ payload[k] = extra[k] });
  var soft = op === 'eta';
  var wrote = false;
  fetch('/_tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function(r){
      return r.json().catch(function(){ return null }).then(function(d){
        if (!r.ok || !d || d.ok !== true) throw new Error((d && (d.error || d.hint || d.reason)) || ('HTTP ' + r.status));
      });
    })
    .then(function(){
      if (op === 'eta') toast('已顺延 10 分钟（从现在起重新计时）');
      wrote = true;
      return fetchLedgerNow();
    })
    .then(function(){
      if (S.tab === 'tasks') renderTasks();
      if (S.multiSel.on) renderSidebar();
    })
    .catch(function(e){
      var msg = (e && e.message) || String(e);
      if (msg === 'session not found') msg = '该会话已不在台账里（可能已被删除）';
      if (soft && wrote) { toast('顺延已生效，界面刷新稍后自动完成', true); return }
      alert('标记' + label + '失败：' + msg);
    });
}
// serve 回执形态：completed+<task state=running> 视为仍在执行，归回 running
function taskReceiptState(st){
  var output = String((st && st.output) || '');
  var m = output.match(/^<task\s+id="[^"]+"\s+state="(running|queued|pending)"/);
  return m ? m[1] : '';
}
// task152：把父会话消息里的完成注入（<task id="…" state="completed">）登记为子任务终局，
// 供 collectLiveTasks 立即收口。刷新/切换会话后仍有效（正证据来自历史消息，不依赖内存事件）。
function noteTaskCompletions(msgs){
  var hit = 0;
  (msgs || []).forEach(function(m){
    (m.parts || []).forEach(function(pt){
      if (!pt || pt.type !== 'text' || typeof pt.text !== 'string') return;
      if (pt.text.indexOf('<task id="ses_') !== 0) return;
      var re = /<task id="(ses_[A-Za-z0-9]+)"[^>]*state="completed"/g, mm;
      while ((mm = re.exec(pt.text))){
        if (!S_ENDED[mm[1]]){ S_ENDED[mm[1]] = 1; hit++ }
      }
    });
  });
  return hit;
}
function collectLiveTasks(){
  var out = [];
  (S.lastMsgs || []).forEach(function(m){
    if ((m.info || {}).role !== 'assistant') return;
    (m.parts || []).forEach(function(p){
      if (p.type !== 'tool' || p.tool !== 'task') return;
      var st = p.state || {}, meta = st.metadata || {};
      var sid = meta.sessionId || '';
      var rawStatus = st.status || 'running';
      var receipt = taskReceiptState(st);
      var started = (st.time && Number(st.time.start)) || 0;
      var ended = (st.time && Number(st.time.end)) || 0;
      /* task78 §4.1：结束事件 + 回执年龄双闸，避免「completed + running 回执」被永久当在跑 */
      var dead = !!S_ENDED[sid];
      var receiptAge = Date.now() - (ended || started || 0);
      var staleReceipt = rawStatus === 'completed' && receipt && receiptAge > CHILD_STALE_MS;
      out.push({
        key: 'live:' + (sid || p.callID || p.id || out.length),
        title: st.title || (st.input && st.input.description) || '任务',
        state: dead || staleReceipt
          ? 'done'
          : ((rawStatus === 'completed' && receipt) || rawStatus === 'queued' || rawStatus === 'pending'
            ? 'running'
            : (rawStatus === 'error' ? 'failed' : (rawStatus === 'running' ? 'running' : 'done'))),
        ended: dead || staleReceipt,
        phase: rawStatus === 'completed' && receipt ? '后台执行中（受理回执）' : (rawStatus === 'running' ? '子代理执行中' : ''),
        progress: '', artifacts: [], sid: sid, live: true,
        ownerSid: S._lastMsgsSid || (S.current && S.current.id) || '', /* task152：归属=消息来源会话，不按当前会话 */
        updated: ended || started || 0,
        elapsed: rawStatus === 'running' && started ? Date.now() - started : 0,
        stale: 'active', /* task54 疑点⑤：live 单元 stale 归一为 active（仅展示/计数对齐，真值仍是 live 状态） */
        staleMinutes: null
      });
    });
  });
  return out;
}
/* task54：任务口径单一判定——以服务端 derive 的 inTask（step>0 且未归档）为准；
   缺字段的旧台账按同一条规则回落（严禁混入 state），保证 step=0 纯聊天不入任务单元 */
function ledgerInTask(t){
  if (!t) return false;
  /* task254：排队/开工标记行入面板——queued 根会话（step=0、inTask=false）与「亲自做」taskRunning 行也要可见；
     task334 P2-5：waiting（op=hold 显式等待中）同入——侧栏有等待中、板上无卡＝「对话框消失」变体 */
  if (t.state === 'queued' || (t.state === 'waiting' && t.stale !== 'archived') || t.taskRunning) return true;
  if (typeof t.inTask === 'boolean') return t.inTask;
  return Number(t.step) > 0 && t.stale !== 'archived';
}
/* task54：静默超时且无实时真值 = 疑似中断（已结束的不再改写，终态优先） */
/* task162：task156 遗留的四态文案薄转调函数业务零引用（仅自测自嗨），按「退役语义零引用」删除 */
window.TASKS=TASKS; window.TASK_ACTIVE_STATES=TASK_ACTIVE_STATES; window.showPermission=showPermission; window.respond=respond; window.ledgerActiveSids=ledgerActiveSids; window.liveRunningSids=liveRunningSids; window.lockHint=lockHint; window.isSessionLocked=isSessionLocked; window.fmtDur=fmtDur; window.fmtAgo=fmtAgo; window.loadTaskLedger=loadTaskLedger; window.fetchLedgerNow=fetchLedgerNow; window.markLedgerState=markLedgerState; window.taskReceiptState=taskReceiptState; window.noteTaskCompletions=noteTaskCompletions; window.collectLiveTasks=collectLiveTasks; window.ledgerInTask=ledgerInTask;

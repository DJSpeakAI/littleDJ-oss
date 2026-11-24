/* @module queue @order 18 @职责 队列/滚动/停止/计费统计 @提供 Q_POLL_MS Q_TIMER Q_WARNED Q_COUNT Q_SEND_AT Q_SEND_TXT Q_NEXT_AT Q_ELAPSED_T Q_RENDER_FP STOP_OPTS_HTML _stopAllP _stopAllDoneAt _stickBottom _suppressScroll _lastScrollTop _scrollSaveTimer queueNowSid queueStopPoll queueStartPoll queueFetch queueLoad queueWitness queueForce queueElapsedStart queueRender queueAccepted queueFull queueRemoveItem queueClear queuePause queueResume queueOnIdle openStopModal stopAll markBusy atBottom nearBottom syncScrollBtn syncScrollBtnPos lastUserMsgEl scrollToLastAsk scrollBottom followBottom onMessagesScroll restoreScroll saveScrollPos getContextK getModelCtx ctxLevel isButlerSession turnStatsOf updateTurnStats updateUsage @依赖 - @依赖运行期 S toast fmtTime clearPending restoreDraft toggleBusyUI openModal closeModal stopTask scheduleSidebar modelBilling setCtxUsageLevel ctxThreshold fmtTok @DOM契约 - @严格模式 是 @全局占用 Q_POLL_MS Q_TIMER Q_WARNED Q_COUNT Q_SEND_AT Q_SEND_TXT Q_NEXT_AT Q_ELAPSED_T Q_RENDER_FP STOP_OPTS_HTML _stopAllP _stopAllDoneAt _stickBottom _suppressScroll _lastScrollTop _scrollSaveTimer queueNowSid queueStopPoll queueStartPoll queueFetch queueLoad queueWitness queueForce queueElapsedStart queueRender queueAccepted queueFull queueRemoveItem queueClear queuePause queueResume queueOnIdle openStopModal stopAll markBusy atBottom nearBottom syncScrollBtn syncScrollBtnPos lastUserMsgEl scrollToLastAsk scrollBottom followBottom onMessagesScroll restoreScroll saveScrollPos getContextK getModelCtx ctxLevel isButlerSession turnStatsOf updateTurnStats updateUsage @源行 ui/index.html L4697-L5212 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 消息队列条（task80 S2b） ----------
   队列唯一真相源在 proxy（/_queue）；本段只做「读渲染 + 入队回执 + 撤销/清空/暂停/继续」。
   红线：本段任何路径都不中止当前轮 —— 连发只进队列，绝不打断正在生成的回复。 */
var Q_POLL_MS = 3000;   /* 有排队时 3s 刷一次；count=0 立即停表 */
var Q_TIMER = null;     /* 轮询定时器：切会话 count=0 / 页面隐藏 / 无会话时 clearInterval */
var Q_WARNED = '';      /* 已提示过的 warn 文本，坏档提示只弹一次 */
var Q_COUNT = 0;        /* 最近一次渲染的条数（清空确认文案用） */
var Q_SEND_AT = 0, Q_SEND_TXT = ''; /* send() 500ms 同文本防抖 */
var Q_NEXT_AT = {};     /* 会话级出队触发节流（message.updated 会多次到达） */
var Q_ELAPSED_T = null; /* task124：已等计时器句柄（只写 textContent，绝不触发 queueRender/queueLoad） */
var Q_RENDER_FP = '';   /* task124：最近一次渲染 payload 指纹（相同跳重建，消 3s 闪变与按钮 loading 被吞） */

function queueNowSid(): string{ return (S.current && S.current.id) ? S.current.id : '' }
function queueStopPoll(): void{
  if (Q_TIMER){ clearInterval(Q_TIMER); Q_TIMER = null }
  if (Q_ELAPSED_T){ clearInterval(Q_ELAPSED_T); Q_ELAPSED_T = null } /* task124：计时器唯一清点 */
}
function queueStartPoll(count?: number): void{
  if (!count){ queueStopPoll(); return }
  if (Q_TIMER) return;
  Q_TIMER = setInterval(function(){
    var sid = queueNowSid();
    if (!sid || document.hidden) return;
    queueLoad(sid);
  }, Q_POLL_MS);
}
function queueFetch(p: string, opt?: any){
  opt = opt || {};
  var o: any = { method: opt.method || 'GET', headers: {} };
  if (opt.body !== undefined){ o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opt.body) }
  return fetch(p, o).then(function(r){
    return r.text().then(function(t){
      var d = null; try { d = JSON.parse(t || '{}') } catch(e){}
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + String(t || '').slice(0, 160));
      return d || {};
    });
  });
}
function queueLoad(sid?: string){
  sid = sid || queueNowSid();
  if (!sid){
    var b0 = $('#queueBar');
    if (b0){ b0.hidden = true; b0.replaceChildren() } /* 产出审 P2-7：无会话分支同步清 DOM 与指纹，防回前台指纹命中保持隐藏 */
    Q_RENDER_FP = '';
    queueStopPoll(); return Promise.resolve()
  }
  return queueFetch('/_queue?session=' + encodeURIComponent(sid)).then(function(d){
    if (!S.current || S.current.id !== sid) return; /* 切走了：晚到响应丢弃，绝不错渲染到别的会话 */
    if (d && d.busy && d.busyEpoch) S.lastBusyEpoch[sid] = d.busyEpoch; /* task124：证人携带的忙纪元 */
    queueRender(d);
  }).catch(function(){ /* 网络抖动静默；下一轮轮询自愈 */ });
}
/* task124 F1″：run 级 idle 的独立证人——前端 SSE 亲见 session.idle 时携带后端忙纪元上报；
   CAS 幂等故不设节流（节流反而重新引入吞证人风险）；失败静默（TTL 与轮询兜底） */
function queueWitness(sid: string){
  if (!sid) return;
  queueFetch('/_queue/next', { method: 'POST', body: { session: sid, sawIdle: true, epoch: S.lastBusyEpoch[sid] || 0 } })
    .then(function(){ queueLoad(sid) })
    .catch(function(){ /* 证人失败不打扰：TTL 与 3s 轮询兜底 */ });
}
/* task124 F2″：主人逃生门——confirm 二次确认（措辞按终审 Q2），分因 toast；409=paused 由 catch 兜；
   产出审 P1-3：点击即禁用至回执（防连点取消刚启动的回合） */
function queueForce(): void{
  var sid = queueNowSid(); if (!sid) return;
  if (!confirm('强制发送会取消当前仍在跑的回合，后台子代理任务也会一起停止。仍要发送？')) return;
  var btn = document.querySelector<HTMLButtonElement>('.queuebar .qforce');
  if (btn){ btn.disabled = true; btn.textContent = '发送中…' }
  var done = function(){ if (btn && btn.isConnected){ btn.disabled = false; btn.textContent = '立即发送' } };
  queueFetch('/_queue/force', { method: 'POST', body: { session: sid } })
    .then(function(d){
      if (d && d.started) toast('已强制发送（当前回合已被取消）', false);
      else if (d && d.dispatching) toast('正在发送中，稍候', false);
      else if (d && d.empty) toast('队列已空，无需发送', false);
      else if (d && d.inflight) toast('首条已在发送中', false);
      else toast('已尝试发送', false);
      queueLoad(sid);
    })
    .catch(function(e){
      if (String(e && e.message).indexOf('409') >= 0) toast('队列已暂停，先点「继续」', true);
      else toast('发送失败：' + (e && e.message), true);
    })
    .then(done); /* 回执后恢复按钮（重渲染会自然重建，此处兜 409/失败时不重建的路径 */
}
/* task124：已等计时器——只写单一 textContent 节点（现取现写，绝不调 queueRender/queueLoad）；
   tick 自校验 sid 与条件，失效即自杀清句柄 */
function queueElapsedStart(sid: string, baseAt?: number): void{
  if (Q_ELAPSED_T){ clearInterval(Q_ELAPSED_T); Q_ELAPSED_T = null }
  var started = Date.now();
  var base = baseAt || started; /* P2-2：兜底在调用点取定值；此处只算一次，tick 内不重取 */
  var render = function(){
    var node = $('#qElapsed');
    var ok = node && queueNowSid() === sid && S.busyBy[sid];
    if (!ok){ if (Q_ELAPSED_T){ clearInterval(Q_ELAPSED_T); Q_ELAPSED_T = null } return }
    node.textContent = ' · 等 ' + Math.max(0, Math.floor((Date.now() - base) / 1000)) + 's';
  };
  render();
  Q_ELAPSED_T = setInterval(render, 1000);
}
function queueRender(d: any): void{
  var bar = $('#queueBar'); if (!bar) return;
  var items = (d && d.items) || [];
  var paused = !!(d && d.paused);
  var count = items.length;
  var sid = (d && d.session) || queueNowSid();
  Q_COUNT = count;
  if (d && d.warn && d.warn !== Q_WARNED){ Q_WARNED = d.warn; toast('排队记录异常：' + d.warn, true, 5000) }
  /* task134：在途回合被 serve 重启打断——新纪元 toast 一次（放空队列 early-return 之前，打断时刻队列往往为空）；
     tk 归零只静默复位登记，绝不反向误报 */
  var tk = (d && d.turnInterrupt) || 0;
  if (tk && tk !== (S.lastTurnKilled[sid] || 0)){
    S.lastTurnKilled[sid] = tk;
    S.busyBy[sid] = false; /* task134：打断通知即撤销本页等待态（输入框不再锁、气泡不再转圈） */
    toast('⚠️ 刚才那条回复被 serve 重启打断（未送达）——请重新发送', true, 6000);
  } else if (!tk && S.lastTurnKilled[sid]){ S.lastTurnKilled[sid] = 0 }
  if (!count && !paused){
    bar.hidden = true; bar.replaceChildren(); Q_RENDER_FP = '';
    /* task134：打断场景队列往往为空（旧版此处直接停表 → 永远轮询不到 turnInterrupt）。
       本页仍自认在等待回复则保持 3s 轮询，直到上面检测块发现打断清 S.busyBy 后自然停表。 */
    if (S.busyBy[sid]) queueStartPoll(1); else queueStopPoll();
    return
  }
  var head = el('div', 'qhead');
  /* 折叠态只写「排队中 N 条」；展开态后缀提示可点收起 */
  var qttl = el('div', 'qtitle', '排队中 ' + count + ' 条' + (S.queueOpen ? ' · 收起' : ''));
  qttl.title = S.queueOpen ? '点击收起' : '点击展开逐条操作';
  qttl.onclick = function(){ S.queueOpen = !S.queueOpen; Q_RENDER_FP = ''; queueRender(d) };
  head.appendChild(qttl);
  /* task124：等待态判定（paused 优先；读后端 payload.busy 为等待真相，前端 S.busyBy 为独立第二信号）
     矛盾态主判据=纪元同代（前端 idle 时快照的忙纪元==当前忙纪元 → proxy 漏收该代 idle，纯纪元比较不涉跨进程时钟）；
     兜底=本页无纪元快照（idleEpoch=0，页面刚开/旧代）且忙龄≥5s（时钟仅在此兜底参与） */
  var busy = !!(d && d.busy);
  var feBusy = !!(sid && S.busyBy[sid]);
  var busyAt = (d && d.busyAt) || 0;
  var busyEpoch = (d && d.busyEpoch) || 0;
  var conflict = busy && !feBusy && S.busyReady[sid] &&
    ((busyEpoch && busyEpoch === (S.idleEpoch[sid] || -1)) ||
     (!(S.idleEpoch[sid] || 0) && busyAt && Date.now() - busyAt >= 5000));
  /* task124（产出审 P1-1）：派生模式入指纹——前端态（busyBy/busyReady/idleEpoch）变化必触发重绘，
     否则中性等待永不升级 / 矛盾态按钮永不出现（逃生门不可达）/ 回前台计时器不重建
     task133（枢机 P1-2）：serveDown 入指纹——「bar 已渲染 + 宕机置位」场景指纹不命中则标题永不切换 */
  var serveDown = !!(d && d.serveDown);
  var mode = paused ? 'paused' : conflict ? 'conflict' : serveDown ? 'servedown' : (busy && feBusy) ? 'healthy' : busy ? 'neutral' : 'plain';
  /* task153（主人报「队列条自己复制堆叠」根因二）：旧指纹含 busyAt/busyEpoch——busyAt 每次 SSE 事件都被
     后端 queueBusy[sid]=Date.now() 刷新，3s 轮询必然指纹不命中 → 每轮都走重建；而重建路径只 appendChild。
     指纹只留「肉眼可分辨的状态」，繁忙细节已由 mode 表达（plain/neutral/healthy/conflict）。sid 入指纹防跨会话误命中。 */
  var fp = JSON.stringify([sid, mode, count, paused, S.queueOpen ? 1 : 0,
    items.map(function(it){ return it.id + ':' + it.state }),
    serveDown ? 1 : 0]);
  if (fp === Q_RENDER_FP && bar.children.length){
    /* 指纹命中但计时器缺失（回前台/升级后）且仍是健康等待 → 补启动（不重建条） */
    if (mode === 'healthy' && !Q_ELAPSED_T && bar.querySelector('#qElapsed')){
      queueElapsedStart(sid, items.length ? items[0].at : Date.now()) /* P2-2：兜底取定值，tick 内不重取 */
    }
    queueStartPoll(count); return
  }
  Q_RENDER_FP = fp;
  /* task153（根因一）：重建前必须清空旧 DOM——本函数原只有空队列分支清 innerHTML，重建分支纯追加，
     任何一次指纹变化都会在旧内容后再追加一份 head/items/foot → 「排队中 1 条」重复堆叠。
     同时收口已等计时器，防旧 interval 持续写已废弃节点。 */
  if (Q_ELAPSED_T){ clearInterval(Q_ELAPSED_T); Q_ELAPSED_T = null }
  bar.replaceChildren();
  bar.hidden = false; /* 2026-11-08 主人报「排队条看不见」：本函数只有空队列置 hidden，缺开启分支 → 补 */
  if (serveDown && !paused){
    /* task133：宕机排队——serve 连不上，恢复后自动按序发送（删除/清空/暂停照常可用） */
    head.appendChild(el('span', 'qtag', '⚠ 服务未连接'));
    head.appendChild(el('span', 'qat', '恢复后自动发送'));
  } else if (busy && !paused){
    if (conflict){
      head.appendChild(el('span', 'qtag', '等待回复收尾（可能已结束）'));
      var fb = el('button', 'danger qforce', '立即发送');
      fb.title = '跳过等待，立即发送队头消息（会取消当前回合）';
      fb.onclick = function(){ queueForce() };
      head.appendChild(fb);
    } else if (feBusy){
      var qe = el('span', 'qelapsed', '');
      qe.id = 'qElapsed';
      qe.style.fontVariantNumeric = 'tabular-nums';
      qe.style.minWidth = '4.5em';
      qe.style.display = 'inline-block';
      head.appendChild(qe);
      queueElapsedStart(sid, items.length ? items[0].at : Date.now()); /* 基准=最早在队消息入队时刻（主诉口径）；空队取定值 */
    } else {
      /* 中性等待：忙闲守卫未齐（页面刚开/inferBusy 未定），只说明不出按钮，3s 内自然升级 */
      head.appendChild(el('span', 'qtag', '等待回复收尾'));
    }
  }
  if (paused){ head.appendChild(el('span', 'qtag', '已暂停')); head.appendChild(el('span', 'qat', '出队已挂起')) }
  else if (!busy && !serveDown) head.appendChild(el('span', 'qat', '按顺序发送')); /* task133：宕机态已标「恢复后自动发送」不重复 */
  bar.appendChild(head);
  if (S.queueOpen && count){
    items.forEach(function(it){
      var row = el('div', 'qitem');
      var txt = String(it.echo || '（非文本消息）');
      if (txt.length > 40) txt = txt.slice(0, 40) + '…'; /* 短摘要：40 字截断 + 省略号 */
      row.appendChild(el('span', 'qtxt', txt));
      if (it.state === 'inflight'){
        /* task124：投喂在途行——「发送中」且不给 ×（已不可撤销，防死按钮） */
        row.appendChild(el('span', 'qtag', '发送中'));
        row.appendChild(el('span', 'qat', fmtTime(it.at)));
      } else {
        row.appendChild(el('span', 'qat', fmtTime(it.at)));
        var x = el('button', 'qx', '×');
        x.title = '撤销这条';
        x.onclick = function(){ queueRemoveItem(it.id) };
        row.appendChild(x);
      }
      bar.appendChild(row);
    });
  }
  var foot = el('div', 'qfoot');
  if (paused){
    var rs = el('button', null, '已暂停 · 继续');
    rs.onclick = function(){ queueResume() };
    foot.appendChild(rs);
  } else if (count){
    var ps = el('button', null, '暂停出队');
    ps.title = '挂起队列派发，不打断当前轮';
    ps.onclick = function(){ queuePause() };
    foot.appendChild(ps);
  }
  var cl = el('button', 'danger', '清空队列');
  cl.onclick = function(){ queueClear() };
  foot.appendChild(cl);
  bar.appendChild(foot);
  queueStartPoll(count);
}
function queueAccepted(sid: string, localId: string, d: any): void{
  /* 202：已入队 → 撤掉本地 pending 气泡（不算发送失败）；输入框在 send() 已清空，这里不二次触碰 */
  var node = $('#messages').querySelector('[data-mid="' + localId + '"]');
  if (node) node.remove();
  clearPending(sid);
  if (d && d.serveDown) toast('服务未连接，已排队（第 ' + (d.position || (d.count || 0)) + ' 条），恢复后自动发送', false, 3600); /* task133 */
  else if (d && d.deduped) toast('已在队列中（共 ' + (d.count || 0) + ' 条）', false, 2600);
  else toast('已排队（第 ' + (d.position || (d.count || 0)) + ' 条）', false, 2600);
  queueLoad(sid);
}
function queueFull(sid: string, localId: string, d: any): void{
  /* 409 queue_full：撤掉本地气泡，把原文退回输入框，不动队列 */
  var node = $('#messages').querySelector('[data-mid="' + localId + '"]');
  if (node) node.remove();
  restoreDraft(sid); /* 输入框为空时回填 p.text 原文 */
  clearPending(sid);
  if (S.current && S.current.id === sid){ S.busy = !!S.busyBy[sid]; toggleBusyUI() }
  toast('队列已满（' + ((d && d.count) || 10) + ' 条），先等一会儿', true, 3200);
}
function queueRemoveItem(id: string): void{
  var sid = queueNowSid(); if (!sid || !id) return;
  queueFetch('/_queue?session=' + encodeURIComponent(sid) + '&id=' + encodeURIComponent(id), { method: 'DELETE' })
    .then(function(){ queueLoad(sid) })
    .catch(function(e){ toast('撤销失败：' + e.message, true) });
}
function queueClear(): void{
  var sid = queueNowSid(); if (!sid) return;
  if (!confirm('清空' + (Q_COUNT ? ' ' + Q_COUNT + ' 条' : '') + '排队消息？清空后不可恢复。')) return;
  queueFetch('/_queue?session=' + encodeURIComponent(sid) + '&all=1', { method: 'DELETE' })
    .then(function(){ queueLoad(sid) })
    .catch(function(e){ toast('清空失败：' + e.message, true) });
}
function queuePause(): void{
  var sid = queueNowSid(); if (!sid) return;
  queueFetch('/_queue/pause', { method: 'POST', body: { session: sid } })
    .then(function(){ queueLoad(sid) })
    .catch(function(e){ toast('暂停失败：' + e.message, true) });
}
function queueResume(): void{
  var sid = queueNowSid(); if (!sid) return;
  queueFetch('/_queue/resume', { method: 'POST', body: { session: sid } })
    .then(function(){ queueLoad(sid) })
    .catch(function(e){ toast('继续失败：' + e.message, true) });
}
function queueOnIdle(sid: string): void{
  /* 出队触发：session.idle / assistant time.completed 后通知 proxy 投喂队头（proxy 侧幂等） */
  if (!sid) return;
  var now = Date.now();
  if (now - (Q_NEXT_AT[sid] || 0) < 800) return;
  Q_NEXT_AT[sid] = now;
  queueFetch('/_queue/next', { method: 'POST', body: { session: sid } })
    .then(function(){ queueLoad(sid) })
    .catch(function(){ /* 出队失败不打扰：proxy 定时器与下一轮 idle 会兜底 */ });
}
/* ---------- 停止任务两步确认（task79 S2b） ----------
   默认选中「停止当前对话」；「停止全部任务」永不默认选中（警示色） */
var STOP_OPTS_HTML =
  '<div class="stopopts">' +
    '<div class="stopopt on" data-stop-opt="cur">' +
      '<input type="radio" name="stopOpt" value="cur" checked>' +
      '<b>停止当前对话</b><span>仅停止当前对话正在生成的内容</span>' +
    '</div>' +
    '<div class="stopopt warn" data-stop-opt="all">' +
      '<input type="radio" name="stopOpt" value="all">' +
      '<b>停止全部任务</b><span>停止全部在途子代理任务（含小管家、枢机、执笔、御史）</span>' +
    '</div>' +
  '</div>';
function openStopModal(): void{
  openModal('停止任务', STOP_OPTS_HTML, function(){
    var sel = document.querySelector<HTMLInputElement>('input[name="stopOpt"]:checked');
    var v = sel ? sel.value : 'cur';
    closeModal(); /* 先关窗再执行，避免慢请求把弹窗挂住 */
    if (v === 'all') stopAll(); else stopTask();
  });
  $$('.stopopt').forEach(function(el){
    var inp = el.querySelector('input');
    if (!inp) return;
    inp.onchange = function(){
      $$('.stopopt').forEach(function(x){
        var i2 = x.querySelector('input');
        x.classList.toggle('on', !!(i2 && i2.checked));
      });
    };
  });
  $('#modalCancel').focus(); /* Enter 默认=取消 */
}
/* 停止全部任务（前端编排；服务端 POST /api/_tasks/abort-all 已在 S2a 落地） */
var _stopAllP = null, _stopAllDoneAt = 0;
function stopAll(): void{
  if (_stopAllP) return;                                              /* 在途未决：不重复请求/不重复 toast */
  if (_stopAllDoneAt && Date.now() - _stopAllDoneAt < 2000) return;    /* 2s 内不重复 */
  toast('正在停止全部任务…', false, 120000); /* 即时反馈，批次结果 toast / 失败 toast 自然覆盖 */
  var sid = (S.current && S.current.id) || '';
  var headers = { 'Content-Type': 'application/json' };
  if (sid) headers['x-session-id'] = sid; /* 防自噬：服务端会剔除调用方自身会话 */
  _stopAllP = fetch('/api/_tasks/abort-all', { method: 'POST', headers: headers, body: JSON.stringify({ trigger: 'ui' }) })
    .then(function(r){
      if (!r.ok) return r.text().then(function(t){ throw new Error('HTTP ' + r.status + ' ' + String(t || '').slice(0, 200)) });
      return r.json();
    })
    .then(function(d){
      if (!d || d.ok !== true){
        toast('停止全部任务失败：' + String((d && (d.reason || d.error || d.hint)) || '服务端未执行'), true, 5000);
        return;
      }
      var rs = d.results || [];
      var n = (typeof d.attempted === 'number') ? d.attempted : rs.length;
      var okN = 0, alN = 0, badN = 0;
      rs.forEach(function(x){
        if (x && x.result === 'aborted') okN++;
        else if (x && x.result === 'already-finished') alN++;
        else badN++;
      });
      toast('已停止全部任务：子代理 ' + n + ' 个（成功 ' + okN + ' · 已结束 ' + alN + ' · 失败 ' + badN + '）' +
        (badN > 0 ? ' · 失败明细见任务面板/审计' : ''), badN > 0, badN > 0 ? 6000 : 4000);
    })
    .catch(function(e){
      var m = String((e && (e.message || e)) || '网络错误').replace(/^Error:\s*/, '');
      toast('停止全部任务失败：' + m, true, 5000);
    })
    .then(function(){ _stopAllP = null; _stopAllDoneAt = Date.now() });
  /* 当前轮已被 x-session-id 从批次里排除，S.busy 时单独收尾 */
  if (S.busy) stopTask();
}
function markBusy(sessionID: string, busy: boolean): void{
  if (!sessionID || S.busyBy[sessionID] === busy) return;
  S.busyBy[sessionID] = busy;
  S.busyReady[sessionID] = true; /* task124：本会话忙闲首帧已定（SSE 事件/inferBusy 均经此），矛盾态守卫放行 */
  scheduleSidebar(); /* task70 F1-2：并入 200ms 节流，不再绕过节流直调 renderSidebar */
}
var _stickBottom = true, _suppressScroll = false, _lastScrollTop = 0;
function atBottom(box: any): boolean{ return box.scrollHeight - box.scrollTop - box.clientHeight < 40 }
function nearBottom(box: any): boolean{ return box.scrollHeight - box.scrollTop - box.clientHeight < 60 }
function syncScrollBtn(): void{
  var b = $('#messages'), btn = $('#btnScrollDown');
  if (!btn || !b) return;
  btn.classList.toggle('show', b.scrollHeight - b.scrollTop - b.clientHeight > 80);
  /* task356：↑ 只在「最近一次提问已滚出视口上沿」时出现，点了就跳回那条提问 */
  var up = $('#btnScrollUp');
  if (!up) return;
  var u = lastUserMsgEl(), show = false;
  if (u) show = (u.getBoundingClientRect().top - b.getBoundingClientRect().top) < -8;
  up.classList.toggle('show', show);
}
function lastUserMsgEl(){
  var b = $('#messages');
  if (!b) return null;
  var l = b.querySelectorAll('.msg.user');
  return l.length ? l[l.length - 1] : null;
}
function scrollToLastAsk(): void{
  var b = $('#messages'), u = lastUserMsgEl();
  if (!b || !u) return;
  _stickBottom = false;
  var top = Math.max(0, b.scrollTop + (u.getBoundingClientRect().top - b.getBoundingClientRect().top - 10)); /* L-076：rect 差值微调，禁 scrollIntoView */
  try {
    if ('scrollBehavior' in document.documentElement.style) b.scrollTo({ top: top, behavior: 'smooth' });
    else b.scrollTop = top;
  } catch (e) { b.scrollTop = top }
  syncScrollBtn();
}
function syncScrollBtnPos(): void{
  var btn = $('#btnScrollDown'), comp = $('#composer');
  if (btn && comp) btn.style.bottom = (comp.offsetHeight + 14) + 'px';
  var up = $('#btnScrollUp');
  if (up && comp) up.style.bottom = (comp.offsetHeight + 14) + 'px'; /* task356：↑ 与 ↓ 同底线并排 */
}
function scrollBottom(){ var b = $('#messages'); _stickBottom = true; b.scrollTop = b.scrollHeight; _lastScrollTop = b.scrollTop; syncScrollBtn() }
function followBottom(){ if (!_stickBottom) return; var b = $('#messages'); b.scrollTop = b.scrollHeight; _lastScrollTop = b.scrollTop; syncScrollBtn() }
function onMessagesScroll(): void{
  var b = $('#messages'), st = b.scrollTop;
  if (b.scrollHeight - st - b.clientHeight < 12) _stickBottom = true;
  else if (st < _lastScrollTop - 2) _stickBottom = false;
  _lastScrollTop = st;
  syncScrollBtn();
  saveScrollPos();
}
function restoreScroll(sess: any, target?: any, forceBottom?: boolean): void{
  var box = $('#messages');
  _suppressScroll = true;
  var apply = function(){
    if (!S.current || S.current.id !== sess.id) return;
    box.scrollTop = forceBottom ? box.scrollHeight : Math.min(target, box.scrollHeight);
    _lastScrollTop = box.scrollTop;
    _stickBottom = atBottom(box);
    syncScrollBtn();
  };
  apply();
  requestAnimationFrame(function(){
    apply();
    setTimeout(function(){ apply(); _suppressScroll = false }, 150);
  });
}
var _scrollSaveTimer = null;
function saveScrollPos(): void{
  if (_suppressScroll || !S.current) return;
  S.scrollPos[S.current.id] = $('#messages').scrollTop;
  clearTimeout(_scrollSaveTimer);
  _scrollSaveTimer = setTimeout(function(){
    try { localStorage.setItem('littledj.scrollPos2', JSON.stringify(S.scrollPos)) } catch(e){}
  }, 500);
}
function getContextK(){
  var v = Number(localStorage.getItem('littledj.contextK'));
  return v > 0 ? v : 1000;
}
// 真实上下文窗口：优先用模型自带的 limit.context，取不到才回落到设置里的兜底值
function getModelCtx(){
  var m = (S.models || []).filter(function(x){ return x.providerID === S.model.providerID && x.modelID === S.model.modelID })[0];
  return (m && m.ctx > 0) ? m.ctx : getContextK() * 1000;
}
// task96 S5a：上下文三档分级（口径见 docs/2026-11-07 上下文纪律与开工模板-task96-方案稿 §3.1/§3.2）
// 黄档下界 = min(阈值, max(10, 阈值-5))；绿 ≤ 下界；黄 下界<pct≤阈值+0.5；红 > 阈值+0.5（0.5 容差只吸收显示四舍五入）
function ctxLevel(pct, threshold){
  var th = (threshold > 0 && threshold <= 100) ? threshold : 20;
  var warnLow = Math.min(th, Math.max(10, th - 5));
  var p = Number(pct) || 0;
  if (p <= warnLow) return 'ok';
  if (p <= th + 0.5) return 'warn';
  return 'danger';
}
// 大管家主会话判定：根会话 + 不是 TUI 来源（pwa !== 0）。
// task242（主人 2026-11-12 报「建了 4 个，刷新只剩 1 个；老对话也被顶掉」）：**空会话**（一条消息都没有）
// serve 侧 updated === created，pwa 不写（未知）；旧判据 pwa === 1 把它当普通会话 → 左栏项目行把它过滤掉，
// 只有「本页新建时打过 pwa=1 补丁」和「当前打开的那条」才显示 —— 一刷新就只剩当前会话。
// 与 buildConvRow 的来源前缀口径（pwa === 0 → TUI，其余 → 大管家）保持一致。
function isButlerSession(sess: any): boolean{
  return !!(sess && !sess.parentID && sess.pwa !== 0);
}
/* ---------- 2026-11-14：输入框下方「N 轮 M 步 · xx tok/s」（口径对齐 DSH 输入框统计） ----------
   轮 = 本会话主人发言条数；步 = 本会话 assistant 回复条数（每条 = 一次模型调用）；
   tok/s = 已完成各步 output tokens 之和 ÷ 纯生成耗时之和；纯生成耗时 = 完成时刻 − 工具执行耗时 − 首个输出 part 开始时刻
   （即扣掉等首字和工具等待，只算模型真在吐字的时长）；取不到首 token 时间的旧步回落「完成 − 创建 − 工具」。
   只统计已完成的步，在跑那一步不参与，防数字乱抖；缺时间字段的旧数据如实跳过，不编数 */
function turnStatsOf(msgs){
  var turns = 0, steps = 0, outTok = 0, genMs = 0;
  (msgs || []).forEach(function(m){
    var i = m.info || {};
    if (i.role === 'user'){ turns++; return }
    if (i.role !== 'assistant') return;
    steps++;
    var t = i.tokens || {}, tm = i.time || {};
    var out = t.output || 0;
    if (!(out > 0)) return;
    if (typeof tm.created !== 'number' || typeof tm.completed !== 'number') return;
    var toolMs = 0, first = null;
    (m.parts || []).forEach(function(p){
      var st = (p && p.type === 'tool') ? p.state : null;
      if (st && st.time && typeof st.time.start === 'number' && typeof st.time.end === 'number') toolMs += Math.max(0, st.time.end - st.time.start);
      if ((p.type === 'text' || p.type === 'reasoning') && p.time && typeof p.time.start === 'number') first = (first === null || p.time.start < first) ? p.time.start : first;
    });
    var gen = first !== null ? (tm.completed - toolMs - first) : (tm.completed - tm.created - toolMs);
    if (!(gen > 0)) gen = tm.completed - tm.created - toolMs;
    if (gen > 0){ outTok += out; genMs += gen }
  });
  return { turns: turns, steps: steps, tps: genMs > 0 ? outTok / (genMs / 1000) : null };
}
function updateTurnStats(msgs: any): void{
  var n = $('#turnStats');
  if (!n) return;
  var st = turnStatsOf(msgs);
  if (!st.turns && !st.steps){ n.textContent = ''; n.title = ''; return }
  var txt = '⏱ ' + st.turns + ' 轮 ' + st.steps + ' 步';
  if (st.tps != null) txt += ' · ' + (st.tps >= 10 ? String(Math.round(st.tps)) : st.tps.toFixed(1)) + ' tok/s';
  n.textContent = txt + ' · ';
  n.title = '本会话：主人发言 ' + st.turns + ' 轮 · AI 回复 ' + st.steps + ' 步（每步 = 一次模型调用）' + (st.tps != null ? ' · 平均生成速度 ' + st.tps.toFixed(1) + ' tok/s（已扣掉等首字与工具执行耗时）' : '');
}
function updateUsage(msgs: any): void{
  S.lastMsgs = msgs || [];
  updateTurnStats(msgs);
  var u = $('#usage');
  if (!msgs || !msgs.length){
    var bk0 = modelBilling();  /* 只撤 balance 类金额；quota 的「额度 5h xx%」与 none 占位保留 */
    u.textContent = (bk0.kind !== 'balance' ? bk0.brief + ' · ' : '') + '缓存 —';
    u.title = '暂无可统计的 assistant 消息';
    S.ctxPct = 0; S.ctxUsed = 0; S.ctxWin = 0;
    setCtxUsageLevel('ok'); /* 无消息即回落绿档，红档横幅同步撤下 */
    return;
  }
  // 真实占用 = 最近一条 assistant 的 prompt tokens（input + cache.read）再加本轮输出，
  // 不是历史累计；只算 input 会漏掉命中缓存的部分，显示恒为 0%
  var used = 0, cum = 0;
  var curRead = null, cumRead = 0, seenRead = false, curPrompt = 0;  /* 本轮 / 累计缓存命中（tokens.cache.read） */
  (msgs || []).forEach(function(m){
    var i = m.info || {};
    if (i.role !== 'assistant') return;
    var t = i.tokens || {};
    var cacheRead = (t.cache && t.cache.read) || 0;
    var prompt = (t.input || 0) + cacheRead;
    if (t.cache && typeof t.cache.read === 'number'){ curRead = t.cache.read; cumRead += t.cache.read; seenRead = true; curPrompt = prompt }
    else { curRead = null }  /* 本轮取最近一条 assistant；该条缺字段即如实置空 */
    cum += t.total || (prompt + (t.output || 0) + (t.reasoning || 0));
    if (prompt > 0) used = prompt + (t.output || 0);
  });
  var win = getModelCtx();
  S.ctxPct = (used > 0 && win > 0) ? used / win * 100 : 0;
  S.ctxUsed = used; S.ctxWin = win;
  var lvl = ctxLevel(S.ctxPct, ctxThreshold());
  var parts = [];
  if (used > 0 && win > 0) parts.push('上下文 <span class="ctxp">' + (used / win * 100).toFixed(1) + '%</span>'); /* task287：只染百分比数字（「上下文」二字与整行其他项保持常规灰），主人原话「只需要这个 15.6% 变成黄色，其他的还原以前的颜色」 */
  parts.push('tokens ' + fmtTok(used || cum) + '/' + fmtTok(win));
  var bk = modelBilling();  /* 'balance'=deepseek 金额 / 'quota'=智谱额度比率 / 'none'=占位 */
  if (bk.kind !== 'balance') parts.push(bk.brief);  /* 额度比率与占位非钱，保留 */
  if (seenRead || curRead != null){
    /* task273：改命中率百分比（cache.read ÷ 本次总输入 input+cache.read），删掉绝对 tokens 与「· 累计」 */
    parts.push('缓存命中 ' + (curRead == null || !curPrompt ? '—' : Math.round(curRead / curPrompt * 100) + '%'));
  } else {
    parts.push('缓存 —');  /* 无 assistant 消息或字段全缺：缺源不编数，不显示 0 */
  }
  if (lvl === 'warn') parts.push('接近上限，建议收尾后新开');
  else if (lvl === 'danger') parts.push('已超上限，请立即新开对话');
  u.innerHTML = parts.join(' · '); /* task285：parts 均为内部生成（数字/固定文案/bk.brief），无用户输入；上下文段含 .ctxp span 故改 innerHTML */
  u.title = '当前上下文按最近一条回复的输入 tokens 计算；本会话累计消耗 ' + fmtTok(cum) + ' tokens；缓存命中率 = 最近一条 assistant 的 cache.read ÷ 本次总输入（input + cache.read）';
  setCtxUsageLevel(lvl);
}
window.Q_POLL_MS=Q_POLL_MS; window.Q_TIMER=Q_TIMER; window.Q_WARNED=Q_WARNED; window.Q_COUNT=Q_COUNT; window.Q_SEND_AT=Q_SEND_AT; window.Q_SEND_TXT=Q_SEND_TXT; window.Q_NEXT_AT=Q_NEXT_AT; window.Q_ELAPSED_T=Q_ELAPSED_T; window.Q_RENDER_FP=Q_RENDER_FP; window.STOP_OPTS_HTML=STOP_OPTS_HTML; window._stopAllP=_stopAllP; window._stopAllDoneAt=_stopAllDoneAt; window._stickBottom=_stickBottom; window._suppressScroll=_suppressScroll; window._lastScrollTop=_lastScrollTop; window._scrollSaveTimer=_scrollSaveTimer; window.queueNowSid=queueNowSid; window.queueStopPoll=queueStopPoll; window.queueStartPoll=queueStartPoll; window.queueFetch=queueFetch; window.queueLoad=queueLoad; window.queueWitness=queueWitness; window.queueForce=queueForce; window.queueElapsedStart=queueElapsedStart; window.queueRender=queueRender; window.queueAccepted=queueAccepted; window.queueFull=queueFull; window.queueRemoveItem=queueRemoveItem; window.queueClear=queueClear; window.queuePause=queuePause; window.queueResume=queueResume; window.queueOnIdle=queueOnIdle; window.openStopModal=openStopModal; window.stopAll=stopAll; window.markBusy=markBusy; window.atBottom=atBottom; window.nearBottom=nearBottom; window.syncScrollBtn=syncScrollBtn; window.syncScrollBtnPos=syncScrollBtnPos; window.scrollBottom=scrollBottom; window.followBottom=followBottom; window.onMessagesScroll=onMessagesScroll; window.restoreScroll=restoreScroll; window.saveScrollPos=saveScrollPos; window.getContextK=getContextK; window.getModelCtx=getModelCtx; window.ctxLevel=ctxLevel; window.isButlerSession=isButlerSession; window.turnStatsOf=turnStatsOf; window.updateTurnStats=updateTurnStats; window.updateUsage=updateUsage;

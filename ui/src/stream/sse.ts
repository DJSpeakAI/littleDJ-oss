/* @module sse @order 26 @职责 SSE/TUI 桥/轮询对账 @提供 sse sseDir sseRetryTimer sseRetryN sseDown sseBannerText tuiSse SSE_BANNER_ID _tkTimer _busyRecoAt _busyRecoBusy _busyRecoHold BUSY_RECO_TICK_MS BUSY_RECO_QUIET_MS BUSY_RECO_MIN_MS BUSY_RECO_MAX BUSY_RECO_HOLD_MAX connectTuiBell clearSseRetry setSseBanner syncSseBanner scheduleSseReconnect connectSSE handleEvent ensureAssistantMessage patchPartCache scheduleTasks applyPart applyDelta refreshCurrent reconcileBusySessions @依赖 - @依赖运行期 playDing getTuiSound _lastIdleAt _agentSoundAt sseAuthSelfheal toast S bgSnapTake VOICE voiceDisarm S_ENDED scheduleSidebar pwaAgentBell navTasksIsRunner markBusy navTasksTouch tryAutoNewSession renderTitle toggleBusyUI queueWitness dingRunnerIdle seenTaskIds loadTaskLedger getPwaAgentSound _pwaAgentAt kaActive notifyDing loadSessions voiceMaybeRead getDingSound fetchBalance queueOnIdle pruneThinking loadDiff showPermission showQuestion voiceReadQuestion hideQuestion renderMessage followBottom renderTasks applyAgentCard renderAgentCard nearBottom _stickBottom api _suppressScroll msgCachePut reconcilePending _lastScrollTop syncScrollBtn noteTaskCompletions buildEditCards updateUsage inferBusy restoreScroll loadPanel POP_TAB @DOM契约 - @严格模式 是 @全局占用 sse sseDir sseRetryTimer sseRetryN sseDown sseBannerText tuiSse SSE_BANNER_ID _tkTimer _busyRecoAt _busyRecoBusy _busyRecoHold BUSY_RECO_TICK_MS BUSY_RECO_QUIET_MS BUSY_RECO_MIN_MS BUSY_RECO_MAX BUSY_RECO_HOLD_MAX connectTuiBell clearSseRetry setSseBanner syncSseBanner scheduleSseReconnect connectSSE handleEvent ensureAssistantMessage patchPartCache scheduleTasks applyPart applyDelta refreshCurrent reconcileBusySessions @源行 ui/index.html L6703-L7133 @测试锚点 - @被调用 - */
'use strict';
/* ---------- SSE ---------- */
var sse = null, sseDir = null;
var sseRetryTimer = null, sseRetryN = 0, sseDown = false, sseBannerText = '';

/* ---------- TUI 提示音桥：收 proxy 广播（/_tui/event），TUI 完成/提问/报错时放音 ---------- */
var tuiSse = null;
function connectTuiBell(){
  if (tuiSse) return;
  try { tuiSse = new EventSource('/_tui/event') } catch(e){ return }
  tuiSse.addEventListener('bell', function(ev){
    var d; try { d = JSON.parse(ev.data) } catch(e){ return }
    if (d.kind === 'ask') playDing(getTuiSound('ask'));
    else if (d.kind === 'error') playDing(getTuiSound('error'));
    else if (d.kind === 'agent'){ /* task97 D2：紧跟目录级 idle（<1.5s）或 PWA 自身刚响过（<1.5s）则只跳本次铃，不 return */ if (Date.now() - _lastIdleAt >= 1500 && Date.now() - _agentSoundAt >= 1500) playDing(getTuiSound('agent')); }
    else { /* task97 D2：紧跟目录级 idle（<1.5s）的完成铃去重，只跳本次铃，不 return */ if (Date.now() - _lastIdleAt >= 1500) playDing(getTuiSound('done')); }
  });
  tuiSse.onerror = function(){
    sseAuthSelfheal(); /* task295：吊销/过期断流自愈（401→回登录卡片） */
    if (tuiSse && tuiSse.readyState === 2){
      // CLOSED：浏览器不再自动重连，退避 20s 重建（CONNECTING 态交给浏览器自动重连）
      try { tuiSse.close() } catch(e){}
      tuiSse = null;
      setTimeout(connectTuiBell, 20000);
    }
  };
}
var SSE_BANNER_ID = 'sseOfflineBanner';

// 定时器收口：任何新建连接 / 再次断开 / 恢复 / 页面卸载都先清掉旧的手动重连计时器
function clearSseRetry(){ if (sseRetryTimer){ clearTimeout(sseRetryTimer); sseRetryTimer = null } }

// 断流横幅：固定 id，先查后插/改文本，绝不重复叠加
function setSseBanner(text){
  sseDown = !!text; sseBannerText = text || '';
  var box = $('#messages');
  if (!box) return;
  var b = document.getElementById(SSE_BANNER_ID);
  if (!text){ if (b) b.remove(); return }
  if (!b){
    b = document.createElement('div');
    b.id = SSE_BANNER_ID;
    b.setAttribute('role', 'status');
    b.style.cssText = 'position:sticky;top:0;z-index:5;margin:8px 12px;padding:8px 12px;border-radius:8px;background:#5a3a12;color:#ffd58a;font-size:13px;line-height:1.5;';
    box.insertBefore(b, box.firstChild);
  }
  if (b.textContent !== text) b.textContent = text;
}
// 消息区被整块重绘后把仍在断流中的横幅补回去
function syncSseBanner(){ if (sseDown) setSseBanner(sseBannerText) }

/* task248（主人 2026-11-12「这个按钮删除吧 好难看啊」）：task241 的「界面已更新 · 刷新 / ×」提示条整体退役
   ——连 task135/169 的 bootId|uiRev 握手一起删（不提示、不自动刷新；刷新由主人自己按浏览器刷新）。
   _health 的 uiRev/bootId 字段是 proxy 既有能力，本单不动。 */

// 浏览器已彻底关闭连接（readyState 2）时的退避手动重连
function scheduleSseReconnect(dir){
  if (!dir) return;
  clearSseRetry();
  var n = sseRetryN;
  var delay = Math.min(1000 * Math.pow(2, n), 30000);
  setSseBanner('⚠ 重连失败，' + Math.round(delay / 1000) + 's 后第 ' + (n + 1) + ' 次重试');
  sseRetryTimer = setTimeout(function(){
    sseRetryTimer = null;
    sseRetryN = n + 1;
    connectSSE(dir);
  }, delay);
}

function connectSSE(dir){
  if (!dir) return;
  if (sse && sseDir === dir) return;
  clearSseRetry();
  if (sse){ try { sse.close() } catch(e){} }
  sseDir = dir;
  sse = new EventSource('/api/event?directory=' + encodeURIComponent(dir));
  sse.onmessage = function(ev){
    var d; try { d = JSON.parse(ev.data) } catch(e){ return }
    handleEvent(d);
  };
  sse.onopen = function(){
    var wasDown = sseDown;
    clearSseRetry();
    sseRetryN = 0;
    setSseBanner('');
    // 只在「断开 → 恢复」边沿提示一次
    if (wasDown) toast('实时连接已恢复');
    // 断线重连自愈：serve 崩溃重启后卡死的 busy 由 refreshCurrent + inferBusy 僵尸判定解除
    if (S.current && S.busyBy[S.current.id]) refreshCurrent();
    _busyRecoAt = {}; /* task307：断流窗口最易漏 idle——重连后清核对窗，立即补核全部挂圈会话 */
    setTimeout(reconcileBusySessions, 1200);
  };
  sse.onerror = function(){
    bgSnapTake(); /* task193：断开瞬间快照在跑任务，恢复期间由轮询/唤醒后补响兜底 */
    sseAuthSelfheal(); /* task295：吊销/过期断流自愈（401→关 SSE+回登录卡片，防 3s 重连风暴） */
    var rs = sse ? sse.readyState : 2;
    if (rs === 0){
      // CONNECTING：浏览器自己在重连，这里只提示，不再自建连接
      clearSseRetry();
      setSseBanner('⚠ 实时连接已断开，自动重连中…');
      return;
    }
    if (rs === 2){
      // CLOSED：浏览器不再自动重连，交给退避手动重连
      var dir2 = sseDir;
      try { if (sse) sse.close() } catch(e){}
      sse = null; sseDir = null;
      if (VOICE.armed){ voiceDisarm(true); toast('实时连接断开，语音自动朗读已取消（御史 P1-3）', true) } /* 断流窗口丢 idle 事件的兜底 */
      scheduleSseReconnect(dir2);
      return;
    }
    // 其他状态：只按断开提示，不重复建连
    clearSseRetry();
    setSseBanner('⚠ 实时连接已断开，自动重连中…');
  };
}
function handleEvent(d){
  if (!d || !d.type) return;
  var p = d.properties || {};
  // 只有当前会话（或无归属的全局事件）才刷新活跃时间；目录下其他会话的事件不能掩盖本会话卡住
  var evSid = p.sessionID || (p.info && p.info.sessionID) || (d.type === 'session.updated' && p.info && p.info.id) || '';
  if (!evSid || !S.current || evSid === S.current.id) S.lastAct = Date.now();
  if (evSid) S.busyEvAt[evSid] = Date.now(); /* task307：事件新鲜度——有事件就不做消息级对账 */
  /* task78 §4.3：子会话结束提示（必须在 runner 拦截块之前，否则 session.idle 被 return 吞掉） */
  if (evSid && d.type === 'session.idle'){ S_ENDED[evSid] = 1; _lastIdleAt = Date.now(); scheduleSidebar(); } /* task97 D1：目录级 idle 时刻，供 TUI 桥铃去重；task262：S_ENDED 置位必须伴随重绘——busyBy 已 false 时 markBusy 幂等闸会吞掉其内部 scheduleSidebar，此事件路径再无别的重绘钩子，缺这行标签要等 10s 轮询（主人主诉「叮咚秒响、执行中标签不瞬时切已完成」根因，方案审 P1-1/产出审 P1-3：指纹经 taskModel u.ended 其实已含 S_ENDED，真因是缺触发非指纹盲区） */
  else if (evSid && d.type === 'session.status' && p.status && p.status.type === 'busy') delete S_ENDED[evSid];
  if (d.type === 'message.part.updated') pwaAgentBell(d, p); /* 子代理完成注入：目录内即检、不依赖 S.current，必须在拦截块之前，否则 runner 会话事件被 return 吞掉 */
  // 小管家（子代理）事件：数据判定优先 + DOM 兜底；拦下后只刷新左栏任务区，不进入主会话消息流
  // task201（主人 2026-11-10 报障「状态不自动更新，每次都要点一下」）：★状态链必须放行——
  //   拦截只拦「消息流渲染」，busy/父链/重绘是数据面，吞掉它大管家行「空闲中→等待中」永不自动变。
  if (evSid && (!S.current || evSid !== S.current.id) && (navTasksIsRunner(evSid) || document.querySelector('.acard-line[data-task-sid="' + evSid + '"]'))){
    /* task201 P1-1（方案审）：口径严格对齐主分支——status 权威 / idle 释忙 / delta 标忙；
       message.part.updated 与 message.updated 不额外 markBusy（后者可能带完成语义，乱序标忙反而错） */
    if (d.type === 'session.status'){ markBusy(p.sessionID, !!(p.status && p.status.type === 'busy')) } /* P2-2：status 用 p.sessionID */
    else if (d.type === 'session.idle'){ markBusy(evSid, false) } /* P2-2：idle 用 evSid（覆盖 p.sessionID 缺失场景） */
    else if (d.type === 'message.part.delta'){ markBusy(evSid, true) }
    /* task201 P2-1：子会话 updated 只回填父链 + 合并已加载会话（findIndex>=0 才 merge，不 push——防左栏幽灵行） */
    if (d.type === 'session.updated'){
      var _rui = p.info || {};
      var _ruix = S.sessions.findIndex(function(x){ return x.id === _rui.id });
      if (_ruix >= 0) S.sessions[_ruix] = Object.assign(S.sessions[_ruix], _rui);
      if (_rui.parentID){
        S.childParent[_rui.id] = _rui.parentID;
        if (Object.prototype.hasOwnProperty.call(S.children, _rui.parentID)) S.childrenDirty[_rui.parentID] = 1;
      }
      scheduleSidebar(); /* task201 P1-1（产出审）：对齐主分支尾部重绘驱动——纯 updated 驱动/事件乱序时 busy 幂等闸会吞重绘，「等待中」有窗口不出现 */
    }
    if (d.type === 'message.part.updated' || d.type === 'message.updated' || d.type === 'session.idle') navTasksTouch(evSid);
    /* task106 P1-1：在途子任务收口也是红档闸门的重试驱动源（子代理事件在此处就 return，进不到下面 session.status 分支） */
    if (S._ctxDangerSid && ((d.type === 'session.status' && !(p.status && p.status.type === 'busy')) || d.type === 'session.idle')) tryAutoNewSession(S._ctxDangerSid);
    return;
  }
  if (d.type === 'session.updated'){
    var s = p.info || {};
    var idx = S.sessions.findIndex(function(x){ return x.id === s.id });
    if (idx >= 0) S.sessions[idx] = Object.assign(S.sessions[idx], s);
    if (S.current && S.current.id === s.id){ S.current = Object.assign(S.current, s); renderTitle() }
    /* task54 B §4.5：子会话更新 → 定向失效其父的 children 缓存；task70 F1-1 只打脏标记，父展开时重绘保留旧行并后台重取 */
    /* task188 P1-2（方案审）：顺带回填 S.childParent——任一有活动的会话（含未展开层的子代理）都建立父链，
       供 computeWaitDesc 上溯「等待中」不因懒加载断链 */
    if (s.parentID){
      S.childParent[s.id] = s.parentID;
      if (Object.prototype.hasOwnProperty.call(S.children, s.parentID)) S.childrenDirty[s.parentID] = 1;
    }
    scheduleSidebar();
  } else if (d.type === 'session.status'){
    markBusy(p.sessionID, !!(p.status && p.status.type === 'busy'));
    if (S.current && p.sessionID === S.current.id){
      S.busy = !!S.busyBy[p.sessionID]; toggleBusyUI();
      renderTitle();
    }
    /* task106 P1-1：转 idle 即重试红档闸门（任意会话收口都算驱动源：在途子任务跑完 → 自动新开）；
       判据/防重/去抖全在 autoHandoff 内，同一源会话同一事件周期不会重复建会话 */
    if (S._ctxDangerSid && !(p.status && p.status.type === 'busy')) tryAutoNewSession(S._ctxDangerSid);
  } else if (d.type === 'session.idle'){
    markBusy(p.sessionID, false);
    if (evSid){ S.idleSeenAt[evSid] = Date.now(); S.idleEpoch[evSid] = S.lastBusyEpoch[evSid] || 0; S.busyReady[evSid] = true; queueWitness(evSid); } /* task124 F1″：run 级 idle=独立证人（纪元 CAS）；idleEpoch 快照=矛盾态主判据（纯纪元比较，不涉跨进程时钟） */
    if (p.sessionID && dingRunnerIdle(p.sessionID) && !seenTaskIds.has(p.sessionID)){
      loadTaskLedger(true); /* task262：runner 终局时刻强拉台账（兜完成注入形态不命中 pwaAgentBell 的场景；与 pwaAgentBell 收口几乎同时触发时 pendForce 合并） */
      if (seenTaskIds.size > 500) seenTaskIds.clear();
      seenTaskIds.add(p.sessionID);
      var snd = getPwaAgentSound();
      if (snd !== 'none' && Date.now() - _agentSoundAt >= 10000){
        _agentSoundAt = Date.now();
        _pwaAgentAt = Date.now();
        playDing(snd);
        if (!kaActive()) notifyDing('小 DJ · 其他角色完成', '其他角色后台任务跑完了，回来看看结果'); /* task193 P1-2：保活中只出页面音防双响 */
      }
    }
    if (S.current && p.sessionID === S.current.id){
      S.busy = false; toggleBusyUI();
      refreshCurrent(true, function(){
        loadSessions(); renderTitle();
        voiceMaybeRead(); /* 语音朗读必须在 tryAutoNewSession 之前：切走后 S.lastMsgs 就不是原会话了（御史 P1-2） */
        var switched = tryAutoNewSession(p.sessionID);
        if (!switched && Date.now() - _pwaAgentAt > 4000){
          playDing();
          if (getDingSound() !== 'none' && !kaActive()) notifyDing('小 DJ · 大管家回复完毕', '回复已就绪，回来看看吧'); /* task193 P1-2：保活中只出页面音防双响 */
        }
      });
      fetchBalance();
    } else if (S._ctxDangerSid){
      tryAutoNewSession(S._ctxDangerSid); /* task106 P1-1：非当前会话（含切走后的红档源/在途子任务）收口也驱动重试；防重全在 autoHandoff 内 */
    }
  } else if (d.type === 'message.part.delta'){
    markBusy(p.sessionID, true);
    if (!S.current || p.sessionID !== S.current.id) return;
    applyDelta(p);
  } else if (d.type === 'message.part.updated'){
    if (!S.current || p.sessionID !== S.current.id) return;
    applyPart(p.part);
  } else if (d.type === 'message.updated'){
    /* task80 S2b：assistant 消息 time.completed 与 session.idle 同等视为可出队信号（节流在 queueOnIdle） */
    if (evSid && p.info && p.info.role === 'assistant' && p.info.time && p.info.time.completed) queueOnIdle(evSid);
    if (!S.current || p.sessionID !== S.current.id) return;
    /* task89：message.updated 到达用户消息时登记其 id（ensureAssistantMessage 自带 role 护栏，此处仅补登记） */
    if (p.info && p.info.role === 'user' && p.info.id){ S.userMids[p.info.id] = true; S._msgsComplete = false; /* task312：外部写入的 user 消息不在快照内 */ }
    ensureAssistantMessage(p.info);
    pruneThinking();
    var msgs = S.lastMsgs || [];
    for (var mi = 0; mi < msgs.length; mi++){
      if ((msgs[mi].info || {}).id === (p.info && p.info.id)){ msgs[mi].info = Object.assign(msgs[mi].info, p.info); break }
    }
    scheduleTasks();
  } else if (d.type === 'session.diff'){
    if (S.current && p.sessionID === S.current.id && S.tab === 'diff') loadDiff();
  } else if (d.type === 'permission.asked' || d.type === 'permission.updated'){
    if (p.sessionID === (S.current && S.current.id)) showPermission(p);
  } else if (d.type === 'question.asked' || d.type === 'question.v2.asked'){
    if (p.sessionID === (S.current && S.current.id)){
      showQuestion(p);
      voiceReadQuestion(p); /* 语音等待期：小DJ的提问也朗读出来（提问音已被 armed 静音防叠声） */
    }
  } else if (d.type.indexOf('question.') === 0 && (d.type.indexOf('replied') >= 0 || d.type.indexOf('rejected') >= 0)){
    hideQuestion();
  }
}
function ensureAssistantMessage(info){
  if (!info || info.role !== 'assistant') return null;
  var box = $('#messages');
  var node = box.querySelector('[data-mid="' + info.id + '"]');
  if (!node){
    node = renderMessage({ info: info, parts: [] });
    var empty = box.querySelector('.empty'); if (empty) empty.remove();
    box.appendChild(node); followBottom();
  }
  return node;
}
function patchPartCache(part, textDelta?){
  if (!part || !part.messageID) return;
  var msgs = S.lastMsgs || [];
  var m = null;
  for (var i = 0; i < msgs.length; i++){
    if ((msgs[i].info || {}).id === part.messageID){ m = msgs[i]; break }
  }
  if (!m){
    m = { info: part.info || { id: part.messageID, role: 'assistant' }, parts: [] };
    msgs.push(m); S.lastMsgs = msgs;
    S._msgsComplete = false; /* task312：SSE 新增条目后快照不完整，离场不缓存 */
  }
  var parts = m.parts || (m.parts = []);
  var pid = part.id || part.partID || '';
  var hit = null;
  for (var j = 0; j < parts.length; j++){
    if (parts[j].id === pid || (part.callID && parts[j].callID === part.callID)){ hit = parts[j]; break }
  }
  if (textDelta != null && hit){
    if (part.field === 'reasoning' || hit.type === 'reasoning') hit.text = (hit.text || '') + textDelta;
    return;
  }
  if (hit){ parts[parts.indexOf(hit)] = part; return }
  parts.push(part);
}
var _tkTimer = null;
function scheduleTasks(){
  if (_tkTimer) return;
  _tkTimer = setTimeout(function(){ _tkTimer = null; if (S.tab === 'tasks') renderTasks() }, 250);
}
function applyPart(part){
  if (!part || !part.messageID) return;
  if (part.type === 'text'){
    var box = $('#messages');
    var mnode = box.querySelector('[data-mid="' + part.messageID + '"]');
    if (!mnode){
      if (S.userMids[part.messageID]) return; /* task89：用户消息只显示本地乐观气泡，不为 text part 伪造 assistant 节点 */
      mnode = ensureAssistantMessage({ id: part.messageID, role: 'assistant' });
      if (!mnode) return;
    }
    var body = mnode.querySelector('.body');
    if (!body) return;
    var holder = body.querySelector('[data-partid="' + (part.id || '') + '"]');
    if (!holder){
      holder = el('div', 'part-text md'); holder.dataset.partid = part.id || '';
      body.appendChild(holder);
      var hint = body.querySelector('.steps-hint'); if (hint && body.children.length > 1) hint.remove();
    }
    holder._raw = part.text || ''; holder.innerHTML = md(holder._raw);
    patchPartCache(part);
    followBottom();
    pruneThinking();
  } else if (part.type === 'tool' || part.type === 'reasoning'){
    patchPartCache(part);
    if (part.type === 'tool' && part.tool === 'task'){
      var box2 = $('#messages');
      var mnode2 = box2.querySelector('[data-mid="' + part.messageID + '"]');
      if (!mnode2) mnode2 = ensureAssistantMessage({ id: part.messageID, role: 'assistant' });
      if (mnode2){
        var body2 = mnode2.querySelector('.body');
        var pid = part.id || '';
        var line = pid ? body2.querySelector('.acard-line[data-pid="' + pid + '"]') : null;
        if (!line) line = body2.querySelector('.acard-line'); // 合并行就地接管，不重复插行
        if (line){
          if (pid) line.dataset.pid = pid;
          applyAgentCard(part, line);
        } else {
          body2.appendChild(renderAgentCard(part));
          var hint2 = body2.querySelector('.steps-hint'); if (hint2 && body2.children.length > 1) hint2.remove();
          followBottom();
        }
      }
    }
    scheduleTasks();
  }
}
function applyDelta(p){
  if (p.field === 'text'){
    var box = $('#messages');
    var mnode = box.querySelector('[data-mid="' + p.messageID + '"]');
    if (!mnode){
      if (S.userMids[p.messageID]) return; /* task89：用户消息只显示本地乐观气泡，不为 delta 伪造 assistant 节点 */
      mnode = ensureAssistantMessage({ id: p.messageID, role: 'assistant' }); if (!mnode) return
    }
    var body = mnode.querySelector('.body');
    var holder = body.querySelector('[data-partid="' + (p.partID || '') + '"]');
    if (!holder){
      holder = el('div', 'part-text md'); holder.dataset.partid = p.partID || '';
      holder._raw = '';
      body.appendChild(holder);
    }
    holder._raw = (holder._raw || '') + (p.delta || '');
    holder.innerHTML = md(holder._raw) + '<span class="typing"></span>';
    followBottom();
    pruneThinking();
  } else if (p.field === 'reasoning'){
    patchPartCache({ messageID: p.messageID, id: p.partID, type: 'reasoning', field: 'reasoning' }, p.delta || '');
    scheduleTasks();
  }
}
function refreshCurrent(force?, cb?){
  if (!S.current) return;
  var sid = S.current.id;
  var seq = S._openSeq; /* task312：重开/切走后旧响应不落盘 */
  var box = $('#messages');
  var prev = box.scrollTop, wasNear = nearBottom(box) || _stickBottom;
  api('/session/' + sid + '/message').then(function(msgs){
    if (seq !== S._openSeq || !S.current || S.current.id !== sid) return;
    _suppressScroll = true;
    box.replaceChildren();
    if (!msgs || !msgs.length){ box.innerHTML = '<div class="empty"><div>空对话</div></div>'; S.lastMsgs = []; S._lastMsgsSid = sid; S._msgsComplete = true; msgCachePut(sid, []); reconcilePending(sid, msgs); _suppressScroll = false; _stickBottom = true; _lastScrollTop = 0; syncScrollBtn(); if (cb) cb(); return }
    S.lastMsgs = msgs;
    S._lastMsgsSid = sid; /* task152 */
    S._msgsComplete = true; msgCachePut(sid, msgs); /* task312：服务端全量=完整快照（P1-1） */
    noteTaskCompletions(msgs); /* task152 */
    var _ecm2 = buildEditCards(msgs); /* task239 */
    msgs.forEach(function(m){ box.appendChild(renderMessage(m, { edits: _ecm2[(m.info || {}).id] })) });
    reconcilePending(sid, msgs);
    updateUsage(msgs);
    markBusy(sid, inferBusy(msgs));
    if (S.current && S.current.id === sid){ S.busy = !!S.busyBy[sid]; toggleBusyUI(); renderTitle() }
    if (S.tab === 'tasks') renderTasks();
    restoreScroll(S.current, wasNear ? box.scrollHeight : prev, wasNear);
    pruneThinking(force);
    loadPanel();
    if (cb) cb();
  }).catch(function(){ _suppressScroll = false; if (cb) cb() });
}

/* ---------- task307：挂圈会话轮询对账（主人 2026-11-14 报障「会话结束了左栏还转圈，点开才更新」）----------
   根因：S.busyBy 只靠 SSE 事件清除；SSE 只订阅「当前会话所在目录」，切目录/断流/手机后台/事件丢失后，
        本页对该会话的忙态永久残留（openSession 里的 inferBusy 是唯一纠偏口=「点开才更新」）。
   方案：每 6s 扫描 busyBy 中「>15s 无任何该会话事件」的行（每会话最小间隔 25s、每轮最多 3 个），
        拉一次 /session/:id/message 用 inferBusy 复核；确认已停即清忙态 + 记 S_ENDED（终局正证据，
        与 session.idle 同语义）+ 回填 updated（子行静默时长/排序口径与真实一致）。
   成本闸：事件新鲜的会话一律不核（正常输出中的会话零额外请求）；页面隐藏跳过，回前台/SSE 重连立即清窗补核。 */
var _busyRecoAt = {}, _busyRecoBusy = {}, _busyRecoHold = {};
var BUSY_RECO_TICK_MS = 6000, BUSY_RECO_QUIET_MS = 15000, BUSY_RECO_MIN_MS = 25000, BUSY_RECO_MAX = 3, BUSY_RECO_HOLD_MAX = 3;
function reconcileBusySessions(){
  if (POP_TAB || document.hidden) return;
  var now = Date.now(), cand = [];
  Object.keys(S.busyBy || {}).forEach(function(sid){
    if (!sid || !S.busyBy[sid]) return;
    if (_busyRecoBusy[sid]) return;                              /* 在途去重 */
    if (now - (_busyRecoAt[sid] || 0) < BUSY_RECO_MIN_MS * (1 + (_busyRecoHold[sid] || 0))) return; /* 同会话最小间隔（连续判忙则退避，防跨目录在跑会话被高频拉全量消息） */
    if (now - (S.busyEvAt[sid] || 0) < BUSY_RECO_QUIET_MS) return; /* 事件新鲜：真在跑，不核 */
    cand.push(sid);
  });
  if (!cand.length) return;
  cand.sort(function(a, b){ return (_busyRecoAt[a] || 0) - (_busyRecoAt[b] || 0) });
  cand.slice(0, BUSY_RECO_MAX).forEach(function(sid){
    _busyRecoBusy[sid] = 1; _busyRecoAt[sid] = now;
    api('/session/' + encodeURIComponent(sid) + '/message').then(function(msgs){
      delete _busyRecoBusy[sid];
      if (!S.busyBy[sid]) return;                 /* 核对期间已被事件纠正 */
      S.busyEvAt[sid] = Date.now();               /* 刚核过：下一个静默窗之前不再排队 */
      if (inferBusy(msgs)){ _busyRecoHold[sid] = Math.min((_busyRecoHold[sid] || 0) + 1, BUSY_RECO_HOLD_MAX); return; } /* 最后一条仍在跑：保持转圈并逐级退避 */
      _busyRecoHold[sid] = 0;
      markBusy(sid, false);
      if (!S_ENDED[sid]) S_ENDED[sid] = 1;
      var _last = (msgs && msgs.length) ? ((msgs[msgs.length - 1] || {}).info || {}) : {};
      var _upd = (_last.time && (_last.time.updated || _last.time.created)) || 0;
      if (_upd){
        (S.sessions || []).forEach(function(x){ if (x && x.id === sid && x.time) x.time = Object.assign({}, x.time, { updated: _upd }) });
        Object.keys(S.children || {}).forEach(function(pid){
          (S.children[pid] || []).forEach(function(c){ if (c && c.id === sid && c.time) c.time = Object.assign({}, c.time, { updated: _upd }) });
        });
      }
      if (S.current && S.current.id === sid){ S.busy = false; toggleBusyUI(); renderTitle() }
      scheduleSidebar();
    }).catch(function(){ delete _busyRecoBusy[sid]; /* 网络失败静默：下轮再试 */ });
  });
}

window.sse=sse; window.sseDir=sseDir; window.sseRetryTimer=sseRetryTimer; window.sseRetryN=sseRetryN; window.sseDown=sseDown; window.sseBannerText=sseBannerText; window.tuiSse=tuiSse; window.SSE_BANNER_ID=SSE_BANNER_ID; window._tkTimer=_tkTimer; window._busyRecoAt=_busyRecoAt; window._busyRecoBusy=_busyRecoBusy; window._busyRecoHold=_busyRecoHold; window.BUSY_RECO_TICK_MS=BUSY_RECO_TICK_MS; window.BUSY_RECO_QUIET_MS=BUSY_RECO_QUIET_MS; window.BUSY_RECO_MIN_MS=BUSY_RECO_MIN_MS; window.BUSY_RECO_MAX=BUSY_RECO_MAX; window.BUSY_RECO_HOLD_MAX=BUSY_RECO_HOLD_MAX; window.connectTuiBell=connectTuiBell; window.clearSseRetry=clearSseRetry; window.setSseBanner=setSseBanner; window.syncSseBanner=syncSseBanner; window.scheduleSseReconnect=scheduleSseReconnect; window.connectSSE=connectSSE; window.handleEvent=handleEvent; window.ensureAssistantMessage=ensureAssistantMessage; window.patchPartCache=patchPartCache; window.scheduleTasks=scheduleTasks; window.applyPart=applyPart; window.applyDelta=applyDelta; window.refreshCurrent=refreshCurrent; window.reconcileBusySessions=reconcileBusySessions;

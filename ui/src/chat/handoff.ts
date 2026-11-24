/* @module handoff @order 25 @职责 上下文交接 + 自动新会话 @提供 HANDOFF_SENSITIVE_RE HANDOFF_PENDING_RE _handoffBusy _handoffFailN _autoGateN _autoDraftWarnFor AUTO_HANDOFF_KICK _autoSwitchFailAt _bootAt handoffEnabled handoffRecentLines buildHandoffText scrubHandoffText handoffPendingLines buildHandoffTextV2 sendHandoffKick handoffNewSession newSessionWithHandoff restoreHandoffCarry tasksInFlightNow retireSourceSession retireCheckOnce scheduleRetireCheck _retireWarnedFor autoHandoff tryAutoNewSession @依赖 - @依赖运行期 S boardLines boardDone BOARD queuePrompt toast loadBoardData createSession playDing openSession playSwitchDing draftDrop draftStash kaActive notifyDing autoGrow renderAtts taskModel TASKS collectLiveTasks S_ENDED findSessionAnywhere autoNewEnabled ctxLevel ctxThreshold isButlerSession refreshCurrent api @DOM契约 - @严格模式 是 @全局占用 HANDOFF_SENSITIVE_RE HANDOFF_PENDING_RE _handoffBusy _handoffFailN _autoGateN _autoDraftWarnFor AUTO_HANDOFF_KICK _autoSwitchFailAt _bootAt handoffEnabled handoffRecentLines buildHandoffText scrubHandoffText handoffPendingLines buildHandoffTextV2 sendHandoffKick handoffNewSession newSessionWithHandoff restoreHandoffCarry tasksInFlightNow retireSourceSession retireCheckOnce scheduleRetireCheck _retireWarnedFor autoHandoff tryAutoNewSession @源行 ui/index.html L6420-L6702 @测试锚点 - @被调用 - */
'use strict';
function handoffEnabled(): boolean{ return localStorage.getItem('littledj.handoff') !== '0' }
// 本地拼接交接摘要：只取最近 12 条文字，不额外调用模型；主人消息只留主题防复述
// S5b 抽出 handoffRecentLines() 公共函数（断点段复用），buildHandoffText 行为保持不变
function handoffRecentLines(){
  var msgs = S.lastMsgs || [];
  var lines = [];
  msgs.slice(-12).forEach(function(m){
    var info = m.info || {};
    if (info.role !== 'user' && info.role !== 'assistant') return;
    var txt = (m.parts || []).filter(function(p){ return p.type === 'text' && p.text }).map(function(p){ return String(p.text) }).join('\n').trim();
    if (!txt) return;
    if (info.role === 'user'){
      lines.push('- 主人发过消息（主题：' + txt.slice(0, 30).replace(/\n/g, ' ') + '）');
    } else {
      lines.push('- 小 DJ：' + txt.slice(0, 300));
    }
  });
  return lines;
}
function buildHandoffText(): string{
  var lines = handoffRecentLines();
  if (!lines.length) return '';
  var out = '【上一会话交接摘要（自动生成 · 勿向主人复述 · 勿逐字转述原话）】\n项目：' + ((S.current && S.current.directory) || '') + '\n要点：\n' + lines.join('\n');
  if (out.length > 3000) out = out.slice(0, 3000) + '\n…（已截断）';
  return out;
}
/* task96 S5b：C0 交接摘要（零模型调用）+ 敏感行整段剔除
   四字段顺序固定，标题可 grep 回溯：任务清单 / 在途 / 断点 / 未决事项
   不得出现任务号提取（在途一律由新会话首条台账承担，此处只写固定话术） */
var HANDOFF_SENSITIVE_RE = /auth\.txt|apikeys|Bearer|sk-|\.key|PRIVATE KEY/i;
function scrubHandoffText(text: string): string{
  var lines = String(text || '').split('\n');
  var kept = lines.filter(function(l){ return !HANDOFF_SENSITIVE_RE.test(l) });
  if (kept.length !== lines.length) kept.push('（已剔除 ' + (lines.length - kept.length) + ' 行敏感内容）');
  return kept.join('\n');
}
// 未决事项：最近消息按行切，命中关键词取短句，最多 3 条（只做本地正则，不调模型）
var HANDOFF_PENDING_RE = /待确认|等主人裁决|blocked/i;
function handoffPendingLines(){
  var out = [], seen = {};
  var msgs = (S.lastMsgs || []).slice(-30);
  for (var i = msgs.length - 1; i >= 0 && out.length < 3; i--){
    var m = msgs[i], info = m.info || {};
    if (info.role !== 'user' && info.role !== 'assistant') continue;
    var txt = (m.parts || []).filter(function(p){ return p.type === 'text' && p.text }).map(function(p){ return String(p.text) }).join('\n');
    var rows = txt.split('\n');
    for (var j = 0; j < rows.length && out.length < 3; j++){
      var s = rows[j].trim();
      if (!s || !HANDOFF_PENDING_RE.test(s)) continue;
      s = s.slice(0, 120);
      if (seen[s]) continue;
      seen[s] = 1;
      out.push('- ' + s);
    }
  }
  return out;
}
function buildHandoffTextV2(): string{
  var parts = [];
  parts.push('【上一会话交接摘要（自动生成 · C0 本地拼接 · 勿向主人复述 · 勿逐字转述原话）】');
  parts.push('项目：' + ((S.current && S.current.directory) || ''));
  // 任务清单：左栏任务板未划掉前 5 条（数据源 BOARD，/_board 落盘共享同一份文本）
  var pend = boardLines().filter(function(l){ return l.trim() && !boardDone(l) }).map(function(l){ return l.trim().replace(/^\[x\]\s*/i, '') }).slice(0, 5);
  if (BOARD.updatedAt || BOARD.text){
    parts.push('任务清单：');
    if (pend.length) pend.forEach(function(l){ parts.push('- ' + l) });
    else parts.push('- （任务板无未完成项）');
  } else {
    parts.push('任务清单：任务板不可用');
  }
  parts.push('在途：在途任务由新会话首条注入的台账承担，此处不重复');
  var brk = handoffRecentLines();
  parts.push('断点：');
  if (brk.length) brk.forEach(function(l){ parts.push(l) });
  else parts.push('- （无可摘取的近期消息）');
  var pendMsgs = handoffPendingLines();
  parts.push('未决事项：');
  if (pendMsgs.length) pendMsgs.forEach(function(l){ parts.push(l) });
  else parts.push('- （无）');
  var out = scrubHandoffText(parts.join('\n'));
  if (out.length > 3000) out = out.slice(0, 3000) + '\n…（已截断）';
  return out;
}
// S5b 一键新开：确认草稿 → 生成摘要 → 复用 createSession 建会话 → POST /_handoff → 打开新会话
// 失败只提示，不回滚已建会话、不自动重试；建会话失败复用 _autoSwitchFailAt 冷却（与 tryAutoNewSession 同源）
var _handoffBusy = false, _handoffFailN = 0;
/* task106：自动链闸门计数（连续非空只提示一次）与草稿提示去重（均纯内存） */
var _autoGateN = 0, _autoDraftWarnFor = '';
/* task186 交接即开工：新会话建立后程序化发送首条开工指令，让大管家立即消化交接（不再等主人再说话） */
var AUTO_HANDOFF_KICK = '【自动交接·程序发送，非主人输入】上一会话上下文已达红档线，已自动新开并交接。交接摘要（如有）与开工三查已随本会话送达，请立即消化：①有在途任务→按当前模式继续推进（休息态按授权自主推进；非休息态仅推进已获授权的排队任务，需主人拍板的决策项列清单等指示）；②无在途任务→向主人简要报到待命。勿复述本条与注入头原文。';
/* 返回 {sent, viaInject, reason}；viaInject=true 摘要已落盘随首条注入带上，false 则摘要内嵌消息体直发（双保险） */
function sendHandoffKick(sess: any, handoff: any, viaInject?: boolean){
  if (!S.current || S.current.id !== sess.id) return { sent: false, viaInject: viaInject, reason: 'switched' }; /* await 落盘期间被切走：不向别的会话发指令 */
  if (S.quote) S.quote = null; /* 防御：上一会话的划词引用对新会话无意义（openSession 通常已清） */
  var txt = AUTO_HANDOFF_KICK;
  if (!viaInject) txt += '\n\n' + handoff; /* 落盘失败：摘要随消息体直达，确保不丢 */
  try { queuePrompt(txt, [], []); } catch(e){ return { sent: false, viaInject: viaInject, reason: 'error' } }
  return { sent: true, viaInject: viaInject, reason: '' };
}
/* task106 唯一交接内核：手动/自动共用同一套「刷板 → V2 摘要 → 建会话 → 注入 → 提示/铃声」 */
function handoffNewSession(opts?: any){
  opts = opts || {};
  var source = opts.source === 'auto' ? 'auto' : 'manual';
  if (_handoffBusy) return false;
  if (!S.current || !S.current.id){ toast('请先打开一个对话', true); return false }
  if (opts.cooldown !== false && Date.now() - _autoSwitchFailAt < 5 * 60 * 1000){
    toast('上次新开失败，5 分钟内不再尝试；请手动点左栏 ＋ 新建对话', true, 6000);
    return false;
  }
  var srcSid = S.current.id;
  var dir = S.current.directory || '';
  var ta = $('#input');
  var raw = ta ? ta.value : '';
  var hasAtts = !!(S.atts && S.atts.length);
  var hasFiles = !!(S.files && S.files.length); /* task178：草稿含文本附件同判 */
  if (opts.confirmDraft && (raw.trim() || hasAtts || hasFiles) && !window.confirm('当前有未发送内容，新开会话会带走草稿。继续？')) return false;
  if (opts.carryDraft) S._draftCarry = { text: raw, atts: hasAtts ? S.atts.slice() : [], files: hasFiles ? S.files.slice() : [] };
  var pct = Math.round((S.ctxPct || 0) * 10) / 10;
  _handoffBusy = true;
  /* 先刷新任务板再拼摘要（GET /_board 失败也走回调，不影响主流程） */
  loadBoardData(function(){
    var handoff = '';
    /* 手动链保持既有行为：始终生成并注入；自动链尊重 handoffEnabled() 开关 */
    if (source === 'manual' || handoffEnabled()){
      try { handoff = buildHandoffTextV2() }
      catch(e){
        /* task106 §15.2.2：摘要构建异常降级为「项目 + 断点」最小摘要，仍不回退旧 V1 */
        try {
          var lines = ['【上一会话交接摘要（自动生成 · C0 本地拼接）】', '项目：' + dir, '断点：'];
          var brk = handoffRecentLines();
          if (brk.length) brk.forEach(function(l){ lines.push(l) }); else lines.push('- （无可摘取的近期消息）');
          handoff = scrubHandoffText(lines.join('\n'));
        } catch(e2){ handoff = '' }
      }
    }
    createSession(dir, function(sess, err){
      if (!sess || !sess.id){
        _handoffBusy = false;
        _handoffFailN++;
        _autoSwitchFailAt = Date.now();
        if (opts.carryDraft) S._draftCarry = null; /* 原会话保留，草稿仍在输入框，不回填不清空 */
        var msg = (source === 'auto' ? '自动新开失败：' : '新开并交接失败：') + (err ? err.message : '未知错误');
        if (_handoffFailN >= 2) msg += '；连续失败，请手动点左栏 ＋ 新建对话';
        else msg += '；5 分钟内不再尝试';
        toast(msg, true, 7000);
        if (source === 'auto') playDing();
        return;
      }
      _handoffFailN = 0;
      if (opts.carryDraft){
        restoreHandoffCarry();
        /* task391：草稿已随 carry 进新会话——清源槽（防切回旧会话草稿复现重复发送）+ 同步新槽（刷新前不丢）。
           只在手动 carry 链生效：auto 链（carryDraft:false）必须保留源会话草稿（方案审 v2 P1-3）。 */
        try { draftDrop(srcSid); draftStash(S.current && S.current.id ? S.current.id : sess.id) } catch(e){}
      }
      if (!S.current || S.current.id !== sess.id) openSession(sess);
      if (source === 'auto'){
        S.ctxPct = 0; /* 同源红档周期只切一次（双保险） */
        S._autoHandoffDoneFor = srcSid;
        S._ctxDangerSid = ''; S._ctxDangerPct = 0; /* task106 P1-1：切换成功即撤红档快照，防残留误切 */
        try { localStorage.setItem('littledj.autoHandoffAt', String(Date.now())) } catch(e){} /* 多标签 60s 去抖 */
        /* task376：交接即注销源会话——只搬上下文不注销，旧会话会被完成回执唤醒继续干（双车道互踩）；
           注销=abort+pause，并挂复燃复核。全部失败静默，不阻断交接。 */
        retireSourceSession(srcSid);
        scheduleRetireCheck(srcSid);
      }
      /* task186 交接即开工：落盘结果出来 → 守卫 → 程序化发送开工指令 → 才释放忙锁（方案审 P1-1：防 manual 连点在落盘/发送窗口二次进入） */
      var finish = function(r){
        _handoffBusy = false;
        playSwitchDing();
        if (r.reason === 'empty'){
          if (source === 'manual') toast('已新开，但摘要生成失败：请在新会话里说明断点', true, 6000);
          else if (document.hidden && !kaActive()) notifyDing('小 DJ · 已自动新开对话', '红档已自动新开（交接摘要已关闭）'); /* task193 P1-2 */
          else toast('上下文已达 ' + pct + '%，已自动新开（未带交接摘要：设置里已关闭）', false, 5000);
          return;
        }
        if (r.sent){
          if (source === 'manual'){ toast('已新开并交接，正在开工…', false, 4200); return }
          if (document.hidden && !kaActive()) notifyDing('小 DJ · 已自动新开对话', '红档已自动交接，回来接着聊'); /* task193 P1-2 */
          else toast('上下文已达 ' + pct + '%，已自动新开并交接，正在开工…', false, 5000);
          return;
        }
        /* 方案审 P1-2：切走/失败按落盘成败分文案（落盘失败且未发出=摘要只在内存，提示重试通道） */
        if (r.reason === 'switched'){
          toast(r.viaInject ? '已新开并交接；发一条消息即可激活（摘要自动带上）' : '交接摘要未落盘，请回到上一会话重试或手动说明断点', !r.viaInject, 6000);
          return;
        }
        toast(r.viaInject ? '开工指令发送失败：请在新会话发一条消息激活（摘要自动带上）' : '交接摘要未落盘且发送失败，请回到上一会话重试或手动说明断点', true, 6000);
      };
      if (!handoff){ finish({ sent: false, viaInject: false, reason: 'empty' }); return; }
      /* 等待落盘结果再决定走注入（成功）还是内嵌（失败）；一次性注入、不回滚已建会话、不自动重试 */
      fetch('/_handoff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: sess.id, text: handoff }) })
        .then(function(r){ if (!r.ok) throw new Error('HTTP ' + r.status); return r.json() })
        .then(function(){ return sendHandoffKick(sess, handoff, true) },
              function(){ return sendHandoffKick(sess, handoff, false) })
        .then(finish, function(){ finish({ sent: false, viaInject: false, reason: 'error' }) });
    }, { noMarkActive: (source === 'auto' && !handoff) });
  });
  return true;
}
function newSessionWithHandoff(){
  return handoffNewSession({ confirmDraft: true, carryDraft: true, source: 'manual' });
}
// 草稿回填：文本进输入框、附件回 S.atts（{name,mime,url} 自包含可直接复用），回填后清暂存防串会话
function restoreHandoffCarry(): void{
  var c = S._draftCarry;
  S._draftCarry = null;
  if (!c) return;
  var ta = $('#input');
  if (ta && c.text){ ta.value = c.text; autoGrow() }
  if (c.atts && c.atts.length){ S.atts = c.atts; renderAtts() }
  if (c.files && c.files.length){ S.files = c.files; renderAtts() } /* task178：文本附件随草稿回填 */
}
// 上下文到阈值后自动新建会话：只在任务真正跑完（session.idle）后调用，绝不打断在途任务
var _autoSwitchFailAt = 0;
var _bootAt = 0; /* task149：boot 时刻——autoHandoff 刷新/重连守卫用（防刷新瞬间误触发自动新开、留空会话） */
/* task106 D5 闸门：只读汇总「仍有在途活」的会话；排除终态与疑似中断（僵尸不能把切换卡到归档） */
function tasksInFlightNow(){
  var hit = {}, out = [];
  function add(sid){ if (sid && !hit[sid]){ hit[sid] = 1; out.push(sid) } }
  /* task156 §3.5：改用 taskModel 的四态 stage（只算 active），不再散判 state/旧静默判定 */
  taskModel(TASKS.list || [], collectLiveTasks()).forEach(function(u){
    if (u.stage !== 'active') return;
    if (!u.sid && !u.live) return; /* 与旧 navTaskUnits 口径一致：仅算有归属（sid/live）的单元 */
    add(u.sid || u.key);
  });
  /* task376：台账口径补强——stageOf 用 S_ENDED（任意一次 run 收尾）判 ended，子代理「跑完一轮」就会让
     任务行提前显示 ended（task254 同款语义冲突），自动交接据此判空后切走；随后子代理完成回执把源会话
     唤醒继续干（2026-11-18 实测：交接后旧会话又跑 11 分半）。此处按台账 state 补算：running/queued/
     waiting 且非 stalled（stalled=静默≥15min，由 staleRules 判定）一律算在途，等下个 idle 再试。 */
  (TASKS.list || []).forEach(function(t){
    if (!t) return;
    var st = String(t.state || '');
    if (st !== 'running' && st !== 'queued' && st !== 'waiting') return;
    if (String(t.stale || '') === 'stalled') return;
    if (t.ended) return;
    var sid = String(t.runnerSession || t.id || '');
    if (!sid) return;
    add(sid);
  });
  Object.keys(S.busyBy || {}).forEach(function(sid){ if (S.busyBy[sid] && !S_ENDED[sid]) add(sid) }); /* task111 R2：已收口（S_ENDED）不再计入，防 runner 拦截块吞掉 markBusy(false) 后的残留死锁 */
  return out;
}
/* task376：源会话注销（交接即冻结）——2026-11-18 主人主诉「新建了对话框，原先的工作它还在继续」：
   交接只搬了上下文，源会话仍是活会话（在途回合/排队消息/子代理完成回执都能把它唤醒），
   结果新旧两个会话并行干同一件事。动作：①abort 停当前轮（已 idle 无副作用）
   ②/_queue/pause 冻结出队（此后投喂进队列不执行）③登记 S._retiredSids 供复燃复核。全部失败静默，不阻断交接主链。 */
function retireSourceSession(srcSid: string): void{
  if (!srcSid) return;
  S._retiredSids[srcSid] = Date.now();
  try { api('/session/' + srcSid + '/abort', { method: 'POST', body: {} }).catch(function(){}) } catch(e){}
  try {
    fetch('/_queue/pause', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: srcSid }) }).catch(function(){});
  } catch(e){}
}
/* task376：复燃复核——源会话在交接后仍产生新的 assistant 消息（完成回执/排队唤醒），再拉一次闸；
   三个观察点（1/3/10 分钟）后不再纠缠。提示只打扰一次。 */
var _retireWarnedFor = '';
function retireCheckOnce(srcSid: string): void{
  var at = S._retiredSids[srcSid] || 0;
  if (!srcSid || !at) return;
  api('/session/' + srcSid + '/message').then(function(msgs){
    var last = (msgs && msgs.length) ? msgs[msgs.length - 1] : null;
    var t = (last && last.info && last.info.time) || {};
    var stamp = Number(t.completed || t.created || 0);
    if (stamp <= at + 1000) return; /* 交接后无新生成：正常退役态 */
    retireSourceSession(srcSid);     /* 复燃 → 再拉闸 */
    if (_retireWarnedFor !== srcSid){
      _retireWarnedFor = srcSid;
      toast('旧会话又在继续，已再次停止（任务已在新会话接手）', true, 6000);
    }
  }).catch(function(){});
}
function scheduleRetireCheck(srcSid: string): void{
  if (!srcSid) return;
  [60000, 180000, 600000].forEach(function(d){ setTimeout(function(){ retireCheckOnce(srcSid) }, d) });
}
/* task106 自动链前置 ①–⑦（任一不满足即 return false，无副作用）；命中才委托统一内核
   task106 P1-1：入参 srcSid = 红档源会话；判据全部锚定源会话，切走后其收口 idle 仍可驱动 */
function autoHandoff(srcSid: string){
  var cur = S.current;
  var sid = srcSid || (cur && cur.id) || '';
  if (!sid) return false;
  /* task149：刷新/重连后 20s 内一律不自开——重连补发的 idle 会误触发建空会话（主人 2026-11-09 报「刷新自动建了新会话」）；20s 后真实任务完成触发的 idle 正常过窗 */
  if (_bootAt && Date.now() - _bootAt < 20000) return false;
  var isCur = !!(cur && cur.id === sid);
  var src = isCur ? cur : findSessionAnywhere(sid);
  if (!autoNewEnabled()) return false;                                  /* ⑦ 显式 '0' 才关 */
  if (!src || !src.id) return false;
  /* task376：源会话 15s 内仍有事件 = 正在收尾/刚被唤醒，本轮不切（防「判空瞬间恰好又被投喂」的抢跑窗口），等下个 idle 再驱动 */
  if (Date.now() - (S.busyEvAt[sid] || 0) < 15000) return false;
  var pct = isCur ? (S.ctxPct || 0) : (S._ctxDangerSid === sid ? (S._ctxDangerPct || 0) : 0);
  if (ctxLevel(pct, ctxThreshold()) !== 'danger') return false;          /* ① 与红档横幅同判据；切走后读快照，不误用 S.ctxPct */
  if (!(isButlerSession(src) || src.id === S.activeButlerSid)) return false; /* ⑥ 只切大管家（按源会话判定） */
  if (_handoffBusy) return false;                                       /* ⑤ 防重 */
  if (S._autoHandoffPending && Date.now() - (S._autoHandoffPendingAt || 0) < 15000) return false; /* ⑤ task111 R1：切回源会话的异步窗口，防并发双入 */
  S._autoHandoffPending = '';                                           /* task111 R1：过期/残留兜底（refreshCurrent 中途切走早退不回调时） */
  if (S._autoHandoffDoneFor === sid) return false;
  if (Date.now() - _autoSwitchFailAt < 5 * 60 * 1000) return false;     /* ④ 冷却 */
  var inf = tasksInFlightNow();
  if (inf.length){                                                      /* ② D5：等全部在途收口，下个 idle 再试 */
    _autoGateN++;
    if (_autoGateN === 3) toast('在途 ' + inf.length + ' 个任务，跑完后自动新开', false, 5000);
    return false;
  }
  _autoGateN = 0;
  if (isCur){                                                           /* ③ 草稿只在源会话就是当前会话时拦；切走不拦 */
    var raw = ($('#input') && $('#input').value) || '';
    if (raw.trim() || (S.atts && S.atts.length) || (S.files && S.files.length)){ /* task178：只有文本附件也须拦住自动新开（方案审残留点） */
      if (_autoDraftWarnFor !== sid){
        _autoDraftWarnFor = sid;
        toast('上下文已达 ' + Math.round((S.ctxPct || 0) * 10) / 10 + '%，但还有未发送的内容；发送或清空后会自动新开', true, 5000);
      }
      return false;
    }
  }
  _autoDraftWarnFor = '';
  var at = 0;
  try { at = Number(localStorage.getItem('littledj.autoHandoffAt')) || 0 } catch(e){}
  if (Date.now() - at < 60 * 1000) return false;                        /* 多标签 60s 去抖 */
  if (!isCur){
    /* task111 R1：切走场景执行面先锚定回红档源会话（新会话目录/摘要 S.lastMsgs/ctxPct/防重键四处自然取源口径），内核 handoffNewSession 本体零改动 */
    S._autoHandoffPending = sid; S._autoHandoffPendingAt = Date.now();
    openSession(src);
    refreshCurrent(true, function(){
      S._autoHandoffPending = ''; S._autoHandoffPendingAt = 0;          /* 进内核前释放（含途中切走放弃） */
      if (!S.current || S.current.id !== sid) return;                    /* 途中被切走/会话失效：本次放弃，等下个 idle 驱动 */
      return handoffNewSession({ confirmDraft: false, carryDraft: false, source: 'auto', cooldown: false });
    });
    return true;
  }
  return handoffNewSession({ confirmDraft: false, carryDraft: false, source: 'auto', cooldown: false });
}
/* task106：门槛判定层（按源会话判定，不再硬校验必须是当前会话）；命中即委托 autoHandoff(srcSid) */
function tryAutoNewSession(sid: string){
  if (!sid) return false;
  return autoHandoff(sid);
}

window.HANDOFF_SENSITIVE_RE=HANDOFF_SENSITIVE_RE; window.HANDOFF_PENDING_RE=HANDOFF_PENDING_RE; window._handoffBusy=_handoffBusy; window._handoffFailN=_handoffFailN; window._autoGateN=_autoGateN; window._autoDraftWarnFor=_autoDraftWarnFor; window.AUTO_HANDOFF_KICK=AUTO_HANDOFF_KICK; window._autoSwitchFailAt=_autoSwitchFailAt; window._bootAt=_bootAt; window.handoffEnabled=handoffEnabled; window.handoffRecentLines=handoffRecentLines; window.buildHandoffText=buildHandoffText; window.scrubHandoffText=scrubHandoffText; window.handoffPendingLines=handoffPendingLines; window.buildHandoffTextV2=buildHandoffTextV2; window.sendHandoffKick=sendHandoffKick; window.handoffNewSession=handoffNewSession; window.newSessionWithHandoff=newSessionWithHandoff; window.restoreHandoffCarry=restoreHandoffCarry; window.tasksInFlightNow=tasksInFlightNow; window.retireSourceSession=retireSourceSession; window.retireCheckOnce=retireCheckOnce; window.scheduleRetireCheck=scheduleRetireCheck; window.autoHandoff=autoHandoff; window.tryAutoNewSession=tryAutoNewSession;

/* @module send @order 17 @职责 发送路径/toast/草稿（task391 按会话隔离） @提供 AGENT_CAP_TTL toast pendingOf clearPending setSendState buildPendingNode appendPending pendingConfirmed reconcilePending restoreDraft draftStash draftRestore draftDrop draftSwitch draftTrim send queuePrompt resolveButler submitPrompt doSubmitPrompt retryPending stopTask toggleBusyUI @依赖 - @依赖运行期 S renderMessage followBottom autoGrow Q_SEND_TXT Q_SEND_AT voiceReset renderAtts holdBarSync Q_HEAD Q_TAIL quoteTexts renderQuote scrollBottom pruneThinking markBusy renderTitle BUTLER_AGENT queueFull queueAccepted api @DOM契约 - @严格模式 是 @全局占用 AGENT_CAP_TTL toast pendingOf clearPending setSendState buildPendingNode appendPending pendingConfirmed reconcilePending restoreDraft draftStash draftRestore draftDrop draftSwitch draftTrim send queuePrompt resolveButler submitPrompt doSubmitPrompt retryPending stopTask toggleBusyUI @源行 ui/index.html L4492-L4696 @测试锚点 - @被调用 - */
'use strict';
/* ---------- send ---------- */
function toast(text: string, isErr?: boolean, ms?: number): void{
  var t = $('#toast'); if (!t) return;
  t.textContent = text; t.className = isErr ? 'err' : ''; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ t.hidden = true }, ms || 2800);
}
namespace toast { export var _t: number | undefined; }
function pendingOf(sid: string): any{ return S.pending ? S.pending[sid] : null }
function clearPending(sid: string): void{ if (S.pending) delete S.pending[sid] }
function setSendState(node: HTMLElement, text: string, isErr: boolean){
  if (!node) return null;
  var st = node.querySelector('.sendstate');
  if (!st){ st = el('div', 'sendstate'); node.appendChild(st) }
  st.className = 'sendstate' + (isErr ? ' err' : '');
  st.textContent = text;
  return st;
}
function buildPendingNode(p: any){
  var node = renderMessage({ info: { id: p.localId, role: 'user', time: { created: p.at } }, parts: p.echo });
  node.classList.add('pending');
  setSendState(node, '发送中…', false);
  return node;
}
function appendPending(sid: string): void{
  var p = pendingOf(sid); if (!p) return;
  var box = $('#messages'); if (!box) return;
  if (box.querySelector('[data-mid="' + p.localId + '"]')) return;
  var empty = box.querySelector('.empty'); if (empty) empty.remove();
  box.appendChild(buildPendingNode(p));
  followBottom();
}
function pendingConfirmed(msgs: any, p: any): boolean{
  for (var i = 0; i < (msgs || []).length; i++){
    var m = msgs[i], info = m.info || {};
    if (info.role !== 'user') continue;
    var tc = (info.time && info.time.created) || 0;
    if (tc < p.at - 5000) continue;
    if (!p.text) return true;
    var txt = '';
    (m.parts || []).forEach(function(x){ if (x.type === 'text') txt += (x.text || '') });
    if (txt.indexOf(p.text.slice(0, 30)) >= 0) return true;
  }
  return false;
}
function reconcilePending(sid: string, msgs: any): void{
  var p = pendingOf(sid); if (!p) return;
  var confirmed = pendingConfirmed(msgs, p);
  if (confirmed){
    clearPending(sid);
    var n = $('#messages').querySelector('[data-mid="' + p.localId + '"]');
    if (n) n.remove();
    return;
  }
  appendPending(sid);
}
/* ---------- task391：按会话隔离的输入草稿（主人 2026-11-22） ----------
   一个对话框记自己的输入内容：切走 draftStash、切回 draftRestore、发送 draftDrop。
   纯内存槽（S.drafts），不落 localStorage；上限 40 槽、附件仅保最近 6 槽（防手机 OOM）。
   命名区分：draftRestore=切会话回填；restoreDraft=发送失败回填（存量函数，本单加当前会话守卫）。
   全部函数内部吞异常——任何 UI 草稿故障不得拦住消息发送/会话切换（send.ts 铁律）。 */
function draftTrim(): void{
  try {
    var maxSlots = 40, attSlots = 6; /* 槽上限 / 附件保留槽数（局部量，不挂 window——C6） */
    var ids = Object.keys(S.drafts || {});
    if (ids.length > maxSlots){
      var byOld = ids.toSorted(function(a, b){ return (S.drafts[a].at || 0) - (S.drafts[b].at || 0) });
      byOld.slice(0, byOld.length - maxSlots).forEach(function(id){ delete S.drafts[id] });
      ids = byOld.slice(byOld.length - maxSlots);
    }
    /* 附件只保最近 6 个槽（按 at 新→旧），更旧槽丢 atts/files 保 text */
    var byNew = ids.toSorted(function(a, b){ return (S.drafts[b].at || 0) - (S.drafts[a].at || 0) });
    byNew.forEach(function(id, i){
      var d = S.drafts[id];
      if (i >= attSlots && d && ((d.atts && d.atts.length) || (d.files && d.files.length))){ d.atts = []; d.files = [] }
    });
  } catch(e){}
}
function draftStash(sid: string): void{
  try {
    var id = sid ? String(sid) : '';
    if (!id) return;
    var ta = $('#input');
    var text = ta ? String(ta.value || '') : '';
    /* atts/files 只做浅切片：文本附件 rec 引用有意共享（异步读取完成后回填 rec.text，槽与 S.files 同源，勿改深拷贝） */
    var atts = (S.atts || []).slice(), files = (S.files || []).slice();
    if (!text && !atts.length && !files.length){ delete S.drafts[id]; return }
    S.drafts[id] = { text: text, atts: atts, files: files, at: Date.now() };
    draftTrim();
  } catch(e){}
}
function draftDrop(sid: string): void{
  try { var id = sid ? String(sid) : ''; if (id && S.drafts[id]) delete S.drafts[id] } catch(e){}
}
/* 数据侧：carry 非空=交接链自管（不自管）；先刷目标槽 at 再 stash 旧会话（防 40 槽淘汰删掉正要打开的旧草稿）；
   返回目标会话草稿槽（或 null）。三语义（carry/同 id/无槽）由调用点显式判断，不拿 null 当哨兵。 */
function draftSwitch(prevSid: string, nextSid: string, carry?: any): any{
  if (carry) return null;
  var prev = prevSid ? String(prevSid) : '', next = nextSid ? String(nextSid) : '';
  if (!next) return null;
  var slot = S.drafts[next] || null;
  if (slot) slot.at = Date.now();
  if (prev && prev !== next) draftStash(prev);
  return slot;
}
/* DOM 侧回填：有槽→text/atts/files + autoGrow + renderAtts + holdBarSync；
   无槽且 keepEmpty=false→清空；无槽且 keepEmpty=true→不动（首开空白页/归档后无归属时保护已输入内容） */
function draftRestore(slot: any, keepEmpty?: boolean): void{
  try {
    if (!slot && keepEmpty) return;
    var ta = $('#input');
    if (ta){ ta.value = slot && typeof slot.text === 'string' ? slot.text : ''; autoGrow() }
    S.atts = (slot && slot.atts) ? slot.atts.slice() : [];
    S.files = (slot && slot.files) ? slot.files.slice() : [];
    renderAtts();
    if (typeof holdBarSync === 'function') holdBarSync(); /* 手机待机条跟随草稿恢复（方案审 v2 P1-4） */
  } catch(e){}
}
function restoreDraft(sid: string): void{
  var p = pendingOf(sid); if (!p) return;
  var txt = (typeof p.text === 'string') ? p.text : ''; /* task77 §4.4：只回填原文，不带引用块 */
  var id = sid ? String(sid) : '';
  if (!txt || !id) return;
  /* task391（方案审 P0-1）：不在当前会话只写它的草稿槽，绝不动当前输入框——防 A 的失败原文串进 B 并持久成 B 的草稿 */
  if (!S.current || String(S.current.id) !== id){
    try {
      var d = S.drafts[id];
      if (!d) S.drafts[id] = { text: txt, atts: [], files: [], at: Date.now() };
      else if (!d.text){ d.text = txt; d.at = Date.now() }
      draftTrim();
    } catch(e){}
    return;
  }
  var ta = $('#input'); if (!ta || ta.value.trim()) return;
  ta.value = txt; autoGrow();
  draftStash(id);
}
function send(): void{
  var ta = $('#input'), text = ta.value.trim();
  if (!text && !S.atts.length && !(S.files && S.files.length)) return;
  if (!S.current){ toast('请先新建或打开一个对话', true); ta.focus(); return }
  /* task376：主人亲手在「已交接注销」的旧会话里发消息 = 要它复活 → 先解除冻结，防消息入队卡住无回应 */
  if (S.current && S.current.id && S._retiredSids[S.current.id]){
    delete S._retiredSids[S.current.id];
    try {
      fetch('/_queue/resume', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: S.current.id }) }).catch(function(){});
    } catch(e){}
  }
  /* task80 S2b：500ms 内同文本重复点击只发一次（proxy 侧 queueEnqueue 另有去重兜底） */
  var now = Date.now();
  if (text && text === Q_SEND_TXT && now - Q_SEND_AT < 500) return;
  Q_SEND_TXT = text; Q_SEND_AT = now;
  voiceReset(); /* 手动打字发送 = 退出语音等待/停朗读（自动切会话不解除，见 VOICE 段注释） */
  /* task327：closeAttachPanel 随三瓷砖面板退役——＋ 直弹系统选择器，无自绘面板可收 */
  var atts = S.atts;
  var files = S.files || []; /* task178：文本附件随发送一并带走 */
  S.atts = []; S.files = []; renderAtts();
  ta.value = ''; autoGrow();
  try { draftDrop(S.current.id) } catch(e){} /* task391：本会话草稿随发送清槽（异常不得拦消息真发） */
  queuePrompt(text, atts, files);
}
function queuePrompt(text: string, atts?: any, files?: any): void{
  if (!S.current) return;
  var qs = quoteTexts(); /* task394（主人 2026-11-23）：多引用逐条累积，不再互相覆盖；快照，后面清状态不影响本条 */
  var sendText = qs.length ? qs.map(function(x){ return Q_HEAD + x + Q_TAIL }).join('') + text : text;
  /* task178：文本附件内容拼进正文（方案审 P1-3 主案——不新增独立 text part，规避 serve 多 text part 未实测的静默丢弃） */
  var blocks = (files || []).map(function(f){ return '--- 文件：' + (f.name || 'file') + ' ---\n' + (f.text || '') });
  if (blocks.length) sendText = (sendText ? sendText + '\n\n' : '') + blocks.join('\n\n');
  var parts = [];
  if (sendText) parts.push({ type: 'text', text: sendText });
  (atts || []).forEach(function(a){ parts.push({ type: 'file', mime: a.mime, filename: a.name, url: a.url }) });
  if (!parts.length) return;
  var echo = parts.map(function(p){ return structuredClone(p) });
  var sid = S.current.id;
  var localId = 'local-' + Date.now();
  var box = $('#messages');
  if (box.querySelector('.empty')) box.replaceChildren();
  var p = { sid: sid, localId: localId, at: Date.now(), parts: parts, echo: echo, text: text, accepted: false, confirmed: false };
  S.pending[sid] = p;
  if (qs.length){ S.quote = null; renderQuote() } /* task77 §4.1 + task394：入队即清 UI，引用已固化进 parts */
  S._quoteSeq = 0; /* task395：输入框内的【引用N】已随正文发出，序号清零重计 */
  box.appendChild(buildPendingNode(p));
  S._msgsComplete = false; /* task312：乐观用户气泡不在服务端快照里，离场不缓存半截 */
  scrollBottom();
  pruneThinking();
  // 先发请求，再做界面状态：任何 UI 异常都不能再拦住消息真正发出去
  submitPrompt(sid, localId);
  try {
    markBusy(sid, true); S.busy = true; S.lastAct = Date.now(); S.warned = false;
    toggleBusyUI(); renderTitle();
  } catch (e) {}
}
var AGENT_CAP_TTL = 5 * 60 * 1000;
function resolveButler(dir: string, cb: (agent: string) => void): void{
  var c = dir && S.agentCaps[dir];
  if (c && Date.now() - c.at < AGENT_CAP_TTL) return cb(c.agent);
  if (!dir) return cb('');
  fetch('/api/agent?directory=' + encodeURIComponent(dir)).then(function(r){ return r.json() }).then(function(list){
    var hit = (list || []).filter(function(x){ return x.name === BUTLER_AGENT && x.mode === 'primary' })[0];
    S.agentCaps[dir] = { agent: hit ? BUTLER_AGENT : '', at: Date.now() };
    cb(hit ? BUTLER_AGENT : '');
  }).catch(function(){ S.agentCaps[dir] = { agent: '', at: Date.now() }; cb('') });
}
function submitPrompt(sid: string, localId: string): void{
  var p = pendingOf(sid); if (!p || p.localId !== localId) return;
  var cur = (S.current && S.current.id === sid) ? S.current : null;
  // 小管家子会话沿用原 agent，不再被大管家覆盖
  if (cur && cur.parentID) return doSubmitPrompt(sid, localId, '');
  var dir = cur ? (cur.directory || '') : '';
  resolveButler(dir, function(agent){ doSubmitPrompt(sid, localId, agent) });
}
function doSubmitPrompt(sid: string, localId: string, agent: string): void{
  var p = pendingOf(sid); if (!p || p.localId !== localId) return;
  var ctrl = null;
  try { if (typeof AbortController !== 'undefined') ctrl = new AbortController() } catch(e){}
  var timer = setTimeout(function(){ if (ctrl){ try { ctrl.abort() }catch(e){} } }, 30000);
  var body: any = { parts: p.parts, model: { providerID: S.model.providerID, modelID: S.model.modelID } };
  if (agent) body.agent = agent;
  var opt: any = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  if (ctrl) opt.signal = ctrl.signal;
  fetch('/api/session/' + sid + '/prompt_async', opt).then(function(r){
    clearTimeout(timer);
    return r.text().then(function(t){
      var d = null; try { d = JSON.parse(t || '{}') } catch(e){}
      /* task80 S2b：busy/有队列时 proxy 回 202 → 已入队，本地不建 pending、不算失败 */
      if (r.status === 409 && d && d.error === 'queue_full'){ queueFull(sid, localId, d); return false }
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + String(t || '').slice(0, 160));
      if (d && (d.queued || d.deduped)){ queueAccepted(sid, localId, d); return false }
      return true;
    });
  }).then(function(accepted){
    if (accepted === false) return;
    var cur = pendingOf(sid); if (!cur || cur.localId !== localId) return;
    cur.accepted = true;
    var node = $('#messages').querySelector('[data-mid="' + localId + '"]');
    setSendState(node, '已发送，等待回应…', false);
    // task209：20 秒无回显的红色提示（含「重发」）已按主人要求撤除，不再打扰；发送失败态的重发仍在 catch 分支
  }).catch(function(e){
    clearTimeout(timer);
    var cur = pendingOf(sid); if (!cur || cur.localId !== localId) return;
    var msg = (e && e.name === 'AbortError') ? '请求超时（30 秒）' : String((e && e.message) || e || '网络错误');
    var node = $('#messages').querySelector('[data-mid="' + localId + '"]');
    if (node){
      node.classList.remove('pending'); node.classList.add('failed');
      var st = setSendState(node, '发送失败：' + msg + '  ', true);
      var b = el('button', null, '重发');
      b.onclick = function(){ retryPending(sid) };
      st.appendChild(b);
    }
    if (S.current && S.current.id === sid){ markBusy(sid, false); S.busy = false; toggleBusyUI() }
    restoreDraft(sid);
    toast('消息没有发出去：' + msg, true, 4200);
  });
}
function retryPending(sid: string): void{
  var p = pendingOf(sid); if (!p) return;
  var node = $('#messages').querySelector('[data-mid="' + p.localId + '"]');
  if (node){
    node.classList.remove('failed'); node.classList.add('pending');
    var st = setSendState(node, '发送中…', false);
  }
  submitPrompt(sid, p.localId);
  try {
    markBusy(sid, true);
    if (S.current && S.current.id === sid){ S.busy = true; toggleBusyUI(); renderTitle() }
  } catch (e) {}
}
/* task195：retryLast 随「刷新」按钮退役删除（唯一调用点=消息操作按钮 retry 分支，已改 stop）；发送失败气泡的 retryPending 保留不动 */
// 兜底：页面脚本异常/未处理的 Promise 失败必须让主人看见，不能再出现「点了发送什么都没发生」
function stopTask(): void{
  if (!S.current) return;
  var sid = S.current.id;
  api('/session/' + sid + '/abort', { method: 'POST', body: {} })
    .then(function(){ markBusy(sid, false); if (S.current && S.current.id === sid){ S.busy = false; toggleBusyUI(); renderTitle() } })
    .catch(function(e){ markBusy(sid, false); if (S.current && S.current.id === sid){ S.busy = false; toggleBusyUI(); renderTitle() } alert('停止失败：' + e.message) });
}
function toggleBusyUI(): void{
  /* task80 S2b：发送键永久常绿——busy 时不隐藏、不禁用（连发由 proxy 队列串行承接）；
     停止入口只保留 task79 迁到右栏刷新钮旁的独立 #btnStop，本函数不再新增第二颗 */
  var bs = $('#btnSend'); if (bs) bs.disabled = false;
  $('#btnStop').style.display = S.busy ? 'grid' : 'none';
}
window.AGENT_CAP_TTL=AGENT_CAP_TTL; window.toast=toast; window.pendingOf=pendingOf; window.clearPending=clearPending; window.setSendState=setSendState; window.buildPendingNode=buildPendingNode; window.appendPending=appendPending; window.pendingConfirmed=pendingConfirmed; window.reconcilePending=reconcilePending; window.restoreDraft=restoreDraft; window.draftStash=draftStash; window.draftRestore=draftRestore; window.draftDrop=draftDrop; window.draftSwitch=draftSwitch; window.draftTrim=draftTrim; window.send=send; window.queuePrompt=queuePrompt; window.resolveButler=resolveButler; window.submitPrompt=submitPrompt; window.doSubmitPrompt=doSubmitPrompt; window.retryPending=retryPending; window.stopTask=stopTask; window.toggleBusyUI=toggleBusyUI;

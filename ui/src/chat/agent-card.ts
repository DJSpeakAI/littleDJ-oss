/* @module agent-card @order 14 @职责 小管家子代理卡片 @提供 agentSid taskOrdinal reportState agentLineState applyAgentCard lastUserText dedupeTaskTitle renderAgentCard @依赖 - @依赖运行期 S taskReceiptState navTasksFocus @DOM契约 - @严格模式 是 @全局占用 agentSid taskOrdinal reportState agentLineState applyAgentCard lastUserText dedupeTaskTitle renderAgentCard @源行 ui/index.html L4025-L4103 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 小管家卡片（主对话内联子代理结果） ---------- */
/* v0.076（T09/task19 §2.3）：状态卡收敛为单行 .acard-line；回报卡 renderTaskInjected 原样保留；
   原「每卡 4 秒拉子会话消息」的轮询链整体退役（v0.075 及之前版本），状态只按 part.state 派生 */
function agentSid(part: any): string{ return (part && part.state && part.state.metadata && part.state.metadata.sessionId) || '' }
function taskOrdinal(part: any): number{
  var msgs = S.lastMsgs || [], n = 0;
  for (var i = 0; i < msgs.length; i++){
    if ((msgs[i].info || {}).role !== 'assistant') continue;
    var ps = msgs[i].parts || [];
    for (var j = 0; j < ps.length; j++){
      var p = ps[j];
      if (p.type !== 'tool' || p.tool !== 'task') continue;
      n++;
      if (p === part || (p.id && part.id && p.id === part.id) || (p.callID && part.callID && p.callID === part.callID)) return n;
    }
  }
  return n + 1;
}
function reportState(s: any): string{
  var m = /(?:^|\n)\s*state:\s*(done|waiting|blocked|failed)\b/i.exec(s || '');
  return m ? m[1].toLowerCase() : '';
}
// 单行状态派生：受理回执（completed 但 output 是 <task state=running>）归回 running（taskReceiptState，v0.069）
function agentLineState(part: any): { cls: string; txt: string }{
  var st = (part && part.state) || {};
  var receipt = taskReceiptState(st);
  if (receipt) return { cls: 'running', txt: '后台执行中' };
  var status = st.status || '';
  var out = String(st.output || '');
  var m = out.match(/^<task\s+id="[^"]+"\s+state="([^"]+)"/);
  var inner = m ? m[1] : '';
  if (st.error || status === 'error' || inner === 'failed' || inner === 'error') return { cls: 'failed', txt: '失败' };
  if (inner === 'waiting') return { cls: 'waiting', txt: '等待主人' };
  if (inner === 'blocked') return { cls: 'blocked', txt: '受阻' };
  if (status === 'completed' || inner === 'completed' || inner === 'done') return { cls: 'done', txt: '已完成' };
  return { cls: 'running', txt: '后台执行中' };
}
function applyAgentCard(part: any, line?: HTMLElement): void{
  var node = line || document.querySelector('.acard-line[data-pid="' + ((part && part.id) || '') + '"]');
  if (!node) return;
  var s = agentLineState(part);
  var st = node.querySelector('.acard-line-st');
  if (st){ st.className = 'acard-line-st ' + s.cls; st.textContent = s.txt }
}
function lastUserText(): string{
  var msgs = S.lastMsgs || [];
  for (var i = msgs.length - 1; i >= 0; i--){
    var m = msgs[i];
    if ((m.info || {}).role !== 'user') continue;
    var t = (m.parts || []).filter(function(p){ return p.type === 'text' && p.text }).map(function(p){ return String(p.text) }).join(' ').trim();
    if (t) return t;
  }
  return '';
}
// 派单标题去重：与主人最近一条消息原文相同/互含时不再逐字显示（防「little DJ 复述原话」观感）
function dedupeTaskTitle(title: unknown): string{
  var t = String(title || '').trim();
  var src = lastUserText().replace(/\s+/g, '');
  if (t && src && src.length >= 4){
    var flat = t.replace(/\s+/g, '');
    if (flat.indexOf(src) >= 0 || src.indexOf(flat) >= 0) return '已派小管家（原文随派单，不在此复述）';
  }
  return t;
}
function renderAgentCard(part: any, count?: number){
  var sid = agentSid(part);
  var line = el('div', 'acard-line');
  line.dataset.taskSid = sid || '';
  line.dataset.pid = part.id || '';
  var n = count || taskOrdinal(part);
  var s = agentLineState(part);
  line.appendChild(el('span', 'acard-line-ico', '◇'));
  line.appendChild(el('span', 'acard-line-who', '小管家' + ((count && n > 1) ? ' ×' + n : ' ' + n)));
  line.appendChild(el('span', 'acard-line-st ' + s.cls, s.txt));
  line.appendChild(el('span', 'acard-line-go', '左栏查看'));
  line.title = '任务在左栏所属项目下，点此展开并定位';
  line.onclick = function(){ navTasksFocus(sid) };
  return line;
}
window.agentSid=agentSid; window.taskOrdinal=taskOrdinal; window.reportState=reportState; window.agentLineState=agentLineState; window.applyAgentCard=applyAgentCard; window.lastUserText=lastUserText; window.dedupeTaskTitle=dedupeTaskTitle; window.renderAgentCard=renderAgentCard;

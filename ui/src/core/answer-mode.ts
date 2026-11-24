/* @module answer-mode @order 51 @职责 回答/任务模式（输入框右胶囊，task395） @提供 ANSWER_META answerMeta loadAnswer setAnswer renderAnswer @依赖 - @依赖运行期 S toast @DOM契约 #btnAnswer @严格模式 是 @全局占用 ANSWER_META answerMeta loadAnswer setAnswer renderAnswer @源行 -（task395 新增，同构 rest-chain） @测试锚点 - @被调用 - */
'use strict';
/* ---------- 回答/任务模式（task395）：以服务端 /_answer 为唯一真相，失败只置未知（与休息态同构） ----------
   task=默认（可回答同时动代码）；answer=仅回答（禁改文件/跑命令/写码/派单，主人当轮明示才可执行）。
   两态直切无浮层（chain 三态才要菜单）；回答态高亮复用 .restmode.on（橙警示=现在动不了代码）。 */
var ANSWER_META: Record<string, { icon: string; label: string; tip: string }> = {
  task:   { icon: '🛠', label: '任务', tip: '任务模式：可回答同时动代码' },
  answer: { icon: '💬', label: '回答', tip: '回答模式：仅回答，不动代码/不跑命令/不派单；主人本轮明确下达执行指令才可执行（优先于休息态/链路模式）' }
}
function answerMeta(){ return ANSWER_META[S.answer.mode] || ANSWER_META.task }
function loadAnswer(): Promise<void>{
  return fetch('/_answer').then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d){
    S.answer.mode = (d && ANSWER_META[d.mode]) ? d.mode : 'task';
    S.answer.since = (d && d.since) || null;
    S.answer.unknown = false;
    renderAnswer();
  }).catch(function(){
    S.answer.unknown = true;
    renderAnswer();
  });
}
function setAnswer(mode: string): Promise<void>{
  if (!ANSWER_META[mode] || S.answer.unknown) return Promise.resolve();
  return fetch('/_answer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: mode, source: 'button' }) })
    .then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function(d){
      S.answer.mode = (d && ANSWER_META[d.mode]) ? d.mode : 'task';
      S.answer.since = (d && d.since) || null;
      S.answer.unknown = false;
      renderAnswer();
      var m = answerMeta();
      toast('已切「' + m.label + '」：' + m.tip, false, 3200);
    }).catch(function(e){
      renderAnswer(); /* 失败保留原态，不做乐观写入 */
      toast('回答/任务切换失败：' + (e && e.message ? e.message : '网络异常'), true);
    });
}
function renderAnswer(): void{
  var b = $('#btnAnswer'); if (!b) return;
  var m = answerMeta();
  var known = !S.answer.unknown;
  b.classList.toggle('unknown', !known);
  b.classList.toggle('on', known && S.answer.mode === 'answer'); /* 回答态高亮（.restmode.on 橙警示） */
  var ic = b.querySelector('.answericon'); /* 产审 P1-2：图标随态更新（手机端 label 收圆后唯一可辨标识） */
  if (ic) ic.textContent = known ? m.icon : '❓';
  var lb = b.querySelector('.answerlabel');
  if (lb) lb.textContent = known ? m.label : '未知';
  b.setAttribute('aria-pressed', S.answer.mode === 'answer' ? 'true' : 'false');
  b.title = known ? (m.tip + '（点击切换）') : '回答/任务状态未知';
}
window.ANSWER_META=ANSWER_META; window.answerMeta=answerMeta; window.loadAnswer=loadAnswer; window.setAnswer=setAnswer; window.renderAnswer=renderAnswer;

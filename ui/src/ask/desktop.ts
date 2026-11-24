/* @module desktop @order 46 @职责 桌面右键呼出划词浮层 @提供 selRangeRect pointInSelRect copyText legacyCopy ensureSoundDefaultsMigrated @依赖 - @依赖运行期 toast @DOM契约 - @严格模式 是 @全局占用 selRangeRect pointInSelRect copyText legacyCopy ensureSoundDefaultsMigrated @源行 ui/index.html L12997-L13113 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task311：桌面右键呼出划词浮层（问 AI/复制/引用） ----------
   主人原话（2026-11-15）：「现在划词之后直接出现，不是我想要的体验，右键鼠标出现」。
   右键序列：pointerdown → mousedown →（浏览器默认行为可能折叠选区）→ contextmenu。
   所以 mousedown 先存快照；contextmenu 时鼠标点必须落在选区框内才接管（点选区外保留系统菜单，
   输入框/编辑器/问 AI 小窗仍让给原生，判据与 askSelAllowed 同口径）。 */
function selRangeRect(sel?){
  try { return sel.getRangeAt(0).getBoundingClientRect() } catch(e){ return null }
}
function pointInSelRect(x?, y?, rect?){
  if (!rect) return false;
  var pad = 4;
  return x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad;
}
function copyText(text?, done?){
  text = String(text == null ? '' : text);
  if (navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(function(){ done && done(true) }, function(){ done && done(legacyCopy(text)) });
    return;
  }
  done && done(legacyCopy(text));
}
function legacyCopy(text?){
  try{
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.top = '-1000px'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, ta.value.length);
    var ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  }catch(e){ return false }
}


/* task97 W-D：存量旧默认一次性迁移（仅值 === 'drop' 的旧默认改 'none'，主人主动选过的音色一律不动）；
   标记 littledj.soundMigrated.v1 写入后永不再写键，尊重主人后续选择；整段 try/catch 不影响首屏 */
function ensureSoundDefaultsMigrated(){
  try {
    if (localStorage.getItem('littledj.soundMigrated.v1')) return;
    var changed = 0;
    ['littledj.agentSound', 'littledj.tuiAgentSound'].forEach(function(k){
      if (localStorage.getItem(k) === 'drop'){ localStorage.setItem(k, 'none'); changed++; }
    });
    localStorage.setItem('littledj.soundMigrated.v1', '1');
    if (changed) toast('其他角色/子代理提示音已按新默认关闭（若您此前主动选过音色，可在 设置→音效 重新开启）', false, 6000);
  } catch(e){}
}
window.selRangeRect=selRangeRect; window.pointInSelRect=pointInSelRect; window.copyText=copyText; window.legacyCopy=legacyCopy; window.ensureSoundDefaultsMigrated=ensureSoundDefaultsMigrated;

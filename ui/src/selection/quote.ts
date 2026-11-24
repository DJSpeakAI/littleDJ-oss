/* @module quote @order 44 @职责 划词引用/复制浮层 @提供 Q_HEAD Q_TAIL Q_MAX STABLE_MS _selText _selStamp _selTimer _touchSelAt _rmbSel isTouchUI selMenuNode selMenuOpen closeSelMenu showSelMenu showSelMenuAt onSelChange quoteShort renderQuote clearQuote removeQuoteAt quoteTexts setQuote insertQuoteInput copySel quoteSel quoteSelNew @依赖 - @依赖运行期 askSelAllowed S toast copyText createSession autoGrow @DOM契约 - @严格模式 是 @全局占用 Q_HEAD Q_TAIL Q_MAX STABLE_MS _selText _selStamp _selTimer _touchSelAt _rmbSel isTouchUI selMenuNode selMenuOpen closeSelMenu showSelMenu showSelMenuAt onSelChange quoteShort renderQuote clearQuote removeQuoteAt quoteTexts setQuote insertQuoteInput copySel quoteSel quoteSelNew @源行 ui/index.html L12614-L12732 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task77：划词引用与复制浮层（方案稿 §1/§2/§3/§4） ---------- */
/* 引用块标记（§4.1 原文）：只供人和模型阅读、不参与解析；Q_HEAD / Q_TAIL 前端不剥离、proxy 不解析 */
var Q_HEAD = '【用户引用了以下内容，请重点围绕这段内容回答】\n', Q_TAIL = '\n【引用内容结束】\n\n';
var Q_MAX = 4000;
function isTouchUI(){
  try { if ('ontouchstart' in window) return true; if (window.matchMedia && window.matchMedia('(pointer:coarse)').matches) return true } catch(e){}
  return false;
}
var STABLE_MS = isTouchUI() ? 450 : 300; /* 唯一机制参数：桌面 300 / 触摸 450（§1.1.1，全文仅此一套值） */
var _selText = '', _selStamp = 0, _selTimer = null; /* 浮层代表的文本：弹出时赋值、按钮只读、关闭即清（§1.6） */
/* task311（主人 2026-11-15）：桌面不再「划词即弹」，改为右键呼出；触摸端没有右键，保留长按选词后自动弹。
   _touchSelAt=最近一次触摸交互（只有触摸选择才走自动弹）；_rmbSel=右键按下瞬间的选区快照
   （Chromium 默认行为会把选区折叠，contextmenu 时可能读不到，只能在 mousedown 先存）。 */
var _touchSelAt = 0, _rmbSel = null;
function selMenuNode(){ return $('#selMenu') }
function selMenuOpen(){ var m = selMenuNode(); return !!(m && !m.hidden) }
function closeSelMenu(){
  _selText = ''; _selStamp++;
  if (_selTimer){ clearTimeout(_selTimer); _selTimer = null }
  var m = selMenuNode(); if (m && !m.hidden) m.hidden = true;
}
function showSelMenu(){
  var m = selMenuNode(), sel = window.getSelection ? window.getSelection() : null;
  if (!m || !sel || sel.rangeCount === 0) return;
  var rect = null; try { rect = sel.getRangeAt(0).getBoundingClientRect() } catch(e){ rect = null }
  if (!rect) return;
  m.hidden = false; /* 先显示再量高，避免不可见时 offsetHeight 为 0（§1.2） */
  var w = m.offsetWidth, h = m.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, top;
  if (isTouchUI()){ top = rect.bottom + 8; if (top + h > vh - 8) top = rect.top - h - 8 } /* 触摸优先下方，贴底翻上 */
  else { top = rect.top - h - 8; if (top < 8) top = rect.bottom + 8 }                       /* 桌面优先上方，贴顶翻下 */
  top = Math.max(8, Math.min(top, vh - h - 8));
  var left = Math.max(8, Math.min(rect.left, vw - w - 8));
  m.style.top = Math.round(top) + 'px'; m.style.left = Math.round(left) + 'px';
}
/* task311：右键呼出——浮层跟着鼠标点走（同系统右键菜单习惯），贴右/贴底自动翻转 */
function showSelMenuAt(x?, y?){
  var m = selMenuNode(); if (!m) return;
  m.hidden = false; /* 先显示再量高（同 showSelMenu） */
  var w = m.offsetWidth, h = m.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  var top = y + 6; if (top + h > vh - 8) top = y - h - 6;
  top = Math.max(8, Math.min(top, vh - h - 8));
  var left = x + 4; if (left + w > vw - 8) left = x - w - 4;
  left = Math.max(8, Math.min(left, vw - w - 8));
  m.style.top = Math.round(top) + 'px'; m.style.left = Math.round(left) + 'px';
}
/* selectionchange 处理器：§1.1 四条显示判据 → 稳定判定 → 定位 */
function onSelChange(){
  var sel = window.getSelection ? window.getSelection() : null;
  /* task280（主人 2026-11-14）：「问 AI」要整页可用（设置 / API Key / 比价 / 文档…都能划词），
     所以判据从「两端都在 #messages 内」放开成 askSelAllowed()——输入框与问 AI 小窗除外。 */
  var ok = askSelAllowed(sel);
  if (!ok){ closeSelMenu(); return }
  if (selMenuOpen()) closeSelMenu(); /* 已显示时选区又变化 ⇒ 先关，再按 STABLE_MS 重新计时（§1.3-3） */
  /* task311（主人 2026-11-15）：鼠标划词不再「选完即弹」——桌面改为右键呼出（bindSelRmb）；
     只有最近 3s 内有触摸交互（长按选词）才继续走稳定判定自动弹，触摸端没有右键可用。 */
  if (!_touchSelAt || Date.now() - _touchSelAt > 3000) return;
  var txt = String(sel.toString() || ''), stamp = ++_selStamp;
  if (_selTimer) clearTimeout(_selTimer);
  _selTimer = setTimeout(function(){
    _selTimer = null; if (stamp !== _selStamp) return;
    var s2 = window.getSelection ? window.getSelection() : null;
    if (!s2 || s2.rangeCount === 0 || s2.isCollapsed) return;
    var t2 = String(s2.toString() || '');
    if (!t2.trim() || t2 !== txt) return; /* 二次确认：文本仍一致才弹 */
    if (!askSelAllowed(s2)) return; /* task280：同主判据 */
    _selText = t2; showSelMenu(); /* 唯一写入时机（§1.6） */
  }, STABLE_MS);
}
function quoteShort(s?){
  var t = String(s == null ? '' : s).replace(/\n+/g, ' ').trim();
  return t.length < 6 ? t : t.slice(0, 5) + '…'; /* 前 5 字 + …；<6 字原样 */
}
function renderQuote(){ /* 唯一渲染入口，容忍 S.quote === null；task394：数组=多条引用逐条排开 */
  var row = $('#quoteRow'), list = (S.quote && S.quote.length) ? S.quote : [];
  if (row){
    var html = '';
    for (var i = 0; i < list.length; i++){
      html += '<span class="qmark">❝</span><span class="qlabel">引用：' + quoteShort(list[i].text) + '</span><button class="qx" data-i="' + i + '" title="取消这条引用">✕</button>';
    }
    html += '<div class="qfull"></div>';
    row.innerHTML = html;
    var full = row.querySelector('.qfull');
    if (full) full.textContent = list.map(function(x){ return x.text }).join('\n\n——\n\n');
    if (!list.length) row.classList.remove('open'); /* 展开态不持久（§3.2） */
    row.hidden = !list.length;
  }
  closeSelMenu(); /* 视图归位时不留旧浮层 */
}
function clearQuote(){ S.quote = null; renderQuote() }
function removeQuoteAt(i){ /* task394：单条删除，剩下的保留 */
  if (!(S.quote && S.quote.length)) return;
  S.quote.splice(i, 1);
  if (!S.quote.length) S.quote = null;
  renderQuote();
}
function quoteTexts(){ /* task394：给 send 的快照取数；兼容 null/旧单对象形状 {text}（自测桩按 task77 口径造 S.quote） */
  if (!S.quote) return [];
  if (!Array.isArray(S.quote)) return S.quote.text ? [String(S.quote.text)] : [];
  return S.quote.map(function(x){ return String(x && x.text || '') }).filter(Boolean);
}
function setQuote(t?){
  var s = String(t == null ? '' : t).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim(); /* 换行统一 + 3 个以上空行压成 1 个 + 裁剪首尾（§3.1） */
  if (!s) return;
  var cut = s.length > Q_MAX; if (cut) s = s.slice(0, Q_MAX);
  /* task394（主人 2026-11-23）：多次划词=逐条累积，不再覆盖旧的；连续同文只记一条；上限 8 条 */
  var arr = (S.quote && S.quote.length) ? S.quote : [];
  if (!(arr.length && arr[arr.length - 1].text === s)) arr.push({ text: s, at: Date.now() });
  while (arr.length > 8) arr.shift();
  S.quote = arr;
  renderQuote();
  if (cut) toast('引用过长，已截断到 4000 字', true);
}
function copySel(){ /* 只读弹出时缓存的 _selText（§1.6/§2） */
  var t = _selText; if (!t) return;
  copyText(String(t).replace(/\r\n/g, '\n'), function(ok){
    if (!ok){ toast('复制失败，请手动选中复制', true); return } /* 失败保留浮层供重试 */
    closeSelMenu(); toast('已复制');
  });
}
function quoteSel(){ var t = _selText; if (!t) return; insertQuoteInput(t); closeSelMenu() }
/* task395（主人 2026-11-23 晚）：改成 DJH 的方式——引用直接插进输入框正文（引用→说话→引用→说话 交替），
   模型能对上「哪句话针对哪个引用」。引用块 =【引用N】+ markdown > 逐行；N 为本会话本次发送前的累计序号，
   发送成功后 send 侧清零。输入框内容随 draft 体系按会话保存，天然隔离。 */
function insertQuoteInput(t?){
  var s = String(t == null ? '' : t).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return;
  var cut = s.length > Q_MAX; if (cut) s = s.slice(0, Q_MAX);
  var ta: any = document.getElementById('input');
  if (!ta){ setQuote(s); return } /* 输入框不在（极端）就退回旧通道 */
  S._quoteSeq = (Number(S._quoteSeq) || 0) + 1;
  var quoted = s.split('\n').map(function(l){ return '> ' + l }).join('\n');
  var block = '【引用' + S._quoteSeq + '】\n' + quoted + '\n';
  var cur = String(ta.value || '');
  var pre = (cur && !/\n$/.test(cur)) ? '\n' : ''; /* 已有内容且末尾没换行就补一个，别粘在话尾巴上 */
  ta.value = cur + pre + block;
  try { ta.focus(); var n = ta.value.length; ta.setSelectionRange(n, n) } catch(e){}
  try { autoGrow() } catch(e){}
  toast('已放进输入框，在引用下面接着说');
  if (cut) toast('引用过长，已截断到 4000 字', true);
}
/* task394（主人 2026-11-23）：划词「新会话引用」——同项目新建会话并自动把这段引用填进新输入框
   （学 DJH dsh-quote-menu 的「新建会话」；小 DJ 无 fork，用 createSession 同目录新开） */
function quoteSelNew(){
  var t = _selText; if (!t) return;
  closeSelMenu();
  var dir = (S.current && S.current.directory) ? String(S.current.directory) : '';
  if (!dir){ insertQuoteInput(t); toast('先在一个会话里划词，再「新会话引用」', true); return }
  toast('新会话建立中…', false, 1500);
  createSession(dir, function(sess, err){
    if (!sess){ insertQuoteInput(t); toast('新会话没建成，引用已放进当前输入框', true); return }
    S._quoteSeq = 0; /* 新会话从引用1 重新计 */
    insertQuoteInput(t); /* openSession 已在 cb 前切换输入框，这里落进新会话 */
  }, { noMarkActive: true });
}
/* §1.3 关闭条件：点浮层外 / 滚动 / 选区变化 / 执行成功 / resize·visibility / Esc / 切会话（§3.5） */
window.Q_HEAD=Q_HEAD; window.Q_TAIL=Q_TAIL; window.Q_MAX=Q_MAX; window.STABLE_MS=STABLE_MS; window._selText=_selText; window._selStamp=_selStamp; window._selTimer=_selTimer; window._touchSelAt=_touchSelAt; window._rmbSel=_rmbSel; window.isTouchUI=isTouchUI; window.selMenuNode=selMenuNode; window.selMenuOpen=selMenuOpen; window.closeSelMenu=closeSelMenu; window.showSelMenu=showSelMenu; window.showSelMenuAt=showSelMenuAt; window.onSelChange=onSelChange; window.quoteShort=quoteShort; window.renderQuote=renderQuote; window.clearQuote=clearQuote; window.removeQuoteAt=removeQuoteAt; window.quoteTexts=quoteTexts; window.setQuote=setQuote; window.insertQuoteInput=insertQuoteInput; window.copySel=copySel; window.quoteSel=quoteSel; window.quoteSelNew=quoteSelNew;

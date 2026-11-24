/* @module context @order 19 @职责 上下文百分比 + 余额 @提供 _ctxMapBusy _balanceBusy fetchCtxMap sessCtxWin convCtxInfo convCtxPill setCtxUsageLevel syncCtxNewBtn syncCtxDangerState fetchBalance syncBalanceLabel @依赖 - @依赖运行期 S scheduleSidebar getContextK ctxLevel ctxThreshold fmtTok isButlerSession updateUsage sysRender @DOM契约 - @严格模式 是 @全局占用 _ctxMapBusy _balanceBusy fetchCtxMap sessCtxWin convCtxInfo convCtxPill setCtxUsageLevel syncCtxNewBtn syncCtxDangerState fetchBalance syncBalanceLabel @源行 ui/index.html L5213-L5314 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task189：会话行上下文百分比（数据链 /_ctxmap，60s 低频；全部会话行通用） ---------- */
var _ctxMapBusy = false;
function fetchCtxMap(): void{
  if (_ctxMapBusy) return;
  _ctxMapBusy = true;
  fetch('/_ctxmap').then(function(r){ return r.json() }).then(function(d){
    _ctxMapBusy = false;
    if (!d || !d.ok || !d.map) return; /* 失败静默，下轮重试（不弹 toast，低价值噪音） */
    var sig = JSON.stringify(d.map);
    if (sig === S.ctxMap.sig) return; /* P2-4：内容零变化不 ver++，防每 60s 全栏重绘空转 */
    S.ctxMap.map = d.map; S.ctxMap.sig = sig; S.ctxMap.ver++;
    scheduleSidebar();
  }).catch(function(){ _ctxMapBusy = false });
}
/* 会话模型窗口：按该会话最近 assistant 的 provider/model 匹配 S.models 的 limit.context；
   匹配不到（模型已下线/字段缺）回落设置兜底 getContextK（与顶部胶囊同兜底口径） */
function sessCtxWin(p: any, m: any){
  for (var i = 0; i < (S.models || []).length; i++){
    var x = S.models[i];
    if (x.providerID === p && x.modelID === m && x.ctx > 0) return x.ctx;
  }
  return getContextK() * 1000;
}
function convCtxInfo(sid: string){
  var rec = (S.ctxMap && S.ctxMap.map) ? S.ctxMap.map[sid] : null;
  if (!rec || !(rec.u > 0)) return null;
  var win = sessCtxWin(rec.p, rec.m);
  if (!(win > 0)) return null;
  var pct = rec.u / win * 100;
  return { pct: pct, used: rec.u, win: win, lvl: ctxLevel(pct, ctxThreshold()) };
}
/* pill 类名独立（ctxp-*，L-048：禁止直接复用 #usage 的 ctx-ok/warn/danger，全局色规则会外溢） */
function convCtxPill(sid: string, cls: string){
  var info = convCtxInfo(sid);
  if (!info) return null;
  var e = el('span', cls + ' ctxp-' + info.lvl, Math.round(info.pct) + '%');
  e.title = '上下文 ' + info.pct.toFixed(1) + '%（' + fmtTok(info.used) + '/' + fmtTok(info.win) + ' tokens）· 口径：最近一条回复实际读入 ÷ 该会话模型窗口 · 60s 刷新';
  return e;
}
// 换档：先清三个档位 class 再挂当前档；同一处同步红档横幅与「新开并交接」按钮，避免两处状态打架
function setCtxUsageLevel(level: string): void{
  var u = $('#usage');
  if (u){
    u.classList.remove('ctx-ok', 'ctx-warn', 'ctx-danger');
    u.classList.add('ctx-' + level);
  }
  syncCtxNewBtn(level);
  syncCtxDangerState(level);
}
// S5b：按钮显隐唯一出口（口径按契约：仅 danger 显示，非 danger 隐藏）
function syncCtxNewBtn(level: string): void{
  var b = $('#ctxNewBtn');
  if (b) b.hidden = (level !== 'danger');
}
// task362：红档提醒横幅按主人要求删除（2026-11-16）——留言区不再插任何提醒条；
// 本函数只保留红档快照（源会话身份/百分比），供 sse/handoff 在在途任务收口后重试自动新开。
// 手动入口仍是输入栏右侧 #ctxNewBtn「新开并交接」（仅 danger 显示），语义不变。
function syncCtxDangerState(level: string): void{
  var show = (level === 'danger') && isButlerSession(S.current);
  /* task106 P1-1：红档判定即固化源会话身份与阈值，供任意会话收口 idle 后重试自动新开；
     切到别的会话不清快照（否则切走场景永远不触发），只由源会话自身降档或切换成功清空 */
  if (show && S.current && S.current.id){
    S._ctxDangerSid = S.current.id;
    S._ctxDangerPct = S.ctxPct || 0;
  } else if (S._ctxDangerSid && S.current && S.current.id === S._ctxDangerSid){
    S._ctxDangerSid = ''; S._ctxDangerPct = 0;
  }
}
var _balanceBusy = false;
function fetchBalance(cb?: any): void{
  if (_balanceBusy) return;
  _balanceBusy = true;
  fetch('/_settings/deepseek/balance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(function(r){ return r.json() }).then(function(d){
      _balanceBusy = false;
      if (d && d.ok){ S.balance = d.balance || ''; updateUsage(S.lastMsgs || []); syncBalanceLabel() }
      if (cb) cb(d);
    }).catch(function(e){ _balanceBusy = false; if (cb) cb({ ok: false, error: e.message }) });
}
function syncBalanceLabel(): void{
  /* task214：设置页 API 子页退役后原余额标签元素已不存在——本函数只保留「计费口径变化即时同步右上角胶囊」 */
  sysRender();
}

window._ctxMapBusy=_ctxMapBusy; window._balanceBusy=_balanceBusy; window.fetchCtxMap=fetchCtxMap; window.sessCtxWin=sessCtxWin; window.convCtxInfo=convCtxInfo; window.convCtxPill=convCtxPill; window.setCtxUsageLevel=setCtxUsageLevel; window.syncCtxNewBtn=syncCtxNewBtn; window.syncCtxDangerState=syncCtxDangerState; window.fetchBalance=fetchBalance; window.syncBalanceLabel=syncBalanceLabel;

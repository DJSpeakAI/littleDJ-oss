/* @module xdevice @order 50 @职责 跨端状态同步轮询（hidden/会话列表 diff + 先探后标忙） @提供 XDEV_TICK_MS XDEV_SESS_EVERY XDEV_PROBE_MAX XDEV_FETCH_TIMEOUT_MS _xdBusy _xdTick _xdHiddenMemo _xdSessSeen _xdProbeQ _xdProbeSet _xdProbeTry _xdNeedReload _xdVisBound xdeviceFetchJson xdeviceHiddenKey xdeviceDiffHidden xdeviceSessKey xdeviceDiffSessions xdeviceApplyHidden xdeviceApplySessions xdeviceProbe xdeviceProbeMsg xdeviceReconcile xdeviceBindVisibility @依赖 - @依赖运行期 S api loadSessions renderSidebar markBusy inferBusy kaActive POP_TAB _busyRecoAt S_ENDED @DOM契约 - @严格模式 是 @全局占用 XDEV_TICK_MS XDEV_SESS_EVERY XDEV_PROBE_MAX XDEV_FETCH_TIMEOUT_MS _xdBusy _xdTick _xdHiddenMemo _xdSessSeen _xdProbeQ _xdProbeSet _xdProbeTry _xdNeedReload _xdVisBound xdeviceFetchJson xdeviceHiddenKey xdeviceDiffHidden xdeviceSessKey xdeviceDiffSessions xdeviceApplyHidden xdeviceApplySessions xdeviceProbe xdeviceProbeMsg xdeviceReconcile xdeviceBindVisibility @源行 ui/index.html L-（新文件 task338） @测试锚点 deploy/selftest-xdevice.js @被调用 index.html 全局定时器区 setInterval + 内联 bootstrap 调 xdeviceBindVisibility（typeof guard） */
'use strict';
/* ---------- task338：跨端状态同步轮询（主人 2026-11-16 凌晨军令「修 L2 审核 轮询」）----------
   两个主诉：
   ①「在干活却显示空闲中，点进对话框才变」——SSE 只订阅当前会话目录，跨目录/跨设备忙事件收不到；
   ②「鸿蒙归档/新会话，Windows 不同步」——hidden 清单前端「启动读一次不轮询」（data.js 旧注释原文）、
     会话列表无周期轮询；唯一纠偏口=点开会话（openSession→inferBusy+loadSessions）。
   方案（censor-plan 方案审 v2 全采纳）：15s tick 拉 /_hidden-sessions（20.9KB/4ms 实测）+ 30s 拉
   /_sessions（409KB/0.15-0.26s 实测，降频防放大）；tu/title/childCount 跳动只当「唤醒信号」——
   未忙候选进 _xdProbeQ，每轮 ≤3 个拉 /session/:id/message 用既有 inferBusy 先探后标（P0-2：
   点开会话/改名/收尾写库也刷 tu，乐观标忙会假执行中；稳态在跑会话已 busy 直接跳过=零额外请求）；
   hidden 键集变化显式 renderSidebar（P0-1：指纹不含 S.hidden，靠 loadSessions 顺带重绘兜不住）。
   readHidden 降级（warning/非 ok）保留旧值防全站归档复活（P1-3）；fetch 全带 8s 超时（P1-5）；
   保活息屏只落数据不重绘、回前台统一补（P1-7，visibilitychange 本模块自注册）。
   边界（P1-6 验收明写）：collectSessions 只回根会话——子会话忙态跨端不覆盖，仍靠台账/等待中链路。 */
var XDEV_TICK_MS = 15000;          /* 基础 tick：hidden 每 tick、sessions 每 2 tick（30s，P1-4 实测降频） */
var XDEV_SESS_EVERY = 2;
var XDEV_PROBE_MAX = 3;            /* 每轮探测上限（P1-2：限探测不限判定；未探测候选跨轮保留不漏标） */
var XDEV_FETCH_TIMEOUT_MS = 8000;  /* P1-5：挂起 fetch 防永久停摆 */
var _xdBusy = false, _xdTick = 0, _xdHiddenMemo = '', _xdSessSeen = null, _xdProbeQ = [], _xdNeedReload = false, _xdVisBound = false;
var _xdProbeSet = {}, _xdProbeTry = {}; /* 产出审 P1-2/P2：入队去重 + 失败重试计数（≤2 次重入队，超限弃权防死循环） */

/* P1-5：统一带 AbortController 超时的 JSON 拉取；超时/失败由调用方 catch 静默（memo 不动下轮重试） */
function xdeviceFetchJson(url){
  var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctl ? setTimeout(function(){ try { ctl.abort() } catch(e){} }, XDEV_FETCH_TIMEOUT_MS) : null;
  var clear = function(){ if (timer){ clearTimeout(timer); timer = null } };
  return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function(r){
    clear(); return r.json();
  }, function(err){ clear(); throw err; });
}
/* hidden 键集签名：排序 join（纯函数，自测断言） */
function xdeviceHiddenKey(list){
  return (Array.isArray(list) ? list.slice() : []).sort().join(',');
}
function xdeviceDiffHidden(memo, list){
  return xdeviceHiddenKey(list) !== memo;
}
/* 会话签名：id|tu|title|childCount（P2-2：title/childCount 变化不带 tu 更新的漏检口） */
function xdeviceSessKey(s){
  if (!s || !s.id) return '';
  return s.id + '|' + (((s.time || {}).updated) || 0) + '|' + String(s.title || '') + '|' + (Number(s.childCount) || 0);
}
/* 纯函数：旧 seen 映射 vs 新列表 → { changed, woke[], next }（自测断言） */
function xdeviceDiffSessions(seen, list){
  var next = {}, woke = [], changed = false, i, s;
  var arr = Array.isArray(list) ? list : [];
  for (i = 0; i < arr.length; i++){
    s = arr[i];
    if (!s || !s.id) continue;
    var k = xdeviceSessKey(s);
    next[s.id] = k;
    if (!seen || !seen[s.id] || seen[s.id] !== k){ changed = true; woke.push(s.id) }
  }
  if (seen){ Object.keys(seen).forEach(function(id){ if (!next[id]) changed = true }) }
  return { changed: changed, woke: woke, next: next };
}
/* P1-3：降级响应（ok!==true / warning）保留旧 S.hidden——readHidden 读失败/坏档回 {hidden:[],warning}，
   整体覆盖=全站归档一次性复活；只 console 记录不 toast（后台对账不打扰）。 */
function xdeviceApplyHidden(d){
  if (!d || d.ok !== true || d.warning){
    if (d && d.warning) console.log('[xdevice] hidden 清单降级，保留旧值：', d.warning);
    return;
  }
  if (!Array.isArray(d.hidden)){ /* 产出审 P2：ok:true 但 hidden 非数组=坏档，当空清单覆盖同样是复活事故 */
    console.log('[xdevice] hidden 响应异常（hidden 非数组），保留旧值');
    return;
  }
  var k = xdeviceHiddenKey(d.hidden);
  var map = {};
  d.hidden.forEach(function(id){ if (id) map[id] = 1 });
  var prevOrder = (S.hiddenOrder || []).join(',');
  S.hidden = map;
  /* task390：顺序镜像（尾部=最近归档）。降级分支已在上面提前 return，此处只在合法响应上覆盖（⚠S 守住） */
  S.hiddenOrder = d.hidden.slice();
  if (k === _xdHiddenMemo){
    /* task390：同键集也要感知顺序变化（另一台设备「恢复 X 又立刻归档 X」会把 id 挪到尾部）——
       归档列表顺序随之更新；息屏不重绘沿用 P1-7 口径，回前台补 */
    if (prevOrder !== d.hidden.join(',')){
      if (document.hidden) _xdNeedReload = true; /* 息屏：回前台补一次，防「回前台补」成为空话（产出审 P2-2） */
      else renderSidebar();
    }
    return;
  }
  _xdHiddenMemo = k;
  if (document.hidden){ _xdNeedReload = true; return } /* P1-7：保活息屏不重绘，回前台补 */
  renderSidebar(); /* P0-1：hidden 变化必须显式重绘——navSidebarSig 指纹不含 S.hidden，别的补帧路径兜不住 */
}
function xdeviceApplySessions(list){
  /* 产出审 P1-3：proxy collectSessions 后端失败时仍回 200+空/部分数组（无 ok 标记）——
     空数组当「全删」处理会让左栏清空（S.sessions=[]），serve 重启窗口每 30s 复现。
     guard：非数组，或空数组而旧 memo 非空 ⇒ 视为异常响应，memo 不推进不清栏，下轮重试。 */
  if (!Array.isArray(list) || (!list.length && _xdSessSeen && Object.keys(_xdSessSeen).length)){
    console.log('[xdevice] sessions 响应异常（非数组/清空型），保留旧值');
    return;
  }
  /* 复审 P1-4：firstRun 必须含「memo 为空对象」——首跑撞上空响应（serve 重启窗口）时 _xdSessSeen 会被
     置 {}，下一轮全量列表若按 firstRun=false 处理，164 根全部入探测队=洪峰重演（3/15s≈14 分钟） */
  var firstRun = !_xdSessSeen || !Object.keys(_xdSessSeen).length; /* 首跑全量 woke=探测洪峰（164 根×全量消息拉取）——首跑只建基线不探测 */
  var r = xdeviceDiffSessions(_xdSessSeen, list);
  _xdSessSeen = r.next; /* memo 无条件推进：探测队列自会消化候选，丢失唤醒靠下轮 tu 再跳 */
  if (!r.changed) return;
  var q = {};
  r.woke.forEach(function(sid){
    if (!sid || q[sid]) return;
    q[sid] = 1;
    if (!firstRun && !S.busyBy[sid] && !_xdProbeSet[sid]){ _xdProbeSet[sid] = 1; delete _xdProbeTry[sid]; _xdProbeQ.push(sid) } /* P0-2：已忙不排队；P1-2：入队去重+新唤醒清重试计数（复审 P2） */
  });
  if (document.hidden){ _xdNeedReload = true; return } /* P1-7 */
  loadSessions().catch(function(){});
}
/* P0-2 核心：先探后标——拉消息用既有 inferBusy 判忙，忙才 markBusy；不忙弃权（L-049 宁缺勿假：
   tu 跳只证明「有写入」（点开/改名/收尾写库都刷 tu），inferBusy 才是 openSession 同款权威口径）。
   产出审 P1-2：探测请求带 8s 超时（api() 自身无 AbortController）；失败/超时重入队（≤2 次，
   超限弃权）——候选已出队+memo 已推进，静默丢弃=一次网络抖动永久漏标（长静默期 tu 不再跳）。 */
function xdeviceProbeMsg(id){
  /* 复审 P2：超时定时器在先到分支即清（race 输方 8s 后仍会触发，留挂账不干净） */
  return new Promise(function(resolve, reject){
    var to = setTimeout(function(){ reject(new Error('xdevice probe timeout')) }, XDEV_FETCH_TIMEOUT_MS);
    api('/session/' + encodeURIComponent(id) + '/message').then(function(msgs){
      clearTimeout(to); resolve(msgs);
    }, function(err){
      clearTimeout(to); reject(err);
    });
  });
}
function xdeviceProbe(){
  var n = 0;
  while (_xdProbeQ.length && n < XDEV_PROBE_MAX){
    var sid = _xdProbeQ.shift();
    delete _xdProbeSet[sid];
    if (!sid || S.busyBy[sid]) continue; /* 已忙跳过：不浪费探测名额 */
    n++;
    (function(id){
      xdeviceProbeMsg(id).then(function(msgs){
        _xdProbeTry[id] = 0; /* 成功即清重试计数 */
        if (!inferBusy(msgs)) return;
        if (window._busyRecoAt) window._busyRecoAt[id] = Date.now(); /* 防 6s 对账（reconcileBusySessions）立刻重复拉同一会话 */
        if (window.S_ENDED) delete window.S_ENDED[id]; /* 对齐 SSE status=busy 语义（handleEvent L127 同款） */
        markBusy(id, true);
      }).catch(function(){
        var tries = (_xdProbeTry[id] || 0) + 1;
        _xdProbeTry[id] = tries;
        if (tries <= 2 && !_xdProbeSet[id]){ _xdProbeSet[id] = 1; _xdProbeQ.push(id) } /* 失败重入队尾（≤2 次） */
      });
    })(sid);
  }
}
function xdeviceReconcile(){
  if (typeof POP_TAB !== 'undefined' && POP_TAB) return; /* popout 页零跨端轮询（L-067 同族守卫） */
  if (document.hidden && !(typeof kaActive !== 'undefined' && kaActive())) return; /* 息屏省电；保活中照跑（对齐台账轮询口径） */
  if (_xdBusy) return; /* 单飞：慢网不叠加 */
  _xdBusy = true;
  try { /* 产出审 P2：同步抛（极罕见）也要释放单飞，防轮询永久停摆 */
    var jobs = [];
    jobs.push(xdeviceFetchJson('/_hidden-sessions').then(xdeviceApplyHidden).catch(function(e){
      console.log('[xdevice] hidden 拉取失败（下轮重试）：', e && e.message);
    }));
    /* 产出审 P2：_xdNeedReload 只在回前台后驱动 sessions（息屏+保活时恒 true 会把 30s 打成 15s） */
    var doSess = !_xdSessSeen || (_xdTick % XDEV_SESS_EVERY === 0) || (_xdNeedReload && !document.hidden);
    _xdTick++;
    if (doSess){
      jobs.push(xdeviceFetchJson('/_sessions').then(function(list){
        xdeviceApplySessions(list);
        if (!document.hidden) xdeviceProbe(); /* 探测跟在数据落地后（loadSessions 异步不阻塞探测） */
      }).catch(function(e){
        console.log('[xdevice] sessions 拉取失败（下轮重试）：', e && e.message);
      }));
    }
    Promise.all(jobs).then(function(){}, function(){}).then(function(){
      _xdBusy = false;
      if (_xdNeedReload && !document.hidden){ /* 回到前台的补载（与 visibilitychange 双路，先到先得） */
        _xdNeedReload = false;
        loadSessions().catch(function(){});
        xdeviceProbe();
      }
    }, function(){ _xdBusy = false; });
  } catch(e){
    _xdBusy = false;
    console.log('[xdevice] reconcile 异常（已释放单飞）：', e && e.message);
  }
}
/* P1-5 附带（审稿建议）：回前台补拉——由 index.html 内联 bootstrap 调 xdeviceBindVisibility() 注册
   （契约 C10：模块加载期零副作用，不在顶层自调用） */
function xdeviceBindVisibility(){
  if (_xdVisBound) return;
  _xdVisBound = true;
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) return;
    if (_xdNeedReload){ _xdNeedReload = false; loadSessions().catch(function(){}) }
    xdeviceReconcile();
  });
}
window.XDEV_TICK_MS=XDEV_TICK_MS; window.XDEV_SESS_EVERY=XDEV_SESS_EVERY; window.XDEV_PROBE_MAX=XDEV_PROBE_MAX; window.XDEV_FETCH_TIMEOUT_MS=XDEV_FETCH_TIMEOUT_MS; window._xdBusy=_xdBusy; window._xdTick=_xdTick; window._xdHiddenMemo=_xdHiddenMemo; window._xdSessSeen=_xdSessSeen; window._xdProbeQ=_xdProbeQ; window._xdProbeSet=_xdProbeSet; window._xdProbeTry=_xdProbeTry; window._xdNeedReload=_xdNeedReload; window._xdVisBound=_xdVisBound; window.xdeviceFetchJson=xdeviceFetchJson; window.xdeviceHiddenKey=xdeviceHiddenKey; window.xdeviceDiffHidden=xdeviceDiffHidden; window.xdeviceSessKey=xdeviceSessKey; window.xdeviceDiffSessions=xdeviceDiffSessions; window.xdeviceApplyHidden=xdeviceApplyHidden; window.xdeviceApplySessions=xdeviceApplySessions; window.xdeviceProbe=xdeviceProbe; window.xdeviceProbeMsg=xdeviceProbeMsg; window.xdeviceReconcile=xdeviceReconcile; window.xdeviceBindVisibility=xdeviceBindVisibility;

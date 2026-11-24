/* @module data @order 6 @职责 项目/会话/隐藏会话/模型列表加载 @提供 _localNewSids _aliasMap _aliasSynced loadProjects loadSessions loadHiddenSessions _hiddenRes hideSessions restoreSessions hiddenOrderAdd hiddenOrderRemove getModelAliases modelKey aliasOf labelModel visibleModelsForPick rolePickModel refreshModelOptions setModelPlaceholder loadModelsWithRetry loadModels syncModelLabel setModelAliases aliasMerge syncModelAliasBoot aliasPostVerified aliasSynced @依赖 - @依赖运行期 S syncActiveButler renderSidebar renderTitle api ROLES renderRoles @DOM契约 - @严格模式 是 @全局占用 _localNewSids _aliasMap _aliasSynced loadProjects loadSessions loadHiddenSessions _hiddenRes hideSessions restoreSessions hiddenOrderAdd hiddenOrderRemove getModelAliases modelKey aliasOf labelModel visibleModelsForPick rolePickModel refreshModelOptions setModelPlaceholder loadModelsWithRetry loadModels syncModelLabel setModelAliases aliasMerge syncModelAliasBoot aliasPostVerified aliasSynced @源行 ui/index.html L1642-L1848 @测试锚点 - @被调用 - */
'use strict';
/* ---------- data ---------- */
function loadProjects(): Promise<void>{
  return fetch('/_dirs').then(function(r){ return r.json() }).then(function(d){
    S.projects = d.projects || []; S.imports = d.imports || []; S.root = d.root || ''; S.order = d.order || [];
  })
}
/* task151：本次会话内本地新建的会话 id 集合（内存）。用于 loadSessions 后补 pwa=1，治「新建后点开别的会话，新建的从左栏消失」 */
var _localNewSids = {};
function loadSessions(): Promise<void>{
  return fetch('/_sessions').then(function(r){ return r.json() }).then(function(list){
    /* task140：排序改按创建时间（time.created）降序——原按 updated 时「点开会话→updated 刷新→自己上浮」，主人 2026-11-09 明确不要跳动；created/updated 全缺时保持原序 */
    S.sessions = (list || []).sort(function(a,b){
      var ca = (a.time && a.time.created) || 0, cb = (b.time && b.time.created) || 0;
      if (cb !== ca) return cb - ca;
      return ((b.time && b.time.updated) || 0) - ((a.time && a.time.updated) || 0);
    });
    /* task151：本地新建的会话补 pwa=1（serve 对空会话不写 pwa，仅供「来源」判定；焦点视图若把它当路过会话过滤掉，则「新建后点开别的会话，新建的消失」——主人 2026-11-09 报） */
    S.sessions.forEach(function(s){ if (s.id && _localNewSids[s.id]) s.pwa = 1 });
    /* task241（主人 2026-11-12：「新建了好几条，有的时候显示有的时候不显示」）：服务端列表偶尔比新建慢半拍——
       当前正打开的会话如果刚建 90 秒内却没出现在列表里，把它补回内存，别让整行凭空消失（刷新/重拉都不再吞）。 */
    (function(){
      var cur = S.current;
      if (!cur || !cur.id) return;
      var hit = S.sessions.some(function(x){ return x && x.id === cur.id });
      var born = Number((cur.time && cur.time.created) || 0);
      if (!hit && born && Date.now() - born < 90000){
        if (cur.pwa == null) cur.pwa = 1;
        S.sessions.unshift(cur);
      }
    })();
    /* task54 B §4.5：差集清理——只清「其根已不在新根集」的 pid，存活根的 children 缓存与 S.convOpen 一律不动；
       S.childParent 同步删除指向已不存在父 pid 的条目（子会话新鲜度由 SSE 定向失效保证，不做轮询） */
    var roots = {};
    S.sessions.forEach(function(s){ roots[s.id] = 1 });
    var _aliveMemo = {};
    function _pidAlive(pid){
      if (!pid) return false;
      if (_aliveMemo[pid] != null) return _aliveMemo[pid];
      var seen = {}, cur = pid, ok = false;
      while (cur && !seen[cur]){
        if (roots[cur]){ ok = true; break }
        seen[cur] = 1;
        cur = S.childParent[cur];
      }
      _aliveMemo[pid] = ok;
      return ok;
    }
    Object.keys(S.children).forEach(function(pid){ if (!_pidAlive(pid)) delete S.children[pid] });
    Object.keys(S.childrenDirty).forEach(function(pid){ if (!_pidAlive(pid)) delete S.childrenDirty[pid] }); /* task70 F1-1：脏标记同步回收 */
    Object.keys(S.childrenLoading).forEach(function(pid){ if (!_pidAlive(pid)) delete S.childrenLoading[pid] });
    Object.keys(S.childrenErr).forEach(function(pid){ if (!_pidAlive(pid)) delete S.childrenErr[pid] });
    Object.keys(S.childParent).forEach(function(cid){ if (!_pidAlive(S.childParent[cid])) delete S.childParent[cid] });
    syncActiveButler(); /* task106：校验活跃大管家指针；仅清理失效值，不把回落值写回 */
    renderSidebar(); renderTitle();
  })
}
/* ---------- task56：hidden（左栏软删除的可见性清单，数据不删） ---------- */
/* 启动时读一次即可，不做轮询（§4.10；task143 视图模式退役后无切换重读） */
function loadHiddenSessions(): Promise<{ [k: string]: number }>{
  return fetch('/_hidden-sessions').then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d){
    var list = ((d && d.hidden) || []).filter(function(id){ return typeof id === 'string' && id });
    var map = {};
    list.forEach(function(id){ map[id] = 1 });
    S.hidden = map;
    /* task390：保留服务端数组顺序（≈归档先后，尾部=最近归档），供左栏「归档会话列表」取最近 10 条 */
    S.hiddenOrder = list.slice();
    return map;
  }).catch(function(){
    /* 降级：读不到就按“全部可见”渲染，绝不阻塞侧栏（存量语义，task390 未改；启动期读坏档=空清单） */
    S.hidden = {};
    S.hiddenOrder = [];
    return S.hidden;
  });
}
/* task390：hiddenOrder 与 hidden 同步的唯一出入口（归档追加去重 / 恢复移除）——
   归档写点（actions 单条/批量）与恢复写点共用，防两处各写一套漂移。 */
function hiddenOrderAdd(id: string){
  if (!id || S.hidden[id]) return;
  S.hiddenOrder = (Array.isArray(S.hiddenOrder) ? S.hiddenOrder : []).concat([id]);
}
function hiddenOrderRemove(id: string){
  if (!id) return;
  S.hiddenOrder = (Array.isArray(S.hiddenOrder) ? S.hiddenOrder : []).filter(function(x){ return x !== id });
}
function _hiddenRes(r: Response){
  return r.text().then(function(t){
    var d = null;
    try { d = JSON.parse(t) } catch(e){}
    if (!r.ok || !d || d.ok !== true) throw new Error((d && d.error) || ('HTTP ' + r.status));
    return d;
  });
}
function hideSessions(ids: string[]){
  return fetch('/_hidden-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'hide', ids: ids })
  }).then(_hiddenRes);
}
function restoreSessions(ids: string[]){
  return fetch('/_hidden-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restore', ids: ids })
  }).then(_hiddenRes);
}
/* task337（主人拍板 B）：别名跨设备同步——服务端 /_model-alias 为唯一真相源（config/model-alias.json），
   内存 _aliasMap 是前端单源视图：getModelAliases 只读它（同步形态不变，aliasOf/labelModel/
   visibleModelsForPick 零改动——「同一指标单点口径」铁律）；写一律走 setModelAliases（即更内存+上行）。
   localStorage['littledj.modelAlias'] 是 task283~289 的旧单机存储：启动 syncModelAliasBoot 迁移合并
   （服务端有的 key 服务端胜；本地新增的 key 上行）→ POST 成功后清除本地旧存储（一次性单源化）。 */
var _aliasMap = {};
var _aliasSynced = false; /* task337：别名单源水化标志——syncModelAliasBoot 成功置位；页内自测别名段未水化即跳过（御审 P1-1） */
function getModelAliases(): { [k: string]: string }{ /* task337（御审 P2-1）：返回浅拷贝防外部改活引用绕过上行；写入唯一出入口=setModelAliases */
  var c = {};
  Object.keys(_aliasMap).forEach(function(k){ c[k] = _aliasMap[k] });
  return c;
}
function modelKey(p: string, m: string): string{ return p + '/' + m }
/* 合并纯函数（可自测）：server 为底、local 补 server 缺的 key；同 key 冲突 server 胜。
   返回 { merged, uploaded }——uploaded=本地需要上行的增量（空对象=服务端已含全部）。 */
function aliasMerge(server: { [k: string]: string } | null, local: { [k: string]: string } | null): { merged: { [k: string]: string }; uploaded: { [k: string]: string } }{
  var merged = {}, uploaded = {};
  Object.keys(server || {}).forEach(function(k){ if (server[k]) merged[k] = server[k] });
  Object.keys(local || {}).forEach(function(k){
    if (!local[k]) return;                       /* 空值别名（已清除的）不上行 */
    if (merged[k] == null) { merged[k] = local[k]; uploaded[k] = local[k] } /* 本地新增→上行 */
    /* 同 key 冲突：服务端胜，本地丢弃 */
  });
  return { merged: merged, uploaded: uploaded };
}
/* POST 并核验（task337 御审 P0-2）：fetch 对 4xx/5xx 也是 resolve——必须判 r.ok + d.ok；
   POST body {alias}，成功回 {ok,count}。task343：force=true 才允许清空非空库（服务端空覆写守卫）。
   返回 Promise<boolean>（true=服务端已落库）。 */
function aliasPostVerified(al: { [k: string]: string } | null, force?: boolean): Promise<{ ok: boolean; count: number }>{
  var body: { alias: { [k: string]: string }; force?: boolean } = { alias: al || {} };
  if (force) body.force = true;
  return fetch('/_model-alias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r){
      return r.json().catch(function(){ return null }).then(function(d){ return { ok: r.ok && !!(d && d.ok), count: (d && d.count) || 0 } });
    });
}
/* 写入唯一出入口：内存即更（渲染零延迟）+ 上行服务端（已核验）；
   上行失败→暂存 localStorage pending 副本（下次启动并入上行，御审 P1-3）+ toast 提示一次。
   返回 Promise<{ok,count}>（失败也 resolve，不抛 unhandledrejection）供调用方串行等待。
   task343：未水化禁写（GET 失败/未完成时 _aliasSynced=false，空 map 全量上行会清空服务端其他别名）；
   清空最后一条需主人确认；确认清空成功后写 bakRestored（防下次启动从 .bak 复活）；
   自检还原（_stBusy）放行并带 force。 */
function setModelAliases(al: unknown): Promise<{ ok: boolean; count: number }>{
  if (!_aliasSynced){
    toast('别名同步未完成（网络/代理异常），请刷新页面后重试');
    return Promise.resolve({ ok: false, count: 0 });
  }
  var prev = _aliasMap;
  var next = (al && typeof al === 'object' && !Array.isArray(al)) ? al : {};
  var prevN = Object.keys(prev).length, nextN = Object.keys(next).length;
  var force = false, clearedAll = false;
  var inTest = (typeof _stBusy !== 'undefined' && _stBusy);
  var markBakRestored = function(){ try { localStorage.setItem('littledj.modelAlias.bakRestored', String(Date.now())) } catch(e){} };
  if (!nextN && prevN){
    if (!inTest){
      var sure = false;
      try { sure = window.confirm('这是最后一条模型别名，清空后顶栏下拉会回到全量模型清单。确定清空？') } catch(e){}
      if (!sure){
        refreshModelOptions();
        return Promise.resolve({ ok: false, count: prevN });
      }
    }
    force = true; clearedAll = true;
  }
  /* task343-fu2（御审 P2-1）：清空意图即记 bakRestored——即使 POST 响应丢失/超时，服务端已空时也不会被 .bak 复活 */
  if (clearedAll && !inTest) markBakRestored();
  _aliasMap = next;
  refreshModelOptions(); /* 顶栏模型下拉别名即时生效（与改造前两保存点行为一致） */
  var expected = Object.keys(_aliasMap).length;
  var onFail = function(){
    try { localStorage.setItem('littledj.modelAlias.pending', JSON.stringify(_aliasMap)) } catch(e){}
    toast('⚠️ 别名同步到服务端失败，已暂存本机（下次打开自动重试）');
  };
  return aliasPostVerified(_aliasMap, force).then(function(up){
    if (up && up.ok && up.count === expected){
      try { localStorage.removeItem('littledj.modelAlias.pending') } catch(e){}
      return up;
    }
    /* 服务端未全量落库（含网络 reject、脏 key 被清洗）：暂存 pending + 提示，调用方看到 ok:false */
    onFail();
    return { ok: false, count: (up && up.count) || 0 };
  }, function(){
    onFail();
    return { ok: false, count: 0 };
  });
}
/* 启动迁移（bootReal/bootPopout 在渲染/模型列表前串接）：
   GET（判 ok，错误体不当空服务端——御审 P0-2）→ 合并 localStorage 旧值 + pending 暂存 → 有增量则
   POST（r.ok+d.ok+count 三验）→ 真成功才清旧存储（清除前先留 .bak 供回滚回灌，御审 P1-4）。
   降级：GET 失败（网络/代理未就绪/4xx5xx）→ 本地旧值+pending 合并兜底，一律不清（下轮再迁）。
   task343：服务端为空且本地/pending 都无数据时，用迁移留下的 .bak 恢复一次（误清事故自愈；
   bakRestored 标记保证只自动恢复一次，主人主动清空后不会反复复活）。 */
function syncModelAliasBoot(){
  var local = null, pending = null, bak = null;
  try { local = JSON.parse(localStorage.getItem('littledj.modelAlias') || 'null') } catch(e){}
  if (local && (typeof local !== 'object' || Array.isArray(local))) local = null;
  try { pending = JSON.parse(localStorage.getItem('littledj.modelAlias.pending') || 'null') } catch(e){}
  if (pending && (typeof pending !== 'object' || Array.isArray(pending))) pending = null;
  try { bak = JSON.parse(localStorage.getItem('littledj.modelAlias.bak') || 'null') } catch(e){}
  if (bak && (typeof bak !== 'object' || Array.isArray(bak))) bak = null;
  return fetch('/_model-alias').then(function(r){
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function(d){
    if (!d || d.ok !== true || !d.alias || typeof d.alias !== 'object') throw new Error('bad payload');
    var server = d.alias;
    var res = aliasMerge(aliasMerge(server, local).merged, pending); /* 旧存储与 pending 都作为本地增量 */
    var recovered = false;
    if (!Object.keys(server).length && !Object.keys(res.merged).length && bak && Object.keys(bak).length){
      var restoredAt = '';
      try { restoredAt = localStorage.getItem('littledj.modelAlias.bakRestored') || '' } catch(e){}
      if (!restoredAt){ res = aliasMerge(server, bak); recovered = true }
    }
    var n = Object.keys(res.merged).length;
    /* task343-fu2：res.uploaded 只含 pending 增量（外层 aliasMerge 的 local 参数），local 增量会被内层吞掉；
       改为「merged 里有 server 没有的 key」判定，保证旧 localStorage 首次迁移一定上行 */
    var needUpload = Object.keys(res.merged).some(function(k){ return !Object.prototype.hasOwnProperty.call(server, k) });
    var syncRender = function(){ try { refreshModelOptions() } catch(e){} };
    var markRestored = function(){ try { localStorage.setItem('littledj.modelAlias.bakRestored', String(Date.now())) } catch(e){} };
    var stashPending = function(){ try { localStorage.setItem('littledj.modelAlias.pending', JSON.stringify(res.merged)); markRestored(); return true } catch(e){ return false } };
    var finish = function(){
      _aliasMap = res.merged;
      _aliasSynced = true;
      /* task343：local 可能是空对象 {}（旧缓存页清空后写入）——空 map 不覆盖 .bak，保住唯一恢复源。
         task343-fu2（御审 P2-2）：非空 local 与已有 .bak 合并（local 优先），防旧缓存页只带 1 条把 3 条备份覆盖成 1 条 */
      if (local && Object.keys(local).length){
        var bakMap = aliasMerge(local, bak).merged;
        try { localStorage.setItem('littledj.modelAlias.bak', JSON.stringify(bakMap)) } catch(e){}
      }
      try { localStorage.removeItem('littledj.modelAlias') } catch(e){}
      if (recovered) markRestored();
      syncRender();
    };
    if (needUpload){
      return aliasPostVerified(res.merged).then(function(up){
        if (up.ok && up.count === n){
          finish();
          try { localStorage.removeItem('littledj.modelAlias.pending') } catch(e){}
          if (recovered) toast('✅ 已从本机备份恢复 ' + n + ' 条模型别名');
        } else {
          _aliasMap = res.merged; _aliasSynced = true; /* POST 未全量落库：不清本地，下轮再迁（P0-2 保守语义） */
          syncRender();
          if (recovered){ stashPending(); toast('⚠️ 已从本机备份恢复 ' + n + ' 条别名，待联网同步'); }
        }
      }, function(){
        _aliasMap = res.merged; _aliasSynced = true;
        syncRender();
        if (recovered){ stashPending(); toast('⚠️ 已从本机备份恢复 ' + n + ' 条别名，待联网同步'); }
      });
    }
    finish();
    if (recovered) toast('✅ 已从本机备份恢复 ' + n + ' 条模型别名');
  }).catch(function(){
    /* GET 失败：本地旧值+pending 合并兜底，保留待下轮迁移。
       task343（御审 P1-1）：绝不能置 _aliasSynced=true——未拿到服务端全量时保存一条会全量覆写清掉其余别名；
       此时只渲染本地兜底，写入门槛保持关闭，提示刷新重试。 */
    var fb = aliasMerge(aliasMerge({}, local).merged, pending).merged;
    _aliasMap = fb;
    _aliasSynced = false;
    try { refreshModelOptions() } catch(e){}
  });
}
/* task289-fu2（主人裁决「以别名为准」）：基础模型 key 无别名时，回退读其 [1m] 拆行 key 的别名——
   [1m] 只是同一模型的展示形态（serve 无独立 [1m] 模型），主人常把别名填在 [1m] 行，必须对模型生效。
   存储仍各自独立（fu1 语义保持：编辑互不覆盖），仅读取有优先级（基础优先、[1m] 兜底）。 */
function aliasOf(m: { providerID: string; modelID: string }): string{
  var al = getModelAliases(), k = modelKey(m.providerID, m.modelID);
  return al[k] || al[k + '[1m]'] || '';
}
function labelModel(m: { providerID: string; modelID: string; pname: string; name: string }): string{ var al = aliasOf(m); return al || (m.pname + ' · ' + m.name) }
/* task289-fu2（主人裁决「以别名为准」）：输入框右下角下拉只列**已起别名**的模型——
   别名=主人标记「这个模型我要用」，没起别名=不需要用、不进下拉；
   兜底：一个别名都没有时列全量（防空白下拉无从选择）；当前选中模型无别名时保留为选项（防下拉显示错位）。 */
function visibleModelsForPick(){
  var ms = S.models || [];
  var out = ms.filter(function(m){ return !!aliasOf(m) });
  if (!out.length) return ms.slice();
  var cur = S.model;
  if (cur && !out.some(function(x){ return x.providerID === cur.providerID && x.modelID === cur.modelID })){
    var cm = ms.filter(function(x){ return x.providerID === cur.providerID && x.modelID === cur.modelID })[0];
    if (cm) out.push(cm);
  }
  return out;
}
/* task290（主人裁决）：角色页模型下拉与输入框一字不差（=别名清单）；
   角色已保存的模型若别名被清（主人原则「没别名就不能用」）→ 自动默认改用「官方」glm-5.3
   （它不可见时用清单第一项）并写回角色卡；全无别名（清单=全量兜底）时不强制改写，防误写。
   返回 { list: 下拉清单（纯别名清单，不混输入框当前模型兜底）, sel: 应选中值, autoFix: 待自动写回目标（空=不需要） } */
function rolePickModel(curModel: string){
  var ms = S.models || [];
  var aliased = ms.filter(function(m){ return !!aliasOf(m) });
  var pickList = aliased.length ? aliased : ms.slice();
  var out = { list: pickList, sel: String(curModel || ''), autoFix: '' };
  if (!aliased.length) return out; /* 一个别名都没有 → 全量兜底，别名原则无从适用，不强制改写 */
  var curM = ms.filter(function(m){ return m.providerID + '/' + m.modelID === out.sel })[0];
  if (!out.sel || !curM || !aliasOf(curM)){
    var def = pickList.filter(function(m){ return m.providerID === 'zhipuai-coding-plan' && m.modelID === 'glm-5.3' })[0] || pickList[0];
    if (def){ out.autoFix = def.providerID + '/' + def.modelID; out.sel = out.autoFix }
  }
  return out;
}
function refreshModelOptions(): void{
  var sel = $('#modelSel'); if (!sel || !S.models) return;
  if (!S.models.length) { setModelPlaceholder('模型加载失败 · 点此重试'); return; }
  sel.replaceChildren();
  visibleModelsForPick().forEach(function(m){
    var o = document.createElement('option');
    o.value = m.providerID + '/' + m.modelID;
    o.textContent = labelModel(m);
    if (m.providerID === S.model.providerID && m.modelID === S.model.modelID) o.selected = true;
    sel.appendChild(o);
  });
  syncModelLabel();
}
function setModelPlaceholder(text: string): void{
  var sel = $('#modelSel'); if (!sel) return;
  sel.replaceChildren();
  var o = document.createElement('option');
  o.value = ''; o.textContent = text; o.disabled = true; o.selected = true;
  sel.appendChild(o);
  sel.title = text;
}
function loadModelsWithRetry(left?: number){
  left = (left == null) ? 6 : left;
  function again(){
    if (left <= 1) { setModelPlaceholder('模型加载失败 · 点此重试'); return false; }
    setModelPlaceholder('模型加载中…');
    return new Promise(function(res){
      setTimeout(res, 400 + (6 - left) * 600);
    }).then(function(){ return loadModelsWithRetry(left - 1) });
  }
  return loadModels().then(function(){
    if (S.models && S.models.length) return true;
    return again();
  }).catch(again);
}
function loadModels(){
  return api('/config/providers').then(function(d){
    var ALLOW = { 'deepseek': 1, 'zhipuai-coding-plan': 1 };
    var LABEL = { 'deepseek': 'DeepSeek 官方', 'zhipuai-coding-plan': '智谱 Token Plan' };
    var DS_ALLOW = { 'deepseek-flash': 1, 'deepseek-v4-pro': 1 };
    var ms = [];
    (d.providers || []).forEach(function(p){
      Object.keys(p.models || {}).forEach(function(m){
        if (p.id === 'deepseek' && !DS_ALLOW[m]) return; // 官方仅 V4.1 Flash 与 V4 Pro
        var info = p.models[m] || {};
        var it = { providerID: p.id, modelID: m, name: (info.name || m), pname: (LABEL[p.id] || p.name || p.id), ctx: (info.limit && Number(info.limit.context)) || 0 };
        if (ALLOW[p.id] && (!info.capabilities || info.capabilities.toolcall !== false)) ms.push(it);
      });
    });
    if (!ms.length) { S.models = []; refreshModelOptions(); return; }
    ms.sort(function(a,b){ return a.pname === b.pname ? a.name.localeCompare(b.name) : a.pname.localeCompare(b.pname) });
    S.models = ms;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('littledj.model') || 'null') } catch(e){}
    if (saved && ms.some(function(x){ return x.providerID === saved.providerID && x.modelID === saved.modelID })) S.model = saved;
    refreshModelOptions();
    if (!ms.some(function(m){ return m.providerID === S.model.providerID && m.modelID === S.model.modelID }) && ms.length){
      S.model = { providerID: ms[0].providerID, modelID: ms[0].modelID };
      refreshModelOptions();
    }
    /* 角色卡只读值依赖 S.models 反查别名：列表到达后若角色页开着，重绘一次（方案稿 §9 V3 注的一次性跳变） */
    if (typeof ROLES !== 'undefined' && ROLES.data && $('#rolesWrap')) renderRoles();
  }).catch(function(){});
}
function syncModelLabel(): void{
  var sel = $('#modelSel');
  if (!sel || !sel.options.length) return;
  var m = S.models.filter(function(x){ return x.providerID === S.model.providerID && x.modelID === S.model.modelID })[0];
  sel.title = m ? (m.providerID + ' · ' + m.modelID) : '';
}

window._localNewSids=_localNewSids; window.loadProjects=loadProjects; window.loadSessions=loadSessions; window.loadHiddenSessions=loadHiddenSessions; window._hiddenRes=_hiddenRes; window.hideSessions=hideSessions; window.restoreSessions=restoreSessions; window.hiddenOrderAdd=hiddenOrderAdd; window.hiddenOrderRemove=hiddenOrderRemove; window.getModelAliases=getModelAliases; window.modelKey=modelKey; window.aliasOf=aliasOf; window.labelModel=labelModel; window.visibleModelsForPick=visibleModelsForPick; window.rolePickModel=rolePickModel; window.refreshModelOptions=refreshModelOptions; window.setModelPlaceholder=setModelPlaceholder; window.loadModelsWithRetry=loadModelsWithRetry; window.loadModels=loadModels; window.syncModelLabel=syncModelLabel; window.setModelAliases=setModelAliases; window.aliasMerge=aliasMerge; window.syncModelAliasBoot=syncModelAliasBoot; window.aliasPostVerified=aliasPostVerified; window.aliasSynced=function(){ return _aliasSynced; };

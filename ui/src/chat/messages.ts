/* @module messages @order 13 @职责 消息缓存/消息渲染/diff 卡/切会话草稿 @提供 _ecOpenMids MSG_CACHE_MAX MSG_CACHE_MAX_MSGS msgCachePut msgCacheDrop msgsFingerprint msgsIsNewer openSession renderSessionMessages pruneThinking friendlyError taskInjectedOf parseTaskInjected renderTaskInjected sessionRoleKey sessionRoleLabel _edLines _edNum statsFromPatch fileStatsOfPart buildEditCards relFile renderEditCard msgMetaText renderMessage renderPart @依赖 - @依赖运行期 S projOpenKeyForDir exitSortMode isButlerSession renderQuote ensureCurrentTreeOpen voiceReset hideQuestion sysPanelClose saveFocusProjOpen saveProjOpen setView todoLoad resolveButler connectSSE draftSwitch draftRestore renderTitle toggleBusyUI queueLoad _suppressScroll syncScrollBtn api markBusy inferBusy syncSseBanner fetchBalance nearBottom _stickBottom isMobile closePanels baseName _lastScrollTop noteTaskCompletions restoreScroll reconcilePending updateUsage loadPendingQuestion loadPanel fmtTime reportState CHILD_ROLE_LABEL aliasOf childRoleClass renderAgentCard CONV_ICON_FORK @DOM契约 - @严格模式 是 @全局占用 _ecOpenMids MSG_CACHE_MAX MSG_CACHE_MAX_MSGS msgCachePut msgCacheDrop msgsFingerprint msgsIsNewer openSession renderSessionMessages pruneThinking friendlyError taskInjectedOf parseTaskInjected renderTaskInjected sessionRoleKey sessionRoleLabel _edLines _edNum statsFromPatch fileStatsOfPart buildEditCards relFile renderEditCard msgMetaText renderMessage renderPart @源行 ui/index.html L3539-L4024 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task312：会话消息缓存（stale-while-revalidate，P1-1 铁律：只存服务端完整快照） ---------- */
var MSG_CACHE_MAX = 15, MSG_CACHE_MAX_MSGS = 2000;
function msgCachePut(sid: string, msgs: any): void{
  if (!sid || !msgs) return;
  if (msgs.length > MSG_CACHE_MAX_MSGS){ msgCacheDrop(sid); return } /* 巨型会话不缓存，防内存翻倍 */
  S.msgCache[sid] = { msgs: msgs, at: Date.now() };
  var keys = Object.keys(S.msgCache);
  if (keys.length <= MSG_CACHE_MAX) return;
  keys.sort(function(a, b){ return (S.msgCache[a].at || 0) - (S.msgCache[b].at || 0) });
  while (keys.length > MSG_CACHE_MAX){ delete S.msgCache[keys.shift()] }
}
function msgCacheDrop(sid: string): void{ if (sid && S.msgCache[sid]) delete S.msgCache[sid] }
function msgsFingerprint(msgs: any){
  var last = (msgs && msgs.length) ? msgs[msgs.length - 1] : null;
  var info = (last && last.info) || {};
  var t = (info.time && (info.time.updated || info.time.created)) || 0;
  return (msgs ? msgs.length : 0) + '|' + (info.id || '') + '|' + t;
}
function msgsIsNewer(next: any, cur: any){
  var n = next || [], c = cur || [];
  if (n.length !== c.length) return n.length > c.length;
  if (!n.length) return false;
  var ni = (n[n.length - 1] || {}).info || {}, ci = (c[c.length - 1] || {}).info || {};
  if (ni.id !== ci.id) return false; /* 同长不同末条：来源存疑，按更旧处理（只按更新方向重渲染） */
  var nt = (ni.time && (ni.time.updated || ni.time.created)) || 0;
  var ct = (ci.time && (ci.time.updated || ci.time.created)) || 0;
  return nt > ct;
}
function openSession(sess: any): void{
  /* task391（主人 2026-11-22）：输入草稿按会话隔离——切走存旧会话、切回取新会话；
     同 id 重开（点当前会话行）整块不执行，绝不清主人正在打的字；首次打开（S.current 空）只取不存。
     交接 carry 链路（S._draftCarry 非空）由 handoff 自管，这里跳过。异常隔离：草稿故障不得中断消息加载/SSE/队列。 */
  var _prevSid = (S.current && S.current.id) ? String(S.current.id) : '';
  var _switching = !!(sess && sess.id && _prevSid && _prevSid !== String(sess.id));
  if ((_switching || !_prevSid) && sess && sess.id && !S._draftCarry){
    var _slot = null;
    try { _slot = draftSwitch(_prevSid, String(sess.id)) } catch(e){}
    try { draftRestore(_slot, !_prevSid) } catch(e){}
  }
  var _leavingKey = (S.current && S.current !== sess) ? projOpenKeyForDir(S.current.directory || '') : ''; /* task172：切换前的当前项目 key（它正以精简态展开着，切走后应保持） */
  /* task312：离开旧会话前写缓存——仅「完整服务端快照 + 空闲」才存；忙态/半截不缓存并清条目（P1-1） */
  var _leaveSid = (S.current && S.current.id && S.current.id !== sess.id) ? S.current.id : '';
  if (_leaveSid){
    if (S._lastMsgsSid === _leaveSid && S._msgsComplete && !S.busyBy[_leaveSid]) msgCachePut(_leaveSid, S.lastMsgs);
    else msgCacheDrop(_leaveSid);
  }
  /* task141 御史 P1-1：切到非排序项目的会话时自动保存退出排序（focus 视图会切走原项目=「完成」按钮消失的死角） */
  if (S.sortProj && projOpenKeyForDir(sess.directory || '') !== S.sortProj) exitSortMode(S.sortProj);
  /* task150：手动点开 butler 根会话即更新活跃指针——补「点开已有会话不写指针」的缺口（指针只在 createSession 写，点开不更新=刷新后停错会话/空壳） */
  if (sess && isButlerSession(sess) && S.activeButlerSid !== sess.id){
    S.activeButlerSid = sess.id;
    try { localStorage.setItem('littledj.activeButlerSid', sess.id); localStorage.setItem('littledj.activeButlerAt', String(Date.now())); } catch(e){}
  }
  S.current = sess; S.busy = !!S.busyBy[sess.id]; S.filePath = ''; S.fsBase = { scope: 'project', path: sess.directory || '' };
  if (S.quote){ S.quote = null; renderQuote() } /* task77 §3.5：切会话即清引用（session.updated 原地更新不走这里） */
  ensureCurrentTreeOpen(); /* task56 §4.5：切换会话即刻展开当前链路（内部 _treeOpenedFor 去重） */
  voiceReset(); /* 手动切会话 = 退出语音等待/停朗读/取消在录 */
  hideQuestion();
  sysPanelClose(); /* P2：会话切换即收起系统面板（V3） */
  /* task172：原项目保持展开（主人 2026-11-10 定「我让它折叠才折叠」）——刚离开的项目此前=当前项目恒精简展开，
     切走后标 true 保持展开（不清空全部）；同项目内切换不动它；展开内容=今天的会话（task171）不会刷屏。
     task247 产出审 P1-1：只有「没有显式折叠过」（!== false）才补 true——主人刚点的 false 必须尊重，
     否则「折叠 littleDJ → 点 DAG 会话」会把它又弹开，观感仍是「折叠没用」。 */
  if (_leavingKey && _leavingKey !== projOpenKeyForDir(sess.directory || '') && S.focusProjOpen[_leavingKey] !== false){ S.focusProjOpen[_leavingKey] = true; saveFocusProjOpen(); }
  var openKey = projOpenKeyForDir(sess.directory);
  if (openKey) S.projOpen[openKey] = true;
  saveProjOpen();
  /* task247：当前会话所在项目一律展开——主人手动折叠后，切到（或搜索点开）该项目的会话仍能看见当前行；
     放在 openSession 而非 renderSidebar，同根切子会话（ctx.root.id 不变）也覆盖（方案审 P1-1）。 */
  if (openKey){ S.focusProjOpen[openKey] = true; saveFocusProjOpen() }
  setView('projects');
  todoLoad(true);
  resolveButler(sess.directory, function(){});
  connectSSE(sess.directory);
  renderTitle(); toggleBusyUI();
  queueLoad(sess.id); /* task80 S2b：切会话即拉该会话队列并重渲染（旧会话晚到响应由 queueLoad 丢弃） */
  var _seq = ++S._openSeq; /* task312：旧校准响应防护（P1-2） */
  var _cached = S.msgCache[sess.id];
  var _fromCache = !!(_cached && _cached.msgs);
  S._msgsComplete = false; /* task312：新会话快照未到，离场不缓存（防串台/半截） */
  _suppressScroll = true;
  if (_fromCache){
    renderSessionMessages(sess, _cached.msgs, {}); /* task312：缓存秒开，零白屏零「加载中」 */
  } else {
    $('#messages').innerHTML = '<div class="empty"><div>加载中…</div></div>';
  }
  syncScrollBtn();
  api('/session/' + sess.id + '/message').then(function(msgs){
    if (_seq !== S._openSeq || !S.current || S.current.id !== sess.id) return; /* task312：切走/重开即作废 */
    var fresh = msgs || [];
    if (_fromCache && S._lastMsgsSid === sess.id){
      var cur = S.lastMsgs || [];
      if (msgsFingerprint(fresh) === msgsFingerprint(cur)){
        /* 指纹相同：不动 DOM，只校准数据/忙态（P1-2 零闪动） */
        S.lastMsgs = fresh; S._msgsComplete = true;
        msgCachePut(sess.id, fresh);
        markBusy(sess.id, inferBusy(fresh));
        S.busy = !!S.busyBy[sess.id]; toggleBusyUI(); renderTitle();
        syncSseBanner();
        fetchBalance(); /* 与原 openSession 行为对齐 */
        return;
      }
      if (!msgsIsNewer(fresh, cur)) return; /* 更旧/存疑响应：丢弃，绝不回滚刚直显的内容（P1-2） */
    }
    markBusy(sess.id, inferBusy(fresh));
    S.busy = !!S.busyBy[sess.id]; toggleBusyUI(); renderTitle();
    var box = $('#messages'), _prevTop = box.scrollTop, _wasNear = nearBottom(box) || _stickBottom;
    msgCachePut(sess.id, fresh);
    renderSessionMessages(sess, fresh, { scrollTop: _wasNear ? null : _prevTop }); /* task312：重渲染保持阅读位置 */
    fetchBalance();
  }).catch(function(e){
    if (_seq !== S._openSeq || !S.current || S.current.id !== sess.id) return;
    if (_fromCache){ _suppressScroll = false; syncSseBanner(); syncScrollBtn(); return; } /* task312：校准失败静默保留缓存（P1-2） */
    _suppressScroll = false;
    $('#messages').innerHTML = '<div class="empty"><div>加载失败：' + esc(e.message) + '</div></div>';
    syncSseBanner(); syncScrollBtn();
  });
  if (isMobile()) closePanels(true);
}
/* task312：会话消息公共渲染（openSession 缓存/网络/校准路径共用；忙态判定留在调用方，P1-3 职责边界） */
function renderSessionMessages(sess: any, msgs: any, opt?: any): void{
  opt = opt || {};
  var box = $('#messages');
  _suppressScroll = true;
  box.replaceChildren();
  if (!msgs || !msgs.length){
    box.innerHTML = '<div class="empty"><div class="empty-logo">DJ</div><h2>' + esc(sess.title || '新对话') + '</h2><p>项目：' + esc(baseName(sess.directory)) + '<br>直接在下方输入指令开始。</p></div>';
    S.lastMsgs = [];
    S._lastMsgsSid = sess.id;
    S._msgsComplete = true;
    _suppressScroll = false; _stickBottom = true; _lastScrollTop = 0; syncScrollBtn();
  } else {
    S.lastMsgs = msgs;
    S._lastMsgsSid = sess.id; /* task152：live 任务行归属=消息来源会话 */
    S._msgsComplete = true;
    noteTaskCompletions(msgs); /* task152：历史里的完成注入即终局正证据，刷新后不再卡「执行中」 */
    var _ecm = buildEditCards(msgs); /* task239：本轮改了哪些文件（diff 汇总卡） */
    msgs.forEach(function(m){ box.appendChild(renderMessage(m, { edits: _ecm[(m.info || {}).id] })) });
    var saved = (opt.scrollTop === undefined) ? S.scrollPos[sess.id] : opt.scrollTop; /* task312：undefined=沿用记忆位置；null=强制底部（wasNear） */
    restoreScroll(sess, saved == null ? box.scrollHeight : saved, saved == null);
  }
  syncSseBanner();
  reconcilePending(sess.id, msgs);
  updateUsage(msgs);
  pruneThinking(!S.busy);
  loadPendingQuestion();
  loadPanel();
}
function pruneThinking(force?: boolean): void{
  var box = $('#messages');
  if (!box.querySelector('.thinking-ph')) return;
  Array.prototype.slice.call(box.querySelectorAll('.msg.assistant')).forEach(function(n){
    var body = n.querySelector('.body');
    if (!body) return;
    var ph = body.querySelector('.thinking-ph');
    if (!ph) return;
    if (body.children.length > 1){ ph.remove(); return }
    if (n.querySelector('.msg-error')) return;
    if (!force && n === box.lastElementChild) return;
    n.remove();
  });
}
function friendlyError(em: string): string{
  var s = String(em == null ? '' : em);
  if (/insufficient_quota|credit_balance_exhausted|no credits remaining/i.test(s)) return '通道额度已用完（insufficient_quota）——请到 Key 供应商处续费，或在「设置 → API Key」更换/添加新 Key 后重试。';
  if (/JSON parsing failed|Unterminated string|JSON Parse error/i.test(s)) return '模型流式返回中断（网络波动或上游截断）。请重新发送，或切换模型后再发。';
  if (/timeout|timed out|ETIMEDOUT/i.test(s)) return '模型响应超时，请重试或切换模型。';
  if (/ECONNRESET|socket hang up|network/i.test(s)) return '网络连接中断，请检查网络后重试。';
  return s.slice(0, 400);
}
function taskInjectedOf(m: any){
  var t = '';
  (m.parts || []).forEach(function(p){
    if (p.type === 'text' && /<task\s+id=/.test(p.text || '')) t += (t ? '\n' : '') + p.text;
  });
  return t;
}
function parseTaskInjected(text: string){
  var id = '', state = '';
  var m = /<task\s+id="([^"]+)"[^>]*state="([^"]+)"/.exec(text);
  if (m){ id = m[1]; state = m[2] }
  var sum = /<summary>([\s\S]*?)<\/summary>/.exec(text);
  var res = /<task_result>([\s\S]*?)<\/task_result>/.exec(text);
  return { id: id, state: state, summary: sum ? sum[1].trim() : '', result: (res ? res[1] : text).trim() };
}
function renderTaskInjected(info: any, text: string){
  var d = parseTaskInjected(text);
  var wrap = el('div', 'msg assistant task-inject');
  wrap.dataset.mid = info.id;
  var who = el('div', 'who');
  /* task277：任务回报卡同样去掉 DJ 头像方块（主人 2026-11-14「对话里面的 icon 去掉」） */
  who.appendChild(el('b', null, '小管家回报'));
  who.appendChild(el('span', 't', fmtTime(info.time && info.time.created)));
  wrap.appendChild(who);
  var card = el('div', 'acard open');
  card.dataset.sid = d.id || '';
  var h = el('div', 'acard-h');
  var rs = reportState(d.result) || (d.state === 'completed' ? 'done' : (d.state === 'error' ? 'failed' : 'running'));
  h.appendChild(el('span', 'badge', '任务结果'));
  h.appendChild(el('span', 'tt', d.summary || ('任务 ' + String(d.id || '').slice(0, 12))));
  var cls = rs === 'waiting' ? 'waiting' : (rs === 'blocked' ? 'blocked' : (rs === 'failed' ? 'error' : (rs === 'done' ? 'completed' : 'running')));
  var label = rs === 'waiting' ? '等待主人' : (rs === 'blocked' ? '受阻' : (rs === 'failed' ? '失败' : (rs === 'done' ? '完成' : '回报')));
  h.appendChild(el('span', 'acard-st ' + cls, label));
  h.onclick = function(){ card.classList.toggle('open') };
  card.appendChild(h);
  var b = el('div', 'acard-b');
  var body = el('div', 'acard-txt');
  body.innerHTML = md(d.result || '（无结果正文）');
  b.appendChild(body);
  card.appendChild(b);
  wrap.appendChild(card);
  return wrap;
}
/* task173：对话上下文署名按会话角色显示（主人 2026-11-10：角色体系已有，消息头也要用角色）
   角色键取会话自身 agent（serve /session 原生字段）；butler 根会话/子会话缺 agent 时按正证据回落，不冒充 little DJ
   task277（主人 2026-11-14 口述）：消息头头像方块退役，MSG_ROLE_AVA/sessionRoleAva 一并退役（只留角色名+着色） */
function sessionRoleKey(sess: any): string{
  if (!sess) return '';
  var a = String(sess.agent || '');
  if (a) return a;
  if (isButlerSession(sess)) return 'butler';
  if (sess.parentID) return 'child';
  return '';
}
function sessionRoleLabel(sess: any): string{
  var k = sessionRoleKey(sess);
  if (!k) return 'little DJ';
  return CHILD_ROLE_LABEL[k] || k;
}
/* ---------- task239：本轮改了哪些文件（diff 汇总卡，对齐 DJH 的「已编辑 N 个文件 +X −Y」） ----------
   数据不用新接口：serve 的 tool part 自带证据——
   `edit`  → state.metadata.filediff = { file, patch, additions, deletions }（实测有）；
   `write` → state.input.content（整文件写入，行数即新增）；
   `patch` → state.input.patchText / state.metadata.diff（按 +++ 分文件数 +/- 行）。
   纯展示：不改数据、不改接口、点击不产生写操作。 */
function _edLines(s: string){
  var a = String(s == null ? '' : s).split('\n');
  if (a.length && a[a.length - 1] === '') a.pop();
  return a.length;
}
function _edNum(n: any): number{ n = Number(n); return isFinite(n) && n > 0 ? n : 0 }
/* 从 patch 文本按文件统计增删行（跳过 ---/+++ 头） */
function statsFromPatch(text: string){
  var out = [], cur = null;
  String(text == null ? '' : text).split('\n').forEach(function(l){
    if (/^\+\+\+ /.test(l)){
      var f = l.slice(4).trim().replace(/^[ab]\//, '');
      cur = (!f || f === '/dev/null') ? null : f;
      if (cur) out.push({ file: cur, adds: 0, dels: 0 });
      return;
    }
    if (!cur) return;
    if (l.charAt(0) === '+' && !/^\+\+\+/.test(l)) out[out.length - 1].adds++;
    else if (l.charAt(0) === '-' && !/^---/.test(l)) out[out.length - 1].dels++;
  });
  return out;
}
/* 一个 tool part → [{file, adds, dels, note?}]；不是文件写入类工具返回 null */
function fileStatsOfPart(part: any){
  if (!part || part.type !== 'tool') return null;
  var st = part.state || {};
  if (st.status && st.status !== 'completed' && st.status !== 'running') return null; /* 失败/中断的不计入 */
  var input = st.input || {}, meta = st.metadata || {};
  var fd = meta.filediff;
  if (fd && fd.file) return [{ file: String(fd.file), adds: _edNum(fd.additions), dels: _edNum(fd.deletions) }];
  var tool = String(part.tool || '');
  if (tool === 'write' || tool === 'create'){
    var fp = input.filePath || meta.filepath || '';
    if (!fp) return null;
    return [{ file: String(fp), adds: _edLines(input.content), dels: 0, note: meta.exists ? '整文件覆盖写入（删除行数不单列）' : '新建文件' }];
  }
  if (tool === 'patch' || tool === 'apply_patch'){
    var txt = input.patchText || input.patch || meta.diff || '';
    var arr = statsFromPatch(txt);
    return arr.length ? arr : null;
  }
  if (tool === 'edit' && input.filePath){
    /* 兜底：没有 filediff 时用 oldString/newString 行数粗算（deveco 正常都给 filediff，走到这里说明字段缺） */
    return [{ file: String(input.filePath), adds: _edLines(input.newString), dels: _edLines(input.oldString), note: '按替换文本行数估算' }];
  }
  return null;
}
/* 按「一轮对话」聚合（user 消息切轮），挂到该轮最后一条 assistant 消息上 */
function buildEditCards(msgs: any){
  var map = {}, turnFiles = [], turnLastAsst = null, any = false;
  function flush(){
    if (turnLastAsst && turnFiles.length){
      var adds = 0, dels = 0;
      turnFiles.forEach(function(f){ adds += f.adds; dels += f.dels });
      map[turnLastAsst] = { files: turnFiles, adds: adds, dels: dels };
    }
    turnFiles = []; turnLastAsst = null;
  }
  (msgs || []).forEach(function(m){
    var info = (m && m.info) || {};
    if (info.role === 'user'){ flush(); return }
    if (info.role !== 'assistant') return;
    if (info.id) turnLastAsst = info.id;
    (m.parts || []).forEach(function(p){
      var rows = fileStatsOfPart(p);
      if (!rows) return;
      rows.forEach(function(r){
        var hit = null;
        for (var i = 0; i < turnFiles.length; i++){ if (turnFiles[i].file === r.file){ hit = turnFiles[i]; break } }
        if (hit){ hit.adds += r.adds; hit.dels += r.dels }
        else turnFiles.push({ file: r.file, adds: r.adds, dels: r.dels, note: r.note || '' });
      });
    });
  });
  flush();
  return map;
}
/* 只显示路径末两段，完整路径进 title */
function relFile(p: string): string{
  var parts = String(p || '').split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : parts.join('/');
}
/* task340：默认折叠——主人 2026-11-16 拍板「改代码文件卡改完项目后默认展开→默认折叠」。
   手动展开态记 _ecOpenMids（key=挂载消息 mid，内存级不持久化）：openSession 校准 / SSE refreshCurrent
   两处全量重渲（innerHTML='' 重建）后照记忆恢复，轮询刷新不弹回；页面刷新回归默认折叠（默认态语义以「折叠」为准）。 */
var _ecOpenMids = {};
function renderEditCard(stats: any, mid?: string){
  var card = el('div', 'editcard' + (mid && _ecOpenMids[mid] ? '' : ' collapsed'));
  var head = el('div', 'ec-h');
  /* task310：折叠箭头移到行首（左上角）——主人左手持机，右侧箭头够不着；整行点击语义不变 */
  head.appendChild(el('span', 'ec-caret', '▾'));
  head.appendChild(el('span', 'ec-ico', '▤'));
  head.appendChild(el('span', 'ec-t', '已编辑 ' + stats.files.length + ' 个文件'));
  var st = el('span', 'ec-stat');
  st.appendChild(el('span', 'ec-add', '+' + stats.adds));
  st.appendChild(el('span', 'ec-del', '−' + stats.dels));
  head.appendChild(st);
  head.title = '点一下折叠 / 展开明细';
  head.onclick = function(){
    card.classList.toggle('collapsed');
    /* task340：展开=记 mid、折叠=清 mid——全量重渲（轮询/SSE 校准）后按此恢复 */
    if (mid){ if (card.classList.contains('collapsed')) delete _ecOpenMids[mid]; else _ecOpenMids[mid] = 1; }
  };
  card.appendChild(head);
  var list = el('div', 'ec-list');
  stats.files.forEach(function(f){
    var row = el('div', 'ec-row');
    row.title = f.file + (f.note ? ' · ' + f.note : '');
    row.appendChild(el('span', 'ec-f', relFile(f.file)));
    row.appendChild(el('span', 'ec-add', '+' + f.adds));
    row.appendChild(el('span', 'ec-del', '−' + f.dels));
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
}
/* task300（主人 2026-11-14「加上模型别名、再加上缓存命中百分比」）：assistant 消息尾部元信息。
   模型优先显示主人起的别名（aliasOf 读别名单源（task337 起服务端）），缺别名回落原始 modelID；
   缓存命中率口径与顶栏 updateUsage 完全一致：cache.read ÷ (input + cache.read)，缺字段不编数。
   纯函数：渲染与 deploy/selftest-msg-meta.js 共用，避免 UI 与自测两套格式漂移。 */
function msgMetaText(info: any): string{
  info = info || {};
  var t = info.tokens;
  if (!t) return '';
  var tk = (t.input || 0) + (t.output || 0);
  var bits = ['共消耗 ' + (tk >= 1000 ? (tk / 1000).toFixed(1) + 'k' : tk) + ' tokens'];
  var mid = info.modelID || info.model || '';
  if (mid){
    var al = '';
    try { al = aliasOf({ providerID: info.providerID || info.prov || '', modelID: mid }) } catch(e){}
    bits.push(al || mid);
  }
  var cr = (t.cache && typeof t.cache.read === 'number') ? t.cache.read : null;
  var cp = (t.input || 0) + (cr || 0);
  if (cr != null && cp > 0) bits.push('缓存命中 ' + Math.round(cr / cp * 100) + '%');
  if (typeof info.cost === 'number' && info.cost) bits.push('$' + info.cost.toFixed(4));
  return bits.join(' · ');
}
function renderMessage(m: any, opt?: any){
  var info = m.info || {}, role = info.role || 'assistant';
  if (role === 'user'){
    /* task89：登记用户消息 id（openSession / refreshCurrent 两个渲染点都经过这里；待发气泡的 local- 假 id 登记无害） */
    if (info.id) S.userMids[info.id] = true;
    var inj = taskInjectedOf(m);
    if (inj) return renderTaskInjected(info, inj);
  }
  var wrap = el('div', 'msg ' + (role === 'user' ? 'user' : 'assistant'));
  /* task126 P0-1②：【系统自动提醒·程序触发】前缀=巡逻程序注入消息（/_nudge），渲染为程序消息态（署名「系统提醒」+弱化样式），不当主人发言展示。
     判定放宽为「任一 text part 含该前缀」（P2-10：目标会话首条注入拼接【开工三查】头时不失效） */
  var nudgeMsg = false;
  if (role === 'user' && Array.isArray(m.parts)) {
    m.parts.forEach(function(p){
      if (p && p.type === 'text' && String(p.text || '').indexOf('【系统自动提醒·程序触发】') !== -1) nudgeMsg = true;
    });
  }
  if (nudgeMsg) wrap.className += ' sysnudge';
  wrap.dataset.mid = info.id;
  var who = el('div', 'who');
  if (role === 'user'){
    who.appendChild(el('b', nudgeMsg ? 'sysname' : null, nudgeMsg ? '系统提醒' : '你'));
    who.appendChild(el('span', 't', fmtTime(info.time && info.time.created)));
  } else {
    var rk = sessionRoleKey(S.current);
    // task173-fu1：用 mrole-* 前缀，避免命中全局 .role-* 的 background 徽章样式把整条消息染底
    if (rk) wrap.className += ' m' + childRoleClass(rk);
    /* task277（主人 2026-11-14 口述「把对话里面的 icon 去掉」）：消息署名前的角色头像方块退役，只留角色名+时间 */
    who.appendChild(el('b', null, sessionRoleLabel(S.current)));
    who.appendChild(el('span', 't', fmtTime(info.time && info.time.created)));
  }
  wrap.appendChild(who);
  if (role === 'user'){
    var bubble = el('div', 'bubble');
    var hasBoot = false;
    var own = [];
    /* task89：休息态折叠区只收水印头部（不含正文） */
    var foldTexts = [];
    var restFold = false;
    /* task393：技能注入独立折叠区（独立 text part 注入，与水印/boot 天然解耦） */
    var skillFoldTexts = [];
    (m.parts || []).forEach(function(p){
      if (p.type === 'text'){
        var t = String(p.text || '');
        if (t.indexOf('【技能加载（自动注入') === 0){
          /* task393：技能 part 整段折进独立折叠区，正文气泡零占用 */
          skillFoldTexts.push(t);
        } else if (t.indexOf('【开工三查') === 0){
          hasBoot = true;
          var cut = t.split('——— 主人本轮消息 ———');
          var tail = cut.length > 1 ? cut[cut.length - 1].trim() : '';
          if (tail) own.push(tail);
        } else if (t.indexOf('【当前模式：休息中') === 0){
          /* task89：休息态水印只按前缀命中（右括号内含时间戳，不做全文相等）；
             剥掉水印行 + 紧随的「休息态边界：」行进折叠，余下正文照常显示 */
          restFold = true;
          hasBoot = true;
          var rl = t.split('\n');
          var ri = 1;
          if (rl.length > 1 && rl[1].indexOf('休息态边界：') === 0) ri = 2;
          foldTexts.push(rl.slice(0, ri).join('\n'));
          var restBody = rl.slice(ri).join('\n').trim();
          if (restBody) own.push(restBody);
        } else own.push(t);
      } else if (p.type === 'file' && p.url){
        var im = document.createElement('img');
        im.src = p.url; im.alt = p.filename || 'image';
        im.style.cssText = 'max-width:220px;max-height:180px;border-radius:9px;display:block;margin:4px 0';
        bubble.appendChild(im);
      }
    });
    /* task393：技能注入独立折叠区——先于 boot details；与休息态/链路水印同轮出现时
       两个折叠区并存、各 summary 各自正确，互不误标 */
    if (skillFoldTexts.length){
      var sdet = document.createElement('details');
      sdet.className = 'boot-fold';
      sdet.appendChild(el('summary', null, '⚙ 已注入技能上下文（触发自动附加，点开查看）'));
      var sfb = el('div', 'boot-fold-b');
      skillFoldTexts.forEach(function(ft){
        var d2 = el('div', 'md'); d2.innerHTML = md(ft); sfb.appendChild(d2)
      });
      sdet.appendChild(sfb);
      bubble.appendChild(sdet);
    }
    if (hasBoot){
      var det = document.createElement('details');
      det.className = 'boot-fold';
      /* task89：休息态水印不是「会话首条」注入，折叠条文案分开 */
      var sum = el('summary', null, restFold ? '⚙ 已注入休息态水印（点开查看）' : '⚙ 已注入开工上下文（会话首条自动附加，点开查看）');
      det.appendChild(sum);
      var fb = el('div', 'boot-fold-b');
      if (restFold){
        /* task89：休息态只把水印行折进折叠区，正文留在气泡里 */
        foldTexts.forEach(function(ft){
          var d2 = el('div', 'md'); d2.innerHTML = md(ft); fb.appendChild(d2)
        });
      } else {
        (m.parts || []).forEach(function(p){
          /* task393 产审 P1-5：首条+技能同轮时技能 part 已进独立折叠区，这里跳过防二次收进开工折叠体 */
          if (p.type === 'text' && String(p.text || '').indexOf('【技能加载（自动注入') !== 0){ var d2 = el('div', 'md'); d2.innerHTML = md(p.text || ''); fb.appendChild(d2) }
        });
      }
      det.appendChild(fb);
      bubble.appendChild(det);
    }
    own.forEach(function(t){ bubble.innerHTML += md(t) });
    wrap.appendChild(bubble);
  } else {
    var body = el('div', 'body');
    var hiddenSteps = 0, taskParts = [];
    (m.parts || []).forEach(function(p){
      if (p.type === 'tool' && p.tool === 'task'){ taskParts.push(p); return }
      if (p.type === 'reasoning' || p.type === 'tool'){ hiddenSteps++; return }
      var n = renderPart(p); if (n) body.appendChild(n);
    });
    // 同一条 assistant 消息内多个 task part 合并为一行（◇ 小管家 ×N），详情看左栏
    if (taskParts.length) body.appendChild(renderAgentCard(taskParts[taskParts.length - 1], taskParts.length));
    if (!body.children.length){
      if (hiddenSteps > 0) body.appendChild(el('div', 'steps-hint', '◈ 本轮 ' + hiddenSteps + ' 个任务步骤 · 详见右侧「任务」栏'));
      else body.appendChild(el('div', 'part-text thinking-ph', '（思考中…）'));
    }
    wrap.appendChild(body);
    if (info.error){
      var em = info.error.data && info.error.data.message ? info.error.data.message : (info.error.name || '模型调用失败');
      wrap.appendChild(el('div', 'msg-error', '⚠ ' + friendlyError(em)));
    }
    var acts = el('div', 'acts');
    /* task195：主人定——手机无 ESC，AI 回话下方只留「复制」+「叉叉＝停止生成（等价电脑 ESC 停当前对话）」；刷新/三个点退役（刷新无用、三个点原为死按钮） */
    /* task314-fork：加「从这里分叉」——把到此条为止的历史复制成新会话（DSH 分叉同语义） */
    /* task347：加「语音播报」🔊——用 DeepSeek TTS 朗读这条回复全文（默认女声 stella，设置→TTS 可切男声 tide） */
    /* task362（主人：照 DAG AI Chat 抄）——🔊 升级迷你播放器（DAG TtsPlayerControl 同款交互）：
       主键三态（🔊空闲/⏳合成中不可点/⏸播放中→暂停/▶暂停→继续）+ 停止键 ■（激活期展开、裁切动画、常驻挂载禁 if）；
       图标 SVG currentColor 跟按钮色；三态切换与发光呼吸由 voice.js msgSpeakBtnSync 动态刷 */
    acts.innerHTML = '<button data-act="copy" title="复制">⧉</button><button data-act="fork" title="从这里分叉（保留到此条为止的历史，开新会话）">' + CONV_ICON_FORK + '</button>'
      + '<span class="ssp"><button data-act="speak" class="ssp-main" title="语音播报：朗读这条回复（播放中可暂停）">🔊</button>'
      + '<button data-act="speakstop" class="ssp-stop" title="停止播报"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.6" fill="currentColor"/></svg></button></span>'
      + '<button data-act="stop" title="停止生成（同电脑 ESC）">✕</button>';
    var _metaTxt = msgMetaText(info);
    if (_metaTxt) acts.appendChild(el('span', 'meta', _metaTxt));
    wrap.appendChild(acts);
    /* task239：本轮改过文件 → 消息末尾挂 diff 汇总卡（数据来自 tool part 自带证据，见 buildEditCards）；
       task340：传挂载消息 mid——默认折叠 + 手动展开记忆按 mid 恢复 */
    if (opt && opt.edits && opt.edits.files && opt.edits.files.length) wrap.appendChild(renderEditCard(opt.edits, info.id));
  }
  return wrap;
}
function renderPart(p: any){
  if (!p) return null;
  if (p.type === 'text'){
    var d = el('div', 'part-text md'); d.innerHTML = md(p.text || ''); d.dataset.partid = p.id || ''; return d;
  }
  // reasoning / tool 已挪到右栏「任务」面板（renderTasks），中栏只留结果内容
  if (p.type === 'step-start' || p.type === 'step-finish' || p.type === 'snapshot' || p.type === 'reasoning' || p.type === 'tool') return null;
  var chip2 = el('div', 'steps-hint');
  chip2.appendChild(el('span', 'nm', p.type || 'part'));
  return chip2;
}

window.MSG_CACHE_MAX=MSG_CACHE_MAX; window.MSG_CACHE_MAX_MSGS=MSG_CACHE_MAX_MSGS; window.msgCachePut=msgCachePut; window.msgCacheDrop=msgCacheDrop; window.msgsFingerprint=msgsFingerprint; window.msgsIsNewer=msgsIsNewer; window.openSession=openSession; window.renderSessionMessages=renderSessionMessages; window.pruneThinking=pruneThinking; window.friendlyError=friendlyError; window.taskInjectedOf=taskInjectedOf; window.parseTaskInjected=parseTaskInjected; window.renderTaskInjected=renderTaskInjected; window.sessionRoleKey=sessionRoleKey; window.sessionRoleLabel=sessionRoleLabel; window._edLines=_edLines; window._edNum=_edNum; window.statsFromPatch=statsFromPatch; window.fileStatsOfPart=fileStatsOfPart; window.buildEditCards=buildEditCards; window.relFile=relFile; window.renderEditCard=renderEditCard; window.msgMetaText=msgMetaText; window.renderMessage=renderMessage; window.renderPart=renderPart;

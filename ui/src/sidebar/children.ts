/* @module children @order 9 @职责 会话树子行/懒加载/角色状态 @提供 CHILD_ROLE_LABEL CHILD_ROLE_CLASS CHILD_TITLE_SUFFIX_RE AGENT_ROLE_WHITELIST LEAF_CHILD_ROLE_EXACT childRoleLabel childRoleClass childRoleKey childMismatchAgent isLeafChildRole childTitleText computeWaitDesc childStatusInfo fetchChildren toggleConvOpen @依赖 - @依赖运行期 dedupeTaskTitle S TASKS _sbLiveRunner fmtTime _waitDesc S_ENDED api scheduleSidebar renderSidebar @DOM契约 - @严格模式 是 @全局占用 CHILD_ROLE_LABEL CHILD_ROLE_CLASS CHILD_TITLE_SUFFIX_RE AGENT_ROLE_WHITELIST LEAF_CHILD_ROLE_EXACT childRoleLabel childRoleClass childRoleKey childMismatchAgent isLeafChildRole childTitleText computeWaitDesc childStatusInfo fetchChildren toggleConvOpen @源行 ui/index.html L2563-L2747 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task54 B：会话树辅助（子行渲染 / 懒加载 / 角色与状态） ---------- */
/* task149：build 是 deveco 内置执行器名，不是管家角色，别硬译成「构建」（主人 2026-11-09 指正：没有角色叫构建），统一中性「子代理」 */
/* task263：标签跟角色职责对齐，不再写模型名（角色页可改模型，模型名上屏会随改模型而失真）
   task265：角色键与模型彻底解耦——新键 censor-plan/censor-output；旧键 censor-deepseek/glm 退役但条目永留（历史会话数据渲染兜底） */
var CHILD_ROLE_LABEL = { butler: '大管家', steward: '小管家', secretariat: '枢机', writer: '执笔', 'censor-plan': '御史·方案审', 'censor-output': '御史·产出审', 'censor-deepseek': '御史·方案审', 'censor-glm': '御史·产出审', general: '通用', explore: '探查', build: '子代理', child: '子代理' };
function childRoleLabel(agent: unknown): string{
  var a = String(agent || '');
  return CHILD_ROLE_LABEL[a] || (a || '子代理');
}
/* task70 S3-3：角色 → 类名（单表；新增角色 = 1 行变量对 + 1 行类 + 1 行映射，不碰渲染点） */
var CHILD_ROLE_CLASS = {
  steward: 'role-steward', secretariat: 'role-secretariat', writer: 'role-writer',
  'censor-plan': 'role-censor-plan', 'censor-output': 'role-censor-output',
  'censor-deepseek': 'role-censor-ds', 'censor-glm': 'role-censor-glm', /* task265 退役键：历史会话兜底 */
  butler: 'role-butler',
  general: 'role-aux', explore: 'role-aux', build: 'role-aux', child: 'role-aux'
};
function childRoleClass(key: unknown): string{
  return CHILD_ROLE_CLASS[String(key || '')] || 'role-unknown';
}
/* task182：子会话标题后缀 `(@agent subagent)` 是派单时写入的真实角色；c.agent 可能只是
   deveco 执行器名（如 build），故后缀优先——避免「御史·方案审」被显示成中性「子代理」。
   正则与 childTitleText 的剥离共用同一常量，防两处漂移。 */
var CHILD_TITLE_SUFFIX_RE = /\s*\(@([^)]*)\s+subagent\)\s*$/i;
function childRoleKey(c: { title?: string; agent?: string } | null): string{
  var m = CHILD_TITLE_SUFFIX_RE.exec(String((c && c.title) || ''));
  var k = (m && m[1]) ? String(m[1]).trim() : String((c && c.agent) || '');
  return k;
}
/* task184：派单角色丢失检测——标题后缀（派单要求）与实际执行器不一致时返回实际 agent。
   宿主 serve 的 task 工具偶发丢失 subagent_type、静默回落 build/general ⇒ 御史会话拿到全工具。
   白名单与 server/task-derive.js agentMismatchOf 同源（selftest 交叉断言防漂移）；
   管家系 6 + 内置 3（plan/goal 库内 0 条不列，新增内置角色两处同步补表）。 */
var AGENT_ROLE_WHITELIST = { butler: 1, steward: 1, secretariat: 1, writer: 1, 'censor-plan': 1, 'censor-output': 1, 'censor-deepseek': 1, 'censor-glm': 1, build: 1, general: 1, explore: 1 }; /* task265：新键上线，旧键永留校验历史标题后缀 */
function childMismatchAgent(c: { title?: string; agent?: string } | null): string{
  var m = CHILD_TITLE_SUFFIX_RE.exec(String((c && c.title) || ''));
  if (!m || !m[1]) return '';
  var want = String(m[1]).trim(), got = String((c && c.agent) || '').trim();
  if (!want || !got || !AGENT_ROLE_WHITELIST[want] || want === got) return '';
  return got;
}
/* task179：叶子角色（不派单，实际永不持有子会话）——子会话行「未加载」时不乐观画折叠箭头。
   censor 走前缀（世界观「御史（censor-*）」，将来新增御史角色不会落空）；
   注意 build 不在表内：库内确有 agent=build 的子会话带孙辈，需 caret 才能触发 fetchChildren 展开。 */
var LEAF_CHILD_ROLE_EXACT = { writer: 1, child: 1, general: 1, explore: 1 };
function isLeafChildRole(agent: unknown): boolean{
  var a = String(agent || '');
  if (a.indexOf('censor-') === 0) return true;
  return !!LEAF_CHILD_ROLE_EXACT[a];
}
function childTitleText(title: unknown): string{
  var t = String(title || '').replace(CHILD_TITLE_SUFFIX_RE, '').trim();
  return dedupeTaskTitle(t) || '未命名会话';
}
/* task188：预计算「等待中」祖先集——在跑会话（S.busyBy ∪ _sbLiveRunner）沿父链上溯途经的每个祖先 id。
   父链数据源双保险（方案审 P1-2）：
   ① S.childParent（fetchChildren 回填 + SSE session.updated 补写）；
   ② 已加载 children 池反查（只展开一层的场景：子代理在未展开层时 childParent 缺，池里找得到就补）。
   深度上限 8 防 childParent 历史脏数据成环；断链则提前终止=退化为现状（不劣化）。 */
function computeWaitDesc(): { [k: string]: number }{
  var out = {};
  var par = {}, k;
  for (k in S.childParent){ if (S.childParent[k]) par[k] = S.childParent[k] }
  Object.keys(S.children || {}).forEach(function(pid){
    var arr = S.children[pid] || [];
    for (var i = 0; i < arr.length; i++){ var c = arr[i]; if (c && c.id && !par[c.id]) par[c.id] = pid }
  });
  /* task219（主人 2026-11-11 报障）：③ 台账直连边——caret 未展开时 childParent/children 池皆空，父链断 ⇒ 祖先集空 ⇒
      大管家行恒「空闲中」，展开一次才变「等待中」。派生层 SQL 保证 runnerSession 是行 id 的直接子（task-derive 子查询），
      故一条行 id 即可补父边，零服务端字段、零新缓存（方案审尺三①：rootId ≡ 行 id，服务端加字段纯冗余已砍）。
      谓词用 raw 派生行语义而非 stageOf：stageOf 无 archived 分支、会把归档行判 active（方案审 P1-1）；
      stale==='stalled' 除外——与 _sbLiveRunner 的 active 口径（groupProjectTasks 走 stageOf）保持一致，防静默行假「等待中」。
     task318（主人 2026-11-15 报障）：④ 等外部在途行——无 runnerSession 但 state=running（活儿派给外部系统如 DAG 测试台、
      等外部回结果，现场实例 DAG_AI_Chat 会话 stalled 43min 误显「空闲中」）。此类行无子可上溯，行自身直接进等待集合；
      谓词：stale∉{active,archived}——active 不收（归 task317「轮询中」口径，防覆盖刚验收的显示）、archived 不收（24h 僵尸
      running 防永久等待中假信号）；不看 inTask（state=running 是在途硬信号，等外部型常无任务牌）。 */
  var _ledgerRoots = [], _extWait = {};
  (TASKS.list || []).forEach(function(t){
    if (!t) return;
    /* task334：显式等待中（op=hold 挂后台任务型，如测试台无限循环监督）——显式声明直进等待集合，
       不上溯（行自身即语义主体）；这是 task318 等外部型（判 running）的补洞——行被 auto-done 收口后
       state 不再 running，task318 判定失效，显式 hold 通道压过自动收口标记。 */
    if (t.state === 'waiting'){ if (t.id && t.stale !== 'archived') _extWait[t.id] = 1; return; } /* P2-9：archived 不收——24h 僵尸 hold 防侧栏永久等待中假信号 */
    if (t.state !== 'running') return;
    if (!t.runnerSession){
      if (t.id && t.stale !== 'active' && t.stale !== 'archived') _extWait[t.id] = 1;
      return;
    }
    if (t.inTask === false) return;
    if (t.stale === 'stalled') return;
    if (t.runnerSession !== t.id && !par[t.runnerSession]) par[t.runnerSession] = t.id; /* 防御自指成环 */
    if (t.id) _ledgerRoots.push(t.id);
  });
  var src = [], seen = {};
  Object.keys(S.busyBy || {}).forEach(function(sid){ if (S.busyBy[sid]){ src.push(sid); seen[sid] = 1 } });
  Object.keys(_sbLiveRunner || {}).forEach(function(sid){ if (!seen[sid]){ src.push(sid); seen[sid] = 1 } });
  src.forEach(function(sid){
    var p = par[sid], guard = 0;
    while (p && guard++ < 8){ out[p] = 1; p = par[p]; }
  });
  /* task219：台账根自身及更上层祖先一并标「等待中」（正常链路下为 根→子 一跳；无 childParent 时至少命中根行） */
  _ledgerRoots.forEach(function(rid){
    var p = rid, guard = 0;
    while (p && guard++ < 8){ if (out[p]) break; out[p] = 1; p = par[p]; }
  });
  /* task318：等外部在途行并入等待集合——行自身标「等待中」，不上溯（无子树） */
  Object.keys(_extWait).forEach(function(k){ out[k] = 1 });
  return out;
}
function childStatusInfo(c: { id: string; time?: { updated?: number }; parentID?: string }): { txt: string; cls: string }{
  if (S.busyBy[c.id]) return { txt: '执行中', cls: 'live' };
  if (_sbLiveRunner[c.id]) return { txt: '执行中', cls: 'live' }; /* task190：实时 runner 与 busyBy 同为执行中=绿（原 'wait' 黄与「等待中」混色） */
  var upd = (c.time && c.time.updated) || 0;
  var age = Date.now() - upd;
  /* task159：台账终态优先（/_tasks 行经 applyOverrides 后带 state；children 接口不含终态——task157 P2-3 的显示侧补口）
     已人工/auto-reap 标记的子会话不再误显「疑似中断」；历史 runner（非该任务最新 runner）无对应行，走下方原逻辑兜底 */
  var fin = null, _tl = (TASKS && TASKS.list) || [];
  for (var _i = 0; _i < _tl.length; _i++) {
    var _r = _tl[_i];
    if (_r && (_r.runnerSession === c.id || _r.id === c.id)) { fin = _r; break; }
  }
  if (fin && fin.state === 'interrupted') return { txt: '已中断' + (upd ? ' ' + fmtTime(upd) : ''), cls: 'inter' }; /* task190：红 */
  /* task188 P1-1（方案审）：auto-done（auto-reap 推断，overrideNote 前缀 'auto-done'）不压「等待中」——
     子代在跑是 SSE 硬证据；人工 done（overrideNote 非 auto-done/空）仍是定夺证据优先「已完成」。
     proxy AUTO_DONE_NOTE_PREFIX='auto-done'，派生行字段 overrideNote（applyOverrides 落）。 */
  if (fin && fin.state === 'done' && String(fin.overrideNote || '').indexOf('auto-done') !== 0) return { txt: '已完成', cls: 'done' };
  /* task188：自身 idle 但手下子代理（含深层孙代）在跑 → 「等待中」（主人 2026-11-10 定：五角色模式小管家不应显已完成）。
     优先级：fin interrupted 已中断 > 人工 done 已完成 > 等待中 > S_ENDED 已完成（S_ENDED 只是本页 idle 注入小证据）。 */
  if (_waitDesc[c.id]) return { txt: '等待中', cls: 'wait' };
  /* task157：终局正证据（本页收到 idle/完成注入）才显示「已完成」 */
  if (S_ENDED[c.id]) return { txt: '已完成', cls: 'done' };
  /* task181：非最新子会话（历史 runner / 非当前 runnerSession）无自身任务行 → 回退继承父根行终态。
     仅 done 级联（根 done = 任务整体收口 ⇒ 子代理确已结束）；interrupted 不级联（根 interrupted = 当前 runner 卡死，
     不覆盖更早子代理，级联会把已完成的历史子误标成已中断——方案审 P1-1）。
     时序护栏：子最后活动须早于父收口时刻，防「父 done 后子会话被复用继续工作」时误显已完成（方案审 P1-2 / L-050 同哲学）。
     触发仅当 fin 为空（自身有终态行时优先走上方 fin/S_ENDED，零覆盖）；深层子会话 parentPid 非根 ⇒ 不命中、维持原兜底。 */
  if (!fin){
    var _ppid = S.childParent[c.id] || (c.parentID || '');
    if (_ppid){
      for (var _j = 0; _j < _tl.length; _j++){
        var _pr = _tl[_j];
        if (_pr && _pr.id === _ppid && _pr.state === 'done' && (!_pr.overrideAt || upd < _pr.overrideAt)){
          return { txt: '已完成', cls: 'done' };
        }
      }
    }
  }
  if (upd && age < 45 * 60 * 1000) return { txt: '静默 ' + Math.max(1, Math.round(age / 60000)) + 'm', cls: '' };
  /* task157：15min 无动静且无终局证据——不再显示假「已完成」（children 响应不含 ended/state，P2-3）；
     24h 外按归档显示已完成，免刷新后满屏疑似中断 */
  if (!upd || age >= 24 * 3600 * 1000) return { txt: '已完成', cls: 'done' };
  /* task180：疑似中断阈值 15min → 45min——自动完成最迟 ≈15min、auto-reap interrupt ≈35min 收口，
     45min 后仍无终态才是真异常（旧值让「刚跑完」的正常任务长时间背假告警，主人 2026-11-10 报障） */
  return { txt: '疑似中断（静默 ' + Math.max(45, Math.round(age / 60000)) + 'm）', cls: 'stall' }; /* task190：橙红 */
}
/* task342：childMatchesQ 随左栏搜索入口退役删除（零引用） */
function fetchChildren(pid: string): void{
  if (!pid || S.childrenLoading[pid]) return;
  S.childrenLoading[pid] = 1;
  delete S.childrenErr[pid];
  api('/session/' + encodeURIComponent(pid) + '/children').then(function(list){
    delete S.childrenLoading[pid];
    delete S.childrenDirty[pid]; /* task70 F1-1：回填成功即清脏标记 */
    var arr = Array.isArray(list) ? list.slice() : [];
    S._childDrop = S._childDrop || {};
    /* task182：父级一致性校验——该接口理论只返回本会话的直接子会话；若混入别家的行，
       会让同父子的子行按不同 level 渲染（主人 2026-11-10 报「下面的御史左移 12px」）。
       丢弃不一致项并计数（诊断用，不打印、不打断渲染）。 */
    arr = arr.filter(function(c){
      if (!c || !c.id) return false;
      if (c.parentID && String(c.parentID) !== String(pid)) {
        S._childDrop[pid] = (S._childDrop[pid] || 0) + 1;
        return false;
      }
      return true;
    });
    arr.sort(function(a, b){ return ((b.time && b.time.updated) || 0) - ((a.time && a.time.updated) || 0) });
    S.children[pid] = arr;
    arr.forEach(function(c){ if (c && c.id) S.childParent[c.id] = pid });
    scheduleSidebar();
  }).catch(function(){
    delete S.childrenLoading[pid];
    S.childrenErr[pid] = '子会话加载失败 · 点击重试';
    scheduleSidebar();
  });
}
function toggleConvOpen(id: string): void{
  if (S.convOpen[id]) delete S.convOpen[id];
  else {
    S.convOpen[id] = 1;
    if (!Object.prototype.hasOwnProperty.call(S.children, id) && !S.childrenLoading[id]) fetchChildren(id);
  }
  renderSidebar();
}
window.CHILD_ROLE_LABEL=CHILD_ROLE_LABEL; window.CHILD_ROLE_CLASS=CHILD_ROLE_CLASS; window.CHILD_TITLE_SUFFIX_RE=CHILD_TITLE_SUFFIX_RE; window.AGENT_ROLE_WHITELIST=AGENT_ROLE_WHITELIST; window.LEAF_CHILD_ROLE_EXACT=LEAF_CHILD_ROLE_EXACT; window.childRoleLabel=childRoleLabel; window.childRoleClass=childRoleClass; window.childRoleKey=childRoleKey; window.childMismatchAgent=childMismatchAgent; window.isLeafChildRole=isLeafChildRole; window.childTitleText=childTitleText; window.computeWaitDesc=computeWaitDesc; window.childStatusInfo=childStatusInfo; window.fetchChildren=fetchChildren; window.toggleConvOpen=toggleConvOpen;

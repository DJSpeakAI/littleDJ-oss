/* @module session @order 12 @职责 建会话/打开会话/忙闲推断 @提供 newTask findJustCreatedSession loadSessionsRetry netErrText createSession inferBusy @依赖 - @依赖运行期 findProject defaultProjectName loadProjects S _projRowHidden askNewProject loadSessions fmtTime api _localNewSids openSession renderSidebar isButlerSession markActiveButler scheduleSidebar @DOM契约 - @严格模式 是 @全局占用 newTask findJustCreatedSession loadSessionsRetry netErrText createSession inferBusy @源行 ui/index.html L3422-L3538 @测试锚点 - @被调用 - */
'use strict';
/* ---------- session ---------- */
function newTask(project?: string): void{
  var abs = project ? findProject(project) : findProject(defaultProjectName());
  if (!abs){
    loadProjects().then(function(){
      /* task243：兜底也别挑到「左栏看不见的项目」 */
      var pool = S.projects.concat(S.imports);
      var p = pool.filter(function(x){ return x && x.name === defaultProjectName() })[0]
        || pool.filter(function(x){ return x && !_projRowHidden(x) })[0]
        || S.projects[0];
      if (!p) return askNewProject();
      createSession(p.path);
    });
    return;
  }
  createSession(abs);
}
/* ---------- 建会话健壮化（task238）----------
   真机实锤（2026-11-12 16:17:40，主人报「我在 dag ai chat 里面新建对话失败」）：
   POST /api/session 已经 200 落库（服务端有该会话，标题「新对话 16:17」），紧随的 GET /_sessions（约 350KB）
   在公网链路上失败 → 旧代码把整条 .then 链一起 catch → 弹「建对话失败：Failed to fetch」，
   会话其实已经建好了。三层护栏：
   ① 拉列表失败自动重试 1 次（600ms 后）；
   ② POST 本身网络级失败时，先刷一次列表按「同目录 + 同标题 + 刚创建」核对，已建成即当成功；
   ③ 错误文案说人话（网络中断 → 提示刷新页面），不再甩裸 Failed to fetch。 */
function findJustCreatedSession(abs: string, title: string, since: number){
  var hit = null;
  (S.sessions || []).forEach(function(s){
    if (String(s.directory || '') !== String(abs || '')) return;
    if (s.title !== title) return;
    var t = Number((s.time && s.time.created) || 0);
    if (!t || t < since) return;
    if (!hit || t > Number((hit.time && hit.time.created) || 0)) hit = s;
  });
  return hit;
}
function loadSessionsRetry(n: number){
  return loadSessions().catch(function(e){
    if (!n) throw e;
    return new Promise(function(res){ setTimeout(res, 600) }).then(function(){ return loadSessionsRetry(n - 1) });
  });
}
function netErrText(e: any): string{
  var m = String((e && e.message) || e || '');
  if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(m)) return '网络中断（' + m + '）——已自动重试仍没成功，请刷新页面后再试';
  return m;
}
function createSession(abs: string, cb?: (sess: any, err?: any) => void, opts?: { noMarkActive?: boolean }): void{
  var title = '新对话 ' + fmtTime(Date.now());
  var prev = S.current; /* task106：建会话成功后才切指针/折叠；失败保持旧会话原样 */
  var since = Date.now() - 60000;
  var created = null;
  api('/session?directory=' + encodeURIComponent(abs), { method: 'POST', body: { title: title } })
    .catch(function(e){
      /* task238 ②：POST 网络级失败可能「其实已落库」，先核对再报错 */
      return loadSessionsRetry(0).then(function(){
        var hit = findJustCreatedSession(abs, title, since);
        if (!hit) throw e;
        return hit;
      });
    })
    .then(function(sess){
      created = sess;
      if (sess && sess.id) _localNewSids[sess.id] = 1;
      return loadSessionsRetry(1).then(function(){ /* task238 ①：拉列表失败重试 1 次 */
        var target = (created && created.id) ? ((S.sessions || []).filter(function(x){ return x.id === created.id })[0] || created) : created;
        if (!target) throw new Error('会话没建起来（服务端未返回会话对象）');
        /* task240（真机 16:31/16:33 报障：第一次建完左栏不出现，再点一次才冒出来）：
           服务端会话列表偶尔比 POST 慢半拍（或被渲染层过滤掉）——只要列表里没有这个 id，
           就先乐观塞进内存并直接重绘左栏（不等 200ms 节流），保证「点了就看见」；
           下一轮 loadSessions 整体替换时会按 id 自然去重。 */
        var listed = (S.sessions || []).some(function(x){ return x && x.id === target.id });
        if (target.id && !listed){
          if (target.pwa == null) target.pwa = 1; /* 本机新建=大管家会话，供「只列今天 / 大管家判定」用 */
          S.sessions = S.sessions || [];
          S.sessions.unshift(target);
        }
        openSession(target);
        renderSidebar(); /* 左栏当场重绘（openSession 内已 setView，这里再补一帧，防中途异常把链路掐断） */
        if (window.console && console.info) console.info('[createSession] id=' + target.id + ' listed=' + listed);
        /* task106 D3：仅「大管家上下文 + 同目录」写活跃指针（旧根折叠已退役，task177）；纯内存指针，不删 children / 不 hidden */
        if (prev && prev.id !== target.id && !target.parentID
          && (!opts || !opts.noMarkActive) /* task150：自动新开（source=auto）且交接摘要为空时，不写活跃指针，防空壳污染指针 */
          && (isButlerSession(prev) || prev.id === S.activeButlerSid || isButlerSession(target))
          && String(target.directory || '') === String(prev.directory || '')){
          markActiveButler(target.id); /* task177：去 prev 参数（旧根折叠已退役，指针照写） */
          scheduleSidebar();
        }
        if (cb) cb(target);
      });
    })
    .catch(function(e){
      if (cb) return cb(null, e);
      alert('建对话失败：' + netErrText(e));
    });
}
function inferBusy(msgs: any): boolean{
  if (!msgs || !msgs.length) return false;
  var last = msgs[msgs.length - 1], info = last.info || {};
  // 僵尸保护：serve 崩溃重启后，卡死的 running 状态距今超过 5 分钟视为已死，不再阻塞发送
  var ZOMBIE_MS = 5 * 60 * 1000;
  var t = info.time || {};
  var lastTouch = t.updated || t.created || 0;
  var zombie = !!(lastTouch && Date.now() - lastTouch > ZOMBIE_MS);
  var parts = last.parts || [], i;
  for (i = 0; i < parts.length; i++){
    if ((parts[i].state || {}).status === 'running') return !zombie; /* 工具在跑=硬信号（超 5 分钟仍按僵尸收口，同旧口径） */
  }
  if (info.role === 'user') return !zombie;
  if (info.role === 'assistant'){
    /* task341（主人 2026-11-16 报障「DAG AI Chat 明明在跑显示空闲中」）：
       回合未收口=在跑——末条 assistant 消息缺 info.time.completed 即仍在生成。
       覆盖「思考窗口」：模型推理阶段 parts 只有 step-start/reasoning、不带 state.status='running'，
       旧判据（只看 running part/末条 user）把正在跑推理的会话误判 IDLE，侧栏回落「空闲中」。
       僵尸保护不变：created 超 5 分钟仍按已死处理，防 serve 崩溃残留卡死。 */
    if (!t.completed && t.created) return !zombie;
  }
  return false;
}
window.newTask=newTask; window.findJustCreatedSession=findJustCreatedSession; window.loadSessionsRetry=loadSessionsRetry; window.netErrText=netErrText; window.createSession=createSession; window.inferBusy=inferBusy;

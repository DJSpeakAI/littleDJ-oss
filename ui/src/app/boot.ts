/* @module boot @order 48 @职责 登录卡片 + 启动引导 @提供 _loginShown _sseAuthProbeAt renderLoginCard djDoLogin sseAuthSelfheal bootstrap bootReal @依赖 - @依赖运行期 sse sseDir tuiSse clearSseRetry isMobile _bootAt syncScrollBtnPos syncInputPh ensureSoundDefaultsMigrated POP_TAB bootPopout connectTuiBell S renderQuote loadModelsWithRetry loadHiddenSessions loadSessions loadBoardData renderSidebar connectSSE setView isHiddenId openSession toast toggleBusyUI fetchBalance @DOM契约 - @严格模式 是 @全局占用 _loginShown _sseAuthProbeAt renderLoginCard djDoLogin sseAuthSelfheal bootstrap bootReal @源行 ui/index.html L13440-L13567 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task295 A5：登录卡片（/_auth 探针 401 时渲染；不启动 app/SSE/轮询） ---------- */
var _loginShown = false;
function renderLoginCard(){
  if (_loginShown) return; _loginShown = true;
  try { if (sse){ sse.close(); sse = null; sseDir = null } } catch(e){}
  try { if (tuiSse){ tuiSse.close(); tuiSse = null } } catch(e){}
  clearSseRetry();
  if (!document.getElementById('djLoginMask')){
    var st = document.createElement('style');
    st.textContent = '#djLoginMask{position:fixed;inset:0;background:linear-gradient(160deg,#1b2333,#0e1420);display:flex;align-items:center;justify-content:center;z-index:99999}'
      + '#djLoginCard{width:min(340px,88vw);background:#f7f8fa;border-radius:16px;padding:28px 26px;box-shadow:0 18px 60px rgba(0,0,0,.45);text-align:center;font-family:system-ui,-apple-system,sans-serif}'
      + '#djLoginCard .t{font-size:22px;font-weight:700;color:#22314a}#djLoginCard .s{font-size:12px;color:#8a93a6;margin:6px 0 18px}'
      + '#djLoginCard input{width:100%;box-sizing:border-box;margin:7px 0;padding:11px 12px;border:1px solid #d8dde6;border-radius:10px;font-size:15px;outline:none;background:#fff}'
      + '#djLoginCard input:focus{border-color:#4c7dff}#djLoginCard button{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#4c7dff;color:#fff;font-size:16px;font-weight:600}'
      + '#djLoginCard button:disabled{opacity:.55}#djLoginErr{min-height:18px;font-size:13px;color:#d5443a;margin-top:10px}';
    document.head.appendChild(st);
    var d = document.createElement('div'); d.id = 'djLoginMask';
    d.innerHTML = '<div id="djLoginCard"><div class="t">🤵 little DJ</div><div class="s">请登录后使用（登录一次，本设备 90 天免密）</div>'
      + '<input id="djLoginUser" placeholder="用户名" autocomplete="username" value="dj">'
      + '<input id="djLoginPass" type="password" placeholder="密码" autocomplete="current-password">'
      + '<input id="djLoginName" placeholder="设备名（可选，默认' + (isMobile() ? '手机' : '电脑') + '）">'
      + '<button id="djLoginBtn">登 录</button><div id="djLoginErr"></div></div>';
    document.body.appendChild(d);
    $('#djLoginBtn').onclick = djDoLogin;
    $('#djLoginMask').addEventListener('keydown', function(ev){ if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) djDoLogin() });
  }
  var m = document.getElementById('djLoginMask'); if (m) m.style.display = 'flex';
  var u = $('#djLoginUser'); if (u) try { u.focus() } catch(e){}
}
function djDoLogin(){
  var btn = $('#djLoginBtn'), err = $('#djLoginErr');
  if (!btn || btn.disabled) return;
  var user = ($('#djLoginUser') || {}).value || '';
  var pass = ($('#djLoginPass') || {}).value || '';
  var name = ($('#djLoginName') || {}).value || '';
  name = String(name).trim() || (isMobile() ? '手机' : '电脑'); /* 产出审 P2-新4：空名按端型兜底 */
  if (err) err.textContent = '';
  btn.disabled = true; btn.textContent = '登录中…';
  fetch('/_login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: user, pass: pass, name: name }) })
    .then(function(r){ return r.json().then(function(j){ return { code: r.status, body: j } }) })
    .then(function(r){
      if (r.code === 200 && r.body && r.body.ok) { _loginShown = false; location.reload(); return }
      if (err) err.textContent = (r.body && r.body.error) || '登录失败，请重试';
      btn.disabled = false; btn.textContent = '登 录';
    })
    .catch(function(){
      if (err) err.textContent = '网络异常，请稍后再试';
      btn.disabled = false; btn.textContent = '登 录';
    });
}
/* task295 A5/R2-P2-9：通行证被吊销/过期的自愈——SSE 断开后节流探针 /_auth，401 → 关闭全部 SSE+回登录卡片 */
var _sseAuthProbeAt = 0;
function sseAuthSelfheal(){
  var now = Date.now();
  if (_sseAuthProbeAt && now - _sseAuthProbeAt < 10000) return;
  _sseAuthProbeAt = now;
  fetch('/_auth').then(function(r){ if (r.status === 401) renderLoginCard() }).catch(function(){});
}
function bootstrap(){
  _bootAt = Date.now(); /* task149：刷新/重连守卫起点 */
  syncScrollBtnPos();
  syncInputPh(); /* task88-S3：首屏按端型定占位 */
  ensureSoundDefaultsMigrated(); /* task97 W-D：先迁移存量键，再连铃桥 */
  if (POP_TAB){ bootPopout(); return } /* task206：大屏弹出页早退——不连铃桥/不拉会话/不连 SSE/不查余额 */
  /* task295 A5：boot 探针（/_auth 仅认 cookie）——401 只渲染登录卡片、不启动 app/SSE/轮询；
     桌面已存 Basic 凭据场景同样走卡片输一次（P2-7 口径：首次从 Basic 弹窗变登录卡片），此后 cookie 90 天；
     产出审 P2-9：5s 超时兜底（proxy 挂起时卡片+提示，不空白等待） */
  var authProbeDone = false;
  var authProbeTimer = setTimeout(function () {
    if (authProbeDone) return;
    authProbeDone = true;
    renderLoginCard();
    var e = document.getElementById('djLoginErr');
    if (e) e.textContent = '连接超时，请检查网络后刷新重试';
  }, 5000);
  fetch('/_auth').then(function(r){ return r.status }).catch(function(){ return -1 }).then(function(code){
    if (authProbeDone) return;
    authProbeDone = true;
    clearTimeout(authProbeTimer);
    if (code === 200) bootReal();
    else renderLoginCard();
  });
}
function bootReal(){
  connectTuiBell(); // TUI 提示音桥：与目录无关，启动即连
  fetch('/_dirs').then(function(r){ return r.json() }).then(function(d){
    S.projects = d.projects || []; S.imports = d.imports || []; S.root = d.root; S.order = d.order || [];
    $('#verText').textContent = 'personal agent · v0.391.0.0'; /* task385：三处 verText 同值（index.html 静态+boot+popout），scroll-jump D7 守门；单源化（全局常量）列入 P1-7 主题化 */
    renderQuote(); /* task77：首屏把引用条归位（S.quote 初值 null ⇒ 只保证 hidden） */
    /* task337：别名先于模型列表就位（下拉渲染读 aliasOf）——syncModelAliasBoot 内部全兜底
       （GET 失败→本地/空兜底），外加 8s 超时兜底（御审 P2-3：fetch 半开不拖死启动链），绝不阻塞启动 */
    return Promise.race([
      syncModelAliasBoot(),
      new Promise(function(res){ setTimeout(res, 8000) })
    ]).then(function(){ return loadModelsWithRetry(6) });
  }).then(function(){ return loadHiddenSessions() }).then(function(){ return loadSessions() }).then(function(){
    loadBoardData(function(){ renderSidebar() }); // T08 任务板：首屏带出主人的想法清单
    connectSSE(S.sessions.length ? S.sessions[0].directory : null);
    setView('projects');
    S.current = null;
    /* task106 §15.3.3：F5 后优先打开活跃大管家指针会话（只用显式指针，不用回落值；失效则回落原默认） */
    var bootA = S.activeButlerSid || '';
    var bootS = null;
    if (bootA){
      bootS = S.sessions.filter(function(s){ return s.id === bootA && !s.parentID && !isHiddenId(s.id) })[0] || null;
    }
    // v0.075（T07，推翻 v0.032「默认停项目页」）：刷新后直接停在 littleDJ 项目第 1 个会话，上来即可对话
    var djDir = '';
    S.projects.concat(S.imports).forEach(function(p){
      if (!djDir && /littleDJ\/?$/i.test(String(p.path || '').replace(/\\/g, '/'))) djDir = p.path;
    });
    var first = djDir ? (S.sessions.filter(function(s){ return !s.parentID && s.directory === djDir })[0] || null) : null;
    if (bootS) openSession(bootS);
    else if (first) openSession(first);
    else toast(djDir ? 'littleDJ 项目暂无会话，已停在项目页' : '未找到 littleDJ 项目登记，已停在项目页', false, 4000);
    toggleBusyUI();
    fetchBalance();
  }).catch(function(e){
    $('#messages').innerHTML = '<div class="empty"><h2>连不上后端</h2><div>' + esc(e.message) + '</div></div>';
  });
}
/* task175：移动端垫返回哨兵（幂等：栈顶已是哨兵不重复垫）——系统「左缘右滑=返回」被 popstate 翻译成开侧栏
   task177 P2-2：刷新残留在面板条目（djPanel）时先 replaceState 成哨兵，避免夹层多退一格
   task206：popout 页无抽屉可开，跳过 */
window._loginShown=_loginShown; window._sseAuthProbeAt=_sseAuthProbeAt; window.renderLoginCard=renderLoginCard; window.djDoLogin=djDoLogin; window.sseAuthSelfheal=sseAuthSelfheal; window.bootstrap=bootstrap; window.bootReal=bootReal;

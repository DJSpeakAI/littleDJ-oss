/* @module keepalive @order 23 @职责 息屏保活 + 快照补响 + 系统通知SW通道/看门狗(task323) @提供 KA _bgMiss _bgMissClearT kaEnabled kaActive kaSilentSrc kaRenderWavs wavBlobMono kaStart kaMsSync kaHealSchedule kaHealClear kaStop bgSnapTake bgMissCheck NOTIFY_SW notifySwRegister notifyShow notifyWatchdog @依赖 - @依赖运行期 DING_SOUNDS POP_TAB TASKS seenTaskIds getPwaAgentSound _agentSoundAt _pwaAgentAt playDing @DOM契约 - @严格模式 是 @全局占用 KA _bgMiss _bgMissClearT kaEnabled kaActive kaSilentSrc kaRenderWavs wavBlobMono kaStart kaMsSync kaHealSchedule kaHealClear kaStop bgSnapTake bgMissCheck NOTIFY_SW notifySwRegister notifyShow notifyWatchdog @源行 ui/index.html L5972-L6129 @测试锚点 - @被调用 - */
'use strict';
/* ---------- task193：息屏/后台完成音保活（keep-alive） ----------
   原理：一段近无声的循环 <audio> + MediaSession 会话 → 浏览器把本页当「正在播音乐」，
   手机息屏/浏览器切后台后页面不被冻结，SSE 与完成音照常工作；完成音优先 WebAudio，
   AudioContext 被后台策略挂起时回落预渲染 WAV <audio>（与保活同一媒体通道）。
   诚实边界：系统省电杀浏览器 / 最近任务里划掉 / 深度省电断网 → 仍收不到；
   断网漏掉的事件由「台账轮询 + 快照补响」兜底（恢复后补一声，防双响走 seenTaskIds 同池）。
   耗电说明：保活音轨常驻音频管线、耗电略增；设置→音效可一键关（littledj.bgKeepAlive）。 */
var KA = { el: null, wav: {}, rendered: false, srcCache: '', userPaused: false, healT: null, healN: 0 }; /* task262：userPaused=用户经媒体卡片/通知暂停（尊重不拉回）；healT/healN=系统暂停自愈定时器与退避计数 */
function kaEnabled(){ try { return (localStorage.getItem('littledj.bgKeepAlive') || '1') !== '0' } catch(e){ return true } }
function kaActive(){ return !!(kaEnabled() && KA.el && !KA.el.paused) }
function kaSilentSrc(){
  /* 220Hz 正弦 2% 振幅（元素音量再压到 0.02）→ 人耳近无声，但系统视为「有信号在播」；
     全零静音样本会被部分浏览器当暂停处理，保活失效 */
  if (KA.srcCache) return KA.srcCache;
  var sr = 22050, n = sr * 2;
  var buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  var w = function(o, s){ for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (var i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 220 * i / sr) * 650), true);
  KA.srcCache = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  return KA.srcCache;
}
function kaRenderWavs(){
  /* 前台有手势后预渲染 6 种音色的 WAV（master 增益固定满档，音量在播放元素上控）；
     渲染失败只是失去 hidden 兜底通道，WebAudio 主通道不受影响 */
  if (KA.rendered) return;
  KA.rendered = true;
  try {
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return;
    DING_SOUNDS.forEach(function(snd){
      try {
        var oc = new OC(1, Math.ceil(44100 * 1.2), 44100);
        var master = oc.createGain();
        master.gain.value = 2.2;
        var comp = oc.createDynamicsCompressor();
        comp.threshold.value = -14; comp.knee.value = 12; comp.ratio = 4;
        comp.attack.value = 0.003; comp.release.value = 0.2;
        master.connect(comp); comp.connect(oc.destination);
        snd.play(oc, master, 0.02);
        var pr = oc.startRendering();
        if (pr && pr.then) pr.then(function(buf){ try { KA.wav[snd.id] = URL.createObjectURL(wavBlobMono(buf)) } catch(e){} }).catch(function(){});
      } catch(e){}
    });
  } catch(e){}
}
function wavBlobMono(buf){
  var n = buf.length, ch = buf.getChannelData(0);
  var out = new ArrayBuffer(44 + n * 2), dv = new DataView(out);
  var w = function(o, s){ for (var i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)) };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * 2, true);
  dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, 'data'); dv.setUint32(40, n * 2, true);
  for (var i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(ch[i] * 32767))), true);
  return new Blob([out], { type: 'audio/wav' });
}
function kaStart(){
  if (POP_TAB) return; /* task206：大屏弹出页不启保活音轨/MediaSession（防双窗口双响、双「监听中」） */
  if (!kaEnabled()) return;
  try {
    if (!KA.el){
      var a = document.createElement('audio');
      a.loop = true; a.volume = 0.02; a.preload = 'auto';
      a.setAttribute('playsinline', ''); a.setAttribute('webkit-playsinline', '');
      a.src = kaSilentSrc();
      a.addEventListener('pause', function(){ /* task262：系统/省电把保活音轨按住 → 自愈续播（锁屏出声的生命线）；触发时复核三守卫（方案审 P1-3），用户暂停不拉回 */
        if (document.hidden && kaEnabled() && !KA.userPaused) kaHealSchedule();
      });
      KA.el = a;
      try { document.body.appendChild(a) } catch(e){}
    }
    KA.userPaused = false; /* task262：请求播放即清除用户暂停意愿（回前台/卡片 play 自动恢复监听，方案审 P2-5） */
    if (KA.el.paused){ var pr = KA.el.play(); if (pr && pr.catch) pr.catch(function(){}) }
    kaRenderWavs();
    kaMsSync();
  } catch(e){}
}
function kaMsSync(){
  /* task262：MediaSession 完整化——artwork+album+播放态+播放器控制是锁屏媒体卡片要件；
     缺 artwork 时部分安卓浏览器不给锁屏媒体卡片 → 页面不被当「正经媒体源」→ 锁屏冻结（主人主诉「切后台有声、锁屏无声」根因）；
     B站网页版锁屏能续播即同机制（web.dev/MDN 佐证）。 */
  if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: '小DJ 监听中', artist: 'littleDJ · 任务完成提醒', album: 'littleDJ',
      artwork: [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }] /* 走既有 PWA 图标零新增文件（方案审 P2-1：用 512 清晰档） */
    });
    navigator.mediaSession.playbackState = (KA.el && !KA.el.paused) ? 'playing' : 'paused'; /* 方案审 P2-2：只在真正在播时置 playing */
    try { navigator.mediaSession.setActionHandler('play', function(){ KA.userPaused = false; kaStart() }) } catch(e){}
    try { navigator.mediaSession.setActionHandler('pause', function(){ KA.userPaused = true; try { if (KA.el) KA.el.pause() } catch(_e){} kaMsSync() }) } catch(e){}
  } catch(e){}
}
function kaHealSchedule(){
  /* task262：指数退避 1s→16s、连续 5 次失败放弃（防死循环耗电）；成功续播清计数 */
  if (KA.healT) return;
  var wait = Math.min(16000, 1000 * Math.pow(2, KA.healN));
  KA.healT = setTimeout(function(){
    KA.healT = null;
    if (!kaEnabled() || KA.userPaused || !document.hidden){ KA.healN = 0; return } /* 方案审 P1-3：定时器触发时再复核三守卫（用户刚按暂停不被拉回） */
    if (KA.el && KA.el.paused){
      if (++KA.healN > 5){ KA.healN = 0; return }
      var pr = KA.el.play();
      if (pr && pr.then) pr.then(function(){ KA.healN = 0; kaMsSync() }).catch(function(){ kaHealSchedule() });
      else kaHealSchedule();
    } else KA.healN = 0;
  }, wait);
}
function kaHealClear(){ if (KA.healT){ clearTimeout(KA.healT); KA.healT = null } KA.healN = 0 }
function kaStop(){
  KA.userPaused = true; /* task262 产出审 P2-①：先压用户暂停意愿再 pause——防 pause 事件在 hidden+保活开着场景把刚撤的自愈又排回来（latent 复活）；下次 kaStart 会清零（P2-5） */
  kaHealClear(); /* 方案审 P1-3：停止时撤自愈定时器 */
  try { if (KA.el) KA.el.pause() } catch(e){}
  try { if ('mediaSession' in navigator){ navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none' } } catch(e){} /* 方案审 P2-2：kaStop 置 none */
}
/* ---------- task193：断线/息屏漏事件的「快照补响」 ----------
   息屏或 SSE 断开瞬间快照在跑任务 id；后台轮询（保活中不因 hidden 停）发现快照内任务转终态
   且未响过（seenTaskIds 同池去重）→ 补一声完成音。回前台 16s 后清快照，不翻旧账。 */
var _bgMiss = null;
var _bgMissClearT = null; /* 回前台清快照定时器句柄（方案审 P2-1：前台 16s 内再息屏时须撤销旧 timer，防误清新快照） */
function bgSnapTake(){
  var ids = {};
  ((TASKS && TASKS.list) || []).forEach(function(t){ if (t && t.state === 'running') ids[t.id] = 1 });
  if (!_bgMiss) _bgMiss = { ids: ids, at: Date.now() };
  else { Object.keys(ids).forEach(function(k){ _bgMiss.ids[k] = 1 }); _bgMiss.at = Date.now() }
}
function bgMissCheck(){
  if (!_bgMiss) return;
  var snap = _bgMiss;
  if (Date.now() - snap.at > 30 * 60 * 1000){ _bgMiss = null; return }
  var hit = false;
  (TASKS.list || []).forEach(function(t){
    if (!t || !snap.ids[t.id]) return;
    if (seenTaskIds.has(t.id)){ delete snap.ids[t.id]; return }
    if (t.state === 'done' || t.state === 'interrupted'){
      if (seenTaskIds.size > 500) seenTaskIds.clear(); /* 产出审 P2-1：先清后加（与 pwaAgentBell 原顺序一致，防刚加的标记被连带清掉） */
      seenTaskIds.add(t.id);
      delete snap.ids[t.id];
      hit = true;
    }
  });
  /* 方案审 P1-1：补响必须镜像 pwaAgentBell 的选音与静音语义——子代理完成音走「其他角色/子代理」
     音色（默认「无」=关），并复用 10s 跨任务节流窗；硬播大管家 ding 会在主人显式关闭子代理音时
     照样出声，且与实时事件音不一致。 */
  if (hit){
    var snd = getPwaAgentSound();
    if (snd !== 'none' && Date.now() - _agentSoundAt >= 10000){
      _agentSoundAt = Date.now();
      _pwaAgentAt = Date.now();
      playDing(snd);
      /* task336：锁屏补响同时发系统通知——保活音轨被系统暂停时页面音哑，SW 通知是唯一叫醒通道
         （notifyShow 自判 hidden/权限/SW 优先退构造式；tag 同池替换防连响；音色关=全静默语义不变） */
      try { notifyShow('小 DJ · 任务完成', '后台任务跑完了，回来看看结果'); } catch(e){}
    }
  }
}

window.KA=KA; window._bgMiss=_bgMiss; window._bgMissClearT=_bgMissClearT; window.kaEnabled=kaEnabled; window.kaActive=kaActive; window.kaSilentSrc=kaSilentSrc; window.kaRenderWavs=kaRenderWavs; window.wavBlobMono=wavBlobMono; window.kaStart=kaStart; window.kaMsSync=kaMsSync; window.kaHealSchedule=kaHealSchedule; window.kaHealClear=kaHealClear; window.kaStop=kaStop; window.bgSnapTake=bgSnapTake; window.bgMissCheck=bgMissCheck;
/* ---------- task323：锁屏提示音第三通道 —— 系统通知（SW）+ 保活看门狗 ----------
   task193/262 的兜底通知只用构造式 new Notification()：安卓/鸿蒙浏览器普遍不支持（静默失败），
   页面音被拦时最后一层是哑的。现优先走 Service Worker 的 registration.showNotification()
   （ui/sw.js，锁屏带系统提示音+振动）；SW 不可用退回构造式（桌面有效）。
   附带 20s 看门狗（bootstrap 里 setInterval）：系统暂停保活音轨时 pause 事件可能丢，
   定时把音轨/媒体卡片拉回来。诚实边界不变：系统杀浏览器/划掉/深度省电 → 解锁补响。 */
var NOTIFY_SW = { reg: null, tried: false };
function notifySwRegister(){
  if (NOTIFY_SW.tried) return NOTIFY_SW.reg;
  NOTIFY_SW.tried = true;
  try {
    if (!('serviceWorker' in navigator)) return null;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(function(reg){ NOTIFY_SW.reg = reg }).catch(function(){});
  } catch(e) {}
  return null;
}
function notifyShow(title, body){
  try {
    if (!document.hidden) return false; /* 前台有页面音，不打扰 */
    if (!('Notification' in window)) return false;
    if (Notification.permission !== 'granted') return false;
    var opts = {
      body: body || '', tag: 'littledj-ding', renotify: true, silent: false,
      vibrate: [200, 90, 200], icon: '/icon-192.png', badge: '/icon-192.png', data: { url: '/' }
    };
    if (NOTIFY_SW.reg && typeof NOTIFY_SW.reg.showNotification === 'function'){
      NOTIFY_SW.reg.showNotification(title, opts).catch(function(){});
      return true;
    }
    var n = new Notification(title, opts);
    n.onclick = function(){ try { window.focus(); n.close() } catch(e){} };
    return true;
  } catch(e) { return false }
}
function notifyWatchdog(){
  try {
    if (POP_TAB) return; /* 大屏弹出页不保活（task206） */
    if (!kaEnabled() || KA.userPaused) return;
    if (!KA.el){ if (document.hidden) kaStart(); return }
    if (!document.hidden) return; /* 前台交给既有手势钩子 */
    if (KA.el.paused) kaStart();
    else if (navigator.mediaSession && navigator.mediaSession.playbackState !== 'playing') kaMsSync();
  } catch(e) {}
}

window.NOTIFY_SW=NOTIFY_SW; window.notifySwRegister=notifySwRegister; window.notifyShow=notifyShow; window.notifyWatchdog=notifyWatchdog;

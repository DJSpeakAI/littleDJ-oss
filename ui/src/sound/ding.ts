/* @module ding @order 22 @职责 完成提示音 @提供 _audioCtx _pendDing TUI_SOUND_KEYS DING_SOUNDS ensureAudio flushPendDing getDingVol getDingSound getAskSound getTuiSound findSound _dingNote playDing playAskDing getSwitchSound getPwaAgentSound playSwitchDing @依赖 - @依赖运行期 VOICE kaActive KA notifyDing @DOM契约 - @严格模式 是 @全局占用 _audioCtx _pendDing TUI_SOUND_KEYS DING_SOUNDS ensureAudio flushPendDing getDingVol getDingSound getAskSound getTuiSound findSound _dingNote playDing playAskDing getSwitchSound getPwaAgentSound playSwitchDing @源行 ui/index.html L5828-L5971 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 完成提示音 ---------- */
var _audioCtx = null;
var _pendDing = null; // AudioContext 被手机浏览器挂起时的待播队列（只留最近 1 条，60s 内补播）
function ensureAudio(){
  try {
    if (!_audioCtx){
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      _audioCtx = new AC();
    }
    if (_audioCtx.state === 'suspended'){
      // 手机浏览器需用户手势才能解锁：先发起 resume，本次不播（入队），等下次手势/回前台补播；
      // resume 成功即自动补播（v0.097：修「一直前台开着但无新手势、被 re-suspend 后完成音永远哑」死角）
      var pr = _audioCtx.resume();
      if (pr && pr.then) pr.then(function(){ if (_audioCtx && _audioCtx.state === 'running') flushPendDing() }).catch(function(){});
      else if (pr && pr.catch) pr.catch(function(){});
      return null;
    }
  } catch(e) { return null }
  return _audioCtx;
}
function flushPendDing(){
  if (!_pendDing) return;
  var s = _pendDing.soundId, at = _pendDing.at;
  if (VOICE.armed) return; /* 语音对话等待期：补播也静音（枢机 P2-2），_pendDing 留着下次解锁再播 */
  _pendDing = null;
  if (Date.now() - at > 60000) return;
  playDing(s);
}
function getDingVol(){
  var v = Number(localStorage.getItem('littledj.dingVol'));
  if (!(v >= 0)) v = 80;
  return Math.max(0, Math.min(100, v));
}
function getDingSound(){
  var id = localStorage.getItem('littledj.dingSound') || 'ding';
  return (id === 'none' || DING_SOUNDS.some(function(s){ return s.id === id })) ? id : 'ding';
}
function getAskSound(){
  var id = localStorage.getItem('littledj.askSound') || 'chord';
  return (id === 'none' || DING_SOUNDS.some(function(s){ return s.id === id })) ? id : 'chord';
}
// TUI 四场景独立音色：键缺失或值非法时，done/ask 回落 PWA 既有键，error/agent 回落固定默认（只读，不写回新键）
var TUI_SOUND_KEYS = {
  done: 'littledj.tuiDoneSound',
  ask: 'littledj.tuiAskSound',
  error: 'littledj.tuiErrorSound',
  agent: 'littledj.tuiAgentSound'
};
function getTuiSound(kind){
  var id = localStorage.getItem(TUI_SOUND_KEYS[kind] || '');
  var ok = !!id && (id === 'none' || DING_SOUNDS.some(function(s){ return s.id === id }));
  if (kind === 'ask') return ok ? id : getAskSound();
  if (kind === 'done') return ok ? id : getDingSound();
  if (kind === 'error') return ok ? id : 'knock'; // 未配置固定「叩」，避免与完成音同音不可分辨
  if (kind === 'agent') return ok ? id : 'none'; // 未配置默认无（子代理默认静音，可开）
  return getDingSound();
}
function findSound(id){
  return DING_SOUNDS.filter(function(s){ return s.id === id })[0] || DING_SOUNDS[0];
}
function _dingNote(ctx, out, type, freq, start, dur, peak, glideTo?){
  var o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(freq, start);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, start + dur * 0.9);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g); g.connect(out);
  o.start(start); o.stop(start + dur + 0.02);
}
var DING_SOUNDS = [
  { id: 'ding', label: '叮', play: function(ctx, out, t){ _dingNote(ctx, out, 'sine', 880, t, 0.3, 0.18); _dingNote(ctx, out, 'sine', 1320, t + 0.09, 0.28, 0.15); } },
  { id: 'bell', label: '铃', play: function(ctx, out, t){ _dingNote(ctx, out, 'triangle', 1568, t, 0.5, 0.15); _dingNote(ctx, out, 'sine', 2093, t, 0.42, 0.1); } },
  { id: 'drop', label: '水滴', play: function(ctx, out, t){ _dingNote(ctx, out, 'sine', 1150, t, 0.24, 0.22, 420); } },
  { id: 'blip', label: '滴', play: function(ctx, out, t){ _dingNote(ctx, out, 'square', 1046, t, 0.13, 0.16); } }, /* v0.098.2：原 0.08s/0.08 手机外放听不见，加长加响 */
  { id: 'chord', label: '和弦', play: function(ctx, out, t){ [523.25, 659.25, 783.99].forEach(function(f, i){ _dingNote(ctx, out, 'sine', f, t + i * 0.06, 0.36, 0.11) }); } },
  { id: 'knock', label: '叩', play: function(ctx, out, t){ _dingNote(ctx, out, 'triangle', 300, t, 0.16, 0.24); _dingNote(ctx, out, 'triangle', 340, t + 0.11, 0.16, 0.18); } }
];
function playDing(soundId?){
  if (VOICE.armed){ _pendDing = { soundId: soundId || getDingSound(), at: Date.now() }; return } /* 语音 armed 期间转延迟补播不直接丢（产出审 P2-3，error 等警觉音不静默）；解锁后 flushPendDing 补 */
  var effId = soundId || getDingSound();
  if (effId === 'none') return; /* 「无」= 该场景静音（v0.097），也无需入 _pendDing */
  /* v0.098.1（御史 P1-①）：后台+已授权通知=通知单通道（防 PC 后台标签页页面音+横幅双响）；
     入 _pendDing 回前台 60s 内补播一声；hidden+未授权=维持原行为（后台照播页面音）。
     task193：保活（KA）开启时后台要的就是「页面音」，跳过通知单通道。 */
  if (document.hidden && !kaActive() && ('Notification' in window) && Notification.permission === 'granted'){
    _pendDing = { soundId: effId, at: Date.now() };
    return;
  }
  var vol = getDingVol(); if (vol <= 0) return;
  /* task193：保活场景兜底——hidden 下 AudioContext 常仍被后台策略挂起（ensureAudio 返回 null），
     改走预渲染 WAV <audio>：媒体元素通道与保活音轨同类，息屏后台可出声；必须在 ensureAudio 判空
     之前，否则挂起态提前 return 永远到不了这里；失败落回 WebAudio */
  if (document.hidden && kaActive() && KA.wav[effId]){
    try {
      var ea = document.createElement('audio');
      ea.src = KA.wav[effId];
      ea.volume = Math.max(0, Math.min(1, vol / 100));
      /* 方案审 P2-2：短暂挂到 body（部分移动浏览器对未挂载媒体元素不播），播完即摘除 */
      try {
        document.body.appendChild(ea);
        ea.onended = function(){ try { ea.remove() } catch(e){} };
      } catch(e){}
      var epr = ea.play();
      /* 产出审 P1-1：play() 的 promise 拒绝（无新手势/被自动播放策略拦）才是真机常见失败态，
         空 catch + return 会让完成音静默丢失（且 seenTaskIds/节流窗已烧，回前台也永不补）——
         入 _pendDing，复用「回前台 60s 内 flushPendDing」既有语义 */
      if (epr && epr.catch) epr.catch(function(){
        _pendDing = { soundId: effId, at: Date.now() };
        try { ea.remove() } catch(e){}
        /* task262：锁屏/息屏下页面音被系统拦 → 降级系统通知兜一声（此刻无声确定、无双响；notifyDing 自带 hidden/权限守卫）。
           诚实边界（方案审 P1-4）：构造式 Notification 在安卓系浏览器普遍不受支持（需 SW showNotification，本工程无 SW）——
           手机端此降级可能静默，锁屏出声主力=媒体卡片+自愈，解锁补播=_pendDing+快照补响；桌面浏览器此兜底有效 */
        notifyDing('小 DJ · 有事叫你', '锁屏中出声被拦，解锁回来看结果');
      });
      return;
    } catch(e){ /* 落回下方 WebAudio 路径 */ }
  }
  var ctx = ensureAudio();
  if (!ctx){ _pendDing = { soundId: effId, at: Date.now() }; return }
  var snd = findSound(effId);
  try {
    var master = ctx.createGain();
    master.gain.value = (vol / 100) * 2.2;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);
    snd.play(ctx, master, ctx.currentTime + 0.02);
  } catch(e) {}
}
function playAskDing(){ playDing(getAskSound()) }
function getSwitchSound(){
  var id = localStorage.getItem('littledj.switchSound') || 'drop';
  return (id === 'none' || DING_SOUNDS.some(function(s){ return s.id === id })) ? id : 'drop';
}
function getPwaAgentSound(){
  var id = localStorage.getItem('littledj.agentSound');
  return (id === 'none' || (id && DING_SOUNDS.some(function(s){ return s.id === id }))) ? id : 'none';
}
function playSwitchDing(){ playDing(getSwitchSound()) }

window._audioCtx=_audioCtx; window._pendDing=_pendDing; window.TUI_SOUND_KEYS=TUI_SOUND_KEYS; window.DING_SOUNDS=DING_SOUNDS; window.ensureAudio=ensureAudio; window.flushPendDing=flushPendDing; window.getDingVol=getDingVol; window.getDingSound=getDingSound; window.getAskSound=getAskSound; window.getTuiSound=getTuiSound; window.findSound=findSound; window._dingNote=_dingNote; window.playDing=playDing; window.playAskDing=playAskDing; window.getSwitchSound=getSwitchSound; window.getPwaAgentSound=getPwaAgentSound; window.playSwitchDing=playSwitchDing;

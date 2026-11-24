/* @module voice @order 24 @职责 语音对话（录音/STT/TTS）+ 消息播报（task347：AI 回复 🔊 按钮，按钮态由 msgSpeakBtnSync 刷新） @提供 HOLD holdGhostClick HOLD_GUARD holdBarSync holdStart holdEnd holdAfterStart bindHoldBar VOICE _pwaAgentAt _pwaBootAt _agentSoundAt _lastIdleAt seenTaskIds voiceReadEnabled getVoiceChatVoice micBtnState micToggle startVoiceRec stopVoiceRec voiceCleanup voiceIdle voiceToWav voiceTruncateRead voiceArm voiceDisarm voiceReset stopVoiceAudio playVoiceAudio voicePlainText voiceSpeak voiceMaybeRead voiceReadQuestion dingRunnerIdle pwaAgentBell notifyDing ctxThreshold autoNewEnabled MSG_SPEAK SPK_ICONS msgSpeakVoiceId msgSpeakProvider msgSpeakSplit msgSpeakBtnSync msgSpeakStop msgSpeakPause msgSpeakResume msgSpeakToggle @依赖 - @依赖运行期 toast S queuePrompt getDingVol TASKS S_ENDED scheduleSidebar scheduleTasks loadTaskLedger getPwaAgentSound playDing kaActive notifyShow @DOM契约 #messages @严格模式 是 @全局占用 HOLD holdGhostClick HOLD_GUARD holdBarSync holdStart holdEnd holdAfterStart bindHoldBar VOICE _pwaAgentAt _pwaBootAt _agentSoundAt _lastIdleAt seenTaskIds voiceReadEnabled getVoiceChatVoice micBtnState micToggle startVoiceRec stopVoiceRec voiceCleanup voiceIdle voiceToWav voiceTruncateRead voiceArm voiceDisarm voiceReset stopVoiceAudio playVoiceAudio voicePlainText voiceSpeak voiceMaybeRead voiceReadQuestion dingRunnerIdle pwaAgentBell notifyDing ctxThreshold autoNewEnabled MSG_SPEAK SPK_ICONS msgSpeakVoiceId msgSpeakProvider msgSpeakSplit msgSpeakBtnSync msgSpeakStop msgSpeakPause msgSpeakResume msgSpeakToggle @源行 ui/index.html L6130-L6419（拆分前基线） @测试锚点 - @被调用 index.html 委托分支（data-act="speak" → msgSpeakToggle） */
'use strict';
/* ---------- 语音对话（task46，豆包式）：🎙 录音 → /_voice/stt 转写 → 自动发送 → /_voice/tts 朗读回复 ----------
   armed 语义：语音发送后进入，等 session.idle 朗读一次回复即完成任务；期间 playDing/补播全静音防叠声；
   解除=回复读完/手动打字发送/手动切会话/点🎙/超时 180s/SSE 断流；自动切会话不解除（防朗读读一半被掐，枢机 P1-5）。 */
var VOICE: any = { st: 'idle', rec: null, chunks: [], stream: null, armed: false, armedTimer: null, audio: null, audioUrl: '', lastRead: '', cancelled: false, ttsErrToasted: false, inputPh: null, recTimer: null };
function voiceReadEnabled(){ return (localStorage.getItem('littledj.voiceChatRead') || '1') !== '0' }
function getVoiceChatVoice(){ try { return String(localStorage.getItem('littledj.voiceChatVoice') || '').trim() } catch(e){ return '' } }
function micBtnState(){
  var b = $('#btnMic'); if (!b) return;
  b.classList.toggle('rec', VOICE.st === 'recording');
  b.classList.toggle('busy', VOICE.st === 'transcribing');
  b.title = VOICE.st === 'recording' ? '正在录音，点击结束并发送' : (VOICE.st === 'transcribing' ? '正在转写…' : '语音对话：点击开始说话');
  holdBarSync(); /* task318：待机条跟随语音状态（录制/转写/回空闲） */
}
function micToggle(){
  if (VOICE.st === 'recording'){ stopVoiceRec(false); return }
  if (VOICE.st === 'transcribing'){ toast('正在转写上一句，稍等…'); return }
  if (VOICE.audio){ voiceDisarm(); } /* 点 🎙 打断正在朗读的回复，直接开录 */
  if (S.busy){ toast('小DJ还在回复，等它说完再按 🎙', true); return }
  startVoiceRec();
}
function startVoiceRec(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined'){
    toast('这个浏览器拿不到麦克风：内网 http 页面被浏览器禁止开麦（要求 https）。电脑上用 http://localhost:4097 可测；手机等外网 https 开通后可用。', true, 7000); return;
  }
  navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream){
    if (VOICE.st === 'recording'){ stream.getTracks().forEach(function(t){ t.stop() }); return }
    var mime = '';
    var cand = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/mpeg', ''];
    for (var i = 0; i < cand.length; i++){ if (!cand[i] || (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(cand[i]))){ mime = cand[i]; break } }
    var rec;
    try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream) }
    catch (e){ stream.getTracks().forEach(function(t){ t.stop() }); toast('录音启动失败：' + (e.message || e), true); return }
    VOICE.stream = stream; VOICE.rec = rec; VOICE.chunks = []; VOICE.cancelled = false; VOICE.st = 'recording';
    rec.ondataavailable = function(ev){ if (ev && ev.data && ev.data.size) VOICE.chunks.push(ev.data) };
    rec.onerror = function(ev){ toast('录音出错：' + ((ev && ev.error && ev.error.message) || '未知'), true); voiceCleanup(); voiceIdle() };
    rec.onstop = function(){
      var chunks = VOICE.chunks, cancelled = VOICE.cancelled;
      voiceCleanup();
      if (cancelled){ voiceIdle(); return }
      if (!chunks.length){ voiceIdle(); toast('没录到声音，再试一次', true); return }
      VOICE.st = 'transcribing'; micBtnState();
      voiceToWav(new Blob(chunks, { type: (chunks[0] && chunks[0].type) || 'audio/webm' })).then(function(wav){
        return fetch('/_voice/stt', { method: 'POST', body: wav }).then(function(r){
          if (r.status === 404) throw new Error('语音接口还没生效：在 DevEco Code 终端跑 sh deploy/restart-proxy.sh 重启后重试');
          return r.json().then(function(j){
            if (!r.ok || !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
            return j.text;
          });
        });
      }).then(function(text){
        voiceIdle();
        text = String(text || '').trim();
        if (!text){ toast('没听清，靠近一点再说一遍', true); return }
        if (!S.current){ toast('请先新建或打开一个对话', true); return }
        VOICE.lastRead = '';
        queuePrompt(text, []);
        if (voiceReadEnabled()) voiceArm();
      }).catch(function(e){
        voiceIdle();
        toast('语音转写失败：' + (e.message || e), true, 6000);
      });
    };
    try { rec.start(250) } catch (e){ voiceCleanup(); voiceIdle(); toast('录音启动失败：' + (e.message || e), true); return }
    VOICE.recTimer = setTimeout(function(){ /* 产出审 P2-2：一次最多说 55 秒，自动截断发送，防上传才被 2MB 拒 */
      if (VOICE.st === 'recording'){ toast('一次最多说 55 秒，已自动截断发送'); stopVoiceRec(false) }
    }, 55000);
    micBtnState();
    var ta = $('#input'); VOICE.inputPh = ta.placeholder; ta.placeholder = '🎙 正在听…再点一次 🎙 结束';
    holdAfterStart(); /* task318：长按若在开录前就松了 → 开录即收口（首次只提示授权，之后=发送） */
  }).catch(function(err){
    var name = (err && err.name) || '';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError'){
      toast('浏览器拒绝了麦克风：内网 http 页面不允许开麦（浏览器要求 https）。电脑上用 http://localhost:4097 打开可测；手机等外网 https 开通后即可用。', true, 7000);
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError'){
      toast('没找到麦克风设备', true);
    } else {
      toast('无法开启录音：' + ((err && err.message) || name || '未知错误'), true);
    }
  });
}
function stopVoiceRec(cancel?){
  VOICE.cancelled = !!cancel;
  var rec = VOICE.rec;
  if (rec && rec.state !== 'inactive'){ try { rec.stop() } catch (e){} }
  else { voiceCleanup(); voiceIdle() }
}
function voiceCleanup(){
  clearTimeout(VOICE.recTimer); VOICE.recTimer = null;
  if (VOICE.stream){ try { VOICE.stream.getTracks().forEach(function(t){ t.stop() }) } catch (e){} VOICE.stream = null }
  VOICE.rec = null; VOICE.chunks = [];
  var ta = $('#input');
  if (VOICE.inputPh !== null && ta){ ta.placeholder = VOICE.inputPh; VOICE.inputPh = null }
}
function voiceIdle(){ VOICE.st = 'idle'; micBtnState() }
/* webm/m4a 录音 → 解码 → 16k 单声道重采样 → PCM16 → 标准 WAV 头（ASR 只吃 pcm_s16le/16k） */
function voiceToWav(blob?){
  var AC = window.AudioContext || window.webkitAudioContext;
  var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!AC || !OC){ return Promise.reject(new Error('当前浏览器不支持语音转写所需的音频处理能力，请更换浏览器或升级系统后重试')) }
  return blob.arrayBuffer().then(function(buf){
    var ac = new AC();
    return ac.decodeAudioData(buf).then(function(decoded){
      return ac.close().then(function(){ return decoded }, function(){ return decoded });
    }).catch(function(e){ try { ac.close() } catch (x){} throw new Error('录音解码失败：' + (e.message || e), { cause: e }) }); /* task387：error-cause（modern-web-guidance js/error-cause）；老引擎忽略第二参不崩 */
  }).then(function(buf){
    var rate = 16000;
    var len = Math.max(1, Math.ceil(buf.duration * rate));
    var oc = new OC(1, len, rate);
    var src = oc.createBufferSource();
    src.buffer = buf; src.connect(oc.destination); src.start(0);
    return oc.startRendering();
  }).then(function(rendered){
    var ch = rendered.getChannelData(0), n = ch.length;
    var pcm = new Int16Array(n);
    for (var i = 0; i < n; i++){
      var s = Math.max(-1, Math.min(1, ch[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    var wav = new ArrayBuffer(44 + n * 2);
    var v = new DataView(wav);
    function wstr(off, s){ for (var i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
    wstr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wstr(8, 'WAVE');
    wstr(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); wstr(36, 'data'); v.setUint32(40, n * 2, true);
    new Int16Array(wav, 44).set(pcm);
    return new Blob([wav], { type: 'audio/wav' });
  });
}
/* 朗读截断（产出审 P2-1）：>1900 字截到句号，防后端 2000 字护栏直接拒掉整轮朗读 */
function voiceTruncateRead(t?){
  var chars = Array.from(t);
  if (chars.length <= 1900) return t;
  var cut = chars.slice(0, 1900).join('');
  var last = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('\n'));
  if (last > 800) cut = cut.slice(0, last + 1);
  return cut + '（后面太长，先读到这里）';
}
function voiceArm(){
  VOICE.armed = true; VOICE.ttsErrToasted = false;
  clearTimeout(VOICE.armedTimer);
  VOICE.armedTimer = setTimeout(function(){
    if (VOICE.armed){ voiceDisarm(); toast('等回复超时（3 分钟），自动朗读已取消', true) }
  }, 180000);
}
function voiceDisarm(keepAudio?){
  VOICE.armed = false;
  clearTimeout(VOICE.armedTimer); VOICE.armedTimer = null;
  if (!keepAudio) stopVoiceAudio();
}
function voiceReset(){ voiceDisarm(); if (VOICE.st === 'recording') stopVoiceRec(true); }
function stopVoiceAudio(){
  if (VOICE.audio){ try { VOICE.audio.onended = null; VOICE.audio.onerror = null; VOICE.audio.pause(); VOICE.audio.src = ''; VOICE.audio.load() } catch (e){} VOICE.audio = null }
  if (VOICE.audioUrl){ try { URL.revokeObjectURL(VOICE.audioUrl) } catch (e){} VOICE.audioUrl = '' }
}
function playVoiceAudio(blob?, onEnd?, vol?){
  stopVoiceAudio();
  if (VOICE.armed && VOICE.armedTimer){ /* 产出审 P2-4：朗读开播即顺延 180s，长文合成+播放不被超时掐断 */
    clearTimeout(VOICE.armedTimer);
    VOICE.armedTimer = setTimeout(function(){ if (VOICE.armed){ voiceDisarm(); toast('朗读超时（3 分钟），已停止', true) } }, 180000);
  }
  var url = URL.createObjectURL(blob);
  var a = new Audio(url);
  /* task349：vol 显式给了就用（消息播报传 1=满音量，朗读内容不该被提示音音量拖小——
     主诉「测试通过但没听到声音」头号嫌疑就是提示音音量低/为 0 连带播报无声）；不给沿用提示音音量（语音对话老口径） */
  a.volume = (typeof vol === 'number') ? Math.max(0, Math.min(1, vol)) : Math.max(0, Math.min(1, getDingVol() / 100));
  VOICE.audio = a; VOICE.audioUrl = url;
  a.onended = function(){ stopVoiceAudio(); if (onEnd) onEnd() };
  a.onerror = function(){ stopVoiceAudio(); if (onEnd) onEnd() };
  var pr = a.play();
  if (pr && pr.catch) pr.catch(function(){ stopVoiceAudio(); toast('浏览器拦住了自动播放：再点一次 🔊 就能放', true); if (onEnd) onEnd() });
}
/* 朗读文本清洗：代码块/行内代码→（代码略）、图片删、链接留字、markdown 记号剥掉 */
function voicePlainText(t?){
  return String(t || '')
    .replace(/```[\s\S]*?```/g, '（代码略）')
    .replace(/`[^`\n]*`/g, '（代码略）')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\W)\*([^*\n]+)\*(?=\W|$)/g, '$1$2')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\|/g, '，')
    .replace(/[-—_=]{3,}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
function voiceSpeak(text?, onEnd?){
  if (!text) { if (onEnd) onEnd(); return }
  /* task349：语音对话朗读跟随「设置→TTS」当前供应商（不再硬走火山通道）——
     littledj.ttsProvider 由语音对话页下拉写入；空值回落旧路径（/_voice/tts 无 providerId=voice.json 火山） */
  var pid = '';
  try { pid = String(localStorage.getItem('littledj.ttsProvider') || '').trim() } catch(e){}
  var body: any = { text: text, voice: getVoiceChatVoice() };
  if (pid) body.providerId = pid;
  fetch('/_voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(function(r){
      if (r.status === 404) throw new Error('语音接口还没生效：在 DevEco Code 终端跑 sh deploy/restart-proxy.sh 重启');
      if (!r.ok) return r.json().catch(function(){ return null }).then(function(j){ throw new Error((j && j.error) || ('HTTP ' + r.status)) });
      return r.blob();
    })
    .then(function(blob){ playVoiceAudio(blob, onEnd) })
    .catch(function(e){
      if (!VOICE.ttsErrToasted){ VOICE.ttsErrToasted = true; toast('语音朗读失败：' + (e.message || e), true, 6000) }
      if (onEnd) onEnd();
    });
}
/* ---------- task347：消息语音播报（每条 AI 回复下 🔊 按钮） ----------
   走 /_voice/tts + providerId（task357 起跟随「设置→TTS」当前供应商；deepseek 时音色 stella 女/tide 男）；
   task362（主人：照 DAG AI Chat 抄）——迷你播放器三态机（DAG TtsPlayerControl 同款）：
   state: ''（idle）/ 'loading'（合成中，主键不可点，停止可点=取消）/ 'playing'（播放中，主键=暂停⏸）
   / 'paused'（暂停，主键=继续▶）；停止键 ■ 激活期展开；发光呼吸=playing 态；长文分段连播不变。 */
var MSG_SPEAK: any = { mid: '', seq: 0, state: '' };
var SPK_ICONS: any = {
  play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.2" y="2.5" width="3.4" height="11" rx="1" fill="currentColor"/><rect x="9.4" y="2.5" width="3.4" height="11" rx="1" fill="currentColor"/></svg>'
};
function msgSpeakVoiceId(){
  var g = 'female';
  try { g = localStorage.getItem('littledj.msgSpeakVoice') === 'male' ? 'male' : 'female' } catch(e){}
  return g === 'male' ? 'tide' : 'stella';
}
/* task349：播报跟随「设置→TTS」当前供应商（与语音对话同一单源 littledj.ttsProvider；空值回落 deepseek=主人定默认）；
   非 deepseek 供应商不传音色（后端回落该供应商默认音色），deepseek 用女/男声设置 */
function msgSpeakProvider(){
  var pid = '';
  try { pid = String(localStorage.getItem('littledj.ttsProvider') || '').trim() } catch(e){}
  return pid || 'deepseek';
}
/* 分段：句界（。！？；换行）优先在 ~1900 切，无句界 1990 硬切兜底；
   两阈值都必须 < server 现行 2000 上限（未重启 proxy 时分段直达不被拒） */
function msgSpeakSplit(t?){
  var out = [], buf = '', n = 0, MAX = 1900, HARD = 1990;
  t = String(t || '');
  for (var i = 0; i < t.length; i++){
    var ch = t.charAt(i);
    buf += ch; n++;
    var brk = (ch === '。' || ch === '！' || ch === '？' || ch === '；' || ch === '\n');
    if (n >= MAX && brk){ out.push(buf); buf = ''; n = 0 }
    else if (n >= HARD){ out.push(buf); buf = ''; n = 0 }
  }
  if (buf) out.push(buf);
  return out;
}
/* 按 MSG_SPEAK 刷新迷你播放器（消息区重绘后按 mid 实时找回节点；每段播放间调用一次自愈）。
   容器 .ssp.on=激活（停止键展开）；主键图标：idle 🔊 / loading ⏳转圈 / playing ⏸ / paused ▶；
   发光呼吸挂 .ssp.breath（playing 态，DAG TtsGlowRing 同语义）。 */
function msgSpeakBtnSync(){
  var boxes = document.querySelectorAll('.msg .acts .ssp');
  for (var i = 0; i < boxes.length; i++){
    var ssp = boxes[i];
    var msgEl: any = ssp.closest ? ssp.closest('.msg') : null;
    var mine = !!(msgEl && msgEl.dataset && msgEl.dataset.mid === MSG_SPEAK.mid && MSG_SPEAK.state);
    ssp.classList.toggle('on', mine);
    ssp.classList.toggle('breath', mine && MSG_SPEAK.state === 'playing');
    var main: any = ssp.querySelector('.ssp-main');
    if (main){
      if (!mine){ main.innerHTML = '🔊'; main.title = '语音播报：朗读这条回复（播放中可暂停）' }
      else if (MSG_SPEAK.state === 'loading'){ main.innerHTML = '<span class="ssp-load"></span>'; main.title = '合成中…（点 ■ 取消）' }
      else if (MSG_SPEAK.state === 'paused'){ main.innerHTML = SPK_ICONS.play; main.title = '已暂停，点击继续朗读' }
      else { main.innerHTML = SPK_ICONS.pause; main.title = '朗读中，点击暂停' }
    }
  }
}
function msgSpeakStop(){
  MSG_SPEAK.seq++;             /* 作废在途段请求与播放链回调 */
  MSG_SPEAK.state = ''; MSG_SPEAK.mid = '';
  stopVoiceAudio();
  msgSpeakBtnSync();
}
/* task362：暂停=挂起当前段音频（不触发 onended，链自然冻结）；继续=原音频 play()（seq 未变链继续）。
   loading 期不响应（DAG 同款：合成中主键不可点，取消走停止键）。 */
function msgSpeakPause(){
  if (MSG_SPEAK.state !== 'playing') return;
  try { if (VOICE.audio) VOICE.audio.pause() } catch(e){}
  MSG_SPEAK.state = 'paused';
  msgSpeakBtnSync();
}
function msgSpeakResume(){
  if (MSG_SPEAK.state !== 'paused') return;
  var a = VOICE.audio;
  if (!a){ MSG_SPEAK.state = 'playing'; msgSpeakBtnSync(); return }
  var pr = a.play();
  if (pr && pr.catch) pr.catch(function(){ msgSpeakStop(); toast('继续播放被浏览器拦住：再点一次 ▶', true) });
  MSG_SPEAK.state = 'playing';
  msgSpeakBtnSync();
}
/* 主键点击分派：idle=起播 / loading=提示稍候 / playing=暂停 / paused=继续；他条在播=切条（停旧起新） */
function msgSpeakToggle(msgEl?){
  if (!msgEl) return;
  var mid = String(msgEl.dataset && msgEl.dataset.mid || '');
  if (MSG_SPEAK.state && MSG_SPEAK.mid === mid){
    if (MSG_SPEAK.state === 'loading'){ toast('正在合成，稍候…（点 ■ 可取消）'); return }
    if (MSG_SPEAK.state === 'playing'){ msgSpeakPause(); return }
    if (MSG_SPEAK.state === 'paused'){ msgSpeakResume(); return }
  }
  if (!mid){ toast('这条消息还不能播报（正在生成中）', true); return }
  var m = (S.lastMsgs || []).filter(function(x){ return x && x.info && x.info.id === mid })[0];
  if (!m){ toast('找不到这条消息的内容，刷新页面再试', true); return }
  var text = (m.parts || []).filter(function(p){ return p && p.type === 'text' && p.text }).map(function(p){ return String(p.text) }).join('\n').trim();
  var plain = voicePlainText(text);
  if (!plain){ toast('这条回复没有可朗读的文字', true); return }
  msgSpeakStop();             /* 停掉可能在放的其他条 */
  var seq = ++MSG_SPEAK.seq;  /* stop 已 +1，再取新号 */
  MSG_SPEAK.mid = mid; MSG_SPEAK.state = 'loading';
  msgSpeakBtnSync();
  var segs = msgSpeakSplit(plain), i = 0;
  var pid = msgSpeakProvider();
  var voice = pid === 'deepseek' ? msgSpeakVoiceId() : '';
  var next = function(){
    if (seq !== MSG_SPEAK.seq) return;             /* 已被停止/换条作废 */
    if (i >= segs.length){ msgSpeakStop(); return }
    var seg = segs[i++];
    fetch('/_voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: seg, voice: voice, providerId: pid }) })
      .then(function(r){
        if (r.status === 404) throw new Error('语音接口还没生效：在 DevEco Code 终端跑 sh deploy/restart-proxy.sh 重启');
        if (!r.ok) return r.json().catch(function(){ return null }).then(function(j){ throw new Error((j && j.error) || ('HTTP ' + r.status)) });
        return r.blob();
      })
      .then(function(blob){
        if (seq !== MSG_SPEAK.seq) return;
        MSG_SPEAK.state = 'playing';
        msgSpeakBtnSync();                          /* 长文重绘后找回播放器态 */
        playVoiceAudio(blob, next, 1);              /* task349：朗读内容满音量（与提示音音量脱钩） */
      })
      .catch(function(e){
        if (seq !== MSG_SPEAK.seq) return;
        msgSpeakStop();
        toast('播报失败：' + ((e && e.message) || e), true, 5000);
      });
  };
  next();
}
/* 回复朗读钩子：session.idle 的 refreshCurrent 回调里、tryAutoNewSession 之前调（御史 P1-2：切走前取原会话消息） */
function voiceMaybeRead(){
  if (!VOICE.armed) return;
  var msgs = S.lastMsgs || [];
  var text = '';
  for (var i = msgs.length - 1; i >= 0; i--){
    var m = msgs[i] || {};
    if (m.info && m.info.role === 'assistant'){
      text = (m.parts || []).filter(function(p){ return p && p.type === 'text' && p.text }).map(function(p){ return String(p.text) }).join('\n').trim();
      break;
    }
  }
  if (!text){ voiceDisarm(); return }
  if (text === VOICE.lastRead) return;
  VOICE.lastRead = text;
  var plain = voiceTruncateRead(voicePlainText(text));
  if (!plain){ voiceDisarm(); return }
  voiceSpeak(plain, function(){ voiceDisarm(true) }); /* 读完解除但不停在放音频（已自然结束） */
}
function voiceReadQuestion(q?){
  if (!VOICE.armed || !q || !q.questions) return;
  var qt = (q.questions || []).map(function(x){ return (x && x.question) || '' }).filter(Boolean).join('。');
  if (qt) voiceSpeak(voicePlainText(qt));
}

// 子代理（小管家）会话跑完且台账仍标 running：主人若没停在它的主会话上，补一声完成音（主会话自己会响，避免双响）
function dingRunnerIdle(sid?){
  try {
    var hit = null;
    (TASKS.list || []).forEach(function(t){ if (t.runnerSession === sid) hit = t });
    if (!hit) return false;
    if (S.current && hit.id === S.current.id) return false;
    return String(hit.state || '') === 'running';
  } catch(e){ return false }
}
// PWA 子代理完成（task50-0911）：主/子会话收到 <task id="ses_…" state="completed"> 注入即响专用音
var _pwaAgentAt = 0;                 // 子代理音最后一次发声时刻（4s 抑制窗）
var _pwaBootAt = Date.now();         // 无 properties.time 时的 10s 静默窗起点（挡会话恢复重放）
var _agentSoundAt = 0;               // 子代理音 10s 跨任务节流窗，与 _pwaAgentAt 互不复用
var _lastIdleAt = 0;                 // 目录内任一会话结束时刻（task97 D1）：TUI 桥铃 1.5s 去重锚点，只写于此
var seenTaskIds = new Set();         // 已响过的 task id（同 id 只响一次）
function pwaAgentBell(d?, p?){
  if (!d || d.type !== 'message.part.updated') return;
  var pt = (p && p.part) || (d && d.part);
  if (!pt || pt.type !== 'text' || typeof pt.text !== 'string') return;
  if (pt.text.indexOf('<task id="ses_') !== 0) return;
  var m = /^<task id="(ses_[A-Za-z0-9]+)"[^>]*state="completed"/.exec(pt.text);
  if (!m) return;
  /* task152：完成注入=子任务终局正证据——立即收口（刷新后 S_ENDED 为空，只靠 session.idle 事件永远等不到，
     任务行会卡「执行中」直到 15 分钟兜底；主人 2026-11-09 报「御史还在执行中」） */
  if (m[1] && !S_ENDED[m[1]]){
    S_ENDED[m[1]] = 1;
    scheduleSidebar();
    if (S.tab === 'tasks') scheduleTasks();
    loadTaskLedger(true); /* task262：完成注入=终局铁证，立即强拉台账让 fin/父行/根行秒级同步（proxy 侧 task234 事件驱动 auto-reap 已秒级落库；pendForce 合并防双发） */
  }
  var t = p && p.time;
  if (typeof t === 'number'){
    if (Date.now() - t > 15000) return;              // 判旧先于判重：重放的历史事件丢弃且不登记
  } else if (Date.now() - _pwaBootAt < 10000){
    return;
  }
  var id = m[1];
  if (seenTaskIds.has(id)) return;
  if (seenTaskIds.size > 500) seenTaskIds.clear();
  seenTaskIds.add(id);
  var snd = getPwaAgentSound();
  if (snd !== 'none' && Date.now() - _agentSoundAt >= 10000){
    _agentSoundAt = Date.now();
    _pwaAgentAt = Date.now();
    playDing(snd);
  }
  if (snd !== 'none' && !kaActive()) notifyDing('小 DJ · 其他角色完成', '小管家/枢机/执笔/御史跑完了，回来看看结果'); /* task193 P1-2：保活中已由页面音出声，通知系统音会双响 */
}
// v0.098：后台通知（主人需求：浏览器切后台/锁屏也要有提醒）。页面 hidden 时用系统通知（横幅+系统默认音）；
// 前台仍靠页面音（防双重打扰）；音色为「无」的场景通知也静音。边界：浏览器进程被系统杀掉则不响（Web 方案极限）。
function notifyDing(title?, body?){
  try {
    if (!document.hidden) return;
    /* task323：优先走 SW（安卓/鸿蒙只有 SW 能发系统通知，锁屏带提示音+振动）；不支持再退回构造式 */
    if (typeof notifyShow === 'function' && notifyShow(title, body)) return;
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    var n = new Notification(title, { body: body || '', tag: 'littledj-ding' });
    n.onclick = function(){ try { window.focus(); n.close() } catch(e){} };
  } catch(e) {}
}
function ctxThreshold(){
  var v = Number(localStorage.getItem('littledj.ctxThreshold'));
  return (v > 0 && v <= 100) ? v : 20;
}
function autoNewEnabled(){ return localStorage.getItem('littledj.autoNewCtx') !== '0' } /* task106：显式 '0' 才关（未设置=开） */
/* ---------- task318：待机语音条（对齐 DAG AI Chat 0.499「一栏双态」） ----------
   一栏单热区：轻点(<300ms)=进文字态弹键盘；长按(≥300ms)=起录，松手发送、上滑 ≥60px 取消。
   只在手机端（isMobile 同口径 ≤940px）+ 输入框空 + 未聚焦 + 非转写中 出现；
   与 🎙 按钮共用 startVoiceRec/stopVoiceRec 同一条 ASR 链（转写→自动发送→按设置朗读）。
   首次授权：浏览器弹麦克风许可会把「按住」这个手势打断，所以第一次只提示「请再按住说话」不发送。 */
var HOLD: any = { armed: false, timer: 0, y0: 0, cancel: false, pending: false, ever: false, guarded: false };
/* task322：轻点后的「幽灵 click」哨兵——轻点待机条 = 展开布局 + 光标进输入框，
   但浏览器把这一下合成为 click 时，待机条已藏、落点正好压在刚浮现的工具行上（模型下拉），
   于是「点一下变两行」变成「点一下弹模型选择」（DJ 2026-11-15 实机报障）。
   处理：轻点松手记下坐标，500ms 内、落点 ±30px 内的 click 直接吞掉（输入框/待机条自身放行）。 */
var HOLD_GUARD: any = { t: 0, x: 0, y: 0 };
function holdGhostClick(e?){
  if (!HOLD_GUARD.t) return;
  if (Date.now() > HOLD_GUARD.t){ HOLD_GUARD.t = 0; return }
  var dx = (e.clientX || 0) - HOLD_GUARD.x, dy = (e.clientY || 0) - HOLD_GUARD.y;
  if (dx * dx + dy * dy > 900) return;
  var tg = e.target;
  if (tg && tg.closest && tg.closest('#holdBar,#input')) return;
  HOLD_GUARD.t = 0;
  e.preventDefault();
  e.stopPropagation();
}
function holdBarSync(){
  var b = $('#holdBar'), ta = $('#input');
  if (!b || !ta) return;
  var rec = VOICE.st === 'recording', busy = VOICE.st === 'transcribing';
  var h = HOLD || {};
  var arming = !rec && !busy && !!(h.armed && h.pending); /* 已按住、麦克风还在起（首次要过一次授权） */
  var txt = $('#holdRecTxt');
  if (txt) txt.textContent = busy ? '正在转写…' : (rec ? (h.cancel ? '松手取消' : '松手发送，上滑取消') : '准备麦克风…');
  b.classList.toggle('rec', rec || busy || arming);
  b.classList.toggle('cancel', rec && !!h.cancel);
  var show = isMobile() && (rec || busy || arming || (!String(ta.value || '').trim() && document.activeElement !== ta));
  b.hidden = !show;
  /* 待机条盖住输入框时把占位符吃掉（否则「今天帮你做些什么？」和条子文字重叠） */
  if (document.body) document.body.classList.toggle('holdmode', show && !rec && !busy && !arming);
}
function holdStart(){
  if (VOICE.st === 'transcribing'){ toast('正在转写上一句，稍等…'); return }
  if (S.busy){ toast('小DJ还在回复，等它说完再说', true); return }
  if (VOICE.audio) voiceDisarm(); /* 正在朗读 → 打断再来 */
  HOLD.pending = true;
  startVoiceRec();
  holdBarSync();
}
function holdEnd(cancel?){
  if (cancel) HOLD.cancel = false;
  if (VOICE.st === 'recording'){ stopVoiceRec(!!cancel) }
  else {
    HOLD.pending = false; /* 还没开录就松手了：作废（下次按住重新起） */
    if (cancel) toast('已取消');
  }
  holdBarSync();
}
/* 开录成功后的收口：松手早就发生了 → 首次只提示授权、之后按松手即发送 */
function holdAfterStart(){
  if (!HOLD.pending) return;
  HOLD.pending = false;
  holdBarSync();
  if (!HOLD.ever){ HOLD.ever = true; toast('麦克风已就绪，再按住说话就能发'); stopVoiceRec(true); return }
  stopVoiceRec(!!HOLD.cancel);
}
function bindHoldBar(){
  var b = $('#holdBar'), ta = $('#input');
  if (!ta) return;
  if (b){
    /* task322：浏览器长按默认行为（选词/放大镜/上下文菜单）抢「按住说话」手势——
       touchstart 直接 preventDefault（非 passive）：① 页面吃掉这一按，系统长按放大镜不再起；
       ② 浏览器也就不会把这一按再合成 click，轻点展开后的错位落点（模型下拉）不会再被误触。 */
    b.addEventListener('touchstart', function(e){ if (e.cancelable) e.preventDefault() }, { passive: false });
    b.addEventListener('contextmenu', function(e){ e.preventDefault() });
    b.addEventListener('selectstart', function(e){ e.preventDefault() });
    if (!HOLD.guarded){ HOLD.guarded = true; document.addEventListener('click', holdGhostClick, true) } /* 兜底：个别内核照样派发 click 时吞掉 */
    b.addEventListener('pointerdown', function(e){
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (VOICE.st !== 'idle'){ return }
      clearTimeout(HOLD.timer);
      HOLD.armed = false; HOLD.cancel = false; HOLD.y0 = e.clientY;
      try { b.setPointerCapture(e.pointerId) } catch(_){}
      HOLD.timer = setTimeout(function(){
        HOLD.timer = 0; HOLD.armed = true;
        holdStart();
      }, 300);
    });
    b.addEventListener('pointermove', function(e){
      if (!HOLD.armed) return;
      var up = HOLD.y0 - e.clientY;
      if (!HOLD.cancel && up >= 60){ HOLD.cancel = true; holdBarSync() }
      else if (HOLD.cancel && up < 40){ HOLD.cancel = false; holdBarSync() }
    });
    b.addEventListener('pointerup', function(e){
      var wasArmed = HOLD.armed;
      if (HOLD.timer){ clearTimeout(HOLD.timer); HOLD.timer = 0 }
      HOLD.armed = false;
      if (!wasArmed){
        HOLD_GUARD.t = Date.now() + 500; HOLD_GUARD.x = e.clientX || 0; HOLD_GUARD.y = e.clientY || 0; /* task322：吞掉这一按的合成 click */
        ta.focus(); /* 轻点 = 进文字态（弹键盘），光标落到输入框里 */
        try { ta.setSelectionRange(ta.value.length, ta.value.length) } catch(_){}
        setTimeout(holdBarSync, 30); /* 补一拍同步，防个别浏览器 focus 事件不派发时条子不藏 */
        return
      }
      var c = HOLD.cancel; HOLD.cancel = false;
      holdEnd(c);
    });
    b.addEventListener('pointercancel', function(){
      if (HOLD.timer){ clearTimeout(HOLD.timer); HOLD.timer = 0 }
      if (HOLD.armed){ HOLD.armed = false; HOLD.cancel = false; holdEnd(true) }
    });
  }
  ta.addEventListener('focus', holdBarSync);
  ta.addEventListener('blur', function(){ setTimeout(holdBarSync, 120) }); /* 延迟一拍：blur→focus 连跳不闪 */
  ta.addEventListener('input', holdBarSync);
  window.addEventListener('resize', holdBarSync);
  syncInputPh();
  holdBarSync();
}
window.VOICE=VOICE; window._pwaAgentAt=_pwaAgentAt; window._pwaBootAt=_pwaBootAt; window._agentSoundAt=_agentSoundAt; window._lastIdleAt=_lastIdleAt; window.seenTaskIds=seenTaskIds; window.voiceReadEnabled=voiceReadEnabled; window.getVoiceChatVoice=getVoiceChatVoice; window.micBtnState=micBtnState; window.micToggle=micToggle; window.startVoiceRec=startVoiceRec; window.stopVoiceRec=stopVoiceRec; window.voiceCleanup=voiceCleanup; window.voiceIdle=voiceIdle; window.voiceToWav=voiceToWav; window.voiceTruncateRead=voiceTruncateRead; window.voiceArm=voiceArm; window.voiceDisarm=voiceDisarm; window.voiceReset=voiceReset; window.stopVoiceAudio=stopVoiceAudio; window.playVoiceAudio=playVoiceAudio; window.voicePlainText=voicePlainText; window.voiceSpeak=voiceSpeak; window.voiceMaybeRead=voiceMaybeRead; window.voiceReadQuestion=voiceReadQuestion; window.dingRunnerIdle=dingRunnerIdle; window.pwaAgentBell=pwaAgentBell; window.notifyDing=notifyDing; window.ctxThreshold=ctxThreshold; window.autoNewEnabled=autoNewEnabled; window.HOLD=HOLD; window.holdBarSync=holdBarSync; window.holdStart=holdStart; window.holdEnd=holdEnd; window.holdAfterStart=holdAfterStart; window.bindHoldBar=bindHoldBar; window.MSG_SPEAK=MSG_SPEAK; window.msgSpeakVoiceId=msgSpeakVoiceId; window.msgSpeakProvider=msgSpeakProvider; window.msgSpeakSplit=msgSpeakSplit; window.msgSpeakBtnSync=msgSpeakBtnSync; window.msgSpeakStop=msgSpeakStop; window.msgSpeakPause=msgSpeakPause; window.msgSpeakResume=msgSpeakResume; window.msgSpeakToggle=msgSpeakToggle;

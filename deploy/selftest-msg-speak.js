#!/usr/bin/env node
/* task347 消息语音播报自测（AI 回复 🔊 按钮 + DS TTS 男/女声设置）
 *   ① messages.js：🔊 按钮（data-act="speak"）在 acts 内、fork 之后 stop 之前
 *   ② index.html：document click 委托 speak 分支存在且调 msgSpeakToggle；.speaking 高亮 CSS 在
 *   ③ voice.js：播报函数族六符号定义 + window 导出齐全
 *   ④ msgSpeakSplit 纯函数单测（vm 提取）：空文→[]、短文单段、长文句界切、无句界 2300 硬切兜底
 *   ⑤ tts.js：设置区块（mMsgSpeakVoice 下拉 + littledj.msgSpeakVoice + stella/tide + 试听走 deepseek）
 *   ⑥ proxy.js：DS_VOICE_TEXT_MAX=10000 且上限检查在类型判定后（deepseek 放宽、其他 2000）
 *   ⑦ 缓存参数：messages p3 / voice p2 / tts p2；verText 三处一致（动态口径 L-063）
 *   ⑧ 红对照：删锚样本必 FAIL（断言真咬合）
 * 退出码 0=全绿，1=有失败 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const rd = function (p) { return fs.readFileSync(path.join(root, p), 'utf8') };
const idx = rd('ui/index.html');
const msgs = rd('ui/src/chat/messages.js');
const voice = rd('ui/src/voice/voice.js');
const tts = rd('ui/src/settings/tts.js');
const proxy = rd('server/proxy.js');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (hint ? '  ← ' + hint : '')); }
}

/* ① 按钮在 acts 且顺序 copy → fork → speak → stop（innerHTML 是 '...'+CONV_ICON_FORK+'...' 拼接，
      正则取整条语句到行尾分号，不在引号内截断） */
(function () {
  const m = msgs.match(/acts\.innerHTML = [\s\S]*?title="停止生成（同电脑 ESC）">✕<\/button>';?/);
  const html = m ? m[0] : '';
  const pos = function (k) { return html.indexOf('data-act="' + k + '"') };
  ok('① 🔊 播报按钮在 acts innerHTML（fork 后 stop 前）',
    pos('speak') > pos('fork') && pos('speak') < pos('stop') && pos('speak') > 0,
    html.slice(0, 80));
  ok('① 按钮图标为 🔊 且 title 提示再点停止', /data-act="speak"[^>]*title="语音播报[^"]*">🔊</.test(html));
})();

/* ② index.html 委托分支 + CSS */
ok('② 委托分支：data-act === \'speak\' → msgSpeakToggle(msg)', /act\.dataset\.act === 'speak' && msg\)\{ msgSpeakToggle\(msg\) \}/.test(idx));
ok('② 委托分支：data-act === \'speakstop\' → msgSpeakStop（完整关闭键）', /act\.dataset\.act === 'speakstop' && msg\)\{ msgSpeakStop\(\); toast\('已停止播报'\) \}/.test(idx));
ok('② 迷你播放器 CSS：.ssp.on 展开停止键 + .breath 呼吸 + .ssp-load 转圈（零新增 hex）', /\.msg \.acts \.ssp\.on \.ssp-stop\{width:20px;opacity:1\}/.test(idx) && /@keyframes sspBreath/.test(idx) && /@keyframes sspSpin/.test(idx));

/* ③ voice.js 函数族 + 导出 */
(function () {
  const syms = ['MSG_SPEAK', 'SPK_ICONS', 'msgSpeakVoiceId', 'msgSpeakProvider', 'msgSpeakSplit', 'msgSpeakBtnSync', 'msgSpeakStop', 'msgSpeakPause', 'msgSpeakResume', 'msgSpeakToggle'];
  const defs = syms.filter(function (s) {
    return voice.indexOf('function ' + s + '(') >= 0 || voice.indexOf('var ' + s + ' =') >= 0 || voice.indexOf('var ' + s + '=') >= 0;
  });
  ok('③ 播报函数族定义齐全（10 符号）', defs.length === syms.length, '缺: ' + syms.filter(function (s) { return defs.indexOf(s) < 0 }).join(','));
  const exp = syms.filter(function (s) { return s === 'SPK_ICONS' || voice.indexOf('window.' + s + '=') >= 0 || voice.indexOf('window.' + s + '=' + s) >= 0 }); /* SPK_ICONS 模块内自用不挂 window */
  ok('③ window 导出齐全（index.html 委托可直调；SPK_ICONS 内部自用豁免）', exp.length === syms.length);
  ok('③ 默认女声：localStorage male 才切 tide，否则 stella', /'male' \? 'tide' : 'stella'/.test(voice) && /littledj\.msgSpeakVoice/.test(voice));
  /* task362：三态状态机（照 DAG TtsPlayerControl） */
  ok('③ 三态状态机 MSG_SPEAK.state（loading/playing/paused）', /MSG_SPEAK = \{ mid: '', seq: 0, state: '' \}/.test(voice) && /'loading'/.test(voice) && /'paused'/.test(voice));
  ok('③ 暂停=audio.pause() 不触发链（onended 天然不fire）', /function msgSpeakPause\(\)\{[\s\S]{0,220}VOICE\.audio\) VOICE\.audio\.pause\(\)/.test(voice));
  ok('③ 继续=原音频 play()（seq 未变，链继续）', /function msgSpeakResume\(\)\{[\s\S]{0,320}a\.play\(\)/.test(voice));
  ok('③ 主键三态分派（loading 提示稍候/playing 暂停/paused 继续）', /msgSpeakState === 'loading'/.test(voice.replace(/MSG_SPEAK\./g, 'msgSpeakState')) || /MSG_SPEAK\.state === 'loading'\)\{ toast\('正在合成/.test(voice));
  ok('③ SVG 图标对（play 三角/pause 双竖条，currentColor 跟色）', /SPK_ICONS = \{[\s\S]*?play:[\s\S]*?pause:/.test(voice) && /fill="currentColor"/.test(voice));
})();

/* ④ msgSpeakSplit 纯函数单测（vm 提取函数体） */
(function () {
  const m = voice.match(/function msgSpeakSplit\(t\)\{[\s\S]*?\n\}/);
  if (!m) { ok('④ msgSpeakSplit 可提取', false, '函数不存在'); return }
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(m[0] + '; this.fn = msgSpeakSplit;', sandbox);
  const fn = sandbox.fn;
  const t1 = fn('');
  ok('④ 空文 → []（上游已拦截，双保险不空段请求）', Array.isArray(t1) && t1.length === 0);
  const t2 = fn('你好，主人。');
  ok('④ 短文 → 单段且保留原文', t2.length === 1 && t2[0] === '你好，主人。');
  const long3 = ('这是第一句。这是第二句！').repeat(400); /* ≈4800 字，有句界 */
  const t3 = fn(long3);
  const all3 = t3.join('');
  const max3 = Math.max.apply(null, t3.map(function (s) { return s.length }));
  ok('④ 长文按句界分段且段长 <2000（server 未重启上限内直达）', t3.length > 1 && max3 < 2000 && all3.length === long3.length,
    '段数=' + t3.length + ' 最长=' + max3);
  const noBrk = '好'.repeat(5000); /* 无任何句界 → 1990 硬切兜底 */
  const t4 = fn(noBrk);
  const max4 = Math.max.apply(null, t4.map(function (s) { return s.length }));
  const all4 = t4.join('');
  ok('④ 无句界长文硬切兜底（段 <2000 且零丢字）', t4.length >= 2 && max4 < 2000 && all4.length === 5000,
    '段数=' + t4.length + ' 最长=' + max4);
})();

/* ⑤ tts.js 设置区块 */
ok('⑤ 设置区块：播报音色下拉 mMsgSpeakVoice + 女声默认', /id = 'mMsgSpeakVoice'/.test(tts) && /女声 · Stella（默认）/.test(tts) && /男声 · Tide/.test(tts));
ok('⑤ 选择写 littledj.msgSpeakVoice 且换音色停在途播报', /localStorage\.setItem\('littledj\.msgSpeakVoice'/.test(tts) && /msgSpeakStop\(\)/.test(tts));
ok('⑤ 试听按钮走 providerId=deepseek', /providerId: 'deepseek'/.test(tts) && /▶ 试听/.test(tts));

/* ⑥ proxy.js 上限分流 */
ok('⑥ DS_VOICE_TEXT_MAX = 10000 常量在', /const DS_VOICE_TEXT_MAX = 10000/.test(proxy));
(function () {
  const m = proxy.match(/function voiceTtsByProvider\(res, d, pid\) \{[\s\S]*?\n  const known = /);
  const seg = m ? m[0] : '';
  const posType = seg.indexOf("p.type !== 'volcano' && p.type !== 'deepseek'");
  const posLen = seg.indexOf('text.length > maxLen');
  ok('⑥ 长度检查在类型判定之后（deepseek 才放宽）', posType >= 0 && posLen > posType, 'type@' + posType + ' len@' + posLen);
  ok('⑥ 分流表达式：deepseek ? 10000 : VOICE_TEXT_MAX', /p\.type === 'deepseek' \? DS_VOICE_TEXT_MAX : VOICE_TEXT_MAX/.test(proxy));
})();

/* ⑦ 缓存参数 + verText 三处（动态口径） */
(function () {
  const VMS = require('./contract').htmlScriptVersionMap(path.join(root, 'ui'));
  ok('⑦ 缓存参数：messages.js（当前 ' + (VMS['src/chat/messages.js'] || '缺失') + '，动态口径 task371-M0#9）', /^p\d+$/.test(VMS['src/chat/messages.js'] || ''));
  ok('⑦ 缓存参数：voice.js（当前 ' + (VMS['src/voice/voice.js'] || '缺失') + '）', /^p\d+$/.test(VMS['src/voice/voice.js'] || ''));
  ok('⑦ 缓存参数：tts.js（当前 ' + (VMS['src/settings/tts.js'] || '缺失') + '）', /^p\d+$/.test(VMS['src/settings/tts.js'] || ''));
})();
ok('⑦ messages.js 迷你播放器骨架（span.ssp + ssp-main + ssp-stop 常驻挂载）', /<span class="ssp"><button data-act="speak" class="ssp-main"/.test(msgs) && /data-act="speakstop" class="ssp-stop"/.test(msgs));
(function () {
  const mm = (idx + rd('ui/src/app/boot.js') + rd('ui/src/pricing/popout.js')).match(/personal agent · v[0-9.]+/g) || [];
  const uniq = Array.from(new Set(mm));
  ok('⑦ verText 三处一致（index/boot/popout，动态口径）', mm.length === 3 && uniq.length === 1, mm.join(','));
})();

/* ===== task357 段：语音/TTS 融合与无声修复 ===== */
const settingsJs = rd('ui/src/settings/settings.js');
const keywin = rd('ui/src/pricing/keywin.js');

/* ⑨ 无声修复：播放音量与提示音脱钩 + 播报跟随 TTS 供应商 */
ok('⑨ playVoiceAudio 支持显式音量三参（typeof vol === number）', /function playVoiceAudio\(blob, onEnd, vol\)/.test(voice) && /typeof vol === 'number'/.test(voice));
ok('⑨ 播报播放满音量（playVoiceAudio(blob, next, 1)）', /playVoiceAudio\(blob, next, 1\)/.test(voice));
ok('⑨ 播报供应商单源 msgSpeakProvider（littledj.ttsProvider 回落 deepseek）', /function msgSpeakProvider\(\)/.test(voice) && /littledj\.ttsProvider/.test(voice) && /\|\| 'deepseek'/.test(voice));
ok('⑨ 播报 fetch 用 pid 变量（不再硬编码 deepseek）', /providerId: pid/.test(voice) && !/providerId: 'deepseek' \}\)\n      \.then\(function\(r\)\{\n        if \(r\.status === 404\) throw new Error\('语音接口还没生效/.test(voice));
ok('⑨ 语音对话朗读带 providerId（voiceSpeak 不再硬走火山）', /var body = \{ text: text, voice: getVoiceChatVoice\(\) \};[\s\S]{0,200}if \(pid\) body\.providerId = pid/.test(voice));

/* ⑩ TTS 列表 ready 判定含 deepseek（task308 漏网 bug 防复发） */
ok('⑩ ready 判定 volcano||deepseek（禁止只 volcano）', /var okType = \(type === 'volcano' \|\| type === 'deepseek'\)/.test(tts));
ok('⑩ 占位列表含 deepseek ready:true', /\{ id: 'deepseek', label: 'DeepSeek', type: 'deepseek', ready: true/.test(tts));

/* ⑪ 语音并入 TTS：一级导航无「语音对话」独立项 + TTS 首项=朗读与播报 + 分派 'tts' */
ok('⑪ 一级导航「语音对话」独立项已删', !/\{ id: 'tts-voice', label: '语音对话'/.test(settingsJs));
ok('⑪ TTS 子导航首项=朗读与播报（静态+动态两处）', /var out = \[\{ id: 'tts', label: '朗读与播报' \}\]/.test(tts) && /\{ id: 'tts', label: '朗读与播报' \}/.test(settingsJs));
ok('⑪ 分派 SETTINGS.view===\'tts\' → renderVoicePage', /SETTINGS\.view === 'tts'\) renderVoicePage\(body\)/.test(settingsJs));

/* ⑫ API Key DeepSeek 卡内嵌 TTS 区块 + 比价表语音行直达提示 */
ok('⑫ DeepSeek Key 卡 TTS 区块（音色下拉+试听，共用同一 Key）', /kv-ds-ttsvoice/.test(keywin) && /kv-ds-ttsplay/.test(keywin) && /同一个 Key/.test(keywin));
ok('⑫ 火山 Key 卡 TTS 直达按钮（跳 TTS 页火山卡）', /kv-volc-ttshop/.test(keywin) && /openSettings\('tts-p-volcano'\)/.test(keywin));
ok('⑫ 比价表语音行 title「点击配置语音合成」+ data-voice 标记', /点击配置语音合成（TTS）/.test(keywin) && /data-voice/.test(keywin));
(function () {
  const VMS2 = require('./contract').htmlScriptVersionMap(path.join(root, 'ui'));
  ok('⑫ 缓存参数：settings / keywin（当前 ' + (VMS2['src/settings/settings.js'] || '缺失') + ' / ' + (VMS2['src/pricing/keywin.js'] || '缺失') + '，动态口径 task371-M0#9）', /^p\d+$/.test(VMS2['src/settings/settings.js'] || '') && /^p\d+$/.test(VMS2['src/pricing/keywin.js'] || ''));
})();

/* ⑧ 红对照：删锚样本必 FAIL */
(function () {
  const reBtn = /data-act="speak"/;
  const noBtn = msgs.replace('data-act="speak"', 'data-act="removed"');
  ok('⑧ 红对照：无 speak 按钮的 messages.js 判 FAIL', reBtn.test(msgs) && !reBtn.test(noBtn));
  const noBranch = idx.replace("act.dataset.act === 'speak'", "act.dataset.act === 'noop'");
  ok('⑧ 红对照：无委托分支的 index.html 判 FAIL', !/act\.dataset\.act === 'speak' && msg\)\{ msgSpeakToggle\(msg\) \}/.test(noBranch));
  const noCap = proxy.replace('const DS_VOICE_TEXT_MAX = 10000', 'const DS_VOICE_TEXT_MAX = 1');
  ok('⑧ 红对照：DS 上限被改 1 的 proxy.js 判 FAIL', !/const DS_VOICE_TEXT_MAX = 10000/.test(noCap));
})();

console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail === 0 ? 0 : 1);

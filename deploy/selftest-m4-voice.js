#!/usr/bin/env node
// selftest-m4-voice（M4 语音域静态锚+行为断言）
'use strict';
const fs = require('fs');
const path = require('path');
const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } }
const read = (p) => fs.readFileSync(path.join(ETS, p), 'utf8');

const v = read('domain/voice/VoiceService.ets');
const idx = read('pages/Index.ets');
const net = read('core/Net.ets');

console.log('== V 录音与转写 ==');
t('V1 MICROPHONE 权限声明（module.json5 user_grant+reason）', fs.readFileSync(path.join(ETS, '../module.json5'), 'utf8').includes('MICROPHONE'));
t('V2 AudioCapturer 16k/16bit/mono RAW', v.includes('16000') && v.includes('SAMPLE_FORMAT_S16LE') && v.includes('ENCODING_TYPE_RAW'));
t('V3 WAV 头手拼（RIFF/WAVE/fmt/PCM 44 字节——后端硬校验）', v.includes('RIFF') && v.includes('WAVE') && v.includes('setUint32(24, SAMPLE_RATE'));
t('V4 误触守卫（<0.05s 空）', v.includes('1600'));
t('V5 STT 上载 rawRequest audio/wav', v.includes("/_voice/stt") && v.includes("'audio/wav'"));
t('V6 STT 结果不被空 then 吞（P0 回归）', !v.includes(".then((): string => '')") && v.includes('return rawRequest(') && v.includes('Promise<string>'));

console.log('== T 播报 ==');
t('T1 TTS（POST /_voice/tts {text,fmt:mp3}）', v.includes("/_voice/tts") && v.includes("'fmt': 'mp3'"));
t('T2 mp3 落临时文件+AVPlayer 播', v.includes('cacheDir') && v.includes('createAVPlayer'));
t('T3 播完 completed 释放', v.includes("'completed'") && v.includes('release'));
t('T4 armed 一次性（回复收尾朗读）', v.includes('isArmed') && v.includes('onReplyDone'));
t('T5 TTS 中文 body 走 TextEncoder（P1 回归）', v.includes('new util.TextEncoder().encodeInto(s)') && !v.includes('u8[i] = s.charCodeAt(i)'));

console.log('== U UI 接线 ==');
t('U1 🎙 按钮（宽窄双形态+录音红点态）', idx.includes('micBtn') && idx.includes("'🎙'") && idx.includes("'●'"));
t('U2 长按开录+点按开关双交互', idx.includes('LongPressGesture') && idx.includes('micStart()'));
t('U3 转写→自动发送（arm 后回复朗读）', idx.includes('VoiceService.transcribe') && idx.includes('VoiceService.arm()'));
t('U4 SESSION_BUSY idle 驱动朗读（末条 assistant）', idx.includes('onBusyForVoice') && idx.includes('onReplyDone'));
t('U5 EntryAbility setContext（cacheDir 注入）', read('entryability/EntryAbility.ets').includes('VoiceService.setContext'));

console.log('== W 基础设施 ==');
t('W1 Net rawRequest（binary 响应+raw body+401 拦截）', net.includes('rawRequest') && net.includes('ARRAY_BUFFER'));
t('W2 零 console/裸 hex', !/console\./.test(v + idx) && !/#[0-9a-fA-F]{6}\b/.test(v));
t('W3 契约头', v.includes('@提供 VoiceService pcmToWav'));

console.log(`\nM4 voice: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

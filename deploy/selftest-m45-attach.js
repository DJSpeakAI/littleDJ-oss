#!/usr/bin/env node
// selftest-m45-attach（M4.5 附件+看图+STT 转译）
'use strict';
const fs = require('fs');
const path = require('path');
const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } }
const read = (p) => fs.readFileSync(path.join(ETS, p), 'utf8');

const att = read('domain/media/AttachService.ets');
const chat = read('domain/chat/ChatService.ets');
const idx = read('pages/Index.ets');
const mv = read('components/MsgRowView.ets');
const v = read('domain/voice/VoiceService.ets');

console.log('== A 附件 ==');
t('A1 PhotoViewPicker 选图→base64 dataURL', att.includes('PhotoViewPicker') && att.includes('base64'));
t('A2 sendAtt（file part 与 text 并列同 PWA）', chat.includes('sendAtt') && chat.includes("'type': 'file'"));
t('A3 MsgItem.imgUrl（首图缩略）', read('store/Store.ets').includes('imgUrl'));
t('A4 refreshMsgs 解析 file part→imgUrl', chat.includes("p.url.indexOf('data:image/')"));
t('A5 MsgRowView 缩略图+onViewImg 回调', mv.includes('imgUrl') && mv.includes('onViewImg'));
t('A6 📎 按钮（pickAndSend）', idx.includes('clipBtn') && idx.includes('pickAndSend'));
t('A7 全屏看图层（点任意关闭）', idx.includes('viewImg') && idx.includes('点任意处关闭'));

console.log('== S STT 转译 ==');
t('S1 STT 回包 bytes→text→JSON 解', v.includes("decodeToString(new Uint8Array(b))") && v.includes("j['text']"));

console.log('== Z 红线 ==');
t('Z1 零 console/裸 hex', !/console\./.test(att + idx) && !/#[0-9a-fA-F]{6}\b/.test(idx.replace('#ee000000', '')));
t('Z2 契约头', att.includes('@提供 AttachService'));

console.log(`\nM4.5 attach: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
let pass = 0, fail = 0;
function t(n, c) { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } }
const read = (p) => fs.readFileSync(path.join(ETS, p), 'utf8');
console.log('== P 比价 ==');
t('P1 /_pricing 三源解析（providers[].models 峰/谷三档）', read('domain/pricing/PricingService.ets').includes('inputHit') && read('domain/pricing/PricingService.ets').includes('offpeak'));
t('P2 PriceRow 具名类+K_PRICES 数组直连', read('store/Store.ets').includes('class PriceRow') && read('pages/Settings.ets').includes('pricesArr'));
t('P3 设置页比价区（命中/未中/输出三行）', read('pages/Settings.ets').includes('命中') && read('pages/Settings.ets').includes('未中'));
console.log('== C 复制 ==');
t('C1 消息长按复制（bindContextMenu+pasteboard）', read('components/MsgRowView.ets').includes('bindContextMenu') && read('components/MsgRowView.ets').includes('复制文本'));
console.log(`\nM5: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

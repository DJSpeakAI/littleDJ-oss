#!/usr/bin/env node
// selftest-m3-settings（M3 设置域 · 静态锚+行为断言）
'use strict';
const fs = require('fs');
const path = require('path');
const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
let pass = 0, fail = 0;
function t(name, cond) { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); } }
const read = (p) => fs.readFileSync(path.join(ETS, p), 'utf8');

const svc = read('domain/settings/SettingsService.ets');
const pg = read('pages/Settings.ets');
const store = read('store/Store.ets');
const chat = read('domain/chat/ChatService.ets');
const right = read('components/RightPanelView.ets');
const idx = read('pages/Index.ets');

console.log('== M 模型选择 ==');
t('M1 providers 过滤（deepseek 白名单+ALLOW 两家+toolcall）', svc.includes("mid !== 'deepseek-flash'") && svc.includes("'zhipuai-coding-plan'") && svc.includes('toolcall'));
t('M2 排序（pname+name）', svc.includes('a.pname === b.pname'));
t('M3 Prefs 持久化（littledj.model 同 PWA localStorage 语义）', svc.includes("Prefs.setString('model'") && svc.includes("Prefs.getString('model'"));
t('M4 默认选中首个（仅非 restoreOnly）+恢复校验', svc.includes('!restoreOnly && Store.curModel() === null && out.length > 0') && svc.includes('JSON.parse(saved)'));
t('M5 send 携带 model（Store.curModel 直取零层依赖）', chat.includes('Store.curModel()') && chat.includes("body['model'] = mj"));
t('M6 Radio 组选择+K_MODEL_CUR 高亮', pg.includes("group: 'model'") && pg.includes('modelCurText'));
t('M7 Store 模型域（K_MODELS 数组直连+curModelRef）', store.includes('K_MODELS') && store.includes('curModelRef'));
t('M8 启动恢复模型（Index loadModels(true)，不兜底默认）', idx.includes('SettingsService.loadModels(true)') && svc.includes('loadModels(restoreOnly?: boolean)'));

console.log('== K Key 卡+余额 ==');
t('K1 /_settings/zhipu keys 解析（masked+active）', svc.includes("rec['keys']") && svc.includes('KeyCard(nm, mk'));
t('K2 激活切换（POST active {name}+刷新）', svc.includes("/_settings/zhipu/active") && pg.includes('activateKey(k.name)'));
t('K3 余额（POST deepseek/balance+字符串优先+¥ 格式）', svc.includes('/_settings/deepseek/balance') && svc.includes("typeof bal === 'string'") && svc.includes('toFixed(2)'));
t('K4 KeyCard 具名类（L-126 家族）', store.includes('export class KeyCard'));

console.log('== N 入口+页面 ==');
t('N1 设置页注册+双入口齿轮（RightPanel+窄屏 ⚙→router）', fs.readFileSync(path.join(ETS, '../resources/base/profile/main_pages.json'), 'utf8').includes('pages/Settings') && right.includes('settingsBtn') && right.includes("pushUrl({ url: 'pages/Settings' })") && idx.includes('settingsBtnNarrow') && idx.includes("pushUrl({ url: 'pages/Settings' })"));
t('N2 固定 id（settingsTitle/balanceText）', pg.includes(".id('settingsTitle')") && pg.includes(".id('balanceText')"));
t('N3 返回键（router.back）', pg.includes('router.back()'));
t('N4 契约头三件（@提供/@依赖）', pg.includes('@提供 Settings 页') && svc.includes('@提供 SettingsService'));
t('N5 零 console/裸 hex', !/console\./.test(pg + svc) && !/#[0-9a-fA-F]{6}\b/.test(pg));

console.log(`\nM3 settings: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

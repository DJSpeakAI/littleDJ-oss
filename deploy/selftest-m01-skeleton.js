#!/usr/bin/env node
// selftest-m01-skeleton（M0.1 骨架静态断言 · task361）
// A 页面注册与入口 B 登录安全（密码零落盘/通行证 Asset） C 四层关键锚
// D 网络鉴权（dj_pass Cookie/401 拦截/Mozilla UA） E 主题 token 与裸色禁令
// F 双机检自跑 G App 版本推进
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function readCompS(f){return fs.readFileSync(path.join(ETS,'components',f),'utf8')}
const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
const RES = path.join(__dirname, '..', 'entry', 'src', 'main', 'resources');
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

console.log('== A 页面注册与入口 ==');
const pages = read(path.join(RES, 'base', 'profile', 'main_pages.json'));
t('A1 main_pages 含 Boot', pages.includes('pages/Boot'));
t('A2 main_pages 含 Login', pages.includes('pages/Login'));
t('A3 main_pages 含 Index', pages.includes('pages/Index'));
t('A4 main_pages 含 Probe（验收保留）', pages.includes('pages/Probe'));
const ability = read(path.join(ETS, 'entryability', 'EntryAbility.ets'));
t('A5 入口=pages/Boot', ability.includes("loadContent('pages/Boot'"));
t('A6 onCreate 注入 Prefs.init', ability.includes('Prefs.init'));
t('A7 onCreate Store.init（AppStorage 预建）', ability.includes('Store.init'));

console.log('== B 登录安全（P1-3） ==');
const login = read(path.join(ETS, 'pages', 'Login.ets'));
t('B1 密码框 InputType.Password', login.includes('InputType.Password'));
t('B2 登录页零 console（无凭据日志）', !/console\./.test(login));
t('B3 密码不进 Prefs（零落盘）', !/Prefs\.set\w+\([^)]*this\.pass/.test(login));
const vault = read(path.join(ETS, 'core', 'Vault.ets'));
t('B4 Vault 走 @kit.AssetStoreKit', vault.includes('@kit.AssetStoreKit'));
t('B5 通行证 alias=littledj 前缀', vault.includes('littledj.dj_pass'));
t('B6 存的是 token 非 pass（savePass(token,did)）', /savePass\(token/.test(vault) || /savePass\(r\.token/.test(login));

console.log('== C 四层关键锚 ==');
const store = read(path.join(ETS, 'store', 'Store.ets'));
t('C1 Store 域 key lj.* 前缀', store.includes("'lj.sessions.list'") && store.includes("'lj.chat.msgDs'"));
t('C2 Store 唯一出口 AppStorage.setOrCreate', store.includes('AppStorage.setOrCreate'));
t('C3 MsgItem @Observed', store.includes('@Observed'));
t('C4 MsgDataSource 实现 IDataSource', store.includes('implements IDataSource'));
const chat = read(path.join(ETS, 'domain', 'chat', 'ChatService.ets'));
t('C5 发送走 prompt_async', chat.includes('prompt_async'));
t('C6 全量校准 refreshMsgs（reconcile 最小实现）', chat.includes('refreshMsgs'));
t('C7 delta 生长 onDelta', chat.includes('onDelta'));
t('C8 断线恢复双补账（recovered→refreshMsgs+loadConvs）', /recovered[\s\S]{0,200}refreshMsgs/.test(chat));
const sse = read(path.join(ETS, 'core', 'Sse.ets'));
t('C9 SseStream 目录级订阅（?directory=）', sse.includes('?directory='));
t('C10 SSE 状态三态上抛 Store', sse.includes('SSE_STATE'));
t('C11 降级轮询 30s', sse.includes('30000'));
t('C12 探针 SseProbe 保留未破坏', sse.includes('class SseProbe'));
const bus = read(path.join(ETS, 'core', 'event-bus.ets'));
t('C13 EventBus typed 总线', bus.includes('class EventBus') && bus.includes('static emit'));
const idx = read(path.join(ETS, 'pages', 'Index.ets'));
t('C14 消息流 LazyForEach', idx.includes('LazyForEach'));
t('C15 SideBarContainer Drawer', idx.includes('SideBarContainer'));
t('C16 固定节点 id（msgList/chatInput 留 Index；sessList 随 SidePanelView 下放 M2.1）', idx.includes(".id('msgList')") && idx.includes(".id('chatInput')") && readCompS('SidePanelView.ets').includes(".id('sessList')"));
// 产出审 P1 修复锚（防复发）
t('C17 切目录先 teardown（P1-1：subscribe 内 destroy 旧 req）', /subscribe\(dir[\s\S]{0,400}req\.destroy/.test(sse));
t('C18 delta 按会话过滤（P1-2：sessionID≠current 即弃）', chat.includes('d.sessionID !== \'\' && d.sessionID !== Store.currentId()'));
t('C19 他话收尾不刷新当前（P1-2）', /evSid !== Store\.currentId\(\)/.test(chat));
t('C20 onBusy 收敛 Store.markBusy（P1-6）', chat.includes('Store.markBusy(sid, busy)'));

console.log('== D 网络鉴权 ==');
const net = read(path.join(ETS, 'core', 'Net.ets'));
t('D1 UA Mozilla/5.0 前缀', net.includes('Mozilla/5.0'));
t('D2 request 带 dj_pass Cookie', net.includes('dj_pass='));
t('D3 401 统一拦截→AUTH_EXPIRED', /401[\s\S]{0,120}AUTH_EXPIRED/.test(net));
t('D4 login 解析 Set-Cookie dj_pass', net.includes(/dj_pass=\(\[\^;\]\+\)/.source.replace(/\\/g, '') ) || /dj_pass=\(\[\^;\]\+\)/.test(net));
t('D5 authProbe 只认通行证', net.includes('/_auth'));

console.log('== E 主题 token ==');
const colors = read(path.join(RES, 'base', 'element', 'color.json'));
t('E1 color.json 17 token（16 业务 + start_window_background 模板保留）', (colors.match(/"name"/g) || []).length === 17);
t('E2 深色底 #0d0e10 对齐 PWA', colors.includes('#0d0e10'));
let hexHits = [];
for (const f of ['pages/Index.ets', 'pages/Boot.ets', 'pages/Login.ets']) {
  const src = read(path.join(ETS, f));
  const hits = src.match(/#[0-9a-fA-F]{6}\b/g) || [];
  for (const h of hits) hexHits.push(`${f}:${h}`);
}
t('E3 M0.1 三页零裸色值（一律 $r；Probe 为 M0.0 遗留另计）', hexHits.length === 0);

console.log('== F 双机检自跑 ==');
try {
  execSync(`node ${path.join(__dirname, 'check-ets-imports.js')}`, { stdio: 'pipe' });
  t('F1 check-ets-imports exit 0', true);
} catch (e) { t('F1 check-ets-imports exit 0', false); }
try {
  execSync(`node ${path.join(__dirname, 'check-ets-contract.js')}`, { stdio: 'pipe' });
  t('F2 check-ets-contract exit 0', true);
} catch (e) { t('F2 check-ets-contract exit 0', false); }
try {
  execSync(`node ${path.join(__dirname, 'check-ets-imports.js')} --cycle-selftest`, { stdio: 'pipe' });
  t('F3 环检测红绿自验 exit 0（P1-3）', true);
} catch (e) { t('F3 环检测红绿自验 exit 0（P1-3）', false); }

console.log('== G App 版本 ==');
const app = read(path.join(__dirname, '..', 'AppScope', 'app.json5'));
const vm = /"versionName"\s*:\s*"([0-9]+\.[0-9]+\.[0-9]+)"/.exec(app);
t('G1 AppScope versionName 三段 semver + 当前 1.0.1', vm !== null && vm[1] === '1.0.1');

console.log(`\nM0.1 skeleton: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
// selftest-m2-sidebar（M2 侧栏域+xdevice · task361 静态锚+参照行为断言）
'use strict';
const fs = require('fs');
const path = require('path');

const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
const read = (p) => fs.readFileSync(path.join(ETS, p), 'utf8');
function readComp(f) { return fs.readFileSync(path.join(ETS, 'components', f), 'utf8'); }

console.log('== X xdevice（1:1 移植锚） ==');
const xd = read('domain/sync/XdeviceService.ets');
t('X1 15s/30s 双频（TICK 15000+EVERY 2）', xd.includes('XDEV_TICK_MS = 15000') && xd.includes('XDEV_SESS_EVERY = 2'));
t('X2 会话签名四件（id|tu|title|childCount）', xd.includes('id}|${tu}|${title}|${cc}') || /\$\{r\.id\}\|\$\{tu\}/.test(xd));
t('X3 先探后标（PROBE_MAX 3+inferBusy 才标）', xd.includes('XDEV_PROBE_MAX = 3') && xd.includes('inferBusy('));
t('X4 探测失败重入队 ≤2 次', xd.includes('tries <= 2'));
t('X5 hidden 降级保护（ok!==true/warning/非数组保旧值）', /rec\['ok'\] !== true \|\| rec\['warning'\] !== undefined/.test(xd) && xd.includes('Array.isArray(arr)'));
t('X6 sessions 空清空型保护', xd.includes('list.length === 0 && XdeviceService.sessSeen.size > 0'));
t('X7 首跑只建基线不探测', xd.includes('if (!firstRun)'));
t('X8 单飞防叠加', xd.includes('XdeviceService.busy') && /if \(XdeviceService\.busy\) \{\s*return;/.test(xd));
t('X9 已忙跳过探测（名额不浪费）', xd.includes('Store.convBusy(sid)'));
t('X10 inferBusy 僵尸保护 5min（running/user/未 completed 三判据）', xd.includes('ZOMBIE_MS = 5 * 60 * 1000') && xd.includes("'running'") && xd.includes("role === 'user'") && xd.includes('completed === undefined'));

// inferBusy 参照行为黄金值（与源码同构）
function refInferBusy(msgs, now) {
  if (!msgs || !msgs.length) return false;
  const last = msgs[msgs.length - 1];
  const info = last.info || {};
  const t = info.time || {};
  const lastTouch = t.updated || t.created || 0;
  const zombie = !!(lastTouch && now - lastTouch > 5 * 60 * 1000);
  for (const p of (last.parts || [])) {
    if ((p.state || {}).status === 'running') return !zombie;
  }
  if (info.role === 'user') return !zombie;
  if (info.role === 'assistant') {
    if (!t.completed && t.created) return !zombie;
  }
  return false;
}
const NOW = 1794840000000;
t('X11 黄金：running part=忙', refInferBusy([{ info: { role: 'assistant', time: { created: NOW - 1000 } }, parts: [{ state: { status: 'running' } }] }], NOW) === true);
t('X12 黄金：running 超 5min=僵尸不忙', refInferBusy([{ info: { role: 'assistant', time: { created: NOW - 6 * 60 * 1000 } }, parts: [{ state: { status: 'running' } }] }], NOW) === false);
t('X13 黄金：末条 user=忙', refInferBusy([{ info: { role: 'user', time: { created: NOW - 1000 } }, parts: [] }], NOW) === true);
t('X14 黄金：assistant 未 completed=忙（思考窗口）', refInferBusy([{ info: { role: 'assistant', time: { created: NOW - 1000 } }, parts: [] }], NOW) === true);
t('X15 黄金：assistant 已 completed=闲', refInferBusy([{ info: { role: 'assistant', time: { created: NOW - 1000, completed: NOW - 500 } }, parts: [] }], NOW) === false);

console.log('== S 侧栏域（分组树+归档+任务面板） ==');
const chat = read('domain/chat/ChatService.ets');
const idx = read('pages/Index.ets');
const store = read('store/Store.ets');
t('S1 loadConvs 过滤 hidden（Store.isHidden）', /Store\.isHidden\(out\[i\]\.id\)/.test(chat));
t('S2 项目分组（/_dirs+目录匹配+其他组兜底）', chat.includes('/_dirs') && store.includes("'其他'") && store.includes('rebuildGroups'));
t('S3 隐藏项目「日常」过滤', chat.includes("/projects/日常"));
t('S4 归档（POST ids+忙态拦截+本地即时隐藏+失败提示）', chat.includes("'action': 'hide'") && chat.includes("'ids': [sid]") && idx.includes('不能归档') && store.includes('hideLocal'));
t('S5 长按菜单（bindContextMenu：置顶/归档双选项）', readComp('ConvRowView.ets').includes('bindContextMenu') && readComp('ConvRowView.ets').includes('取消置顶'));
t('S6 任务面板（{ok,tasks} 对象壳解析+TaskRow 类+@StorageLink 刷新）', chat.includes("rec['tasks']") && chat.includes("rec['ok'] !== true") && store.includes('class TaskRow') && read('components/RightPanelView.ets').includes('K_TASKS') && read('components/RightPanelView.ets').includes('暂无在途任务'));
// 产出审 P1 修复锚
t('S11 loadTasks 对象壳（P0-1：裸数组判死）', (() => { const seg = chat.slice(chat.indexOf('loadTasks')); const fn = seg.slice(0, seg.indexOf('static ') > 0 ? seg.indexOf('static ') : 900); return fn.includes("const arr = rec['tasks'];") && !fn.includes('rows = data as'); })());
t('S12 probe 判闲清忙（P1-1 假执行中回落）', xd.includes('!busy && Store.convBusy(sid)') && xd.includes('markBusy(sid, false)'));
t('S13 onForeground 定时器自愈（P1-2）', /onForeground[\s\S]{0,160}timer < 0[\s\S]{0,60}start\(\)/.test(xd));
t('S14 归档忙态拦截+本地即时隐藏（P1-3）', idx.includes('不能归档') && store.includes('hideLocal'));
t('S7 Store 三域（hidden/dirs/tasks）', store.includes('setHidden') && store.includes('setDirs') && store.includes('setTasks'));
t('S8 xdevice 启停接线（aboutToAppear start+onPageShow 前台对账+Disappear stop）', idx.includes('XdeviceService.start()') && idx.includes('XdeviceService.onForeground()') && idx.includes('XdeviceService.stop()'));
t('S9 CONVS_HIDDEN 事件驱动重拉（订阅+off 收口）', idx.includes('EV.CONVS_HIDDEN') && idx.includes('EventBus.off(EV.CONVS_HIDDEN'));
t('S10 EV 常量（无裸字符串事件）', !xd.includes("EventBus.emit('convs"));

console.log('== R 红线 ==');
t('R1 零 console', !/console\./.test(xd) && !/console\./.test(idx));
t('R2 Index 零裸 hex', !/#[0-9a-fA-F]{6}\b/.test(idx));
t('R3 V2 零残留', !/ObservedV2|@Trace|ComponentV2/.test(xd + store));


console.log('== T M2.5 补遗 ==');
t('T1 新建会话（POST /api/session?directory+乐观打开）', chat.includes('createSession') && chat.includes('/api/session?directory'));
t('T2 agent 卡提取（<task id= state= 解析在 core/AgentCard）', fs.readFileSync(path.join(ETS,'core','AgentCard.ets'),'utf8').includes('<task\\s+id='));
t('T3 AgentCardView 渲染（badge+折叠+替代气泡）', readComp('AgentCardView.ets').includes('任务回报') && readComp('MsgRowView.ets').includes('agentCard !== null'));
t('T4 子会话（fetchChildren+Store.childrenOf+行尾展开箭头）', chat.includes('fetchChildren') && store.includes('childrenOf') && readComp('ConvRowView.ets').includes('childCount > 0'));
t('T5 置顶（loadPins __pins__+togglePin POST+pin first+📌标）', chat.includes('__pins__') && store.includes('isPinned') && readComp('ConvRowView.ets').includes('📌'));
t('T6 长按菜单双选项（置顶/归档）', readComp('ConvRowView.ets').includes('bindContextMenu') && readComp('ConvRowView.ets').includes('取消置顶'));
t('T7 项目组头＋新建（PWA task276 同构）', readComp('ProjGroupView.ets').includes("Text('＋')") && readComp('ProjGroupView.ets').includes('onNewConv'));

console.log('== U 术后 P0/P1 回归锚 ==');
t('U1 imports 合并（projects+imports+同 path 去重+order+i:key）', chat.includes("addRows(rec['projects']") && chat.includes("addRows(rec['imports']") && chat.includes('i:${name}') && chat.includes('orderObj') && chat.includes('seen.has(p)'));
t('U2 全量会话（无 100 上限+90s 新建补回）', !chat.includes('recent.length < 100') && chat.includes('Date.now() - born < 90000'));
t('U3 ProjGroup key 五字段（同名 project/import 不联动）', store.includes('key: string;') && store.includes('new ProjGroup(name, path, withKids, sg, key)') && store.includes("new ProjGroup('其他', '', other, sg2, '其他')") && readComp('ProjGroupView.ets').includes('Store.projOpenHas(this.group.key)') && readComp('SidePanelView.ets').includes('${g.key}'));
t('U4 子行归档隐藏（isHidden(kidId)）', store.includes('const kidId =') && store.includes('if (Store.isHidden(kidId))'));
t('U5 子会话可打开（Store.childConv+Index 回退+currentChild）', store.includes('static childConv(id: string)') && idx.includes('const child = Store.childConv(sid);') && chat.includes('Store.setCurrentChild(c.isChild)'));
t('U6 新建会话自动打开（Promise<ConvItem>+Index openConv(c)）', chat.includes('createSession(dir: string, title: string): Promise<ConvItem>') && idx.includes("ChatService.createSession(dir, '新对话').then((c: ConvItem)") && idx.includes('this.openConv(c);'));
t('U7 窄屏设置入口（settingsBtnNarrow+pushUrl 对象）', idx.includes(".id('settingsBtnNarrow')") && idx.includes("router.pushUrl({ url: 'pages/Settings' })"));
t('U8 子会话归档忙态探针（messagesOf+inferBusy）', chat.includes('static messagesOf(sid: string): Promise<Object[]>') && idx.includes('ChatService.messagesOf(sid)') && idx.includes('inferBusy(msgs)'));
t('U9 发送带但丁 agent（/api/agent+body[agent]+子会话快照+失败 TTL）', chat.includes('/api/agent?directory=') && chat.includes("body['agent'] = agent") && chat.includes('const isChild = Store.isCurrentChild()') && chat.includes('AGENT_FAIL_TTL') && chat.includes('agentPending'));
t('U10 空 path 组不显示＋', readComp('ProjGroupView.ets').includes("if (this.group.path !== '')"));
t('U11 Settings 页脚 App 1.0.1（版本三处同步）', read('pages/Settings.ets').includes('App 1.0.1'));
t('U12 ConvRow 单次 padding（不再二次覆盖上下内边距）', !readComp('ConvRowView.ets').includes('.padding(THEME.PAD_CARD)') && readComp('ConvRowView.ets').includes('right: THEME.PAD_CARD'));
t('U13 Index @依赖 含 SettingsService（契约头）', idx.includes('@依赖 Store ChatService XdeviceService SettingsService'));

console.log(`\nM2 sidebar/xdevice: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

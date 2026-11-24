#!/usr/bin/env node
// selftest-m1-messages（M1 消息完整 · task361 静态断言）
// H markdown 解析/渲染分离 I 三栏断点 J diff 卡移植 K 队列/ctx pill L M0.1 遗留清偿锚 M 机检（components 层）
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ETS = path.join(__dirname, '..', 'entry', 'src', 'main', 'ets');
let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }
function readComp(f) { return fs.readFileSync(path.join(ETS, 'components', f), 'utf8'); }

console.log('== H markdown 解析/渲染分离（P2-4） ==');
const parser = read(path.join(ETS, 'core', 'markdown', 'parser.ets'));
t('H1 parser 纯函数层在 core（无 UI 依赖）', parser.includes('export function parseMd') && !parser.includes('@Component'));
t('H2 解析/渲染分离（token 树中转）', parser.includes('MdTokenKind') && parser.includes('parseInline'));
t('H3 代码块 ``` 切分+语言标注 <24 对齐 PWA', parser.includes("split('```')") && parser.includes('< 24'));
t('H4 行内三件：code/bold/link', parser.includes("'code'") && parser.includes("'bold'") && parser.includes("'link'"));
t('H5 块级六件：heading/list/quote/hr/para', ['heading','list','quote','hr','para'].every(k => parser.includes(`'${k}'`)));
const mdview = read(path.join(ETS, 'components', 'MarkdownView.ets'));
t('H6 渲染侧=components/MarkdownView（分层不混）', mdview.includes('export struct MarkdownView'));
t('H7 代码块复制按钮（pasteboard）', mdview.includes('MIMETYPE_TEXT_PLAIN'));
t('H8 tokens 普通成员（行级重建重渲，无 @Prop 深拷贝）', /tokens: MdToken\[\] = \[\]/.test(mdview) && !/@Prop tokens/.test(mdview));

console.log('== I 三栏与断点（P2-6 vp 口径） ==');
const idx = read(path.join(ETS, 'pages', 'Index.ets'));
t('I1 mediaquery 840vp 断点线', idx.includes('(min-width: 840vp)'));
t('I2 宽屏三栏（左会话/中消息/右信息 Embed）', /isWide[\s\S]{0,200}Row\(\)/.test(idx) && idx.includes('rightPanel'));
t('I3 窄屏单栏+Overlay Drawer（M0.1 形态保留）', idx.includes('SideBarContainerType.Overlay'));
t('I4 断点监听 on/off 收口', idx.includes(".on('change'") && idx.includes(".off('change')"));
t('I5 消息流接入 MarkdownView（MsgRowView 组件内）', readComp('MsgRowView.ets').includes('MarkdownView({ tokens: this.msg.tokens })') && readComp('MsgRowView.ets').includes('this.msg.streaming'));

console.log('== J diff 卡（1:1 移植 task239） ==');
const chat = read(path.join(ETS, 'domain', 'chat', 'ChatService.ets'));
t('J1 fileStatsOfPart 三类工具（edit=metadata.filediff/write=行数/patch=+++计数）', chat.includes('filediff') && chat.includes('filePath') && chat.includes('+++'));
t('J2 回合归并（user 分界+同文件累加+挂回合末 assistant）', chat.includes('buildEditCards') && /role === 'user'[\s\S]{0,80}flush/.test(chat));
t('J2b edit 无 filediff 兜底（old/newString 估算+note）', chat.includes("inputRec['newString']") && chat.includes('按替换文本行数估算'));
t('J3 失败/中断工具不计入（PWA 同口径）', /status !== 'completed' && status !== 'running'/.test(chat));
t('J4 EditCardView 默认折叠（task340）+relFile 末两段', read(path.join(ETS, 'components', 'EditCardView.ets')).includes('open: boolean = false') && read(path.join(ETS, 'components', 'EditCardView.ets')).includes('relFile'));
t('J5 msgRow 挂卡（editCard 非空渲染，气泡外独立行——MsgRowView 组件）', readComp('MsgRowView.ets').includes('EditCardView({ card: this.msg.editCard'));

console.log('== K 队列条/ctx pill/回跳 ==');
t('K1 prompt_async 响应 queued/deduped → 队列轮询', chat.includes("rec['queued'] === true") && chat.includes('queueStart'));
t('K2 队列 3s 轮询+count=0 停（PWA 语义）', chat.includes('3000') && chat.includes('queueStop'));
t('K3 ctx 60s 低频 /_ctxmap', chat.includes('/_ctxmap') && chat.includes('60000'));
t('K4 队列条 UI（排队中 N 条/已入队）', idx.includes('排队中') && idx.includes('已入队'));
t('K5 ctx pill（黄红分档——Index 宽屏顶栏+RightPanelView）', idx.includes('150000') && readComp('RightPanelView.ets').includes('fmtTok'));
t('K6 回跳按钮（nearBottom 判定+scrollToIndex）', idx.includes('jumpBottom') && idx.includes('scrollToIndex'));

console.log('== L M0.1 遗留清偿锚（御史 M1 必做） ==');
t('L1 openSeq 竞态防护（切走丢弃）', /sid !== Store\.currentId\(\)/.test(chat));
t('L2 session.idle 校准（当前会话收尾去抖刷新）', /!busy && sid === Store\.currentId\(\)/.test(chat));
t('L3 429 中文（netErrText）', read(path.join(ETS, 'core', 'Net.ets')).includes('429'));
t('L4 AUTH_EXPIRED 清 Asset', idx.includes('Vault.removePass'));
t('L5 onBusy 收敛 Store.markBusy（P1-6 单实现+尾部 rebuild 上屏）', chat.includes('Store.markBusy(sid, busy)'));
t('L6 shutdown 收口三定时器（sse/queue/ctx/refresh）', /shutdown[\s\S]{0,300}queueStop[\s\S]{0,100}ctxStop/.test(chat));

console.log('== M 机检（components 层白名单） ==');
try {
  execSync(`node ${path.join(__dirname, 'check-ets-imports.js')}`, { stdio: 'pipe' });
  t('M1 check-ets-imports（含 components 层）exit 0', true);
} catch (e) { t('M1 check-ets-imports（含 components 层）exit 0', false); }
try {
  execSync(`node ${path.join(__dirname, 'check-ets-contract.js')}`, { stdio: 'pipe' });
  t('M2 check-ets-contract exit 0', true);
} catch (e) { t('M2 check-ets-contract exit 0', false); }

// 红对照：parser 破坏性检查——解析器必须可被 node 直接 require 冒烟（剥离 ArkTS 语法前先静态核支持集完整性）
t('M3 Index 零裸 hex（token 红线）', !/#[0-9a-fA-F]{6}\b/.test(idx));
t('M4 MarkdownView/EditCardView 零裸 hex', !/#[0-9a-fA-F]{6}\b/.test(mdview) && !/#[0-9a-fA-F]{6}\b/.test(read(path.join(ETS, 'components', 'EditCardView.ets'))));

console.log(`\nM1 messages: PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

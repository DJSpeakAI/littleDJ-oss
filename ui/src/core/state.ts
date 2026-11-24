/* @module state @order 4 @职责 全局状态 S + 弹出模式常量 @提供 BUTLER_AGENT POP_TABS POP_PROV POP_TAB POP_LONG_MS POP_DRAG_PX popSuppressClick popHintEl popDown S popoutParseQ @依赖 - @依赖运行期 - @DOM契约 - @严格模式 是 @全局占用 BUTLER_AGENT POP_TABS POP_PROV POP_TAB POP_LONG_MS POP_DRAG_PX popSuppressClick popHintEl popDown S popoutParseQ @源行 ui/index.html L1429-L1520 @测试锚点 - @被调用 - */
'use strict';
var BUTLER_AGENT = 'butler'; // 主会话固定大管家：只派单，不执行
/* task206：大屏弹出模式（?popout=页签）——右栏页签长按/拖出或比价工具栏 ⤢ 打开独立大屏窗口。
   POP_TABS=可弹出白名单（task215 起 pricing+apikey 两页签；后续加页签只加键）；
   popoutParseQ 白名单内置——空串/未知页签一律返回 ''（10 套 vm 自测以 location.search:'' 桩加载本文件，必须 falsy） */
var POP_TABS = { pricing: 1, apikey: 1 };
var POP_PROV = ''; /* task215：apikey 页签的供应商参数（ds/zp；oa 已随 task228 退役；task328 加 volc），由 popoutParseQ 解析；须先声明（vm 桩/严格模式兜底）；task229 起无 prov=供应商列表页 */
function popoutParseQ(search: string): string{
  var m = /[?&]popout=([a-z]+)(?:&prov=(ds|zp|volc))?/.exec(search || '');
  if (!m || !POP_TABS[m[1]]) return '';
  POP_PROV = m[2] || '';
  return m[1];
}
var POP_TAB = (typeof location !== 'undefined') ? popoutParseQ(location.search) : '';
var POP_LONG_MS = 550, POP_DRAG_PX = 18; /* 长按时长 / 拖出位移阈值 */
var popSuppressClick = false, popHintEl = null, popDown = null;
var S: any = {
  imports: [], projects: [], root: '',
  sessions: [], models: [], current: null,
  model: { providerID: 'deepseek', modelID: 'deepseek-flash' },
  busy: false, busyBy: {}, view: 'projects', tab: 'tasks', filePath: '', fsBase: { scope: 'project', path: '' }, homePlaces: null, homeRoot: '', homePlacesPending: false,
  /* task124 纪元证人（页面级内存，刷新归零=证人退化为 stale/noop，安全）：
     lastBusyEpoch=最后读到的后端忙纪元（证人携带）；idleSeenAt=本页亲见 run 级 idle 时刻（记录用）；
     idleEpoch=本页亲见 idle 时快照的忙纪元（矛盾态主判据——同代=proxy 漏收该代 idle，纯纪元比较不涉跨进程时钟）；
     busyReady=本会话忙闲首帧已定（inferBusy 落地或 SSE 事件到达，防首帧闪按钮） */
  lastBusyEpoch: {}, idleSeenAt: {}, idleEpoch: {}, busyReady: {}, busyEvAt: {}, /* task307：busyEvAt=各会话最近一次 SSE 事件时刻（对账轮询的新鲜度闸） */
  atts: [], files: [], pendingQ: null, lastAct: 0, warned: false, projOpen: {}, order: [], scrollPos: {}, lastMsgs: [], balance: '',
  /* task189：会话行上下文百分比（数据源 /_ctxmap，60s 拉一次；sig=内容指纹，变化才 ver++ 触发重绘） */
  ctxMap: { map: {}, ver: 0, sig: '' },
  /* task168/172：聚焦视图「非当前项目」展开态（task172 起持久化 localStorage `littledj.focusProjOpen`）——与持久 projOpen 解耦：
     projOpen 长年被 openSession / 无视觉反馈的标题点击污染（点击当前项目标题恒精简展开、状态却被翻转持久化），
     切到别的项目会话时读残留 projOpen=true → 旧项目全量刷屏（主人 2026-11-10 图1 报障）。
     task172：切会话不再清空——刚离开的项目标 true 保持展开（主人定「我让它折叠才折叠」）；
     展开内容=今天的会话（task171）；点非当前项目标题手动翻转并落盘 */
  focusProjOpen: {},
  /* task152：lastMsgs 的来源会话 id——切会话瞬间 lastMsgs 仍是上一个会话的，live 任务行按此归属，
     绝不按 S.current 归属（否则新会话凭空长出「三角 + 别人的御史任务行」，主人 2026-11-09 报） */
  _lastMsgsSid: '',
  /* task312：会话切换秒开（stale-while-revalidate）——msgCache=sessionId→{msgs,at} 页面级内存缓存（LRU 15）；
     _msgsComplete=lastMsgs 是否为服务端完整快照（发消息/SSE 新增条目置 false，离场只缓存完整快照）；
     _openSeq=openSession 序号，防旧校准响应覆盖新会话。 */
  msgCache: {}, _msgsComplete: true, _openSeq: 0,
  pending: {}, agentCaps: {}, multiSel: { on: false, ids: {}, busy: false },
  /* task54 B：会话树内存态（不落 localStorage）。convOpen=展开态；children=懒加载缓存(pid→子会话[])；
     childParent=子→父反查(供 SSE 定向失效)；childrenLoading/childrenErr=并发与错误兜底 */
  convOpen: {}, children: {}, childParent: {}, childrenLoading: {}, childrenErr: {}, childrenDirty: {},
  /* task56：会话软删除（hidden 只改列表可见性，数据一条不删）。
     hidden：id→1 映射（服务端 config/hidden-sessions.json 的镜像）；
     treeRootId=本次渲染解析出的当前根；_treeOpenedFor=已自动展开到哪个 current（尊重主人手动折叠）
     task143：视图模式（只看当前/显示全部）已删，恒为「只看当前对话树」+ 搜索态 */
  hidden: {}, treeRootId: '', _treeOpenedFor: '',
  /* task71 S2a：休息态（服务端 /_rest 为唯一真相；unknown=接口不可用，不在本地臆造开关） */
  rest: { on: false, since: null, unknown: false },
  chain: { mode: 'full', since: null, unknown: false }, /* task137：链路模式 direct/flat/full，服务端 /_chain 唯一真相 */
  answer: { mode: 'task', since: null, unknown: false }, /* task395：回答/任务模式 answer/task，服务端 /_answer 唯一真相；默认 task（主人 2026-11-23 拍板） */
  convOrder: {}, /* task141：会话手动排序 {项目key:[会话id...]}，/_conv-order 唯一真相 */
  sortProj: null, /* task141：当前正在调整顺序的项目 key；null=未进入排序模式 */
  _lastConvOrder: {}, /* task141：最近一次渲染出的项目内会话顺序（moveConv 的基准） */
  /* task77→task394（主人 2026-11-23）：划词引用=数组逐条累积（最多 8 条，互不覆盖）；null = 无引用，显示态由 #quoteRow 的 hidden 承担 */
  quote: null,
  /* task80 S2b：队列条展开态（内存态，刷新回折叠；队列真相源在 proxy） */
  queueOpen: false,
  /* task134：在途回合被 serve 重启杀死的纪元登记（sid->时间戳；/_queue 回执 turnInterrupt 出现新纪元
     → toast「被打断，请重发」；归零不误报——检测放 queueRender 的空队列 early-return 之前，防打断场景恰好队列空而漏报） */
  lastTurnKilled: {},
  /* task89：role=user 的 messageID 登记表（id→true）；用户消息只显示本地乐观气泡，防止 applyPart/applyDelta 为其伪造 assistant 节点 */
  userMids: {},
  /* task96 S5b：一键交接的草稿暂存（{text, atts}）；只在确认后写入，建会话成功回填后置 null */
  _draftCarry: null,
  /* task106：活跃大管家会话指针（localStorage 同键镜像；多标签 last-write-wins）。
     任务行显示归属只读该指针 + 规则重算，不改台账 u.lid/u.sid */
  activeButlerSid: '',
  /* task128：左栏 TUI/大管家分区折叠态（localStorage 持久化；TUI 默认展开、大管家默认折叠） */
  tuiSectOpen: true,
  /* task390（主人 2026-11-22）：左栏「归档会话列表」分区折叠态（localStorage 持久化；默认展开=默认显示最近 10 条） */
  archiveSectOpen: true,
  /* task390：hidden 的服务端顺序镜像（尾部=最近归档；S.hidden 仍是 id→1 映射）。
     ★初值必须在：loadConvOrder / SSE / 任务轮询等都可能先于 loadHiddenSessions 触发 renderSidebar（方案审 P0-1） */
  hiddenOrder: [] as string[],
  /* task391（主人 2026-11-22）：按会话隔离的输入草稿槽 {sid:{text,atts,files,at}}——切走存、切回取，
     一个对话框记自己的输入内容（纯内存不落盘；上限 40 槽/附件仅保最近 6 槽，见 send.ts draftTrim）。
     ★初值必须在：boot 首开 openSession 就会读（方案审 v2 P1-1 写死） */
  drafts: {},
  /* task390（产出审 P1-1）：刚恢复、但左栏 focus 视图不一定可见的会话（内存态，刷新即清）——
     归档区显示「已恢复 · 打开」临时行，给历史会话一个可达入口（打开需二次点击，不自动切会话） */
  archiveRestored: [] as any[],
  /* task390：恢复在途防抖（id→1；双击/连点只发一次 POST） */
  _restoring: {} as { [k: string]: number },
  _autoHandoffDoneFor: '',
  /* task106 P1-1：红档源会话快照（纯内存）；收口 idle 后按它重试闸门，避免切走后误读 S.ctxPct */
  _ctxDangerSid: '',
  _ctxDangerPct: 0,
  /* task111 R1：!isCur 场景先切回源会话再进内核的异步窗口防重入（''=空闲；超时过期，防 refreshCurrent 中途切走早退不回调导致死锁） */
  _autoHandoffPending: '',
  _autoHandoffPendingAt: 0,
  /* task376：自动交接注销的源会话登记（sid→退役时刻）；非空即「该会话已被交接冻结」，主人切回发消息时自动解冻 */
  _retiredSids: {}
};
/* task172：聚焦视图非当前项目展开态持久化——主人定「我让它折叠才折叠」，跨刷新稳定 */
/* task106：活跃大管家会话指针（仅显式写入；loadSessions() 负责校验/清理，不在此处回落覆盖） */
/* task128：分区折叠态持久化（'0'=折叠 '1'=展开；读不到/异常回默认值） */
/* task138：派单任务行默认隐藏（主人 2026-11-09 定：左栏大管家节点下不显示内部派单台账，只在主动打开时可见） */
/* task164：S.showTaskRows 与「任务行」开关已整体退役（task143 删开关、task164 删渲染层），不再读 localStorage */


window.BUTLER_AGENT=BUTLER_AGENT; window.POP_TABS=POP_TABS; window.POP_PROV=POP_PROV; window.POP_TAB=POP_TAB; window.POP_LONG_MS=POP_LONG_MS; window.POP_DRAG_PX=POP_DRAG_PX; window.popSuppressClick=popSuppressClick; window.popHintEl=popHintEl; window.popDown=popDown; window.S=S; window.popoutParseQ=popoutParseQ;

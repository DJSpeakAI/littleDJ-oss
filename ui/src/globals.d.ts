export {};
declare global {
  /* 浏览器新 API 字段补充（lib.dom 未跟上；接口合并，零产物影响） */
  interface DisplayMediaStreamOptions { selfBrowserSurface?: boolean | string; preferCurrentTab?: boolean; surfaceSwitching?: string; monitorTypeSurfaces?: string; }
  interface Window {
    webkitAudioContext: any;
    webkitOfflineAudioContext: any;
    /* ---- core/dom + core/esc（M1a/M1b）---- */
    $: (s: string) => any /* @ts-todo $ 返回 any：调用点 DOM 精确属性各异（如 #input.placeholder），待后续泛型化 */;
    $$: (s: string) => any[];
    el: (tag: string, cls?: string, text?: string) => any;
    esc: (s: unknown) => string;
    /* ---- app/markdown（M1b）---- */
    md: (src: unknown) => string;
    mdInline: (seg: string) => string;
    inline: (s: string) => string;
    /* ---- core/state（M1b）---- */
    BUTLER_AGENT: string;
    POP_TABS: Record<string, number>;
    POP_PROV: string;
    POP_TAB: string;
    POP_LONG_MS: number;
    POP_DRAG_PX: number;
    popSuppressClick: boolean;
    popHintEl: HTMLElement | null;
    popDown: unknown;
    S: any /* @ts-todo state.ts 的 var S 推断类型复杂，渐进细化 */;
    popoutParseQ: (search: string) => string;
    /* ---- core/mobile（M1b）---- */
    _panelHist: boolean;
    _vvhTimer: number | null;
    isMobile: () => boolean;
    syncInputPh: () => void;
    syncPanelMask: () => void;
    pushPanelHist: () => void;
    closePanels: (back?: boolean) => void;
    bindItemMenu: (node: HTMLElement, show: (x: number, y: number) => void) => void;
    syncViewport: () => void;
    api: (p: string, opt?: { method?: string; body?: unknown }) => Promise<any>;
    fmtTime: (ms: number | string) => string;
    fmtHM: (v: number | string) => string;
    baseName: (p: string | null | undefined) => string;
    findProject: (name: string) => string | null;
    defaultProjectName: () => string;
    projConvs: (path: string, name: string) => any[] /* @ts-todo 会话对象类型待 chat 域迁移细化 */;
    saveProjOpen: () => void;
    saveFocusProjOpen: () => void;
    projOpenKeyForDir: (dir: string) => string;
    toggleProjOpen: (key: string) => void;
    /* ---- core/rest-chain（M1b）---- */
    CHAIN_META: { [k: string]: { icon: string; label: string; tip: string } };
    loadRest: () => Promise<void>;
    setRest: (on: boolean) => Promise<void>;
    renderRest: () => void;
    chainMeta: () => { icon: string; label: string; tip: string };
    loadChain: () => Promise<void>;
    setChain: (mode: string) => Promise<void>;
    renderChain: () => void;
    openChainMenu: () => void;
    closeChainMenu: () => void;
    renderTitle: () => void;
    /* ---- sidebar 域（M2：data/render/rows/children/actions）----
       118 个成员粗粒度 any（@ts-todo：M2 批量挂载，后续按域细化；清单由模块头 @全局占用 生成） */
    _localNewSids: any; _aliasMap: any; _aliasSynced: any; loadProjects: any; loadSessions: any;
    loadHiddenSessions: any; _hiddenRes: any; hideSessions: any; restoreSessions: any; hiddenOrderAdd: any; hiddenOrderRemove: any; getModelAliases: any;
    modelKey: any; aliasOf: any; labelModel: any; visibleModelsForPick: any; rolePickModel: any;
    refreshModelOptions: any; setModelPlaceholder: any; loadModelsWithRetry: any; loadModels: any; syncModelLabel: any;
    setModelAliases: any; aliasMerge: any; syncModelAliasBoot: any; aliasPostVerified: any; aliasSynced: any;
    HIDDEN_PROJECT_PATHS: any; _dragKey: any; _dragConv: any; _sbTimer: any; _sbLastAt: any;
    _sbPending: any; _dragAt: any; _sbLiveRunner: any; _waitDesc: any; S_ENDED: any;
    CHILD_STALE_MS: any; _focusRendered: any; _navSig: any; _normProjPath: any; _projRowHidden: any;
    projectEntries: any; clearDropMarks: any; persistProjectOrder: any; moveProjectTo: any; bindProjDrag: any;
    dragGuardActive: any; dragReleaseRender: any; navSidebarSig: any; scheduleSidebar: any;
    CONV_ICON_ARCHIVE: any; CONV_ICON_PIN: any; CONV_ICON_PIN_ON: any; CONV_ICON_DOTS: any; CONV_ICON_FORK: any;
    CONV_ICON_PLUS: any; PROJ_ICO_SVG: any; HIDE_GROUP_TITLES: any; isHiddenId: any; sessInProj: any;
    findSessionAnywhere: any; resolveCurrentRoot: any; ensureCurrentTreeOpen: any; _pollSids: any; computePollSids: any;
    buildSidebarCtx: any; renderSidebar: any; renderFocusFallback: any; sectFoldHead: any; renderTuiSection: any;
    convSpinEl: any; buildConvRow: any; isTodayTs: any; todayButlerConv: any; renderProjRow: any;
    CHILD_ROLE_LABEL: any; CHILD_ROLE_CLASS: any; CHILD_TITLE_SUFFIX_RE: any; AGENT_ROLE_WHITELIST: any; LEAF_CHILD_ROLE_EXACT: any;
    childRoleLabel: any; childRoleClass: any; childRoleKey: any; childMismatchAgent: any; isLeafChildRole: any;
    childTitleText: any; computeWaitDesc: any; childStatusInfo: any; fetchChildren: any; toggleConvOpen: any;
    bindConvDrag: any; convSortKeyOf: any; convPins: any; isPinnedConv: any; togglePinConv: any;
    dragConvTo: any; enterSortMode: any; moveConv: any; exitSortMode: any; appendChildRows: any;
    appendChildRow: any; enterMultiSel: any; exitMultiSel: any; selAllLabel: any; renderMultiSelBar: any;
    updateMultiSelBar: any; forkSession: any; showCtxMenu: any; showProjectMenu: any; refreshProjectsView: any;
    deleteProject: any; askRenameProject: any; askRenameSession: any; archiveNoAsk: any; deleteSession: any;
    clearCurrentAfterRemove: any; restoreSession: any; markActiveButler: any; activeButlerSid: any; dedupeTaskTitle: any;
  }
  /* ---- 运行期依赖（定义在未迁移 .js 模块，tsc 视野外；对应模块迁移时逐条回收）---- */
  declare var VOICE: any /* @ts-todo voice 域（M5）迁移时细化并回收本行 */;
  declare var _selfBackAt: number;
  declare var _backTransAt: number;
  declare var _exitUntil: number;
  /* M3 迁移后已回收（模块顶层声明接管）：toast/dedupeTaskTitle/newTask/exitSortMode/hideCtxMenu/renderSidebar/scheduleSidebar/_projRowHidden */
  /* ---- M2 运行期依赖（tsc 驱动补全；对应模块迁移时回收）---- */
  declare var TASKS: any;
  declare var _flashProj: any;
  declare var ROLES: any;
  declare var _stBusy: any;
  /* data.ts 经 window.xxx= 挂载（无顶层声明）的函数，供裸调用 */
  declare function aliasSynced(): boolean;
  declare var _agentSoundAt: any;
  declare var _lastIdleAt: any;
  declare var _picker: any;
  declare var _pwaAgentAt: any;
  declare var seenTaskIds: any;
  /* ---- M4 运行期依赖（tsc 驱动；对应模块迁移时回收）---- */
  /* ---- M3 段---- */
  declare var renderImgs: any;
  declare var Q_HEAD: any;
  declare var Q_TAIL: any;
  declare var Q_SEND_AT: any;
  declare var Q_SEND_TXT: any;
  declare var BOARD: any;
}

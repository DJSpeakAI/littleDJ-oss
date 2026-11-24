// @提供 ConvItem MsgItem EditCard FileStatItem MsgDataSource Store（AppStorage 写入唯一出口，按域分组 key lj.*） @依赖 parser AgentCard AgentCard
// M0.1 task361：全 V1 体系（@Observed；禁 V2 混用）；IDataSource/DataChangeListener 为 ArkUI 环境类型无需 import
// M1：MsgItem 升级 tokens/editCard；parser 属 core 纯函数层（P2-4 解析侧）
import { MdToken } from '../core/markdown/parser';
import { AgentCardData } from '../core/AgentCard';

/** 会话行模型（/​_sessions 元数据最小集） */
@Observed
export class ConvItem {
  id: string;
  title: string;
  directory: string;
  pwa: number;
  updatedAt: number;
  busy: boolean;
  childCount: number; // M2.5 子会话数（>0 行尾展开箭头）
  isChild: boolean; // M2.5 子会话行（缩进渲染，来自 childrenMap 展开）
  constructor(id: string, title: string, directory: string, pwa: number, updatedAt: number, busy: boolean, childCount: number, isChild: boolean) {
    this.id = id;
    this.title = title;
    this.directory = directory;
    this.pwa = pwa;
    this.updatedAt = updatedAt;
    this.busy = busy;
    this.childCount = childCount;
    this.isChild = isChild;
  }
}

/** diff 卡文件行（对齐 PWA fileStatsOfPart 产物） */
@Observed
export class FileStatItem {
  file: string;
  adds: number;
  dels: number;
  note: string;
  constructor(file: string, adds: number, dels: number, note: string) {
    this.file = file;
    this.adds = adds;
    this.dels = dels;
    this.note = note;
  }
}

/** 回合 diff 汇总卡（对齐 PWA buildEditCards：▤ 已编辑 N 文件 +X −Y，默认折叠 task340） */
@Observed
export class EditCard {
  files: FileStatItem[];
  adds: number;
  dels: number;
  open: boolean;
  constructor(files: FileStatItem[], adds: number, dels: number) {
    this.files = files;
    this.adds = adds;
    this.dels = dels;
    this.open = false;
  }
}

/** 消息条目模型（List+LazyForEach+@Observed，P2-3；M1：tokens/editCard 升级——流式纯文本，收尾 md 渲染） */
@Observed
export class MsgItem {
  id: string;
  role: string;      // user | assistant
  text: string;      // 纯文本（流式期显示 + md 源）
  streaming: boolean;
  tokens: MdToken[] | null; // 收尾后 md 解析（null=未解析/流式中）
  agentCard: AgentCardData | null; // M2.5 任务回报卡（<task 注入）
  imgUrl: string; // M4.5 首附件图 dataURL（缩略+点击全屏）
  editCard: EditCard | null; // 本回合尾 diff 卡（仅回合末 assistant）
  constructor(id: string, role: string, text: string, streaming: boolean) {
    this.id = id;
    this.role = role;
    this.text = text;
    this.streaming = streaming;
    this.tokens = null;
    this.editCard = null;
    this.agentCard = null;
    this.imgUrl = '';
  }
}

/** LazyForEach 数据源（IDataSource；listener 通知按需刷新） */
export class MsgDataSource implements IDataSource {
  private items: MsgItem[] = [];
  private listeners: DataChangeListener[] = [];

  totalCount(): number {
    return this.items.length;
  }

  getData(index: number): MsgItem {
    return this.items[index];
  }

  registerDataChangeListener(listener: DataChangeListener): void {
    if (this.listeners.indexOf(listener) < 0) {
      this.listeners.push(listener);
    }
  }

  unregisterDataChangeListener(listener: DataChangeListener): void {
    const i = this.listeners.indexOf(listener);
    if (i >= 0) {
      this.listeners.splice(i, 1);
    }
  }

  /** 整表替换（打开会话/对账） */
  reload(list: MsgItem[]): void {
    this.items = list;
    this.listeners.forEach((l: DataChangeListener) => {
      l.onDataReloaded();
    });
  }

  /** 尾部追加（新消息气泡） */
  push(item: MsgItem): void {
    this.items.push(item);
    this.listeners.forEach((l: DataChangeListener) => {
      l.onDataAdd(this.items.length - 1);
    });
  }

  /** 按 id 找下标（-1 无） */
  indexOf(id: string): number {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) {
        return i;
      }
    }
    return -1;
  }

  /** 追加流式文本（delta 累加；@Observed 字段赋值触发行内刷新） */
  appendText(id: string, delta: string): void {
    const i = this.indexOf(id);
    if (i >= 0) {
      this.items[i].text += delta;
      this.listeners.forEach((l: DataChangeListener) => {
        l.onDataChange(i);
      });
    }
  }

  /** 标记流式结束 */
  finish(id: string): void {
    const i = this.indexOf(id);
    if (i >= 0) {
      this.items[i].streaming = false;
      this.listeners.forEach((l: DataChangeListener) => {
        l.onDataChange(i);
      });
    }
  }

  /** 全部收尾（切换会话/对账前） */
  finishAll(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.items[i].streaming = false;
    }
    this.listeners.forEach((l: DataChangeListener) => {
      l.onDataReloaded();
    });
  }
}

/** Store：跨页共享态唯一出口（AppStorage；域 key：lj.auth / lj.net / lj.sessions / lj.chat） */
/** 侧栏项目分组行（M2：@Builder 参数禁数组/嵌套泛型逗号——类实例承载） */
export class ProjGroup {
  name: string;
  path: string;
  list: ConvItem[];
  sig: string; // P1-2：组内容签名（id:title:busy:updatedAt 顺序 join——ForEach key 驱动行级刷新）
  key: string;
  constructor(name: string, path: string, list: ConvItem[], sig: string, key: string) {
    this.name = name;
    this.path = path;
    this.list = list;
    this.sig = sig;
    this.key = key;
  }
}

/** 模型选择行（M3 设置域） */
export class ModelItem {
  providerID: string;
  modelID: string;
  name: string;
  pname: string;
  constructor(providerID: string, modelID: string, name: string, pname: string) {
    this.providerID = providerID;
    this.modelID = modelID;
    this.name = name;
    this.pname = pname;
  }
}

/** APIKey 卡行（M3 设置域） */
export class KeyCard {
  name: string;
  masked: string;
  active: boolean;
  constructor(name: string, masked: string, active: boolean) {
    this.name = name;
    this.masked = masked;
    this.active = active;
  }
}

/** 比价行（M5 设置域） */
export class PriceRow {
  provider: string;
  name: string;
  contextText: string;
  inputHit: string;
  inputMiss: string;
  output: string;
  constructor(provider: string, name: string, contextText: string, inputHit: string, inputMiss: string, output: string) {
    this.provider = provider;
    this.name = name;
    this.contextText = contextText;
    this.inputHit = inputHit;
    this.inputMiss = inputMiss;
    this.output = output;
  }
}

/** 任务面板行（M2：具名类替代 Record 索引访问——L-126 家族防复发） */
export class TaskRow {
  id: string;
  title: string;
  state: string;
  constructor(id: string, title: string, state: string) {
    this.id = id;
    this.title = title;
    this.state = state;
  }
}

/** 侧栏分组行（M2：@Builder 禁数组参数/索引访问——分组模型具名类化） */
export class Store {
  static readonly K_AUTH: string = 'lj.auth.ok';
  static readonly K_CURRENT: string = 'lj.chat.currentId';
  static readonly K_DIR: string = 'lj.chat.dir';
  static readonly K_SSE: string = 'lj.net.sseState';
  static readonly K_MSGS: string = 'lj.chat.msgDs';
  static readonly K_CONVS: string = 'lj.sessions.list';
  static readonly K_QUEUE: string = 'lj.chat.queueCount';
  static readonly K_CTX: string = 'lj.chat.ctxUsed';
  static readonly K_HIDDEN: string = 'lj.sessions.hidden';
  static readonly K_DIRS: string = 'lj.sessions.dirs';
  static readonly K_TASKS: string = 'lj.sessions.tasks';
  static readonly K_PROJ_OPEN: string = 'lj.sessions.projOpenCount';
  static readonly K_GROUPS: string = 'lj.sessions.groups';
  static readonly K_CHILDREN: string = 'lj.sessions.childrenCount';
  static readonly K_CONV_OPEN: string = 'lj.sessions.convOpenCount';
  static readonly K_MODELS: string = 'lj.settings.models';
  static readonly K_KEYS: string = 'lj.settings.keys';
  static readonly K_MODEL_CUR: string = 'lj.settings.modelCur';
  static readonly K_PRICES: string = 'lj.settings.prices';

  private static msgDs: MsgDataSource = new MsgDataSource();
  private static hiddenSet: Set<string> = new Set<string>();
  private static dirsList: Array<Record<string, Object>> = new Array<Record<string, Object>>();
  private static projOpenSet: Set<string> = new Set<string>();
  // 真源=AppStorage（K_GROUPS/K_TASKS 数组直连 ForEach）

  /** 侧栏分组重算（loadConvs 后调；M2：struct 内方法体禁空数组字面量/嵌套泛型——分组逻辑归 Store） */
  static rebuildGroups(): void {
    const dirs = Store.dirsList;
    const groups: Array<ProjGroup> = new Array<ProjGroup>();
    const convs = Store.convs();
    const matched: Set<string> = new Set<string>();
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const name = `${d['name']}`;
      const path = `${d['path']}`;
      const key = d['key'] !== undefined ? `${d['key']}` : name;
      const list: ConvItem[] = new Array<ConvItem>();
      for (let k = 0; k < convs.length; k++) {
        if (convs[k].directory === path) {
          list.push(convs[k]);
          matched.add(convs[k].id);
        }
      }
      if (list.length > 0) {
        // M2.5：置顶 pin first（显示层排序，对齐 PWA task200）
        const pinned: ConvItem[] = [];
        const normal: ConvItem[] = [];
        for (let p = 0; p < list.length; p++) {
          if (Store.isPinned(list[p].id)) { pinned.push(list[p]); } else { normal.push(list[p]); }
        }
        const sorted: ConvItem[] = pinned.concat(normal);
        // M2.5：展开父的子行内联（ForEach 数据源统一数组——childrenOf 方法调用零渲染实锤规避）
        const withKids: ConvItem[] = [];
        for (let q = 0; q < sorted.length; q++) {
          withKids.push(sorted[q]);
          if (Store.convOpenHas(sorted[q].id)) {
            const kids = Store.childrenOf(sorted[q].id);
            for (let kk = 0; kk < kids.length; kk++) {
              const kr = kids[kk] as Record<string, Object>;
              const kidId = `${kr['id']}`;
              if (Store.isHidden(kidId)) {
                continue;
              }
              withKids.push(new ConvItem(kidId, `${kr['title']}`, path, 0, 0, false, 0, true));
            }
          }
        }
        let sg = '';
        for (let z = 0; z < withKids.length; z++) {
          sg += `${withKids[z].id}:${withKids[z].title}:${withKids[z].busy ? 1 : 0}:${withKids[z].updatedAt};`;
        }
        groups.push(new ProjGroup(name, path, withKids, sg, key));
      }
    }
    const other: ConvItem[] = new Array<ConvItem>();
    for (let k = 0; k < convs.length; k++) {
      if (!matched.has(convs[k].id)) {
        other.push(convs[k]);
      }
    }
    if (other.length > 0) {
      let sg2 = '';
      for (let z = 0; z < other.length; z++) {
        sg2 += `${other[z].id}:${other[z].title}:${other[z].busy ? 1 : 0}:${other[z].updatedAt};`;
      }
      groups.push(new ProjGroup('其他', '', other, sg2, '其他'));
    }
    AppStorage.set(Store.K_GROUPS, groups);
  }

  /** 项目组展开态（@Builder 嵌套层禁 this，折叠态下沉 Store；M2） */
  static projToggle(key: string): void {
    if (Store.projOpenSet.has(key)) {
      Store.projOpenSet.delete(key);
    } else {
      Store.projOpenSet.add(key);
    }
    AppStorage.set(Store.K_PROJ_OPEN, Store.projOpenSet.size);
  }

  static projOpenHas(key: string): boolean {
    return Store.projOpenSet.has(key);
  }

  static init(): void {
    AppStorage.setOrCreate(Store.K_AUTH, false);
    AppStorage.setOrCreate(Store.K_CURRENT, '');
    AppStorage.setOrCreate(Store.K_DIR, '');
    AppStorage.setOrCreate(Store.K_SSE, 'idle');
    AppStorage.setOrCreate(Store.K_MSGS, Store.msgDs);
    AppStorage.setOrCreate(Store.K_CONVS, new Array<ConvItem>());
    AppStorage.setOrCreate(Store.K_QUEUE, 0);
    AppStorage.setOrCreate(Store.K_CTX, 0);
    AppStorage.setOrCreate(Store.K_HIDDEN, 0); // hidden 计数（真身 hiddenSet 私有，避免 AppStorage 存 Set 引用不刷新）
    AppStorage.setOrCreate(Store.K_DIRS, 0);
    AppStorage.setOrCreate(Store.K_TASKS, new Array<TaskRow>());
    AppStorage.setOrCreate(Store.K_PROJ_OPEN, 0);
    AppStorage.setOrCreate(Store.K_GROUPS, new Array<ProjGroup>());
    AppStorage.setOrCreate(Store.K_CHILDREN, 0);
    AppStorage.setOrCreate(Store.K_CONV_OPEN, 0);
    AppStorage.setOrCreate(Store.K_MODELS, new Array<ModelItem>());
    AppStorage.setOrCreate(Store.K_KEYS, new Array<KeyCard>());
    AppStorage.setOrCreate(Store.K_MODEL_CUR, '');
    AppStorage.setOrCreate(Store.K_PRICES, new Array<PriceRow>());
  }

  /** hidden（归档）清单：xdevice 对账写入；loadConvs 过滤用 */
  static setHidden(set: Set<string>): void {
    Store.hiddenSet = set;
    AppStorage.set(Store.K_HIDDEN, set.size);
  }

  static isHidden(id: string): boolean {
    return Store.hiddenSet.has(id);
  }

  /** 本地即时隐藏（归档成功不等 15s tick；产出审 P1-3） */
  static hideLocal(id: string): void {
    Store.hiddenSet.add(id);
    AppStorage.set(Store.K_HIDDEN, Store.hiddenSet.size);
  }

  /** 项目分组（/_dirs 过滤后；M2 侧栏树数据） */
  static setDirs(list: Array<Record<string, Object>>): void {
    Store.dirsList = list;
    Store.rebuildGroups(); // P1-7：冷启动 sessions 先回时分组落「其他」的竞态修正
  }

  /** 任务面板行（非 done 最近 30；M2 右栏） */
  static setTasks(list: Array<TaskRow>): void {
    AppStorage.set(Store.K_TASKS, list); // ForEach 直连数组（方法调用不建立观察——groups 同坑实锤）
  }


  static setPrices(list: Array<PriceRow>): void {
    AppStorage.set(Store.K_PRICES, list);
  }

  /** M3 设置域：模型/Key 卡（AppStorage 数组直连 ForEach） */
  static setModels(list: Array<ModelItem>): void {
    AppStorage.set(Store.K_MODELS, list);
  }
  static setKeys(list: Array<KeyCard>): void {
    AppStorage.set(Store.K_KEYS, list);
  }
  static setCurModel(m: ModelItem | null): void {
    AppStorage.set(Store.K_MODEL_CUR, m === null ? '' : `${m.pname} · ${m.name}`);
    Store.curModelRef = m;
  }
  static curModel(): ModelItem | null {
    return Store.curModelRef;
  }

  /** M2.5 置顶清单（__pins__；显示层 pin first） */
  private static pinsList: string[] = [];
  static setPins(list: string[]): void {
    Store.pinsList = list;
  }
  static pins(): string[] {
    return Store.pinsList;
  }
  static isPinned(id: string): boolean {
    return Store.pinsList.indexOf(id) >= 0;
  }

  /** M2.5 子会话缓存（pid→行数组；AppStorage K_CHILDREN 触发器计数） */
  private static childrenMap: Map<string, Array<Record<string, Object>>> = new Map<string, Array<Record<string, Object>>>();
  static setChildren(pid: string, list: Array<Record<string, Object>>): void {
    Store.childrenMap.set(pid, list);
    AppStorage.set(Store.K_CHILDREN, Store.childrenMap.size);
  }
  static childrenOf(pid: string): Array<Record<string, Object>> {
    const v = Store.childrenMap.get(pid);
    return v === undefined ? [] : v;
  }

  /** 子会话反查：侧栏子行点击/归档用；父目录从根会话取 */
  static childConv(id: string): ConvItem | null {
    let hitId = '';
    let hitTitle = '';
    let hitPid = '';
    Store.childrenMap.forEach((list: Array<Record<string, Object>>, pid: string) => {
      if (hitId !== '') {
        return;
      }
      for (let i = 0; i < list.length; i++) {
        const row = list[i];
        const cid = row['id'];
        if (cid === id) {
          hitId = id;
          const t = row['title'];
          hitTitle = typeof t === 'string' ? t : '';
          hitPid = pid;
          return;
        }
      }
    });
    if (hitId === '') {
      return null;
    }
    let dir = '';
    const roots = Store.convs();
    for (let i = 0; i < roots.length; i++) {
      if (roots[i].id === hitPid) {
        dir = roots[i].directory;
        break;
      }
    }
    return new ConvItem(hitId, hitTitle, dir, 0, 0, false, 0, true);
  }

  /** M2.5 展开的父会话集合（子树懒加载开关） */
  private static convOpenSet: Set<string> = new Set<string>();
  private static curModelRef: ModelItem | null = null;
  private static currentChildFlag: boolean = false;
  static convOpenHas(id: string): boolean {
    return Store.convOpenSet.has(id);
  }
  static toggleConvOpen(id: string): void {
    if (Store.convOpenSet.has(id)) {
      Store.convOpenSet.delete(id);
    } else {
      Store.convOpenSet.add(id);
    }
    AppStorage.set(Store.K_CONV_OPEN, Store.convOpenSet.size);
  }

  /** 单会话忙态查询/标记（xdevice 先探后标写入；M2） */
  static convBusy(id: string): boolean {
    const list = Store.convs();
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        return list[i].busy;
      }
    }
    return false;
  }

  static markBusy(id: string, busy: boolean): void {
    const list = Store.convs();
    const next: ConvItem[] = [];
    let touched = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        next.push(new ConvItem(list[i].id, list[i].title, list[i].directory, list[i].pwa, list[i].updatedAt, busy, list[i].childCount, list[i].isChild));
        touched = true;
      } else {
        next.push(list[i]);
      }
    }
    if (touched) {
      Store.setConvs(next);
      Store.rebuildGroups(); // P1-2：忙态变化驱动组签名刷新（清忙/标忙上屏）
    }
  }

  static setQueueCount(n: number): void {
    AppStorage.set(Store.K_QUEUE, n);
  }

  static queueCount(): number {
    const v = AppStorage.get<number>(Store.K_QUEUE);
    return v === undefined ? 0 : v;
  }

  static setCtxUsed(u: number): void {
    AppStorage.set(Store.K_CTX, u);
  }

  static ctxUsed(): number {
    const v = AppStorage.get<number>(Store.K_CTX);
    return v === undefined ? 0 : v;
  }



  static setConvs(list: ConvItem[]): void {
    AppStorage.set(Store.K_CONVS, list);
  }

  static convs(): ConvItem[] {
    const v = AppStorage.get<ConvItem[]>(Store.K_CONVS);
    return v === undefined ? new Array<ConvItem>() : v;
  }

  static msgs(): MsgDataSource {
    return Store.msgDs;
  }

  static setAuthOk(v: boolean): void {
    AppStorage.set(Store.K_AUTH, v);
  }

  static authOk(): boolean {
    const v = AppStorage.get<boolean>(Store.K_AUTH);
    return v === true;
  }

  static setCurrentId(id: string): void {
    AppStorage.set(Store.K_CURRENT, id);
  }

  static currentId(): string {
    const v = AppStorage.get<string>(Store.K_CURRENT);
    return v === undefined ? '' : v;
  }

  static setDir(dir: string): void {
    AppStorage.set(Store.K_DIR, dir);
  }

  static dir(): string {
    const v = AppStorage.get<string>(Store.K_DIR);
    return v === undefined ? '' : v;
  }

  static setCurrentChild(v: boolean): void {
    Store.currentChildFlag = v;
  }

  static isCurrentChild(): boolean {
    return Store.currentChildFlag;
  }

  static setSseState(s: string): void {
    AppStorage.set(Store.K_SSE, s);
  }

  static sseState(): string {
    const v = AppStorage.get<string>(Store.K_SSE);
    return v === undefined ? 'idle' : v;
  }
}

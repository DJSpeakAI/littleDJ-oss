// @提供 ChatService（chat 域：列表/打开/发送/流式/对账/降级轮询+M1 diff 卡·md 收尾解析·ctx pill·队列轮询·openSeq 竞态防护·idle 校准） @依赖 Net Sse event-bus events Store parser AgentCard
// M0.1 task361 落地；M1 增强（messages.js 的 buildEditCards/fileStatsOfPart 1:1 移植）
import { request } from '../../core/Net';
import { SseStream } from '../../core/Sse';
import { EventBus } from '../../core/event-bus';
import { EV, MsgDelta } from '../../core/events';
import { Store, ConvItem, MsgItem, EditCard, FileStatItem, TaskRow } from '../../store/Store';
import { mdTokensOf } from '../../core/markdown/parser';
import { agentCardOf } from '../../core/AgentCard';

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  pwa: number;
  time: Record<string, Object> | null;
  agent: string;
}

interface PartRow {
  type: string;
  text: string;
  url: string;
  messageID: string;
  tool: string;
  state: Record<string, Object> | null;
}

interface MsgRow {
  info: Record<string, Object>;
  parts: PartRow[];
}

interface AgentCap {
  agent: string;
  at: number;
}

function rowUpdated(row: SessionRow): number {
  const t = row.time;
  if (t !== null) {
    const c = t['updated'];
    const m = t['created'];
    if (typeof m === 'number') {
      return m;
    }
    if (typeof c === 'number') {
      return c;
    }
  }
  return 0;
}

export class ChatService {
  private static inited: boolean = false;
  static sse: SseStream = new SseStream();
  private static refreshTimer: number = -1;
  /** diff 卡展开记忆（对齐 PWA _ecOpenMids：mid→open；整表 reload 不折叠回，P1-5） */
  private static edOpenMids: Map<string, boolean> = new Map<string, boolean>();
  private static localNew: Map<string, number> = new Map<string, number>();
  private static agentCaps: Map<string, AgentCap> = new Map<string, AgentCap>();
  private static agentPending: Map<string, Promise<string>> = new Map<string, Promise<string>>();
  private static readonly AGENT_CAP_TTL: number = 5 * 60 * 1000;
  private static readonly AGENT_FAIL_TTL: number = 60 * 1000;

  static setEdOpen(mid: string, open: boolean): void {
    if (mid !== '') {
      ChatService.edOpenMids.set(mid, open);
    }
  }

  /** 域初始化（Boot 成功后调用一次）：订阅 EventBus */
  static init(): void {
    if (ChatService.inited) {
      return;
    }
    ChatService.inited = true;
    EventBus.on(EV.MSG_DELTA, (p: object) => {
      ChatService.onDelta(p);
    });
    EventBus.on(EV.MSGS_CHANGED, (p: object) => {
      ChatService.onMsgsChanged(p);
    });
    EventBus.on(EV.CONVS_CHANGED, (_p: object) => {
      ChatService.loadConvs().catch(() => {});
    });
    EventBus.on(EV.SESSION_BUSY, (p: object) => {
      ChatService.onBusy(p);
    });
    EventBus.on(EV.SSE_STATE, (p: object) => {
      const rec = p as Record<string, Object>;
      const s = rec['state'];
      if (typeof s === 'string') {
        Store.setSseState(s);
      }
    });
    ChatService.ctxStart();
  }

  /** 会话列表（/​_sessions 裸数组 → ConvItem[]，时间倒序） */
  static loadConvs(): Promise<ConvItem[]> {
    return request('/_sessions', 'GET', null).then((data: object) => {
      // serve 返回裸数组（已 curl 实证）；兼容对象包裹形态
      let rows: Object[] = [];
      if (Array.isArray(data)) {
        rows = data as Object[];
      } else {
        const rec = data as Record<string, Object>;
        const arr = rec['sessions'];
        if (arr !== undefined && Array.isArray(arr)) {
          rows = arr as Object[];
        }
      }
      const out: ConvItem[] = [];
      {
        rows.forEach((raw: Object) => {
          const r = raw as Record<string, Object>;
          const id = r['id'];
          const title = r['title'];
          const dir = r['directory'];
          const pwa = r['pwa'];
          if (typeof id === 'string' && typeof title === 'string' && typeof dir === 'string') {
            const timeObj = r['time'];
            const timeRec: Record<string, Object> | null =
              (timeObj !== undefined && typeof timeObj === 'object') ? (timeObj as Record<string, Object>) : null;
            const row: SessionRow = {
              id: id, title: title, directory: dir,
              pwa: typeof pwa === 'number' ? pwa : 0,
              time: timeRec,
              agent: typeof r['agent'] === 'string' ? r['agent'] : ''
            };
            const ccRaw = r['childCount'];
            out.push(new ConvItem(row.id, row.title, row.directory, row.pwa, rowUpdated(row), false, typeof ccRaw === 'number' ? ccRaw : 0, false));
          }
        });
      }
      out.sort((a: ConvItem, b: ConvItem): number => b.updatedAt - a.updatedAt);
      // 全量根会话（server /_sessions 上限 5000）；过滤隐藏项目「日常」+ 归档
      const HIDDEN_DIR = '/projects/日常';
      const recent: ConvItem[] = [];
      for (let i = 0; i < out.length; i++) {
        if (out[i].directory.indexOf(HIDDEN_DIR) >= 0) {
          continue;
        }
        // M2：hidden（归档）清单过滤（xdevice 对账写入 Store）
        if (Store.isHidden(out[i].id)) {
          continue;
        }
        recent.push(out[i]);
      }
      // busy 态保留（loadConvs 重入不清挂圈标记）
      const prev = Store.convs();
      // P1-3：本机 90s 内新建且当前打开、但服务端列表还没带上时补回（PWA task241 同款）
      const curId = Store.currentId();
      let hasCur = false;
      for (let i = 0; i < recent.length; i++) {
        if (recent[i].id === curId) {
          hasCur = true;
          break;
        }
      }
      if (curId !== '' && !Store.isHidden(curId) && !hasCur) {
        const born = ChatService.localNew.get(curId);
        if (born !== undefined && Date.now() - born < 90000) {
          for (let i = 0; i < prev.length; i++) {
            if (prev[i].id === curId) {
              recent.unshift(prev[i]);
              break;
            }
          }
        }
      }
      const busyMap: Map<string, boolean> = new Map<string, boolean>();
      prev.forEach((p: ConvItem) => {
        busyMap.set(p.id, p.busy);
      });
      recent.forEach((c: ConvItem) => {
        const b = busyMap.get(c.id);
        if (b !== undefined) {
          c.busy = b;
        }
      });
      Store.setConvs(recent);
      Store.rebuildGroups();
      return recent;
    });
  }

  /** 打开会话：全量消息 + 目录级 SSE 订阅 */
  static openConv(c: ConvItem): Promise<void> {
    Store.setCurrentId(c.id);
    Store.setDir(c.directory);
    Store.setCurrentChild(c.isChild);
    ChatService.sse.subscribe(c.directory);
    return ChatService.refreshMsgs();
  }

  /** 当前会话全量校准（GET message → reload；对齐 PWA refreshCurrent；M1：diff 卡+md 收尾解析） */
  static refreshMsgs(): Promise<void> {
    const sid = Store.currentId();
    if (sid === '') {
      return Promise.resolve();
    }
    return request(`/api/session/${encodeURIComponent(sid)}/message`, 'GET', null).then((data: object) => {
      const rows = Array.isArray(data) ? data as Object[] : [];
      const list: MsgItem[] = [];
      const editMap = ChatService.buildEditCards(rows);
      rows.forEach((raw: Object) => {
        const m = raw as MsgRow;
        const info = m.info;
        const mid = info['id'];
        const role = info['role'];
        let txt = '';
        if (m.parts !== undefined && Array.isArray(m.parts)) {
          m.parts.forEach((p: PartRow) => {
            if (p.type === 'text' && typeof p.text === 'string') {
              txt += p.text;
            }
          });
        }
        if (typeof mid === 'string' && typeof role === 'string') {
          const item = new MsgItem(mid, role, txt, false);
          // 产出审 P1-6：user 消息同走 md（对齐 PWA own.forEach(t=>bubble+=md(t))；此前「PWA user 纯文本」前提错误）
          if (txt.trim() !== '') {
            item.tokens = mdTokensOf(txt);
          }
          // 回合尾 assistant 挂 diff 卡（⚠S：Map 必须 .get——ArkTS/JS 的 map[key] 索引对 Map 永远 undefined，M1 真机实锤）
          // M4.5：file part 图附件→缩略
          if (m.parts !== undefined && Array.isArray(m.parts)) {
            m.parts.forEach((p: PartRow) => {
              if (p.type === 'file' && typeof p.url === 'string' && p.url.indexOf('data:image/') === 0 && item.imgUrl === '') {
                item.imgUrl = p.url;
              }
            });
          }
          const ac = agentCardOf(m.parts);
          if (ac !== null) {
            item.agentCard = ac;
          }
          const card = editMap.get(mid);
          if (role === 'assistant' && card !== undefined) {
            // 产出审 P1-5：展开态按 mid 记忆（对齐 PWA _ecOpenMids——整表 reload 不折叠回）
            card.open = ChatService.edOpenMids.get(mid) === true;
            item.editCard = card;
          }
          list.push(item);
        }
      });
      // openSeq 竞态防护（M0.1 遗留清偿）：响应回来时已切走 → 丢弃（对齐 PWA task312 seq 双查）
      if (sid !== Store.currentId()) {
        return;
      }
      Store.msgs().reload(list);
    });
  }

  /** —— diff 卡（1:1 移植 PWA fileStatsOfPart/buildEditCards，task239）—— */

  private static edNum(v: Object | undefined): number {
    return typeof v === 'number' && v > 0 ? Math.floor(v) : 0;
  }

  private static edLines(s: Object | undefined): number {
    if (typeof s !== 'string' || s === '') {
      return 0;
    }
    const lines = s.split('\n');
    // 产出审 P1-1：末尾空行剔除（对齐 PWA _edLines 的 a.pop()；"a\nb\n"=2 不是 3）
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    return lines.length;
  }

  /** patch 文本统计（1:1 对齐 PWA statsFromPatch：逐行扫 +++ 开新文件，a/ 前缀剥离，+/- 计数；--- 与 +++ 头行不计） */
  private static statsFromPatch(txt: string): Array<Record<string, Object>> {
    const out: Array<Record<string, Object>> = [];
    if (typeof txt !== 'string' || txt === '') {
      return out;
    }
    let cur = '';
    const lines = txt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (/^\+\+\+ /.test(l)) {
        let f = l.slice(4).trim().replace(/^[ab]\//, '');
        cur = (f === '' || f === '/dev/null') ? '' : f;
        if (cur !== '') {
          const row: Record<string, Object> = { 'file': cur, 'adds': 0, 'dels': 0 };
          out.push(row);
        }
        continue;
      }
      if (cur === '') {
        continue;
      }
      const last = out[out.length - 1];
      if (l.charAt(0) === '+' && !/^\+\+\+/.test(l)) {
        last['adds'] = (last['adds'] as number) + 1;
      } else if (l.charAt(0) === '-' && !/^---/.test(l)) {
        last['dels'] = (last['dels'] as number) + 1;
      }
    }
    return out;
  }

  /** 一个 tool part → [{file,adds,dels,note}]（对齐 PWA：edit=metadata.filediff/write=filePath+行数/patch=patchText） */
  private static fileStatsOfPart(p: PartRow): Array<Record<string, Object>> {
    if (p.type !== 'tool') {
      return [];
    }
    const st = p.state;
    if (st === null || st === undefined) {
      return [];
    }
    const status = st['status'];
    if (typeof status === 'string' && status !== 'completed' && status !== 'running') {
      return [];
    }
    const input = st['input'];
    const meta = st['metadata'];
    const inputRec: Record<string, Object> = (input !== undefined && typeof input === 'object') ? input as Record<string, Object> : {};
    const metaRec: Record<string, Object> = (meta !== undefined && typeof meta === 'object') ? meta as Record<string, Object> : {};
    const fd = metaRec['filediff'];
    if (fd !== undefined && typeof fd === 'object') {
      const fdRec = fd as Record<string, Object>;
      const fFile = fdRec['file'];
      if (typeof fFile === 'string' && fFile !== '') {
        const r: Record<string, Object> = { 'file': fFile, 'adds': ChatService.edNum(fdRec['additions']), 'dels': ChatService.edNum(fdRec['deletions']) };
        return [r];
      }
    }
    const tool = typeof p.tool === 'string' ? p.tool : '';
    if (tool === 'write' || tool === 'create') {
      const fpStr = inputRec['filePath'] !== undefined ? inputRec['filePath'] : metaRec['filepath'];
      const fp = typeof fpStr === 'string' ? fpStr : '';
      if (fp === '') {
        return [];
      }
      const note = metaRec['exists'] === true ? '整文件覆盖写入（删除行数不单列）' : '新建文件';
      const r2: Record<string, Object> = { 'file': fp, 'adds': ChatService.edLines(inputRec['content']), 'dels': 0, 'note': note };
      return [r2];
    }
    if (tool === 'patch' || tool === 'apply_patch') {
      const tRaw = inputRec['patchText'] !== undefined ? inputRec['patchText'] : (inputRec['patch'] !== undefined ? inputRec['patch'] : metaRec['diff']);
      const t = typeof tRaw === 'string' ? tRaw : '';
      const arr = ChatService.statsFromPatch(t);
      if (arr.length > 0) {
        return arr;
      }
      return [];
    }
    // 兜底：edit 无 filediff 时按替换文本行数粗算（deveco 正常都给 filediff；对齐 PWA 同名分支）
    if (tool === 'edit' && inputRec['filePath'] !== undefined) {
      const fpEdit = inputRec['filePath'];
      if (typeof fpEdit === 'string' && fpEdit !== '') {
        const r3: Record<string, Object> = {
          'file': fpEdit,
          'adds': ChatService.edLines(inputRec['newString']),
          'dels': ChatService.edLines(inputRec['oldString']),
          'note': '按替换文本行数估算'
        };
        return [r3];
      }
    }
    return [];
  }

  /** 按回合归并（user 分界；同文件 adds/dels 累加；挂回合末 assistant） */
  private static buildEditCards(rows: Object[]): Map<string, EditCard> {
    const map = new Map<string, EditCard>();
    let turnFiles: FileStatItem[] = [];
    let turnLastAsst = '';
    const flush = (): void => {
      if (turnLastAsst !== '' && turnFiles.length > 0) {
        let adds = 0;
        let dels = 0;
        turnFiles.forEach((f: FileStatItem) => {
          adds += f.adds;
          dels += f.dels;
        });
        map.set(turnLastAsst, new EditCard(turnFiles, adds, dels));
      }
      turnFiles = [];
      turnLastAsst = '';
    };
    rows.forEach((raw: Object) => {
      const m = raw as MsgRow;
      const info = m.info;
      const role = info['role'];
      if (role === 'user') {
        flush();
        return;
      }
      if (role !== 'assistant') {
        return;
      }
      const mid = info['id'];
      if (typeof mid === 'string' && mid !== '') {
        turnLastAsst = mid;
      }
      if (m.parts !== undefined && Array.isArray(m.parts)) {
        m.parts.forEach((p: PartRow) => {
          const statRows = ChatService.fileStatsOfPart(p);
          statRows.forEach((r: Record<string, Object>) => {
            const f = r['file'];
            if (typeof f !== 'string') {
              return;
            }
            const adds = ChatService.edNum(r['adds']);
            const dels = ChatService.edNum(r['dels']);
            const noteRaw = r['note'];
            const note = typeof noteRaw === 'string' ? noteRaw : '';
            let hit: FileStatItem | null = null;
            for (let i = 0; i < turnFiles.length; i++) {
              if (turnFiles[i].file === f) {
                hit = turnFiles[i];
                break;
              }
            }
            if (hit !== null) {
              hit.adds += adds;
              hit.dels += dels;
            } else {
              turnFiles.push(new FileStatItem(f, adds, dels, note));
            }
          });
        });
      }
    });
    flush();
    return map;
  }

  /** 发送（乐观 user 气泡 + prompt_async；assistant 气泡由 delta 事件生长）；202 排队→队列条+3s 轮询 */
  /** M4.5：带附件发送（dataURL file part 与 text 并列） */
  static sendAtt(text: string, mime: string, name: string, dataUrl: string): Promise<void> {
    const sid = Store.currentId();
    if (sid === '' || (text.trim() === '' && dataUrl === '')) {
      return Promise.resolve();
    }
    Store.msgs().push(new MsgItem(`local_${Date.now()}`, 'user', text, false));
    const isChild = Store.isCurrentChild();
    const dir = Store.dir();
    const agentP = isChild ? Promise.resolve('') : ChatService.butlerAgent(dir);
    return agentP.then((agent: string): Promise<void> => {
      const tpart: Record<string, string> = { 'type': 'text', 'text': text };
      const fpart: Record<string, string> = { 'type': 'file', 'mime': mime, 'filename': name, 'url': dataUrl };
      const parts: Array<Record<string, string>> = [tpart, fpart];
      const body: Record<string, Object> = { 'parts': parts };
      if (agent !== '') {
        body['agent'] = agent;
      }
      const cm = Store.curModel();
      if (cm !== null) {
        const mj: Record<string, Object> = { 'providerID': cm.providerID, 'modelID': cm.modelID };
        body['model'] = mj;
      }
      return request(`/api/session/${encodeURIComponent(sid)}/prompt_async`, 'POST', body).then((_d: object): void => {
        // 受理：交给 SSE delta 流
      }).catch((e: Error): void => {
        Store.msgs().push(new MsgItem(`err_${Date.now()}`, 'assistant', `发送失败：${e.message}`, false));
      });
    });
  }

  static send(text: string): Promise<void> {
    const sid = Store.currentId();
    if (sid === '' || text.trim() === '') {
      return Promise.resolve();
    }
    Store.msgs().push(new MsgItem(`local_${Date.now()}`, 'user', text, false));
    const isChild = Store.isCurrentChild();
    const dir = Store.dir();
    const agentP = isChild ? Promise.resolve('') : ChatService.butlerAgent(dir);
    return agentP.then((agent: string): Promise<void> => {
      const part: Record<string, string> = { 'type': 'text', 'text': text };
      const parts: Array<Record<string, string>> = [part];
      const body: Record<string, Object> = { 'parts': parts };
      if (agent !== '') {
        body['agent'] = agent;
      }
      // M3：发送携带选中模型（Store.curModel 直取——domain 同层零依赖）
      const cm = Store.curModel();
      if (cm !== null) {
        const mj: Record<string, Object> = { 'providerID': cm.providerID, 'modelID': cm.modelID };
        body['model'] = mj;
      }
      return request(`/api/session/${encodeURIComponent(sid)}/prompt_async`, 'POST', body).then((data: object): void => {
        const rec = data as Record<string, Object>;
        if (rec['queued'] === true || rec['deduped'] === true) {
          ChatService.queueStart(sid);
          return;
        }
        // 204/202 受理：assistant 内容交给 SSE delta 流
      }).catch((e: Error): void => {
        Store.msgs().push(new MsgItem(`err_${Date.now()}`, 'assistant', `发送失败：${e.message}`, false));
      });
    });
  }

  private static butlerAgent(dir: string): Promise<string> {
    if (dir === '') {
      return Promise.resolve('');
    }
    const hit = ChatService.agentCaps.get(dir);
    if (hit !== undefined) {
      const ttl = hit.agent === '' ? ChatService.AGENT_FAIL_TTL : ChatService.AGENT_CAP_TTL;
      if (Date.now() - hit.at < ttl) {
        return Promise.resolve(hit.agent);
      }
    }
    const pending = ChatService.agentPending.get(dir);
    if (pending !== undefined) {
      return pending;
    }
    const p = request(`/api/agent?directory=${encodeURIComponent(dir)}`, 'GET', null).then((data: object): string => {
      let agent = '';
      if (Array.isArray(data)) {
        const rows = data as Object[];
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i] as Record<string, Object>;
          if (r['name'] === 'butler' && r['mode'] === 'primary') {
            agent = 'butler';
            break;
          }
        }
      }
      const cap: AgentCap = { agent: agent, at: Date.now() };
      ChatService.agentCaps.set(dir, cap);
      ChatService.agentPending.delete(dir);
      return agent;
    }).catch((): string => {
      const cap: AgentCap = { agent: '', at: Date.now() };
      ChatService.agentCaps.set(dir, cap);
      ChatService.agentPending.delete(dir);
      return '';
    });
    ChatService.agentPending.set(dir, p);
    return p;
  }

  static messagesOf(sid: string): Promise<Object[]> {
    if (sid === '') {
      return Promise.resolve(new Array<Object>());
    }
    return request(`/api/session/${encodeURIComponent(sid)}/message`, 'GET', null).then((data: object): Object[] => {
      return Array.isArray(data) ? data as Object[] : new Array<Object>();
    });
  }

  /** M2.5 新建会话（POST /api/session?directory；对齐 PWA createSession——建完乐观插入+打开） */
  static createSession(dir: string, title: string): Promise<ConvItem> {
    const q = encodeURIComponent(dir);
    const body: Record<string, string> = { 'title': title };
    return request(`/api/session?directory=${q}`, 'POST', body).then((data: object): ConvItem => {
      const rec = data as Record<string, Object>;
      const id = rec['id'];
      if (typeof id !== 'string' || id === '') {
        throw new Error('服务端未返回会话 id');
      }
      const titleRaw = rec['title'];
      const titleOut = typeof titleRaw === 'string' && titleRaw !== '' ? titleRaw : title;
      const dirRaw = rec['directory'];
      const dirOut = typeof dirRaw === 'string' && dirRaw !== '' ? dirRaw : dir;
      const pwaRaw = rec['pwa'];
      const pwa = typeof pwaRaw === 'number' ? pwaRaw : 1;
      let created = Date.now();
      const timeObj = rec['time'];
      if (timeObj !== undefined && typeof timeObj === 'object') {
        const c = (timeObj as Record<string, Object>)['created'];
        if (typeof c === 'number') {
          created = c;
        }
      }
      const item = new ConvItem(id, titleOut, dirOut, pwa, created, false, 0, false);
      const list = Store.convs().slice();
      list.unshift(item);
      Store.setConvs(list);
      Store.rebuildGroups();
      ChatService.localNew.set(id, Date.now());
      ChatService.loadConvs().catch(() => {});
      return item;
    });
  }

  /** M2.5 子会话懒加载（GET children；agent 角色随行） */
  static fetchChildren(pid: string): Promise<Array<Record<string, Object>>> {
    return request(`/api/session/${encodeURIComponent(pid)}/children`, 'GET', null).then((data: object) => {
      if (!Array.isArray(data)) {
        return [];
      }
      const rows = data as Object[];
      const out: Array<Record<string, Object>> = [];
      rows.forEach((raw: Object) => {
        const r = raw as Record<string, Object>;
        const id = r['id'];
        const title = r['title'];
        if (typeof id === 'string' && typeof title === 'string') {
          out.push({ 'id': id, 'title': title, 'agent': typeof r['agent'] === 'string' ? r['agent'] : '' });
        }
      });
      Store.setChildren(pid, out);
      return out;
    }).catch(() => []);
  }

  /** M2.5 置顶（/_conv-order __pins__ 键，跨设备持久化；显示层 pin first——PWA task200 同构） */
  static loadPins(): Promise<string[]> {
    return request('/_conv-order', 'GET', null).then((data: object) => {
      const rec = data as Record<string, Object>;
      const order = rec['order'];
      if (order !== undefined && typeof order === 'object') {
        const pins = (order as Record<string, Object>)['__pins__'];
        if (pins !== undefined && Array.isArray(pins)) {
          const out: string[] = [];
          (pins as Object[]).forEach((x: Object) => {
            if (typeof x === 'string') { out.push(x); }
          });
          Store.setPins(out);
          return out;
        }
      }
      return [];
    }).catch(() => []);
  }

  static togglePin(sid: string): Promise<boolean> {
    const pins = Store.pins().slice();
    const i = pins.indexOf(sid);
    if (i >= 0) { pins.splice(i, 1); } else { pins.push(sid); }
    Store.setPins(pins);
    Store.rebuildGroups();
    const body: Record<string, Object> = { 'projKey': '__pins__', 'ids': pins };
    return request('/_conv-order', 'POST', body).then((data: object) => {
      const rec = data as Record<string, Object>;
      return rec['ok'] === true;
    }).catch(() => false);
  }

  /** —— M2 侧栏域：项目分组（/_dirs）+归档+任务面板 —— */

  static loadDirs(): Promise<Array<Record<string, Object>>> {
    return request('/_dirs', 'GET', null).then((data: object) => {
      const rec = data as Record<string, Object>;
      const out: Array<Record<string, Object>> = [];
      const seen: Set<string> = new Set<string>();
      const addRows = (arrObj: Object | undefined, imported: boolean): void => {
        if (arrObj === undefined || !Array.isArray(arrObj)) {
          return;
        }
        const rows = arrObj as Object[];
        rows.forEach((raw: Object) => {
          const r = raw as Record<string, Object>;
          const name = r['name'];
          const p = r['path'];
          if (typeof name !== 'string' || typeof p !== 'string') {
            return;
          }
          // 隐藏项目（对齐 PWA HIDDEN_PROJECT_PATHS：日常草稿区）
          if (p.indexOf('/projects/日常') >= 0) {
            return;
          }
          if (seen.has(p)) {
            return;
          }
          seen.add(p);
          out.push({ 'name': name, 'path': p, 'key': imported ? `i:${name}` : name });
        });
      };
      addRows(rec['projects'], false);
      addRows(rec['imports'], true);
      const orderObj = rec['order'];
      if (orderObj !== undefined && Array.isArray(orderObj)) {
        const order = orderObj as Object[];
        const pos: Map<string, number> = new Map<string, number>();
        for (let i = 0; i < order.length; i++) {
          const k = order[i];
          if (typeof k === 'string') {
            pos.set(k, i);
          }
        }
        out.sort((a: Record<string, Object>, b: Record<string, Object>): number => {
          const ak = `${a['key']}`;
          const bk = `${b['key']}`;
          const ai = pos.get(ak);
          const bi = pos.get(bk);
          const av = ai === undefined ? 9999 : ai;
          const bv = bi === undefined ? 9999 : bi;
          return av - bv;
        });
      }
      Store.setDirs(out);
      return out;
    });
  }

  /** 归档会话（POST /_hidden-sessions action:hide；⚠S 参数名=ids 不是 sids，proxy 校验实证）
   *  产出审 P1-3：忙态拦截（对齐 PWA lockHint 拒运行中）+成功本地即时隐藏（不等 15s tick）。返回值：
   *  'ok' 成功 / 'busy' 会话在跑 / 'fail' 失败 */
  static archiveConv(sid: string): Promise<string> {
    if (Store.convBusy(sid)) {
      return Promise.resolve('busy');
    }
    const body: Record<string, Object> = { 'action': 'hide', 'ids': [sid] };
    return request('/_hidden-sessions', 'POST', body).then((data: object): string => {
      const rec = data as Record<string, Object>;
      if (rec['ok'] !== true) {
        return 'fail';
      }
      // 本地即时隐藏（并集进 hiddenSet+显式重拉，对齐 PWA S.hidden[id]=1; renderSidebar()）
      Store.hideLocal(sid);
      ChatService.loadConvs().catch(() => {});
      return 'ok';
    }).catch((): string => 'fail');
  }

  /** 任务面板（/_tasks → {ok,tasks:[...]} 对象包裹（产出审 P0-1：非裸数组）→ 非 done 最近 30；M2 右栏数据源） */
  static loadTasks(): Promise<number> {
    return request('/_tasks', 'GET', null).then((data: object) => {
      const rec = data as Record<string, Object>;
      if (rec['ok'] !== true) {
        return 0; // 降级响应不清旧值
      }
      const arr = rec['tasks'];
      if (arr === undefined || !Array.isArray(arr)) {
        return 0;
      }
      const rows = arr as Object[];
      const out: Array<TaskRow> = [];
      for (let i = rows.length - 1; i >= 0 && out.length < 30; i--) {
        const r = rows[i] as Record<string, Object>;
        const state = r['state'];
        if (state === 'done') {
          continue;
        }
        const title = r['title'];
        const id = r['id'];
        if (typeof title === 'string' && typeof id === 'string') {
          out.push(new TaskRow(id, title, typeof state === 'string' ? state : ''));
        }
      }
      Store.setTasks(out);
      return out.length;
    }).catch(() => 0);
  }

  /** —— 队列（PWA queue.js 语义最小集：有排队 3s 轮询，count=0 停）—— */
  private static queueTimer: number = -1;
  private static queueSid: string = '';

  static queueStart(sid: string): void {
    ChatService.queueSid = sid;
    Store.setQueueCount(-1); // -1=刚入队未知数量，显示「排队中…」
    if (ChatService.queueTimer >= 0) {
      return;
    }
    ChatService.queueTimer = setInterval(() => {
      ChatService.queueTick();
    }, 3000);
    ChatService.queueTick();
  }

  private static queueTick(): void {
    const sid = ChatService.queueSid;
    if (sid === '' || sid !== Store.currentId()) {
      ChatService.queueStop();
      return;
    }
    request(`/_queue?session=${encodeURIComponent(sid)}`, 'GET', null).then((data: object) => {
      // 晚到校验（P2）：响应回来时已切走 → 丢弃，防旧会话条数写到新会话
      if (sid !== Store.currentId()) {
        return;
      }
      const rec = data as Record<string, Object>;
      const items = rec['items'];
      let n = 0;
      if (items !== undefined && Array.isArray(items)) {
        n = (items as Object[]).length;
      }
      const cnt = rec['count'];
      if (typeof cnt === 'number') {
        n = cnt;
      }
      Store.setQueueCount(n);
      if (n <= 0) {
        ChatService.queueStop();
      }
    }).catch(() => {
      ChatService.queueStop();
    });
  }

  static queueStop(): void {
    if (ChatService.queueTimer >= 0) {
      clearInterval(ChatService.queueTimer);
      ChatService.queueTimer = -1;
    }
    Store.setQueueCount(0);
  }

  /** —— 上下文 pill（/_ctxmap 60s 低频，PWA context.js 口径；窗口值 M3 模型域接入后再升百分比）—— */
  private static ctxTimer: number = -1;

  static ctxStart(): void {
    if (ChatService.ctxTimer >= 0) {
      return;
    }
    ChatService.ctxTimer = setInterval(() => {
      ChatService.ctxTick();
    }, 60000);
    ChatService.ctxTick();
  }

  static ctxStop(): void {
    if (ChatService.ctxTimer >= 0) {
      clearInterval(ChatService.ctxTimer);
      ChatService.ctxTimer = -1;
    }
  }

  private static ctxTick(): void {
    request('/_ctxmap', 'GET', null).then((data: object) => {
      const rec = data as Record<string, Object>;
      const map = rec['map'];
      if (map === undefined || typeof map !== 'object') {
        return;
      }
      const mapRec = map as Record<string, Object>;
      const sid = Store.currentId();
      if (sid === '') {
        return;
      }
      const info = mapRec[sid];
      if (info !== undefined && typeof info === 'object') {
        const infoRec = info as Record<string, Object>;
        const u = infoRec['u'];
        if (typeof u === 'number') {
          Store.setCtxUsed(u);
        }
      }
    }).catch(() => {});
  }

  /** 打开会话时的即时探测（ctx+queue 各一拍，不等周期；产出审 P2：切回排队会话恢复队列条） */
  static probeOnOpen(sid: string): void {
    if (sid === '') {
      return;
    }
    request(`/_queue?session=${encodeURIComponent(sid)}`, 'GET', null).then((data: object) => {
      // 晚到校验：切走了就丢弃（对齐 openSeq 精神）
      if (sid !== Store.currentId()) {
        return;
      }
      const rec = data as Record<string, Object>;
      const cnt = rec['count'];
      const items = rec['items'];
      let n = 0;
      if (typeof cnt === 'number') {
        n = cnt;
      } else if (items !== undefined && Array.isArray(items)) {
        n = (items as Object[]).length;
      }
      if (n > 0) {
        ChatService.queueStart(sid);
      }
    }).catch(() => {});
    ChatService.ctxTick();
  }

  /** 停止订阅（退后台/登出） */
  static shutdown(): void {
    ChatService.sse.unsubscribe();
    ChatService.queueStop();
    ChatService.ctxStop();
    if (ChatService.refreshTimer >= 0) {
      clearTimeout(ChatService.refreshTimer);
      ChatService.refreshTimer = -1;
    }
  }

  private static onDelta(p: object): void {
    const d = p as MsgDelta;
    if (d.field !== 'text' || d.messageID === '') {
      return;
    }
    // 产出审 P1-2：只收当前会话的流（对齐 PWA sessionID!==current→return，防同目录他话串流成幽灵气泡）
    if (d.sessionID !== '' && d.sessionID !== Store.currentId()) {
      return;
    }
    Store.msgs().appendText(d.messageID, d.delta);
    // 不在列表（服务端新起的 assistant 消息）→ 建流式气泡（对齐 PWA ensureAssistantMessage）
    const ds = Store.msgs();
    if (ds.indexOf(d.messageID) < 0) {
      ds.push(new MsgItem(d.messageID, 'assistant', d.delta, true));
    }
  }

  private static onMsgsChanged(p: object): void {
    const rec = p as Record<string, Object>;
    const deltaDone = rec['deltaDone'] === true;
    const recovered = rec['recovered'] === true;
    if (recovered) {
      // 断线恢复：当前会话全量校准 + 列表补账（二审 P1-D reconcile 最小实现）
      ChatService.refreshMsgs().catch(() => {});
      ChatService.loadConvs().catch(() => {});
      return;
    }
    if (deltaDone) {
      // 产出审 P1-2：他话的收尾事件不触发当前会话全量刷新（防无谓请求）
      const evSid = rec['sessionID'];
      if (typeof evSid === 'string' && evSid !== '' && evSid !== Store.currentId()) {
        return;
      }
      // 收尾事件风暴防护：400ms 去抖后以服务端为准全量校准
      if (ChatService.refreshTimer >= 0) {
        clearTimeout(ChatService.refreshTimer);
      }
      ChatService.refreshTimer = setTimeout(() => {
        ChatService.refreshTimer = -1;
        ChatService.refreshMsgs().catch(() => {});
      }, 400);
    }
  }

  private static onBusy(p: object): void {
    const rec = p as Record<string, Object>;
    const sid = rec['sid'];
    const busy = rec['busy'] === true;
    if (typeof sid !== 'string' || sid === '') {
      return;
    }
    // session.idle 校准（M0.1 遗留）：当前会话收尾 → 去抖全量校准（diff 卡/md 随之落位）
    if (!busy && sid === Store.currentId()) {
      if (ChatService.refreshTimer >= 0) {
        clearTimeout(ChatService.refreshTimer);
      }
      ChatService.refreshTimer = setTimeout(() => {
        ChatService.refreshTimer = -1;
        ChatService.refreshMsgs().catch(() => {});
      }, 400);
    }
    // P1-6：忙态写入收敛到 Store.markBusy 单实现（尾部 setConvs+rebuildGroups 上屏）
    Store.markBusy(sid, busy);
  }
}

// @提供 SseProbe SseStream（探针验收在用 + M0.1 完整版：目录订阅/EventBus 分发/看门狗/退避重连/降级轮询） @依赖 core/Net core/event-bus core/events
import { http } from '@kit.NetworkKit';
import { util } from '@kit.ArkTS';
import { probeUa, passCookie, baseUrl } from './Net';
import { EventBus } from './event-bus';
import { EV, MsgDelta, SseStatePayload, SessionBusy, MsgsChangedPayload } from './events';

export type ProbeState = 'idle' | 'connecting' | 'online' | 'reconnecting';

export interface ProbeStats {
  state: ProbeState;
  eventCount: number;      // data: 业务帧数
  frameCount: number;      // 全部完整帧数（含 : 心跳）
  byteCount: number;       // 累计接收字节
  lastFrameAt: string;     // 最后帧到达时间
  lastFramePreview: string;// 最后 data 帧预览（≤120 字符）
  watchdogFired: number;   // 看门狗触发次数
  reconnects: number;      // 重连次数
  lastRecoverMs: number;   // 最近一次断线→恢复耗时
  lastErr: string;         // 最近错误（中文化）
}

export function mkStats(): ProbeStats {
  return {
    state: 'idle',
    eventCount: 0,
    frameCount: 0,
    byteCount: 0,
    lastFrameAt: '-',
    lastFramePreview: '-',
    watchdogFired: 0,
    reconnects: 0,
    lastRecoverMs: 0,
    lastErr: '-'
  };
}

export class SseProbe {
  private url: string;
  private auth: string;
  private req: http.HttpRequest | null = null;
  private buf: number[] = [];
  private decoder: util.TextDecoder = util.TextDecoder.create('utf-8');
  private watchdogId: number = -1;
  private reconnectId: number = -1;
  private stopped: boolean = true;
  private backoffMs: number = 2000;
  private dropAt: number = 0;
  private readonly watchdogMs: number = 60000; // 60s 无字节即断死重连（L-095：socket 活≠流在推进；空闲心跳频率由本探针记录供校准）

  public stats: ProbeStats = mkStats();
  public onStats: ((s: ProbeStats) => void) | null = null;
  public onLog: ((line: string) => void) | null = null;

  constructor(url: string, auth: string) {
    this.url = url;
    this.auth = auth;
  }

  private log(line: string): void {
    const ts = new Date();
    const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
    const h = `${pad(ts.getHours())}:${pad(ts.getMinutes())}:${pad(ts.getSeconds())}`;
    if (this.onLog) {
      this.onLog(`[${h}] ${line}`);
    }
  }

  private emit(): void {
    if (this.onStats) {
      // 整体替换新对象（V1 @State 第一层观察，整体赋值最稳）
      this.onStats(JSON.parse(JSON.stringify(this.stats)) as ProbeStats);
    }
  }

  start(): void {
    this.stopped = false;
    this.stats = mkStats();
    this.stats.state = 'connecting';
    this.log(`探针启动 → ${this.url}`);
    this.log(`UA=${probeUa()}`);
    this.emit();
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.req) {
      try {
        this.req.destroy();
      } catch (e) {
        // 已销毁则忽略
      }
      this.req = null;
    }
    this.stats.state = 'idle';
    this.log('探针停止');
    this.emit();
  }

  /** 断线模拟：主动掐连接，走真实重连路径（真断网=关 WiFi，由真机挂机验收覆盖） */
  simulateDrop(): void {
    if (this.stopped) {
      return;
    }
    this.log('— 手动断线模拟 —');
    this.dropAt = Date.now();
    if (this.req) {
      try {
        this.req.destroy();
      } catch (e) {
        // 忽略
      }
      this.req = null;
    }
    this.scheduleReconnect('手动断线模拟');
  }

  private clearTimers(): void {
    if (this.watchdogId >= 0) {
      clearTimeout(this.watchdogId);
      this.watchdogId = -1;
    }
    if (this.reconnectId >= 0) {
      clearTimeout(this.reconnectId);
      this.reconnectId = -1;
    }
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.stats.state = this.stats.reconnects > 0 ? 'reconnecting' : 'connecting';
    this.emit();
    const req = http.createHttp();
    this.req = req;
    req.on('headersReceive', () => {
      const wasDown = this.dropAt > 0;
      if (wasDown) {
        this.stats.lastRecoverMs = Date.now() - this.dropAt;
        this.dropAt = 0;
        this.stats.reconnects += 1;
      }
      this.backoffMs = 2000;
      this.stats.state = 'online';
      this.stats.lastErr = '-';
      this.log(`连上服务端（${wasDown ? `恢复耗时 ${this.stats.lastRecoverMs}ms` : '首连'}）`);
      this.armWatchdog();
      this.emit();
    });
    req.on('dataReceive', (chunk: ArrayBuffer) => {
      const bytes = new Uint8Array(chunk);
      this.stats.byteCount += bytes.byteLength;
      this.armWatchdog();
      this.feed(bytes);
      this.emit();
    });
    req.on('dataEnd', () => {
      if (this.stopped) {
        return;
      }
      this.log('流正常结束（dataEnd）→ 按断线重连处理');
      if (this.dropAt === 0) {
        this.dropAt = Date.now();
      }
      this.scheduleReconnect('dataEnd');
    });
    req.requestInStream(this.url, {
      method: http.RequestMethod.GET,
      header: {
        'Authorization': this.auth,
        'Accept': 'text/event-stream',
        'User-Agent': probeUa()
      },
      connectTimeout: 15000,
      readTimeout: 0, // 0=不主动超时（流式长连，靠内容看门狗守；P2-12 探针实测项，若 0 语义非「不超时」则挂机时看门狗会暴露）
      usingCache: false
    }).catch((e: Error) => {
      if (this.stopped) {
        return;
      }
      this.stats.lastErr = e.message;
      this.log(`请求异常：${e.message}`);
      if (this.dropAt === 0) {
        this.dropAt = Date.now();
      }
      this.scheduleReconnect('请求异常');
    });
  }

  /** 内容看门狗：60s 无任何字节到达即断死（P2-11「实质事件」=字节级，含心跳注释帧） */
  private armWatchdog(): void {
    if (this.watchdogId >= 0) {
      clearTimeout(this.watchdogId);
    }
    this.watchdogId = setTimeout(() => {
      if (this.stopped) {
        return;
      }
      this.stats.watchdogFired += 1;
      this.stats.lastErr = '看门狗：60s 无数据';
      this.log(`⚠ 看门狗触发（第 ${this.stats.watchdogFired} 次）：60s 无字节到达，断死重连`);
      if (this.dropAt === 0) {
        this.dropAt = Date.now();
      }
      if (this.req) {
        try {
          this.req.destroy();
        } catch (e) {
          // 忽略
        }
        this.req = null;
      }
      this.scheduleReconnect('看门狗');
    }, this.watchdogMs);
  }

  /** 指数退避 2s→4s→8s→16s→30s 封顶；成功后重置 */
  private scheduleReconnect(reason: string): void {
    if (this.stopped) {
      return;
    }
    if (this.watchdogId >= 0) {
      clearTimeout(this.watchdogId);
      this.watchdogId = -1;
    }
    this.stats.state = 'reconnecting';
    this.emit();
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    this.log(`${wait}ms 后重连（原因：${reason}）`);
    if (this.reconnectId >= 0) {
      clearTimeout(this.reconnectId);
    }
    this.reconnectId = setTimeout(() => {
      this.reconnectId = -1;
      this.connect();
    }, wait);
  }

  /** 字节级行缓冲：按 \n\n（0x0A 0x0A）切帧，帧内字节为完整 UTF-8 序列再整体解码（跨包帧/跨帧多字节字符均安全） */
  private feed(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.byteLength; i++) {
      this.buf.push(bytes[i]);
    }
    let nl = this.indexOfFrameEnd();
    while (nl >= 0) {
      const frameBytes: number[] = this.buf.splice(0, nl + 2); // 含帧尾 \n\n
      this.handleFrame(frameBytes);
      nl = this.indexOfFrameEnd();
    }
  }

  private indexOfFrameEnd(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === 0x0A && this.buf[i + 1] === 0x0A) {
        return i;
      }
    }
    return -1;
  }

  private handleFrame(frameBytes: number[]): void {
    // 去帧尾 \n\n
    const body = frameBytes.slice(0, frameBytes.length - 2);
    if (body.length === 0) {
      return;
    }
    const u8 = new Uint8Array(body);
    const text = this.decoder.decodeToString(u8);
    this.stats.frameCount += 1;
    this.stats.lastFrameAt = new Date().toLocaleTimeString();
    // SSE 行解析：data: 业务 / : 注释（心跳）
    const lines = text.split('\n');
    let dataFound = false;
    let data = '';
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (ln.startsWith('data:')) {
        dataFound = true;
        data += ln.slice(5).replace(/^ /, '');
      }
    }
    if (dataFound) {
      this.stats.eventCount += 1;
      this.stats.lastFramePreview = data.length > 120 ? `${data.slice(0, 120)}…` : data;
    }
  }
}

// ==================== M0.1 完整版：SseStream（目录级订阅 + EventBus 分发 + 401 自愈链 + 降级轮询） ====================
// import 已合并至文件头部（arkts-no-misplaced-imports）

interface SseEvent {
  id: string;
  type: string;
  properties: Record<string, Object> | null;
}

interface FlagPayload {
  recovered?: boolean;
  polled?: boolean;
}

export class SseStream {
  private dir: string = '';
  private req: http.HttpRequest | null = null;
  private buf: number[] = [];
  private decoder2: util.TextDecoder = util.TextDecoder.create('utf-8');
  private stopped: boolean = true;
  private backoffMs: number = 2000;
  private dropAt: number = 0;
  private watchdogId: number = -1;
  private reconnectId: number = -1;
  private pollId: number = -1;
  private curState: string = 'idle';
  private readonly watchdogMs: number = 60000;

  state(): string {
    return this.curState;
  }

  private setState(s: string): void {
    this.curState = s;
    const p: SseStatePayload = { state: s };
    EventBus.emit(EV.SSE_STATE, p);
  }

  subscribe(dir: string): void {
    if (this.dir === dir && !this.stopped) {
      return;
    }
    // 产出审 P1-1：切目录先 teardown 旧连接（对齐 PWA connectSSE 先 sse.close()）
    // ——不销毁则双流共存、共享 buf 混帧、watchdog 被旧流刷新、连接泄漏
    if (this.req) {
      try {
        this.req.destroy();
      } catch (e) {
        // 已销毁忽略
      }
      this.req = null;
    }
    this.clearTimers();
    this.stopPolling();
    this.buf = [];
    this.dropAt = 0;
    this.backoffMs = 2000;
    this.dir = dir;
    this.stopped = false;
    this.connect();
  }

  unsubscribe(): void {
    this.stopped = true;
    this.clearTimers();
    this.stopPolling();
    if (this.req) {
      try {
        this.req.destroy();
      } catch (e) {
        // 已销毁忽略
      }
      this.req = null;
    }
    this.setState('idle');
  }

  private clearTimers(): void {
    if (this.watchdogId >= 0) {
      clearTimeout(this.watchdogId);
      this.watchdogId = -1;
    }
    if (this.reconnectId >= 0) {
      clearTimeout(this.reconnectId);
      this.reconnectId = -1;
    }
  }

  private connect(): void {
    if (this.stopped) {
      return;
    }
    this.setState(this.dropAt > 0 ? 'reconnecting' : 'connecting');
    const req = http.createHttp();
    this.req = req;
    req.on('headersReceive', (_header: object) => {
      const wasDown = this.dropAt > 0;
      this.dropAt = 0;
      this.backoffMs = 2000;
      this.setState('online');
      this.stopPolling();
      if (wasDown) {
        // 断线→恢复边沿：通知域层 reconcile 补账（当前会话全量校准 + sessions 合并）
        const rec1: MsgsChangedPayload = { recovered: true };
        EventBus.emit(EV.MSGS_CHANGED, rec1);
        const rec2: FlagPayload = { recovered: true };
        EventBus.emit(EV.CONVS_CHANGED, rec2);
      }
      this.armWatchdog();
    });
    req.on('dataReceive', (chunk: ArrayBuffer) => {
      this.armWatchdog();
      this.feed(new Uint8Array(chunk));
    });
    req.on('dataEnd', () => {
      if (this.stopped) {
        return;
      }
      if (this.dropAt === 0) {
        this.dropAt = Date.now();
      }
      this.scheduleReconnect('dataEnd');
    });
    req.requestInStream(`${baseUrl()}/api/event?directory=${encodeURIComponent(this.dir)}`, {
      method: http.RequestMethod.GET,
      header: {
        'Cookie': `dj_pass=${passCookie()}`,
        'Accept': 'text/event-stream',
        'User-Agent': probeUa()
      },
      connectTimeout: 15000,
      readTimeout: 0,
      usingCache: false
    }).then((_reqId: number) => {
      // requestInStream resolve=请求 id（非响应体）；401 通行证失效不在此检测——
      // 由下游 request() 统一 401 拦截链兜底（SSE 401→dataEnd→退避重连，同时降级轮询触发
      // loadConvs 走 request→401→AUTH_EXPIRED→页面回登录并 shutdown SSE，闭环无风暴）
    }).catch((_e: Error) => {
      if (this.stopped) {
        return;
      }
      if (this.dropAt === 0) {
        this.dropAt = Date.now();
      }
      this.scheduleReconnect('请求异常');
    });
    this.startPollingIfDown();
  }

  private armWatchdog(): void {
    if (this.watchdogId >= 0) {
      clearTimeout(this.watchdogId);
    }
    this.watchdogId = setTimeout(() => {
      if (this.stopped) {
        return;
      }
      if (this.dropAt === 0) {
        this.dropAt = Date.now();
      }
      if (this.req) {
        try {
          this.req.destroy();
        } catch (e) {
          // 忽略
        }
        this.req = null;
      }
      this.scheduleReconnect('看门狗：60s 无字节');
    }, this.watchdogMs);
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopped) {
      return;
    }
    if (this.watchdogId >= 0) {
      clearTimeout(this.watchdogId);
      this.watchdogId = -1;
    }
    this.setState('reconnecting');
    const wait = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, 30000);
    if (this.reconnectId >= 0) {
      clearTimeout(this.reconnectId);
    }
    this.reconnectId = setTimeout(() => {
      this.reconnectId = -1;
      this.connect();
    }, wait);
    this.startPollingIfDown();
  }

  /** 降级轮询：非 online 态 30s 一拍 /_sessions（事件经 CONVS_CHANGED；恢复 online 即停） */
  private startPollingIfDown(): void {
    if (this.pollId >= 0 || this.stopped) {
      return;
    }
    this.pollId = setInterval(() => {
      if (this.stopped || this.curState === 'online') {
        this.stopPolling();
        return;
      }
      const p: FlagPayload = { polled: true };
      EventBus.emit(EV.CONVS_CHANGED, p);
    }, 30000);
  }

  private stopPolling(): void {
    if (this.pollId >= 0) {
      clearInterval(this.pollId);
      this.pollId = -1;
    }
  }

  private feed(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.byteLength; i++) {
      this.buf.push(bytes[i]);
    }
    let nl = this.indexOfFrameEnd();
    while (nl >= 0) {
      const frameBytes: number[] = this.buf.splice(0, nl + 2);
      this.handleFrame(frameBytes);
      nl = this.indexOfFrameEnd();
    }
  }

  private indexOfFrameEnd(): number {
    for (let i = 0; i + 1 < this.buf.length; i++) {
      if (this.buf[i] === 0x0A && this.buf[i + 1] === 0x0A) {
        return i;
      }
    }
    return -1;
  }

  private handleFrame(frameBytes: number[]): void {
    const body = frameBytes.slice(0, frameBytes.length - 2);
    if (body.length === 0) {
      return;
    }
    const text = this.decoder2.decodeToString(new Uint8Array(body));
    const lines = text.split('\n');
    let data = '';
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('data:')) {
        data += lines[i].slice(5).replace(/^ /, '');
      }
    }
    if (data === '') {
      return; // 注释/心跳帧（无 data 行）
    }
    let ev: SseEvent | null = null;
    try {
      ev = JSON.parse(data) as SseEvent;
    } catch (e) {
      return;
    }
    if (ev !== null && ev.type !== 'server.heartbeat' && ev.type !== 'server.connected') {
      this.dispatch(ev);
    }
  }

  /** 事件表分发（M0.1 最小集；对齐 PWA handleEvent 主链） */
  private dispatch(ev: SseEvent): void {
    const p = ev.properties;
    if (p === null || p === undefined) {
      return;
    }
    const sidObj = p['sessionID'];
    let sid = typeof sidObj === 'string' ? sidObj : '';
    if (sid === '' && ev.type === 'session.updated') {
      const info = p['info'];
      if (info !== undefined && typeof info === 'object') {
        const infoRec = info as Record<string, Object>;
        const iid = infoRec['id'];
        if (typeof iid === 'string') {
          sid = iid;
        }
      }
    }
    if (ev.type === 'session.updated') {
      const f: FlagPayload = {};
      EventBus.emit(EV.CONVS_CHANGED, f);
      return;
    }
    if (ev.type === 'session.status') {
      const st = p['status'];
      if (st !== undefined && typeof st === 'object') {
        const stRec = st as Record<string, Object>;
        const t = stRec['type'];
        const b: SessionBusy = { sid: sid, busy: t === 'busy' };
        EventBus.emit(EV.SESSION_BUSY, b);
      }
      return;
    }
    if (ev.type === 'session.idle') {
      const b2: SessionBusy = { sid: sid, busy: false };
      EventBus.emit(EV.SESSION_BUSY, b2);
      return;
    }
    if (ev.type === 'message.part.delta') {
      const mid = p['messageID'];
      const pid = p['partID'];
      const field = p['field'];
      const delta = p['delta'];
      const d: MsgDelta = {
        sessionID: sid,
        messageID: typeof mid === 'string' ? mid : '',
        partID: typeof pid === 'string' ? pid : '',
        field: typeof field === 'string' ? field : 'text',
        delta: typeof delta === 'string' ? delta : ''
      };
      EventBus.emit(EV.MSG_DELTA, d);
      return;
    }
    if (ev.type === 'message.updated' || ev.type === 'message.part.updated') {
      const f2: MsgsChangedPayload = { deltaDone: true, sessionID: sid };
      EventBus.emit(EV.MSGS_CHANGED, f2);
      return;
    }
  }
}

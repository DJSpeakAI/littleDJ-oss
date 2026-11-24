// @提供 EV 事件名常量 + payload 接口表（§四：事件名+payload 集中定义，禁止裸字符串 emit） @依赖 -
// M0.1 task361
export class EV {
  /** 鉴权：通行证失效（401 拦截触发，页面应回登录页） */
  static readonly AUTH_EXPIRED: string = 'auth.expired';
  /** SSE：连接状态变化 connecting/online/reconnecting */
  static readonly SSE_STATE: string = 'sse.state';
  /** 会话列表数据变化 */
  static readonly CONVS_CHANGED: string = 'convs.changed';
  /** 当前会话消息整体变化（打开/对账/收尾） */
  static readonly MSGS_CHANGED: string = 'msgs.changed';
  /** 流式增量（仅当前会话） */
  static readonly MSG_DELTA: string = 'msg.delta';
  /** 会话忙闲变化 {sid, busy} */
  static readonly SESSION_BUSY: string = 'session.busy';
  /** hidden/会话面变化（xdevice 对账→侧栏重算，M2） */
  static readonly CONVS_HIDDEN: string = 'convs.hidden-changed';
}

/** SSE 流式增量 payload（对齐 PWA message.part.delta；sessionID 供域层过滤当前会话） */
export interface MsgDelta {
  sessionID: string;
  messageID: string;
  partID: string;
  field: string;   // text | reasoning
  delta: string;
}

/** 消息面变化 payload（recovered=断线恢复补账；deltaDone=流收尾校准；sessionID 过滤当前会话） */
export interface MsgsChangedPayload {
  recovered?: boolean;
  deltaDone?: boolean;
  sessionID?: string;
}

export interface SessionBusy {
  sid: string;
  busy: boolean;
}

export interface SseStatePayload {
  state: string; // connecting | online | reconnecting
}

export interface VoidPayload {}

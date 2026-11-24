// @提供 INetPort ISsePort 接口（§四：依赖倒置防环，domain 只 import 接口不 import 实现） @依赖 -
// M0.1 task361
export interface INetPort {
  /** JSON GET/POST；401 时经 EventBus 发 AUTH_EXPIRED 并抛错 */
  request(path: string, method: string, body: object | null): Promise<object>;
  /** 探活（返回 http code；网络级失败返回 -1） */
  ping(): Promise<number>;
}

export interface ISsePort {
  /** 目录级订阅（/api/event?directory=），事件经 EventBus 分发 */
  subscribe(directory: string): void;
  unsubscribe(): void;
  /** 当前连接态 connecting/online/reconnecting/idle */
  state(): string;
}

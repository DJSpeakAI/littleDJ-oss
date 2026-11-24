// @提供 EventBus typed 事件总线（§四：替代 window 全局互调，SSE→各域解耦） @依赖 core/events（仅类型）
// M0.1 task361：V1 体系纯 TS 类，无 UI 依赖
type Handler = (payload: object) => void;

export class EventBus {
  private static map: Map<string, Set<Handler>> = new Map<string, Set<Handler>>();

  static on(name: string, fn: Handler): void {
    let set = EventBus.map.get(name);
    if (!set) {
      set = new Set<Handler>();
      EventBus.map.set(name, set);
    }
    set.add(fn);
  }

  static off(name: string, fn: Handler): void {
    const set = EventBus.map.get(name);
    if (set) {
      set.delete(fn);
    }
  }

  static emit(name: string, payload: object): void {
    const set = EventBus.map.get(name);
    if (!set) {
      return;
    }
    set.forEach((fn: Handler) => {
      try {
        fn(payload);
      } catch (e) {
        // 单个订阅者异常不拖垮总线
      }
    });
  }

  static clear(): void {
    EventBus.map.clear();
  }
}

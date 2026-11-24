// @提供 XdeviceService inferBusy（跨端状态同步：15s hidden+30s sessions 签名 diff+先探后标+降级保护；1:1 移植 ui/src/stream/xdevice.js task338） @依赖 Net Store event-bus events
// M2 task361：方案 §六 M2 xdevice 行——SSE 只订阅当前目录，跨目录/跨设备忙态与归档变化靠本服务轮询对账
import { request } from '../../core/Net';
import { Store } from '../../store/Store';
import { EventBus } from '../../core/event-bus';
import { EV } from '../../core/events';

interface SessKeyRow {
  id: string;
  time: Object | undefined;
  title: Object | undefined;
  childCount: Object | undefined;
}

interface MsgRowLite {
  info: Record<string, Object>;
  parts: Array<Record<string, Object>> | undefined;
}

const XDEV_TICK_MS = 15000;      // 基础 tick：hidden 每 tick、sessions 每 2 tick（30s）
const XDEV_SESS_EVERY = 2;
const XDEV_PROBE_MAX = 3;        // 每轮探测上限（限探测不限判定；候选跨轮保留）
const ZOMBIE_MS = 5 * 60 * 1000; // 僵尸保护（对齐 PWA inferBusy 同款）

/** 会话签名：id|tu|title|childCount（PWA 同款；title/childCount 变化不带 tu 的漏检口） */
function sessKey(r: SessKeyRow): string {
  const t = r.time;
  let tu = 0;
  if (t !== undefined && typeof t === 'object') {
    const rec = t as Record<string, Object>;
    const u = rec['updated'];
    const c = rec['created'];
    tu = typeof u === 'number' ? u : (typeof c === 'number' ? c : 0);
  }
  const title = typeof r.title === 'string' ? r.title : '';
  const cc = typeof r.childCount === 'number' ? r.childCount : 0;
  return `${r.id}|${tu}|${title}|${cc}`;
}

/** inferBusy（1:1 移植 PWA session.js）：末条 running part/末条 user/assistant 未 completed=忙；5min 僵尸收口 */
export function inferBusy(msgs: Object[]): boolean {
  if (!msgs || msgs.length === 0) {
    return false;
  }
  const last = msgs[msgs.length - 1] as MsgRowLite;
  const info = last.info;
  const tRec = info['time'];
  const t = (tRec !== undefined && typeof tRec === 'object') ? tRec as Record<string, Object> : null;
  const tUpd = t !== null ? t['updated'] : undefined;
  const tCre = t !== null ? t['created'] : undefined;
  const lastTouch = typeof tUpd === 'number' ? tUpd : (typeof tCre === 'number' ? tCre : 0);
  const zombie = lastTouch > 0 && (Date.now() - lastTouch > ZOMBIE_MS);
  const parts = last.parts;
  if (parts !== undefined) {
    for (let i = 0; i < parts.length; i++) {
      const st = parts[i]['state'];
      if (st !== undefined && typeof st === 'object') {
        const status = (st as Record<string, Object>)['status'];
        if (status === 'running') {
          return !zombie;
        }
      }
    }
  }
  const role = info['role'];
  if (role === 'user') {
    return !zombie;
  }
  if (role === 'assistant') {
    const completed = t !== null ? t['completed'] : undefined;
    const created = t !== null ? t['created'] : undefined;
    // 回合未收口=在跑（末条 assistant 缺 completed；task341 思考窗口覆盖）
    if (completed === undefined && typeof created === 'number') {
      return !zombie;
    }
  }
  return false;
}

export class XdeviceService {
  private static timer: number = -1;
  private static tick: number = 0;
  private static busy: boolean = false;         // 单飞：慢网不叠加
  private static hiddenMemo: string = '';
  private static sessSeen: Map<string, string> = new Map<string, string>(); // id→签名
  private static probeQ: string[] = [];
  private static probeSet: Map<string, boolean> = new Map<string, boolean>();
  private static probeTry: Map<string, number> = new Map<string, number>();

  static start(): void {
    if (XdeviceService.timer >= 0) {
      return;
    }
    XdeviceService.timer = setInterval(() => {
      XdeviceService.reconcile();
    }, XDEV_TICK_MS);
    XdeviceService.reconcile();
  }

  static stop(): void {
    if (XdeviceService.timer >= 0) {
      clearInterval(XdeviceService.timer);
      XdeviceService.timer = -1;
    }
  }

  /** 前后台：回前台立即对账+定时器自愈（系统冻结可能杀 timer，产出审 P1-2） */
  static onForeground(): void {
    if (XdeviceService.timer < 0) {
      XdeviceService.start(); // 幂等重启（start 内含立即 reconcile）
      return;
    }
    XdeviceService.reconcile();
  }

  private static reconcile(): void {
    if (XdeviceService.busy) {
      return;
    }
    XdeviceService.busy = true;
    const jobs: Array<Promise<void>> = [];
    // hidden 每 tick
    jobs.push(request('/_hidden-sessions', 'GET', null).then((data: object) => {
      XdeviceService.applyHidden(data);
    }).catch((_e: Error) => {
      // 拉取失败：memo 不动，下轮重试
    }));
    // sessions 每 2 tick
    const first = XdeviceService.sessSeen.size === 0;
    const doSess = first || (XdeviceService.tick % XDEV_SESS_EVERY === 0);
    XdeviceService.tick += 1;
    if (doSess) {
      jobs.push(request('/_sessions', 'GET', null).then((data: object) => {
        XdeviceService.applySessions(data);
      }).catch((_e: Error) => {
      }));
    }
    Promise.all(jobs).then(() => {
      XdeviceService.busy = false;
    }, () => {
      XdeviceService.busy = false;
    });
  }

  /** hidden 降级保护：ok!==true/warning/非数组=保留旧值（防全站归档复活；PWA P1-3 同款） */
  private static applyHidden(data: object): void {
    const rec = data as Record<string, Object>;
    if (rec['ok'] !== true || rec['warning'] !== undefined) {
      return;
    }
    const arr = rec['hidden'];
    if (arr === undefined || !Array.isArray(arr)) {
      return;
    }
    const ids = arr as Object[];
    const key = ids.map((x: Object) => `${x}`).sort().join(',');
    if (key === XdeviceService.hiddenMemo) {
      return;
    }
    XdeviceService.hiddenMemo = key;
    const set = new Set<string>();
    ids.forEach((x: Object) => {
      const s = `${x}`;
      if (s !== '') {
        set.add(s);
      }
    });
    Store.setHidden(set);
    // hidden 变化显式刷列表（签名不含 hidden，靠本路径）
    const h: Record<string, Object> = {}; EventBus.emit(EV.CONVS_HIDDEN, h);
  }

  /** sessions 签名 diff：空清空型响应保留旧值（PWA 复审 P1-4 同款）；首跑只建基线不探测 */
  private static applySessions(data: object): void {
    if (!Array.isArray(data)) {
      return;
    }
    const list = data as Object[];
    if (list.length === 0 && XdeviceService.sessSeen.size > 0) {
      return; // 清空型异常响应
    }
    const firstRun = XdeviceService.sessSeen.size === 0;
    const oldSeen = firstRun ? 0 : XdeviceService.sessSeen.size;
    const next: Map<string, string> = new Map<string, string>();
    const woke: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const row = list[i] as Record<string, Object>;
      const idObj = row['id'];
      if (typeof idObj !== 'string' || idObj === '') {
        continue;
      }
      const kr: SessKeyRow = {
        id: idObj,
        time: row['time'],
        title: row['title'],
        childCount: row['childCount']
      };
      const k = sessKey(kr);
      next.set(idObj, k);
      const seen = XdeviceService.sessSeen.get(idObj);
      if (seen === undefined || seen !== k) {
        woke.push(idObj);
      }
    }
    XdeviceService.sessSeen = next;
    // P1-4：删除检测（旧有新无→changed，PWA 同构）
    const removed = next.size < oldSeen;
    if (woke.length === 0 && !removed) {
      return;
    }
    if (!firstRun) {
      woke.forEach((sid: string) => {
        const queued = XdeviceService.probeSet.get(sid) === true;
        if (!queued) { // P1-1：已忙也入队（签名变化即候选——清忙靠探测回落；限流 3 名额保持）
          XdeviceService.probeSet.set(sid, true);
          XdeviceService.probeTry.delete(sid);
          XdeviceService.probeQ.push(sid);
        }
      });
    }
    // 数据变化刷新列表（含 hidden 过滤后的重绘）+探测跟在数据落地后
    const h: Record<string, Object> = {};
    EventBus.emit(EV.CONVS_HIDDEN, h);
    XdeviceService.probe();
  }
  /** 先探后标：拉 message 用 inferBusy 判忙，忙才标（宁缺勿假，PWA P0-2） */
  private static probe(): void {
    let n = 0;
    while (XdeviceService.probeQ.length > 0 && n < XDEV_PROBE_MAX) {
      const sid = XdeviceService.probeQ.shift() as string;
      XdeviceService.probeSet.delete(sid);
      if (sid === '') {
        continue;
      }
      n += 1;
      request(`/api/session/${encodeURIComponent(sid)}/message`, 'GET', null).then((data: object) => {
        XdeviceService.probeTry.delete(sid);
        if (!Array.isArray(data)) {
          return;
        }
        const busy = inferBusy(data as Object[]);
        // 产出审 P1-1：忙态回落——probe 判闲且本地标着忙 → 清掉（否则跨目录会话「进行中」永驻；
        // 完整 6s 对账 reconcileBusySessions 属 M2.1，此处探测沿即回落）
        if (!busy && Store.convBusy(sid)) {
          Store.markBusy(sid, false);
          return;
        }
        if (busy) {
          Store.markBusy(sid, true);
        }
      }).catch((_e: Error) => {
        // 失败重入队尾 ≤2 次（防一次网络抖动永久漏标）
        const tries = (XdeviceService.probeTry.get(sid) || 0) + 1;
        XdeviceService.probeTry.set(sid, tries);
        if (tries <= 2 && XdeviceService.probeSet.get(sid) !== true) {
          XdeviceService.probeSet.set(sid, true);
          XdeviceService.probeQ.push(sid);
        }
      });
    }
  }
}

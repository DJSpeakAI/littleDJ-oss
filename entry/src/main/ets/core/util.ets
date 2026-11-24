// @提供 fmtTime fmtDate deviceModel shortUid debounce @依赖 -
// M0.1 task361：通用工具（时间/机型/防抖）
import { deviceInfo } from '@kit.BasicServicesKit';

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 机型标识（UA 与 /_login 设备名共用，R9：固定机型后缀便于设备管理识别） */
export function deviceModel(): string {
  return deviceInfo.marketName || deviceInfo.productModel || 'HarmonyOS';
}

export function shortUid(): string {
  return `m${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

export function debounce<T extends object>(fn: (arg: T) => void, ms: number): (arg: T) => void {
  let timer: number = -1;
  return (arg: T): void => {
    if (timer >= 0) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn(arg);
    }, ms);
  };
}

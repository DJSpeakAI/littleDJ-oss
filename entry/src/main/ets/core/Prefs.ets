// @提供 Prefs 轻量偏好（@ohos.data.preferences；命名 littledj.*，P2-13 新装无旧数据非迁移） @依赖 -
// M0.1 task361：context 由 EntryAbility 启动时注入；API26 用 getSync（旧 getXxxSync 已更名）
import { preferences } from '@kit.ArkData';
import { Context } from '@kit.AbilityKit';

const FILE_NAME = 'littledj';

export class Prefs {
  private static store: preferences.Preferences | null = null;

  static init(ctx: Context): void {
    if (!Prefs.store) {
      try {
        Prefs.store = preferences.getPreferencesSync(ctx, { name: FILE_NAME });
      } catch (e) {
        Prefs.store = null;
      }
    }
  }

  static getString(key: string, def: string): string {
    if (!Prefs.store) {
      return def;
    }
    try {
      const v: preferences.ValueType = Prefs.store.getSync(`littledj.${key}`, def);
      return typeof v === 'string' ? v : def;
    } catch (e) {
      return def;
    }
  }

  static setString(key: string, val: string): void {
    if (!Prefs.store) {
      return;
    }
    try {
      Prefs.store.putSync(`littledj.${key}`, val);
      Prefs.store.flush();
    } catch (e) {
      // 写失败静默（下次启动重写）
    }
  }

  static getBool(key: string, def: boolean): boolean {
    if (!Prefs.store) {
      return def;
    }
    try {
      const v: preferences.ValueType = Prefs.store.getSync(`littledj.${key}`, def);
      return typeof v === 'boolean' ? v : def;
    } catch (e) {
      return def;
    }
  }

  static setBool(key: string, val: boolean): void {
    if (!Prefs.store) {
      return;
    }
    try {
      Prefs.store.putSync(`littledj.${key}`, val);
      Prefs.store.flush();
    } catch (e) {
      // 写失败静默
    }
  }
}

// @提供 Vault 通行证安全存储（@ohos.security.asset；密码永不落盘，P1-3） @依赖 -
// M0.1 task361：存 dj_pass 通行证 + did；卸载 App 即清除（设备级隔离）
import { asset } from '@kit.AssetStoreKit';
import { util } from '@kit.ArkTS';
import { BusinessError } from '@kit.BasicServicesKit';

const ALIAS_DJPASS = 'littledj.dj_pass';
const ALIAS_DID = 'littledj.did';

function toBytes(s: string): Uint8Array {
  return new util.TextEncoder().encodeInto(s);
}

function fromBytes(u: Uint8Array): string {
  return util.TextDecoder.create('utf-8').decodeToString(u);
}

function baseMap(alias: string): asset.AssetMap {
  const m: asset.AssetMap = new Map<asset.Tag, asset.Value>();
  m.set(asset.Tag.ALIAS, toBytes(alias));
  m.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED);
  return m;
}

export class Vault {
  /** 存通行证（add 冲突 24000003 时先删再存） */
  static savePass(token: string, did: string): Promise<boolean> {
    return Vault.removePass().then(() => {
      try {
        const m = baseMap(ALIAS_DJPASS);
        m.set(asset.Tag.SECRET, toBytes(token));
        return asset.add(m);
      } catch (e) {
        return Promise.reject(new Error('写入通行证失败'));
      }
    }).then(() => {
      try {
        const m2 = baseMap(ALIAS_DID);
        m2.set(asset.Tag.SECRET, toBytes(did));
        return asset.add(m2);
      } catch (e) {
        return Promise.reject(new Error('写入设备号失败'));
      }
    }).then(() => true).catch(() => false);
  }

  static loadPass(): Promise<string> {
    const q: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    q.set(asset.Tag.ALIAS, toBytes(ALIAS_DJPASS));
    q.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL);
    return asset.query(q).then((res: Array<asset.AssetMap>) => {
      if (!res.length) {
        return '';
      }
      const v = res[0].get(asset.Tag.SECRET);
      if (v instanceof Uint8Array) {
        return fromBytes(v);
      }
      return '';
    }).catch(() => '');
  }

  static removePass(): Promise<void> {
    const q: asset.AssetMap = new Map<asset.Tag, asset.Value>();
    q.set(asset.Tag.ALIAS, toBytes(ALIAS_DJPASS));
    return asset.remove(q).catch((e: BusinessError) => {
      // 24000002 = The asset is not found（视为已清空）；其余转普通错误上抛
      // （真机实证 2026-11-16：not found 码=24000002；24000007 是 corrupted）
      if (e.code !== 24000002) {
        throw new Error(`清除通行证失败：${e.message}`);
      }
    });
  }
}

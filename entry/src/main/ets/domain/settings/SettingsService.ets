// @提供 SettingsService（设置域：模型列表过滤/Key 卡/激活切换/余额；PWA data.js loadModels+settings.js 1:1） @依赖 Net Store Prefs
// M3 task361：模型过滤口径同 PWA（deepseek 仅 flash/v4-pro；ALLOW 两家；toolcall）；选中模型 Prefs 持久化 littledj.model
import { request } from '../../core/Net';
import { Store, ModelItem, KeyCard } from '../../store/Store';
import { Prefs } from '../../core/Prefs';

export { ModelItem, KeyCard };

export interface ProviderModels {
  id: string;
  models: Record<string, Object>;
}

const LABEL_ZHIPU = '智谱 Token Plan';
const LABEL_DS = 'DeepSeek 官方';

export class SettingsService {
  /** 模型列表（GET /api/config/providers 过滤同 PWA loadModels） */
  static loadModels(restoreOnly?: boolean): Promise<ModelItem[]> {
    return request('/api/config/providers', 'GET', null).then((data: object) => {
      const rec = data as Record<string, Object>;
      const arr = rec['providers'];
      const out: ModelItem[] = [];
      if (arr !== undefined && Array.isArray(arr)) {
        const provs = arr as Object[];
        provs.forEach((praw: Object) => {
          const p = praw as Record<string, Object>;
          const pid = `${p['id']}`;
          const models = p['models'];
          if (models === undefined || typeof models !== 'object') {
            return;
          }
          const mrec = models as Record<string, Object>;
          Object.keys(mrec).forEach((mid: string) => {
            // PWA 同口径：deepseek 白名单两家；仅 ALLOW 供应商；toolcall!==false
            if (pid === 'deepseek' && mid !== 'deepseek-flash' && mid !== 'deepseek-v4-pro') {
              return;
            }
            if (pid !== 'deepseek' && pid !== 'zhipuai-coding-plan') {
              return;
            }
            const info = mrec[mid] as Record<string, Object>;
            const caps = info['capabilities'];
            if (caps !== undefined && typeof caps === 'object' && (caps as Record<string, Object>)['toolcall'] === false) {
              return;
            }
            const nm = info['name'];
            const it = new ModelItem(pid, mid, typeof nm === 'string' ? nm : mid, pid === 'zhipuai-coding-plan' ? LABEL_ZHIPU : LABEL_DS);
            out.push(it);
          });
        });
      }
      out.sort((a: ModelItem, b: ModelItem): number => {
        if (a.pname === b.pname) {
          return a.name < b.name ? -1 : 1;
        }
        return a.pname < b.pname ? -1 : 1;
      });
      Store.setModels(out);
      // Prefs 恢复选中（littledj.model——PWA localStorage 同键名语义）
      const saved = Prefs.getString('model', '');
      if (saved !== '') {
        try {
          const sm = JSON.parse(saved) as Record<string, Object>;
          const sp = `${sm['providerID']}`;
          const si = `${sm['modelID']}`;
          for (let i = 0; i < out.length; i++) {
            if (out[i].providerID === sp && out[i].modelID === si) {
              Store.setCurModel(out[i]);
              break;
            }
          }
        } catch (e) {
          // 坏档忽略用默认
        }
      }
      if (!restoreOnly && Store.curModel() === null && out.length > 0) {
        Store.setCurModel(out[0]);
      }
      return out;
    });
  }

  /** 选中模型持久化（Prefs littledj.model 同 PWA 语义） */
  static pickModel(m: ModelItem): void {
    Store.setCurModel(m);
    const j = `{"providerID":"${m.providerID}","modelID":"${m.modelID}"}`;
    Prefs.setString('model', j);
  }

  /** 当前选中（send 用；null=不带 model 字段走会话默认） */
  static curModelJson(): Record<string, Object> | null {
    const m = Store.curModel();
    if (m === null) {
      return null;
    }
    const j: Record<string, Object> = { 'providerID': m.providerID, 'modelID': m.modelID };
    return j;
  }

  /** Key 卡列表（GET /_settings/zhipu） */
  static loadKeys(): Promise<KeyCard[]> {
    return request('/_settings/zhipu', 'GET', null).then((data: object) => {
      const rec = data as Record<string, Object>;
      const arr = rec['keys'];
      const out: KeyCard[] = [];
      if (arr !== undefined && Array.isArray(arr)) {
        (arr as Object[]).forEach((raw: Object) => {
          const r = raw as Record<string, Object>;
          const nm = r['name'];
          const mk = r['masked'];
          if (typeof nm === 'string' && typeof mk === 'string') {
            out.push(new KeyCard(nm, mk, r['active'] === true));
          }
        });
      }
      Store.setKeys(out);
      return out;
    }).catch(() => []);
  }

  /** 激活切换（POST /_settings/zhipu/active {name}） */
  static activateKey(name: string): Promise<boolean> {
    const body: Record<string, Object> = { 'name': name };
    return request('/_settings/zhipu/active', 'POST', body).then((data: object) => {
      const rec = data as Record<string, Object>;
      return rec['ok'] === true;
    }).catch(() => false);
  }

  /** 余额（POST /_settings/deepseek/balance） */
  static balance(): Promise<string> {
    return request('/_settings/deepseek/balance', 'POST', JSON.parse('{}') as Record<string, Object>).then((data: object) => {
      const rec = data as Record<string, Object>;
      const bal = rec['balance'];
      if (typeof bal === 'string' && bal !== '') {
        return bal;
      }
      if (typeof bal === 'number') {
        return `¥${bal.toFixed(2)}`;
      }
      const info = rec['info'];
      if (info !== undefined && typeof info === 'object') {
        const b2 = (info as Record<string, Object>)['balance'];
        if (typeof b2 === 'number') {
          return `¥${b2.toFixed(2)}`;
        }
      }
      return '—';
    }).catch(() => '—');
  }
}

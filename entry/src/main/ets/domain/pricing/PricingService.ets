// @提供 PricingService（M5 比价：/_pricing 三源模型价目；PWA pricing 域只读版） @依赖 Net Store
// M5 task361：providers[].models[] 行（name/contextText/price 三档两峰）——设置页比价区块
import { request } from '../../core/Net';
import { Store, PriceRow } from '../../store/Store';

function y(v: Object | undefined): string {
  return typeof v === 'number' ? `${v}` : '—';
}

export class PricingService {
  static load(): Promise<number> {
    return request('/_pricing', 'GET', null).then((data: object) => {
      const rec = data as Record<string, Object>;
      const d = rec['data'];
      if (d === undefined || typeof d !== 'object') {
        return 0;
      }
      const dRec = d as Record<string, Object>;
      const provs = dRec['providers'];
      const out: Array<PriceRow> = [];
      if (provs !== undefined && Array.isArray(provs)) {
        (provs as Object[]).forEach((praw: Object) => {
          const p = praw as Record<string, Object>;
          const pname = `${p['provider']}`;
          const models = p['models'];
          if (models === undefined || !Array.isArray(models)) {
            return;
          }
          (models as Object[]).forEach((mraw: Object) => {
            const m = mraw as Record<string, Object>;
            const nm = m['name'];
            if (typeof nm !== 'string') {
              return;
            }
            const ctxRaw = m['contextText'];
            const price = m['price'];
            let ih = '—';
            let im = '—';
            let op = '—';
            if (price !== undefined && typeof price === 'object') {
              const pr = price as Record<string, Object>;
              const ihO = pr['inputHit'];
              if (ihO !== undefined && typeof ihO === 'object') {
                const r = ihO as Record<string, Object>;
                ih = `${y(r['peak'])}/${y(r['offpeak'])}`;
              }
              const imO = pr['inputMiss'];
              if (imO !== undefined && typeof imO === 'object') {
                const r2 = imO as Record<string, Object>;
                im = `${y(r2['peak'])}/${y(r2['offpeak'])}`;
              }
              const opO = pr['output'];
              if (opO !== undefined && typeof opO === 'object') {
                const r3 = opO as Record<string, Object>;
                op = `${y(r3['peak'])}/${y(r3['offpeak'])}`;
              }
            }
            out.push(new PriceRow(pname, nm, typeof ctxRaw === 'string' ? ctxRaw : '', ih, im, op));
          });
        });
      }
      Store.setPrices(out);
      return out.length;
    }).catch(() => 0);
  }
}

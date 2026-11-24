// @提供 AgentCardData agentCardOf（任务回报卡数据提取：<task id= state= 注入解析；PWA taskInjectedOf/parseTaskInjected 1:1） @依赖 parser
// M2.5 task361：core 纯逻辑层（store/components/domain 共用——防 store→domain 逆层）
import { MdToken, mdTokensOf } from './markdown/parser';

export class AgentCardData {
  id: string;
  state: string;
  summary: string;
  result: string;
  tokens: MdToken[];
  constructor(id: string, state: string, summary: string, result: string) {
    this.id = id;
    this.state = state;
    this.summary = summary;
    this.result = result;
    this.tokens = mdTokensOf(result);
  }
}

/** 从消息 parts 提取 <task 注入（对齐 PWA taskInjectedOf：type=text 且含 <task id=）
 * core 侧接口：parts 用 object 宽收（ChatService 调用点自行 as object[]） */
export interface PartLite {
  type: string;
  text: string;
}
export function agentCardOf(parts: object | null | undefined): AgentCardData | null {
  if (parts === null || parts === undefined || !Array.isArray(parts)) {
    return null;
  }
  const rows = parts as object[];
  let t = '';
  rows.forEach((p: object) => {
    const r = p as Record<string, Object>;
    if (r['type'] === 'text' && typeof r['text'] === 'string' && /<task\s+id=/.test(r['text'] as string)) {
      t += (t === '' ? '' : '\n') + r['text'];
    }
  });
  if (t === '') {
    return null;
  }
  const m = /<task\s+id="([^"]+)"[^>]*state="([^"]+)"/.exec(t);
  const id = m !== null && m.length > 1 ? m[1] : '';
  const state = m !== null && m.length > 2 ? m[2] : '';
  const sum = /<summary>([\s\S]*?)<\/summary>/.exec(t);
  const res = /<task_result>([\s\S]*?)<\/task_result>/.exec(t);
  const summary = sum !== null && sum.length > 1 ? (sum[1] as string).trim() : '';
  const result = ((res !== null && res.length > 1 ? (res[1] as string) : t)).trim();
  return new AgentCardData(id, state, summary, result);
}

// @提供 MdToken InlineSpan parseInline parseMd mdTokensOf（markdown-lite 解析器纯函数，P2-4 解析侧；1:1 对齐 ui/src/app/markdown.js 支持集） @依赖 -
// M1 task361：支持集=PWA 同款（代码块/h1-3/ul/ol/blockquote/hr/段落/行内 code·加粗·链接）；表格/折叠卡 PWA 无此能力不造
export type MdTokenKind = 'code' | 'heading' | 'list' | 'quote' | 'hr' | 'para';

export type InlineKind = 'plain' | 'code' | 'bold' | 'link';

export class InlineSpan {
  kind: InlineKind;
  text: string;
  url: string;
  constructor(kind: InlineKind, text: string, url: string) {
    this.kind = kind;
    this.text = text;
    this.url = url;
  }
}

export class MdToken {
  kind: MdTokenKind;
  level: number;          // heading 1-3
  lang: string;           // code 语言标注（可空）
  code: string;           // code 正文
  ordered: boolean;       // list
  items: InlineSpan[][];  // list 项
  spans: InlineSpan[];    // heading/quote/para 行
  lines: InlineSpan[][];  // para 多行（行间 <br>）
  constructor(kind: MdTokenKind) {
    this.kind = kind;
    this.level = 0;
    this.lang = '';
    this.code = '';
    this.ordered = false;
    this.items = [];
    this.spans = [];
    this.lines = [];
  }
}

/** 行内解析：`code` **bold** [text](url)（对齐 PWA inline；ArkTS Text/Span 天然免 esc） */
export function parseInline(s: string): InlineSpan[] {
  const out: InlineSpan[] = [];
  let rest = s;
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/;
  while (rest !== '') {
    const m = rest.match(re);
    if (m === null || m.index === undefined) {
      out.push(new InlineSpan('plain', rest, ''));
      break;
    }
    if (m.index > 0) {
      out.push(new InlineSpan('plain', rest.slice(0, m.index), ''));
    }
    if (m[1] !== undefined) {
      out.push(new InlineSpan('code', m[1], ''));
    } else if (m[2] !== undefined) {
      out.push(new InlineSpan('bold', m[2], ''));
    } else if (m[3] !== undefined && m[4] !== undefined) {
      out.push(new InlineSpan('link', m[3], m[4]));
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}


/** 段落聚合（对齐 PWA mdInline：空行分段，段内行以 <br> 连） */
function parseBlocks(seg: string, tokens: MdToken[]): void {
  const lines = seg.split('\n');
  let para: MdToken | null = null;
  let list: MdToken | null = null;
  const closePara = (): void => {
    para = null;
  };
  const closeList = (): void => {
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '') {
      closePara();
      closeList();
      continue;
    }
    let m = raw.match(/^###\s+/);
    if (m !== null) {
      closePara(); closeList();
      const t = new MdToken('heading');
      t.level = 3;
      t.spans = parseInline(raw.replace(/^###\s+/, ''));
      tokens.push(t);
      continue;
    }
    m = raw.match(/^##\s+/);
    if (m !== null) {
      closePara(); closeList();
      const t = new MdToken('heading');
      t.level = 2;
      t.spans = parseInline(raw.replace(/^##\s+/, ''));
      tokens.push(t);
      continue;
    }
    m = raw.match(/^#\s+/);
    if (m !== null) {
      closePara(); closeList();
      const t = new MdToken('heading');
      t.level = 1;
      t.spans = parseInline(raw.replace(/^#\s+/, ''));
      tokens.push(t);
      continue;
    }
    m = raw.match(/^\s*[-*+]\s+/);
    if (m !== null) {
      closePara();
      if (list === null || list.ordered) {
        closeList();
        list = new MdToken('list');
        list.ordered = false;
        tokens.push(list);
      }
      const itemSpans = parseInline(raw.replace(/^\s*[-*+]\s+/, ''));
      list.items.push(itemSpans);
      continue;
    }
    m = raw.match(/^\s*\d+\.\s+/);
    if (m !== null) {
      closePara();
      if (list === null || !list.ordered) {
        closeList();
        list = new MdToken('list');
        list.ordered = true;
        tokens.push(list);
      }
      const itemSpans = parseInline(raw.replace(/^\s*\d+\.\s+/, ''));
      list.items.push(itemSpans);
      continue;
    }
    m = raw.match(/^\s*>\s?/);
    if (m !== null) {
      closePara(); closeList();
      const t = new MdToken('quote');
      t.spans = parseInline(raw.replace(/^\s*>\s?/, ''));
      tokens.push(t);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(raw)) {
      closePara(); closeList();
      tokens.push(new MdToken('hr'));
      continue;
    }
    // 段落行：打断开着的 list（产出审 P1-2：对齐 PWA closeList()——否则「列表→段落→列表」
    // 会被并成「一个列表吞掉中间段落」，渲染顺序错，node 复现实锤）
    if (list !== null) {
      closeList();
    }
    if (para === null) {
      para = new MdToken('para');
      tokens.push(para);
    }
    para.lines.push(parseInline(raw));
  }
}

/** md 全文解析：``` 切代码块（首行<24 字符视为语言标注，对齐 PWA）；其余走块解析 */
export function parseMd(src: string): MdToken[] {
  const text = src === null || src === undefined ? '' : String(src);
  const blocks = text.split('```');
  const tokens: MdToken[] = [];
  for (let i = 0; i < blocks.length; i++) {
    if (i % 2 === 1) {
      let body = blocks[i];
      const nl = body.indexOf('\n');
      if (nl >= 0 && body.slice(0, nl).length < 24 && body.slice(0, nl).trim() !== '') {
        body = body.slice(nl + 1);
      }
      const t = new MdToken('code');
      t.code = body.replace(/\n$/, '');
      const head = blocks[i].slice(0, blocks[i].indexOf('\n'));
      t.lang = nl >= 0 && head.length < 24 ? head.trim() : '';
      tokens.push(t);
    } else {
      parseBlocks(blocks[i], tokens);
    }
  }
  return tokens;
}

/** 便捷：空文本给空树（流式中不解析由调用方控制） */
export function mdTokensOf(src: string): MdToken[] {
  if (src.trim() === '') {
    return [];
  }
  return parseMd(src);
}

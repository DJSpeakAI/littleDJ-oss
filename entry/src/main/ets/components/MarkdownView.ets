// @提供 MarkdownView（token 树→ArkUI 渲染：代码块/标题/列表/引用/hr/段落/行内 code·加粗·链接；P2-4 渲染侧） @依赖 parser theme
// M1 task361：components 层组件；tokens 普通成员（msgRow 行级重建即重渲）；
// ⚠S：ForEach key 必须带 token 索引全局唯一（同长度行 key 撞车=行被吞，真机实锤）
import { pasteboard } from '@kit.BasicServicesKit';
import { MdToken, InlineSpan } from '../core/markdown/parser';
import { THEME } from '../core/theme';

@Component
export struct MarkdownView {
  tokens: MdToken[] = [];

  @Builder
  spanOne(s: InlineSpan, ti: number) {
    if (s.kind === 'code') {
      Span(s.text).fontColor($r('app.color.warn')).fontFamily('monospace').fontSize(THEME.FONT_MSG - 1)
    } else if (s.kind === 'bold') {
      Span(s.text).fontWeight(FontWeight.Bold)
    } else if (s.kind === 'link') {
      Span(s.text).fontColor($r('app.color.accent')).decoration({ type: TextDecorationType.Underline })
    } else {
      Span(s.text)
    }
  }

  @Builder
  spanList(spans: InlineSpan[], ti: number) {
    ForEach(spans, (s: InlineSpan, i: number) => {
      this.spanOne(s, ti)
    }, (s: InlineSpan, i: number) => `sp_${ti}_${i}_${s.kind}_${s.text.length}_${s.text.slice(0, 12)}`)
  }

  @Builder
  codeBlock(t: MdToken, ti: number) {
    Column() {
      Row() {
        if (t.lang !== '') {
          Text(t.lang).fontSize(THEME.FONT_SUB - 2).fontColor($r('app.color.faint')).layoutWeight(1)
        } else {
          Blank().layoutWeight(1)
        }
        Text('复制')
          .fontSize(THEME.FONT_SUB - 2)
          .fontColor($r('app.color.sub'))
          .padding({ left: 8, right: 4, top: 2, bottom: 2 })
          .onClick(() => {
            this.copyCode(t.code);
          })
      }
      .width('100%')
      Text(t.code)
        .fontSize(THEME.FONT_MSG - 2)
        .fontFamily('monospace')
        .fontColor($r('app.color.text'))
        .width('100%')
        .textAlign(TextAlign.Start)
    }
    .width('100%')
    .padding(THEME.PAD_CARD)
    .borderRadius(THEME.RADIUS_CARD)
    .backgroundColor($r('app.color.bg2'))
    .margin({ top: 4, bottom: 4 })
  }

  private copyCode(code: string): void {
    try {
      const d = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, code);
      pasteboard.getSystemPasteboard().setData(d);
    } catch (e) {
      // 复制失败静默（低频辅助功能）
    }
  }

  @Builder
  tokenView(t: MdToken, ti: number) {
    if (t.kind === 'code') {
      this.codeBlock(t, ti)
    } else if (t.kind === 'heading') {
      Text() {
        this.spanList(t.spans, ti)
      }
      .fontSize(t.level === 1 ? THEME.FONT_MSG + 5 : t.level === 2 ? THEME.FONT_MSG + 3 : THEME.FONT_MSG + 1)
      .fontWeight(FontWeight.Bold)
      .fontColor($r('app.color.text'))
      .margin({ top: 6, bottom: 2 })
      .width('100%')
      .textAlign(TextAlign.Start)
    } else if (t.kind === 'list') {
      Column({ space: 2 }) {
        ForEach(t.items, (item: InlineSpan[], i: number) => {
          Row({ space: 6 }) {
            Text(t.ordered ? `${i + 1}.` : '•')
              .fontSize(THEME.FONT_MSG)
              .fontColor($r('app.color.accent'))
            Text() {
              this.spanList(item, ti)
            }
            .fontSize(THEME.FONT_MSG)
            .fontColor($r('app.color.text'))
            .layoutWeight(1)
            .textAlign(TextAlign.Start)
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)
        }, (item: InlineSpan[], i: number) => `li_${ti}_${i}_${item.length}_${item.length > 0 ? item[0].text.slice(0, 10) : ''}`)
      }
      .width('100%')
      .alignItems(HorizontalAlign.Start)
      .margin({ top: 2, bottom: 2 })
    } else if (t.kind === 'quote') {
      Row({ space: 8 }) {
        Column()
          .width(3)
          .height('100%')
          .backgroundColor($r('app.color.line2'))
        Text() {
          this.spanList(t.spans, ti)
        }
        .fontSize(THEME.FONT_MSG - 1)
        .fontColor($r('app.color.sub'))
        .layoutWeight(1)
        .textAlign(TextAlign.Start)
      }
      .width('100%')
      .alignItems(VerticalAlign.Top)
      .padding({ left: 4, top: 2, bottom: 2 })
    } else if (t.kind === 'hr') {
      Divider().color($r('app.color.line')).margin({ top: 6, bottom: 6 })
    } else {
      // 段落：行间换行
      Column({ space: 0 }) {
        ForEach(t.lines, (line: InlineSpan[], i: number) => {
          Text() {
            this.spanList(line, ti)
          }
          .fontSize(THEME.FONT_MSG)
          .fontColor($r('app.color.text'))
          .width('100%')
          .textAlign(TextAlign.Start)
        }, (line: InlineSpan[], i: number) => `p_${ti}_${i}_${line.length}_${line.length > 0 ? line[0].text.slice(0, 10) : ''}`)
      }
      .width('100%')
      .margin({ top: 2, bottom: 2 })
    }
  }

  build() {
    Column({ space: 0 }) {
      ForEach(this.tokens, (t: MdToken, i: number) => {
        this.tokenView(t, i)
      }, (t: MdToken, i: number) => `tk_${i}_${t.kind}_${t.code.length}_${t.spans.length}_${t.items.length}_${t.lines.length}`)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}


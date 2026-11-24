// @提供 AgentCardView（任务回报卡：badge+summary+状态标+可折叠 md 详情；PWA renderTaskInjected 1:1） @依赖 AgentCard theme MarkdownView util
// M2.5 task361：识别 message parts 中 <task id= state=> 注入文本（taskInjectedOf 同构）
import { THEME } from '../core/theme';
import { fmtTime } from '../core/util';
import { MarkdownView } from './MarkdownView';
import { AgentCardData } from '../core/AgentCard';

@Component
export struct AgentCardView {
  card: AgentCardData = new AgentCardData('', '', '', '');
  @State open: boolean = false;

  private stateLabel(): string {
    if (this.card.state === 'completed') { return '完成'; }
    if (this.card.state === 'error') { return '失败'; }
    return '回报';
  }

  private stateColor() {
    if (this.card.state === 'completed') { return $r('app.color.accent'); }
    if (this.card.state === 'error') { return $r('app.color.err'); }
    return $r('app.color.warn');
  }

  build() {
    Column() {
      Row({ space: 6 }) {
        Text('◇ 任务回报')
          .fontSize(THEME.FONT_SUB)
          .fontColor($r('app.color.accent'))
        Text(this.card.summary === '' ? `任务 ${this.card.id.slice(0, 12)}` : this.card.summary)
          .fontSize(THEME.FONT_SUB)
          .fontColor($r('app.color.text'))
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.stateLabel())
          .fontSize(THEME.FONT_SUB - 1)
          .fontColor(this.stateColor())
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(6)
          .backgroundColor($r('app.color.card'))
        Text(this.open ? '▲' : '▼')
          .fontSize(THEME.FONT_SUB - 1)
          .fontColor($r('app.color.faint'))
      }
      .width('100%')
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .onClick(() => {
        this.open = !this.open;
      })

      if (this.open) {
        Divider().color($r('app.color.line')).margin({ left: 10, right: 10 })
        Column() {
          MarkdownView({ tokens: this.card.tokens })
        }
        .width('100%')
        .padding({ left: 10, right: 10, top: 4, bottom: 6 })
        .alignItems(HorizontalAlign.Start)
        .constraintSize({ maxHeight: 360 })
      }
    }
    .width('100%')
    .borderRadius(THEME.RADIUS_CARD)
    .backgroundColor($r('app.color.card2'))
    .border({ width: 1, color: $r('app.color.line') })
    .margin({ top: 4, bottom: 4 })
  }
}

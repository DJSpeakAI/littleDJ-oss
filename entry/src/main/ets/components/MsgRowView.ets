// @提供 MsgRowView（消息行：气泡+md+流式光标+diff 卡） @依赖 Store theme MarkdownView EditCardView AgentCardView
// M2.1 task361：m 普通成员（LazyForEach 行级重建重渲，同 MarkdownView 机制）
import { MsgItem } from '../store/Store';
import { THEME } from '../core/theme';
import { MarkdownView } from './MarkdownView';
import { EditCardView } from './EditCardView';
import { pasteboard } from '@kit.BasicServicesKit';
import { AgentCardView } from './AgentCardView';

@Component
export struct MsgRowView {
  msg: MsgItem = new MsgItem('', 'assistant', '', false);
  onViewImg: (url: string) => void = (_u: string) => {};

  build() {
    Column() {
      if (this.msg.agentCard !== null) {
        // M2.5：任务回报卡替代气泡（task-inject 消息不走普通气泡）
        AgentCardView({ card: this.msg.agentCard })
      } else {
      Row() {
        if (this.msg.role === 'user') {
          Blank()
        }
        Column({ space: 4 }) {
          Text(this.msg.role === 'user' ? '主人' : '小 DJ')
            .fontSize(THEME.FONT_SUB - 1)
            .fontColor(this.msg.role === 'user' ? $r('app.color.sub') : $r('app.color.accent'))
          Column({ space: 2 }) {
            if (this.msg.streaming || this.msg.tokens === null) {
              Text(this.msg.text + (this.msg.streaming ? ' ▍' : ''))
                .id(`msg_${this.msg.id}`)
                .fontSize(THEME.FONT_MSG)
                .fontColor($r('app.color.text'))
                .lineHeight(24)
                .accessibilityText(this.msg.text)
            } else {
              MarkdownView({ tokens: this.msg.tokens })
            }
          }
          .alignItems(this.msg.role === 'user' ? HorizontalAlign.End : HorizontalAlign.Start)
          if (this.msg.imgUrl !== '') {
            Image(this.msg.imgUrl)
              .width(160)
              .height(160)
              .objectFit(ImageFit.Cover)
              .borderRadius(8)
              .margin({ top: 4 })
              .onClick(() => {
                this.onViewImg(this.msg.imgUrl);
              })
          }
        }
        .constraintSize({ maxWidth: '78%' })
        .padding(THEME.PAD_CARD + 2)
        .borderRadius(THEME.RADIUS_BUBBLE)
        .backgroundColor(this.msg.role === 'user' ? $r('app.color.user') : $r('app.color.card'))
        if (this.msg.role !== 'user') {
          Blank()
        }
      }
      .width('100%')
      }
      if (this.msg.editCard !== null) {
        EditCardView({ card: this.msg.editCard, msgId: this.msg.id })
      }
    }
    .width('100%')
    .padding({ left: THEME.PAD_PAGE, right: THEME.PAD_PAGE, top: 6, bottom: 6 })
    .bindContextMenu(this.msgMenu(), ResponseType.LongPress)
  }

  @Builder
  msgMenu() {
    Menu() {
      MenuItem({ content: '复制文本' })
        .onClick(() => {
          try {
            const d = pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, this.msg.text);
            pasteboard.getSystemPasteboard().setData(d);
          } catch (e) {
            // 复制失败静默
          }
        })
    }
  }
}

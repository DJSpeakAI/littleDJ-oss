// @提供 ConvRowView（侧栏会话行：标题+忙态+时间；onClick 开长按归档回调上抛） @依赖 Store theme util
// @依赖 Store（ConvItem 模型）theme util
// M2.1 task361：回调经函数 props 上抛（父组件环境内 this 合法）；行内零外层 this
import { ConvItem } from '../store/Store';
import { THEME } from '../core/theme';
import { fmtDate } from '../core/util';

@Component
export struct ConvRowView {
  conv: ConvItem = new ConvItem('', '', '', 0, 0, false, 0, false);
  currentId: string = '';
  onOpen: (sid: string) => void = (_s: string) => {};
  onArchive: (sid: string) => void = (_s: string) => {};
  onTogglePin: (sid: string) => void = (_s: string) => {};
  onToggleChildren: (sid: string) => void = (_s: string) => {};
  pinned: boolean = false; // M2.5 置顶标记
  childCount: number = 0; // M2.5 子会话数（>0 显示展开箭头）
  childOpen: boolean = false; // 子树展开态

  build() {
    Column() {
      Text(this.conv.title === '' ? '（未命名会话）' : this.conv.title)
        .fontSize(THEME.FONT_BODY - 1)
        .fontColor(this.conv.id === this.currentId ? $r('app.color.accent') : $r('app.color.text'))
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Row({ space: 6 }) {
        if (this.conv.childCount > 0) {
          Text(this.childOpen ? '▾' : '▸')
            .fontSize(THEME.FONT_SUB)
            .fontColor($r('app.color.faint'))
            .padding({ left: 6 })
            .onClick(() => {
              this.onToggleChildren(this.conv.id);
            })
        }
        if (this.pinned) {
          Text('📌')
            .fontSize(THEME.FONT_SUB - 2)
        }
        if (this.conv.busy) {
          LoadingProgress().width(12).height(12).color($r('app.color.accent'))
          Text('进行中')
            .fontSize(THEME.FONT_SUB - 1)
            .fontColor($r('app.color.accent'))
        }
        Text(this.conv.updatedAt > 0 ? fmtDate(this.conv.updatedAt) : '')
          .fontSize(THEME.FONT_SUB - 1)
          .fontColor($r('app.color.faint'))
      }
      .margin({ top: 2 })
    }
    .alignItems(HorizontalAlign.Start)
    .width('100%')
    .padding({ left: this.conv.isChild ? 34 : THEME.PAD_CARD, right: THEME.PAD_CARD, top: THEME.PAD_CARD, bottom: THEME.PAD_CARD })
    .borderRadius(THEME.RADIUS_CARD)
    .backgroundColor(this.conv.id === this.currentId ? $r('app.color.card2') : $r('app.color.card'))
    .opacity(this.conv.isChild ? 0.85 : 1)
    .onClick(() => {
      this.onOpen(this.conv.id);
    })
    .bindContextMenu(this.rowMenu(), ResponseType.LongPress)
  }

  @Builder
  rowMenu() {
    Menu() {
      MenuItem({ content: this.pinned ? '取消置顶' : '置顶' })
        .onClick(() => {
          this.onTogglePin(this.conv.id);
        })
      MenuItem({ content: '归档' })
        .onClick(() => {
          this.onArchive(this.conv.id);
        })
    }
  }
}

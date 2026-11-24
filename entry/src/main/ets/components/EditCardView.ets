// @提供 EditCardView（回合 diff 汇总卡：已编辑 N 文件 +A −D 默认折叠 task340；relFile 末两段；展开态经 ChatService.setEdOpen 记忆防 reload 折叠回） @依赖 Store theme ChatService
// M1 task361：对齐 PWA renderEditCard（明细含 note；头部点击展开，明细区不冒泡折叠 P1-5）
import { EditCard, FileStatItem } from '../store/Store';
import { ChatService } from '../domain/chat/ChatService';
import { THEME } from '../core/theme';

@Component
export struct EditCardView {
  card: EditCard = new EditCard([], 0, 0);
  msgId: string = '';
  @State open: boolean = false;

  aboutToAppear(): void {
    this.open = this.card.open;
  }

  private toggle(): void {
    this.open = !this.open;
    this.card.open = this.open;
    ChatService.setEdOpen(this.msgId, this.open);
  }

  /** 路径只显示末两段（对齐 PWA relFile；完整路径 accessibilityText） */
  private relFile(p: string): string {
    const parts = p.split(/[\\/]/).filter((s: string) => s !== '');
    if (parts.length > 2) {
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }
    return parts.join('/');
  }

  build() {
    Column() {
      Row({ space: 6 }) {
        Text('▤')
          .fontSize(THEME.FONT_SUB + 1)
          .fontColor($r('app.color.sub'))
        Text(`已编辑 ${this.card.files.length} 个文件`)
          .fontSize(THEME.FONT_SUB + 1)
          .fontColor($r('app.color.text'))
        Text(`+${this.card.adds}`)
          .fontSize(THEME.FONT_SUB + 1)
          .fontColor($r('app.color.accent'))
        Text(`−${this.card.dels}`)
          .fontSize(THEME.FONT_SUB + 1)
          .fontColor($r('app.color.err'))
        Blank()
        Text(this.open ? '▲' : '▼')
          .fontSize(THEME.FONT_SUB)
          .fontColor($r('app.color.faint'))
      }
      .width('100%')
      .padding({ left: 10, right: 10, top: 6, bottom: 6 })
      .onClick(() => {
        this.toggle(); // 产出审 P2：点击只挂头部（明细区点击不冒泡折叠）
      })

      if (this.open) {
        Divider().color($r('app.color.line')).margin({ left: 10, right: 10 })
        Column({ space: 4 }) {
          ForEach(this.card.files, (f: FileStatItem, i: number) => {
            Row({ space: 6 }) {
              Text(this.relFile(f.file))
                .fontSize(THEME.FONT_SUB)
                .fontColor($r('app.color.sub'))
                .layoutWeight(1)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .accessibilityText(f.file)
              Text(`+${f.adds}`)
                .fontSize(THEME.FONT_SUB)
                .fontColor($r('app.color.accent'))
              Text(`−${f.dels}`)
                .fontSize(THEME.FONT_SUB)
                .fontColor($r('app.color.err'))
            }
            .width('100%')
            if (f.note !== '') {
              Text(f.note)
                .fontSize(THEME.FONT_SUB - 2)
                .fontColor($r('app.color.faint'))
                .width('100%')
            }
          }, (f: FileStatItem, i: number) => `ec_${i}_${f.file}_${f.adds}_${f.dels}`)
        }
        .width('100%')
        .padding({ left: 10, right: 10, top: 4, bottom: 6 })
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .borderRadius(THEME.RADIUS_CARD)
    .backgroundColor($r('app.color.card2'))
    .border({ width: 1, color: $r('app.color.line') })
    .margin({ top: 4, bottom: 4 })
  }
}

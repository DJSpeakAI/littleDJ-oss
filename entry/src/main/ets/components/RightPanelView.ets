// @提供 RightPanelView（右栏：会话信息卡+任务面板；K_SSE/K_CTX/K_QUEUE/K_TASKS 自订阅） @依赖 Store theme
// @依赖 Store theme
// M2.1 task361：A 路线子组件化
import { router } from '@kit.ArkUI';
import { Store, TaskRow } from '../store/Store';
import { THEME } from '../core/theme';

@Component
export struct RightPanelView {
  @StorageLink(Store.K_SSE) sseState: string = 'idle';
  @StorageLink(Store.K_CTX) ctxUsed: number = 0;
  @StorageLink(Store.K_QUEUE) queueCount: number = 0;
  @StorageLink(Store.K_TASKS) tasksArr: Array<TaskRow> = [];

  private fmtTok(n: number): string {
    if (n >= 1000000) {
      return `${(n / 1000000).toFixed(1)}M`;
    }
    if (n >= 1000) {
      return `${Math.round(n / 1000)}k`;
    }
    return `${n}`;
  }

  build() {
    Column({ space: 10 }) {
      Row() {
        Text('会话信息')
          .fontSize(THEME.FONT_TITLE - 1)
          .fontColor($r('app.color.text'))
          .layoutWeight(1)
        Text('⚙')
          .id('settingsBtn')
          .fontSize(THEME.FONT_TITLE)
          .fontColor($r('app.color.sub'))
          .onClick(() => {
            router.pushUrl({ url: 'pages/Settings' }).catch(() => {});
          })
      }
      .width('100%')
      .padding(THEME.PAD_PAGE)
      Column({ space: 6 }) {
        Row() {
          Text('实时状态').fontSize(THEME.FONT_SUB).fontColor($r('app.color.sub')).layoutWeight(1)
          Text(this.sseState === 'online' ? '● 实时' : this.sseState === 'reconnecting' ? '○ 重连中' : '○ 未连接')
            .fontSize(THEME.FONT_SUB - 1)
            .fontColor(this.sseState === 'online' ? $r('app.color.accent') : $r('app.color.warn'))
        }
        Row() {
          Text('上下文用量').fontSize(THEME.FONT_SUB).fontColor($r('app.color.sub')).layoutWeight(1)
          Text(this.ctxUsed > 0 ? this.fmtTok(this.ctxUsed) : '—')
            .fontSize(THEME.FONT_SUB)
            .fontColor($r('app.color.text'))
        }
        Row() {
          Text('排队').fontSize(THEME.FONT_SUB).fontColor($r('app.color.sub')).layoutWeight(1)
          Text(this.queueCount > 0 ? `${this.queueCount} 条` : '无')
            .fontSize(THEME.FONT_SUB)
            .fontColor(this.queueCount > 0 ? $r('app.color.warn') : $r('app.color.sub'))
        }
      }
      .padding(THEME.PAD_CARD)
      .borderRadius(THEME.RADIUS_CARD)
      .backgroundColor($r('app.color.card'))
      .alignItems(HorizontalAlign.Start)

      Text('任务')
        .fontSize(THEME.FONT_TITLE - 1)
        .fontColor($r('app.color.text'))
        .margin({ top: 8 })
      Scroll() {
        Column({ space: 4 }) {
          ForEach(this.tasksArr, (tRow: TaskRow) => {
            Row({ space: 6 }) {
              Circle({ width: 6, height: 6 })
                .fill(tRow.state === 'running' || tRow.state === 'in_progress' ? $r('app.color.accent') : $r('app.color.warn'))
              Text(tRow.title)
                .fontSize(THEME.FONT_SUB)
                .fontColor($r('app.color.sub'))
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
            .width('100%')
            .padding({ left: 6, right: 6, top: 4, bottom: 4 })
            .borderRadius(8)
            .backgroundColor($r('app.color.card'))
          }, (tRow: TaskRow, i: number) => `task_${i}_${tRow.id}_${tRow.state}`)
          if (this.tasksArr.length === 0) {
            Text('暂无在途任务')
              .fontSize(THEME.FONT_SUB)
              .fontColor($r('app.color.faint'))
              .padding({ top: 6 })
          }
        }
        .width('100%')
      }
      .width('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.Top)
    }
    .width('100%')
    .height('100%')
    .padding(THEME.PAD_PAGE)
    .backgroundColor($r('app.color.bg2'))
    .alignItems(HorizontalAlign.Start)
  }
}
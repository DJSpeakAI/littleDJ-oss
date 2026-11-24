// @提供 SidePanelView（侧栏整体：标题+空态+分组树+归档提示；K_CONVS/K_CURRENT/K_PROJ_OPEN 自订阅） @依赖 Store ChatService ProjGroupView theme
// @依赖 Store（ConvItem/ProjGroup/ProjGroupView/ChatService）theme
// M2.1 task361：A 路线子组件化——侧栏独立 struct，Index 只做装配
import { Store, ConvItem, ProjGroup } from '../store/Store';
import { ChatService } from '../domain/chat/ChatService';
import { ProjGroupView } from './ProjGroupView';
import { THEME } from '../core/theme';

@Component
export struct SidePanelView {
  @StorageLink(Store.K_CONVS) convs: Array<ConvItem> = [];
  @StorageLink(Store.K_CURRENT) currentId: string = '';
  @StorageLink(Store.K_PROJ_OPEN) projOpenCount: number = 0;
  @StorageLink(Store.K_GROUPS) groupsArr: Array<ProjGroup> = [];
  @StorageLink(Store.K_CONV_OPEN) convOpenCount: number = 0; // 子树展开触发器（组 key 含之——同 projOpen 教训） // ForEach 可观察数据源（方法调用不建立观察——真机对照实验实锤）
  onOpen: (sid: string) => void = (_s: string) => {};
  onArchive: (sid: string) => void = (_s: string) => {};
  onTogglePin: (sid: string) => void = (_s: string) => {};
  onNewConv: (dir: string) => void = (_d: string) => {};

  build() {
    Column() {
      Text('会话')
        .fontSize(THEME.FONT_TITLE)
        .fontColor($r('app.color.text'))
        .padding(THEME.PAD_PAGE)
        .accessibilityText('会话列表')
      if (this.convs.length === 0) {
        Column({ space: 8 }) {
          Text('还没有会话')
            .fontSize(THEME.FONT_BODY - 1)
            .fontColor($r('app.color.faint'))
          Button('重新加载')
            .id('convRetry')
            .fontSize(THEME.FONT_SUB)
            .backgroundColor($r('app.color.card2'))
            .fontColor($r('app.color.text'))
            .onClick(() => {
              ChatService.loadConvs().catch(() => {});
            })
        }
        .margin({ top: 60 })
      }
      Scroll() {
        Column() {
          ForEach(this.groupsArr, (g: ProjGroup) => {
            ProjGroupView({
              group: g, currentId: this.currentId, openCount: this.projOpenCount,
              onOpen: this.onOpen, onArchive: this.onArchive, onTogglePin: this.onTogglePin,
              onNewConv: this.onNewConv,
              onToggle: (key: string) => {
                Store.projToggle(key);
              }
            })
          }, (g: ProjGroup, i: number) => `grp_${i}_${g.key}_${g.sig}_${this.projOpenCount}_${this.currentId}`)
          if (this.convs.length > 0) {
            Text('长按会话可归档')
              .fontSize(THEME.FONT_SUB - 2)
              .fontColor($r('app.color.faint'))
              .padding({ top: 8, bottom: 8 })
          }
        }
        .width('100%')
        .padding({ left: 8, right: 8, bottom: 8 })
      }
      .id('sessList')
      .width('100%')
      .height('100%')
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg2'))
  }
}
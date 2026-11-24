// @提供 ProjGroupView（项目组：组头折叠+组内 ConvRowView；折叠态 Store.projOpenSet） @依赖 Store ConvRowView ChatService theme
// @依赖 Store（ProjGroup/ConvItem/ConvRowView）theme
// M2.1 task361：A 路线子组件化；回调逐层上抛至 Index
import { ProjGroup, Store, ConvItem } from '../store/Store';
import { ConvRowView } from './ConvRowView';
import { THEME } from '../core/theme';
import { ChatService } from '../domain/chat/ChatService';

@Component
export struct ProjGroupView {
  group: ProjGroup = new ProjGroup('', '', [], '', '');
  currentId: string = '';
  openCount: number = 0; // 父传入（SidePanelView ForEach key 含 projOpenCount 驱动重建——@StorageLink+ForEach 组合点击失效，实锤绕行）
  onOpen: (sid: string) => void = (_s: string) => {};
  onArchive: (sid: string) => void = (_s: string) => {};
  onToggle: (key: string) => void = (_k: string) => {};
  onTogglePin: (sid: string) => void = (_s: string) => {};
  onNewConv: (dir: string) => void = (_d: string) => {};

  build() {
    Column() {
      Row({ space: 6 }) {
        Text(Store.projOpenHas(this.group.key) ? '▾' : '▸')
          .fontSize(THEME.FONT_SUB + 1)
          .fontColor($r('app.color.faint'))
        Text(this.group.name)
          .fontSize(THEME.FONT_BODY)
          .fontColor($r('app.color.sub'))
          .layoutWeight(1)
          .onClick(() => {
            this.onToggle(this.group.key);
          })
        Text(`${this.group.list.length}`)
          .fontSize(THEME.FONT_SUB - 1)
          .fontColor($r('app.color.faint'))
        if (this.group.path !== '') {
          Text('＋')
            .fontSize(THEME.FONT_SUB + 1)
            .fontColor($r('app.color.accent'))
            .padding({ left: 8 })
            .onClick(() => {
              this.onNewConv(this.group.path);
            })
        }
      }
      .width('100%')
      .padding({ left: 4, right: 4, top: 8, bottom: 4 })
      .onClick(() => {
        this.onToggle(this.group.key);
      })

      if (Store.projOpenHas(this.group.key)) {
        Column({ space: 4 }) {
          ForEach(this.group.list, (c: ConvItem) => {
            ConvRowView({
              conv: c, currentId: this.currentId,
              onOpen: this.onOpen, onArchive: this.onArchive, onTogglePin: this.onTogglePin,
              pinned: Store.isPinned(c.id), childCount: c.childCount, childOpen: Store.convOpenHas(c.id),
              onToggleChildren: (sid: string) => {
                Store.toggleConvOpen(sid);
                ChatService.fetchChildren(sid).then(() => {
                  Store.rebuildGroups();
                });
              }
            })
          }, (c: ConvItem) => `${c.id}_${c.title}_${c.updatedAt}_${c.busy ? 1 : 0}`)
        }
        .width('100%')
      }
    }
    .width('100%')
  }
}

// @提供 Index 主页（M2.1 A 路线：@Component 子组件化装配——sidePanel/rightPanel/msgRow 全下放组件，Index 只做骨架+一层交互；根治 @Builder 二层 this 禁令 L-126） @依赖 Store ChatService XdeviceService SettingsService VoiceService AttachService event-bus events theme SidePanelView RightPanelView MsgRowView Vault
// M0.1 单栏+Drawer / M1 三栏断点 / M2 侧栏域+xdevice / M2.1 组件化重构
import { router } from '@kit.ArkUI';
import { mediaquery } from '@kit.ArkUI';
import { ChatService } from '../domain/chat/ChatService';
import { XdeviceService, inferBusy } from '../domain/sync/XdeviceService';
import { SettingsService } from '../domain/settings/SettingsService';
import { Store, ConvItem, MsgItem } from '../store/Store';
import { EventBus } from '../core/event-bus';
import { EV } from '../core/events';
import { THEME } from '../core/theme';
import { SidePanelView } from '../components/SidePanelView';
import { RightPanelView } from '../components/RightPanelView';
import { MsgRowView } from '../components/MsgRowView';
import { Vault } from '../core/Vault';
import { VoiceService } from '../domain/voice/VoiceService';
import { AttachService } from '../domain/media/AttachService';
import { abilityAccessCtrl, Permissions } from '@kit.AbilityKit';

interface PermResult {
  getAuthResults(): Array<number>;
}

@Entry
@Component
struct Index {
  @StorageLink(Store.K_CONVS) convs: Array<ConvItem> = [];
  @StorageLink(Store.K_CURRENT) currentId: string = '';
  @StorageLink(Store.K_SSE) sseState: string = 'idle';
  @StorageLink(Store.K_QUEUE) queueCount: number = 0;
  @StorageLink(Store.K_CTX) ctxUsed: number = 0;
  @State showDrawer: boolean = true;
  @State input: string = '';
  @State currentTitle: string = '';
  @State isWide: boolean = false;
  @State nearBottom: boolean = true;
  @State micOn: boolean = false; // M4 录音中
  @State viewImg: string = ''; // M4.5 看图全屏层
  private scroller: Scroller = new Scroller();
  private taskTimer: number = -1; // P1-5：任务面板轮询
  private archiveProbing: Set<string> = new Set<string>();
  private bpListener: mediaquery.MediaQueryListener | null = null;
  private onAuthExpired = (_p: object): void => {
    ChatService.shutdown();
    Vault.removePass().catch(() => {});
    Store.setCurrentId('');
    Store.setDir('');
    Store.setCurrentChild(false);
    Store.setConvs(new Array<ConvItem>());
    Store.setCtxUsed(0);
    Store.setQueueCount(0);
    Store.setSseState('idle');
    Store.msgs().reload(new Array<MsgItem>());
    Store.rebuildGroups();
    this.currentTitle = '';
    router.replaceUrl({ url: 'pages/Login' }).catch(() => {});
  };
  private onBusyForVoice = (p: object): void => {
    const rec = p as Record<string, Object>;
    const sid = rec['sid'];
    const busy = rec['busy'] === true;
    if (!busy && typeof sid === 'string' && sid === Store.currentId() && VoiceService.isArmed()) {
      // 回复收尾：读末条 assistant 文本朗读（armed 一次性）
      const ds = Store.msgs();
      const n = ds.totalCount();
      for (let i = n - 1; i >= 0; i--) {
        const m = ds.getData(i);
        if (m.role === 'assistant' && m.text.trim() !== '') {
          VoiceService.onReplyDone(m.text);
          break;
        }
      }
    }
  };

  private onHiddenChanged = (_p: object): void => {
    ChatService.loadConvs().catch(() => {});
  };

  aboutToAppear(): void {
    ChatService.init();
    ChatService.ctxStart();
    SettingsService.loadModels(true).catch(() => {});
    EventBus.on(EV.AUTH_EXPIRED, this.onAuthExpired);
    EventBus.on(EV.CONVS_HIDDEN, this.onHiddenChanged);
    EventBus.on(EV.SESSION_BUSY, this.onBusyForVoice);
    ChatService.loadConvs().catch((_e: Error) => {});
    // M2：侧栏域数据+xdevice 跨端同步
    ChatService.loadDirs().catch(() => {});
    ChatService.loadPins().then(() => {
      Store.rebuildGroups();
    }).catch(() => {});
    ChatService.loadTasks().catch(() => {});
    XdeviceService.start();
    // P1-5：任务面板 10s 轮询（对齐 PWA loadTaskLedger 节拍）
    this.taskTimer = setInterval(() => {
      ChatService.loadTasks().catch(() => {});
    }, 10000);
    // P2-6：vp 口径断点（840vp=官方 lg 线）
    const cond = mediaquery.matchMediaSync('(min-width: 840vp)');
    this.isWide = cond.matches;
    this.bpListener = cond;
    cond.on('change', (result: mediaquery.MediaQueryResult) => {
      this.isWide = result.matches;
      if (this.isWide) {
        this.showDrawer = true;
      }
    });
  }

  aboutToDisappear(): void {
    EventBus.off(EV.AUTH_EXPIRED, this.onAuthExpired);
    EventBus.off(EV.CONVS_HIDDEN, this.onHiddenChanged);
    EventBus.off(EV.SESSION_BUSY, this.onBusyForVoice);
    if (this.taskTimer >= 0) {
      clearInterval(this.taskTimer);
      this.taskTimer = -1;
    }
    XdeviceService.stop();
    if (this.bpListener !== null) {
      this.bpListener.off('change');
      this.bpListener = null;
    }
  }

  onPageShow(): void {
    XdeviceService.onForeground();
  }

  private openConvById(sid: string): void {
    for (let i = 0; i < this.convs.length; i++) {
      if (this.convs[i].id === sid) {
        this.openConv(this.convs[i]);
        return;
      }
    }
    const child = Store.childConv(sid);
    if (child !== null) {
      this.openConv(child);
    }
  }

  private openConv(c: ConvItem): void {
    this.currentTitle = c.title;
    this.showDrawer = false;
    Store.msgs().reload(new Array<MsgItem>());
    ChatService.probeOnOpen(c.id);
    ChatService.openConv(c).then(() => {
      const n = Store.msgs().totalCount();
      if (n > 0) {
        this.scroller.scrollToIndex(n - 1);
        this.nearBottom = true;
      }
    }).catch((_e: Error) => {
      this.currentTitle = `${c.title}（加载失败，点击重试）`;
    });
  }

  private confirmArchive(c: ConvItem): void {
    if (c.busy) {
      AlertDialog.show({
        title: '不能归档',
        message: '这个会话正在跑任务，等它完成后再归档（和 PWA 同款保护）',
        confirm: { value: '知道了', action: (): void => {} }
      });
      return;
    }
    AlertDialog.show({
      title: '归档会话',
      message: `「${c.title === '' ? '（未命名）' : c.title}」归档后从列表隐藏（跨端同步）`,
      primaryButton: { value: '取消', action: (): void => {} },
      secondaryButton: {
        value: '归档',
        fontColor: $r('app.color.accent'),
        action: (): void => {
          ChatService.archiveConv(c.id).then((r: string) => {
            if (r === 'fail') {
              AlertDialog.show({
                title: '归档失败',
                message: '服务暂时没响应，稍后再试（会话数据未动）',
                confirm: { value: '知道了', action: (): void => {} }
              });
            }
          });
        }
      }
    });
  }

  private archiveById(sid: string): void {
    for (let i = 0; i < this.convs.length; i++) {
      if (this.convs[i].id === sid) {
        this.confirmArchive(this.convs[i]);
        return;
      }
    }
    const child = Store.childConv(sid);
    if (child === null || this.archiveProbing.has(sid)) {
      return;
    }
    this.archiveProbing.add(sid);
    ChatService.messagesOf(sid).then((msgs: Object[]): void => {
      this.archiveProbing.delete(sid);
      if (msgs.length > 0 && inferBusy(msgs)) {
        AlertDialog.show({
          title: '不能归档',
          message: '这个子会话正在跑任务，等它完成后再归档（和 PWA 同款保护）',
          confirm: { value: '知道了', action: (): void => {} }
        });
        return;
      }
      this.confirmArchive(child);
    }).catch((_e: Error): void => {
      this.archiveProbing.delete(sid);
      this.confirmArchive(child);
    });
  }

  private pickAndSend(): void {
    AttachService.pickImage().then((j: string) => {
      if (j === '') {
        return;
      }
      try {
        const a = JSON.parse(j) as Record<string, string>;
        ChatService.sendAtt(this.input, a['mime'], a['name'], a['url']).then(() => {
          this.input = '';
          const n = Store.msgs().totalCount();
          if (n > 0) {
            this.scroller.scrollToIndex(n - 1);
          }
        });
      } catch (e) {
        // 坏包忽略
      }
    });
  }

  private micStart(): void {
    // M4：user_grant 权限运行时申请（MICROPHONE）——拒绝/失败弹中文提示
    const atManager = abilityAccessCtrl.createAtManager();
    const perms: Array<Permissions> = ['ohos.permission.MICROPHONE'];
    atManager.requestPermissionsFromUser(VoiceService.appCtx, perms).then((res: object) => {
      let granted = false;
      const rr = res as PermResult;
      const auths: Array<number> = rr.getAuthResults();
      for (let i = 0; i < auths.length; i++) {
        if (auths[i] === 0) {
          granted = true;
        }
      }
      if (!granted) {
        AlertDialog.show({ title: '需要麦克风权限', message: '语音对话要用麦克风录音，请在设置里允许', confirm: { value: '知道了', action: (): void => {} } });
        return;
      }
      VoiceService.start().then(() => {
        this.micOn = true;
      }).catch((e: Error) => {
        AlertDialog.show({ title: '麦克风不可用', message: e.message, confirm: { value: '知道了', action: (): void => {} } });
      });
    }).catch((e: Error) => {
      AlertDialog.show({ title: '权限申请失败', message: e.message, confirm: { value: '知道了', action: (): void => {} } });
    });
  }

  private micStop(): void {
    this.micOn = false;
    VoiceService.transcribe().then((text: string) => {
      if (text.trim() === '') {
        return;
      }
      VoiceService.arm(); // 回复收尾朗读一次
      ChatService.send(text).then(() => {
        const n = Store.msgs().totalCount();
        if (n > 0) {
          this.scroller.scrollToIndex(n - 1);
        }
      });
    });
  }

  private togglePinById(sid: string): void {
    ChatService.togglePin(sid).then((_ok: boolean) => {
      Store.rebuildGroups();
    });
  }

  private newConvIn(dir: string): void {
    ChatService.createSession(dir, '新对话').then((c: ConvItem) => {
      this.openConv(c);
    }).catch((_e: Error) => {
      AlertDialog.show({ title: '新建失败', message: '服务暂时没响应，稍后再试', confirm: { value: '知道了', action: (): void => {} } });
    });
  }

  private doSend(): void {
    if (this.input.trim() === '' || this.currentId === '') {
      return;
    }
    const text = this.input;
    this.input = '';
    ChatService.send(text).then(() => {
      const n = Store.msgs().totalCount();
      if (n > 0) {
        this.scroller.scrollToIndex(n - 1);
        this.nearBottom = true;
      }
    });
  }

  build() {
    Stack() {
    if (this.isWide) {
      Row() {
        SidePanelView({
          onOpen: (sid: string) => {
            this.openConvById(sid);
          },
          onArchive: (sid: string) => {
            this.archiveById(sid);
          },
          onTogglePin: (sid: string) => {
            this.togglePinById(sid);
          },
          onNewConv: (dir: string) => {
            this.newConvIn(dir);
          }
        })
        .width(THEME.SIDEBAR_W)
        .height('100%')

        Column() {
          // —— 主区（一层组件方法内 this 合法）——
          Row({ space: 10 }) {
            Text(this.currentTitle === '' ? '选择一个会话开始' : this.currentTitle)
              .id('chatTitle')
              .layoutWeight(1)
              .fontSize(THEME.FONT_TITLE)
              .fontColor($r('app.color.text'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            if (this.ctxUsed > 0) {
              Text(`ctx ${this.ctxUsed >= 100000 ? `${Math.round(this.ctxUsed / 1000)}k` : this.ctxUsed}`)
                .fontSize(THEME.FONT_SUB - 1)
                .fontColor(this.ctxUsed >= 150000 ? $r('app.color.err') : this.ctxUsed >= 100000 ? $r('app.color.warn') : $r('app.color.sub'))
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(8)
                .backgroundColor($r('app.color.card2'))
            }
            Text(this.sseState === 'online' ? '● 实时' : this.sseState === 'reconnecting' ? '○ 重连中' : '○ 未连接')
              .fontSize(THEME.FONT_SUB - 1)
              .fontColor(this.sseState === 'online' ? $r('app.color.accent') : $r('app.color.warn'))
          }
          .width('100%')
          .height(52)
          .padding({ left: THEME.PAD_PAGE, right: THEME.PAD_PAGE })
          .backgroundColor($r('app.color.panel'))

          if (this.queueCount !== 0) {
            Row({ space: 8 }) {
              LoadingProgress().width(14).height(14).color($r('app.color.warn'))
              Text(this.queueCount > 0 ? `排队中 ${this.queueCount} 条` : '已入队，等待执行…')
                .fontSize(THEME.FONT_SUB)
                .fontColor($r('app.color.warn'))
            }
            .width('100%')
            .padding({ left: THEME.PAD_PAGE, right: THEME.PAD_PAGE, top: 6, bottom: 6 })
            .backgroundColor($r('app.color.panel'))
          }

          if (this.currentId === '') {
            Column() {
              Text('← 点左侧挑个会话')
                .fontSize(THEME.FONT_BODY)
                .fontColor($r('app.color.faint'))
            }
            .layoutWeight(1)
            .width('100%')
            .justifyContent(FlexAlign.Center)
          } else {
            Stack({ alignContent: Alignment.BottomEnd }) {
              List({ space: THEME.GAP_MSG, scroller: this.scroller }) {
                LazyForEach(Store.msgs(), (m: MsgItem) => {
                  ListItem() {
                    MsgRowView({ msg: m, onViewImg: (u: string) => { this.viewImg = u; } })
                  }
                }, (m: MsgItem) => `${m.id}_${m.streaming ? 1 : 0}_${m.text.length}_${m.editCard !== null ? 'ec' : ''}_${m.tokens !== null ? 'md' : ''}`)
              }
              .id('msgList')
              .width('100%')
              .height('100%')
              .layoutWeight(1)
              .scrollBar(BarState.Off)
              .edgeEffect(EdgeEffect.Spring)
              .onScrollIndex((first: number, last: number) => {
                const total = Store.msgs().totalCount();
                this.nearBottom = total - last <= 6;
              })

              if (!this.nearBottom) {
                Button('↓ 回到最新')
                  .id('jumpBottom')
                  .fontSize(THEME.FONT_SUB)
                  .backgroundColor($r('app.color.card2'))
                  .fontColor($r('app.color.text'))
                  .borderRadius(20)
                  .padding({ left: 14, right: 14 })
                  .margin({ right: THEME.PAD_PAGE + 4, bottom: THEME.PAD_PAGE + 4 })
                  .onClick(() => {
                    const n = Store.msgs().totalCount();
                    if (n > 0) {
                      this.scroller.scrollToIndex(n - 1);
                      this.nearBottom = true;
                    }
                  })
              }
            }
            .layoutWeight(1)
            .width('100%')
          }

          Row({ space: 8 }) {
            TextArea({ text: this.input, placeholder: this.currentId === '' ? '先选会话' : '说点什么…' })
              .id('chatInput')
              .layoutWeight(1)
              .constraintSize({ maxHeight: THEME.INPUT_MAX_H })
              .fontSize(THEME.FONT_MSG)
              .fontColor($r('app.color.text'))
              .placeholderColor($r('app.color.faint'))
              .backgroundColor($r('app.color.card'))
              .borderRadius(THEME.RADIUS_INPUT)
              .onChange((v: string) => {
                this.input = v;
              })
                        Button('📎')
              .id('clipBtn')
              .fontSize(THEME.FONT_BODY)
              .backgroundColor($r('app.color.card2'))
              .fontColor($r('app.color.text'))
              .onClick(() => {
                this.pickAndSend();
              })
            Button(this.micOn ? '●' : '🎙')
              .id('micBtn')
              .fontSize(THEME.FONT_BODY)
              .backgroundColor(this.micOn ? $r('app.color.err') : $r('app.color.card2'))
              .fontColor($r('app.color.text'))
              .gesture(
                LongPressGesture({ repeat: false, duration: 300 })
                  .onAction(() => {
                    this.micStart();
                  })
              )
              .onClick(() => {
                if (this.micOn) {
                  this.micStop();
                } else {
                  this.micStart();
                }
              })
            Button('发送')
              .id('sendBtn')
              .fontSize(THEME.FONT_BODY)
              .backgroundColor(this.input.trim() === '' || this.currentId === '' ? $r('app.color.card2') : $r('app.color.accent'))
              .fontColor(this.input.trim() === '' || this.currentId === '' ? $r('app.color.faint') : $r('app.color.bg'))
              .onClick(() => {
                this.doSend();
              })
          }
          .width('100%')
          .padding(THEME.PAD_PAGE)
          .backgroundColor($r('app.color.panel'))
          .alignItems(VerticalAlign.Bottom)
        }
        .layoutWeight(1)
        .height('100%')

        RightPanelView()
        .width(THEME.RIGHT_W)
        .height('100%')
      }
      .width('100%')
      .height('100%')
    } else {
      SideBarContainer(SideBarContainerType.Overlay) {
        SidePanelView({
          onOpen: (sid: string) => {
            this.openConvById(sid);
          },
          onArchive: (sid: string) => {
            this.archiveById(sid);
          },
          onTogglePin: (sid: string) => {
            this.togglePinById(sid);
          },
          onNewConv: (dir: string) => {
            this.newConvIn(dir);
          }
        })
        Column() {
          Row({ space: 10 }) {
            Button('☰')
              .id('drawerBtn')
              .fontSize(THEME.FONT_TITLE)
              .backgroundColor(Color.Transparent)
              .fontColor($r('app.color.text'))
              .onClick(() => {
                this.showDrawer = !this.showDrawer;
              })
            Text('⚙')
              .id('settingsBtnNarrow')
              .fontSize(THEME.FONT_TITLE)
              .fontColor($r('app.color.sub'))
              .padding({ left: 4, right: 4, top: 2, bottom: 2 })
              .onClick(() => {
                router.pushUrl({ url: 'pages/Settings' }).catch(() => {});
              })
            Text(this.currentTitle === '' ? '选择一个会话开始' : this.currentTitle)
              .id('chatTitle')
              .layoutWeight(1)
              .fontSize(THEME.FONT_TITLE)
              .fontColor($r('app.color.text'))
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
            if (this.ctxUsed > 0) {
              Text(`ctx ${this.ctxUsed >= 100000 ? `${Math.round(this.ctxUsed / 1000)}k` : this.ctxUsed}`)
                .fontSize(THEME.FONT_SUB - 1)
                .fontColor(this.ctxUsed >= 150000 ? $r('app.color.err') : this.ctxUsed >= 100000 ? $r('app.color.warn') : $r('app.color.sub'))
                .padding({ left: 6, right: 6, top: 2, bottom: 2 })
                .borderRadius(8)
                .backgroundColor($r('app.color.card2'))
            }
            Text(this.sseState === 'online' ? '● 实时' : this.sseState === 'reconnecting' ? '○ 重连中' : '○ 未连接')
              .fontSize(THEME.FONT_SUB - 1)
              .fontColor(this.sseState === 'online' ? $r('app.color.accent') : $r('app.color.warn'))
          }
          .width('100%')
          .height(52)
          .padding({ left: THEME.PAD_PAGE, right: THEME.PAD_PAGE })
          .backgroundColor($r('app.color.panel'))

          if (this.queueCount !== 0) {
            Row({ space: 8 }) {
              LoadingProgress().width(14).height(14).color($r('app.color.warn'))
              Text(this.queueCount > 0 ? `排队中 ${this.queueCount} 条` : '已入队，等待执行…')
                .fontSize(THEME.FONT_SUB)
                .fontColor($r('app.color.warn'))
            }
            .width('100%')
            .padding({ left: THEME.PAD_PAGE, right: THEME.PAD_PAGE, top: 6, bottom: 6 })
            .backgroundColor($r('app.color.panel'))
          }

          if (this.currentId === '') {
            Column() {
              Text('← 点左上角 ☞ 挑个会话')
                .fontSize(THEME.FONT_BODY)
                .fontColor($r('app.color.faint'))
            }
            .layoutWeight(1)
            .width('100%')
            .justifyContent(FlexAlign.Center)
          } else {
            Stack({ alignContent: Alignment.BottomEnd }) {
              List({ space: THEME.GAP_MSG, scroller: this.scroller }) {
                LazyForEach(Store.msgs(), (m: MsgItem) => {
                  ListItem() {
                    MsgRowView({ msg: m, onViewImg: (u: string) => { this.viewImg = u; } })
                  }
                }, (m: MsgItem) => `${m.id}_${m.streaming ? 1 : 0}_${m.text.length}_${m.editCard !== null ? 'ec' : ''}_${m.tokens !== null ? 'md' : ''}`)
              }
              .id('msgList')
              .width('100%')
              .height('100%')
              .layoutWeight(1)
              .scrollBar(BarState.Off)
              .edgeEffect(EdgeEffect.Spring)
              .onScrollIndex((first: number, last: number) => {
                const total = Store.msgs().totalCount();
                this.nearBottom = total - last <= 6;
              })

              if (!this.nearBottom) {
                Button('↓ 回到最新')
                  .fontSize(THEME.FONT_SUB)
                  .backgroundColor($r('app.color.card2'))
                  .fontColor($r('app.color.text'))
                  .borderRadius(20)
                  .padding({ left: 14, right: 14 })
                  .margin({ right: THEME.PAD_PAGE + 4, bottom: THEME.PAD_PAGE + 4 })
                  .onClick(() => {
                    const n = Store.msgs().totalCount();
                    if (n > 0) {
                      this.scroller.scrollToIndex(n - 1);
                      this.nearBottom = true;
                    }
                  })
              }
            }
            .layoutWeight(1)
            .width('100%')
          }

          Row({ space: 8 }) {
            TextArea({ text: this.input, placeholder: this.currentId === '' ? '先选会话' : '说点什么…' })
              .id('chatInput')
              .layoutWeight(1)
              .constraintSize({ maxHeight: THEME.INPUT_MAX_H })
              .fontSize(THEME.FONT_MSG)
              .fontColor($r('app.color.text'))
              .placeholderColor($r('app.color.faint'))
              .backgroundColor($r('app.color.card'))
              .borderRadius(THEME.RADIUS_INPUT)
              .onChange((v: string) => {
                this.input = v;
              })
                        Button('📎')
              .id('clipBtn')
              .fontSize(THEME.FONT_BODY)
              .backgroundColor($r('app.color.card2'))
              .fontColor($r('app.color.text'))
              .onClick(() => {
                this.pickAndSend();
              })
            Button(this.micOn ? '●' : '🎙')
              .id('micBtn')
              .fontSize(THEME.FONT_BODY)
              .backgroundColor(this.micOn ? $r('app.color.err') : $r('app.color.card2'))
              .fontColor($r('app.color.text'))
              .gesture(
                LongPressGesture({ repeat: false, duration: 300 })
                  .onAction(() => {
                    this.micStart();
                  })
              )
              .onClick(() => {
                if (this.micOn) {
                  this.micStop();
                } else {
                  this.micStart();
                }
              })
            Button('发送')
              .id('sendBtnNarrow')
              .fontSize(THEME.FONT_BODY)
              .backgroundColor(this.input.trim() === '' || this.currentId === '' ? $r('app.color.card2') : $r('app.color.accent'))
              .fontColor(this.input.trim() === '' || this.currentId === '' ? $r('app.color.faint') : $r('app.color.bg'))
              .onClick(() => {
                this.doSend();
              })
          }
          .width('100%')
          .padding(THEME.PAD_PAGE)
          .backgroundColor($r('app.color.panel'))
          .alignItems(VerticalAlign.Bottom)
        }
        .width('100%')
        .height('100%')
        .backgroundColor($r('app.color.bg'))
      }
      .sideBarWidth(THEME.SIDEBAR_W)
      .showSideBar(this.showDrawer)
      .width('100%')
      .height('100%')
    }
    if (this.viewImg !== '') {
      // M4.5 全屏看图层（点任意处关闭）
      Column() {
        Image(this.viewImg)
          .objectFit(ImageFit.Contain)
          .width('100%')
          .layoutWeight(1)
        Text('点任意处关闭')
          .fontSize(THEME.FONT_SUB)
          .fontColor($r('app.color.sub'))
          .padding(12)
      }
      .width('100%')
      .height('100%')
      .backgroundColor('#ee000000')
      .onClick(() => {
        this.viewImg = '';
      })
    }
    }
    .width('100%')
    .height('100%')
  }
}

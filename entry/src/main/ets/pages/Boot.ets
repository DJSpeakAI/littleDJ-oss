// @提供 Boot 页（启动探活/错误页：连不上的中文提示+重试+切换地址，P2-14） @依赖 Net Vault Prefs Store theme
// M0.1 task361
import { router } from '@kit.ArkUI';
import { authProbe, setBaseUrl, setPassCookie } from '../core/Net';
import { Vault } from '../core/Vault';
import { Prefs } from '../core/Prefs';
import { Store } from '../store/Store';
import { THEME } from '../core/theme';

@Entry
@Component
struct Boot {
  @State state: string = 'booting'; // booting | error
  @State errText: string = '';

  aboutToAppear(): void {
    this.boot();
  }

  private boot(): void {
    this.state = 'booting';
    const saved = Prefs.getString('base', '');
    const url = saved !== '' ? saved : 'http://192.0.2.10:4097';
    setBaseUrl(url);
    Vault.loadPass().then((token: string) => {
      if (token === '') {
        router.replaceUrl({ url: 'pages/Login' }).catch(() => {});
        return;
      }
      setPassCookie(token);
      authProbe().then((code: number) => {
        if (code === 200) {
          Store.setAuthOk(true);
          router.replaceUrl({ url: 'pages/Index' }).catch(() => {});
          return;
        }
        if (code === 401) {
          // 通行证过期：清了回登录（90 天到期自动唤起重登）
          Vault.removePass().then(() => {
            router.replaceUrl({ url: 'pages/Login' }).catch(() => {});
          });
          return;
        }
        this.errText = code < 0 ? '连不上小 DJ 服务——检查网络或服务器地址' : `服务异常（${code}）`;
        this.state = 'error';
      });
    });
  }

  build() {
    Column({ space: THEME.PAD_PAGE }) {
      Text('🤵 little DJ')
        .id('bootTitle')
        .fontSize(THEME.FONT_TITLE + 6)
        .fontColor($r('app.color.text'))
        .margin({ top: 120 })
      if (this.state === 'booting') {
        LoadingProgress().width(42).height(42).color($r('app.color.accent'))
        Text('正在连接服务…')
          .fontSize(THEME.FONT_SUB)
          .fontColor($r('app.color.sub'))
          .id('bootLoading')
      } else {
        Text(this.errText)
          .id('bootErr')
          .fontSize(THEME.FONT_BODY)
          .fontColor($r('app.color.err'))
          .textAlign(TextAlign.Center)
          .padding({ left: 30, right: 30 })
        Button('重试')
          .id('bootRetry')
          .width(160)
          .backgroundColor($r('app.color.accent'))
          .fontColor($r('app.color.bg'))
          .onClick(() => {
            this.boot();
          })
        Button('切换服务器地址')
          .id('bootSwitch')
          .width(160)
          .backgroundColor($r('app.color.card2'))
          .fontColor($r('app.color.text'))
          .onClick(() => {
            router.replaceUrl({ url: 'pages/Login' }).catch(() => {});
          })
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
    .alignItems(HorizontalAlign.Center)
  }
}

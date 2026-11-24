// @提供 Login 页（双预设+自定义 URL+通行证登录；密码内存态零落盘 P1-3） @依赖 Net Vault Prefs Store theme util
// M0.1 task361
import { router } from '@kit.ArkUI';
import { login, setBaseUrl, setPassCookie } from '../core/Net';
import { Vault } from '../core/Vault';
import { Prefs } from '../core/Prefs';
import { Store } from '../store/Store';
import { deviceModel } from '../core/util';
import { THEME } from '../core/theme';

const PRESET_LAN = 'http://192.0.2.10:4097';
const PRESET_WAN = 'https://dj.example.com';

@Entry
@Component
struct Login {
  @State url: string = Prefs.getString('base', PRESET_LAN); // 产出审 P2：回填记忆地址（双预设自动优选的数据源）
  @State user: string = 'dj';
  @State pass: string = '';
  @State devName: string = `littleDJ-App-${deviceModel()}`;
  @State err: string = '';
  @State busy: boolean = false;

  private doLogin(): void {
    if (this.busy) {
      return;
    }
    if (this.user === '' || this.pass === '' || this.url === '') {
      this.err = '地址、用户名、密码都要填哦';
      return;
    }
    this.busy = true;
    this.err = '';
    setBaseUrl(this.url);
    login(this.user, this.pass, this.devName).then((r) => {
      this.busy = false;
      if (!r.ok) {
        this.err = r.error === '' ? '登录失败，请重试' : r.error;
        return;
      }
      // 通行证入 Asset（密码即刻弃用，仅内存一闪）；地址记忆（双预设自动优选的数据源）
      Vault.savePass(r.token, r.did).then(() => {
        Prefs.setString('base', this.url);
        setPassCookie(r.token);
        Store.setAuthOk(true);
        router.replaceUrl({ url: 'pages/Index' }).catch(() => {});
      });
    });
  }

  build() {
    Scroll() {
      Column({ space: 10 }) {
        Text('🤵 little DJ')
          .id('loginTitle')
          .fontSize(THEME.FONT_TITLE + 8)
          .fontColor($r('app.color.text'))
          .margin({ top: 60, bottom: 4 })
        Text('登录一次，本设备 90 天免密')
          .fontSize(THEME.FONT_SUB)
          .fontColor($r('app.color.sub'))
          .margin({ bottom: 16 })

        Row({ space: 8 }) {
          Button('家里（内网）')
            .id('presetLan')
            .layoutWeight(1)
            .fontSize(THEME.FONT_SUB + 1)
            .backgroundColor(this.url === PRESET_LAN ? $r('app.color.accent') : $r('app.color.card2'))
            .fontColor(this.url === PRESET_LAN ? $r('app.color.bg') : $r('app.color.text'))
            .onClick(() => {
              this.url = PRESET_LAN;
            })
          Button('出门（外网）')
            .id('presetWan')
            .layoutWeight(1)
            .fontSize(THEME.FONT_SUB + 1)
            .backgroundColor(this.url === PRESET_WAN ? $r('app.color.accent') : $r('app.color.card2'))
            .fontColor(this.url === PRESET_WAN ? $r('app.color.bg') : $r('app.color.text'))
            .onClick(() => {
              this.url = PRESET_WAN;
            })
        }
        .width('100%')

        TextInput({ text: this.url, placeholder: '服务器地址（也可自定义）' })
          .id('loginUrl')
          .onChange((v: string) => {
            this.url = v;
          })
        TextInput({ text: this.user, placeholder: '用户名' })
          .id('loginUser')
          .onChange((v: string) => {
            this.user = v;
          })
        TextInput({ text: this.pass, placeholder: '密码' })
          .id('loginPass')
          .type(InputType.Password)
          .onChange((v: string) => {
            this.pass = v;
          })
        TextInput({ text: this.devName, placeholder: '设备名（默认 App+机型）' })
          .id('loginName')
          .onChange((v: string) => {
            this.devName = v;
          })

        Button(this.busy ? '登录中…' : '登 录')
          .id('loginBtn')
          .width('100%')
          .height(46)
          .fontSize(THEME.FONT_TITLE)
          .backgroundColor($r('app.color.accent'))
          .fontColor($r('app.color.bg'))
          .enabled(!this.busy)
          .onClick(() => {
            this.doLogin();
          })

        if (this.err !== '') {
          Text(this.err)
            .id('loginErr')
            .fontSize(THEME.FONT_SUB + 1)
            .fontColor($r('app.color.err'))
        }
      }
      .alignItems(HorizontalAlign.Center)
      .padding(THEME.PAD_PAGE + 8)
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
    .scrollBar(BarState.Off)
  }
}

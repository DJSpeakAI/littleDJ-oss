// @提供 Settings 页（M3 设置全家最小集：模型选择/Key 卡激活切换/余额；固定 id 供断言） @依赖 SettingsService PricingService Store theme
// M3 task361：验收=设置可写可存（模型选择 Prefs 持久化+Key 激活服务端生效）
import { router } from '@kit.ArkUI';
import { SettingsService, ModelItem, KeyCard } from '../domain/settings/SettingsService';
import { PricingService } from '../domain/pricing/PricingService';
import { PriceRow } from '../store/Store';
import { Store } from '../store/Store';
import { THEME } from '../core/theme';

@Entry
@Component
struct Settings {
  @StorageLink(Store.K_MODELS) modelsArr: Array<ModelItem> = [];
  @StorageLink(Store.K_KEYS) keysArr: Array<KeyCard> = [];
  @StorageLink(Store.K_MODEL_CUR) modelCurText: string = '';
  @StorageLink(Store.K_PRICES) pricesArr: Array<PriceRow> = [];
  @State balance: string = '…';

  aboutToAppear(): void {
    SettingsService.loadModels().catch(() => {});
    SettingsService.loadKeys().then((_k: KeyCard[]) => {
      PricingService.load().catch(() => {});
      SettingsService.balance().then((b: string) => {
        this.balance = b;
      });
    });
  }

  build() {
    Column() {
      Row({ space: 10 }) {
        Button('←')
          .fontSize(THEME.FONT_TITLE)
          .backgroundColor(Color.Transparent)
          .fontColor($r('app.color.text'))
          .onClick(() => {
            router.back();
          })
        Text('设置')
          .id('settingsTitle')
          .fontSize(THEME.FONT_TITLE)
          .fontColor($r('app.color.text'))
          .layoutWeight(1)
      }
      .width('100%')
      .height(52)
      .padding({ left: THEME.PAD_PAGE, right: THEME.PAD_PAGE })
      .backgroundColor($r('app.color.panel'))

      Scroll() {
        Column({ space: 12 }) {
          // —— 模型选择 ——
          Text('模型（发送时携带）')
            .fontSize(THEME.FONT_SUB + 1)
            .fontColor($r('app.color.sub'))
            .width('100%')
          ForEach(this.modelsArr, (m: ModelItem) => {
            Row({ space: 8 }) {
              Radio({ value: m.modelID, group: 'model' })
                .checked(this.modelCurText === `${m.pname} · ${m.name}`)
                .onChange((_c: boolean) => {
                  SettingsService.pickModel(m);
                })
              Column({ space: 2 }) {
                Text(m.name)
                  .fontSize(THEME.FONT_BODY)
                  .fontColor($r('app.color.text'))
                Text(m.pname)
                  .fontSize(THEME.FONT_SUB - 1)
                  .fontColor($r('app.color.faint'))
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
            }
            .width('100%')
            .padding(THEME.PAD_CARD)
            .borderRadius(THEME.RADIUS_CARD)
            .backgroundColor($r('app.color.card'))
          }, (m: ModelItem) => `mdl_${m.providerID}_${m.modelID}_${this.modelCurText}`)

          // —— APIKey（智谱） ——
          Text('API Key（智谱 Token Plan）')
            .fontSize(THEME.FONT_SUB + 1)
            .fontColor($r('app.color.sub'))
            .width('100%')
            .margin({ top: 6 })
          ForEach(this.keysArr, (k: KeyCard) => {
            Row({ space: 8 }) {
              Text(k.name)
                .fontSize(THEME.FONT_BODY)
                .fontColor($r('app.color.text'))
              Text(k.masked)
                .fontSize(THEME.FONT_SUB - 1)
                .fontColor($r('app.color.faint'))
                .layoutWeight(1)
              if (k.active) {
                Text('使用中')
                  .fontSize(THEME.FONT_SUB - 1)
                  .fontColor($r('app.color.accent'))
              } else {
                Button('启用')
                  .fontSize(THEME.FONT_SUB)
                  .backgroundColor($r('app.color.card2'))
                  .fontColor($r('app.color.text'))
                  .onClick(() => {
                    SettingsService.activateKey(k.name).then((ok: boolean) => {
                      if (ok) {
                        SettingsService.loadKeys().catch(() => {});
                      }
                    });
                  })
              }
            }
            .width('100%')
            .padding(THEME.PAD_CARD)
            .borderRadius(THEME.RADIUS_CARD)
            .backgroundColor($r('app.color.card'))
          }, (k: KeyCard) => `key_${k.name}_${k.active}`)

          // —— 模型比价（M5） ——
          Text('模型比价（元/百万 tokens · 峰/谷）')
            .fontSize(THEME.FONT_SUB + 1)
            .fontColor($r('app.color.sub'))
            .width('100%')
            .margin({ top: 6 })
          ForEach(this.pricesArr, (pr: PriceRow) => {
            Row({ space: 6 }) {
              Column({ space: 2 }) {
                Text(pr.name)
                  .fontSize(THEME.FONT_SUB)
                  .fontColor($r('app.color.text'))
                Text(pr.provider + (pr.contextText !== '' ? ' · ' + pr.contextText : ''))
                  .fontSize(THEME.FONT_SUB - 2)
                  .fontColor($r('app.color.faint'))
              }
              .alignItems(HorizontalAlign.Start)
              .layoutWeight(1)
              Column({ space: 2 }) {
                Text('命中 ' + pr.inputHit).fontSize(THEME.FONT_SUB - 2).fontColor($r('app.color.accent'))
                Text('未中 ' + pr.inputMiss).fontSize(THEME.FONT_SUB - 2).fontColor($r('app.color.sub'))
                Text('输出 ' + pr.output).fontSize(THEME.FONT_SUB - 2).fontColor($r('app.color.warn'))
              }
              .alignItems(HorizontalAlign.End)
            }
            .width('100%')
            .padding(THEME.PAD_CARD)
            .borderRadius(THEME.RADIUS_CARD)
            .backgroundColor($r('app.color.card'))
          }, (pr: PriceRow) => `prc_${pr.provider}_${pr.name}`)

          // —— 余额 ——
          Row() {
            Text('DeepSeek 余额').fontSize(THEME.FONT_BODY).fontColor($r('app.color.text')).layoutWeight(1)
            Text(this.balance)
              .id('balanceText')
              .fontSize(THEME.FONT_BODY)
              .fontColor($r('app.color.accent'))
          }
          .width('100%')
          .padding(THEME.PAD_CARD)
          .borderRadius(THEME.RADIUS_CARD)
          .backgroundColor($r('app.color.card'))
          .margin({ top: 6 })

          Text('App 1.0.1 · littleDJ')
            .fontSize(THEME.FONT_SUB - 2)
            .fontColor($r('app.color.faint'))
            .margin({ top: 12, bottom: 20 })
        }
        .width('100%')
        .padding({ left: THEME.PAD_PAGE, right: THEME.PAD_PAGE, top: 12 })
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
    .backgroundColor($r('app.color.bg'))
  }
}

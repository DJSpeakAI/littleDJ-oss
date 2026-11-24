// @提供 Probe 探针页（M0.0 验收在用：GET /api/event 挂机+断线重连+看门狗观测；凭据内存态零落盘） @依赖 core/Net core/Sse
// 地址/凭据内存态零落盘（二审 P1-3：密码仅登录页内存态，不进日志不入盘）
// 验收（方案 M0.0 行）：挂机 30min 事件计数 + 断线恢复时延 + 真阳性对账（PWA 发消息→断网 2min→恢复→计数+1 且预览吻合）
// @依赖 core/Sse、core/Net（pages→core 只读工具，P2-4 修订口径）
import { SseProbe, ProbeStats, mkStats } from '../core/Sse';
import { probePing, basicAuth } from '../core/Net';

@Entry
@Component
struct Probe {
  @State addr: string = 'http://192.0.2.10:4097';
  @State user: string = 'dj';
  @State pass: string = '';
  @State running: boolean = false;
  @State stats: ProbeStats = mkStats();
  @State logs: string = '（探针未启动）';
  private probe: SseProbe | null = null;
  private logLines: string[] = [];

  private pushLog(line: string): void {
    this.logLines.push(line);
    if (this.logLines.length > 300) {
      this.logLines.splice(0, this.logLines.length - 300);
    }
    this.logs = this.logLines.join('\n');
  }

  private mkAuth(): string {
    // 内存态 Basic；M0.1 换 /_login 90 天通行证 + Asset 后此路径退役
    return basicAuth(this.user, this.pass);
  }

  build() {
    Column({ space: 12 }) {
      Text('littleDJ · M0.0 SSE 探针')
        .fontSize(18)
        .fontWeight(FontWeight.Bold)
        .padding({ top: 14 })
      TextInput({ text: this.addr, placeholder: '服务器地址（如 http://192.0.2.10:4097）' })
        .onChange((v: string) => {
          this.addr = v.trim();
        })
        .enabled(!this.running)
      TextInput({ text: this.user, placeholder: '用户名' })
        .onChange((v: string) => {
          this.user = v.trim();
        })
        .enabled(!this.running)
      TextInput({ text: this.pass, placeholder: '密码（仅内存态，不落盘）' })
        .type(InputType.Password)
        .onChange((v: string) => {
          this.pass = v;
        })
        .enabled(!this.running)

      Row({ space: 10 }) {
        Button(this.running ? '停止' : '探活并挂机')
          .onClick(() => {
            this.toggle();
          })
        Button('断线模拟')
          .enabled(this.running)
          .opacity(this.running ? 1 : 0.4)
          .onClick(() => {
            this.probe?.simulateDrop();
          })
      }

      // 状态面板
      Column({ space: 4 }) {
        this.statRow('状态', this.stats.state);
        this.statRow('业务事件（data 帧）', `${this.stats.eventCount}`);
        this.statRow('全部帧（含心跳）', `${this.stats.frameCount}`);
        this.statRow('累计字节', `${this.stats.byteCount}`);
        this.statRow('最后帧时间', this.stats.lastFrameAt);
        this.statRow('看门狗触发', `${this.stats.watchdogFired} 次`);
        this.statRow('重连次数', `${this.stats.reconnects} 次`);
        this.statRow('最近恢复耗时', this.stats.lastRecoverMs > 0 ? `${this.stats.lastRecoverMs} ms` : '-');
        this.statRow('最近错误', this.stats.lastErr);
        Text(`最后事件预览：${this.stats.lastFramePreview}`)
          .fontSize(12)
          .fontColor('#9aa4b2')
          .maxLines(3)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
      }
      .width('100%')
      .padding(10)
      .borderRadius(8)
      .backgroundColor('#1c2230')

      Scroll() {
        Text(this.logs)
          .fontSize(12)
          .fontColor('#8fa3bf')
          .width('100%')
          .textAlign(TextAlign.Start)
      }
      .layoutWeight(1)
      .width('100%')
      .padding(10)
      .borderRadius(8)
      .backgroundColor('#141922')
      .edgeEffect(EdgeEffect.Spring)
    }
    .width('100%')
    .height('100%')
    .padding({ left: 14, right: 14, bottom: 14 })
    .backgroundColor('#0d1117')
  }

  @Builder
  statRow(k: string, v: string) {
    Row() {
      Text(k).fontSize(13).fontColor('#9aa4b2').layoutWeight(1)
      Text(v).fontSize(13).fontColor('#e6edf3').maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('100%')
  }

  private toggle(): void {
    if (this.running) {
      this.probe?.stop();
      this.running = false;
      return;
    }
    if (this.pass.length === 0) {
      this.pushLog('[!] 请先输入密码（内存态）');
      return;
    }
    this.logLines = [];
    this.logs = '';
    const auth = this.mkAuth();
    this.pushLog(`探活 ${this.addr} …`);
    probePing(this.addr, auth).then((r) => {
      this.pushLog(`探活 ${r.ok ? '✅' : '❌'} code=${r.code} ${r.ms}ms ${r.text}`);
      if (!r.ok) {
        return;
      }
      const sseUrl = `${this.addr}/api/event`;
      this.probe = new SseProbe(sseUrl, auth);
      this.probe.onLog = (line: string): void => {
        this.pushLog(line);
      };
      this.probe.onStats = (s: ProbeStats): void => {
        this.stats = s;
      };
      this.probe.start();
      this.running = true;
    });
  }
}

// @提供 VoiceService pcmToWav（M4 语音对话：AudioCapturer 16k/16bit/mono PCM→手拼 WAV→/_voice/stt→/_voice/tts mp3→AVPlayer） @依赖 Net
// M4 task361：armed=语音发送后回复收尾朗读一次（PWA armed 语义简化版）
import { media } from '@kit.MediaKit';
import { audio } from '@kit.AudioKit';
import { fileIo } from '@kit.CoreFileKit';
import { common } from '@kit.AbilityKit';
import { rawRequest } from '../../core/Net';
import { util } from '@kit.ArkTS';

const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const SAMPLE_BITS = 16;



/** PCM→WAV（44 字节 RIFF 头+data；16k/16bit/mono——后端 voiceStt 硬要求） */
export function pcmToWav(pcm: Uint8Array): ArrayBuffer {
  const dataLen = pcm.byteLength;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const wstr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) {
      v.setUint8(off + i, s.charCodeAt(i));
    }
  };
  wstr(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, CHANNELS, true);
  v.setUint32(24, SAMPLE_RATE, true);
  v.setUint32(28, SAMPLE_RATE * CHANNELS * SAMPLE_BITS / 8, true);
  v.setUint16(32, CHANNELS * SAMPLE_BITS / 8, true);
  v.setUint16(34, SAMPLE_BITS, true);
  wstr(36, 'data');
  v.setUint32(40, dataLen, true);
  const u8 = new Uint8Array(buf);
  u8.set(pcm, 44);
  return buf;
}

export class VoiceService {
  /** UI 层 EntryAbility/Index 注入（getContext 禁用于普通 class） */
  static appCtx: common.UIAbilityContext | null = null;

  static setContext(c: common.UIAbilityContext): void {
    VoiceService.appCtx = c;
  }
  private static capturer: audio.AudioCapturer | null = null;
  private static chunks: Uint8Array[] = [];
  private static recording: boolean = false;
  private static player: media.AVPlayer | null = null;
  private static armed: boolean = false;

  static isRecording(): boolean {
    return VoiceService.recording;
  }

  /** 开始录音（AudioCapturer RAW 16k/16bit/mono；权限由 UI 层先行申请） */
  static start(): Promise<void> {
    if (VoiceService.recording) {
      return Promise.resolve();
    }
    const opts: audio.AudioCapturerOptions = {
      streamInfo: {
        samplingRate: SAMPLE_RATE,
        channels: audio.AudioChannel.CHANNEL_1,
        sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
        encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
      },
      capturerInfo: {
        source: audio.SourceType.SOURCE_TYPE_MIC,
        capturerFlags: 0
      }
    };
    return new Promise<void>((resolve, reject) => {
      audio.createAudioCapturer(opts).then((cap: audio.AudioCapturer) => {
        VoiceService.capturer = cap;
        VoiceService.chunks = [];
        cap.start().then(() => {
          VoiceService.recording = true;
          VoiceService.pump();
          resolve();
        }).catch((e: Error) => {
          reject(new Error(`录音启动失败：${e.message}`));
        });
      }).catch((e: Error) => {
        reject(new Error(`麦克风不可用：${e.message}`));
      });
    });
  }

  private static pump(): void {
    const cap = VoiceService.capturer;
    if (cap === null || !VoiceService.recording) {
      return;
    }
    const bufSize = 3200; // 100ms @16k*2B
        cap.read(bufSize, true).then((data: ArrayBuffer) => {
      if (data.byteLength > 0 && VoiceService.recording) {
        VoiceService.chunks.push(new Uint8Array(data));
      }
      if (VoiceService.recording) {
        VoiceService.pump();
      }
    }).catch(() => {
      // 读失败静默停泵（stop 兜底）
    });
  }

  /** STT 专用（JSON 响应走 request 通道） */
  static transcribe(): Promise<string> {
    VoiceService.recording = false;
    const cap = VoiceService.capturer;
    VoiceService.capturer = null;
    let total = 0;
    VoiceService.chunks.forEach((c: Uint8Array) => {
      total += c.byteLength;
    });
    const pcm = new Uint8Array(total);
    let off = 0;
    VoiceService.chunks.forEach((c: Uint8Array) => {
      pcm.set(c, off);
      off += c.byteLength;
    });
    VoiceService.chunks = [];
    const stopP = cap !== null ? cap.stop().then(() => {
      cap.release();
    }).catch(() => {}) : Promise.resolve();
    return stopP.then((): Promise<string> => {
      if (total < 1600) {
        return Promise.resolve('');
      }
      // STT 端点收 raw wav 回 {ok,text}——request 只支持 JSON body；用 rawRequest 拿字节再解
      return rawRequest('/_voice/stt', pcmToWav(pcm), 'audio/wav').then((b: ArrayBuffer): string => {
        // STT 回 JSON {ok,text}——bytes→text 解码
        try {
          const txt = util.TextDecoder.create('utf-8').decodeToString(new Uint8Array(b));
          const j = JSON.parse(txt) as Record<string, Object>;
          const t = j['text'];
          return typeof t === 'string' ? t : '';
        } catch (e) {
          return '';
        }
      }).catch((_e: Error): string => {
        return '';
      });
    });
  }

  /** TTS 播报（POST /_voice/tts {text} →mp3 bytes→临时文件→AVPlayer） */
  static speak(text: string): Promise<void> {
    if (text.trim() === '') {
      return Promise.resolve();
    }
    const body: Record<string, Object> = { 'text': text.slice(0, 500), 'fmt': 'mp3' };
    // TTS 回 mp3 流——rawRequest JSON 字符串体直收二进制
    return rawRequest('/_voice/tts', VoiceService.strBuf(JSON.stringify(body)), 'application/json').then((mp3: ArrayBuffer) => {
      if (mp3.byteLength < 64) {
        return;
      }
      return VoiceService.playTmp(mp3);
    }).catch(() => {});
  }

  private static strBuf(s: string): ArrayBuffer {
    const u8 = new util.TextEncoder().encodeInto(s);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }

  private static playTmp(bytes: ArrayBuffer): Promise<void> {
    return new Promise<void>((resolve) => {
      const dir = VoiceService.appCtx !== null ? VoiceService.appCtx.cacheDir : '';
      if (dir === '') {
        resolve();
        return;
      }
      const f = `${dir}/tts_${Date.now()}.mp3`;
      try {
        const file = fileIo.openSync(f, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
        fileIo.writeSync(file.fd, bytes);
        fileIo.closeSync(file);
      } catch (e) {
        resolve();
        return;
      }
      media.createAVPlayer().then((p: media.AVPlayer) => {
        VoiceService.player = p;
        p.url = `file://${f}`;
        p.on('stateChange', (state: string) => {
          if (state === 'idle') {
            p.release().catch(() => {});
          }
          if (state === 'error' || state === 'stopped') {
            p.release().catch(() => {});
            resolve();
          }
        });
        p.on('stateChange', (st: string) => {
          if (st === 'completed') {
            p.release().catch(() => {});
            resolve();
          }
        });
        p.play().catch(() => {
          p.release().catch(() => {});
          resolve();
        });
      }).catch(() => {
        resolve();
      });
    });
  }

  /** armed 语义（简化版）：语音发送后进入，回复 idle 朗读一次 */
  static arm(): void {
    VoiceService.armed = true;
  }

  static disarm(): void {
    VoiceService.armed = false;
  }

  static isArmed(): boolean {
    return VoiceService.armed;
  }

  /** 订阅回复收尾朗读（EV.SESSION_BUSY idle 时触发——由 UI 层调 onReplyDone） */
  static onReplyDone(replyText: string): void {
    if (VoiceService.armed && replyText.trim() !== '') {
      VoiceService.disarm();
      VoiceService.speak(replyText).catch(() => {});
    }
  }
}

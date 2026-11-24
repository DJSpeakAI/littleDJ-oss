// @提供 baseUrl setBaseUrl passCookie setPassCookie request login authProbe probeUa basicAuth netErrText probePing（完整网络层：Mozilla UA+/_login 通行证+401 统一拦截） @依赖 core/event-bus core/events
import { http } from '@kit.NetworkKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { EventBus } from './event-bus';
import { EV } from './events';

/** 全局服务地址（登录页写入；形如 http://192.0.2.10:4097，不带尾斜杠） */
let gBaseUrl = '';
/** 内存态通行证（Asset 加载后注入；每次请求带 Cookie: dj_pass=xxx；Basic 头仅内存态） */
let gPassCookie = '';

export function baseUrl(): string {
  return gBaseUrl;
}

export function setBaseUrl(u: string): void {
  gBaseUrl = u.replace(/\/+$/, '');
}

export function setPassCookie(token: string): void {
  gPassCookie = token;
}

export function passCookie(): string {
  return gPassCookie;
}

/** JSON 请求（api() 直译）：401 → 清通行证事件（页面回登录）；非 2xx 抛 Error（中文消息） */
export function request(path: string, method: string, body: object | null): Promise<object> {
  return new Promise<object>((resolve, reject) => {
    const req = http.createHttp();
    const header: Record<string, string> = {
      'User-Agent': probeUa()
    };
    if (gPassCookie !== '') {
      header['Cookie'] = `dj_pass=${gPassCookie}`;
    }
    let extra: string = '';
    if (body !== null) {
      header['Content-Type'] = 'application/json';
      extra = JSON.stringify(body);
    }
    req.request(`${gBaseUrl}${path}`, {
      method: method === 'POST' ? http.RequestMethod.POST : http.RequestMethod.GET,
      header: header,
      extraData: extra,
      connectTimeout: 15000,
      readTimeout: 30000,
      usingCache: false
    }).then((resp: http.HttpResponse) => {
      req.destroy();
      const code = resp.responseCode;
      if (code === 401) {
        gPassCookie = '';
        const evPayload: Record<string, Object> = {};
        EventBus.emit(EV.AUTH_EXPIRED, evPayload);
        reject(new Error(netErrText(401)));
        return;
      }
      let data: object = JSON.parse('{}');
      const res = resp.result;
      if (typeof res === 'string') {
        if (res !== '') {
          try {
            data = JSON.parse(res) as object;
          } catch (e) {
            // 保底空对象
          }
        }
      } else if (typeof res === 'object' && res !== null) {
        // ArkTS http：application/json 响应 result 已是解析后的对象
        data = res;
      }
      if (code >= 200 && code < 300) {
        resolve(data);
        return;
      }
      // 204 无 body 属正常：resolve 空对象
      reject(new Error(netErrText(code)));
    }).catch((e: Error) => {
      req.destroy();
      reject(new Error(`连接异常：${e.message}`));
    });
  });
}

export interface LoginResult {
  ok: boolean;
  did: string;
  token: string;
  error: string;
}

/** POST /_login：用户名+密码+设备名 → 90 天 dj_pass 通行证（Set-Cookie 值经响应头解析） */
export function login(user: string, pass: string, name: string): Promise<LoginResult> {
  return new Promise<LoginResult>((resolve) => {
    const req = http.createHttp();
    const loginBody: Record<string, string> = { 'user': user, 'pass': pass, 'name': name };
    req.request(`${gBaseUrl}/_login`, {
      method: http.RequestMethod.POST,
      header: {
        'Content-Type': 'application/json',
        'User-Agent': probeUa()
      },
      extraData: JSON.stringify(loginBody),
      connectTimeout: 15000,
      readTimeout: 15000,
      usingCache: false
    }).then((resp: http.HttpResponse) => {
      const code = resp.responseCode;
      // Set-Cookie: dj_pass=xxx; ...（ArkTS header 值可能是 string 或 Array<string>，两种都收）
      let token = '';
      const respHeader: Record<string, Object> = resp.header as Record<string, Object>;
      const rawCookie: Object | undefined = respHeader['set-cookie'];
      let cookieStr = '';
      if (typeof rawCookie === 'string') {
        cookieStr = rawCookie;
      } else if (rawCookie !== undefined && Array.isArray(rawCookie)) {
        const arr = rawCookie as Array<string>;
        if (arr.length > 0) {
          cookieStr = arr[0];
        }
      }
      if (cookieStr !== '') {
        const m = cookieStr.match(/dj_pass=([^;]+)/);
        if (m && m.length > 1) {
          token = m[1];
        }
      }
      let did = '';
      let ok = false;
      let j: Record<string, Object> | null = null;
      const res = resp.result;
      if (typeof res === 'string') {
        if (res !== '') {
          try {
            j = JSON.parse(res) as Record<string, Object>;
          } catch (e) {
            j = null;
          }
        }
      } else if (typeof res === 'object' && res !== null) {
        j = res as Record<string, Object>;
      }
      if (j !== null) {
        ok = j['ok'] === true;
        const d = j['did'];
        if (typeof d === 'string') {
          did = d;
        }
      }
      req.destroy();
      if (code === 200 && ok && token !== '') {
        const r: LoginResult = { ok: true, did: did, token: token, error: '' };
        resolve(r);
        return;
      }
      const r2: LoginResult = { ok: false, did: '', token: '', error: netErrText(code) };
      resolve(r2);
    }).catch((e: Error) => {
      req.destroy();
      const r3: LoginResult = { ok: false, did: '', token: '', error: `连接异常：${e.message}` };
      resolve(r3);
    });
  });
}


/** M4 语音：raw body POST + binary 响应（STT 音频上载/TTS mp3 回收；JSON 版 request 不适用） */
export function rawRequest(path: string, body: ArrayBuffer | null, contentType: string): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const req = http.createHttp();
    const header: Record<string, string> = {
      'User-Agent': probeUa(),
      'Content-Type': contentType
    };
    if (gPassCookie !== '') {
      header['Cookie'] = `dj_pass=${gPassCookie}`;
    }
    req.request(`${gBaseUrl}${path}`, {
      method: http.RequestMethod.POST,
      header: header,
      extraData: body,
      expectDataType: http.HttpDataType.ARRAY_BUFFER,
      connectTimeout: 15000,
      readTimeout: 60000,
      usingCache: false
    }).then((resp: http.HttpResponse) => {
      req.destroy();
      if (resp.responseCode === 401) {
        gPassCookie = '';
        const evPayload: Record<string, Object> = {};
        EventBus.emit(EV.AUTH_EXPIRED, evPayload);
        reject(new Error(netErrText(401)));
        return;
      }
      if (resp.responseCode < 200 || resp.responseCode >= 300) {
        let msg = `HTTP ${resp.responseCode}`;
        const txt = typeof resp.result === 'string' ? resp.result : '';
        if (txt !== '') {
          try {
            const j = JSON.parse(txt) as Record<string, Object>;
            const e = j['error'];
            if (typeof e === 'string') { msg = e; }
          } catch (err) {
            // 非 JSON 文本原样
          }
        }
        reject(new Error(msg));
        return;
      }
      if (resp.result instanceof ArrayBuffer) {
        resolve(resp.result);
        return;
      }
      resolve(new ArrayBuffer(0));
    }).catch((e: Error) => {
      req.destroy();
      reject(new Error(`连接异常：${e.message}`));
    });
  });
}

/** 通行证探活（/_auth 只认 dj_pass，401=通行证失效需重登）；返回 http code，网络失败 -1 */
export function authProbe(): Promise<number> {
  return new Promise<number>((resolve) => {
    const req = http.createHttp();
    req.request(`${gBaseUrl}/_auth`, {
      method: http.RequestMethod.GET,
      header: {
        'User-Agent': probeUa(),
        'Cookie': `dj_pass=${gPassCookie}`
      },
      connectTimeout: 8000,
      readTimeout: 8000,
      usingCache: false
    }).then((resp: http.HttpResponse) => {
      req.destroy();
      resolve(resp.responseCode);
    }).catch(() => {
      req.destroy();
      resolve(-1);
    });
  });
}

/** 内存态 Basic 头（ArkTS 无 btoa，走 util.Base64Helper；M0.1 换 /_login 通行证后退役） */
export function basicAuth(user: string, pass: string): string {
  const enc = new util.TextEncoder();
  const b64 = new util.Base64Helper();
  return `Basic ${b64.encodeToStringSync(enc.encodeInto(`${user}:${pass}`))}`;
}

/** 固定 UA：必须 Mozilla/ 前缀（task359 设备清理单判据=非 Mozilla 前缀 24h 吊销，二审 P1-B） */
export function probeUa(): string {
  return `Mozilla/5.0 (HarmonyOS; ${deviceInfo.deviceType}) littleDJ-HarmonyApp/1.0`;
}

/** 探针页错误中文化（M0.0 最小集；M0.1 随 Net.ets 完整版扩充） */
export function netErrText(code: number): string {
  if (code === 429) {
    return '操作太频繁了（429）——稍等一会再试';
  }
  if (code === 401) {
    return '用户名或密码不对（401）';
  }
  if (code === 403) {
    return '没有权限（403）——外网 5G 请走外网地址';
  }
  if (code === 404) {
    return '接口不存在（404）——检查服务器地址';
  }
  if (code === 500 || code === 502) {
    return `服务器开小差了（${code}）——稍后再试`;
  }
  if (code === 0) {
    return '连不上服务器——检查地址与网络';
  }
  return `请求失败（${code}）`;
}

export interface PingResult {
  ok: boolean;
  code: number;
  ms: number;
  text: string;
}

/** 探活：GET 根路径带 Basic（探针用；M0.1 换 /_login 通行证后此函数退役为 probe 专用） */
export function probePing(url: string, auth: string): Promise<PingResult> {
  const t0 = Date.now();
  return new Promise<PingResult>((resolve) => {
    const req = http.createHttp();
    req.request(url, {
      method: http.RequestMethod.GET,
      header: {
        'Authorization': auth,
        'User-Agent': probeUa()
      },
      connectTimeout: 10000,
      readTimeout: 10000,
      usingCache: false
    }).then((resp: http.HttpResponse) => {
      const ms = Date.now() - t0;
      const ok = resp.responseCode >= 200 && resp.responseCode < 300;
      const r: PingResult = { ok: ok, code: resp.responseCode, ms: ms, text: netErrText(resp.responseCode) };
      req.destroy();
      resolve(r);
    }).catch((e: Error) => {
      const r: PingResult = { ok: false, code: 0, ms: Date.now() - t0, text: `连接异常：${e.message}` };
      req.destroy();
      resolve(r);
    });
  });
}

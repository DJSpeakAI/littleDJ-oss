// ============================================================
// selftest-relay-integrity.js — task392 relay 图片完整性闸自测
// ============================================================
// 背景（task392，2026-11-22）：/tmp/dev_home.jpeg 写入截断（2800×1840 只有 88KB、
//   缺 JPEG EOI），read 工具原样编入上下文 → DeepSeek 400「invalid image ... corrupted
//   or truncated」→ 坏图永久写进会话历史，每次请求重发必挂（会话毒化）。
// 本测验证 relay 新增的 imageIntegrity()：已知格式缺结束标记 → 替换占位文本；
//   正常图 → 原样透传。全程假上游（临时端口），不碰生产 4099、不消耗模型额度。
//
// 跑法：node deploy/selftest-relay-integrity.js   （EXIT=0 全过）
// ============================================================
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const RELAY = path.join(ROOT, 'server', 'deepseek-relay.js');
const FAKE_PORT = 14099;
const RELAY_PORT = 14098;

// 1×1 透明 PNG（67 字节，标准样本）
const GOOD_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==',
  'base64'
);
// 截断 JPEG：SOI + 大 APP15 填充 + APP0 + SOF0（16×16），无 SOS / 无 EOI ——
//   头部可解析、尾部缺失；填充到 >IMAGE_MIN_B64(4KB) base64 以进入守卫生效面
const badJpegParts = [];
badJpegParts.push(Buffer.from([0xff, 0xd8])); // SOI
const pad = Buffer.alloc(4 + 4000);
pad[0] = 0xff; pad[1] = 0xef; pad.writeUInt16BE(4002, 2); // APP15 段（4000 字节填充）
badJpegParts.push(pad);
badJpegParts.push(Buffer.from([
  0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 JFIF
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01 // SOF0
]));
const BAD_JPEG = Buffer.concat(badJpegParts);
const BAD_URL = 'data:image/jpeg;base64,' + BAD_JPEG.toString('base64');
const GOOD_URL = 'data:image/png;base64,' + GOOD_PNG.toString('base64');

let upstreamSeen = null;
const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    upstreamSeen = Buffer.concat(chunks).toString('utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'fake', choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  });
});

function post(body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port: RELAY_PORT, path: '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer selftest' }
    }, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(b).toString() }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

(async () => {
  // 样本自检：好 PNG 必须有 IEND；坏 JPEG 必须缺 EOI（否则用例本身失效）
  if (GOOD_PNG.indexOf(Buffer.from('IEND')) < 0) { console.log('FAIL 样本 PNG 缺 IEND'); process.exit(1); }
  if (BAD_JPEG.indexOf(Buffer.from([0xff, 0xd9])) >= 0) { console.log('FAIL 样本 JPEG 不应含 EOI'); process.exit(1); }

  await new Promise(r => upstream.listen(FAKE_PORT, '127.0.0.1', r));
  const relay = spawn(process.execPath, [RELAY], {
    env: Object.assign({}, process.env, {
      DS_RELAY_PORT: String(RELAY_PORT),
      DS_RELAY_UPSTREAM: '127.0.0.1',
      DS_RELAY_UPSTREAM_PORT: String(FAKE_PORT),
      DS_RELAY_UPSTREAM_SCHEME: 'http',
      DS_RELAY_INBOX: '/tmp/selftest-relay-inbox'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let relayLog = '';
  relay.stdout.on('data', d => { relayLog += d.toString(); });
  relay.stderr.on('data', d => { relayLog += d.toString(); });

  let up = false;
  for (let i = 0; i < 50 && !up; i++) {
    await new Promise(r => setTimeout(r, 100));
    try {
      await new Promise((res, rej) => {
        const s = http.get('http://127.0.0.1:' + RELAY_PORT + '/health', x => { x.resume(); res(); });
        s.on('error', rej);
      });
      up = true;
    } catch (e) { /* retry */ }
  }

  if (!up) { console.log('FAIL relay 未监听'); relay.kill('SIGKILL'); upstream.close(); process.exit(1); }

  const reqBody = {
    model: 'deepseek-flash', stream: true,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'hi' },
      { type: 'image_url', image_url: { url: BAD_URL } },
      { type: 'image_url', image_url: { url: GOOD_URL } }
    ] }]
  };
  const resp = await post(reqBody);
  const seen = upstreamSeen || '';

  let pass = 0, fail = 0;
  function check(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
  }
  check('relay 响应 200', resp.status === 200, 'status=' + resp.status);
  check('坏图 data URI 未透传上游', !seen.includes(BAD_JPEG.toString('base64').slice(0, 120)));
  check('坏图替换为占位文本', seen.includes('图片已损坏'));
  check('占位含截断原因', seen.includes('JPEG EOI'));
  check('好图原样透传', seen.includes(GOOD_URL.slice(0, 120)));
  check('relay 日志含 corrupt image', /corrupt image \d+x\d+/.test(relayLog), relayLog.slice(0, 300));
  check('坏图落盘留档', /inbox=\/\S+/.test(relayLog) && !/FAILED/.test(relayLog));

  console.log('\nRESULT pass=' + pass + ' fail=' + fail);
  relay.kill('SIGKILL');
  upstream.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });

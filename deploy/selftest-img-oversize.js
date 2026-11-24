// selftest-img-oversize：task293 超限图拦截 + 落盘 + 交给切片机制自测
// 原理：本地 fake upstream + 独立 relay 子进程，端到端断言：
//       超限图不再发给上游，而是替换成 text note（含原图路径 + img-crop.js 用法），
//       原图落盘到临时 inbox；正常图/纯文本原样透传。
// 运行：node deploy/selftest-img-oversize.js
// 红对照：RELAY_JS=server/deepseek-relay.js.bak-task292-20261114 node deploy/selftest-img-oversize.js
//         旧版会把图缩到 4096 继续发图 → 断言应转红（退出码 1）。
const http = require('http')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const Jimp = require('jimp')

const RELAY_JS = process.env.RELAY_JS || path.join(__dirname, '..', 'server', 'deepseek-relay.js')
const PORT = 15000 + (process.pid % 400) * 2
const UP_PORT = PORT + 1
const INBOX = path.join('/tmp', 'lj-inbox-selftest-' + process.pid)

let pass = 0, fail = 0
let relay = null
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

const seen = []
const upstream = http.createServer(function (req, res) {
  let b = ''
  req.on('data', function (c) { b += c })
  req.on('end', function () {
    let body = null
    try { body = JSON.parse(b) } catch (e) {}
    seen.push({ method: req.method, url: req.url, raw: b, body: body })
    const out = JSON.stringify({ ok: true })
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(out) })
    res.end(out)
  })
})
function post(port, urlPath, obj) {
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: '127.0.0.1', port: port, method: 'POST', path: urlPath,
      headers: { 'content-type': 'application/json' }
    }, function (res) {
      let b = ''
      res.on('data', function (c) { b += c })
      res.on('end', function () { resolve({ status: res.statusCode, body: b }) })
    })
    req.on('error', reject)
    req.end(JSON.stringify(obj))
  })
}
function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: urlPath }, function (res) {
      res.resume()
      res.on('end', function () { resolve({ status: res.statusCode }) })
    }).on('error', reject)
  })
}
function waitHealth(port, tries) {
  return new Promise(function (resolve) {
    let i = 0
    ;(function tick() {
      get(port, '/health').then(function (r) { resolve(r.status === 200) }).catch(function () {
        if (++i >= tries) return resolve(false)
        setTimeout(tick, 200)
      })
    })()
  })
}
function startRelay(port) {
  const env = Object.assign({}, process.env, {
    DS_RELAY_PORT: String(port),
    DS_RELAY_UPSTREAM: '127.0.0.1',
    DS_RELAY_UPSTREAM_PORT: String(UP_PORT),
    DS_RELAY_UPSTREAM_SCHEME: 'http',
    DS_RELAY_INBOX: INBOX
  })
  return spawn(process.execPath, [RELAY_JS], { env: env, stdio: ['ignore', 'pipe', 'pipe'] })
}
function lastSeen() { return seen[seen.length - 1] || {} }
function b64Of(url) {
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(url || '')
  return m ? { mime: m[1], b64: m[2], buf: Buffer.from(m[2], 'base64') } : null
}
function pngDims(buf) {
  if (!buf || buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}
async function makePng(w, h) {
  const img = new Jimp(w, h, 0x224466ff)
  img.scan(0, 0, w, h, function (x, y, idx) {
    const d = this.bitmap.data
    d[idx] = x & 0xff
    d[idx + 1] = y & 0xff
    d[idx + 2] = (x + y) & 0xff
    d[idx + 3] = 255
  })
  return await img.quality(80).getBufferAsync(Jimp.MIME_PNG)
}
function openaiMsg(url) {
  return { model: 'deepseek-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'image_url', image_url: { url: url, detail: 'original' } }] }] }
}
function allText(body) {
  return JSON.stringify(body)
}

;(async () => {
  console.log('== selftest-img-oversize (task293) ==')
  if (!fs.existsSync(RELAY_JS)) { console.log('FAIL relay 文件不存在: ' + RELAY_JS); process.exit(1) }
  try { fs.rmSync(INBOX, { recursive: true, force: true }) } catch (e) {}
  await new Promise(function (r) { upstream.listen(UP_PORT, '127.0.0.1', r) })
  relay = startRelay(PORT)
  process.on('exit', function () {
    try { if (relay) relay.kill('SIGKILL') } catch (e) {}
    try { upstream.close() } catch (e) {}
  })
  relay.stdout.on('data', function (d) { const s = String(d).trim(); if (s) console.log('  [relay] ' + s) })
  relay.stderr.on('data', function (d) { console.log('  [relay stderr] ' + String(d).trim()) })
  const up = await waitHealth(PORT, 30)
  ok('relay /health 就绪', up)
  if (!up) return cleanup(1)

  const tall = await makePng(300, 9000)
  const tallUrl = 'data:image/png;base64,' + tall.toString('base64')
  const small = await makePng(320, 240)
  const smallUrl = 'data:image/png;base64,' + small.toString('base64')

  // ① 超限图：不发给上游，替换为 text note + 原图落盘
  let r = await post(PORT, '/chat/completions', openaiMsg(tallUrl))
  let s = lastSeen()
  let content = s.body && s.body.messages[0].content
  const note = content && content[1]
  ok('① 超限图被替换为 text note', !!note && note.type === 'text', JSON.stringify(note && note.type))
  ok('① note 含原图路径', !!note && typeof note.text === 'string' && note.text.indexOf(INBOX) >= 0)
  ok('① note 含 img-crop.js 用法', !!note && typeof note.text === 'string' && note.text.indexOf('img-crop.js') >= 0 && note.text.indexOf('split') >= 0)
  ok('① 上游请求里不再有 image_url', !!content && content.every(function (p) { return p.type !== 'image_url' }))
  const files = fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter(function (f) { return /^img-/.test(f) }) : []
  ok('① inbox 落盘 1 张原图', files.length === 1, 'files=' + files.length)
  const inboxBuf = files.length ? fs.readFileSync(path.join(INBOX, files[0])) : null
  const idim = pngDims(inboxBuf)
  ok('① 落盘图尺寸=原图 300x9000', !!idim && idim.w === 300 && idim.h === 9000, JSON.stringify(idim))
  ok('① 响应透传 200', r.status === 200)

  // ② 同图再发：sha 去重，不重复落盘，note 路径一致
  await post(PORT, '/chat/completions', openaiMsg(tallUrl))
  s = lastSeen()
  const note2 = s.body && s.body.messages[0] && s.body.messages[0].content && s.body.messages[0].content[1]
  const files2 = fs.existsSync(INBOX) ? fs.readdirSync(INBOX).filter(function (f) { return /^img-/.test(f) }) : []
  ok('② 同图去重（inbox 仍 1 张）', files2.length === 1, 'files=' + files2.length)
  ok('② 两次 note 路径一致', !!note2 && !!note && note2.text === note.text)

  // ③ 正常尺寸图原样透传（字节一致）
  await post(PORT, '/chat/completions', openaiMsg(smallUrl))
  s = lastSeen()
  ok('③ 正常图原样透传', s.body.messages[0].content[1].image_url.url === smallUrl)

  // ④ Anthropic source 形态也被拦截
  await post(PORT, '/chat/completions', {
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: tall.toString('base64') } }] }]
  })
  s = lastSeen()
  ok('④ Anthropic 形态被替换为 text', s.body.messages[0].content[0].type === 'text' && s.body.messages[0].content[0].text.indexOf('img-crop.js') >= 0)

  // ⑤ 纯文本请求：不误伤 + reasoning 仍注入
  await post(PORT, '/chat/completions', { model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
  s = lastSeen()
  ok('⑤ 纯文本：reasoning=max 且内容不变', s.body.reasoning_effort === 'max' && s.body.messages[0].content === 'hi')

  // ⑥ GET /models 不解析
  await new Promise(function (resolve) {
    http.get({ host: '127.0.0.1', port: PORT, path: '/models' }, function (res) { res.resume(); res.on('end', resolve) }).on('error', resolve)
  })
  s = lastSeen()
  ok('⑥ GET /models 原样透传', s.method === 'GET' && s.url === '/models' && s.raw === '')

  // ⑦ 正常图不落盘（inbox 仍只有超限图）
  ok('⑦ 正常图不产生 inbox 文件', !fs.existsSync(INBOX) || fs.readdirSync(INBOX).filter(function (f) { return /^img-/.test(f) }).length === 1)

  cleanup(fail > 0 ? 1 : 0)

  function cleanup(code) {
    try { relay.kill('SIGKILL') } catch (e) {}
    try { upstream.close() } catch (e) {}
    try { fs.rmSync(INBOX, { recursive: true, force: true }) } catch (e) {}
    console.log('== 结果: ' + pass + ' pass / ' + fail + ' fail ==')
    process.exit(code)
  }
})().catch(function (e) {
  console.log('FATAL ' + (e && e.stack))
  process.exit(1)
})

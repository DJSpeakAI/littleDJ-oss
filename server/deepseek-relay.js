// deepseek-relay: 本机 DeepSeek 中转（127.0.0.1:4099）
// 背景：serve 内核为 bun 运行时，其对 DeepSeek 官方 brotli 压缩流式响应的解压存在
// 丢字节 bug（长流触发 AI_JSONParseError: Unterminated string）。
// 方案：中转代理去掉 Accept-Encoding 请求官方（官方返回未压缩流），原样透传给
// serve，绕过 bun 的 brotli 解压路径。node 的 http 透转无此问题。
//
// 上游失败退避重试：请求体（≤MAX_BUFFER）先读入内存，仅在上游「响应未开始 + 请求体未完整
// 写出 + 非 300s 超时 + 尝试次数 <3」时退避重试（500ms*2^n + 0~250ms 抖动）；耗尽或
// 不可重试则回 503 + Retry-After。请求体超限即放弃重试资格，退回单试流式转发，
// 不把超大 body 读满内存。上游非 2xx（429/5xx）原样透传，不重试。
//
// task270：DeepSeek 思考档位默认最高（max），注入点在转发前。
//
// task293（2026-11-14）：图片超限不再缩放，改为「拦截 + 落盘 + 交给小DJ切片」。
// 背景：DeepSeek 单图硬上限 8192px，且每张图内部只给约 1024 token；长图里的密码/小字
// 无论怎么缩放都会糊。正确解法是原分辨率切块、每块单独吃一份 token。
// 本中转只做守卫：任何 data:image 超过 8192px → 不发给上游（避免 400 和糊图），把原图
// 落盘到 <运行根>/inbox/（0600），并把该图片 part 替换成一段文字提示（含文件路径 +
// deploy/img-crop.js 用法），由 agent 自己 probe/split/逐块 read。正常图原样透传。
// 应急：DS_RELAY_IMAGE_HARD_LIMIT=999999 可临时放行全部图片（会回到上游 400 行为）。
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
// task393：工具回显剪枝（历史轮豁免最新轮；DSH tool-result-pruner 生产参数；fail-open）
const pruneToolResults = require('./tool-prune').pruneToolResults

const UPSTREAM_HOST = process.env.DS_RELAY_UPSTREAM || 'api.deepseek.com'
const UPSTREAM_PORT = Number(process.env.DS_RELAY_UPSTREAM_PORT || 443)
const UPSTREAM_TLS = (process.env.DS_RELAY_UPSTREAM_SCHEME || 'https') !== 'http'
const PORT = Number(process.env.DS_RELAY_PORT || 4099)
const MAX_BUFFER = Number(process.env.DS_RELAY_MAX_BUFFER || 40 * 1024 * 1024) // 请求体缓冲上限：超过即放弃重试资格
const MAX_ATTEMPTS = 3 // 最多 3 次上游请求（重试 ≤2 次）
const RETRY_AFTER_SECONDS = '3'

// task366（2026-11-16）：三重硬超时——当日 DAG 项目集体装死 3h 事故根因=上游挂死永无超时
// （连接阶段挂起 socket idle 不生效；滴字节续命；总时长无上限）→ serve 项目锁永占，只能重启 serve。
//   首字节 TTFB 5min（reasoning=max 首字可>2min，宁高勿低）；流式静默 STALL 2min（仅 event-stream /
//   流式回退分支，非流式长生成合法超长不设限，照 zhipu-relay P2-15 先例）；总时长 MAX 45min 硬顶。
// env=0 关对应层（应急闸）。细案：docs/2026-11-16 中转硬超时与项目级卡死自愈-task366.md
const TTFB_MS = Number(process.env.LITTLEDJ_RELAY_TTFB_MS || 300000)
const STALL_MS = Number(process.env.LITTLEDJ_RELAY_STALL_MS || 120000)
const MAX_DURATION_MS = Number(process.env.LITTLEDJ_RELAY_MAX_MS || 2700000)

// task270：DeepSeek 思考档位默认最高——主人令「Pro 和 V4.1 Flash 默认永远加到最高端」。
const REASONING_MODELS = { 'deepseek-flash': 1, 'deepseek-v4-pro': 1 }
const REASONING_EFFORT = process.env.DS_RELAY_EFFORT || 'max'
const NO_EFFORT = !!process.env.DS_RELAY_NO_EFFORT

// task293：图片超限守卫
const IMAGE_HARD_LIMIT = Number(process.env.DS_RELAY_IMAGE_HARD_LIMIT || 8192)
const IMAGE_MIN_B64 = 4 * 1024 // 小于此长度不可能是超限大图
const INBOX_DIR = process.env.DS_RELAY_INBOX || path.join(require('./paths').ROOT, 'inbox')
const INBOX_KEEP = 20
const CROP_SCRIPT = path.join(__dirname, '..', 'deploy', 'img-crop.js')

let inboxReady = false
function ensureInbox() {
  if (inboxReady) return
  try {
    fs.mkdirSync(INBOX_DIR, { recursive: true, mode: 0o700 })
    try { fs.chmodSync(INBOX_DIR, 0o700) } catch (e) {}
    inboxReady = true
  } catch (e) {
    console.log('[relay] inbox unavailable: ' + e.message)
  }
}

// 只读文件头解析尺寸，避免为每张图做整图解码。
function imageDims(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null
  // PNG: 8 字节签名 + IHDR（宽高为前两个 4 字节大端）
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: 'png' }
  }
  // JPEG: 扫 SOF0-SOF15（排除 DHT/JPG/DAC）
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue }
      const marker = buf[i + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = buf.readUInt16BE(i + 2)
      if (len < 2) return null
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), fmt: 'jpeg' }
      }
      i += 2 + len
    }
    return null
  }
  // GIF: 逻辑屏幕宽高（小端）
  if (buf.slice(0, 3).toString('ascii') === 'GIF') {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), fmt: 'gif' }
  }
  // WebP（VP8X / VP8 / VP8L）
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.slice(12, 16).toString('ascii')
    if (chunk === 'VP8X' && buf.length >= 30) {
      return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3), fmt: 'webp' }
    }
    if (chunk === 'VP8 ' && buf.length >= 30) {
      const start = buf.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20)
      if (start > 0 && start + 7 < buf.length) {
        return { w: buf.readUInt16LE(start + 3) & 0x3fff, h: buf.readUInt16LE(start + 5) & 0x3fff, fmt: 'webp' }
      }
    }
    if (chunk === 'VP8L' && buf.length >= 25) {
      const b = buf.slice(21, 25)
      return { w: 1 + (((b[1] & 0x3f) << 8) | b[0]), h: 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | (b[1] >> 6)), fmt: 'webp' }
    }
  }
  return null
}

function fmtBytes(n) {
  return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB'
}

// task391（2026-11-22）：图片完整性校验——事故：/tmp/dev_home.jpeg 写入截断（3312×1840 只有
//   90KB、缺 JPEG EOI），read 工具原样编入上下文 → DeepSeek 400「invalid image ... corrupted
//   or truncated」→ 坏图永久写进会话历史，每次请求重发必挂（会话毒化）。
//   imageDims 只认文件头（截断图头部完好），尺寸闸放行；此处补尾部结构校验，坏图不再直通上游。
//   只拦「已知格式且缺结束标记」这一高置信损坏（fail-open 防误伤：未知格式/变体照旧放行）。
function imageIntegrity(buf, fmt) {
  if (fmt === 'jpeg') {
    // EOI = FF D9；截断文件缺此标记（尾部允许 ≤8 字节填充）
    const eoi = buf.lastIndexOf(Buffer.from([0xff, 0xd9]))
    if (eoi < 0) return { ok: false, reason: 'missing JPEG EOI (truncated)' }
    if (buf.length - (eoi + 2) > 8) return { ok: false, reason: 'trailing data after JPEG EOI' }
    return { ok: true }
  }
  if (fmt === 'png') {
    // IEND 块收尾；截断文件缺 IEND
    const iend = buf.lastIndexOf(Buffer.from('IEND', 'ascii'))
    if (iend < 0) return { ok: false, reason: 'missing PNG IEND (truncated)' }
    if (buf.length - (iend + 4) > 8) return { ok: false, reason: 'trailing data after PNG IEND' }
    return { ok: true }
  }
  if (fmt === 'gif') {
    if (buf[buf.length - 1] !== 0x3b) return { ok: false, reason: 'missing GIF trailer (truncated)' }
    return { ok: true }
  }
  if (fmt === 'webp') {
    if (buf.length < 12) return { ok: false, reason: 'short WebP' }
    const declared = buf.readUInt32LE(4) + 8 // RIFF 长度含头 8 字节
    if (declared > buf.length) return { ok: false, reason: 'WebP truncated (RIFF declares ' + declared + ' > ' + buf.length + ')' }
    return { ok: true }
  }
  return { ok: true } // 未知格式不拦（fail-open）
}

function corruptNote(w, h, mime, bytes, file, reason) {
  return [
    '【图片已损坏·已拦截】原图 ' + w + '×' + h + 'px（' + (mime || 'image') + '，' + fmtBytes(bytes) + '），',
    '文件数据不完整（' + reason + '），模型无法解码；为避免整轮对话报错，本次没有把这张图发给模型。',
    file ? '坏图已留档：' + file : '坏图留档失败。',
    '请重新截图/导出完整图片后再发送（或换一张图）。'
  ].join('\n')
}

function pruneInbox() {
  try {
    const files = fs.readdirSync(INBOX_DIR)
      .filter(function (f) { return /^img-[0-9a-f]+\.(png|jpg|jpeg|webp|gif)$/.test(f) })
      .map(function (f) { const p = path.join(INBOX_DIR, f); return { p: p, t: fs.statSync(p).mtimeMs } })
      .sort(function (a, b) { return b.t - a.t })
    for (const f of files.slice(INBOX_KEEP)) {
      try { fs.unlinkSync(f.p) } catch (e) {}
    }
  } catch (e) {}
}

// 原图落盘（0600），同一张图按内容 sha 去重；返回路径，失败返回空串。
function saveInbox(buf, mime) {
  ensureInbox()
  if (!inboxReady) return ''
  try {
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : mime === 'image/gif' ? 'gif' : 'jpg'
    const sha = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)
    const file = path.join(INBOX_DIR, 'img-' + sha + '.' + ext)
    if (!fs.existsSync(file)) { fs.writeFileSync(file, buf, { mode: 0o600 }); try { fs.chmodSync(file, 0o600) } catch (e) {} }
    pruneInbox()
    return file
  } catch (e) {
    console.log('[relay] save inbox failed: ' + e.message)
    return ''
  }
}

function oversizeNote(w, h, mime, bytes, file) {
  return [
    '【图片过大·已拦截】原图 ' + w + '×' + h + 'px（' + (mime || 'image') + '，' + fmtBytes(bytes) + '），',
    '超过模型单图 ' + IMAGE_HARD_LIMIT + 'px 硬上限。为避免上报错和不清晰的缩略图，本次没有把原图发给模型。',
    file ? '原图已保存：' + file : '原图落盘失败，无法切片。',
    '请按下面步骤读图（不要直接 read 原图）：',
    '1) node ' + CROP_SCRIPT + ' probe "' + (file || '<原图>') + '"',
    '2) node ' + CROP_SCRIPT + ' split "' + (file || '<原图>') + '"',
    '3) 先 read 切片目录里的 overview.jpg 看整体，再按 manifest 顺序每批 8~10 张并行 read tile-*.jpg，逐块记录内容',
    '切片是原分辨率、不缩放，密码/小字保持原样；切片多时（几十块）请分批读，不要一次全读。'
  ].join('\n')
}

// 从已知图片 part 形态里抽出 data URL；返回 null 表示不是图片 part。
function imagePartInfo(part) {
  if (!part || typeof part !== 'object' || Array.isArray(part)) return null
  if (part.type === 'image_url' && part.image_url) {
    if (typeof part.image_url === 'string') return { url: part.image_url }
    if (typeof part.image_url.url === 'string') return { url: part.image_url.url }
  }
  if (part.type === 'input_image' && typeof part.image_url === 'string') return { url: part.image_url }
  if (part.type === 'image' && part.source && part.source.type === 'base64' && typeof part.source.data === 'string') {
    return { url: 'data:' + (part.source.media_type || 'image/png') + ';base64,' + part.source.data }
  }
  if (part.type === 'file' && part.file && typeof part.file.file_data === 'string') {
    return { url: part.file.file_data }
  }
  return null
}

// 超限则落盘并返回替换用的 text part；未超限/不认识返回 null。
function guardImagePart(part) {
  const info = imagePartInfo(part)
  if (!info || typeof info.url !== 'string' || info.url.slice(0, 11).toLowerCase() !== 'data:image/') return null
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(info.url)
  if (!m) return null
  if (m[2].length < IMAGE_MIN_B64) return null
  const b64 = m[2].replace(/\s+/g, '')
  let buf
  try { buf = Buffer.from(b64, 'base64') } catch (e) { return null }
  const dims = imageDims(buf)
  if (!dims) return null
  // task391：完整性闸先行——尺寸闸只看头，截断图头部完好会漏网；坏图一旦进入会话历史会毒化
  //   整段对话（每次请求重发必 400），必须在请求层剔除替换成占位文本。
  const integ = imageIntegrity(buf, dims.fmt)
  if (!integ.ok) {
    const file = saveInbox(buf, m[1])
    console.log('[relay] corrupt image ' + dims.w + 'x' + dims.h + ' ' + m[1] + ' (' + fmtBytes(buf.length) + ') blocked: ' + integ.reason + ', inbox=' + (file || 'FAILED'))
    return { type: 'text', text: corruptNote(dims.w, dims.h, m[1], buf.length, file, integ.reason) }
  }
  if (dims.w <= IMAGE_HARD_LIMIT && dims.h <= IMAGE_HARD_LIMIT) return null
  const file = saveInbox(buf, m[1])
  console.log('[relay] oversize image ' + dims.w + 'x' + dims.h + ' ' + m[1] + ' (' + fmtBytes(buf.length) + ') blocked, inbox=' + (file || 'FAILED'))
  return { type: 'text', text: oversizeNote(dims.w, dims.h, m[1], buf.length, file) }
}

// 递归遍历：数组里的图片 part 直接替换成 text note；未知形态的 data URL 字符串不动（fail-open）。
async function guardImages(node) {
  if (Array.isArray(node)) {
    let changed = false
    for (let i = 0; i < node.length; i++) {
      const item = node[i]
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const note = guardImagePart(item)
        if (note) {
          node.splice(i, 1, note)
          i += 0
          changed = true
          continue
        }
      }
      if (await guardImages(item)) changed = true
    }
    return changed
  }
  if (node && typeof node === 'object') {
    let changed = false
    for (const k of Object.keys(node)) {
      const v = node[k]
      if (v && typeof v === 'object') {
        if (await guardImages(v)) changed = true
      }
    }
    return changed
  }
  return false
}

const server = http.createServer(function (req, res) {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    return res.end('ok')
  }
  const headers = Object.assign({}, req.headers)
  delete headers.host
  delete headers['accept-encoding'] // 关键：让上游返回未压缩（identity）流
  delete headers['content-length']
  delete headers.connection

  let bodyChunks = [] // 已读入的请求体分片
  let bodySize = 0
  let streaming = false // 请求体超限：转入单试流式模式
  let attempts = 0
  let responded = false // 已进入上游响应回调，响应已对客户端可见
  let settled = false // 已向客户端收口（成功/失败/放弃）
  let current = null // 当前上游请求
  let retryTimer = null
  // task366：三重硬超时定时器（计时器随 up 实例换代，重试前显式清，防跨 attempt 误杀）
  const reqStartedAt = Date.now()
  let ttfbTimer = null // setTimeout；每次上游尝试重挂，收到响应头清除
  let stallTimer = null // setInterval；仅流式响应，每字节重置
  let durationTimer = null // setTimeout；入站请求即启动一次，不随重试重置
  let reqStreamFlag = false // 请求体 stream:true（WARN 可观测用）

  function clearRelayTimers() {
    if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = null }
    if (stallTimer) { clearInterval(stallTimer); stallTimer = null }
    if (durationTimer) { clearTimeout(durationTimer); durationTimer = null }
  }

  // task366：硬超时处置——真正断开上游 socket；未发响应头回 504（区别于上游故障 503），
  // 已发响应头 HTTP 不允许改状态码，只能截断收尾（与 failWith503 收口语义一致）。
  function hardTimeoutHit(kind, startedAt) {
    if (settled) return
    settled = true
    clearRelayTimers()
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    const el = Math.round((Date.now() - startedAt) / 1000)
    console.log('[relay] hard-timeout ' + kind + ' after ' + el + 's -> upstream destroyed (task366)')
    if (current) {
      try { current.destroy() } catch (e) {}
    }
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(504, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        error: 'relay hard timeout (' + kind + ') after ' + el + 's',
        relay: kind,
        retryable: true
      }))
    } else {
      res.end()
    }
  }

  // task366：总时长硬顶，入站请求即启动（重试同属一个入站请求，不重置）
  if (MAX_DURATION_MS > 0) {
    durationTimer = setTimeout(function () { hardTimeoutHit('max-duration', reqStartedAt) }, MAX_DURATION_MS)
  }

  function failWith503(e) {
    if (settled) return
    settled = true
    clearRelayTimers()
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    const msg = (e && e.message) || 'unknown error'
    if (!res.headersSent && !res.writableEnded) {
      console.log('[relay] upstream unavailable (attempts=' + attempts + '): ' + msg)
      res.writeHead(503, {
        'Content-Type': 'application/json',
        'Retry-After': RETRY_AFTER_SECONDS
      })
      res.end(JSON.stringify({
        error: 'relay upstream unavailable (attempts=' + attempts + '): ' + msg,
        retryable: true
      }))
    } else {
      // 响应已开始下发：只能截断，不能改状态码
      res.end()
    }
  }

  // task270：转发前注入默认思考档位（仅缓冲模式；>MAX_BUFFER 流式回退分支不注入——该场景极罕见且需流式改写，不值得）
  function injectReasoningEffort(body) {
    if (NO_EFFORT || req.method !== 'POST' || !/\/chat\/completions\/?$/.test(req.url)) return false
    if (!body || typeof body !== 'object' || Array.isArray(body)) return false
    if (typeof body.model !== 'string' || !REASONING_MODELS[body.model]) return false
    if (body.reasoning_effort !== undefined) return false // 已显式指定：尊重上游选择
    body.reasoning_effort = REASONING_EFFORT
    console.log('[relay] reasoning_effort=' + REASONING_EFFORT + ' injected for ' + body.model + ' (task270)')
    return true
  }

  // task293：拦截超限图（仅缓冲模式；流式回退分支保持原样）
  async function prepareBody() {
    if (req.method !== 'POST') return
    if (!/\/(chat\/completions|responses|messages)\/?$/.test(req.url)) return
    let body
    try {
      body = JSON.parse(Buffer.concat(bodyChunks).toString('utf8'))
    } catch (e) {
      return // 非 JSON / 解析失败：原样透传（fail-open）
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return
    if (body.stream === true) reqStreamFlag = true // task366：可观测用（非 event-stream 响应不挂 STALL 时记 WARN）
    let changed = false
    try {
      if (await guardImages(body)) changed = true
    } catch (e) {
      console.log('[relay] image guard failed: ' + e.message)
    }
    if (injectReasoningEffort(body)) changed = true
    // task393：历史轮工具回显剪枝（>8192 剪头 4096+尾 1024；最后一条 user 之后的 tool 豁免；
    // 仅认 OpenAI 形态 role:'tool'，/responses /messages 形态自然 no-op；全函数 fail-open）。
    // 应急闸 DS_RELAY_NO_PRUNE=1（照 IMAGE_HARD_LIMIT 先例）。
    if (process.env.DS_RELAY_NO_PRUNE !== '1') {
      const pr = pruneToolResults(body)
      if (pr.changed) {
        changed = true
        console.log('[relay] pruned ' + pr.prunedCount + ' tool results (-' + pr.savedChars + ' chars) (task393)')
      }
    }
    if (!changed) return
    const out = Buffer.from(JSON.stringify(body), 'utf8')
    bodyChunks = [out]
    bodySize = out.length
  }

  function startUpstream() {
    if (settled) return
    attempts++
    let sent = false // 请求体是否已完整写出上游
    const attemptStartedAt = Date.now()
    // task366：首字节超时——覆盖连接阶段挂起（socket idle 不生效区）+响应头等待期
    if (TTFB_MS > 0) {
      if (ttfbTimer) clearTimeout(ttfbTimer)
      ttfbTimer = setTimeout(function () { hardTimeoutHit('first-byte-timeout', attemptStartedAt) }, TTFB_MS)
    }
    const up = (UPSTREAM_TLS ? https : http).request({
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: headers
    }, function (ures) {
      responded = true
      if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = null } // task366：首字节已到
      console.log('[relay] ' + req.method + ' ' + req.url + ' -> ' + (ures.statusCode || '?'))
      if (settled) {
        ures.resume()
        return
      }
      const h = Object.assign({}, ures.headers)
      delete h['content-length']
      delete h['transfer-encoding']
      res.writeHead(ures.statusCode || 503, h)
      // task366：流式静默超时——仅 content-type=event-stream（P2-11 收敛：流式回退分支大 JSON 响应
      // 也可能合法超长，统一只认 SSE 头，非流式只留 TTFB+MAX+socket idle 兜底）；stream:true 但响应
      // 非 event-stream 只记 WARN 不挂（照 zhipu-relay P2-15 先例）
      const ct = String((ures.headers && ures.headers['content-type']) || '')
      const streamish = /event-stream/i.test(ct)
      if (!streamish && reqStreamFlag) {
        console.log('[relay] WARN: 请求 stream:true 但响应 content-type=' + (ct || '(空)') + '，不挂流式静默看门狗（task366，照 zhipu-relay P2-15 先例）')
      }
      if (STALL_MS > 0 && streamish) {
        let lastByteAt = Date.now()
        ures.on('data', function () { lastByteAt = Date.now() })
        stallTimer = setInterval(function () {
          if (res.writableEnded || ures.destroyed) {
            if (stallTimer) { clearInterval(stallTimer); stallTimer = null }
            return
          }
          if (Date.now() - lastByteAt >= STALL_MS) {
            hardTimeoutHit('stall-timeout', Date.now() - STALL_MS)
          }
        }, 1000)
        ures.on('end', function () { if (stallTimer) { clearInterval(stallTimer); stallTimer = null } })
        ures.on('error', function () { if (stallTimer) { clearInterval(stallTimer); stallTimer = null } })
        ures.on('close', function () { if (stallTimer) { clearInterval(stallTimer); stallTimer = null } })
      }
      ures.pipe(res)
    })
    current = up
    up.on('finish', function () {
      sent = true
    })
    up.on('error', function (e) {
      if (current !== up) return // task366 P2-4：旧 attempt 的迟到 error 不干扰新 attempt（照 zhipu 先例）
      if (settled) return
      if (responded || res.headersSent) {
        // 已开始回客户端：只能截断；上游已收到请求，重试有重复计费风险
        settled = true
        console.log('[relay] upstream error after response started, truncating: ' + e.message)
        res.end()
        return
      }
      const isTimeout = !!e && e.relayTimeout === true
      if (streaming || isTimeout || sent || attempts >= MAX_ATTEMPTS) {
        failWith503(e)
        return
      }
      // task366：进入退避等待期——当前 attempt 已终结，清掉它的 TTFB（下次尝试启动时重挂），
      // 防 backoff > TTFB 时旧定时器在「无在途请求」的等待期触发，把还没发出的重试误杀
      if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = null }
      const n = attempts - 1
      const delay = 500 * Math.pow(2, n) + Math.floor(Math.random() * 251)
      console.log('[relay] upstream error, retry ' + attempts + '/' + (MAX_ATTEMPTS - 1) + ' in ' + delay + 'ms: ' + e.message)
      retryTimer = setTimeout(function () {
        retryTimer = null
        if (!settled) startUpstream()
      }, delay)
    })
    up.setTimeout(310000, function () { // task366 P2-3：300s→310s，保「首字节期唯一出口=TTFB(300s)」口径（竞态时 TTFB 恒先触发）
      const err = new Error('upstream timeout 310s')
      err.relayTimeout = true // 超时不重试：上游可能已完整收到请求
      up.destroy(err)
    })
    if (streaming) {
      const pending = bodyChunks
      bodyChunks = []
      if (pending.length) up.write(Buffer.concat(pending))
      req.pipe(up)
    } else {
      up.end(bodyChunks.length ? Buffer.concat(bodyChunks) : undefined)
    }
  }

  res.on('close', function () {
    clearRelayTimers() // task366：客户端断开/正常收尾全路径清定时器（防泄漏与误触发）
    if (res.writableEnded) return
    // 客户端提前断开：收口定时器与上游连接，避免悬挂
    settled = true
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (current) current.destroy()
  })

  req.on('data', function (chunk) {
    if (streaming) return
    bodyChunks.push(chunk)
    bodySize += chunk.length
    if (bodySize > MAX_BUFFER) {
      // 超限：放弃重试资格，退回原有的单试流式转发
      streaming = true
      startUpstream()
    }
  })
  req.on('end', function () {
    if (streaming) return
    prepareBody().catch(function (e) {
      console.log('[relay] prepare body failed (fail-open): ' + e.message)
    }).then(function () {
      startUpstream()
    })
  })
  req.on('error', function (e) {
    if (settled) return
    settled = true
    clearRelayTimers() // task366
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (current) current.destroy()
    console.log('[relay] client request error: ' + e.message)
    if (!res.headersSent) res.end()
  })
})

server.headersTimeout = 310000
server.requestTimeout = 310000
server.listen(PORT, '127.0.0.1', function () {
  console.log('[deepseek-relay] http://127.0.0.1:' + PORT + ' -> ' + (UPSTREAM_TLS ? 'https' : 'http') + '://' + UPSTREAM_HOST + (UPSTREAM_PORT === 443 || UPSTREAM_PORT === 80 ? '' : ':' + UPSTREAM_PORT) + ' (identity, no-compress, effort=' + (NO_EFFORT ? 'off' : REASONING_EFFORT) + ', image>' + IMAGE_HARD_LIMIT + 'px=block+inbox)')
  console.log('[deepseek-relay] hard-timeout ttfb=' + (TTFB_MS > 0 ? Math.round(TTFB_MS / 1000) + 's' : 'off') + ' stall=' + (STALL_MS > 0 ? Math.round(STALL_MS / 1000) + 's' : 'off') + ' max=' + (MAX_DURATION_MS > 0 ? Math.round(MAX_DURATION_MS / 1000) + 's' : 'off') + 's (task366)') // 金丝雀行
})

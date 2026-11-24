// zhipu-relay: 本机智谱 Token Plan 中转（127.0.0.1:4100）
// 背景与 DeepSeek 相同：serve 内核为 bun 运行时，对上游 brotli/gzip 压缩的流式响应
// 解压会丢字节（长流触发 AI_JSONParseError: Unterminated string / 模型流式返回中断）。
// 方案：中转代理去掉 Accept-Encoding 请求上游（上游返回未压缩流），原样透传给
// serve，绕过 bun 的压缩流解压路径。node 的 http 透转无此问题。
//
// 上游失败退避重试（仅安全窗口）：请求体先缓冲成 Buffer（≤10MB）再发上游，
// 只有「响应未开始 + 请求体未完整写出 + 非 300s 超时 + 已试次数 < 3」才重试；
// 退避 500ms×2^n + 0~250ms 抖动。耗尽或不可重试回 503 + Retry-After: 3。
// 请求体超过 10MB 则放弃重试资格，退回单试流式转发（不把超大 body 读进内存）。
// 上游非 2xx（含 429/5xx）一律原样透传，不重试。
const http = require('http')
const https = require('https')
// task393：工具回显剪枝（历史轮豁免最新轮；DSH tool-result-pruner 生产参数；fail-open）
const pruneToolResults = require('./tool-prune').pruneToolResults

// task306：三个可测 env（生产默认 open.bigmodel.cn:443/https 不变；task270 deepseek-relay 先例）
const UPSTREAM_HOST = process.env.ZP_RELAY_UPSTREAM_HOST || 'open.bigmodel.cn'
const UPSTREAM_PORT = Number(process.env.ZP_RELAY_UPSTREAM_PORT || 443)
const UPSTREAM_PROTO = process.env.ZP_RELAY_UPSTREAM_SCHEME === 'http' ? http : https
const PORT = Number(process.env.ZP_RELAY_PORT || 4100)
const MAX_BODY_BYTES = 10 * 1024 * 1024
const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 500
const BACKOFF_JITTER_MS = 250
const UPSTREAM_TIMEOUT_MS = 310000 // task366 P2-3：300s→310s，保「首字节期唯一出口=TTFB(300s)」口径

// task366（2026-11-16）：三重硬超时——当日 DAG 项目集体装死 3h 事故根因=上游挂死永无超时
// （连接阶段挂起 socket idle 不生效；滴字节续命；总时长无上限）→ serve 项目锁永占，只能重启 serve。
//   首字节 TTFB 5min；流式静默 STALL 2min（仅 event-stream / 流式回退分支，非流式长生成合法超长
//   不设限，P2-15 先例）；总时长 MAX 45min 硬顶。与 task306 content-watchdog 分工：STALL 管「零字节
//   静默」、watchdog 管「有字节无实质」，双层互补。env=0 关对应层（应急闸）。
//   细案：docs/2026-11-16 中转硬超时与项目级卡死自愈-task366.md
const TTFB_MS = Number(process.env.LITTLEDJ_RELAY_TTFB_MS || 300000)
const STALL_MS = Number(process.env.LITTLEDJ_RELAY_STALL_MS || 120000)
const MAX_DURATION_MS = Number(process.env.LITTLEDJ_RELAY_MAX_MS || 2700000)

// task306 实质内容看门狗：上游 SSE 只发心跳（": ping" 注释 / data: ping 载荷 / 空 delta 帧）不发
// 内容时，socket 300s「空闲」超时永不触发（任何字节都算 socket 活动）→ 流永久悬挂 → 会话轮次死锁
// （2026-11-15 DAG 项目两会话卡死事故根因，docs/2026-11-15 流悬挂看门狗与挂死自动处置-task306.md）。
// 看门狗只认「实质内容」重置；触发即掐断并按 failUpstream 收尾，下游把该轮记为可重试错误。
// 应急闸 ZP_RELAY_NO_CONTENT_WATCHDOG=1（回到旧版行为）；阈值 ZP_RELAY_CONTENT_TIMEOUT_MS 可调。
const CONTENT_WATCHDOG_MS = Number(process.env.ZP_RELAY_CONTENT_TIMEOUT_MS || 300000)
const NO_CONTENT_WATCHDOG = process.env.ZP_RELAY_NO_CONTENT_WATCHDOG === '1'
if (!NO_CONTENT_WATCHDOG && !(CONTENT_WATCHDOG_MS > 0)) {
  console.log('[zhipu-relay] WARN: ZP_RELAY_CONTENT_TIMEOUT_MS 非法值（' + process.env.ZP_RELAY_CONTENT_TIMEOUT_MS + '），看门狗关闭')
}

// data: 载荷的实质判定（P0-2 御史修正：白名单语义，空 delta/role-only/空对象帧都算心跳）：
// ①parse 成功且有 choices：delta.content / delta.reasoning_content 非空串、delta.tool_calls 非空、
//   finish_reason 非空、message 存在 → 实质；有 choices 但全空 → 心跳（空帧）。
// ②parse 成功无 choices：type/event/name 字段值命中 ping/heartbeat/keepalive → 心跳；其余 JSON
//   （usage/error/未知厂商字段）保守算实质（防误杀）。
// ③parse 失败：非 SSE JSON 流的普通字节，保守算实质。
function payloadSubstantive(p) {
  if (p === '' || p === '[DONE]') return false
  // 纯文本心跳载荷（P1-3）：data: ping / pong / heartbeat / keep-alive 精确命中（词边界）
  if (/^(ping|pong|heartbeat|keep[-_ ]?alive)$/i.test(p)) return false
  let j = null
  try { j = JSON.parse(p) } catch (e) { return true }
  if (!j || typeof j !== 'object') return true
  if (Object.keys(j).length === 0) return false // data: {} 心跳
  if (!Array.isArray(j.choices)) {
    const kind = String(j.type || j.event || j.name || '')
    return !/(ping|heartbeat|keep[-_ ]?alive)/i.test(kind)
  }
  for (let k = 0; k < j.choices.length; k++) {
    const c = j.choices[k]
    const d = c && c.delta
    if (d && typeof d === 'object') {
      if (typeof d.content === 'string' && d.content.length > 0) return true
      if (typeof d.reasoning_content === 'string' && d.reasoning_content.length > 0) return true
      if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) return true
      if (d.function_call) return true // P2-5：legacy function_call 也算实质
    }
    if (c && typeof c.finish_reason === 'string' && c.finish_reason.length > 0) return true
    if (c && c.message) return true
  }
  // P2-5：choices 空数组但带 usage（真实 OpenAI 尾帧形态）= 活跃
  if (j.choices.length === 0 && j.usage) return true
  return false
}

// 判定一段「完整行序列」有没有实质内容（P0-1 御史修正：行尾 \r 先剥——CRLF 形态的注释/空行/
// 心跳帧不再漏判成实质；P1-3：event:/id:/retry: 字段行不产生内容，不算实质）：
// 不算活跃的：空行、':' 开头注释行（心跳形态一）、event/id/retry 字段行、data: 载荷非实质（形态二）；
// 其余任何 data 行、或非 SSE 结构的字节（普通 JSON/二进制流）都算活跃。
function hasSubstantiveSSE(text) {
  const lines = String(text).replace(/\r/g, '').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.charAt(0) === ':') continue
    if (line.indexOf('data:') === 0) {
      if (payloadSubstantive(line.slice(5).trim())) return true
      continue
    }
    // SSE 字段行（event/id/retry）只是元数据，只有 data 载荷能产生内容（P1-3）
    if (/^(event|id|retry)\s*:/.test(line)) continue
    return true // 非 SSE 结构的字节都算实质
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

  const logPrefix = '[zhipu-relay] ' + req.method + ' ' + req.url
  let chunks = []          // 缓冲中的请求体（超限后清空）
  let size = 0
  let bodyBuf = null       // 读完后拼好的请求体（重试复用）
  let mode = 'buffering'   // buffering | streaming | buffered
  let up = null            // 当前上游请求（用于客户端断开时收口）
  let attempts = 0
  let retryTimer = null
  let clientGone = false
  let contentTimer = null  // task306：实质内容看门狗定时器
  // task366：三重硬超时定时器（随 up 实例换代，重试前显式清，防跨 attempt 误杀）
  const reqStartedAt = Date.now()
  let ttfbTimer = null     // setTimeout；每次上游尝试重挂，收到响应头清除
  let stallTimer = null    // setInterval；仅流式响应，每字节重置
  let durationTimer = null // setTimeout；入站请求即启动一次，不随重试重置

  function clearRelayTimers() {
    if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = null }
    if (stallTimer) { clearInterval(stallTimer); stallTimer = null }
    if (durationTimer) { clearTimeout(durationTimer); durationTimer = null }
  }

  // task366：硬超时处置——真正断开上游 socket；未发响应头回 504（区别于上游故障 503），
  // 已发响应头只能截断收尾（与 failUpstream 收口语义一致）。
  function hardTimeoutHit(kind, startedAt) {
    if (res.writableEnded) return
    clearRelayTimers()
    clearContentTimer() // P2-7 产出审：显式清 task306 看门狗，不依赖 destroy 连坐
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    const el = Math.round((Date.now() - startedAt) / 1000)
    console.log(logPrefix + ' hard-timeout ' + kind + ' after ' + el + 's -> upstream destroyed (task366)')
    if (up) {
      try { up.destroy() } catch (e) {}
    }
    if (!res.headersSent) {
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

  function clearContentTimer() {
    if (contentTimer) {
      clearInterval(contentTimer)
      contentTimer = null
    }
  }

  function writeUpstreamResponse(ures) {
    if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = null } // task366：首字节已到
    console.log(logPrefix + ' -> ' + (ures.statusCode || '?'))
    const h = Object.assign({}, ures.headers)
    delete h['content-length']
    delete h['transfer-encoding']
    res.writeHead(ures.statusCode || 503, h)

    // P2-15：只在 SSE 流式响应上挂看门狗（非流式 JSON/二进制响应生成可合法超 300s，不设限）；
    // 请求体带 stream:true 但响应不是 event-stream 时记 WARN（P2-6：上游误标 content-type 的可观测面）
    const ct = String((ures.headers && ures.headers['content-type']) || '')
    if (!/event-stream/i.test(ct) && mode === 'buffered' && bodyBuf && bodyBuf.length < 65536 &&
        /"stream"\s*:\s*true/.test(bodyBuf.toString('utf8'))) {
      console.log(logPrefix + ' WARN: 请求 stream:true 但响应 content-type=' + (ct || '(空)') + '，该响应不挂内容看门狗')
    }
    res.on('error', function () { /* P2-8：下游 socket 错误静默收口（close 路径已统一处理），防 unhandled error */ })
    if (!NO_CONTENT_WATCHDOG && CONTENT_WATCHDOG_MS > 0 && /event-stream/i.test(ct)) {
      let lastContentAt = Date.now()
      let pending = '' // 跨 chunk 残行缓冲（data: 前缀/载荷被劈块时不再漏判，P0-2 附注）
      ures.on('data', function (chunk) {
        pending += chunk.toString('utf8')
        const idx = pending.lastIndexOf('\n')
        if (idx < 0) {
          if (pending.length > 1024 * 1024) { // 长期无换行的非 SSE 字节流兜底：判实质防缓冲无限涨
            pending = ''
            lastContentAt = Date.now()
          }
          return
        }
        const complete = pending.slice(0, idx)
        pending = pending.slice(idx + 1)
        if (hasSubstantiveSSE(complete)) lastContentAt = Date.now()
      })
      contentTimer = setInterval(function () {
        if (res.writableEnded || ures.destroyed) {
          clearContentTimer()
          return
        }
        if (Date.now() - lastContentAt >= CONTENT_WATCHDOG_MS) {
          const idleSec = Math.round((Date.now() - lastContentAt) / 1000)
          console.log(logPrefix + ' content watchdog: no substantive bytes for ' + idleSec + 's, abort stream')
          clearContentTimer()
          ures.destroy()
          failUpstream('content watchdog: no substantive data in ' + Math.round(CONTENT_WATCHDOG_MS / 1000) + 's', attempts || 1)
        }
      }, 1000)
      ures.on('end', clearContentTimer)
      ures.on('error', clearContentTimer)
    }
    // task366：流式静默超时——仅 content-type=event-stream（P2-11 收敛：流式回退分支大 JSON 响应也
    // 可能合法超长，统一只认 SSE 头）；与 task306 content-watchdog 分工：STALL 管「零字节静默」（120s），
    // watchdog 管「有字节无实质」（300s）；独立于看门狗开关（P0-1 产出审：应急关看门狗不得连坐关 STALL）
    if (STALL_MS > 0 && /event-stream/i.test(ct)) {
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
  }

  // 响应头未发：503 + Retry-After；已开始写：只能收尾（P2-7：记截断原因供审计）
  function failUpstream(message, attemptCount) {
    if (res.writableEnded) return
    clearRelayTimers() // task366
    if (res.headersSent) {
      console.log(logPrefix + ' truncate streamed response: ' + message)
      res.end()
      return
    }
    res.writeHead(503, {
      'Content-Type': 'application/json',
      'Retry-After': '3'
    })
    res.end(JSON.stringify({
      error: 'relay upstream unavailable (attempts=' + attemptCount + '): ' + message,
      retryable: true
    }))
    console.log(logPrefix + ' fail after ' + attemptCount + ' attempt(s): ' + message)
  }

  // 缓冲模式：请求体已完整读入，发上游；失败按安全窗口判断是否退避重试
  function startBuffered() {
    attempts += 1
    const attemptNo = attempts
    let sent = false // 请求体是否已完整写出上游
    // task366：首字节超时——覆盖连接阶段挂起（socket idle 不生效区）+响应头等待期；重试前清旧
    if (TTFB_MS > 0) {
      if (ttfbTimer) clearTimeout(ttfbTimer)
      const attemptStartedAt = Date.now()
      ttfbTimer = setTimeout(function () { hardTimeoutHit('first-byte-timeout', attemptStartedAt) }, TTFB_MS)
    }

    const upHeaders = Object.assign({}, headers, { 'content-length': String(bodyBuf.length) })
    delete upHeaders['transfer-encoding']

    const u = UPSTREAM_PROTO.request({
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: upHeaders
    }, function (ures) {
      sent = true
      writeUpstreamResponse(ures)
    })

    up = u
    u.on('finish', function () { sent = true })
    u.setTimeout(UPSTREAM_TIMEOUT_MS, function () {
      const err = new Error('upstream timeout 310s')
      err.relayTimeout = true
      u.destroy(err)
    })
    u.on('error', function (e) {
      if (up !== u) return
      if (res.writableEnded) return
      const canRetry = !res.headersSent && !sent && !e.relayTimeout && attemptNo < MAX_ATTEMPTS
      if (!canRetry) {
        failUpstream(e.message, attemptNo)
        return
      }
      // task366：进入退避等待期——清当前 attempt 的 TTFB（下次尝试重挂），防 backoff > TTFB 误杀
      if (ttfbTimer) { clearTimeout(ttfbTimer); ttfbTimer = null }
      const delay = BACKOFF_BASE_MS * Math.pow(2, attemptNo - 1) + Math.floor(Math.random() * (BACKOFF_JITTER_MS + 1))
      console.log(logPrefix + ' retry ' + attemptNo + ' in ' + delay + 'ms: ' + e.message)
      retryTimer = setTimeout(function () {
        retryTimer = null
        if (clientGone || res.writableEnded) return
        startBuffered()
      }, delay)
    })
    u.end(bodyBuf)
  }

  // 超过 10MB：放弃重试，退回单试流式转发
  function startStream() {
    attempts = 1
    // task366：首字节超时（流式回退分支同样覆盖）
    if (TTFB_MS > 0) {
      if (ttfbTimer) clearTimeout(ttfbTimer)
      const attemptStartedAt = Date.now()
      ttfbTimer = setTimeout(function () { hardTimeoutHit('first-byte-timeout', attemptStartedAt) }, TTFB_MS)
    }
    const u = UPSTREAM_PROTO.request({
      hostname: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      method: req.method,
      path: req.url,
      headers: headers
    }, writeUpstreamResponse)

    up = u
    u.setTimeout(UPSTREAM_TIMEOUT_MS, function () {
      const err = new Error('upstream timeout 310s')
      err.relayTimeout = true
      u.destroy(err)
    })
    u.on('error', function (e) {
      if (up !== u) return
      failUpstream(e.message, 1)
    })

    // 先把超限前已缓冲的部分写出去，再流式转发剩余
    for (let i = 0; i < chunks.length; i++) u.write(chunks[i])
    chunks = null
    size = 0
    req.pipe(u)
  }

  function onData(chunk) {
    if (mode !== 'buffering') return
    chunks.push(chunk)
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      mode = 'streaming'
      req.removeListener('data', onData)
      startStream()
    }
  }

  req.on('data', onData)
  req.on('end', function () {
    if (mode !== 'buffering') return
    mode = 'buffered'
    bodyBuf = Buffer.concat(chunks, size)
    chunks = null
    size = 0
    // task393：历史轮工具回显剪枝（仅 OpenAI chat-completions 形态 role:'tool'）。
    // P1-3（task393 御审）：本回调原本无 catch——剪枝必须 try/catch 且无论成败必走
    // startBuffered（失败用原 bodyBuf），否则该请求无上游、悬挂到 45min 硬超时炸全通道。
    // 应急闸 ZP_RELAY_NO_PRUNE=1。
    try {
      if (process.env.ZP_RELAY_NO_PRUNE !== '1' && req.method === 'POST' && /\/chat\/completions\/?$/.test(req.url)) {
        const body = JSON.parse(bodyBuf.toString('utf8'))
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          const pr = pruneToolResults(body)
          if (pr.changed) {
            bodyBuf = Buffer.from(JSON.stringify(body), 'utf8')
            console.log(logPrefix + ' pruned ' + pr.prunedCount + ' tool results (-' + pr.savedChars + ' chars) (task393)')
          }
        }
      }
    } catch (e) {
      console.log(logPrefix + ' prune failed (fail-open, original body kept): ' + e.message)
    }
    startBuffered()
  })
  req.on('error', function () {
    // 客户端中途断开：不再发上游，清掉挂起的重试，并收掉上游连接
    clientGone = true
    clearRelayTimers() // task366
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (up && !up.destroyed) up.destroy()
  })

  // 客户端断开（未正常收尾）时收口：清定时器、断上游连接
  res.on('close', function () {
    clearRelayTimers() // task366：断开/正常收尾全路径清定时器（防泄漏与误触发）
    if (!res.writableFinished) clientGone = true
    clearContentTimer()
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (up && !res.writableFinished) up.destroy()
  })
})

server.headersTimeout = 310000
server.requestTimeout = 310000

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', function () {
    const wd = NO_CONTENT_WATCHDOG ? 'off' : (CONTENT_WATCHDOG_MS > 0 ? Math.round(CONTENT_WATCHDOG_MS / 1000) + 's' : 'off')
    console.log('[zhipu-relay] http://127.0.0.1:' + PORT + ' -> https://' + UPSTREAM_HOST + ' (identity, no-compress, content-watchdog ' + wd + ')')
    console.log('[zhipu-relay] hard-timeout ttfb=' + (TTFB_MS > 0 ? Math.round(TTFB_MS / 1000) + 's' : 'off') + ' stall=' + (STALL_MS > 0 ? Math.round(STALL_MS / 1000) + 's' : 'off') + ' max=' + (MAX_DURATION_MS > 0 ? Math.round(MAX_DURATION_MS / 1000) + 's' : 'off') + 's (task366)') // 金丝雀行
  })
} else {
  // 自测模式：只导出纯函数不起端口（deploy/selftest-relay-watchdog.js）
  module.exports = { hasSubstantiveSSE, payloadSubstantive }
}

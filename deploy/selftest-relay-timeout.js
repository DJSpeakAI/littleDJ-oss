// selftest-relay-timeout（task366）：三重硬超时 + abort-before-resume + 项目级卡死检测 自测
// 覆盖（方案稿 §四）：TTFB/stall/max 触发、慢而正常不误杀、非流式不误杀、stream:true 非 SSE 不误杀、
// 重试不误杀（两 relay）；autoresume abort 顺序/路径/失败不阻断；detectProject 真值表；项目级跨轮 state。
// 全部子进程 + mock 上游/mock serve 实弹（不碰生产 4099/4100/4098/4097，用临时端口）。
// 用法：node deploy/selftest-relay-timeout.js   退出码 0=全绿 / 1=有红
'use strict'
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const REPO = path.join(__dirname, '..')
let passCount = 0
let failCount = 0
const fails = []

function ok(name, cond, detail) {
  if (cond) { passCount++; console.log('  ok - ' + name) }
  else { failCount++; fails.push(name + (detail ? ' :: ' + detail : '')); console.log('  FAIL - ' + name + (detail ? ' :: ' + detail : '')) }
}

function listen(server, port) {
  return new Promise(function (resolve, reject) {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', function () { resolve(server.address().port) })
  })
}

function closeServer(server) {
  return new Promise(function (resolve) {
    if (!server) return resolve()
    try { server.close(function () { resolve() }) } catch (e) { resolve() }
    setTimeout(resolve, 800)
  })
}

// 简易客户端：收集 status/body/chunks/end 事件
function httpReq(port, reqPath, opts) {
  opts = opts || {}
  return new Promise(function (resolve) {
    const payload = opts.body ? Buffer.from(JSON.stringify(opts.body)) : null
    const headers = Object.assign({}, opts.headers || {})
    if (payload) { headers['content-type'] = 'application/json'; headers['content-length'] = payload.length }
    const out = { status: 0, body: '', chunks: 0, ended: false, error: '', res: null }
    let buf = []
    const req = http.request({ host: '127.0.0.1', port: port, method: opts.method || 'POST', path: reqPath, headers: headers }, function (res) {
      out.status = res.statusCode
      out.res = res
      res.on('data', function (c) { out.chunks++; buf.push(c) })
      res.on('end', function () { out.ended = true; out.body = Buffer.concat(buf).toString('utf8'); resolve(out) })
      res.on('aborted', function () { out.error = 'aborted'; resolve(out) })
      res.on('error', function (e) { out.error = e.message; resolve(out) })
    })
    req.on('error', function (e) { out.error = e.message; resolve(out) })
    if (opts.timeoutMs) req.setTimeout(opts.timeoutMs, function () { req.destroy(new Error('client-timeout')) })
    if (payload) req.write(payload)
    req.end()
  })
}

// 拉起 relay 子进程（env 指向 mock 上游 + 临时端口 + 缩小阈值），等 ready
function spawnRelay(script, env, extra) {
  const child = spawn(process.execPath, [path.join(REPO, 'server', script)], {
    env: Object.assign({}, process.env, env),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  const pump = function (s) { s.on('data', function (d) { const t = d.toString(); logs.push(t); if (extra) extra(t) }) }
  pump(child.stdout); pump(child.stderr)
  const port = env.DS_RELAY_PORT || env.ZP_RELAY_PORT
  const dead = new Promise(function (resolve) { child.on('exit', function (c, sig) { resolve({ code: c, sig: sig }) }) })
  // 轮询 /health 等 ready（最多 5s）
  const ready = (async function () {
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error(script + ' died early: ' + logs.join('').slice(0, 300))
      const r = await httpReq(port, '/health', { method: 'GET', timeoutMs: 800 })
      if (r.status === 200) return true
      await new Promise(function (s) { setTimeout(s, 100) })
    }
    throw new Error(script + ' not ready in 5s')
  })()
  return { child: child, port: port, logs: logs, dead: dead, ready: ready, kill: function () { try { child.kill('SIGKILL') } catch (e) {} } }
}

const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

// ---------- 用例组 1~7：两 relay 三重硬超时 ----------
const TTFB = 600, STALL = 400, MAX = 1500
const relayEnv = function (upstreamPort, port) {
  return {
    LITTLEDJ_RELAY_TTFB_MS: String(TTFB),
    LITTLEDJ_RELAY_STALL_MS: String(STALL),
    LITTLEDJ_RELAY_MAX_MS: String(MAX),
  }
}

async function relaySuite(relayName, script, envMaker) {
  console.log('\n== ' + relayName + ' 超时套件 ==')
  // 公共 mock 上游：按路径分派
  const upstreamHits = []
  let upstreamClosed = 0
  const up = http.createServer(function (req, res) {
    const rec = { path: req.url, at: Date.now() }
    upstreamHits.push(rec)
    req.resume()
    if (req.url === '/ttfb-hang') {
      // 收请求后挂死不回；记录 socket 被远端关闭
      res.on('close', function () { upstreamClosed++ })
      return
    }
    if (req.url === '/stall-sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n')
      res.on('close', function () { upstreamClosed++ })
      return // 首字节后静默
    }
    if (req.url === '/slow-ok') {
      setTimeout(function () { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: [DONE]\n\n') }, 300)
      return
    }
    if (req.url === '/long-ok') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      let n = 0
      const t = setInterval(function () {
        res.write('data: {"choices":[{"delta":{"content":"c' + n + '"}}]}\n\n')
        if (++n >= 8) { clearInterval(t); res.end() }
      }, 90)
      return
    }
    if (req.url === '/nonstream-slow') {
      // 非流式：headers 先 flush（write 一个字节），随后静默 700ms（>STALL 400ms）再一次性 body —— 不该被杀
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write(' ')
      setTimeout(function () { res.end(JSON.stringify({ ok: true })) }, 700)
      return
    }
    if (req.url === '/streamflag-json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write(' ')
      setTimeout(function () { res.end(JSON.stringify({ ok: true })) }, 700)
      return
    }
    if (req.url === '/max-drip') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n')
      const t = setInterval(function () { res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n') }, 120)
      res.on('close', function () { clearInterval(t) })
      return // 永不收尾，靠 max 掐
    }
    if (req.url === '/chat/completions') {
      // task366 6b：请求体 stream:true 但响应非 event-stream —— 先 flush 头再静默 700ms，不该被 STALL 杀
      let isStreamFlag = false
      req.on('data', function (c) { if (/\"stream\"\s*:\s*true/.test(c.toString())) isStreamFlag = true })
      req.on('end', function () {
        if (isStreamFlag) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.write(' ')
          setTimeout(function () { res.end(JSON.stringify({ ok: true })) }, 700)
        } else {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        }
      })
      return
    }
    res.writeHead(404); res.end('nf')
  })
  const upstreamPort = await listen(up, 0)
  const relayPort = 18000 + Math.floor(Math.random() * 2000)
  const relay = spawnRelay(script, envMaker(upstreamPort, relayPort))
  await relay.ready.catch(function (e) { ok(relayName + ' 启动', false, e.message); throw e })
  ok(relayName + ' 启动日志含 hard-timeout 金丝雀行', /hard-timeout ttfb=\d+s stall=\d+s max=\d+s/.test(relay.logs.join('')))

  try {
    // 1) TTFB 触发
    let r = await httpReq(relayPort, '/ttfb-hang', { timeoutMs: 4000 })
    ok('TTFB 触发 504', r.status === 504, 'status=' + r.status)
    let j = null; try { j = JSON.parse(r.body) } catch (e) {}
    ok('TTFB 标记 relay=first-byte-timeout', !!(j && j.relay === 'first-byte-timeout'), String(r.body).slice(0, 120))
    ok('TTFB 上游 socket 被关', upstreamClosed >= 1, 'closed=' + upstreamClosed)

    // 2) stall 触发（流式）
    upstreamClosed = 0
    r = await httpReq(relayPort, '/stall-sse', { timeoutMs: 4000 })
    ok('stall 客户端收尾（截断）', r.ended || r.error === 'aborted', 'ended=' + r.ended + ' err=' + r.error)
    await sleep(300)
    ok('stall 标记日志', /hard-timeout stall-timeout/.test(relay.logs.join('')))
    ok('stall 上游 socket 被关', upstreamClosed >= 1, 'closed=' + upstreamClosed)

    // 3) max 触发（慢滴不收尾）
    r = await httpReq(relayPort, '/max-drip', { timeoutMs: 5000 })
    ok('max 客户端收尾（截断）', r.ended || r.error === 'aborted', 'ended=' + r.ended + ' err=' + r.error)
    ok('max 标记日志', /hard-timeout max-duration/.test(relay.logs.join('')))

    // 4) 慢而正常 A：300ms 首字节（< TTFB 600ms）
    r = await httpReq(relayPort, '/slow-ok', { timeoutMs: 4000 })
    ok('慢首字节不误杀', r.status === 200 && /DONE/.test(r.body), 'status=' + r.status + ' body=' + r.body.slice(0, 60))

    // 5) 慢而正常 B：长流持续出字（~720ms < max 1500ms）——含「SSE 不重复」断言（P0-1 产出审：
    //    zhipu 曾因双 pipe 每个 chunk 写两遍，此断言在旧代码上必红）
    r = await httpReq(relayPort, '/long-ok', { timeoutMs: 5000 })
    const dataLines = (r.body.match(/data: /g) || []).length
    ok('长流完整收完不误杀', r.status === 200 && r.chunks >= 8, 'status=' + r.status + ' chunks=' + r.chunks)
    ok('SSE 内容不重复（8 条 data 行，双 pipe 必红）', r.status === 200 && dataLines === 8, 'dataLines=' + dataLines + ' body=' + r.body.slice(0, 80))

    // 6) 非流式长生成不误杀：headers 后静默 700ms（>STALL）再一次性 body
    r = await httpReq(relayPort, '/nonstream-slow', { timeoutMs: 5000 })
    ok('非流式静默超 STALL 阈不误杀', r.status === 200 && /"ok":true/.test(r.body), 'status=' + r.status + ' body=' + r.body.slice(0, 60))

    // 6b) stream:true 但响应非 event-stream：不杀 + WARN（走 /chat/completions 让 prepareBody 解析到 stream 标志）
    r = await httpReq(relayPort, '/chat/completions', { timeoutMs: 5000, body: { stream: true, model: 'x', messages: [] } })
    ok('stream:true+json 响应不误杀', r.status === 200 && /"ok":true/.test(r.body), 'status=' + r.status + ' body=' + r.body.slice(0, 60))
    if (relayName === 'deepseek-relay') ok('stream:true 非 SSE 有 WARN（不挂看门狗可观测）', /WARN: 请求 stream:true 但响应 content-type=/.test(relay.logs.join('')))
    if (relayName === 'zhipu-relay') ok('stream:true 非 SSE 有 WARN（P2-15 既有）', /WARN: 请求 stream:true 但响应 content-type=/.test(relay.logs.join('')))
  } finally {
    relay.kill()
    await closeServer(up)
  }

  // 7) 重试不误杀：上游先死（ECONNREFUSED）→ backoff 内复活 → attempt2 成功；全程不被 TTFB 误杀
  const up2 = http.createServer(function (req, res) { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })) })
  let up2Hits = 0
  up2.on('request', function () { up2Hits++ })
  const up2Port = await listen(up2, 0)
  await closeServer(up2) // 先关掉：attempt1 连接拒绝
  const relayPort2 = 18000 + Math.floor(Math.random() * 2000)
  const relay2 = spawnRelay(script, envMaker(up2Port, relayPort2))
  await relay2.ready
  const p = httpReq(relayPort2, '/chat/completions', { timeoutMs: 6000, body: { model: 'x', messages: [] } })
  await sleep(250) // 进 backoff（500ms+）窗口内复活上游
  const up2b = http.createServer(function (req, res) { req.resume(); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true })) })
  const srv2b = up2b.listen(up2Port, '127.0.0.1')
  const r2 = await p
  ok('重试不误杀（连接拒绝后复活）', r2.status === 200 && /"ok":true/.test(r2.body), 'status=' + r2.status + ' err=' + r2.error + ' body=' + r2.body.slice(0, 60) + ' logs=' + relay2.logs.join('').slice(-400))
  ok('重试路径无 504 first-byte 误杀', !/hard-timeout first-byte-timeout/.test(relay2.logs.join('')), relay2.logs.join('').slice(-300))
  relay2.kill()
  await closeServer(up2b)
}

// ---------- 用例 8：autoresume abort-before-resume ----------
async function autoresumeSuite(abortMode) {
  console.log('\n== autoresume abort-before-resume（' + abortMode + '）==')
  const calls = []
  const now = Date.now()
  const serve = http.createServer(function (req, res) {
    const u = req.url
    calls.push({ method: req.method, path: u, at: Date.now() })
    req.resume()
    if (u === '/api/session' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 's1', title: 't', time: { updated: now }, directory: '/x' }] }))
    }
    if (u === '/session/s1/message' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify([{ info: { id: 'm1', role: 'user', time: { created: now - 20 * 60000 } }, parts: [{ type: 'text', text: '做点事' }] }]))
    }
    if (u === '/session/s1/abort' && req.method === 'POST') {
      if (abortMode === 'html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>serve shell</html>') }
      res.writeHead(204); return res.end()
    }
    if (u === '/session/s1/prompt_async' && req.method === 'POST') { res.writeHead(204); return res.end() }
    if (u === '/api/session/s1/abort') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>wrong shell</html>') }
    res.writeHead(404); res.end('nf')
  })
  const port = await listen(serve, 0)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-ar-'))
  fs.mkdirSync(path.join(tmp, 'run'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  const child = spawn(process.execPath, [path.join(REPO, 'server', 'autoresume.js'), '--reason', 'selftest'], {
    env: Object.assign({}, process.env, {
      LITTLEDJ_BACKEND_PORT: String(port),
      LITTLEDJ_ROOT: tmp,
      LITTLEDJ_AUTORESUME_SAMPLE_MS: '300',
      LITTLEDJ_AUTORESUME_MIN_AGE_MS: '0',
      LITTLEDJ_AUTORESUME_RECENT_MS: String(3600 * 1000),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const errOut = []
  child.stderr.on('data', function (d) { errOut.push(d.toString()) })
  const code = await new Promise(function (resolve) { child.on('exit', resolve); setTimeout(function () { resolve('timeout') }, 30000) })
  await closeServer(serve)
  const logTxt = (function () { try { return fs.readFileSync(path.join(tmp, 'logs', 'autoresume.log'), 'utf8') } catch (e) { return '' } })()
  const abortCall = calls.filter(function (c) { return c.path === '/session/s1/abort' })
  const wrongAbort = calls.filter(function (c) { return c.path === '/api/session/s1/abort' })
  const promptCall = calls.filter(function (c) { return c.path === '/session/s1/prompt_async' })
  ok('abort 走无 /api 前缀', abortCall.length === 1 && wrongAbort.length === 0, JSON.stringify(calls.map(function (c) { return c.path })))
  ok('abort 先于 prompt_async', abortCall.length === 1 && promptCall.length === 1 && abortCall[0].at <= promptCall[0].at, 'abort=' + (abortCall[0] || {}).at + ' prompt=' + (promptCall[0] || {}).at)
  ok('prompt_async 已发出（续跑不缺位）', promptCall.length === 1, 'n=' + promptCall.length)
  if (abortMode === '204') ok('abort 成功日志', /abort-before-resume ok/.test(logTxt), logTxt.slice(-300))
  if (abortMode === 'html') {
    ok('abort HTML 判失败记 WARN（不静默）', /WARN abort-before-resume failed/.test(logTxt), logTxt.slice(-300))
    ok('abort 失败不阻断续跑', promptCall.length === 1 && /已续跑 s1/.test(logTxt), logTxt.slice(-300))
  }
  ok('进程正常退出', code === 0, 'code=' + code + ' ' + errOut.join('').slice(0, 200))
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

// ---------- 用例 9：detectProject 真值表 ----------
async function detectProjectSuite() {
  console.log('\n== detectProject 真值表 ==')
  const WD = require(path.join(REPO, 'server', 'wedge-detect.js'))
  const now = Date.now()
  const hit = { dir: '/t/w', wedgedMains: ['a'], busyIds: ['a'], lastPromptAt: now - 2 * 60000 }
  ok('命中：wedged 主会话+busy+新鲜 prompt', WD.detectProject(hit, now).wedged === true)
  ok('不命中：长工具在跑/等回答/出字（detect 不命中→wedgedMains 空）', WD.detectProject({ dir: '/t/w', wedgedMains: [], busyIds: ['a'], lastPromptAt: now - 2 * 60000 }, now).reason === 'no-wedged-main')
  ok('不命中：目录无人使用（无 busy）', WD.detectProject({ dir: '/t/w', wedgedMains: ['a'], busyIds: [], lastPromptAt: now - 2 * 60000 }, now).reason === 'not-busy')
  ok('不命中：prompt 超窗（默认 15min）', WD.detectProject({ dir: '/t/w', wedgedMains: ['a'], busyIds: ['a'], lastPromptAt: now - 20 * 60000 }, now).reason === 'no-recent-prompt')
  ok('不命中：无 prompt 记录', WD.detectProject({ dir: '/t/w', wedgedMains: ['a'], busyIds: ['a'], lastPromptAt: 0 }, now).reason === 'no-recent-prompt')
  ok('边界：prompt 恰在窗内边缘（14min）命中', WD.detectProject({ dir: '/t/w', wedgedMains: ['a'], busyIds: ['a'], lastPromptAt: now - 14 * 60000 }, now).wedged === true)
  ok('空输入防御', WD.detectProject(null, now).reason === 'no-input')
}

// ---------- 用例 10：项目级跨轮（wedge-heal 编排 + state 落盘） ----------
async function projectWedgeSuite() {
  console.log('\n== project-wedge 跨轮（observe-boot/命中告警+abort/冷却）==')
  const now = Date.now()
  const aborts = []
  const prompts = [] // task397：abort 后补的固定恢复语（经 proxy prompt_async）
  const serve = http.createServer(function (req, res) {
    const u = req.url
    req.resume()
    if (req.method === 'GET' && u.indexOf('/session/status') === 0) {
      const dir = decodeURIComponent((u.split('directory=')[1] || ''))
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(dir.indexOf('/t/w1') >= 0 ? JSON.stringify({ sid1: { type: 'busy' } }) : '{}')
    }
    if (u === '/session/sid1/message' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify([
        { info: { id: 'ma', role: 'assistant', time: { created: now - 20 * 60000 } }, parts: [{ type: 'text', text: '半开', time: { start: now - 20 * 60000, end: now - 19 * 60000 } }] },
        { info: { id: 'mu', role: 'user', time: { created: now - 2 * 60000 } }, parts: [{ type: 'text', text: '继续' }] },
      ]))
    }
    if (u === '/session/sid1/abort' && req.method === 'POST') { aborts.push(Date.now()); res.writeHead(204); return res.end() }
    res.writeHead(404); res.end('nf')
  })
  const servePort = await listen(serve, 0)
  const proxyMock = http.createServer(function (req, res) {
    req.resume()
    if (req.url === '/_sessions') {
      res.writeHead(200, { 'content-type': 'application/json' })
      // P0-2 产出审：mock 用生产 shape——顶层 directory（/session 端点形态，location 是 /api/session 形态）
      return res.end(JSON.stringify([
        { id: 'sid1', title: 'w1', pwa: 1, parentID: null, time: { updated: now - 7 * 3600 * 1000 }, directory: '/t/w1' },
      ]))
    }
    if (req.url === '/api/session/sid1/prompt_async' && req.method === 'POST') {
      let body = ''
      req.on('data', function (c) { body += c })
      req.on('end', function () { prompts.push({ at: Date.now(), body: body }); res.writeHead(204); res.end() })
      return
    }
    res.writeHead(404); res.end('nf')
  })
  const proxyPort = await listen(proxyMock, 0)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-pw-'))
  fs.mkdirSync(path.join(tmp, 'run'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'config', 'auth.txt'), 'dj:test')
  fs.writeFileSync(path.join(tmp, 'config', 'hidden-sessions.json'), '{"hidden":[]}')

  const runOnce = async function () {
    const child = spawn(process.execPath, [path.join(REPO, 'server', 'wedge-heal.js')], {
      env: Object.assign({}, process.env, { LITTLEDJ_PORT: String(proxyPort), LITTLEDJ_BACKEND_PORT: String(servePort), LITTLEDJ_ROOT: tmp }),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return await new Promise(function (resolve) { child.on('exit', resolve); setTimeout(function () { resolve('timeout') }, 30000) })
  }
  const jsonlPath = path.join(tmp, 'run', 'wedge-heal-log.jsonl')
  const readWarns = function () {
    try {
      return fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l) } catch (e) { return null } }).filter(function (j) { return j && j.event === 'project-wedge' && j.level === 'warn' })
    } catch (e) { return [] }
  }

  const c1 = await runOnce()
  ok('轮1 正常退出（observe-boot）', c1 === 0, 'code=' + c1)
  ok('轮1 心跳目录数 >0（P0-2：顶层 directory 分组生效，旧代码必红）', (function () {
    try { return (fs.readFileSync(path.join(tmp, 'logs', 'wedge-heal.log'), 'utf8').match(/project-wedge scan (\d+) dirs/) || [])[1] !== '0' } catch (e) { return false }
  })(), '期望 scan 1 dirs')
  ok('轮1 observe-boot 不告警', readWarns().length === 0)
  const stTxt = fs.readFileSync(path.join(tmp, 'config', 'wedge-heal-state.json'), 'utf8')
  ok('轮1 bootAt 已落盘（短进程 state 持久）', /bootAt/.test(stTxt), stTxt.slice(0, 120))

  const c2 = await runOnce()
  ok('轮2 正常退出', c2 === 0, 'code=' + c2)
  const w2 = readWarns()
  ok('轮2 命中告警（warn×1）', w2.length === 1 && w2[0].dir === '/t/w1', 'n=' + w2.length)
  ok('轮2 对 detect 命中主会话 abort（直连无 /api）', aborts.length === 1, 'aborts=' + aborts.length)
  ok('轮2 告警文件落盘', fs.existsSync(path.join(tmp, 'run', 'wedge-project-alert.json')))
  // task397：abort 后必须补恢复语（旧行为只 abort 不补=主人排在挂死回合后面的消息没人处理）
  const promptBody = prompts.length ? prompts[0].body : ''
  ok('轮2 abort 后补固定恢复语（经 proxy prompt_async×1）', prompts.length === 1 && promptBody.indexOf('卡死自动恢复') >= 0, 'n=' + prompts.length + ' body=' + promptBody.slice(0, 160))
  ok('轮2 恢复语不重放主人原话（原话带水印、历史里已有）', prompts.length === 1 && promptBody.indexOf('"继续"') < 0, promptBody.slice(0, 160))
  ok('轮2 恢复语晚于 abort', prompts.length === 1 && aborts.length === 1 && prompts[0].at >= aborts[0], 'abort=' + aborts[0] + ' prompt=' + (prompts[0] || {}).at)
  ok('轮2 日志记已补恢复语', /project-wedge 已补恢复语 sid1/.test(fs.readFileSync(path.join(tmp, 'logs', 'wedge-heal.log'), 'utf8')))

  const c3 = await runOnce()
  ok('轮3 正常退出', c3 === 0, 'code=' + c3)
  ok('轮3 冷却内不再告警', readWarns().length === 1, 'n=' + readWarns().length)
  ok('轮3 冷却内不再 abort', aborts.length === 1, 'aborts=' + aborts.length)
  ok('轮3 冷却内不重复补恢复语', prompts.length === 1, 'n=' + prompts.length)

  await closeServer(serve)
  await closeServer(proxyMock)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

// ---------- 用例 10a（task397 产审 P2-4）：同轮竞态——项目级补恢复语后，单会话软解须冷却跳过 ----------
// 场景：会话在单会话段的候选窗口内（6h），且 abort 的 errored 状态在本轮回合扫描前还没反映——
// 旧代码（不写 state.sessions 冷却）单会话段会把同一会话再 abort+重放一次=同轮双注入。
async function projectRaceSuite() {
  console.log('\n== project-wedge 同轮竞态（补恢复语后单会话软解冷却跳过）==')
  const now = Date.now()
  let bareAborts = 0, proxyAborts = 0, expose = false
  const prompts = []
  const openMsgs = [
    { info: { id: 'ma', role: 'assistant', time: { created: now - 20 * 60000 } }, parts: [{ type: 'text', text: '半开', time: { start: now - 20 * 60000, end: now - 19 * 60000 } }] },
    { info: { id: 'mu', role: 'user', time: { created: now - 2 * 60000 } }, parts: [{ type: 'text', text: '继续' }] },
  ]
  const serve = http.createServer(function (req, res) {
    const u = req.url
    req.resume()
    if (req.method === 'GET' && u.indexOf('/session/status') === 0) {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ sid1: { type: 'busy' } }))
    }
    if (u === '/session/sid1/message' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(openMsgs))
    }
    if (u === '/session/sid1/abort' && req.method === 'POST') { bareAborts++; res.writeHead(204); return res.end() }
    res.writeHead(404); res.end('nf')
  })
  const proxyMock = http.createServer(function (req, res) {
    const u = req.url
    let body = ''
    req.on('data', function (c) { body += c })
    req.on('end', function () {
      if (u === '/_sessions') {
        res.writeHead(200, { 'content-type': 'application/json' })
        // time.updated=now：在单会话段候选窗口内（与用例 10 的 7h 前相反）
        return res.end(JSON.stringify([{ id: 'sid1', title: 'w1', pwa: 1, parentID: null, time: { updated: now }, directory: '/t/w1' }]))
      }
      // 轮2 才暴露：模拟 abort 的 errored 状态在本轮单会话扫描前还没反映（最坏竞态）
      if (u === '/api/session/sid1/message' && expose) {
        res.writeHead(200, { 'content-type': 'application/json' })
        return res.end(JSON.stringify(openMsgs))
      }
      if (u === '/api/session/sid1/abort' && req.method === 'POST') { proxyAborts++; res.writeHead(204); return res.end() }
      if (u === '/api/session/sid1/prompt_async' && req.method === 'POST') { prompts.push(body); res.writeHead(204); return res.end() }
      res.writeHead(404); res.end('nf')
    })
  })
  const servePort = await listen(serve, 0)
  const proxyPort = await listen(proxyMock, 0)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-pr-'))
  fs.mkdirSync(path.join(tmp, 'run'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'config', 'auth.txt'), 'dj:test')
  fs.writeFileSync(path.join(tmp, 'config', 'hidden-sessions.json'), '{"hidden":[]}')
  const runOnce = async function () {
    const child = spawn(process.execPath, [path.join(REPO, 'server', 'wedge-heal.js')], {
      env: Object.assign({}, process.env, { LITTLEDJ_PORT: String(proxyPort), LITTLEDJ_BACKEND_PORT: String(servePort), LITTLEDJ_ROOT: tmp }),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return await new Promise(function (resolve) { child.on('exit', resolve); setTimeout(function () { resolve('timeout') }, 30000) })
  }
  const c1 = await runOnce()
  ok('竞态 轮1 正常退出（observe-boot，单会话段读不到明细=不抢跑）', c1 === 0 && bareAborts === 0 && prompts.length === 0, 'code=' + c1 + ' aborts=' + bareAborts + ' prompts=' + prompts.length)
  expose = true
  const c2 = await runOnce()
  const logTxt = (function () { try { return fs.readFileSync(path.join(tmp, 'logs', 'wedge-heal.log'), 'utf8') } catch (e) { return '' } })()
  const st = (function () { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'config', 'wedge-heal-state.json'), 'utf8')) } catch (e) { return {} } })()
  ok('竞态 轮2 正常退出', c2 === 0, 'code=' + c2)
  ok('轮2 项目级段 abort×1 + 补恢复语×1', bareAborts === 1 && prompts.length === 1 && prompts[0].indexOf('卡死自动恢复') >= 0, 'aborts=' + bareAborts + ' prompts=' + prompts.length)
  ok('轮2 给单会话软解留了冷却（state.sessions.project-ok）', !!(st.sessions && st.sessions.sid1 && st.sessions.sid1.lastResult === 'project-ok' && st.sessions.sid1.lastAt), JSON.stringify(st.sessions || null))
  ok('同轮不二次 abort+重放（单会话软解冷却跳过）', proxyAborts === 0 && prompts.length === 1, 'proxyAborts=' + proxyAborts + ' prompts=' + prompts.length)
  ok('冷却跳过有日志', /跳过 sid1（本会话 \d+min 前刚处理过，冷却中）/.test(logTxt), logTxt.slice(-300))
  await closeServer(serve)
  await closeServer(proxyMock)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

// ---------- 用例 8b：NO_ABORT 应急闸 ----------
async function noAbortSuite() {
  console.log('\n== autoresume NO_ABORT 应急闸（P1-D）==')
  const calls = []
  const now = Date.now()
  const serve = http.createServer(function (req, res) {
    const u = req.url
    calls.push(u)
    req.resume()
    if (u === '/api/session' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: [{ id: 's1', title: 't', time: { updated: now }, directory: '/x' }] }))
    }
    if (u === '/session/s1/message' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify([{ info: { id: 'm1', role: 'user', time: { created: now - 20 * 60000 } }, parts: [{ type: 'text', text: '做点事' }] }]))
    }
    if (u === '/session/s1/abort') { res.writeHead(204); return res.end() }
    if (u === '/session/s1/prompt_async') { res.writeHead(204); return res.end() }
    res.writeHead(404); res.end('nf')
  })
  const port = await listen(serve, 0)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-na-'))
  fs.mkdirSync(path.join(tmp, 'run'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  const child = spawn(process.execPath, [path.join(REPO, 'server', 'autoresume.js'), '--reason', 'selftest'], {
    env: Object.assign({}, process.env, {
      LITTLEDJ_BACKEND_PORT: String(port), LITTLEDJ_ROOT: tmp,
      LITTLEDJ_AUTORESUME_SAMPLE_MS: '300', LITTLEDJ_AUTORESUME_MIN_AGE_MS: '0',
      LITTLEDJ_AUTORESUME_RECENT_MS: String(3600 * 1000),
      LITTLEDJ_AUTORESUME_NO_ABORT: '1',
    }),
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  const code = await new Promise(function (resolve) { child.on('exit', resolve); setTimeout(function () { resolve('timeout') }, 30000) })
  await closeServer(serve)
  ok('NO_ABORT=1 跳过 abort（无 abort 调用）', calls.indexOf('/session/s1/abort') < 0, JSON.stringify(calls))
  ok('NO_ABORT=1 不影响 prompt 续跑', calls.indexOf('/session/s1/prompt_async') >= 0)
  ok('NO_ABORT 进程正常退出', code === 0, 'code=' + code)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

// ---------- 用例 10b：项目级总闸 ----------
async function projectOffSuite() {
  console.log('\n== project-wedge 总闸 LITTLEDJ_WEDGE_PROJECT=0（P1-D）==')
  const now = Date.now()
  const serve = http.createServer(function (req, res) {
    const u = req.url
    req.resume()
    if (req.method === 'GET' && u.indexOf('/session/status') === 0) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}') }
    res.writeHead(404); res.end('nf')
  })
  const servePort = await listen(serve, 0)
  let hit = false
  const proxyMock = http.createServer(function (req, res) {
    req.resume()
    if (req.url === '/_sessions') { hit = true }
    res.writeHead(404); res.end('nf')
  })
  const proxyPort = await listen(proxyMock, 0)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-po-'))
  fs.mkdirSync(path.join(tmp, 'run'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'config', 'auth.txt'), 'dj:test')
  fs.writeFileSync(path.join(tmp, 'config', 'hidden-sessions.json'), '{"hidden":[]}')
  const child = spawn(process.execPath, [path.join(REPO, 'server', 'wedge-heal.js')], {
    env: Object.assign({}, process.env, { LITTLEDJ_PORT: String(proxyPort), LITTLEDJ_BACKEND_PORT: String(servePort), LITTLEDJ_ROOT: tmp, LITTLEDJ_WEDGE_PROJECT: '0' }),
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  const code = await new Promise(function (resolve) { child.on('exit', resolve); setTimeout(function () { resolve('timeout') }, 30000) })
  await closeServer(serve)
  await closeServer(proxyMock)
  const logTxt = (function () { try { return fs.readFileSync(path.join(tmp, 'logs', 'wedge-heal.log'), 'utf8') } catch (e) { return '' } })()
  ok('WEDGE_PROJECT=0 跳过项目级段（无 project-wedge scan 心跳）', logTxt.indexOf('project-wedge scan') < 0, logTxt.slice(-200))
  ok('总闸不影响主流程（/_sessions 仍被拉取）', hit)
  ok('总闸下进程正常退出', code === 0 || code === 1, 'code=' + code) // 404 列表会 exit(0)，进程不崩即可
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}

// ---------- 用例 10c：DRY 零写副作用（P1-2） ----------
async function projectDrySuite() {
  console.log('\n== project-wedge --dry 零写副作用 ==')
  const now = Date.now()
  const serve = http.createServer(function (req, res) {
    const u = req.url
    req.resume()
    if (req.method === 'GET' && u.indexOf('/session/status') === 0) {
      const dir = decodeURIComponent((u.split('directory=')[1] || ''))
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(dir.indexOf('/t/w1') >= 0 ? JSON.stringify({ sid1: { type: 'busy' } }) : '{}')
    }
    if (u === '/session/sid1/message' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify([
        { info: { id: 'ma', role: 'assistant', time: { created: now - 20 * 60000 } }, parts: [{ type: 'text', text: '半开', time: { start: now - 20 * 60000, end: now - 19 * 60000 } }] },
        { info: { id: 'mu', role: 'user', time: { created: now - 2 * 60000 } }, parts: [{ type: 'text', text: '继续' }] },
      ]))
    }
    if (u === '/session/sid1/abort' && req.method === 'POST') { res.writeHead(204); return res.end() }
    res.writeHead(404); res.end('nf')
  })
  const servePort = await listen(serve, 0)
  let aborted = 0
  const proxyMock = http.createServer(function (req, res) {
    req.resume()
    if (req.url === '/_sessions') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify([{ id: 'sid1', title: 'w1', pwa: 1, parentID: null, time: { updated: now - 7 * 3600 * 1000 }, directory: '/t/w1' }]))
    }
    if (req.url === '/api/session/sid1/abort' && req.method === 'POST') { aborted++; res.writeHead(204); return res.end('') }
    res.writeHead(404); res.end('nf')
  })
  const proxyPort = await listen(proxyMock, 0)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-pd-'))
  fs.mkdirSync(path.join(tmp, 'run'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'logs'), { recursive: true })
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'config', 'auth.txt'), 'dj:test')
  fs.writeFileSync(path.join(tmp, 'config', 'hidden-sessions.json'), '{"hidden":[]}')
  const spawnDry = async function () {
    const child = spawn(process.execPath, [path.join(REPO, 'server', 'wedge-heal.js'), '--dry'], {
      env: Object.assign({}, process.env, { LITTLEDJ_PORT: String(proxyPort), LITTLEDJ_BACKEND_PORT: String(servePort), LITTLEDJ_ROOT: tmp }),
      stdio: ['ignore', 'ignore', 'ignore'],
    })
    return await new Promise(function (resolve) { child.on('exit', resolve); setTimeout(function () { resolve('timeout') }, 30000) })
  }
  // 轮A：--dry 打头（observe-boot 也不写）
  const ca = await spawnDry()
  ok('dry 轮A 正常退出', ca === 0, 'code=' + ca)
  ok('dry 轮A 不写 bootAt（P1-2）', !fs.existsSync(path.join(tmp, 'config', 'wedge-heal-state.json')), 'state 应不存在')
  ok('dry 轮A 不写 jsonl warn', !fs.existsSync(path.join(tmp, 'run', 'wedge-heal-log.jsonl')) || readTmpWarns(tmp).length === 0)
  ok('dry 轮A 不落告警文件', !fs.existsSync(path.join(tmp, 'run', 'wedge-project-alert.json')))
  ok('dry 轮A 不 abort', aborted === 0)
  // 轮B（P2-新1）：预置 bootAt 后 --dry —— 命中分支也零写副作用
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true })
  fs.writeFileSync(path.join(tmp, 'config', 'wedge-heal-state.json'), JSON.stringify({ sessions: {}, projects: { bootAt: now - 3600 * 1000 } }))
  const cb = await spawnDry()
  const dryLog = (function () { try { return fs.readFileSync(path.join(tmp, 'logs', 'wedge-heal.log'), 'utf8') } catch (e) { return '' } })()
  ok('dry 轮B 正常退出（命中态预演）', cb === 0, 'code=' + cb)
  ok('dry 轮B 命中告警只在日志、不落 jsonl', readTmpWarns(tmp).length === 0)
  ok('dry 轮B 不落告警文件', !fs.existsSync(path.join(tmp, 'run', 'wedge-project-alert.json')))
  ok('dry 轮B 不写 state 冷却', !/lastAlertAt/.test(fs.readFileSync(path.join(tmp, 'config', 'wedge-heal-state.json'), 'utf8')))
  ok('dry 轮B 不 abort', aborted === 0)
  ok('dry 轮B 日志可见 [dry] 命中行', /\[dry\] project-wedge/.test(dryLog), dryLog.slice(-200))
  await closeServer(serve)
  await closeServer(proxyMock)
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
}
function readTmpWarns(tmp) {
  try {
    return fs.readFileSync(path.join(tmp, 'run', 'wedge-heal-log.jsonl'), 'utf8').split('\n').filter(Boolean).map(function (l) { try { return JSON.parse(l) } catch (e) { return null } }).filter(function (j) { return j && j.event === 'project-wedge' && j.level === 'warn' })
  } catch (e) { return [] }
}
async function main() {
  await relaySuite('deepseek-relay', 'deepseek-relay.js', function (upPort, port) {
    return Object.assign(relayEnv(upPort, port), { DS_RELAY_UPSTREAM: '127.0.0.1', DS_RELAY_UPSTREAM_PORT: String(upPort), DS_RELAY_UPSTREAM_SCHEME: 'http', DS_RELAY_PORT: String(port) })
  })
  await relaySuite('zhipu-relay', 'zhipu-relay.js', function (upPort, port) {
    return Object.assign(relayEnv(upPort, port), { ZP_RELAY_UPSTREAM_HOST: '127.0.0.1', ZP_RELAY_UPSTREAM_PORT: String(upPort), ZP_RELAY_UPSTREAM_SCHEME: 'http', ZP_RELAY_PORT: String(port) })
  })
  await autoresumeSuite('204')
  await autoresumeSuite('html')
  await noAbortSuite()
  await detectProjectSuite()
  await projectWedgeSuite()
  await projectRaceSuite()
  await projectDrySuite()
  await projectOffSuite()

  console.log('\n==== selftest-relay-timeout: ' + passCount + ' pass / ' + failCount + ' fail ====')
  if (failCount) { fails.forEach(function (f) { console.log('  RED: ' + f) }); process.exit(1) }
  process.exit(0)
}
main().catch(function (e) { console.error('FATAL ' + (e.stack || e)); process.exit(1) })

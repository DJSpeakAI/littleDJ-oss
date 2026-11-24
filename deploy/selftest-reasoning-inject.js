// selftest-reasoning-inject：task270 DeepSeek 思考档位默认最高注入自测
// 原理：本地起 fake upstream（http）+ 两个 relay 子进程（正常版 / DS_RELAY_NO_EFFORT=1 版），
//       端到端断言「转发体里 reasoning_effort 的有无与取值」，零真实 API 调用、零成本。
// 运行：node deploy/selftest-reasoning-inject.js ；退出码 0=全过 / 1=有失败。
const http = require('http')
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

const RELAY_JS = path.join(__dirname, '..', 'server', 'deepseek-relay.js')
const PORT_A = 14909 // 正常注入版 relay
const PORT_B = 14910 // NO_EFFORT 应急闸版 relay
const UP_PORT = 14911 // fake upstream

let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS ' + name) }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

// ---- fake upstream：记录每个请求的 method/url/body，回 200 JSON ----
const seen = []
let seenSeq = 0
const upstream = http.createServer(function (req, res) {
  let b = ''
  req.on('data', function (c) { b += c })
  req.on('end', function () {
    const rec = { seq: ++seenSeq, method: req.method, url: req.url, raw: b }
    try { rec.body = JSON.parse(b) } catch (e) { rec.body = null }
    seen.push(rec)
    const out = JSON.stringify({ ok: true, echo: rec.seq })
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(out) })
    res.end(out)
  })
})

function post(port, urlPath, obj, rawBody) {
  return new Promise(function (resolve, reject) {
    const body = rawBody !== undefined ? rawBody : JSON.stringify(obj)
    const req = http.request({
      host: '127.0.0.1', port: port, method: 'POST', path: urlPath,
      headers: { 'content-type': 'application/json' }
    }, function (res) {
      let b = ''
      res.on('data', function (c) { b += c })
      res.on('end', function () { resolve({ status: res.statusCode, body: b }) })
    })
    req.on('error', reject)
    req.end(body)
  })
}
function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: urlPath }, function (res) {
      let b = ''
      res.on('data', function (c) { b += c })
      res.on('end', function () { resolve({ status: res.statusCode, body: b }) })
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

function startRelay(port, extraEnv) {
  const env = Object.assign({}, process.env, {
    DS_RELAY_PORT: String(port),
    DS_RELAY_UPSTREAM: '127.0.0.1',
    DS_RELAY_UPSTREAM_PORT: String(UP_PORT),
    DS_RELAY_UPSTREAM_SCHEME: 'http'
  }, extraEnv || {})
  return spawn(process.execPath, [RELAY_JS], { env: env, stdio: ['ignore', 'pipe', 'pipe'] })
}

function lastSeen() { return seen[seen.length - 1] || {} }

;(async function () {
  console.log('== selftest-reasoning-inject (task270) ==')
  if (!fs.existsSync(RELAY_JS)) { console.log('FAIL relay 文件不存在'); process.exit(1) }

  await new Promise(function (r) { upstream.listen(UP_PORT, '127.0.0.1', r) })
  const relayA = startRelay(PORT_A)
  const relayB = startRelay(PORT_B, { DS_RELAY_NO_EFFORT: '1' })
  relayA.stdout.on('data', function () {})
  relayA.stderr.on('data', function (d) { console.log('  [relayA stderr] ' + String(d).trim()) })
  relayB.stdout.on('data', function () {})
  relayB.stderr.on('data', function (d) { console.log('  [relayB stderr] ' + String(d).trim()) })

  const aUp = await waitHealth(PORT_A, 25)
  const bUp = await waitHealth(PORT_B, 25)
  ok('两个 relay 实例 /health 就绪', aUp && bUp)
  if (!aUp || !bUp) return cleanup(1)

  // ① flash 无 effort → 注入 max
  let r = await post(PORT_A, '/chat/completions', { model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }] })
  let s = lastSeen()
  ok('① deepseek-flash 默认注入 max', s.body && s.body.reasoning_effort === 'max', 'got=' + JSON.stringify(s.body && s.body.reasoning_effort))
  ok('① 注入不动其他字段', s.body && s.body.model === 'deepseek-flash' && Array.isArray(s.body.messages))
  ok('① 响应透传 200+JSON', r.status === 200 && r.body.indexOf('"ok":true') >= 0)

  // ② v4-pro 无 effort → 注入 max
  await post(PORT_A, '/chat/completions', { model: 'deepseek-v4-pro', messages: [{ role: 'user', content: 'hi' }] })
  s = lastSeen()
  ok('② deepseek-v4-pro 默认注入 max', s.body && s.body.reasoning_effort === 'max')

  // ③ 上游显式 low → 不覆盖
  await post(PORT_A, '/chat/completions', { model: 'deepseek-flash', reasoning_effort: 'low', messages: [] })
  s = lastSeen()
  ok('③ 显式 low 尊重不覆盖', s.body && s.body.reasoning_effort === 'low')

  // ④ 上游显式 max → 保持
  await post(PORT_A, '/chat/completions', { model: 'deepseek-flash', reasoning_effort: 'high', messages: [] })
  s = lastSeen()
  ok('④ 显式 high 尊重不覆盖', s.body && s.body.reasoning_effort === 'high')

  // ⑤ 非白名单模型 → 不注入
  await post(PORT_A, '/chat/completions', { model: 'deepseek-chat', messages: [] })
  s = lastSeen()
  ok('⑤ deepseek-chat 不注入', s.body && s.body.reasoning_effort === undefined)

  // ⑥ GET /models → 不注入不炸
  r = await get(PORT_A, '/models')
  s = lastSeen()
  ok('⑥ GET /models 原样透传', r.status === 200 && s.method === 'GET' && s.url === '/models')

  // ⑦ 坏 JSON → 原样透传（fail-open）
  await post(PORT_A, '/chat/completions', null, '{not-json')
  s = lastSeen()
  ok('⑦ 坏 JSON 原样透传', s.raw === '{not-json')

  // ⑧ 应急闸实例 → 不注入
  await post(PORT_B, '/chat/completions', { model: 'deepseek-flash', messages: [] })
  s = lastSeen()
  ok('⑧ DS_RELAY_NO_EFFORT=1 不注入', s.body && s.body.reasoning_effort === undefined)

  // ⑨ 非 chat 端点 POST → 不注入
  await post(PORT_A, '/v1/chat/completions/', { model: 'deepseek-flash', messages: [] })
  s = lastSeen()
  ok('⑨ /v1/chat/completions/ 路径变体也注入', s.body && s.body.reasoning_effort === 'max', 'url=' + s.url)
  await post(PORT_A, '/user/balance', { json: true })
  s = lastSeen()
  ok('⑨b 非 chat 端点不注入', s.body && s.body.reasoning_effort === undefined, 'url=' + s.url)

  cleanup(fail > 0 ? 1 : 0)

  function cleanup(code) {
    try { relayA.kill('SIGKILL') } catch (e) {}
    try { relayB.kill('SIGKILL') } catch (e) {}
    try { upstream.close() } catch (e) {}
    console.log('== 结果: ' + pass + ' pass / ' + fail + ' fail ==')
    process.exit(code)
  }
})().catch(function (e) {
  console.log('FATAL ' + (e && e.stack))
  process.exit(1)
})

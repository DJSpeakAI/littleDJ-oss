#!/usr/bin/env node
// task167 selftest：readBody 统一 body 上限
// ①vm 纯逻辑单测（mock req 流：小 body/超默认 1MB/自定义上限/bad json/单飞回调）
// ②隔离实例实测（LITTLEDJ_PORT=40971，零副作用路由：/_tui/bell 与 /api/_tasks/abort-all dryRun）
'use strict'
const EventEmitter = require('events')
const http = require('http')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

let pass = 0, fail = 0
function ok(cond, name) { if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name) } }

// ── ① vm 单测：从 proxy.js 原文截取 readBody 函数执行（测真代码，不是复制品）──
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8')
const m = src.match(/function readBody\(req, cb, maxBytes\) \{[\s\S]*?\n\}/)
ok(!!m, '①0 readBody 三参签名存在于 proxy.js 原文')
const sandbox = { Error, JSON, Buffer }
vm.createContext(sandbox)
vm.runInContext(m ? m[0] : '', sandbox)
const readBody = sandbox.readBody

function mockReq(chunks) {
  const rq = new EventEmitter()
  process.nextTick(function () { chunks.forEach(function (c) { rq.emit('data', Buffer.from(c)) }); rq.emit('end') })
  return rq
}

// 1 小 body 正常
readBody(mockReq(['{"a":', '1}']), function (err, d) { ok(!err && d && d.a === 1, '①1 小 body 正常解析') })
// 2 超默认 1MB → body too large（code=BODY_TOO_LARGE）且只回调一次
{
  const big = 'x'.repeat(1024 * 1024 + 100)
  let n = 0, gotErr = null
  const rq = new EventEmitter()
  readBody(rq, function (e) { n++; gotErr = e })
  rq.emit('data', Buffer.from(big))
  rq.emit('data', Buffer.from('more'))
  rq.emit('end')
  ok(n === 1 && gotErr && gotErr.message === 'body too large' && gotErr.code === 'BODY_TOO_LARGE', '①2 超默认 1MB 单次回调 + code=BODY_TOO_LARGE（实测 n=' + n + '）')
}
// 3 自定义上限 20MB：1.5MB 不超限
{
  const big = JSON.stringify({ pad: 'y'.repeat(1500 * 1024) })
  readBody(mockReq([big]), function (err, d) { ok(!err && d && d.pad && d.pad.length === 1500 * 1024, '①3 maxBytes=20MB 时 1.5MB 放行') }, 20 * 1024 * 1024)
}
// 4 恰好等于上限：放行（判断是 > MAX 拒绝，= MAX 放行；'{"p":"' 6 字节 + '"}' 2 字节）
{
  const exact = '{"p":"' + 'z'.repeat(1024 * 1024 - 8) + '"}' // 总长恰 1MB
  readBody(mockReq([exact]), function (err, d) { ok(!err && d && d.p.length === 1024 * 1024 - 8, '①4 恰好 1MB 边界放行') })
}
// 5 超 1MB 一点：拒绝（边界外侧）
{
  const over = '{"p":"' + 'z'.repeat(1024 * 1024 - 7) + '"}' // 总长 1MB+1
  readBody(mockReq([over]), function (err) { ok(err && err.code === 'BODY_TOO_LARGE', '①5 1MB+1B 拒绝') })
}
// 6 bad json
readBody(mockReq(['{oops']), function (err) { ok(err && err.message === 'bad json', '①6 坏 JSON 报 bad json') })
// 7 空 body → {}
readBody(mockReq(['']), function (err, d) { ok(!err && d && typeof d === 'object', '①7 空 body 回 {}') })

// ── ② 隔离实例实测（零副作用路由）──
// task167 P2-4（御史建议）：自起自清——本脚本自己 spawn 40971 实例，跑完 kill，不依赖外部预起
const { spawn } = require('child_process')
const PORT = 40971
const AUTH = fs.readFileSync(process.env.HOME + '/littleDJ/config/auth.txt', 'utf8').trim()
const H = 'Basic ' + Buffer.from(AUTH).toString('base64')
const CHILD = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], {
  env: Object.assign({}, process.env, { LITTLEDJ_PORT: String(PORT) }),
  stdio: 'ignore', detached: false
})
let childDead = false
function killChild() { if (!childDead) { childDead = true; try { CHILD.kill() } catch (e) {} } }
process.on('exit', killChild)
// task167 复审 P2-6：Ctrl+C/SIGTERM 也收口子进程（exit 钩子覆盖不到信号默认行为）
process.on('SIGINT', function () { killChild(); process.exit(130) })
process.on('SIGTERM', function () { killChild(); process.exit(143) })
function post(p, body, cb) {
  const data = typeof body === 'string' ? body : JSON.stringify(body)
  const rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: H } }, function (rs) {
    let b = ''
    rs.on('data', function (c) { b += c })
    rs.on('end', function () { cb(rs.statusCode, b) })
  })
  rq.on('error', function (e) { cb(0, String(e)) })
  rq.end(data)
}

setTimeout(function () {
  // bell 正常小 body：200（无持久副作用）
  post('/_tui/bell', { kind: 'done' }, function (code) { ok(code === 200, '②1 bell 小 body 200（实测 ' + code + '）') })
  // bell 超 1MB：被拒（bell 调用点 err 分支回 400——readBody 兜底保证超限不读满内存；区分 413 是 abort-all/queue 等主路由的事，已单测）
  post('/_tui/bell', JSON.stringify({ kind: 'done', pad: 'a'.repeat(1200 * 1024) }), function (code) { ok(code === 400 || code === 413, '②2 bell 超 1MB 被拒（实测 ' + code + '，兜底生效即可）') })
  // abort-all 超 1MB：413 且不执行（task167 加固点）
  post('/api/_tasks/abort-all', JSON.stringify({ pad: 'b'.repeat(1200 * 1024) }), function (code) { ok(code === 413, '②3 abort-all 超限 413 不执行（实测 ' + code + '）') })
  // abort-all dryRun 正常 body：200（只读预览）
  post('/api/_tasks/abort-all?dryRun=1', { dryRun: true }, function (code, b) { ok(code === 200, '②4 abort-all dryRun 小 body 200（实测 ' + code + '）') })
  // abort-all 坏 JSON：400 拒绝（加固点——原逻辑会降级空 body 真跑）
  post('/api/_tasks/abort-all', '{oops', function (code) { ok(code === 400, '②5 abort-all 坏 JSON 400 拒绝（实测 ' + code + '）') })
  // ── task167 P1-1（御史打回补测）：/_queue POST 必须吃 20MB 而非默认 1MB ──
  // 用例零副作用技巧：1.5MB body + 缺 session → 若 body 上限是 20MB 则 readBody 放行、被后续 sid 校验拦回 400；
  // 若仍是默认 1MB 则直接 413（P0-1 回归会在此爆红）。
  post('/_queue', JSON.stringify({ sidless: 'q'.repeat(1500 * 1024) }), function (code) { ok(code !== 413 && code === 400, '②6 /_queue POST 1.5MB 放行至 sid 校验 400（≠413；实测 ' + code + '，P0-1 回归锚）') })
  // 20MB+1：超上限必须 413
  post('/_queue', JSON.stringify({ pad: 'r'.repeat(20 * 1024 * 1024 + 100) }), function (code) { ok(code === 413, '②7 /_queue POST 20MB+1 → 413（实测 ' + code + '）') })
  setTimeout(function () {
    killChild()
    // task167 复审 P2-7：总数断言——固定 3s 收尾在极慢机器上可能静默丢用例（假绿），缺用例即判失败
    const EXPECTED = 15
    const actualCount = pass + fail
    if (actualCount !== EXPECTED) { console.log('FAIL 总数断言：期望 ' + EXPECTED + ' 用例，实际 ' + actualCount + '（疑似异步用例未回调）'); fail++ }
    console.log('\n== task167 selftest: ' + pass + ' PASS / ' + fail + ' FAIL ==')
    process.exit(fail ? 1 : 0)
  }, 3000)
}, 1500)

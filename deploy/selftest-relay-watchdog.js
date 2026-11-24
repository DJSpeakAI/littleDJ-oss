#!/usr/bin/env node
// selftest-relay-watchdog：task306 A 项自测——zhipu-relay 实质内容看门狗
// 三层：
//  ①纯函数打表 hasSubstantiveSSE（注释/空行/[DONE]/ping 载荷=心跳；实质 data/非 SSE=活跃）
//  ②E2E 本地假上游 + 短超时 relay 子进程（ZP_RELAY_CONTENT_TIMEOUT_MS=2000）：
//    A 心跳流→观察期 6s 内被服务端掐断且 relay 日志含 content watchdog
//    B 正常流→完整收到全部内容+[DONE]，不触发
//    C 慢内容流（间隔<窗口但总长>窗口）→不误杀完整收到
//  ③红对照：ZP_RELAY_NO_CONTENT_WATCHDOG=1 心跳流挂满 5s 观察期不断（旧 bug 形态=断言有效）
// 运行：node deploy/selftest-relay-watchdog.js；退出码 0=全过 1=有挂
'use strict'
const http = require('http')
const { spawn } = require('child_process')
const path = require('path')

const REPO = path.join(__dirname, '..')
const RELAY = path.join(REPO, 'server', 'zhipu-relay.js')
let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}

// ---------- ① 纯函数打表 ----------
const { hasSubstantiveSSE } = require(RELAY)
ok('①a 注释心跳=不活跃', hasSubstantiveSSE(': ping\n\n') === false)
ok('①a2 CRLF注释心跳=不活跃(P0-1)', hasSubstantiveSSE(': ping\r\n\r\n') === false)
ok('①b 空块=不活跃', hasSubstantiveSSE('\n\n') === false)
ok('①b2 CRLF空块=不活跃(P0-1)', hasSubstantiveSSE('\r\n\r\n') === false)
ok('①c data空载荷=不活跃', hasSubstantiveSSE('data: \n\n') === false)
ok('①d data[DONE]=不活跃', hasSubstantiveSSE('data: [DONE]\n\n') === false)
ok('①e data ping载荷=不活跃', hasSubstantiveSSE('data: {"type":"ping"}\n\n') === false)
ok('①e2 CRLF ping载荷=不活跃(P0-1)', hasSubstantiveSSE('data: {"type":"ping"}\r\n\r\n') === false)
ok('①f data keep-alive载荷=不活跃', hasSubstantiveSSE('data: {"event":"keep-alive"}\n\n') === false)
ok('①f2 data空对象帧=不活跃(P0-2)', hasSubstantiveSSE('data: {}\n\n') === false)
ok('①f3 空delta帧=不活跃(P0-2)', hasSubstantiveSSE('data: {"choices":[{"delta":{"content":""}}]}\n\n') === false)
ok('①f4 role-only delta帧=不活跃(P0-2)', hasSubstantiveSSE('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n') === false)
ok('①f5 正常内容含heartbeat字样=活跃(P2-8)', hasSubstantiveSSE('data: {"choices":[{"delta":{"content":"the heartbeat system is"}}]}\n\n') === true)
ok('①g data实质delta=活跃', hasSubstantiveSSE('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n') === true)
ok('①g2 CRLF实质delta=活跃(P0-1)', hasSubstantiveSSE('data: {"choices":[{"delta":{"content":"hi"}}]}\r\n\r\n') === true)
ok('①g3 reasoning delta=活跃', hasSubstantiveSSE('data: {"choices":[{"delta":{"reasoning_content":"想"}}]}\n\n') === true)
ok('①g4 finish_reason帧=活跃', hasSubstantiveSSE('data: {"choices":[{"finish_reason":"stop"}]}\n\n') === true)
ok('①g5 usage帧=活跃', hasSubstantiveSSE('data: {"usage":{"total_tokens":9}}\n\n') === true)
ok('①h 注释+空choices帧混合=不活跃(白名单语义)', hasSubstantiveSSE(': ping\n\ndata: {"choices":[]}\n: ping\n') === false)
ok('①h2 注释+实质delta混合=活跃', hasSubstantiveSSE(': ping\n\ndata: {"choices":[{"delta":{"content":"x"}}]}\n: ping\n') === true)
ok('①i 非SSE普通JSON=活跃', hasSubstantiveSSE('{"code":0,"msg":"ok"}') === true)
ok('①j 非SSE二进制=活跃', hasSubstantiveSSE('\u0000\u0001\u0002') === true)
ok('①k data:ping纯文本=不活跃(P1-3)', hasSubstantiveSSE('data: ping\n\n') === false)
ok('①k2 data:heartbeat纯文本=不活跃(P1-3)', hasSubstantiveSSE('data: heartbeat\n\n') === false)
ok('①k3 event:ping行=不活跃(P1-3)', hasSubstantiveSSE('event: ping\n\n') === false)
ok('①k4 event+data双ping=不活跃(P1-3)', hasSubstantiveSSE('event: ping\ndata: ping\n\n') === false)
ok('①k5 id/retry字段行=不活跃(P1-3)', hasSubstantiveSSE('id: 42\nretry: 3000\n\n') === false)
ok('①k6 event:ping+实质data=活跃(P1-3)', hasSubstantiveSSE('event: ping\ndata: {"choices":[{"delta":{"content":"x"}}]}\n\n') === true)
ok('①k7 CRLF event+data双ping=不活跃(P1-3)', hasSubstantiveSSE('event: ping\r\ndata: ping\r\n\r\n') === false)
ok('①l legacy function_call=活跃(P2-5)', hasSubstantiveSSE('data: {"choices":[{"delta":{"function_call":{"name":"f"}}}]}\n\n') === true)
ok('①l2 空choices带usage尾帧=活跃(P2-5)', hasSubstantiveSSE('data: {"choices":[],"usage":{"total_tokens":9}}\n\n') === true)

// ---------- 基础设施 ----------
function freePort(cb) {
  const s = http.createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => cb(p)) })
}
function startUpstream(port, behavior) {
  return http.createServer((rq, rs) => behavior(rs))
}
function startRelay(port, upstreamPort, envExtra, onLine) {
  const child = spawn('node', [RELAY], {
    env: Object.assign({}, process.env, {
      ZP_RELAY_PORT: String(port),
      ZP_RELAY_CONTENT_TIMEOUT_MS: '2000',
      ZP_RELAY_UPSTREAM_HOST: '127.0.0.1',
      ZP_RELAY_UPSTREAM_PORT: String(upstreamPort),
      ZP_RELAY_UPSTREAM_SCHEME: 'http'
    }, envExtra || {})
  })
  child.stdout.on('data', d => { String(d).split('\n').filter(Boolean).forEach(l => onLine && onLine(l)) })
  child.stderr.on('data', d => process.stderr.write('[relay-stderr] ' + d))
  return child
}
function waitHealth(port, tries, cb) {
  let n = 0
  const t = setInterval(() => {
    const r = http.get({ host: '127.0.0.1', port, path: '/health', timeout: 800 }, res => {
      res.resume(); clearInterval(t); cb()
    })
    r.on('error', () => { if (++n >= tries) { clearInterval(t); cb(new Error('relay 未就绪')) } })
  }, 300)
}
// 观察一个客户端流：observeMs 内自然终止→{forced:false}；到期仍连着→主动掐并回报 forced:true
function clientStream(port, observeMs, cb) {
  const t0 = Date.now()
  let settled = false
  const settle = r => { if (!settled) { settled = true; clearTimeout(timer); cb(r) } }
  const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/api/coding/paas/v4/chat/completions', headers: { 'Content-Type': 'application/json' } }, res => {
    let text = ''
    res.on('data', c => { text += c.toString() })
    res.on('end', () => settle({ forced: false, ms: Date.now() - t0, text }))
    res.on('aborted', () => settle({ forced: false, ms: Date.now() - t0, text, aborted: true }))
    res.on('error', e => settle({ forced: false, ms: Date.now() - t0, text, err: e.message }))
  })
  req.on('error', e => settle({ forced: false, ms: Date.now() - t0, text: '', err: e.message }))
  req.end(JSON.stringify({ model: 'x', messages: [] }))
  const timer = setTimeout(() => { req.destroy(); settle({ forced: true, ms: observeMs, text: '' }) }, observeMs)
}

// ---------- ②③ E2E ----------
freePort(upPort => {
  const upA = startUpstream(upPort, rs => {   // 行为A：只发心跳（CRLF 形态——P0-1 红线场景）
    rs.writeHead(200, { 'Content-Type': 'text/event-stream' })
    const iv = setInterval(() => rs.write(': ping\r\n\r\ndata: {"type":"ping"}\r\n\r\n'), 300)
    rs.on('close', () => clearInterval(iv))
  })
  upA.listen(upPort, '127.0.0.1', () => {
    freePort(relayPort => {
      let sawWatchdogLog = false
      const relay = startRelay(relayPort, upPort, {}, l => { if (l.includes('content watchdog')) sawWatchdogLog = true })
      waitHealth(relayPort, 40, err => {
        if (err) { ok('② relay 启动', false, err.message); return finish(relay, [upA]) }
        ok('② relay 启动', true)
        clientStream(relayPort, 6000, r => {   // A 心跳流（CRLF+空帧混合）：期望 6s 内被服务端掐断
          ok('②A CRLF心跳流被看门狗掐断(2~6s)', !r.forced && r.ms < 6000, 'ms=' + r.ms + (r.err ? ' err=' + r.err : ''))
          ok('②A relay 日志含 content watchdog', sawWatchdogLog)
          swapUpstream([upA], upPort, rs => {  // A2 空delta/role-only 心跳流（P0-2 红线场景）
            rs.writeHead(200, { 'Content-Type': 'text/event-stream' })
            let i = 0
            const iv = setInterval(() => {
              i++
              rs.write(i % 2 ? 'data: {"choices":[{"delta":{"content":""}}]}\n\n' : 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n')
            }, 300)
            rs.on('close', () => clearInterval(iv))
          }, upA2 => {
            clientStream(relayPort, 6000, rA2 => {
              ok('②A2 空delta帧流被看门狗掐断', !rA2.forced && rA2.ms < 6000, 'ms=' + rA2.ms)
              swapUpstream([upA2], upPort, rs => {  // A3 event:ping/data:ping 纯文本心跳流（P1-3 红线场景，CRLF）
                rs.writeHead(200, { 'Content-Type': 'text/event-stream' })
                const iv = setInterval(() => rs.write('event: ping\r\ndata: ping\r\n\r\n'), 300)
                rs.on('close', () => clearInterval(iv))
              }, upA3 => {
                clientStream(relayPort, 6000, rA3 => {
                  ok('②A3 event/data纯文本心跳流被掐断(P1-3)', !rA3.forced && rA3.ms < 6000, 'ms=' + rA3.ms)
                  swapUpstream([upA3], upPort, rs => {  // B 正常流
                rs.writeHead(200, { 'Content-Type': 'text/event-stream' })
                rs.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n')
                rs.write('data: {"choices":[{"delta":{"content":"世界"}}]}\n\n')
                rs.write('data: [DONE]\n\n')
                rs.end()
              }, upB => {
                clientStream(relayPort, 8000, r2 => {
                  ok('②B 正常流完整收到', !r2.forced && r2.text.includes('你好') && r2.text.includes('世界') && r2.text.includes('[DONE]'), 'ms=' + r2.ms)
                  swapUpstream([upB], upPort, rs => {  // B2 劈块流（P0-2 附注：残行缓冲后不误判）
                    rs.writeHead(200, { 'Content-Type': 'text/event-stream' })
                    const line1 = Buffer.from('data: {"choices":[{"delta":{"content":"split-ok"}}]\n\n')
                    rs.write(line1.slice(0, 20))   // 劈前半
                    setTimeout(() => { rs.write(line1.slice(20)); rs.write('data: [DONE]\n\n'); rs.end() }, 300)
                  }, upB2 => {
                    clientStream(relayPort, 8000, rB2 => {
                      ok('②B2 劈块流完整收到(split-ok)', !rB2.forced && rB2.text.includes('split-ok') && rB2.text.includes('[DONE]'), 'ms=' + rB2.ms)
                      swapUpstream([upB2], upPort, rs => {  // C 慢内容流：700ms×5 块（总3.5s>窗口，间隔<窗口）
                        rs.writeHead(200, { 'Content-Type': 'text/event-stream' })
                        let i = 0
                        const iv = setInterval(() => {
                          i++
                          if (i <= 5) rs.write('data: {"choices":[{"delta":{"content":"c' + i + '"}}]}\n\n')
                          else { clearInterval(iv); rs.write('data: [DONE]\n\n'); rs.end() }
                        }, 700)
                        rs.on('close', () => clearInterval(iv))
                      }, upC => {
                        clientStream(relayPort, 9000, r3 => {
                          ok('②C 慢内容流不误杀(收满5块)', !r3.forced && r3.text.includes('c5') && r3.text.includes('[DONE]'), 'ms=' + r3.ms)
                          relay.kill()   // ③ 红对照：应急闸实例
                          swapUpstream([upC], upPort, rs => {
                            rs.writeHead(200, { 'Content-Type': 'text/event-stream' })
                            const iv = setInterval(() => rs.write(': ping\n\n'), 300)
                            rs.on('close', () => clearInterval(iv))
                          }, upD => {
                            const relay2 = startRelay(relayPort, upPort, { ZP_RELAY_NO_CONTENT_WATCHDOG: '1' }, () => {})
                            waitHealth(relayPort, 40, e2 => {
                              if (e2) { ok('③ relay2 启动', false, e2.message); return finish(relay2, [upD]) }
                              ok('③ relay2 启动', true)
                              clientStream(relayPort, 5000, r4 => {
                                ok('③红对照:应急闸下心跳流挂满5s不断', r4.forced === true, 'ms=' + r4.ms)
                                finish(relay2, [upD])
                              })
                            })
                          })
                        })
                      })
                    })
                  })
                })
              })
            })
          })
        })
      })
    })
  })
})
})  // A3 clientStream 回调闭合
})  // A3 swapUpstream 调用闭合

function swapUpstream(olds, port, behavior, cb) {
  let left = olds.length
  olds.forEach(s => s.close(() => { if (--left === 0) {
    const nu = startUpstream(port, behavior)
    nu.listen(port, '127.0.0.1', () => cb(nu))
  } }))
}
function finish(relay, servers) {
  try { relay.kill() } catch (e) {}
  servers.forEach(s => { try { s.close() } catch (e) {} })
  setTimeout(() => {
    console.log('----')
    console.log('selftest-relay-watchdog: ' + pass + ' pass / ' + fail + ' fail')
    process.exit(fail === 0 ? 0 : 1)
  }, 400)
}

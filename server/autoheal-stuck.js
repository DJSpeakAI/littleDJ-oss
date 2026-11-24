// autoheal-stuck: 挂死空轮自动处置（task306）
// 背景：2026-11-15 DAG 项目两个会话卡死——09:55 会话留下「assistant 空消息（0 parts、无 error、
// 无 completed）」永久悬挂；主人发消息只进库不处理。relay 内容看门狗（task306 A 项）负责掐断
// 悬挂的流，本脚本兜底处置「已经挂死的空轮」：判定从严（只认 assistant 尾消息 parts 为空或
// 仅 step-start、无 error、无 completed、创建超 STUCK_MIN 分钟），动作只做 abort（等价点停止键，
// 可逆），处置结果落 run/autoheal-log.jsonl 供审计。
// 与 autoresume.js（task301）职责互补：那边管「重启/断网后的中断续跑」，这边管「在途挂死空轮的解封」。
// 调度：deploy/watchdog.sh 每 AUTOHEAL_EVERY 跳（默认 60×15s ≈ 15 分钟）后台跑一次；单实例锁。
// 红线：不碰 user 尾消息形态（autoresume 域）、不碰带 error/completed 的消息（已终态）、
//       单次最多 MAX_FIX 个、候选超 MAX_CANDIDATES 视为异常态只记日志不动手（防雪崩误杀）。
const http = require('http')
const fs = require('fs')
const path = require('path')

const ROOT = require('./paths').ROOT
const PROXY_PORT = Number(process.env.LITTLEDJ_PORT || 4097)
const STUCK_MIN = Number(process.env.AUTOHEAL_STUCK_MIN || 10)        // 空轮创建后多少分钟才算挂死
const MAX_FIX = Number(process.env.AUTOHEAL_MAX_FIX || 3)             // 单次最多处置几个
const MAX_CANDIDATES = Number(process.env.AUTOHEAL_MAX_CANDIDATES || 20) // 候选超此数=异常态不动手
// 候选窗口：只看近 N 小时内有事件的 running 会话（生产首跑实证：/_tasks 有 639 个陈旧 running
// 台账行——浏览器关掉从未收到终态事件；挂死是新鲜事故，陈旧态不归本工具管，窗口外直接不查）
const CAND_WINDOW_MS = Number(process.env.AUTOHEAL_CAND_WINDOW_H || 6) * 3600000
const PID_FILE = path.join(ROOT, 'run', 'autoheal-stuck.pid')
const LOG_JSONL = path.join(ROOT, 'run', 'autoheal-log.jsonl')

// ---- 判定纯函数（自测打表用）：最后一条消息是否「挂死空轮」----
function isStuckEmptyTurn(msg, nowMs, stuckMs) {
  if (!msg || !msg.info) return false
  const i = msg.info
  if (i.role !== 'assistant') return false            // user 尾消息 = 未开始/中断域，不碰
  if (i.error) return false                           // 已带错误（含 Aborted）= 已终态
  if (i.time && i.time.completed) return false        // 已完成 = 不是悬挂
  // parts 字段缺失 = 数据形态异常，保守不碰（P1-2：缺 parts ≠ 空 parts，防误杀）
  if (!Array.isArray(msg.parts)) return false
  if (msg.parts.length > 0) {
    // 非空但只到 step-start（第一步都没走完）也算；有任何 step-finish/text/tool 即动过，不碰
    const onlyStepStart = msg.parts.every(function (p) { return p && p.type === 'step-start' })
    if (!onlyStepStart) return false
  }
  const created = i.time && i.time.created
  if (!created || typeof created !== 'number') return false
  return nowMs - created >= stuckMs
}

function reqJSON(method, p, body, cb) {
  let auth = ''
  try {
    auth = fs.readFileSync(path.join(ROOT, 'config', 'auth.txt'), 'utf8').trim()
  } catch (e) {
    console.log('[autoheal] config/auth.txt 不可读，本次放弃')
    try { fs.unlinkSync(PID_FILE) } catch (e2) {} // P2：与 done() 同收口，不留锁残留
    process.exit(0) // 手动跑兜底（watchdog 已前置检查，此处只兜手动入口）
  }
  const payload = body ? JSON.stringify(body) : null
  const headers = { Authorization: 'Basic ' + Buffer.from(auth).toString('base64') }
  if (payload) {
    headers['Content-Type'] = 'application/json'
    headers['Content-Length'] = Buffer.byteLength(payload)
  }
  // P1-2：单次回调守卫——超时 destroy 后 req error 与 res aborted/error 会先后到达，
  // 双回调会击穿串行与 MAX_FIX（二审 E2E 实证 cb 跑两次），全路径收口到 finish 只放行一次
  let settled = false
  const finish = function () {
    if (settled) return
    settled = true
    cb.apply(null, arguments)
  }
  const r = http.request({
    host: '127.0.0.1', port: PROXY_PORT, method: method, path: p, headers: headers
  }, function (res) {
    let d = ''
    res.on('data', function (c) { d += c })
    res.on('end', function () {
      let j = null
      try { j = JSON.parse(d) } catch (e) { /* 非 JSON 按原文透传 */ }
      finish(null, res.statusCode, j, d)
    })
    res.on('error', function (e) { finish(e) })
    res.on('aborted', function () { finish(new Error('aborted ' + p)) })
  })
  r.setTimeout(20000, function () { r.destroy(new Error('timeout ' + p)) })
  r.on('error', function (e) { finish(e) })
  if (payload) r.write(payload)
  r.end()
}

function logJsonl(obj) {
  try {
    fs.mkdirSync(path.dirname(LOG_JSONL), { recursive: true })
    // P2-6：超 1MB 轮转（保留 .old 一代，审计不丢最近记录）
    try {
      const st = fs.statSync(LOG_JSONL)
      if (st.size > 1024 * 1024) {
        try { fs.unlinkSync(LOG_JSONL + '.old') } catch (e) {}
        fs.renameSync(LOG_JSONL, LOG_JSONL + '.old')
      }
    } catch (e) { /* 无文件 = 首写 */ }
    fs.appendFileSync(LOG_JSONL, JSON.stringify(obj) + '\n')
  } catch (e) { /* 审计日志失败不阻断处置 */ }
}

// 双采样状态（P1-2）：上一轮命中但未处置的 {sid: {msgId}}——本轮再命中且消息 id 未变才处置
// （与 task157 auto-reap「连续 2 tick」同型；中途恢复/有新消息的会话 id 会变，自然排除）
const PENDING_FILE = path.join(ROOT, 'run', 'autoheal-pending.json')
function readPending() {
  try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')) || {} } catch (e) { return {} }
}
function writePending(obj) {
  try {
    fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true })
    // P2：原子写（tmp+rename），损坏时 readPending 读回 {} 只重置双采样不影响处置
    const tmp = PENDING_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(obj))
    fs.renameSync(tmp, PENDING_FILE)
  } catch (e) { /* 状态落盘失败则退化为单采样（不阻断） */ }
}

function main() {
  // 单实例锁：上一次还在跑（不应发生，脚本秒级）则退出
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
    if (pid && process.kill(pid, 0)) {
      console.log('[autoheal] 上一次仍在运行 pid=' + pid + '，跳过')
      return
    }
  } catch (e) { /* 无锁文件 = 正常 */ }
  try { fs.mkdirSync(path.dirname(PID_FILE), { recursive: true }); fs.writeFileSync(PID_FILE, String(process.pid)) } catch (e) {}
  const done = function (code) {
    try { fs.unlinkSync(PID_FILE) } catch (e) {}
    process.exit(code)
  }

  const now = Date.now()
  const stuckMs = STUCK_MIN * 60 * 1000

  reqJSON('GET', '/_tasks', null, function (err, code, j) {
    if (err || code !== 200 || !j || !Array.isArray(j.tasks)) {
      console.log('[autoheal] _tasks 不可读（' + (err ? err.message : 'HTTP ' + code) + '），本次放弃')
      return done(0) // 只读失败不报错（proxy 短暂重启属正常）
    }
    const candidates = j.tasks.filter(function (t) {
      if (!t || t.state !== 'running' || typeof t.lastEventAt !== 'number') return false
      const quietMs = now - t.lastEventAt
      return quietMs >= stuckMs && quietMs <= CAND_WINDOW_MS // 静默超挂死线 且 仍在候选窗口内
    })
    if (candidates.length === 0) {
      console.log('[autoheal] 无候选（running 且静默 ' + STUCK_MIN + 'min~' + Math.round(CAND_WINDOW_MS / 3600000) + 'h）') // P2-5：零候选也留痕，调度存活可从日志确认
      return done(0)
    }
    if (candidates.length > MAX_CANDIDATES) {
      console.log('[autoheal] 候选 ' + candidates.length + ' 个超上限 ' + MAX_CANDIDATES + '，疑似异常态，只记日志不动手')
      logJsonl({ ts: new Date().toISOString(), action: 'skip-anomaly', candidates: candidates.length })
      return done(0)
    }
    let fixed = 0
    let stat = { cand: candidates.length, first: 0, fixed: 0, skip: 0 } // P2-5：收尾摘要一行，调度存活可从日志确认
    const queue = candidates.slice()
    const pendingPrev = readPending() // 上一轮命中快照
    const pendingNext = {}
    // 串行处理（并发回调会让 MAX_FIX 检查竞态失守——三个候选同时过闸超处置）
    const next = function () {
      if (queue.length === 0) {
        writePending(pendingNext)
        console.log('[autoheal] 收尾: 候选' + stat.cand + ' 首命中' + stat.first + ' 解封' + stat.fixed + ' 非挂死' + stat.skip + '（静默' + STUCK_MIN + 'min~' + Math.round(CAND_WINDOW_MS / 3600000) + 'h 窗口）')
        return done(0)
      }
      const t = queue.shift()
      const sid = t.id
      reqJSON('GET', '/api/session/' + encodeURIComponent(sid) + '/message', null, function (e2, c2, msgs) {
        if (e2 || c2 !== 200 || !Array.isArray(msgs) || msgs.length === 0) return next()
        const last = msgs[msgs.length - 1]
        if (!isStuckEmptyTurn(last, now, stuckMs)) { stat.skip += 1; return next() }
        const msgId = last.info && last.info.id
        // 双采样（P1-2）：上轮没见过 = 本轮只记录；上轮命中且消息没变 = 二次确认，处置
        if (!pendingPrev[sid] || pendingPrev[sid].msgId !== msgId) {
          stat.first += 1
          pendingNext[sid] = { msgId: msgId, ts: new Date().toISOString() }
          console.log('[autoheal] 首次命中待复核: ' + (t.title || sid) + ' (' + sid + ')')
          return next()
        }
        if (fixed >= MAX_FIX) {
          pendingNext[sid] = pendingPrev[sid] // 名额满：保留双采样状态，下轮免重记
          logJsonl({ ts: new Date().toISOString(), action: 'skip-maxfix', session: sid, title: t.title || '' })
          return next()
        }
        reqJSON('POST', '/api/session/' + encodeURIComponent(sid) + '/abort', {}, function (e3, c3) {
          const okAbort = !e3 && c3 !== undefined && c3 >= 200 && c3 < 300
          const alreadyGone = !e3 && (c3 === 404 || c3 === 410) // P2：会话已结束=目标态已达成，不记失败
          if (okAbort) { fixed += 1; stat.fixed += 1 }
          console.log('[autoheal] ' + (okAbort ? '已解封' : (alreadyGone ? '已结束(无需处置)' : '解封失败')) + ' 挂死空轮(二次确认): ' + (t.title || sid) + ' (' + sid + ')')
          logJsonl({
            ts: new Date().toISOString(), action: 'abort', ok: okAbort,
            session: sid, title: t.title || '',
            hungMin: Math.round((now - (last.info.time && last.info.time.created || now)) / 60000),
            http: c3, error: e3 ? e3.message : undefined
          })
          next()
        })
      })
    }
    next()
  })
}

if (require.main === module) {
  main()
} else {
  module.exports = { isStuckEmptyTurn, reqJSON } // deploy/selftest-autoheal.js 打表/双回调直测用
}

#!/usr/bin/env node
// selftest-autoheal：task306 B 项自测——挂死空轮自动处置
// ①判定纯函数 isStuckEmptyTurn 打表 + ①B reqJSON 双回调直测（P1-2：cb 只跑一次）
// ②E2E 假 proxy（/_tasks + /api/session/x/message + abort 计数）+ 临时 sandbox 跑真主流程：
//   双采样（首跑零处置+pending 记录、二跑处置=MAX_FIX）、user 尾不碰、陈旧台账不入候选
// ③异常态熔断：候选超上限零动手
// 运行：node deploy/selftest-autoheal.js；退出码 0=全过 1=有挂
'use strict'
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')

const REPO = path.join(__dirname, '..')
const HEAL = path.join(REPO, 'server', 'autoheal-stuck.js')
let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? ' | ' + extra : '')) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' | ' + extra : '')) }
}
const MIN = 60 * 1000
const now = 1794710000000

// ---------- ① 判定纯函数打表 ----------
const { isStuckEmptyTurn } = require(HEAL)
const mk = (over) => ({ info: { role: 'assistant', time: { created: now - over } }, parts: [] })
ok('①a 空parts超时=挂死', isStuckEmptyTurn(mk(11 * MIN), now, 10 * MIN) === true)
ok('①b 空parts未超时=不碰', isStuckEmptyTurn(mk(3 * MIN), now, 10 * MIN) === false)
ok('①c 仅step-start超时=挂死', isStuckEmptyTurn({ info: { role: 'assistant', time: { created: now - 30 * MIN } }, parts: [{ type: 'step-start' }] }, now, 10 * MIN) === true)
ok('①d 有text内容=不碰', isStuckEmptyTurn({ info: { role: 'assistant', time: { created: now - 30 * MIN } }, parts: [{ type: 'text', text: 'hi' }] }, now, 10 * MIN) === false)
ok('①e 有tool part=不碰', isStuckEmptyTurn({ info: { role: 'assistant', time: { created: now - 30 * MIN } }, parts: [{ type: 'step-start' }, { type: 'tool' }] }, now, 10 * MIN) === false)
ok('①f user尾=不碰', isStuckEmptyTurn({ info: { role: 'user', time: { created: now - 30 * MIN } }, parts: [] }, now, 10 * MIN) === false)
ok('①g 带error=不碰(已终态)', isStuckEmptyTurn({ info: { role: 'assistant', error: { name: 'MessageAbortedError' }, time: { created: now - 30 * MIN } }, parts: [] }, now, 10 * MIN) === false)
ok('①h 已completed=不碰', isStuckEmptyTurn({ info: { role: 'assistant', time: { created: now - 30 * MIN, completed: now - 29 * MIN } }, parts: [] }, now, 10 * MIN) === false)
ok('①i 无created=不碰', isStuckEmptyTurn({ info: { role: 'assistant' }, parts: [] }, now, 10 * MIN) === false)
ok('①i2 无parts字段=不碰(P1-2)', isStuckEmptyTurn({ info: { role: 'assistant', time: { created: now - 30 * MIN } } }, now, 10 * MIN) === false)
ok('①j null=不碰', isStuckEmptyTurn(null, now, 10 * MIN) === false)

function finishAll() {
  console.log('----')
  console.log('selftest-autoheal: ' + pass + ' pass / ' + fail + ' fail')
  process.exit(fail === 0 ? 0 : 1)
}

// ---------- ①B reqJSON 双回调直测（P1-2） ----------
function testReqJSONOnce(cb) {
  const broken = http.createServer((rq, rs) => {
    rs.writeHead(200, { 'Content-Type': 'application/json' })
    rs.write('{"partial":')
    setTimeout(() => rs.destroy(), 30) // req error 与 res aborted/error 先后到达，cb 只许跑一次
  })
  broken.listen(0, '127.0.0.1', () => {
    const port = broken.address().port
    const box = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-ah-rj-'))
    fs.mkdirSync(path.join(box, 'config'), { recursive: true })
    fs.writeFileSync(path.join(box, 'config', 'auth.txt'), 'u:p')
    delete require.cache[require.resolve(HEAL)]
    const savedRoot = process.env.LITTLEDJ_ROOT
    const savedPort = process.env.LITTLEDJ_PORT
    process.env.LITTLEDJ_ROOT = box
    process.env.LITTLEDJ_PORT = String(port)
    const fresh = require(HEAL)
    let calls = 0
    fresh.reqJSON('GET', '/_tasks', null, () => { calls += 1 })
    setTimeout(() => {
      ok('①B1 中断连接cb只跑一次(P1-2)', calls === 1, 'calls=' + calls)
      process.env.LITTLEDJ_ROOT = savedRoot
      process.env.LITTLEDJ_PORT = savedPort
      try { fs.rmSync(box, { recursive: true, force: true }) } catch (e) {}
      try { if (broken.closeAllConnections) broken.closeAllConnections(); broken.close() } catch (e) {}
      cb()
    }, 2500)
  })
}

// ---------- ② E2E 假 proxy ----------
const NOW = () => Date.now()
let aborts = []
let msgFetches = []
const sessions = {
  stuck1: { title: '挂死A', msgs: [{ info: { id: 'msg_s1_v1', role: 'assistant', time: { created: NOW() - 30 * MIN } }, parts: [] }] },
  stuck2: { title: '挂死B', msgs: [{ info: { id: 'msg_s2_v1', role: 'assistant', time: { created: NOW() - 20 * MIN } }, parts: [{ type: 'step-start' }] }] },
  stuck3: { title: '挂死C', msgs: [{ info: { id: 'msg_s3_v1', role: 'assistant', time: { created: NOW() - 12 * MIN } }, parts: [] }] },
  userTail: { title: '用户尾', msgs: [{ info: { id: 'msg_u1_v1', role: 'user', time: { created: NOW() - 30 * MIN } }, parts: [{ type: 'text', text: 'hi' }] }] }
}
const realTasks = {
  tasks: Object.keys(sessions).map(id => ({
    id, title: sessions[id].title, state: 'running', lastEventAt: NOW() - 11 * MIN
  })).concat([
    { id: 'idle1', title: '活跃', state: 'running', lastEventAt: NOW() - 1000 },
    { id: 'staleLedger', title: '陈旧台账', state: 'running', lastEventAt: NOW() - 30 * 3600 * 1000 }
  ])
}
function endJson(rs, code, obj) {
  rs.writeHead(code, { 'Content-Type': 'application/json' })
  rs.end(JSON.stringify(obj))
}
function runHeal(box, port, extraEnv) {
  return spawn('node', [HEAL], {
    env: Object.assign({}, process.env, {
      LITTLEDJ_ROOT: box, LITTLEDJ_PORT: String(port),
      AUTOHEAL_STUCK_MIN: '10', AUTOHEAL_MAX_FIX: '2'
    }, extraEnv || {})
  })
}

function testE2E(cb) {
  const fake = http.createServer((rq, rs) => {
    const u = rq.url
    if (u === '/_tasks') return endJson(rs, 200, realTasks)
    if (u === '/api/session/staleLedger/message') { msgFetches.push('staleLedger'); return endJson(rs, 200, sessions.stuck1.msgs) }
    let m = u.match(/^\/api\/session\/([^/]+)\/message$/)
    if (m) {
      const s = sessions[decodeURIComponent(m[1])]
      return s ? endJson(rs, 200, s.msgs) : endJson(rs, 404, { error: 'nope' })
    }
    m = u.match(/^\/api\/session\/([^/]+)\/abort$/)
    if (m) {
      aborts.push(decodeURIComponent(m[1]))
      return endJson(rs, 200, true)
    }
    endJson(rs, 404, {})
  })
  fake.listen(0, '127.0.0.1', () => {
    const port = fake.address().port
    const box = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-autoheal-'))
    fs.mkdirSync(path.join(box, 'config'), { recursive: true })
    fs.mkdirSync(path.join(box, 'run'), { recursive: true })
    fs.writeFileSync(path.join(box, 'config', 'auth.txt'), 'user:pass')

    // 第 1 跑：双采样首命中，零处置
    const c1 = runHeal(box, port)
    let out1 = ''
    c1.stdout.on('data', d => out1 += d); c1.stderr.on('data', d => out1 += d)
    c1.on('exit', code1 => {
      ok('②a-1 首跑零处置(双采样)', code1 === 0 && aborts.length === 0, 'code=' + code1 + ' aborts=' + aborts.length + ' out=' + out1.slice(0, 120))
      let pendOk = false
      try {
        const pend = JSON.parse(fs.readFileSync(path.join(box, 'run', 'autoheal-pending.json'), 'utf8'))
        pendOk = ['stuck1', 'stuck2', 'stuck3'].every(k => pend[k] && pend[k].msgId) && !pend.userTail
      } catch (e) {}
      ok('②a-2 首跑pending记录3挂死', pendOk)
      // 第 2 跑：二次确认处置（MAX_FIX=2 封顶）
      const c2 = runHeal(box, port)
      let out2 = ''
      c2.stdout.on('data', d => out2 += d); c2.stderr.on('data', d => out2 += d)
      c2.on('exit', code2 => {
        ok('②a-3 二跑处置数=MAX_FIX(2)', aborts.length === 2, 'aborts=' + JSON.stringify(aborts))
        ok('②a-4 只处置挂死形态', aborts.every(id => id.startsWith('stuck')), 'aborts=' + JSON.stringify(aborts))
        ok('②a-5 user尾未被碰', !aborts.includes('userTail'))
        ok('②a-6 陈旧台账(30h前)未入候选', !msgFetches.includes('staleLedger') && !aborts.includes('staleLedger'))
        let logOk = false
        try {
          const lines = fs.readFileSync(path.join(box, 'run', 'autoheal-log.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
          logOk = lines.filter(x => x.action === 'abort' && x.ok).length === 2
        } catch (e) {}
        ok('②a-7 审计jsonl两条ok', logOk)
        ok('②a-8 锁文件已清', !fs.existsSync(path.join(box, 'run', 'autoheal-stuck.pid')))
        // ③ 异常态熔断：25 候选 > 20 上限
        realTasks.tasks = Array.from({ length: 25 }, (_, i) => ({ id: 'z' + i, title: 'z', state: 'running', lastEventAt: NOW() - 30 * MIN }))
        aborts = []
        const c3 = runHeal(box, port, { AUTOHEAL_MAX_CANDIDATES: '20' })
        c3.on('exit', code3 => {
          ok('③ 异常态零动手+正常退出', code3 === 0 && aborts.length === 0, 'aborts=' + aborts.length)
          try { fs.rmSync(box, { recursive: true, force: true }) } catch (e) {}
          try { if (fake.closeAllConnections) fake.closeAllConnections(); fake.close() } catch (e) {}
          cb()
        })
      })
    })
  })
}

// 主链：①打表(已同步跑) → ①B 双回调 → ②③E2E → 收尾
testReqJSONOnce(() => {
  testE2E(() => finishAll())
})

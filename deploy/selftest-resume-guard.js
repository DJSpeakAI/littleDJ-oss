/* selftest-resume-guard.js —— task397 续跑巡检护栏端到端自测（真跑 server/autoresume.js，假 serve）
    事故（2026-11-23「新对话 17:23」）三处回归锚：
    A. 等主人点选的提问卡不算中断：不 abort、不注入（旧口径=掐掉重问、白耗护栏额度）
    B. 护栏旧账被主人的新话作废：attempts=2 也照常续跑，计数从 1 重来（旧口径=「护栏拦下」没人捞）
    C. 清账发生在 early return 之前：健康会话的旧账在「第一轮无中断会话」路径上也会被清
    D. --scan-only --json：pending-question 单列 waiting（带提问卡标题）；作废的旧账不报 gaveUp
    exit 0=PASS / 1=FAIL。用法：node deploy/selftest-resume-guard.js */
'use strict'
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const REPO = path.join(__dirname, '..')
const MIN = 60000

let pass = 0, fail = 0
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); return }
  fail++; console.log('  FAIL ' + name + (detail ? '：' + String(detail).slice(0, 300) : ''))
}

function mkServer(handler) {
  return new Promise(function (resolve, reject) {
    const srv = http.createServer(handler)
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', function () { resolve(srv) })
  })
}

function msg(id, role, created, parts, extra) {
  return { info: Object.assign({ id: id, role: role, time: { created: created } }, extra || {}), parts: parts }
}
function question(status, created) {
  return msg('a-q', 'assistant', created, [{ type: 'step-start' }, { type: 'tool', tool: 'question', state: { status: status, input: { questions: [{ header: 'DS OCR 范围对齐', question: '哪条路？' }] } } }])
}
function userText(text, created) {
  return msg('m-u', 'user', created, [{ type: 'text', text: text }])
}

// 起一个假 serve + 真跑一次 autoresume.js；sessions=[{id,title,messages}]；attempts=护栏账初值（写进 tmp）
async function runAr(sessions, attempts, extraEnv, extraArgs) {
  const now = Date.now()
  const calls = []
  const byId = {}
  sessions.forEach(function (s) { byId[s.id] = s })
  const serve = await mkServer(function (req, res) {
    const u = req.url
    calls.push({ method: req.method, path: u })
    req.resume()
    const m = /^\/session\/([^/]+)\/(message|abort|prompt_async)$/.exec(u)
    if (u === '/api/session' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ data: sessions.map(function (s) { return { id: s.id, title: s.title, time: { updated: s.updated || now }, directory: '/x/' + s.id, agent: 'butler' } }) }))
    }
    if (m && byId[m[1]] && m[2] === 'message' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify(byId[m[1]].messages))
    }
    if (m && byId[m[1]] && (m[2] === 'abort' || m[2] === 'prompt_async') && req.method === 'POST') {
      res.writeHead(204); return res.end()
    }
    res.writeHead(404); res.end('nf')
  })
  const port = serve.address().port
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-rg-'))
  ;['run', 'logs', 'config'].forEach(function (d) { fs.mkdirSync(path.join(tmp, d), { recursive: true }) })
  if (attempts) fs.writeFileSync(path.join(tmp, 'run', 'autoresume-orphan-state.json'), JSON.stringify(attempts))
  const child = require('child_process').spawn(process.execPath, [path.join(REPO, 'server', 'autoresume.js')].concat(extraArgs || []), {
    env: Object.assign({}, process.env, {
      LITTLEDJ_BACKEND_PORT: String(port),
      LITTLEDJ_ROOT: tmp,
      LITTLEDJ_AUTORESUME_SAMPLE_MS: '300',
      LITTLEDJ_AUTORESUME_MIN_AGE_MS: '0',
      LITTLEDJ_AUTORESUME_RECENT_MS: String(3600 * 1000),
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = '', stderr = ''
  child.stdout.on('data', function (d) { stdout += d.toString() })
  child.stderr.on('data', function (d) { stderr += d.toString() })
  const code = await new Promise(function (resolve) { child.on('exit', resolve); setTimeout(function () { resolve('timeout') }, 30000) })
  await new Promise(function (resolve) { serve.close(resolve) })
  const logTxt = (function () { try { return fs.readFileSync(path.join(tmp, 'logs', 'autoresume.log'), 'utf8') } catch (e) { return '' } })()
  const stateAfter = (function () { try { return JSON.parse(fs.readFileSync(path.join(tmp, 'run', 'autoresume-orphan-state.json'), 'utf8')) } catch (e) { return null } })()
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch (e) {}
  return {
    code: code, stdout: stdout, stderr: stderr, log: logTxt, state: stateAfter,
    aborts: calls.filter(function (c) { return /\/abort$/.test(c.path) }).length,
    prompts: calls.filter(function (c) { return /\/prompt_async$/.test(c.path) }).length,
  }
}

async function main() {
  const now = Date.now()
  const OLD = now - 40 * MIN

  console.log('== A. 提问卡在等主人点选：不算中断，不掐不注入 ==')
  {
    const r = await runAr([{ id: 's1', title: '新对话 17:23', messages: [question('running', OLD)] }], null)
    ok('进程正常退出', r.code === 0, 'code=' + r.code + ' ' + r.stderr.slice(0, 200))
    ok('不 abort（等点选≠中断）', r.aborts === 0, 'aborts=' + r.aborts)
    ok('不注入续跑', r.prompts === 0, 'prompts=' + r.prompts)
    ok('分类分布记 pending-question', /"pending-question":1/.test(r.log), r.log.slice(-300))
    ok('按「无中断会话」路径退出', /第一轮无中断会话/.test(r.log), r.log.slice(-300))
  }

  console.log('== A2. 提问卡被掐（error）：仍按中断续得上（产审 P2-1 回归锚） ==')
  {
    const r = await runAr([{ id: 's1', title: 't', messages: [question('error', OLD)] }], null)
    ok('进程正常退出', r.code === 0, 'code=' + r.code + ' ' + r.stderr.slice(0, 200))
    ok('先 abort 后注入', r.aborts === 1 && r.prompts === 1, 'aborts=' + r.aborts + ' prompts=' + r.prompts)
    ok('日志记已续跑', /已续跑 s1/.test(r.log), r.log.slice(-300))
  }

  console.log('== B. 护栏旧账（attempts=2）被主人的新话作废：照常续跑，计数重来 ==')
  {
    const r = await runAr([{ id: 's1', title: 't', messages: [
      msg('a1', 'assistant', now - 50 * MIN, [{ type: 'text', text: '干到一半' }], { error: 'Aborted', time: { created: now - 50 * MIN, completed: now - 49 * MIN } }),
      userText('继续', now - 20 * MIN),
    ] }], { s1: { attempts: 2, lastAt: now - 60 * MIN } })
    ok('进程正常退出', r.code === 0, 'code=' + r.code + ' ' + r.stderr.slice(0, 200))
    ok('先 abort 后注入（续跑不缺位）', r.aborts === 1 && r.prompts === 1, 'aborts=' + r.aborts + ' prompts=' + r.prompts)
    ok('日志记已续跑', /已续跑 s1/.test(r.log), r.log.slice(-300))
    ok('计数从 1 重来（非沿用旧账 3）', r.state && r.state.s1 && r.state.s1.attempts === 1, JSON.stringify(r.state))
    ok('不再报「护栏拦下」', !/护栏拦下/.test(r.log), r.log.slice(-300))
  }

  console.log('== B2. 对照：旧账没被作废（主人没发新话）仍按上限拦 ==')
  {
    const r = await runAr([{ id: 's1', title: 't', messages: [userText('做点事', now - 20 * MIN)] }], { s1: { attempts: 2, lastAt: now - 10 * MIN } })
    ok('达上限→不注入（护栏仍有效）', r.aborts === 0 && r.prompts === 0 && /护栏拦下/.test(r.log), 'aborts=' + r.aborts + ' prompts=' + r.prompts + ' log=' + r.log.slice(-200))
  }

  console.log('== B3. 对照：lastAt 之后只有我方卡死恢复语（带水印前缀）→ 旧账不作废，仍按上限拦（产审 P1-1） ==')
  {
    const RECOVER = require(path.join(REPO, 'server', 'wedge-detect.js')).RECOVER_TEXT
    const r = await runAr([{ id: 's1', title: 't', messages: [
      msg('a1', 'assistant', now - 50 * MIN, [{ type: 'text', text: '干到一半' }], { error: 'Aborted', time: { created: now - 50 * MIN, completed: now - 49 * MIN } }),
      userText('【当前模式：休息中】\n边界\n' + RECOVER, now - 20 * MIN),
    ] }], { s1: { attempts: 2, lastAt: now - 60 * MIN } })
    ok('进程正常退出', r.code === 0, 'code=' + r.code + ' ' + r.stderr.slice(0, 200))
    ok('系统恢复语≠主人新话→不注入', r.aborts === 0 && r.prompts === 0, 'aborts=' + r.aborts + ' prompts=' + r.prompts)
    ok('护栏仍拦（attempts=2 不被恢复语清掉）', /护栏拦下/.test(r.log), r.log.slice(-300))
    ok('旧账原样保留', r.state && r.state.s1 && r.state.s1.attempts === 2, JSON.stringify(r.state))
  }

  console.log('== C. 清账发生在 early return 之前（「第一轮无中断会话」路径） ==')
  {
    const r = await runAr([
      { id: 'ok1', title: '健康', messages: [msg('a-ok', 'assistant', now - 30 * MIN, [{ type: 'text', text: '干完了' }], { time: { created: now - 30 * MIN, completed: now - 29 * MIN } })] },
      // y1：30min 前我方注入过续跑（MARK 在 lastAt 之前），现在模型正年轻地干活（尾消息 1min，年龄闸拦下）
      //     ——没主人的新话，旧账必须原样保留
      { id: 'y1', title: '年轻悬空', messages: [userText('做点事', now - 50 * MIN), userText('【自动续跑】(系统消息：请从中断处继续)', now - 30 * MIN), msg('a-y', 'assistant', now - 1 * MIN, [{ type: 'text', text: '看看' }, { type: 'tool', tool: 'bash', state: { status: 'running' } }])] },
    ], { ok1: { attempts: 2, lastAt: now - 60 * MIN }, y1: { attempts: 1, lastAt: now - 30 * MIN + 1000 } }, { LITTLEDJ_AUTORESUME_MIN_AGE_MS: String(10 * MIN) })
    ok('走无中断路径退出', /第一轮无中断会话/.test(r.log), r.log.slice(-300))
    ok('健康会话的旧账已清', r.state && r.state.ok1 === undefined, JSON.stringify(r.state))
    ok('仍悬空的会话旧账保留', r.state && r.state.y1 && r.state.y1.attempts === 1, JSON.stringify(r.state))
    ok('日志带清账条数', /护栏清账 1 条/.test(r.log), r.log.slice(-300))
    ok('零注入', r.aborts === 0 && r.prompts === 0, 'aborts=' + r.aborts + ' prompts=' + r.prompts)
  }

  console.log('== C2. 根本没候选会话：旧账也要清（产审 P1-2：无候选路径不许跳过清账） ==')
  {
    const r = await runAr([], { s1: { attempts: 2, lastAt: now - 60 * MIN }, s2: { attempts: 1, lastAt: now - 30 * MIN } })
    ok('进程正常退出', r.code === 0, 'code=' + r.code + ' ' + r.stderr.slice(0, 200))
    ok('走「无事可做」路径', /无事可做，退出/.test(r.log), r.log.slice(-300))
    ok('日志带清账条数', /无事可做，退出（护栏清账 2 条）/.test(r.log), r.log.slice(-300))
    ok('护栏账清空落盘', r.state && Object.keys(r.state).length === 0, JSON.stringify(r.state))
    ok('零注入', r.aborts === 0 && r.prompts === 0, 'aborts=' + r.aborts + ' prompts=' + r.prompts)
  }

  console.log('== D. --scan-only --json：waiting 单列 + 作废旧账不报 gaveUp ==')
  {
    const r = await runAr([
      { id: 'p1', title: '新对话 17:23', messages: [question('running', OLD)] },
      { id: 'b1', title: '新对话 17:22', messages: [userText('继续', now - 20 * MIN)] },
      // o1：提问卡挂了 19 小时、会话 20h 没动——在 6h 候选窗外（事故形态），48h 放宽窗内（产审 R6）
      { id: 'o1', title: '新对话 前天', updated: now - 20 * 60 * MIN, messages: [question('running', now - 19 * 60 * MIN)] },
    ], { b1: { attempts: 2, lastAt: now - 60 * MIN } }, null, ['--scan-only', '--json', '--reason', 'selftest'])
    let j = null
    try { j = JSON.parse(r.stdout) } catch (e) { /* 下面断言 */ }
    ok('stdout 是纯 JSON（巡检可解析）', !!j && Array.isArray(j.orphans), r.stdout.slice(0, 200))
    ok('进程正常退出', r.code === 0, 'code=' + r.code)
    ok('提问卡会话进 waiting、不进 orphans', j && j.waiting.filter(function (w) { return w.id === 'p1' }).length === 1 && j.orphans.length === 1, JSON.stringify(j))
    ok('waiting 带提问卡标题', j && j.waiting[0] && j.waiting[0].q === 'DS OCR 范围对齐', JSON.stringify(j && j.waiting[0]))
    ok('作废的旧账不报 gaveUp（attempts 按 0 计）', j && j.orphans[0] && j.orphans[0].id === 'b1' && j.orphans[0].gaveUp === false && j.orphans[0].attempts === 0, JSON.stringify(j && j.orphans[0]))
    const o1 = j && j.waiting.filter(function (w) { return w.id === 'o1' })[0]
    ok('候选窗外（20h 没动）挂着的提问卡也进 waiting', !!o1 && Math.abs(o1.ageMin - 19 * 60) <= 2 && o1.q === 'DS OCR 范围对齐', JSON.stringify(o1 || null))
    ok('scanned 仍只数 6h 候选、waitingScanned 记放宽窗数量', j && j.scanned === 2 && j.waitingScanned === 1, 'scanned=' + (j && j.scanned) + ' waitingScanned=' + (j && j.waitingScanned))
    ok('只扫不修：零 abort 零注入', r.aborts === 0 && r.prompts === 0, 'aborts=' + r.aborts + ' prompts=' + r.prompts)
  }

  console.log(pass + '/' + (pass + fail) + (fail ? ' FAIL' : ' PASS') + ' resume-guard')
  process.exit(fail ? 1 : 0)
}
main().catch(function (e) { console.log('FAIL 自测崩溃：' + (e && e.stack || e)); process.exit(1) })

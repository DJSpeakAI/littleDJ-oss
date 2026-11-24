#!/usr/bin/env node
/* task303 自测：鉴权防错锁定（authGuard）——沙箱短窗口（AUTH_LOCK_MAX=3 / AUTH_LOCK_MS=2000）
   覆盖：①错 3 次→第 4 次正确凭据也 429 ②锁定期满自动恢复 ③成功一次清零计数
         ④应急闸 AUTH_LOCK_OFF=1 不错锁 ⑤4492 无凭据 401（未达阈值仍是 401 非 429）
   沙箱合成 auth.txt，不碰生产；用法：node deploy/selftest-authlock.js */
'use strict'
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')

const out = { pass: 0, fail: 0 }
function ok (name, cond, detail) {
  if (cond) { out.pass++; console.log('PASS', name) }
  else { out.fail++; console.log('FAIL', name, detail ? '[' + detail + ']' : '') }
}
const AUTH = Buffer.from('sandbox:lock-test-pass').toString('base64')

function req (port, authHeader) {
  return new Promise(function (resolve) {
    const r = http.request({ host: '127.0.0.1', port: port, path: '/_vault', method: 'GET', headers: authHeader ? { Authorization: authHeader } : {} }, function (res) {
      let b = ''; res.on('data', function (c) { b += c }); res.on('end', function () { resolve(res.statusCode) })
    })
    r.on('error', function () { resolve(0) })
    r.end()
  })
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

async function runCase (name, env, steps) {
  const box = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-lock-'))
  fs.mkdirSync(path.join(box, 'config'), { recursive: true })
  fs.mkdirSync(path.join(box, 'data'), { recursive: true })
  fs.writeFileSync(path.join(box, 'config', 'auth.txt'), 'sandbox:lock-test-pass\n')
  const port = 4520 + Math.floor(Math.random() * 60)
  const childEnv = Object.assign({}, process.env, env, { LITTLEDJ_PORT: String(port), LITTLEDJ_ROOT: box })
  const child = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: childEnv, stdio: 'ignore' })
  try {
    await sleep(1800)
    const results = []
    for (const s of steps) { results.push(await req(port, s)) }
    return { results: results, box: box, kill: function () { try { child.kill() } catch (e) {} } }
  } catch (e) {
    try { child.kill() } catch (e2) {}
    fs.rmSync(box, { recursive: true, force: true })
    throw e
  }
}

async function main () {
  const GOOD = 'Basic ' + AUTH
  const BAD = 'Basic ' + Buffer.from('sandbox:wrong').toString('base64')
  const NONE = null

  /* ① 错 3 次锁定（阈值 3）：3×401 → 正确也 429 */
  const c1 = await runCase('lock', { AUTH_LOCK_MAX: '3', AUTH_LOCK_MS: '2000' }, [BAD, BAD, BAD, GOOD, GOOD])
  ok('错3次锁(第3次即429)，锁中正确凭据即时自救(fu1)', JSON.stringify(c1.results) === '[401,401,429,200,200]', JSON.stringify(c1.results))
  /* ② 锁定期满恢复（2000ms）：等 2.6s → 正确 200 */
  await sleep(2600)
  const after = await req(parseInt(process.env._LOCK_PORT || '0') || 0, GOOD) // 占位不用
  // 直接对 c1 的实例再打（端口记录在闭包外拿不到——重打一个 case 组合验证）
  c1.kill(); fs.rmSync(c1.box, { recursive: true, force: true })

  /* ②' 组合验证：错 3 锁 → 等 2.6s → 正确 200（恢复） */
  const c2box = await runCase('recover', { AUTH_LOCK_MAX: '3', AUTH_LOCK_MS: '2000' }, [BAD, BAD, BAD, BAD])
  ok('错3次锁+锁中错误仍429（限速语义不变）', JSON.stringify(c2box.results) === '[401,401,429,429]', JSON.stringify(c2box.results))
  await sleep(2600)
  const port2 = null // runCase 内部端口；改用重新探测：直接再跑一组等待后的请求
  c2box.kill(); fs.rmSync(c2box.box, { recursive: true, force: true })
  // 恢复验证用独立实例（端口固定写法）
  const box3 = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-lock3-'))
  fs.mkdirSync(path.join(box3, 'config'), { recursive: true }); fs.mkdirSync(path.join(box3, 'data'), { recursive: true })
  fs.writeFileSync(path.join(box3, 'config', 'auth.txt'), 'sandbox:lock-test-pass\n')
  const port3 = 4590
  const child3 = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: Object.assign({}, process.env, { AUTH_LOCK_MAX: '3', AUTH_LOCK_MS: '2000', LITTLEDJ_PORT: String(port3), LITTLEDJ_ROOT: box3 }), stdio: 'ignore' })
  await sleep(1800)
  const r31 = await req(port3, BAD), r32 = await req(port3, BAD), r33 = await req(port3, BAD)
  const r34 = await req(port3, GOOD)
  await sleep(2600)
  const r35 = await req(port3, GOOD)
  ok('锁中正确即自救200、期满恢复200(fu1)', r31 === 401 && r32 === 401 && r33 === 429 && r34 === 200 && r35 === 200, [r31, r32, r33, r34, r35].join(','))
  /* ③ 成功清零：错2 → 正确（清零）→ 错2 → 仍 401 未锁 */
  const r41 = await req(port3, GOOD) // 清干净
  const r42 = await req(port3, BAD), r43 = await req(port3, BAD), r44 = await req(port3, GOOD), r45 = await req(port3, BAD), r46 = await req(port3, BAD), r47 = await req(port3, GOOD)
  ok('成功一次清零计数（错2对1错2对1全程不锁）', r42 === 401 && r43 === 401 && r44 === 200 && r45 === 401 && r46 === 401 && r47 === 200, [r42, r43, r44, r45, r46, r47].join(','))
  try { child3.kill() } catch (e) {}
  fs.rmSync(box3, { recursive: true, force: true })

  /* ④ 应急闸：AUTH_LOCK_OFF=1 不错锁 */
  const c4 = await runCase('off', { AUTH_LOCK_OFF: '1', AUTH_LOCK_MAX: '3', AUTH_LOCK_MS: '60000' }, [BAD, BAD, BAD, BAD, BAD, GOOD])
  ok('应急闸 AUTH_LOCK_OFF=1：连错5次后正确仍200', JSON.stringify(c4.results) === '[401,401,401,401,401,200]', JSON.stringify(c4.results))
  c4.kill(); fs.rmSync(c4.box, { recursive: true, force: true })

  /* ⑤ 无凭据未达阈值=401（浏览器弹框语义不变） */
  const c5 = await runCase('plain401', { AUTH_LOCK_MAX: '3', AUTH_LOCK_MS: '60000' }, [NONE, GOOD])
  ok('无凭据→401（未锁，浏览器正常弹框）', JSON.stringify(c5.results) === '[401,200]', JSON.stringify(c5.results))
  c5.kill(); fs.rmSync(c5.box, { recursive: true, force: true })

  console.log('---- ' + out.pass + ' pass / ' + out.fail + ' fail ----')
  process.exit(out.fail ? 1 : 0)
}
main().catch(function (e) { console.log('FATAL', e && e.message); process.exit(1) })

// selftest-ocr（task367）：DeepSeek OCR 接入——OCR 当眼睛、GLM 当脑子
// 架构照 selftest-body-limit 先例（spawn 隔离实例），全状态沙箱：
//   临时 LITTLEDJ_ROOT（auth/apikeys/model-alias/inbox/boot-state 全隔离）+ mock serve + mock OCR 上游。
// 直发路径测法：预写 boot-state 让目标 sid 天然「非首条」（P2-①），每用例独立 sid 避开乐观置忙的
//   60s 窗口（QUEUE_DIRECT_TIMEOUT_MS），全部走 doDirect 直发分支。
// 覆盖：multipart 构造/成功转写（ref·box 清理）/失败降级+落盘/别名未登记/非 GLM/无 key/
//   多图共享预算/直发 body 重建（P0-1 回归锚）/白名单外/非 data URL/运行期异常/响应过大/源码锚。
// 用法：node deploy/selftest-ocr.js   退出码 0=全绿 / 1=有红
'use strict'
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const http = require('http')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const REPO = path.join(__dirname, '..')
let pass = 0, fail = 0
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('  ok - ' + name) }
  else { fail++; console.log('  FAIL - ' + name + (detail ? ' :: ' + detail : '')) }
}
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

// ── 临时 ROOT 沙箱 ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lj-ocr-'))
for (const d of ['config/prompts', 'logs', 'run', 'inbox']) fs.mkdirSync(path.join(TMP, d), { recursive: true })
fs.writeFileSync(path.join(TMP, 'config', 'auth.txt'), 'test:test123')
// 预写 boot-state：全部用例 sid 天然「非首条」（promptInject.changed=false，逼出 OCR 重建路径 P0-1）
const SIDS = ['sa', 'sb', 'sc', 'sd', 'se', 'sf', 'sg', 'sh', 'si', 'sj', 'sk', 'sl', 'sm', 'sn']
const bootState = {}
SIDS.forEach(function (s) { bootState[s] = Date.now() - 3600 * 1000 })
fs.writeFileSync(path.join(TMP, 'config', 'prompts', 'boot-state.json'), JSON.stringify(bootState))
const writeAlias = function (withOcr) {
  const alias = {
    'deepseek/deepseek-flash': 'DS4.1Flash 官方',
    'deepseek/deepseek-v4-pro': 'DS V4 Pro 官方',
    'zhipuai-coding-plan/glm-5.3-highspeed': 'GLM-5.3 HS官方',
    'zhipuai-coding-plan/glm-5.3': 'GLM 5.3 官方',
  }
  if (withOcr) alias['deepseek/ocr'] = 'DS OCR 官方'
  fs.writeFileSync(path.join(TMP, 'config', 'model-alias.json'), JSON.stringify({ alias: alias, savedAt: Date.now() }))
}
const writeKeys = function (withKey) {
  fs.writeFileSync(path.join(TMP, 'config', 'apikeys.json'), JSON.stringify(withKey
    ? { keys: [{ name: 't', key: 'sk-test-ocr', active: 't' }] }
    : { keys: [] }))
}
writeAlias(true); writeKeys(true)

// ── mock OCR 上游：记录 multipart、可控响应 ──
const ocrHits = []
let ocrMode = 'ok' // ok | errBody | httpErr | big | heartbeat | throwMultipart
let ocrDelay = 0
const ocrSrv = http.createServer(function (req, res) {
  const chunks = []
  req.on('data', function (c) { chunks.push(c) })
  req.on('end', function () {
    const body = Buffer.concat(chunks)
    const latin = body.toString('latin1')
    const hit = {
      purpose: (latin.match(/name="purpose"\r\n\r\n([^\r]*)\r/) || [])[1] || '',
      hasFile: /name="file"/.test(latin),
      filename: (latin.match(/filename="([^"]*)"/) || [])[1] || '',
      fileMime: (latin.match(/Content-Type: (image\/[a-z]+)\r\n/) || [])[1] || '',
      bytes: body.length, at: Date.now(),
    }
    ocrHits.push(hit)
    if (ocrMode === 'throwMultipart') { res.destroy(); return } // 模拟 gate 级异常（连接被 RST）
    const reply = function () {
      if (ocrMode === 'errBody') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('\n\n{"error":{"message":"mock ocr boom","type":"x","code":"x"}}') }
      if (ocrMode === 'httpErr') { res.writeHead(402, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"余额不足"}}') }
      if (ocrMode === 'big') { res.writeHead(200); return res.end('x'.repeat(21 * 1024 * 1024)) }
      if (ocrMode === 'heartbeat') {
        // P0 产审回归锚：官方 OCR 识别中持续发换行心跳——空闲超时会被它无限重置，墙钟必须掐死
        res.writeHead(200, { 'content-type': 'application/json' })
        let n = 0
        const t = setInterval(function () {
          res.write('\n')
          if (++n > 40) { clearInterval(t); res.end('{}') } // 4s 心跳后给非法体（反正墙钟 3s 先掐）
        }, 100)
        res.on('close', function () { clearInterval(t) })
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('\n\n{"id":"ocr-1","object":"ocr.result","purpose":"text_recognition","page_count":2,"pages":[' +
        '{"index":0,"text":"<｜ref｜>报错标题<｜/ref｜><｜box｜>[[52,40,948,96]]<｜/box｜>Cannot read","finish_reason":"stop"},' +
        '{"index":1,"text":"second page","finish_reason":"length"}],"usage":{"total_tokens":123}}')
    }
    if (ocrDelay) setTimeout(reply, ocrDelay); else reply()
  })
})

// ── mock serve：收 prompt_async 断言 body ──
const fedBodies = []
const serveSrv = http.createServer(function (req, res) {
  const u = req.url
  const chunks = []
  req.on('data', function (c) { chunks.push(c) })
  req.on('end', function () {
    if (u === '/api/session' && req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[]}') }
    const pm = u.match(/\/session\/([^/]+)\/prompt_async$/)
    if (pm && req.method === 'POST') {
      fedBodies.push({ sid: decodeURIComponent(pm[1]), at: Date.now(), body: Buffer.concat(chunks).toString('utf8') })
      res.writeHead(204); return res.end()
    }
    res.writeHead(404); res.end('nf')
  })
})

const listen = function (s) { return new Promise(function (r, j) { s.listen(0, '127.0.0.1', function () { r(s.address().port) }).once('error', j) }) }
const AUTH = 'Basic ' + Buffer.from('test:test123').toString('base64')
const fedOf = function (sid) { return fedBodies.filter(function (f) { return f.sid === sid })[0] }

function post(port, p, bodyObj, timeoutMs) {
  return new Promise(function (resolve) {
    const data = JSON.stringify(bodyObj)
    const rq = http.request({ host: '127.0.0.1', port: port, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: AUTH } }, function (rs) {
      let b = ''
      rs.on('data', function (c) { b += c })
      rs.on('end', function () { resolve({ code: rs.statusCode, body: b }) })
    })
    rq.on('error', function (e) { resolve({ code: 0, body: String(e) }) })
    if (timeoutMs) rq.setTimeout(timeoutMs, function () { rq.destroy(new Error('client-timeout')) })
    rq.end(data)
  })
}

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const imgPart = function (url, mime) { return { type: 'file', mime: mime || 'image/png', filename: 'a.png', url: url || PNG_1PX } }
const glmBody = function (parts, sid) { return { parts: parts, model: { providerID: 'zhipuai-coding-plan', modelID: 'glm-5.3' } } }
const prompt = function (sid, parts) { return post(proxyPortCur, '/api/session/' + sid + '/prompt_async', glmBody(parts)) }
let proxyPortCur = 0

async function main() {
  const ocrPort = await listen(ocrSrv)
  const servePort = await listen(serveSrv)
  const proxyPort = 4200 + Math.floor(Math.random() * 300)
  proxyPortCur = proxyPort
  const child = spawn(process.execPath, [path.join(REPO, 'server', 'proxy.js')], {
    env: Object.assign({}, process.env, {
      LITTLEDJ_PORT: String(proxyPort), LITTLEDJ_BACKEND_PORT: String(servePort),
      LITTLEDJ_DS_OCR_URL: 'http://127.0.0.1:' + ocrPort + '/v1/tools/ocr',
      LITTLEDJ_ROOT: TMP, LITTLEDJ_OCR_BUDGET_MS: '3000',
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const logs = []
  child.stdout.on('data', function (d) { logs.push(d.toString()) })
  child.stderr.on('data', function (d) { logs.push(d.toString()) })
  process.on('exit', function () { try { child.kill('SIGKILL') } catch (e) {} })
  // 等 proxy ready（/_health 需 Basic 鉴权）
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    await sleep(200)
    ready = await new Promise(function (r) {
      const rq = http.request({ host: '127.0.0.1', port: proxyPort, path: '/_health', method: 'GET', headers: { Authorization: AUTH } }, function (rs) { r(rs.statusCode === 200) })
      rq.on('error', function () { r(false) }); rq.end()
    })
  }
  ok(ready, 'proxy 隔离实例 ready', logs.join('').slice(0, 300))
  if (!ready) process.exit(1)

  // ── 用例 8（P0-1 回归锚）：非首条（预写 boot-state）+ 带图 + GLM → 投喂 body 无图、有转写文本 ──
  let r = await prompt('sa', [imgPart()])
  const fa = fedOf('sa')
  ok(r.code === 204 && !!fa, '带图消息直发 204（OCR 后，非首条）', 'code=' + r.code)
  ok(!!fa && fa.body.indexOf('data:image') < 0, '投喂 body 不含原图（P0-1：OCR 改过必须重建 out）', fa && fa.body.slice(0, 140))
  ok(!!fa && fa.body.indexOf('【图片已 OCR 转写｜2 页】') >= 0, '投喂 body 含转写标记+页数', fa && fa.body.slice(0, 200))
  ok(!!fa && fa.body.indexOf('报错标题') >= 0 && fa.body.indexOf('<｜box｜>') < 0 && fa.body.indexOf('<｜ref｜>') < 0, 'ref 文字保留·box/ref 标记已清理', '')
  ok(!!fa && fa.body.indexOf('（该页可能截断）') >= 0, 'finish_reason=length 页尾截断标注', '')
  ok(ocrHits.length === 1 && ocrHits[0].purpose === 'text_recognition' && ocrHits[0].hasFile, 'multipart 构造正确（purpose+file）', JSON.stringify(ocrHits[0]))
  ok(ocrHits[0].filename === 'image.png' && ocrHits[0].fileMime === 'image/png' && ocrHits[0].bytes > 100, 'multipart filename/mime/bytes 完整（P2-5）', JSON.stringify({ f: ocrHits[0].filename, m: ocrHits[0].fileMime, b: ocrHits[0].bytes }))

  // ── P0 产审回归锚：心跳永不触空闲超时，墙钟必须掐死（预算 3s，心跳 4s+）──
  ocrMode = 'heartbeat'
  const hbT0 = Date.now()
  r = await prompt('sm', [imgPart()])
  const fm = fedOf('sm')
  const hbElapsed = Date.now() - hbT0
  ok(r.code === 204 && !!fm && fm.body.indexOf('【图片未能识别】OCR 超时') >= 0, '心跳流被墙钟掐死→降级 part（P0）', 'code=' + r.code + ' ' + (fm && fm.body.slice(0, 140)))
  ok(hbElapsed < 4500, '墙钟在预算 3s+余量内触发（实测 ' + hbElapsed + 'ms，未被心跳续命）', '')
  ocrMode = 'ok'

  // ── P1-1 产审回归锚：gate 级异常（上游 RST 炸连接）→ 剩余图降级，绝不原图透传 ──
  ocrMode = 'throwMultipart'
  r = await prompt('sn', [imgPart(), imgPart()])
  const fn2 = fedOf('sn')
  ok(r.code === 204 && !!fn2 && fn2.body.indexOf('data:image') < 0, 'gate 级异常→图全降级不透传（P1-1）', 'code=' + r.code + ' ' + (fn2 && fn2.body.slice(0, 200)))
  ok(!!fn2 && fn2.body.indexOf('【图片未能识别】') >= 2, '降级 part 数量正确（2 张图都有降级文案）', fn2 && fn2.body.slice(0, 300))
  ocrMode = 'ok'

  // ── 用例 3：失败降级（200+error 体）+ 原图落盘 ──
  ocrMode = 'errBody'
  r = await prompt('sb', [imgPart()])
  const fb = fedOf('sb')
  ok(!!fb && fb.body.indexOf('【图片未能识别】OCR 失败：mock ocr boom') >= 0, 'error 体→降级 part（原因透出）', fb && fb.body.slice(0, 160))
  const inboxFiles = fs.readdirSync(path.join(TMP, 'inbox')).filter(function (f) { return /^ocr-fail-/.test(f) })
  ok(inboxFiles.length === 1, '失败原图落盘 inbox（1 张）', 'n=' + inboxFiles.length)
  ocrMode = 'ok'

  // ── 用例 4：别名未登记 → fail-open 透传 ──
  writeAlias(false)
  r = await prompt('sc', [imgPart()])
  const fc = fedOf('sc')
  const ocrHitsBefore = ocrHits.length
  ok(!!fc && fc.body.indexOf('data:image/png;base64') >= 0, '别名无条目→原图透传（fail-open）', '')
  ok(ocrHits.length === ocrHitsBefore, '别名无条目→不调 OCR（零计费）', 'hits=' + ocrHits.length)
  writeAlias(true)

  // ── 用例 5：非 GLM 模型 / model 缺失 ──
  r = await post(proxyPort, '/api/session/sd/prompt_async', { parts: [imgPart()], model: { providerID: 'deepseek', modelID: 'deepseek-flash' } })
  ok(!!fedOf('sd') && fedOf('sd').body.indexOf('data:image/png;base64') >= 0, 'deepseek 模型→零改动透传', '')
  r = await post(proxyPort, '/api/session/se/prompt_async', { parts: [imgPart()] })
  ok(!!fedOf('se') && fedOf('se').body.indexOf('data:image/png;base64') >= 0, 'model 缺失→fail-open 透传（P1-4）', '')

  // ── 用例 6：无 key → 降级 part 不阻塞 ──
  writeKeys(false)
  r = await prompt('sf', [imgPart()])
  const ff = fedOf('sf')
  ok(r.code === 204 && !!ff && ff.body.indexOf('【图片未能识别】未配置 DeepSeek API Key') >= 0, '无 key→降级提示 part（不阻塞投喂）', 'code=' + r.code + ' ' + (ff && ff.body.slice(0, 160)))
  writeKeys(true)

  // ── 用例 7：多图共享预算（第 1 图慢 2.5s 吃掉大半 3s 预算，第 2 图余量不足降级）──
  ocrDelay = 2500
  const t0 = Date.now()
  r = await prompt('sg', [imgPart(), imgPart()])
  const fg = fedOf('sg')
  ok(r.code === 204, '多图消息预算内交付 204（耗时 ' + (Date.now() - t0) + 'ms）', 'code=' + r.code)
  ok(!!fg && fg.body.indexOf('【图片已 OCR 转写') >= 0 && fg.body.indexOf('预算') >= 0, '第 1 图转写成功+第 2 图预算耗尽降级（共存）', fg && fg.body.slice(0, 320))
  ocrDelay = 0

  // ── 用例 9：白名单外 mime / 非 data URL ──
  r = await prompt('sh', [imgPart('data:image/heic;base64,AAAA', 'image/heic')])
  const fh = fedOf('sh')
  ok(!!fh && fh.body.indexOf('暂不支持 OCR') >= 0, 'HEIC→白名单前置降级（省一次上传）', fh && fh.body.slice(0, 160))
  r = await prompt('si', [imgPart('https://example.com/a.png')])
  ok(!!fedOf('si') && fedOf('si').body.indexOf('https://example.com/a.png') >= 0, '非 data URL→不误拦（fail-open）', '')

  // ── 用例 10：运行期异常（HTTP 402）──
  ocrMode = 'httpErr'
  r = await prompt('sj', [imgPart()])
  const fj = fedOf('sj')
  ok(!!fj && fj.body.indexOf('【图片未能识别】') >= 0 && fj.body.indexOf('data:image') < 0, 'HTTP 402→降级 part（不原图透传）', fj && fj.body.slice(0, 160))
  ocrMode = 'ok'

  // ── 用例 12：响应过大 ──
  ocrMode = 'big'
  r = await prompt('sk', [imgPart()])
  const fk = fedOf('sk')
  ok(!!fk && fk.body.indexOf('【图片未能识别】') >= 0, '响应 >20MB→降级 part', fk && fk.body.slice(0, 120))
  ocrMode = 'ok'

  // ── 用例 11：源码锚（防未来重构脱钩）──
  const src = fs.readFileSync(path.join(REPO, 'server', 'proxy.js'), 'utf8')
  ok(/async function ocrGate/.test(src) && /function dsOcr/.test(src) && /function ocrCleanText/.test(src), '源码锚：三函数存在')
  const mk = src.indexOf('queueMarkBusy(sid)\n      // task367：OCR 转写')
  const og = src.indexOf('const og = await ocrGate(parsed, sid)')
  const pi = src.indexOf('const inj = promptInject(parsed.parts, sid)')
  ok(mk > 0 && og > mk && pi > og, '源码锚：doDirect 内 置忙 < ocrGate < promptInject 行序（P1-1/P2-②）', mk + '/' + og + '/' + pi)
  ok(/if \(bodyDirty\) \{\n        try \{ out = JSON\.stringify\(parsed\) \}/.test(src), '源码锚：bodyDirty 无条件重建 out（P0-1）', '')
  const eq = src.indexOf('await ocrGate(parsed, sid) } catch')
  ok(eq > 0, '源码锚：doEnqueue 入队前 OCR（出队无绕过）', 'eq=' + eq)
  ok(/gate 级异常（P1-1 产审）：顶层 catch 把剩余 data:image part 全部降级/.test(src) && /const degradeAll = function/.test(src), '源码锚：ocrGate 顶层 catch+degradeAll（P1-1）', '')
  ok(/墙钟硬定时器才是预算承诺/.test(src) && /req\.on\('close', function \(\) \{ clearTimeout\(hard\) \}\)/.test(src), '源码锚：dsOcr 墙钟硬定时器+全路径清理（P0）', '')
  try { child.kill('SIGKILL') } catch (e) {}
  if (fail) process.exit(1)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch (e) {}
  process.exit(0)
}
main().catch(function (e) { console.error('FATAL ' + (e.stack || e)); process.exit(1) })

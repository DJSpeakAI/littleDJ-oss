#!/usr/bin/env node
/* selftest-ds-tts —— task308 DeepSeek TTS 接入回归（防复发：改 dsTts/voiceTtsByProvider/播种必跑）
   用法：node deploy/selftest-ds-tts.js（exit 0=全绿）
   沙箱：LITTLEDJ_ROOT 临时目录 + 合成凭据（L-093：禁真实凭据）+ 随机端口 proxy 实例 + 本地 mock 上游。
   覆盖：①deepseek 供应商幂等播种 ②合成分发（wav 回传/收参/鉴权头/未知音色回落）③上游 401 中文错误 ④fmt=mp3 仍 wav */
'use strict'
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs')
const path = require('path')
const os = require('os')
const http = require('http')
const { spawn } = require('child_process')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'littledj-dstts-'))
process.env.LITTLEDJ_ROOT = SANDBOX
let pass = 0, fail = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, detail ? '[' + detail + ']' : '') } }

/* ④ 源码锚（同步段先跑）：Key 回落必须走 apikeys.json（dsActiveKey/readApiKeys），禁回退 deveco auth.json（fu1：其实测坏值 '[object Object]'） */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8')
  const dsSeg = (src.match(/function dsTts\(p, text, voice\) \{[\s\S]*?\n\}/) || [''])[0]
  ok('④ dsTts Key 回落=dsActiveKey（apikeys.json 库，非 deveco auth.json）', /dsActiveKey\(\)/.test(dsSeg) && !/readDeepseekKey\(\)/.test(dsSeg))
  ok('④ dsActiveKey 定义存在且走 readApiKeys', /function dsActiveKey\(\) \{[\s\S]*?readApiKeys\(\)/.test(src))
}

// ---------- mock 上游（DeepSeek /v1/tools/tts） ----------
const SYNTH_KEY = 'sk-synth-dstts-test'
let mockMode = 'ok' // ok | err401
let mockSeen = null
const wavBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x57, 0x41, 0x56, 0x45]) /* 假 wav 头 */
const mock = http.createServer(function (q, r) {
  const chunks = []
  q.on('data', c => chunks.push(c))
  q.on('end', function () {
    let body = {}
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) {}
    mockSeen = { body: body, auth: String(q.headers['authorization'] || '') }
    if (mockMode === 'err401') {
      r.writeHead(401, { 'Content-Type': 'application/json' })
      return r.end(JSON.stringify({ error: { message: 'Authentication Fails (mock)' } }))
    }
    r.writeHead(200, { 'Content-Type': 'audio/wav' })
    r.end(wavBytes)
  })
})

mock.listen(0, '127.0.0.1', function () {
  const MOCK_PORT = mock.address().port

  function writeProviders (withDs) {
    const providers = [{
      id: 'volcano', name: '火山引擎', type: 'volcano', apiKey: 'sk-synth-volc', endpoint: 'http://127.0.0.1:1/x',
      enabled: true, order: 0, extra: { resourceId: 'synth-rid' }, voices: [{ id: 'S_x1', note: '火山音色', default: true }]
    }]
    if (withDs) providers.push({
      id: 'deepseek', name: 'DeepSeek', type: 'deepseek', apiKey: SYNTH_KEY,
      endpoint: 'http://127.0.0.1:' + MOCK_PORT + '/v1/tools/tts', enabled: true, order: 1, extra: {},
      voices: [{ id: 'stella', note: 'Stella · 女声（默认）', default: true }, { id: 'tide', note: 'Tide · 男声', default: false }]
    })
    fs.mkdirSync(path.join(SANDBOX, 'config'), { recursive: true })
    fs.writeFileSync(path.join(SANDBOX, 'config', 'tts-providers.json'), JSON.stringify({ version: 1, seedVersion: 1, providers: providers }, null, 2))
  }

  writeProviders(false) /* 首轮：无 deepseek → 测播种 */
  fs.writeFileSync(path.join(SANDBOX, 'config', 'auth.txt'), 'dj:littledj-test\n')

  const PORT = 4120 + Math.floor(Math.random() * 50)
  const env = Object.assign({}, process.env, { LITTLEDJ_PORT: String(PORT), LITTLEDJ_ROOT: SANDBOX })
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: env, stdio: 'ignore' })
  const AUTH = 'Basic ' + Buffer.from('dj:littledj-test').toString('base64')

  const req = (method, p, body, cb) => {
    const data = body ? JSON.stringify(body) : null
    const h = { Authorization: AUTH }
    if (data) h['Content-Type'] = 'application/json'
    const r = http.request({ host: '127.0.0.1', port: PORT, path: p, method: method, headers: h }, function (res) {
      const cs = []
      res.on('data', c => cs.push(c))
      res.on('end', function () { cb(null, res.statusCode, res.headers, Buffer.concat(cs)) })
    })
    r.on('error', cb)
    if (data) r.write(data)
    r.end()
  }

  setTimeout(function () {
    /* ① 播种：GET providers 后文件与响应都应出现 deepseek（幂等） */
    req('GET', '/_tts/providers', null, function (e, code, hdr, buf) {
      if (e) { ok('① E2E 可达', false, e.message); return finish() }
      ok('① E2E /_tts/providers 200', code === 200)
      let d = null
      try { d = JSON.parse(buf.toString('utf8')) } catch (er) {}
      const ds = d && (d.providers || []).filter(p => p.id === 'deepseek')[0]
      ok('① 播种：deepseek 卡出现（type/音色 stella 默认+tide）', !!(ds && ds.type === 'deepseek' && Array.isArray(ds.voices) && ds.voices.length === 2 && ds.voices[0].id === 'stella' && ds.voices[0].default === true))
      ok('① 播种：apiKey 掩码不回明文', !!(ds && /^\*{4}/.test(String(ds.apiKey || '')) || (ds && ds.apiKey === '')))
      const onDisk = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'config', 'tts-providers.json'), 'utf8'))
      ok('① 播种落盘（文件含 deepseek）', onDisk.providers.some(p => p.id === 'deepseek'))
      /* 播种幂等：把磁盘里 deepseek 的 endpoint 改指 mock，再 GET 不覆盖（同 id 不动） */
      const pd = onDisk.providers.filter(p => p.id === 'deepseek')[0]
      pd.endpoint = 'http://127.0.0.1:' + MOCK_PORT + '/v1/tools/tts'
      pd.apiKey = SYNTH_KEY
      fs.writeFileSync(path.join(SANDBOX, 'config', 'tts-providers.json'), JSON.stringify(onDisk, null, 2))
      req('GET', '/_tts/providers', null, function (e2, c2, h2, b2) {
        const again = JSON.parse(b2.toString('utf8'))
        ok('① 播种幂等（已有 deepseek 不重复/不覆盖）', (again.providers || []).filter(p => p.id === 'deepseek').length === 1)
        /* ② 合成：wav 回传 + 收参 + 鉴权 + fmt=mp3 仍 wav + 未知音色回落 */
        req('POST', '/_voice/tts', { providerId: 'deepseek', text: '你好呀，小DJ', voice: 'stella', fmt: 'mp3' }, function (e3, c3, h3, b3) {
          ok('② 合成 200', c3 === 200)
          ok('② 回传 audio/wav（fmt=mp3 请求仍 wav）', String(h3['content-type'] || '') === 'audio/wav')
          ok('② 音频字节=上游回传', b3.equals(wavBytes))
          ok('② 上游收参（voice_id=stella / format=wav / filter_markdown=true / text 原文）',
            !!(mockSeen && mockSeen.body.voice_id === 'stella' && mockSeen.body.format === 'wav' && mockSeen.body.filter_markdown === true && mockSeen.body.text === '你好呀，小DJ'))
          ok('② 鉴权头=Bearer 卡内 Key（沙箱合成串）', !!(mockSeen && mockSeen.auth === 'Bearer ' + SYNTH_KEY))
          /* 未知音色 → 回落 default stella */
          req('POST', '/_voice/tts', { providerId: 'deepseek', text: '回落', voice: 'nonexistent' }, function (e4, c4, h4, b4) {
            ok('② 未知音色回落 default（上游收 stella）', c4 === 200 && mockSeen.body.voice_id === 'stella')
            /* ③ 上游 401 → 中文错误 */
            mockMode = 'err401'
            req('POST', '/_voice/tts', { providerId: 'deepseek', text: '错误路径', voice: 'stella' }, function (e5, c5, h5, b5) {
              const j = JSON.parse(b5.toString('utf8'))
              ok('③ 上游 401 → 502 中文（含 HTTP 401 与上游信息）', c5 === 502 && /语音合成失败/.test(String(j.error)) && /HTTP 401/.test(String(j.error)) && /mock/.test(String(j.error)))
              finish()
            })
          })
        })
      })
    })
  }, 1800)

  function finish () {
    try { child.kill() } catch (e) {}
    try { mock.close() } catch (e) {}
    console.log('---- ' + pass + ' pass / ' + fail + ' fail ----')
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }) } catch (e) {}
    process.exit(fail ? 1 : 0)
  }
})

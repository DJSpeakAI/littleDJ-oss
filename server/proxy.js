const http = require('http')
const https = require('https')
const net = require('net')
const fs = require('fs')
const path = require('path')
const os = require('os')
const zlib = require('zlib')
const { spawn } = require('child_process')
const { URL } = require('url')
const { Writable } = require('stream')
// task393：技能按需注入（提示词技能 config/prompts/skills/*.md，勿与 server/skills 定时任务框架混淆）
const skillInject = require('./skill-inject')
const crypto = require('crypto')

// task194：定时任务 skill 框架（模型比价=第 1 个 skill）
// 调度器 interval.unref，进程退出自动收口；配置/日志落 <运行根> 运行根（git 外）
const skillsScheduler = require('./skills/scheduler')
const skillsModelPricing = require('./skills/model-pricing')
skillsModelPricing.migrateConfig() /* task205：启动迁移——新默认数据源（zhipu）并进存量 skills.json（幂等，须在 scheduler 首次读配置前） */
skillsScheduler.register(skillsModelPricing)

const PORT = Number(process.env.LITTLEDJ_PORT || 4097)
const HOST = process.env.LITTLEDJ_HOST || '0.0.0.0'
const ROOT = require('./paths').ROOT
// ---------- task381：进程级异常兜底（P0-6，ds flash 终审方案） ----------
// 背景：此前全文件 0 处 process.on —— async 事件回调 rejection / promise 链断 catch / 定时器抛错
// 任一发生即无人接管，Node 18+ 默认终止进程且无审计痕迹。
// 口径：unhandledRejection=记录不退出（同源 ≥3 次/10min 判循环升级退出）；uncaughtException=
// writeSync 同步落盘后受控退出(1)，由 watchdog 拉活（watchdog 同轮配循环保护，防起来就崩的拉活风暴）。
const GUARD_LOG = path.join(ROOT, 'logs', 'crash.log')
const GUARD_REJECT_MAX = 3
const _guardRejectSeen = new Map() /* 同源计数：name+msg头80字符 → {n,at}，10min 滑窗 */
function guardWriteSync(tag, e) {
  try {
    fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true })
    const line = JSON.stringify({ t: new Date().toISOString(), tag: tag, pid: process.pid, boot: PROXY_BOOT_ID, name: (e && e.name) || '', msg: String((e && e.message) || e).slice(0, 500), stack: String((e && e.stack) || '').slice(0, 4000) }) + '\n'
    const fd = fs.openSync(GUARD_LOG, 'a')
    try { fs.writeSync(fd, line) } finally { fs.closeSync(fd) }
  } catch (_) { /* 落盘失败不改变退出决策 */ }
}
process.on('unhandledRejection', function (e) {
  const key = ((e && e.name) || 'Error') + '|' + String((e && e.message) || '').slice(0, 80)
  const now = Date.now()
  if (_guardRejectSeen.size > 500) _guardRejectSeen.clear() /* 防自身无界 */
  const rec = _guardRejectSeen.get(key) || { n: 0, at: 0 }
  if (now - rec.at > 10 * 60 * 1000) rec.n = 0 /* 滑窗过期重置 */
  rec.n += 1; rec.at = now; _guardRejectSeen.set(key, rec)
  if (rec.n >= GUARD_REJECT_MAX) {
    guardWriteSync('rejection-loop', e)
    console.error('[guard] 同源 unhandledRejection ×' + rec.n + ' 判循环，受控退出：' + key)
    process.exit(1)
  }
  guardWriteSync('unhandledRejection', e)
})
process.on('uncaughtException', function (e) {
  guardWriteSync('uncaughtException', e)
  try { console.error('[guard] uncaughtException，受控退出（watchdog 拉活）', e) } catch (_) {}
  process.exit(1)
})
/* task381 自测钩子：仅 LITTLEDJ_GUARD_TEST 显式设值时激活（生产零暴露），供 selftest-process-guard 端到端注入 */
if (process.env.LITTLEDJ_GUARD_TEST) {
  const _gmode = process.env.LITTLEDJ_GUARD_TEST
  setTimeout(function () {
    if (_gmode === 'uncaught') throw new Error('guard-test-uncaught')
    if (_gmode === 'reject') Promise.reject(new Error('guard-test-rejection'))
    if (_gmode === 'reject3') { Promise.reject(new Error('guard-test-loop')); Promise.reject(new Error('guard-test-loop')); setTimeout(function () { Promise.reject(new Error('guard-test-loop')) }, 80) }
  }, 300)
}
const PROJECTS = path.join(ROOT, 'projects')
const CONFIG = path.join(ROOT, 'config')
// task245：页内自检机器人的落盘位置（运行根，不入 git）
const SELFTEST_DIR = path.join(ROOT, 'run', 'selftest')
const SELFTEST_REQUEST = path.join(ROOT, 'run', 'selftest-request.json')
const UI_DIR = path.join(__dirname, '..', 'ui')
const BACKEND = { host: process.env.LITTLEDJ_BACKEND_HOST || '127.0.0.1', port: Number(process.env.LITTLEDJ_BACKEND_PORT || 4098) }
// task135：proxy 进程启动纪元（换血必变）——/_health 回传，前端 SSE 每次连上时握手对比，
// 发现 proxy 重启过（新前端代码已上线）即自动刷新页面，主人无需手点（serve 重启不误刷：bootId 不变）
const PROXY_BOOT_ID = Date.now()
// task169：UI 静态文件内容指纹（mtime+size）——/ _health 回传，前端与 bootId 合并握手。
// proxy 未重启（bootId 不变）但 ui/index.html 已更新时（纯前端改动），已打开页面据此自动刷新，
// 不再依赖主人手点刷新（task168 交付事故：上传页面跑旧 JS，主人以为没修好）
function uiRev () {
  try {
    const st = fs.statSync(path.join(UI_DIR, 'index.html'))
    return String(Math.round(st.mtimeMs)) + '-' + String(st.size)
  } catch (e) { return '' }
}
// 可选：整站反代到另一台 littleDJ（老机器 .17 当鸿蒙 PC 的透明入口）
const UPSTREAM = process.env.LITTLEDJ_UPSTREAM ? new URL(process.env.LITTLEDJ_UPSTREAM) : null

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json'
}

function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

// task167（task166 P2-8）：统一 body 上限——maxBytes 可选，默认 1MB；超限 cb(Error)+destroy，
// 调用点按既有 err 分支回 400/413。大 body 路由显式传参：/_queue POST=20MB（与 prompt_async 对齐，
// 出队转发不错位）。读二进制禁用本函数（readRawBody 带独立 limit）。
function readBody(req, cb, maxBytes) {
  const MAX = maxBytes || 1024 * 1024
  let body = ''
  let ended = false
  req.on('data', function (c) {
    if (ended) return
    if (body.length + c.length > MAX) {
      ended = true
      const e = new Error('body too large')
      e.code = 'BODY_TOO_LARGE'
      cb(e)
      try { req.destroy() } catch (err2) {}
      return
    }
    body += c
  })
  req.on('end', function () {
    if (ended) return
    ended = true
    let d
    try { d = JSON.parse(body || '{}') } catch (e) { return cb(new Error('bad json')) }
    cb(null, d)
  })
  req.on('error', function () { if (!ended) { ended = true; cb(new Error('body read error')) } })
}

// 二进制请求体（语音 WAV 上传用）——禁止复用 readBody（字符串拼接会毁二进制）
function readRawBody(req, limit, cb) {
  const chunks = []
  let size = 0, ended = false
  req.on('data', function (c) {
    if (ended) return
    size += c.length
    if (size > limit) { ended = true; cb(new Error('body too large')); req.destroy(); return }
    chunks.push(c)
  })
  req.on('end', function () { if (!ended) { ended = true; cb(null, Buffer.concat(chunks)) } })
  req.on('error', function (e) { if (!ended) { ended = true; cb(e) } })
}

/* ---------- 语音对话（task46）：火山豆包 TTS/ASR 中转 ----------
   凭据只读 <运行根>/config/voice.json（仓库外，模板见 voice.example.json）；
   代码/日志/报错零硬编码 Key；ws 依赖路由内懒加载（冷环境缺 node_modules 时语音降级中文报错，不瘫站）。 */
const VOICE_FILE = path.join(CONFIG, 'voice.json')
// 音色备注覆盖层（task55）：键=音色 id，值=备注名；落地运行根 config（仓库外，可整删回滚、零凭据）
const VOICE_NAMES_FILE = path.join(CONFIG, 'voice-names.json')
const VOICE_NAME_MAX = 20

// 备注层：每次现读文件，绝不走 voiceCfg() 的 60s 缓存（改名即时生效）；
// 缺失/坏 JSON/非对象 → 空表；值过滤为非空字符串并按码点截断（读取侧兜底）
function voiceNamesRead() {
  const o = readJson(VOICE_NAMES_FILE, null)
  const out = {}
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out
  Object.keys(o).forEach(function (k) {
    const v = o[k]
    if (typeof v === 'string') {
      const t = v.trim()
      if (t) out[k] = Array.from(t).slice(0, VOICE_NAME_MAX).join('')
    }
  })
  return out
}
// 原子落盘：同目录 tmp → renameSync，0600；失败清 tmp 不落坏档（不改通用 writeJson）
function voiceNamesWrite(map) {
  const tmp = VOICE_NAMES_FILE + '.tmp'
  try { fs.unlinkSync(tmp) } catch (e) {}
  try {
    fs.writeFileSync(tmp, JSON.stringify(map, null, 2), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, VOICE_NAMES_FILE)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (e2) {}
    throw e
  }
}
// 回落链：备注名 > voice.json 原 name（label） > id
function voiceListPayload(c) {
  const names = voiceNamesRead()
  return (c.tts.voices || []).map(function (v) {
    const label = String(v.name || v.id || '')
    return { id: v.id, name: names[v.id] || label || v.id, label: label || v.id }
  })
}
function voiceLabelOf(c, id) {
  const hit = (c.tts.voices || []).filter(function (v) { return v.id === id })[0]
  return hit ? String(hit.name || hit.id || '') : ''
}
// PUT|POST /_voice/voices：{id,name} 写备注覆盖层；name 空=删除覆盖回落原名。
// 同步段读-合-写，无外呼，不挂 _ttsChain；响应回流 voices 供前端就地刷新。
function voiceNameUpdate(req, res) {
  const len = Number(req.headers['content-length'] || 0)
  if (len > 8 * 1024) return json(res, 413, { ok: false, error: '请求体过大' })
  return readBody(req, function (err, d) {
    if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
    const c = voiceCfg()
    if (!c) return json(res, 200, { ok: false, error: '语音凭据未配置（' + path.join(ROOT, 'config', 'voice.json') + '，语音对话不可用' })
    if (!d || typeof d !== 'object' || Array.isArray(d)) return json(res, 400, { ok: false, error: '请求体必须是对象' })
    const id = typeof d.id === 'string' ? d.id.trim() : ''
    if (!id) return json(res, 400, { ok: false, error: 'id 不能为空' })
    const label = voiceLabelOf(c, id)
    if (!label) return json(res, 404, { ok: false, error: '未知音色' })
    if (typeof d.name !== 'string') return json(res, 400, { ok: false, error: '备注名必须是字符串' })
    const name = d.name.trim()
    if (/[\u0000-\u001f\u007f]/.test(name)) return json(res, 400, { ok: false, error: '备注名不能包含控制字符' })
    if (Array.from(name).length > VOICE_NAME_MAX) return json(res, 400, { ok: false, error: '备注名最多 ' + VOICE_NAME_MAX + ' 个字' })
    const names = voiceNamesRead()
    if (name) names[id] = name; else delete names[id]
    try { voiceNamesWrite(names) } catch (e) { return json(res, 500, { ok: false, error: '备注名保存失败，请检查 config 目录写入权限' }) }
    return json(res, 200, { ok: true, id: id, name: names[id] || label || id, voices: voiceListPayload(c) })
  })
}
/* ---------- 多供应商 TTS 配置（task68 S2b-A）：运行根 config/tts-providers.json ----------
   与 voice.json / voice-names.json 生命周期隔离：本段只读写 tts-providers.json，
   迁移源两文件全程只读；Key 只在服务端落盘，GET 一律 maskTtsKey 脱敏。 */
const TTS_PROVIDERS_FILE = path.join(CONFIG, 'tts-providers.json')
const TTS_PROVIDER_MAX = 50
const TTS_VOICES_MAX = 500
const TTS_PROVIDER_TYPES = ['volcano', 'deepseek', 'qwen', 'local', 'rest']
const SEED_VOICES_VOLCANO = [
  // 注：S_pi0A32Sg2 现况已存在于 voice.json（name='音色 B'）⇒ 本播种条永久命中跳过、永不生效；
  // 保留仅作「换机/清空 voice.json 后重装」的兜底占位，不得覆盖既有 note（细案 §3.3 规则 2）。
  { id: 'S_pi0A32Sg2', note: '火山音色 1' },
  { id: 'S_7VAy32Sg2', note: '火山音色 2' }
]

// 仅用于 /_tts/providers 的 apiKey 回显；与既有 maskKey（proxy.js:428）互不引用、互不覆盖
function maskTtsKey(k) {
  const s = String(k || '')
  if (!s) return ''
  return s.length > 4 ? '****' + s.slice(-4) : '****'
}

// 原子写：同目录 tmp → renameSync，0600；失败清 tmp 不落半截坏档（复用 voiceNamesWrite 范式）
function ttsProvidersWrite(data) {
  const tmp = TTS_PROVIDERS_FILE + '.tmp'
  try { fs.unlinkSync(tmp) } catch (e) {}
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, TTS_PROVIDERS_FILE)
  } catch (e) {
    try { fs.unlinkSync(tmp) } catch (e2) {}
    throw e
  }
}

// 备注归一：去控制字符、去首尾空白、截 20 码点（迁移与 PUT 共用，避免超纲值落盘）
function ttsNormNote(v) {
  const t = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return Array.from(t).slice(0, VOICE_NAME_MAX).join('')
}

// 迁移 + 播种：仅在 tts-providers.json 不存在时由 ttsProvidersLoad 调用；同步段读-组-写-返回
function ttsProvidersMigrate(data) {
  if (data && Array.isArray(data.providers) && data.providers.some(function (p) { return p && p.id === 'volcano' })) return data
  const v = readJson(VOICE_FILE, null)
  if (!v || typeof v !== 'object' || Array.isArray(v) || !v.volcanoKey || !v.tts || !v.tts.resourceId) {
    return { ok: false, error: '语音凭据未配置或格式不对（' + path.join(ROOT, 'config', 'voice.json') + '，供应商列表不可用' }
  }
  try {
    const vm = fs.statSync(VOICE_FILE).mode & 0o777
    if (vm & 0o006) console.error('[tts-providers] config/voice.json 权限建议去掉 other 读写')
  } catch (e) {}
  const names = voiceNamesRead()
  const voices = []
  ;(v.tts.voices || []).forEach(function (x) {
    if (!x) return
    const id = String(x.id || '').trim()
    if (!id) return
    if (voices.some(function (y) { return y.id === id })) return
    // P1-3 取值链：voice-names.json[id] → voice.json.tts.voices[].name → 空串（不得吞既有备注）
    const note = ttsNormNote(names[id] || x.name || '')
    voices.push({ id: id, note: note, default: voices.length === 0 })
  })
  SEED_VOICES_VOLCANO.forEach(function (s) {
    if (voices.some(function (x) { return x.id === s.id })) return
    voices.push({ id: s.id, note: s.note, default: false })
  })
  const out = {
    version: 1,
    seedVersion: 1,
    migratedAt: new Date().toISOString(),
    migratedFrom: 'voice.json',
    providers: [{
      id: 'volcano',
      name: '火山引擎',
      type: 'volcano',
      apiKey: String(v.volcanoKey || ''),
      endpoint: String(v.tts.endpoint || ''),
      enabled: true,
      order: 0,
      extra: {
        resourceId: String(v.tts.resourceId || ''),
        fallbackResourceId: String(v.tts.fallbackResourceId || ''),
        fallbackVoice: String(v.tts.fallbackVoice || ''),
        asrEndpoint: String((v.asr && v.asr.endpoint) || '')
      },
      voices: voices
    }]
  }
  try {
    ttsProvidersWrite(out)
  } catch (e) {
    console.error('[tts-providers] 写入失败 path=' + TTS_PROVIDERS_FILE + ' code=' + ((e && e.code) || 'unknown'))
    return { ok: false, error: '供应商配置保存失败，请检查 config 目录写入权限' }
  }
  return out
}

// 唯一入口：文件存在即只读解析（含 providers: [] 也尊重），不存在才迁移
function ttsProvidersLoad() {
  if (!fs.existsSync(TTS_PROVIDERS_FILE)) return ttsProvidersMigrate(null)
  let raw
  try { raw = JSON.parse(fs.readFileSync(TTS_PROVIDERS_FILE, 'utf8')) } catch (e) {
    return { ok: false, error: '供应商配置文件损坏（config/tts-providers.json），未做任何写入' }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.providers)) {
    return { ok: false, error: '供应商配置文件损坏（config/tts-providers.json），未做任何写入' }
  }
  /* task308：DeepSeek TTS 供应商幂等播种（按 id 补缺，已有 deepseek 一律不动）；
     apiKey 留空不快照——合成时现读 deveco 凭据库（readDeepseekKey），与「设置 → API Key」同源跟随。 */
  if (!raw.providers.some(function (p) { return p && p.id === 'deepseek' })) {
    const order = raw.providers.reduce(function (m, p) { return Math.max(m, Number(p && p.order) || 0) }, 0) + 1
    raw.providers.push({
      id: 'deepseek',
      name: 'DeepSeek',
      type: 'deepseek',
      apiKey: '',
      endpoint: '', /* 空 = 代码内默认官方端点 DS_TTS_ENDPOINT */
      enabled: true,
      order: order,
      extra: {},
      voices: [
        { id: 'stella', note: 'Stella · 女声（默认）', default: true },
        { id: 'tide', note: 'Tide · 男声', default: false }
      ]
    })
    try { ttsProvidersWrite(raw) } catch (e) {
      console.error('[tts-providers] deepseek 播种写入失败 code=' + ((e && e.code) || 'unknown'))
    }
  }
  return raw
}

function ttsProvidersSorted(data) {
  return (data.providers || []).slice().sort(function (a, b) {
    const ao = Number(a && a.order) || 0
    const bo = Number(b && b.order) || 0
    if (ao !== bo) return ao - bo
    return String((a && a.id) || '').localeCompare(String((b && b.id) || ''))
  })
}

// 对外形状：apiKey 一律掩码，只回 voices 的 id/note/default
function ttsProviderPublic(p) {
  return {
    id: String(p.id || ''),
    name: String(p.name || ''),
    type: String(p.type || ''),
    apiKey: maskTtsKey(p.apiKey),
    endpoint: String(p.endpoint || ''),
    enabled: p.enabled !== false,
    order: Number(p.order) || 0,
    extra: (p.extra && typeof p.extra === 'object' && !Array.isArray(p.extra)) ? p.extra : {},
    voices: (Array.isArray(p.voices) ? p.voices : []).map(function (v) {
      return { id: String((v && v.id) || ''), note: String((v && v.note) || ''), default: !!(v && v.default === true) }
    })
  }
}

function ttsNameCheck(v) {
  if (typeof v !== 'string') return { error: '供应商名称不能为空' }
  const t = v.trim()
  if (!t) return { error: '供应商名称不能为空' }
  if (/[\u0000-\u001f\u007f]/.test(t)) return { error: '供应商名称不能包含控制字符' }
  if (Array.from(t).length > 20) return { error: '供应商名称最多 20 个字' }
  return { value: t }
}
function ttsTypeCheck(v) {
  const t = String(v == null ? '' : v).trim()
  if (TTS_PROVIDER_TYPES.indexOf(t) < 0) return { error: '未知的供应商类型：' + t }
  return { value: t }
}
function ttsEndpointCheck(v) {
  const s = String(v == null ? '' : v).trim()
  if (s && !/^https?:\/\//i.test(s)) return { error: '供应商地址必须以 http:// 或 https:// 开头' }
  return { value: s }
}
function ttsOrderCheck(v) {
  const n = Number(v)
  if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: '排序值必须是 0-9999 的整数' }
  return { value: n }
}
function ttsVoicesCheck(arr) {
  if (!Array.isArray(arr)) return { error: '请求体必须是对象' }
  if (arr.length > TTS_VOICES_MAX) return { error: '单个供应商音色已达上限 ' + TTS_VOICES_MAX + ' 条' }
  const out = []
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i] || {}
    if (typeof v.id !== 'string') return { error: '音色 ID 不能为空' }
    const id = v.id.trim()
    if (!id) return { error: '音色 ID 不能为空' }
    if (/[\u0000-\u001f\u007f]/.test(id)) return { error: '音色 ID 不能包含控制字符' }
    if (Array.from(id).length > 128) return { error: '音色 ID 最多 128 个字' }
    if (out.some(function (x) { return x.id === id })) return { error: '音色 ID 重复：' + id }
    const rawNote = String(v.note == null ? '' : v.note)
    if (/[\u0000-\u001f\u007f]/.test(rawNote)) return { error: '音色备注不能包含控制字符' }
    if (Array.from(rawNote.trim()).length > VOICE_NAME_MAX) return { error: '音色备注最多 ' + VOICE_NAME_MAX + ' 个字' }
    out.push({ id: id, note: ttsNormNote(rawNote), default: v.default === true })
  }
  if (out.filter(function (x) { return x.default }).length > 1) return { error: '每家供应商最多一个默认音色' }
  return { value: out }
}

// POST 新增：服务端生成 id/order；type 必填白名单；voices 可省略
function ttsProviderCreate(res, data, d) {
  if (data.providers.length >= TTS_PROVIDER_MAX) return json(res, 400, { ok: false, error: '供应商数量已达上限 ' + TTS_PROVIDER_MAX + ' 家' })
  const nm = ttsNameCheck(d.name)
  if (nm.error) return json(res, 400, { ok: false, error: nm.error })
  const tp = ttsTypeCheck(d.type)
  if (tp.error) return json(res, 400, { ok: false, error: tp.error })
  const ep = ttsEndpointCheck(d.endpoint)
  if (ep.error) return json(res, 400, { ok: false, error: ep.error })
  let order
  if (d.order === undefined || d.order === null) {
    let max = -1
    data.providers.forEach(function (p) {
      const n = Number(p && p.order)
      if (Number.isInteger(n) && n > max) max = n
    })
    order = max < 0 ? 0 : Math.min(9999, max + 1)
  } else {
    const od = ttsOrderCheck(d.order)
    if (od.error) return json(res, 400, { ok: false, error: od.error })
    order = od.value
  }
  const vc = ttsVoicesCheck(d.voices === undefined ? [] : d.voices)
  if (vc.error) return json(res, 400, { ok: false, error: vc.error })
  const existing = {}
  data.providers.forEach(function (p) { if (p && p.id) existing[p.id] = true })
  existing.volcano = true
  let id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  while (existing[id]) id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const p = {
    id: id,
    name: nm.value,
    type: tp.value,
    apiKey: typeof d.apiKey === 'string' ? d.apiKey : '',
    endpoint: ep.value,
    enabled: typeof d.enabled === 'boolean' ? d.enabled : true,
    order: order,
    extra: (d.extra && typeof d.extra === 'object' && !Array.isArray(d.extra)) ? d.extra : {},
    voices: vc.value
  }
  data.providers.push(p)
  try {
    ttsProvidersWrite(data)
  } catch (e) {
    data.providers.pop()
    console.error('[tts-providers] 写入失败 path=' + TTS_PROVIDERS_FILE + ' code=' + ((e && e.code) || 'unknown'))
    return json(res, 500, { ok: false, error: '供应商配置保存失败，请检查 config 目录写入权限' })
  }
  return json(res, 200, { ok: true, provider: ttsProviderPublic(p) })
}

// PUT 更新：id 必带；type 服务端强制不可变；apiKey 缺省/空串/掩码 = 保留旧 Key
function ttsProviderUpdate(res, data, d) {
  const id = typeof d.id === 'string' ? d.id.trim() : ''
  if (!id) return json(res, 404, { ok: false, error: '供应商不存在' })
  const p = data.providers.filter(function (x) { return x && x.id === id })[0]
  if (!p) return json(res, 404, { ok: false, error: '供应商不存在' })
  // P1-2：type 校验先于任何字段写入，被拒请求全程不落盘
  if (d.type !== undefined && String(d.type) !== String(p.type)) {
    return json(res, 400, { ok: false, error: '供应商类型不可修改，需切换请新建供应商' })
  }
  let name = p.name
  if (d.name !== undefined) {
    const nm = ttsNameCheck(d.name)
    if (nm.error) return json(res, 400, { ok: false, error: nm.error })
    name = nm.value
  }
  let endpoint = p.endpoint
  if (d.endpoint !== undefined) {
    const ep = ttsEndpointCheck(d.endpoint)
    if (ep.error) return json(res, 400, { ok: false, error: ep.error })
    endpoint = ep.value
  }
  let order = p.order
  if (d.order !== undefined) {
    const od = ttsOrderCheck(d.order)
    if (od.error) return json(res, 400, { ok: false, error: od.error })
    order = od.value
  }
  let enabled = p.enabled !== false
  if (typeof d.enabled === 'boolean') enabled = d.enabled
  let extra = p.extra
  if (d.extra !== undefined) {
    if (!d.extra || typeof d.extra !== 'object' || Array.isArray(d.extra)) return json(res, 400, { ok: false, error: '请求体必须是对象' })
    extra = d.extra
  }
  let voices = Array.isArray(p.voices) ? p.voices : []
  if (d.voices !== undefined) {
    const vc = ttsVoicesCheck(d.voices)
    if (vc.error) return json(res, 400, { ok: false, error: vc.error })
    voices = vc.value
  }
  let apiKey = p.apiKey
  if (d.apiKey !== undefined && d.apiKey !== null) {
    const k = String(d.apiKey)
    if (k !== '' && !/^\*{4}/.test(k)) apiKey = k
  }
  const old = { name: p.name, apiKey: p.apiKey, endpoint: p.endpoint, enabled: p.enabled, order: p.order, extra: p.extra, voices: p.voices }
  p.name = name
  p.apiKey = apiKey
  p.endpoint = endpoint
  p.enabled = enabled
  p.order = order
  p.extra = extra
  p.voices = voices
  try {
    ttsProvidersWrite(data)
  } catch (e) {
    Object.assign(p, old)
    console.error('[tts-providers] 写入失败 path=' + TTS_PROVIDERS_FILE + ' code=' + ((e && e.code) || 'unknown'))
    return json(res, 500, { ok: false, error: '供应商配置保存失败，请检查 config 目录写入权限' })
  }
  return json(res, 200, { ok: true, provider: ttsProviderPublic(p) })
}

// 合成分发：volcano + deepseek（task308）已接入；其它 type 一律 400（不写假 adapter、不伪造响应）
function providerToVoiceCfg(p) {
  const ex = p.extra || {}
  return {
    volcanoKey: String(p.apiKey || ''),
    tts: {
      endpoint: String(p.endpoint || ''),
      resourceId: String(ex.resourceId || ''),
      fallbackResourceId: String(ex.fallbackResourceId || ''),
      fallbackVoice: String(ex.fallbackVoice || ''),
      voices: (Array.isArray(p.voices) ? p.voices : []).map(function (v) {
        return { id: String(v.id), name: String(v.note || v.id) }
      })
    },
    asr: { endpoint: String(ex.asrEndpoint || '') }
  }
}

/* ---------- task308：DeepSeek TTS（11-13 全家桶 API · /v1/tools/tts 全文模式） ----------
   请求 JSON {text, voice_id, format:'wav', filter_markdown:true}，响应体=wav 音频流；
   ≤1 万字符/次（远大于 VOICE_TEXT_MAX 2000 无需分段）；价格 3 元/万字（限时 5 折 1.5）。
   Key 链：p.apiKey（TTS 卡自填）→ dsActiveKey()（apikeys.json=「设置 → API Key」库，UI 改 key 即生效）。
   fu1：回落源不经 deveco auth.json——实测其 deepseek.key 为坏值 '[object Object]'（历史写入事故残留），不可依赖。 */
const DS_TTS_ENDPOINT = 'https://api.deepseek.com/v1/tools/tts'
function dsActiveKey() {
  const ks = readApiKeys()
  if (!ks.keys.length) return ''
  const act = ks.keys.filter(function (k) { return k.name === ks.active })[0] || ks.keys[0]
  return String((act && act.key) || '')
}
function dsTts(p, text, voice) {
  return new Promise(function (resolve, reject) {
    const key = String(p.apiKey || '') || dsActiveKey()
    if (!key) return reject(new Error('未配置 DeepSeek API Key——在本卡填写，或到 设置 → API Key 配置后自动跟随'))
    let u
    try { u = new URL(String(p.endpoint || '') || DS_TTS_ENDPOINT) } catch (e) { return reject(new Error('API 地址不合法')) }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('API 地址只支持 http(s)'))
    const body = JSON.stringify({ text: text, voice_id: voice, format: 'wav', filter_markdown: true })
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, function (res) {
      const chunks = []
      let size = 0
      res.on('data', function (c) {
        size += c.length
        if (size > 20 * 1024 * 1024) { req.destroy(); return reject(new Error('音频过大（>20MB）')) }
        chunks.push(c)
      })
      res.on('end', function () {
        const buf = Buffer.concat(chunks)
        if (res.statusCode !== 200) {
          let msg = ''
          try { const j = JSON.parse(buf.toString('utf8')); msg = String((j && (j.error && (j.error.message || j.error) || j.message)) || '') } catch (e) { msg = buf.toString('utf8').slice(0, 120) }
          return reject(new Error('DeepSeek TTS 失败 HTTP ' + res.statusCode + (msg ? '：' + msg : '')))
        }
        resolve({ mime: 'audio/wav', buf: buf })
      })
      res.on('error', reject)
    })
    req.setTimeout(30000, function () { req.destroy(); reject(new Error('DeepSeek TTS 请求超时（30s）')) })
    req.on('error', reject)
    req.end(body)
  })
}

/* task347：DeepSeek TTS 官方 ≤1 万字/次——消息播报 🔊 长文一次合成；
   火山等其他类型维持 VOICE_TEXT_MAX 2000。放宽后前端 msgSpeakSplit(≤1900) 分段自然不再触发（整段 ≤1 万直达）。
   生效需重启 proxy；未重启时靠前端分段兜底，功能不受阻。 */
const DS_VOICE_TEXT_MAX = 10000

/* ---------- task367：DeepSeek OCR——OCR 当眼睛、GLM 当脑子（A 路线，主人拍板） ----------
   官方端点 POST /v1/tools/ocr（multipart：file+purpose），1.5 元/千页按成功页计费；
   响应识别中持续发换行（属 JSON 前导空白，整体可 parse），200 后也可能是 {error:{...}}。
   准入=别名单 deepseek/ocr 条目（主人 100% 规矩：别名=准入证；删条目=关功能）；
   只拦发往 GLM（ZHIPU_PROVIDER，纯文本模型）的 data:image 附件，转写文本替换入会话；
   预算 28s（前端 send.js 30s AbortController 之内，多图共享 deadline）；任何运行期异常
   一律降级 part+原图落盘 inbox，绝不静默吞图；图片内容会发送至 DeepSeek OCR 服务（知情声明）。 */
const OCR_ALIAS_KEY = 'deepseek/ocr'
const OCR_ENDPOINT_DEFAULT = 'https://api.deepseek.com/v1/tools/ocr'
const OCR_BUDGET_RAW = Number(process.env.LITTLEDJ_OCR_BUDGET_MS || 28000)
const OCR_BUDGET_MS = (Number.isFinite(OCR_BUDGET_RAW) && OCR_BUDGET_RAW > 0) ? OCR_BUDGET_RAW : 28000 // P2-9：非法 env 回默认（NaN 会全图秒降级）
const OCR_TEXT_MAX = 60 * 1000 // P2-10：单图转写文本上限（防大图/千页撑爆 GLM 上下文），超出截断标注
const OCR_FORCE = process.env.LITTLEDJ_OCR_FORCE === '1' // 调试闸：全模型强拦（生产默认不设）
const OCR_RESP_MAX = 20 * 1024 * 1024
const OCR_MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/tiff': 'tiff' } // 官方支持白名单（P2-4/6：前置省一次上传+落盘扩展名）
const OCR_INBOX_DIR = path.join(ROOT, 'inbox')
const OCR_INBOX_KEEP = 20

function ocrLog(msg) { console.log('[ocr] ' + msg) }

// task367：ref/box 标记清理——text_recognition 的图也带 <｜ref｜>/<｜box｜>（官方文档口径），转写给 GLM 前剥掉坐标保文字
function ocrCleanText(s) {
  return String(s || '')
    .replace(/<｜ref｜>([\s\S]*?)<｜\/ref｜>/g, '$1')
    .replace(/<｜box｜>[\s\S]*?<｜\/box｜>/g, '')
    .trim()
}

// task367：失败原图落盘（目录 0700、白名单扩展名、保留上限 OCR_INBOX_KEEP）；失败返回 ''（仍走降级 part）
function ocrSaveFailInbox(buf, mime) {
  const ext = OCR_MIME_EXT[mime] || 'png'
  try {
    fs.mkdirSync(OCR_INBOX_DIR, { recursive: true, mode: 0o700 })
    try { fs.chmodSync(OCR_INBOX_DIR, 0o700) } catch (e) {}
    const file = path.join(OCR_INBOX_DIR, 'ocr-fail-' + crypto.createHash('sha256').update(buf).digest('hex').slice(0, 8) + '.' + ext)
    if (!fs.existsSync(file)) { fs.writeFileSync(file, buf, { mode: 0o600 }); try { fs.chmodSync(file, 0o600) } catch (e) {} }
    // P2-4（产审）：按 mtime 排序淘汰最旧（按文件名排序会误删刚写入的图还谎报「已保存」）
    const olds = fs.readdirSync(OCR_INBOX_DIR).filter(function (f) { return /^ocr-fail-/.test(f) })
      .map(function (f) { const p = path.join(OCR_INBOX_DIR, f); return { p: p, t: (fs.statSync(p).mtimeMs || 0) } })
      .sort(function (a, b) { return a.t - b.t })
    for (const o of olds.slice(0, Math.max(0, olds.length - OCR_INBOX_KEEP))) { try { fs.unlinkSync(o.p) } catch (e) {} }
    return file
  } catch (e) { return '' }
}

// task367：单图 OCR——照 dsTts 骨架（dsActiveKey 取 key + 直连 api.deepseek.com）。
// multipart 手拼；响应 ≤20MB 整体 parse；200 后 error 体也算失败；timeoutMs=预算剩余。
function dsOcr(buf, mime, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const key = dsActiveKey()
    if (!key) return reject(new Error('未配置 DeepSeek API Key（设置 → API Key）'))
    let u
    try { u = new URL(process.env.LITTLEDJ_DS_OCR_URL || OCR_ENDPOINT_DEFAULT) } catch (e) { return reject(new Error('OCR API 地址不合法')) }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('OCR API 地址只支持 http(s)（P2-11）'))
    const ext = OCR_MIME_EXT[mime] || 'png'
    const boundary = '----littledjOcr' + crypto.randomBytes(12).toString('hex')
    const head = Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="purpose"\r\n\r\ntext_recognition\r\n' +
      '--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="image.' + ext + '"\r\nContent-Type: ' + mime + '\r\n\r\n')
    const tail = Buffer.from('\r\n--' + boundary + '--\r\n')
    const body = Buffer.concat([head, buf, tail])
    const mod = u.protocol === 'https:' ? https : http
    const req = mod.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''), method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length }
    }, function (res) {
      const chunks = []
      let size = 0
      res.on('data', function (c) { size += c.length; if (size > OCR_RESP_MAX) { req.destroy(); return reject(new Error('OCR 响应过大（>20MB）')) } chunks.push(c) })
      res.on('end', function () {
        const txt = Buffer.concat(chunks).toString('utf8')
        let j = null
        try { j = JSON.parse(txt) } catch (e) { return reject(new Error('OCR 响应解析失败（HTTP ' + res.statusCode + '）')) }
        if (j && j.error && j.error.message) return reject(new Error('OCR 失败：' + j.error.message))
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('OCR HTTP ' + res.statusCode))
        if (!j || !Array.isArray(j.pages)) return reject(new Error('OCR 响应缺 pages'))
        resolve(j)
      })
      res.on('error', function (e) { reject(new Error('OCR 网络错误：' + e.message)) })
    })
    // task367 P0（产审）：setTimeout 是空闲超时——OCR 识别中的换行心跳会不断重置它；
    // 墙钟硬定时器才是预算承诺（28s 内必收口），空闲超时仅作二级防护
    const budgetMs = timeoutMs || OCR_BUDGET_MS
    const hard = setTimeout(function () { req.destroy(new Error('OCR 超时（预算 ' + Math.round(budgetMs / 1000) + 's 内未完成）')) }, budgetMs)
    if (hard.unref) hard.unref()
    req.on('close', function () { clearTimeout(hard) }) // 请求收口（成功/失败/销毁）必触发，统一清墙钟
    req.setTimeout(budgetMs, function () { req.destroy(new Error('OCR 空闲超时')) })
    req.on('error', function (e) { reject(e) })
    req.end(body)
  })
}

// task367：OCR 闸门——三前置 fail-open（未登记别名/非 GLM/无图）+ 运行期异常一律降级 part（不吞图）。
// 只改写 parsed.parts 里的图片附件；返回 { changed }（changed=true 时调用方必须重建投喂 body）。
// gate 级异常（P1-1 产审）：顶层 catch 把剩余 data:image part 全部降级——绝不原图透传给 GLM。
async function ocrGate(parsed, sid) {
  const degradeAll = function (why) {
    let n = 0
    for (let i = 0; i < parsed.parts.length; i++) {
      const p = parsed.parts[i]
      if (p && p.type === 'file' && /^image\//i.test(String(p.mime || '')) && typeof p.url === 'string' && p.url.slice(0, 5).toLowerCase() === 'data:') {
        parsed.parts[i] = { type: 'text', text: '【图片未能识别】OCR 内部异常（' + why + '）。' }
        n++
      }
    }
    return n
  }
  try {
    if (!parsed || !Array.isArray(parsed.parts) || !parsed.parts.length) return { changed: false, skipped: 'bad-parts' } // P2-④：无 parts 可降级，按旧语义透传
    const isGlm = !!(parsed.model && parsed.model.providerID === ZHIPU_PROVIDER)
    if (!isGlm && !OCR_FORCE) { ocrLog('INFO skip not-glm sid=' + (sid || '?') + '（provider=' + ((parsed.model && parsed.model.providerID) || '缺失') + '）'); return { changed: false, skipped: 'not-glm' } } // P2-2：可观测
    let alias = null
    try { alias = readModelAlias() } catch (e) { const n = degradeAll('别名单读取失败'); if (n) { ocrLog('WARN sid=' + (sid || '?') + ' 别名单读取失败，' + n + ' 张图降级'); return { changed: true } } return { changed: false, skipped: 'alias-read-fail' } }
    if (!alias || !alias[OCR_ALIAS_KEY]) { ocrLog('INFO 别名无 ' + OCR_ALIAS_KEY + ' 条目，OCR 关闭（fail-open 透传）'); return { changed: false, skipped: 'no-alias' } }
    const hasImage = parsed.parts.some(function (p) { return p && p.type === 'file' && /^image\//i.test(String(p.mime || '')) && typeof p.url === 'string' && p.url.slice(0, 5).toLowerCase() === 'data:' })
    if (!hasImage) return { changed: false, skipped: 'no-image' }
    const deadline = Date.now() + OCR_BUDGET_MS
    let changed = false
    for (let i = 0; i < parsed.parts.length; i++) {
      const p = parsed.parts[i]
      if (!p || p.type !== 'file' || !/^image\//i.test(String(p.mime || '')) || typeof p.url !== 'string' || p.url.slice(0, 5).toLowerCase() !== 'data:') continue
      const m = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(p.url)
      const mime = m ? m[1].toLowerCase() : ''
      let buf = null
      if (m) { try { buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64') } catch (e) { buf = null } }
      if (!m || !buf || !buf.length) {
        parsed.parts.splice(i, 1, { type: 'text', text: '【图片未能识别】图片数据解码失败（非 base64 data URL）。' })
        changed = true; i--; continue
      }
      if (!OCR_MIME_EXT[mime]) {
        parsed.parts.splice(i, 1, { type: 'text', text: '【图片未能识别】图片格式 ' + mime + ' 暂不支持 OCR（支持 png/jpeg/webp/gif/bmp/tiff）。' })
        changed = true; i--; continue
      }
      const left = deadline - Date.now()
      if (left <= 500) {
        const f = ocrSaveFailInbox(buf, mime)
        parsed.parts.splice(i, 1, { type: 'text', text: '【图片未能识别】OCR 总预算（' + Math.round(OCR_BUDGET_MS / 1000) + 's）已用尽。原图已保存 ' + path.join(ROOT, 'inbox') + '/' + (f ? path.basename(f) : '(落盘失败)') + '，可稍后重试。' })
        changed = true; i--; continue
      }
      try {
        const j = await dsOcr(buf, mime, left)
        const pages = (j.pages || []).slice().sort(function (a, b) { return (a.index || 0) - (b.index || 0) })
        const texts = pages.map(function (pg) {
          const t = ocrCleanText(pg && pg.text)
          return t + (pg && pg.finish_reason === 'length' ? '\n（该页可能截断）' : '')
        })
        let joined = texts.join('\n\n')
        if (joined.length > OCR_TEXT_MAX) joined = joined.slice(0, OCR_TEXT_MAX) + '\n（转写文本超长已截断）'
        parsed.parts.splice(i, 1, { type: 'text', text: '【图片已 OCR 转写｜' + (j.page_count || pages.length) + ' 页】\n' + joined })
        changed = true; i--
        ocrLog('sid=' + sid + ' 图片转写成功 pages=' + (j.page_count || pages.length) + ' tokens=' + ((j.usage && j.usage.total_tokens) || 0))
      } catch (e) {
        const f = ocrSaveFailInbox(buf, mime)
        parsed.parts.splice(i, 1, { type: 'text', text: '【图片未能识别】' + String((e && e.message) || e) + '。原图已保存 ' + path.join(ROOT, 'inbox') + '/' + (f ? path.basename(f) : '(落盘失败)') + '，可稍后重试。' })
        changed = true; i--
        ocrLog('WARN sid=' + sid + ' 图片转写失败：' + String((e && e.message) || e))
      }
    }
    return { changed: changed }
  } catch (e) {
    // P1-1（产审）：gate 级意外异常绝不原图透传——剩余图片全部降级
    const why = String((e && e.message) || e)
    const n = degradeAll(why)
    ocrLog('WARN ocrGate 内部异常，剩余 ' + n + ' 张图降级：' + why)
    return { changed: n > 0 }
  }
}

function voiceTtsByProvider(res, d, pid) {
  const text = voiceCleanText(d && d.text)
  if (!text) return json(res, 400, { error: '要朗读的文本不能为空' })
  const data = ttsProvidersLoad()
  if (!data || !Array.isArray(data.providers)) return json(res, 500, { error: (data && data.error) || '供应商配置读取失败' })
  const p = data.providers.filter(function (x) { return x && x.id === pid })[0]
  if (!p) return json(res, 400, { error: '未知的供应商：' + pid })
  if (p.enabled === false) return json(res, 400, { error: '该供应商已停用，请先在 TTS 设置里启用' })
  if (p.type !== 'volcano' && p.type !== 'deepseek') return json(res, 400, { error: '供应商类型未接入：' + p.type })
  const maxLen = p.type === 'deepseek' ? DS_VOICE_TEXT_MAX : VOICE_TEXT_MAX
  if (text.length > maxLen) return json(res, 400, { error: '文本太长（最多 ' + maxLen + ' 字），请分段' })
  const voices = Array.isArray(p.voices) ? p.voices : []
  let voice = String((d && d.voice) || '').trim()
  const known = voices.some(function (v) { return v && v.id === voice })
  if (!known) {
    const def = voices.filter(function (v) { return v && v.default === true })[0]
    voice = (def && def.id) || (voices[0] && voices[0].id) || ''
  }
  if (!voice) return json(res, 400, { error: '该供应商没有可用音色，请先添加音色' })
  /* task308：DeepSeek 分流——DS 只支持 wav（fmt 请求值忽略强制 wav），无 resourceId 概念，key 走 apiKey‖deveco 凭据库 */
  if (p.type === 'deepseek') {
    const run = function () {
      return dsTts(p, text, voice).then(function (out) {
        res.writeHead(200, { 'Content-Type': out.mime, 'Content-Length': out.buf.length, 'Cache-Control': 'no-store' })
        res.end(out.buf)
      }).catch(function (e) {
        return json(res, 502, { error: '语音合成失败：' + ((e && e.message) || '网络异常') })
      })
    }
    _ttsChain = _ttsChain.then(run, run)
    return
  }
  const cfg = providerToVoiceCfg(p)
  if (!cfg.volcanoKey || !cfg.tts.resourceId) return json(res, 400, { error: '该供应商 Key 或资源 ID 未配置' })
  const fmt = (d && d.fmt === 'wav') ? 'wav' : 'mp3'
  const run = function () {
    return voiceTts(cfg, text, voice, fmt).then(function (out) {
      res.writeHead(200, { 'Content-Type': out.mime, 'Content-Length': out.buf.length, 'Cache-Control': 'no-store' })
      res.end(out.buf)
    }).catch(function (e) {
      if (e && e.bizCode) return json(res, 502, { error: '语音合成失败（火山码 ' + e.bizCode + '）：' + e.message })
      return json(res, 502, { error: '语音合成失败：' + ((e && e.message) || '网络异常') })
    })
  }
  _ttsChain = _ttsChain.then(run, run)
}
let _voiceCfg = null, _voiceCfgAt = 0
function voiceCfg() {
  if (_voiceCfg && Date.now() - _voiceCfgAt < 60000) return _voiceCfg
  const c = readJson(VOICE_FILE, null)
  if (!c || !c.volcanoKey || !c.tts || !c.tts.resourceId || !c.asr || !c.asr.endpoint) return null
  _voiceCfg = c; _voiceCfgAt = Date.now()
  return c
}
// 单飞互斥：同类请求串行执行，防快速连击/多端并发打外网
let _ttsChain = Promise.resolve()
let _sttChain = Promise.resolve()

const VOICE_TEXT_MAX = 2000
const VOICE_TTS_SEG = 280
const VOICE_STT_MAX_BYTES = 2 * 1024 * 1024  // ≈60s 16k/16bit 单声道，短指令定位
const VOICE_STT_TIMEOUT_MS = 30000

function voiceCleanText(t) {
  return String(t || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim()
}

// 单段 TTS 合成：返回 mp3/pcm Buffer；业务错误抛 {bizCode, message}
function ttsOne(cfg, text, voice, resourceId, fmt, sampleRate) {
  const reqId = 'tts-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  const ctrl = new AbortController()
  const timer = setTimeout(function () { try { ctrl.abort() } catch (e) {} }, 60000)
  return fetch(cfg.tts.endpoint || 'https://openspeech.bytedance.com/api/v3/tts/unidirectional', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': cfg.volcanoKey,
      'X-Api-Resource-Id': resourceId,
      'X-Api-Request-Id': reqId
    },
    body: JSON.stringify({ req_params: { text: text, speaker: voice, audio_params: { format: fmt, sample_rate: sampleRate } } }),
    signal: ctrl.signal
  }).then(function (r) { return r.text().then(function (t) { return { code: r.status, body: t } }) })
    .then(function (res) {
      clearTimeout(timer)
      if (res.code !== 200) throw new Error('火山 TTS HTTP ' + res.code + '：' + String(res.body || '').slice(0, 120))
      const codeMatch = /"code"\s*:\s*(-?\d+)/.exec(res.body)
      if (codeMatch && parseInt(codeMatch[1], 10) !== 0) {
        const msgMatch = /"message"\s*:\s*"([^"]*)"/.exec(res.body)
        throw { bizCode: parseInt(codeMatch[1], 10), message: msgMatch ? msgMatch[1] : '未知业务错误' }
      }
      const chunks = []
      const re = /"data"\s*:\s*"([^"]*)"/g
      let m = re.exec(res.body)
      while (m) { if (m[1]) chunks.push(Buffer.from(m[1], 'base64')); m = re.exec(res.body) }
      if (!chunks.length) throw new Error('火山 TTS 返回里没有音频数据')
      return Buffer.concat(chunks)
    })
    .catch(function (e) { clearTimeout(timer); throw e })
}

// 整段合成：≤280 字分段串行；seed-icl-2.0 音色/资源不匹配(55000000)回退官方组合
function voiceTts(cfg, text, voice, fmt) {
  const isPcm = fmt === 'wav'
  const outFmt = isPcm ? 'pcm' : 'mp3'
  const rate = isPcm ? 16000 : 24000
  const chars = Array.from(text)
  const segs = []
  for (let i = 0; i < chars.length; i += VOICE_TTS_SEG) segs.push(chars.slice(i, i + VOICE_TTS_SEG).join(''))
  function runAll(rid, spk) {
    let p = Promise.resolve()
    const out = []
    segs.forEach(function (seg) {
      p = p.then(function () { return ttsOne(cfg, seg, spk, rid, outFmt, rate).then(function (b) { out.push(b) }) })
    })
    return p.then(function () { return Buffer.concat(out) })
  }
  return runAll(cfg.tts.resourceId, voice).catch(function (e) {
    if (e && e.bizCode === 55000000 && cfg.tts.resourceId === 'seed-icl-2.0' &&
      cfg.tts.fallbackResourceId && cfg.tts.fallbackVoice) {
      return runAll(cfg.tts.fallbackResourceId, cfg.tts.fallbackVoice)
    }
    throw e
  }).then(function (pcm) {
    if (!isPcm) return { buf: pcm, mime: 'audio/mpeg' }
    // wav：44 字节标准头 + pcm_s16le 16k 单声道（回环验证与前端播放兼容用）
    const h = Buffer.alloc(44)
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
    h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
    h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28)
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
    return { buf: Buffer.concat([h, pcm]), mime: 'audio/wav' }
  })
}

// ASR：wss sauc bigmodel_nostream 二进制协议（请求帧无序号：4B头+4B长度+payload；序号只出现在响应帧）
function voiceStt(cfg, wav) {
  let WebSocketCtor
  try { WebSocketCtor = require('ws') } catch (e) {
    return Promise.reject(new Error('语音依赖未安装：请在项目根目录执行 npm install（ws），不影响其他功能'))
  }
  if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    return Promise.reject(new Error('音频格式不对：需要 WAV（16k/16bit/单声道）'))
  }
  return new Promise(function (resolve, reject) {
    let settled = false
    let latest = ''
    const reqId = 'stt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
    const connId = reqId
    let ws
    function done(err, text) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { if (ws && ws.readyState === 1) ws.close() } catch (e) {}
      if (err) reject(err); else resolve(text)
    }
    const timer = setTimeout(function () { done(new Error('语音识别超时（30 秒），请重试')) }, VOICE_STT_TIMEOUT_MS)
    try {
      ws = new WebSocketCtor(cfg.asr.endpoint, {
        headers: {
          'X-Api-Key': cfg.volcanoKey,
          'X-Api-Resource-Id': cfg.asr.resourceId,
          'X-Api-Request-Id': reqId,
          'X-Api-Connect-Id': connId,
          'X-Api-Sequence': '-1'
        },
        handshakeTimeout: 10000
      })
    } catch (e) { return done(new Error('语音识别连接失败：' + (e.message || e))) }
    ws.on('unexpected-response', function (req, res) {
      // 握手被拒（403 等）：读响应体拿火山具体原因（ws 库默认吞掉）
      let b = ''
      res.on('data', function (c) { b += c })
      res.on('end', function () {
        let msg = String(b || '').slice(0, 200)
        const em = /"error"\s*:\s*"([^"]+)"/.exec(msg)
        if (em) msg = em[1]
        if (msg.indexOf('resource not granted') >= 0) {
          return done(new Error('火山账号还没开通语音识别（ASR）资源：请主人到火山引擎控制台「语音技术→大模型流式语音识别」开通（资源 volc.bigasr.sauc.duration）后重试；朗读功能不受影响。原始信息：' + msg))
        }
        done(new Error('语音识别握手被拒（HTTP ' + res.statusCode + '）：' + msg))
      })
    })
    ws.on('error', function (e) { done(new Error('语音识别连接失败：' + (e.message || e))) })
    ws.on('close', function () {
      if (latest) done(null, latest)
      else if (!settled) done(new Error('语音识别连接被服务端关闭且无结果，请重试'))
    })
    ws.on('message', function (data, isBinary) {
      if (settled || !isBinary) return
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
      if (buf.length < 8) return
      const type = (buf[1] >> 4) & 0x0F
      if (type === 0x0F && buf.length >= 12) { // 服务端错误帧：4B 错误码 + 4B 长度 + utf8 文本（产出审 P1-1：短帧防 readUInt32BE 越界炸进程）
        const code = buf.readUInt32BE(4)
        const size = buf.readUInt32BE(8)
        const msg = buf.toString('utf8', 12, 12 + size)
        return done(Object.assign(new Error('语音识别失败（火山码 ' + code + '）：' + msg), { bizCode: code }))
      }
      if (type !== 0x09 || buf.length < 12) return // 只认 full server response
      const size = buf.readUInt32BE(8)
      let payload = buf.slice(12, 12 + size)
      if (((buf[2] >> 0) & 0x0F) === 1) { try { payload = zlib.gunzipSync(payload) } catch (e) { return } }
      let j
      try { j = JSON.parse(payload.toString('utf8')) } catch (e) { return }
      const t = j && j.result && typeof j.result.text === 'string' ? j.result.text : ''
      if (t) latest = t
    })
    ws.on('open', function () {
      try {
        // full client request：0x11 0x10 0x11 0x00 + 长度 + gzip(JSON)
        const conf = zlib.gzipSync(Buffer.from(JSON.stringify({
          user: { uid: 'littledj', platform: 'web' },
          audio: { format: 'wav', rate: 16000, bits: 16, channel: 1, codec: 'raw' },
          request: { model_name: 'bigmodel', enable_punc: true, enable_ddc: false, enable_itn: true }
        })))
        const head = Buffer.alloc(8)
        head[0] = 0x11; head[1] = 0x10; head[2] = 0x11; head[3] = 0x00
        head.writeUInt32BE(conf.length, 4)
        ws.send(Buffer.concat([head, conf]))
        // 音频分帧（产出审 P2-6：对齐官方 100-200ms 建议取 ≈0.5s/帧），末帧 flags 0b0010（负包，无序号）
        const FRAME = 16 * 1024
        for (let off = 0; off < wav.length; off += FRAME) {
          const slice = wav.slice(off, Math.min(off + FRAME, wav.length))
          const gz = zlib.gzipSync(slice)
          const fh = Buffer.alloc(8)
          fh[0] = 0x11; fh[1] = (off + FRAME >= wav.length) ? 0x22 : 0x20; fh[2] = 0x01; fh[3] = 0x00
          fh.writeUInt32BE(gz.length, 4)
          ws.send(Buffer.concat([fh, gz]))
        }
      } catch (e) { done(new Error('语音识别发送失败：' + (e.message || e))) }
    })
  })
}

function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return def }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
}

// 凭据：config/auth.txt（格式 user:pass，勿入 git/开源）；env 可覆盖
function readAuth() {
  let user = process.env.LITTLEDJ_USER, pass = process.env.LITTLEDJ_PASS
  if (!user || !pass) {
    try {
      // task166 P2-4：只按首个冒号切分（旧 split(/[\r\n:]+/) 遇到含冒号的密码会把 t[1] 截断）
      const raw = fs.readFileSync(path.join(CONFIG, 'auth.txt'), 'utf8').trim()
      const nl = raw.search(/[\r\n]/)
      const line = nl >= 0 ? raw.slice(0, nl) : raw
      const ci = line.indexOf(':')
      user = user || (ci >= 0 ? line.slice(0, ci) : line)
      pass = pass || (ci >= 0 ? line.slice(ci + 1) : '')
    } catch (e) {}
  }
  return { user: user || 'dj', pass: pass || 'changeme' }
}
const AUTH_PAIR = readAuth()
const AUTH_EXPECT = 'Basic ' + Buffer.from(AUTH_PAIR.user + ':' + AUTH_PAIR.pass).toString('base64')

// 外网第二凭据（task45 外网链路收尾）：config/auth-ext.txt 同 user:pass 格式（与 nginx 443 第一道 Basic 同套）；
// 串联双 Basic 单 Authorization 头限制，proxy 同时认两套，手机输一次外网凭据即过两道；文件缺失/格式坏=仅内网凭据
function readAuthExt() {
  try {
    // task166 P2-4：同 readAuth，只按首个冒号切分（密码含冒号不再截断）
    const raw = fs.readFileSync(path.join(CONFIG, 'auth-ext.txt'), 'utf8').trim()
    const nl = raw.search(/[\r\n]/)
    const line = nl >= 0 ? raw.slice(0, nl) : raw
    const ci = line.indexOf(':')
    if (ci <= 0 || ci >= line.length - 1) return null
    return 'Basic ' + Buffer.from(line).toString('base64')
  } catch (e) { return null }
}
const AUTH_EXT_EXPECT = readAuthExt()
// task221 产出审 P2：退化配置自检——两套凭据相同则「exec 只认内网主密码」的隔离形同虚设，启动即警示
if (AUTH_EXT_EXPECT !== null && AUTH_EXT_EXPECT === AUTH_EXPECT) {
  console.warn('[littleDJ] 警告：config/auth.txt 与 config/auth-ext.txt 内容相同——/_exec 仅认内网凭据的隔离失效，请为外网凭据设置不同密码')
}

// DeepSeek 官方凭据：权威副本在 deveco 凭据库 auth.json（600 权限、不入 git），proxy 只读写它
const DEVECO_AUTH_FILE = path.join(os.homedir(), '.local', 'share', 'deveco', 'auth.json')
// 命名 Key 库：本机 config/apikeys.json（600，不入 git）；权威生效副本仍写 deveco 凭据库
const APIKEYS_FILE = path.join(CONFIG, 'apikeys.json')
// 智谱官方 Token Plan（GLM Coding Plan）：OpenAI 兼容接口 + 配额查询
const ZHIPU_PROVIDER = 'zhipuai-coding-plan'
const ZHIPU_BASE = 'https://open.bigmodel.cn/api/coding/paas/v4'
const ZHIPU_QUOTA_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'
const ZHIPU_KEYS_FILE = path.join(CONFIG, 'zhipu-keys.json')
/* task328：火山方舟（Volcengine Ark，豆包 Doubao 系）——OpenAI 兼容 /api/v3，key 存本机 volc-keys.json（600、不入 git），
   权威生效副本写 deveco 凭据库 auth.json 的 volcengine 段（与 DS/GLM 同规）。火山无余额查询接口，卡片不挂余额行。 */
const VOLC_PROVIDER = 'volcengine'
const VOLC_BASE = 'https://ark.cn-beijing.volces.com/api/v3'
const VOLC_KEYS_FILE = path.join(CONFIG, 'volc-keys.json')
/* task337：模型别名库（跨设备同步）——本机 config/model-alias.json（600、不入 git）；
   结构 { alias: { "<providerID>/<modelID>": "别名" }, savedAt }。key 与前端 modelKey 同构
   （含 [1m] 拆行后缀）。前端 localStorage['littledj.modelAlias'] 为旧单机存储，
   启动时 syncModelAliasBoot 迁移合并上行后清除（服务端单源化）。 */
const MODEL_ALIAS_FILE = path.join(CONFIG, 'model-alias.json')
const MODEL_ALIAS_BAK = path.join(CONFIG, 'model-alias.json.bak')
/* task337（御审 P1-2）：modelID 段允许内含 /（如 volcengine/deepseek-ai/DeepSeek-V3.1 第三方自定义接入点），
   provider 段仍限小写-；[1m] 拆行后缀保持合法。 */
const ALIAS_KEY_RE = /^[a-z0-9-]+\/[A-Za-z0-9._\[\]\/-]+$/
function cleanAliasMap(map) {
  const clean = {}
  Object.keys(map || {}).forEach(function (k) {
    const v = map[k]
    if (ALIAS_KEY_RE.test(k) && typeof v === 'string' && v.trim()) clean[k] = v.trim().slice(0, 64)
  })
  if (Object.keys(clean).length > 200) throw new Error('别名条目超限（>200）')
  return clean
}
function readModelAlias() {
  const j = readJson(MODEL_ALIAS_FILE, null)
  const out = {}
  if (j && j.alias && typeof j.alias === 'object') {
    Object.keys(j.alias).forEach(function (k) {
      const v = j.alias[k]
      if (ALIAS_KEY_RE.test(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 64)
    })
  }
  return out
}
function readModelAliasSavedAt() {
  const j = readJson(MODEL_ALIAS_FILE, null)
  return (j && Number(j.savedAt)) || 0
}
/* task343：写前备份 + 拒空覆写 + 原子落盘。
   事故：task337 生产断言「清探针归零」把真实别名库清成 {}（2026-11-16 01:20:01），前端旧副本已迁移清除 → 别名全丢。
   守卫：入参清洗后为空且现有库非空 → 抛 ALIAS_EMPTY_GUARD（确认清空必须 force:true）；写前把非空旧库复制到 .bak。
   原子：先写 .tmp 再 rename，避免进程中断留下半截 JSON。 */
function writeModelAlias(map, opts) {
  const clean = cleanAliasMap(map)
  const cur = readModelAlias()
  const force = !!(opts && opts.force)
  if (!Object.keys(clean).length && Object.keys(cur).length && !force) {
    const e = new Error('拒绝清空非空别名库（确认清空请带 force:true）')
    e.code = 'ALIAS_EMPTY_GUARD'
    throw e
  }
  try {
    if (Object.keys(cur).length) {
      fs.copyFileSync(MODEL_ALIAS_FILE, MODEL_ALIAS_BAK)
      try { fs.chmodSync(MODEL_ALIAS_BAK, 0o600) } catch (e) {}
    }
  } catch (e) {}
  const tmp = MODEL_ALIAS_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ alias: clean, savedAt: Date.now() }, null, 2))
  try { fs.chmodSync(tmp, 0o600) } catch (e) {}
  fs.renameSync(tmp, MODEL_ALIAS_FILE)
  try { fs.chmodSync(MODEL_ALIAS_FILE, 0o600) } catch (e) {} /* task343：600 尽力而为；本机 FUSE 实测 660（同 apikeys.json 惯例），勿据此改鉴权假设 */
  return clean
}
function readKeyStore(file) {
  const j = readJson(file, null)
  if (!j || !Array.isArray(j.keys)) return { active: '', keys: [] }
  return { active: String(j.active || ''), keys: j.keys.filter(function (k) { return k && k.name && k.key }) }
}
let KEYSTORE_CHMOD_WARNED = false // task379：chmod 失败限频标志（只告警首次）
function writeKeyStore(file, j) {
  writeJson(file, { active: j.active || '', keys: j.keys || [] })
  try { fs.chmodSync(file, 0o600) } catch (e) {
    /* task379：权限失败不再静默吞（实测 vault.key 0660≠设计 0600 长期无人知）；
       限频一次 + 脱敏（只打路径与 errno，零密钥数据；chmod 的 e.message 仅含路径与操作码） */
    if (!KEYSTORE_CHMOD_WARNED) {
      KEYSTORE_CHMOD_WARNED = true
      console.warn('[littleDJ] keystore chmod 600 失败（权限可能过宽，建议人工核对）: ' + file + ' code=' + (e && e.code) + ' msg=' + (e && e.message))
    }
  }
}
function readApiKeys() { return readKeyStore(APIKEYS_FILE) }
function writeApiKeys(j) { writeKeyStore(APIKEYS_FILE, j) }
function readZhipuKeys() { return readKeyStore(ZHIPU_KEYS_FILE) }
function writeZhipuKeys(j) { writeKeyStore(ZHIPU_KEYS_FILE, j) }
function readVolcKeys() { return readKeyStore(VOLC_KEYS_FILE) }
function writeVolcKeys(j) { writeKeyStore(VOLC_KEYS_FILE, j) }
function findNamedKey(name) {
  return readApiKeys().keys.filter(function (k) { return k.name === name })[0] || null
}
function findZhipuKey(name) {
  return readZhipuKeys().keys.filter(function (k) { return k.name === name })[0] || null
}
function findVolcKey(name) {
  return readVolcKeys().keys.filter(function (k) { return k.name === name })[0] || null
}
function readDeepseekKey() {
  try {
    const j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8'))
    const k = j && j.deepseek && j.deepseek.key
    return (typeof k === 'string') ? k : ''
  } catch (e) { return '' }
}
function hasStoredCredential() {
  try {
    const j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8'))
    return !!(j && j.deepseek && j.deepseek.key)
  } catch (e) { return false }
}
function writeDeepseekKey(key) {
  let j = {}
  try { j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8')) || {} } catch (e) {}
  j.deepseek = Object.assign({}, j.deepseek, { type: 'api', key: key })
  fs.writeFileSync(DEVECO_AUTH_FILE, JSON.stringify(j, null, 2))
}
function readZhipuKey() {
  try {
    const j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8'))
    const k = j && j[ZHIPU_PROVIDER] && j[ZHIPU_PROVIDER].key
    return (typeof k === 'string') ? k : ''
  } catch (e) { return '' }
}
function hasStoredZhipuCredential() {
  try {
    const j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8'))
    return !!(j && j[ZHIPU_PROVIDER] && j[ZHIPU_PROVIDER].key)
  } catch (e) { return false }
}
function writeZhipuKey(key) {
  let j = {}
  try { j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8')) || {} } catch (e) {}
  j[ZHIPU_PROVIDER] = Object.assign({}, j[ZHIPU_PROVIDER], { type: 'api', key: key })
  fs.writeFileSync(DEVECO_AUTH_FILE, JSON.stringify(j, null, 2))
}
function resolveZhipuKey(apiKey) {
  let key = apiKey ? String(apiKey).trim() : readZhipuKey()
  if (!key) { const rec = findZhipuKey(readZhipuKeys().active); if (rec) key = rec.key }
  return key
}
/* task328：火山方舟凭据（读写口径与 DS/GLM 完全一致，只是 auth.json 段名换成 volcengine） */
function readVolcKey() {
  try {
    const j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8'))
    const k = j && j[VOLC_PROVIDER] && j[VOLC_PROVIDER].key
    return (typeof k === 'string') ? k : ''
  } catch (e) { return '' }
}
function hasStoredVolcCredential() {
  try {
    const j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8'))
    return !!(j && j[VOLC_PROVIDER] && j[VOLC_PROVIDER].key)
  } catch (e) { return false }
}
function writeVolcKey(key) {
  let j = {}
  try { j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8')) || {} } catch (e) {}
  j[VOLC_PROVIDER] = Object.assign({}, j[VOLC_PROVIDER], { type: 'api', key: key })
  fs.writeFileSync(DEVECO_AUTH_FILE, JSON.stringify(j, null, 2))
}
function resolveVolcKey(apiKey) {
  let key = apiKey ? String(apiKey).trim() : readVolcKey()
  if (!key) { const rec = findVolcKey(readVolcKeys().active); if (rec) key = rec.key }
  return key
}
function maskKey(k) {
  k = (typeof k === 'string') ? k : ''
  if (!k) return ''
  return k.length > 12 ? k.slice(0, 6) + '****' + k.slice(-4) : '****'
}

// 响应收尾：攒 body + 尝试 JSON.parse（直连/隧道两链共用，勿复制两份）
function absorbJson(pres, cb) {
  let b = ''
  pres.on('data', function (c) { b += c })
  pres.on('end', function () {
    let d = null
    try { d = JSON.parse(b) } catch (e) {}
    cb(null, pres.statusCode || 0, d, b)
  })
}

// 通用 HTTPS GET（10 秒超时，返回 { code, body, raw }）
function httpsGetJson(url, headers, cb) {
  let u
  try { u = new URL(url) } catch (e) { return cb(e) }
  const r = https.request({
    hostname: u.hostname, path: u.pathname + (u.search || ''), method: 'GET', timeout: 10000,
    headers: Object.assign({ accept: 'application/json' }, headers || {})
  }, function (pres) { absorbJson(pres, cb) })
  r.on('timeout', function () { r.destroy(); cb(new Error('连接超时（10 秒）')) })
  r.on('error', function (e) { cb(e) })
  r.end()
}

// 智谱配额返回解析：识别 5 小时 / 一周两个百分比（unit 3=小时、6=天、4=周；未知时按顺序兜底）
function parseZhipuQuota(body) {
  const root = (body && body.data) || body || {}
  const limits = Array.isArray(root.limits) ? root.limits : []
  const items = limits.filter(function (l) { return l && l.percentage != null }).map(function (l) {
    return {
      type: l.type || '', unit: l.unit, number: l.number,
      percentage: Number(l.percentage),
      resetAt: l.nextResetTime || l.next_reset_time || null
    }
  })
  const durMs = function (it) {
    const n = Number(it.number) || 0, u = Number(it.unit)
    if (u === 3) return n * 3600000
    if (u === 4) return n * 604800000
    if (u === 6) return n * 86400000
    return 0
  }
  const known = items.filter(function (it) { return durMs(it) > 0 }).sort(function (a, b) { return durMs(a) - durMs(b) })
  let five = null, week = null
  if (known.length >= 2) { five = known[0]; week = known[known.length - 1] }
  else if (known.length === 1) { five = known[0]; week = items.filter(function (it) { return it !== five })[0] || null }
  else if (items.length) { five = items[0]; week = items[1] || null }
  return { fiveHour: five, week: week, raw: items }
}

function authed(req) {
  /* task295 A1：设备通行证 cookie（内外网均认）——HMAC 验签+在册未吊销+未过期；
     吊销/过期/表损坏即时失效（fail-closed），Basic 通道不受影响 */
  if (passVerify(req.headers.cookie)) return true
  const h = req.headers['authorization'] || ''
  /* task297 安全纵深：经反代的公网流量（外网 nginx 必带 X-Real-IP）只认外网强凭据 auth-ext，
     砍掉弱主密码经公网链路被慢试的缺口（判据镜像 /_exec task221）；本机/内网直连无此头，行为不变 */
  if ('x-real-ip' in req.headers) return AUTH_EXT_EXPECT !== null && h === AUTH_EXT_EXPECT
  return h === AUTH_EXPECT || (AUTH_EXT_EXPECT !== null && h === AUTH_EXT_EXPECT)
}

/* task303：鉴权防错锁定——同一来源连续错 AUTH_LOCK_MAX 次（默认 5）→ 锁 AUTH_LOCK_MS（默认 15 分钟），
   连续触发指数退避封顶 2 小时；一次成功即清零。锁定中凭据正确也拒（429），在线爆破死路。
   内存态（proxy 重启清零）；应急闸 env AUTH_LOCK_OFF=1 整体关闭；阈值/时长可用 env 调（自测用）。 */
const AUTH_LOCK_MAX = Number(process.env.AUTH_LOCK_MAX) > 0 ? Number(process.env.AUTH_LOCK_MAX) : 5
const AUTH_LOCK_MS = Number(process.env.AUTH_LOCK_MS) > 0 ? Number(process.env.AUTH_LOCK_MS) : 15 * 60 * 1000
const AUTH_LOCK_CAP = 2 * 60 * 60 * 1000
const authFails = new Map() // 来源 -> { fails, lockedUntil, streak }
function authIpOf (req) {
  const xr = req.headers['x-real-ip']
  if (xr !== undefined) return 'px:' + String(xr)
  return String((req.socket && req.socket.remoteAddress) || '?')
}
function authLocked (req) {
  if (process.env.AUTH_LOCK_OFF === '1') return false
  const st = authFails.get(authIpOf(req))
  return !!(st && st.lockedUntil > Date.now())
}
/* task295：累计失败抽出共用（/_login 凭据校验失败同桶计数，A2「只计凭据校验失败」） */
function bumpAuthFails (ip) {
  let st = authFails.get(ip)
  if (!st) { st = { fails: 0, lockedUntil: 0, streak: 0 }; authFails.set(ip, st) }
  st.fails += 1
  if (st.fails >= AUTH_LOCK_MAX) {
    st.streak += 1
    st.lockedUntil = Date.now() + Math.min(AUTH_LOCK_MS * Math.pow(2, st.streak - 1), AUTH_LOCK_CAP)
    st.fails = 0
  }
}
function authGuard (req) {
  /* task303-fu1：正确凭据永远放行（含锁定期）——换密码后浏览器旧记住凭据会自动连错把主人锁死（主人实测被锁），
     必须保留「输对即时解锁」自救通道；攻击者不知正确凭据，锁定限速语义不受影响 */
  if (authed(req)) {
    authFails.delete(authIpOf(req))
    return true
  }
  if (authLocked(req)) return false
  if (process.env.AUTH_LOCK_OFF !== '1') {
    /* task295 产出审 P1-1（R2-P1-4 口径）：只计「携带凭据且校验失败」——匿名 401（旧 PWA SSE 3s 重连、
       探针、扫描器）一律不计数，防匿名流量把主人 IP 锁死 */
    const hasCred = !!(req.headers['authorization'] || /(?:^|;\s*)dj_pass=/.test(String(req.headers['cookie'] || '')))
    if (hasCred) bumpAuthFails(authIpOf(req))
    if (authFails.size > 1000) {
      const now = Date.now()
      authFails.forEach(function (v, k) { if (v.lockedUntil < now && v.fails === 0) authFails.delete(k) })
    }
  }
  return false
}

/* ---------- task295：设备通行证（手机免密 90 天）----------
   机制：POST /_login 验密码（外网只验 auth-ext，A2）→ Set-Cookie dj_pass=<did>.<expMs>.<hmac>
   （HttpOnly / SameSite=Lax / Path=/ / host-only 无 Domain / 外网 https 条件 Secure，A1）→ 90 天有效。
   验签：格式正则白名单 + exp 强制 + timingSafeEqual + devices 表在册且未吊销；
   devices.json 损坏 fail-closed（拒全部 cookie，Basic 兜底），写前 .bak、原子 tmp→rename。
   吊销即时（A6）：did→Set(活跃长响应)，revoke/logout 时 res.destroy() 断流（≤2s）。
   密钥轮换：删 device-key.txt 重启=新 key+全员重登（日志说明）。 */
const DEVKEY_FILE = path.join(CONFIG, 'device-key.txt')
const DEVICES_FILE = path.join(CONFIG, 'devices.json')
const PASS_COOKIE = 'dj_pass'
const PASS_TTL_MS = 90 * 24 * 3600 * 1000
const DEVICES_MAX = 50
const REVOKED_KEEP_MS = 30 * 24 * 3600 * 1000
const DEVICE_TOUCH_MS = 5 * 60 * 1000
/* task359：工具 UA（curl/node/wget/空 UA 等非浏览器客户端）登记的设备=后台测试设备——
   24h 无活动自动吊销 + GET /_devices 不返回（主人 2026-11-16 拍板：测试垃圾后台自清，前台零显示）。
   判定口径：UA 非 "Mozilla/" 前缀即工具（浏览器含鸿蒙/Windows/手机一律 Mozilla 前缀）；
   TTL 可用 env LITTLEDJ_TOOL_TTL_MS 覆盖（自测用短 TTL）。设备全量真相仍在 devices.json（含 revoked），审计走文件。 */
const TOOL_TTL_MS = Number(process.env.LITTLEDJ_TOOL_TTL_MS) > 0 ? Number(process.env.LITTLEDJ_TOOL_TTL_MS) : 24 * 3600 * 1000
function isToolUa(ua) { return String(ua == null ? '' : ua).indexOf('Mozilla/') !== 0 }
const PASS_RE = /^([0-9a-f]{16})\.(\d{1,16})\.([0-9a-f]{64})$/

function loadDevKey() {
  try {
    const k = fs.readFileSync(DEVKEY_FILE, 'utf8').trim()
    if (/^[0-9a-f]{64}$/.test(k)) return k
  } catch (e) {}
  const k = crypto.randomBytes(32).toString('hex')
  fs.mkdirSync(path.dirname(DEVKEY_FILE), { recursive: true })
  const tmp = DEVKEY_FILE + '.tmp'
  fs.writeFileSync(tmp, k + '\n')
  try { fs.chmodSync(tmp, 0o600) } catch (e) {}
  fs.renameSync(tmp, DEVKEY_FILE)
  console.log('[littleDJ] task295: 已生成设备通行证密钥 device-key.txt（删除该文件重启=全员重登）')
  return k
}
const DEVKEY = loadDevKey()
// A8：other 位断言（FUSE 平台 660 实测限制见 L-090，other 位必为 0）
try {
  const st = fs.statSync(DEVKEY_FILE)
  if ((st.mode & 0o007) !== 0) console.warn('[littleDJ] task295 警告：device-key.txt other 位可读（mode ' + (st.mode & 0o777).toString(8) + '）')
} catch (e) {}

function devicesLoad() {
  try {
    const j = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'))
    if (j && Array.isArray(j.devices)) return { devices: j.devices.filter(function (d) { return d && typeof d.did === 'string' }) }
    throw new Error('bad shape')
  } catch (e) {
    try {
      const j = JSON.parse(fs.readFileSync(DEVICES_FILE + '.bak', 'utf8'))
      if (j && Array.isArray(j.devices)) {
        console.warn('[littleDJ] task295: devices.json 损坏，已从 .bak 恢复（期间签发的通行证需重登）')
        return { devices: j.devices.filter(function (d) { return d && typeof d.did === 'string' }) }
      }
    } catch (e2) {}
    console.warn('[littleDJ] task295: devices.json 缺失/损坏——通行证全部失效（fail-closed），Basic 登录不受影响')
    return { devices: [] }
  }
}
const devicesState = devicesLoad()
let devicesLastFlush = Date.now()
/* task369：设备表满时的淘汰顺序——工具 UA（脚本/headless 测试机）先走，浏览器设备最后走。
   原实现只按 lastSeenAt 淘汰，测试机把主人 90 天设备挤掉 → 桌面「变回登录页」，2026-11-16 实测。 */
function evictOrder(alive) {
  const tools = alive.filter(function (d) { return isToolUa(d.ua) }).sort(function (a, b) { return (a.lastSeenAt || 0) - (b.lastSeenAt || 0) })
  const browsers = alive.filter(function (d) { return !isToolUa(d.ua) }).sort(function (a, b) { return (a.lastSeenAt || 0) - (b.lastSeenAt || 0) })
  return tools.concat(browsers)
}
function devicesFlush(force) {
  const now = Date.now()
  if (!force && now - devicesLastFlush < DEVICE_TOUCH_MS) return
  devicesLastFlush = now
  try {
    /* task359：工具 UA 设备超 TTL 无活动 → 自动吊销（后台清垃圾；吊销即时断流走 passCut，
       revoked 记录按既有 REVOKED_KEEP_MS 30 天后 prune）。浏览器设备不受影响。 */
    let toolKilled = 0
    const tNow = Date.now()
    devicesState.devices.forEach(function (d) {
      if (!d.revoked && isToolUa(d.ua) && tNow - (d.lastSeenAt || 0) > TOOL_TTL_MS) {
        d.revoked = true
        d.revokedAt = tNow
        d.revokeReason = 'tool-ttl'
        passCut(d.did)
        toolKilled++
      }
    })
    if (toolKilled > 0) console.log('[littleDJ] task359: 自动清理后台测试设备 ' + toolKilled + ' 台（工具 UA 超时 ' + Math.round(TOOL_TTL_MS / 3600000) + 'h）')
    /* 产出审 P2-3/P2-4：先裁超保留期 revoked，再按 lastSeen 裁 alive（原实现先裁 alive 与注释相反）；
       .bak 在 rename 成功后才更新=始终为「最近一次成功写」（防主表损坏时 .bak 复活已吊销设备/坏档覆盖好备份） */
    const alive = devicesState.devices.filter(function (d) { return !d.revoked })
    const keptRevoked = devicesState.devices.filter(function (d) { return d.revoked && now - (d.revokedAt || 0) < REVOKED_KEEP_MS })
    let keep = alive.concat(keptRevoked)
    if (keep.length > DEVICES_MAX) {
      const drop = new Set(evictOrder(alive).slice(0, keep.length - DEVICES_MAX).map(function (d) { return d.did }))
      keep = keep.filter(function (d) { return !drop.has(d.did) })
    }
    devicesState.devices = keep
    const tmp = DEVICES_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ devices: keep }, null, 2))
    fs.renameSync(tmp, DEVICES_FILE)
    try { fs.copyFileSync(DEVICES_FILE, DEVICES_FILE + '.bak') } catch (e0) {}
    try { fs.chmodSync(DEVICES_FILE, 0o600) } catch (e1) {}
  } catch (e) { console.error('[littleDJ] task295: devices.json 落盘失败：' + (e && e.message)) }
}
function cut40(s, n) { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n) }
/* task359：小时级巡扫——没有新登录触发 flush 时，后台垃圾也能到点自清（unref 不阻进程退出；服务常驻生命周期） */
const toolSweepTimer = setInterval(function () { devicesFlush(true) }, 60 * 60 * 1000)
if (typeof toolSweepTimer.unref === 'function') toolSweepTimer.unref()
function touchDevice(dev) {
  const now = Date.now()
  if (now - (dev.lastSeenAt || 0) < DEVICE_TOUCH_MS) return
  dev.lastSeenAt = now
  devicesFlush(false)
}
function passSign(did, expMs) {
  return crypto.createHmac('sha256', DEVKEY).update(did + '.' + expMs).digest('hex')
}
function passIssue(name, ua) {
  // 新 did 落表；未吊销台数达上限时踢 lastSeenAt 最旧一台（flush 里也会裁，双保险）
  const alive = devicesState.devices.filter(function (d) { return !d.revoked })
  if (alive.length >= DEVICES_MAX) {
    const kick = evictOrder(alive).slice(0, alive.length - DEVICES_MAX + 1)
    kick.forEach(function (d) { d.revoked = true; d.revokedAt = Date.now(); passCut(d.did) })
    console.log('[littleDJ] task295: 设备满 ' + DEVICES_MAX + ' 台，已自动注销最旧 ' + kick.length + ' 台')
  }
  const did = crypto.randomBytes(8).toString('hex')
  devicesState.devices.push({ did: did, name: cut40(name || '设备', 40), ua: cut40(ua, 40), createdAt: Date.now(), lastSeenAt: Date.now(), revoked: false })
  devicesFlush(true)
  return { did: did, expMs: Date.now() + PASS_TTL_MS }
}
function passVerify(cookieHeader) {
  if (!cookieHeader) return null
  let m = null
  const parts = String(cookieHeader).split(';')
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i].trim()
    if (p.indexOf(PASS_COOKIE + '=') === 0) { const mm = PASS_RE.exec(p.slice(PASS_COOKIE.length + 1)); if (mm) { m = mm; break } }
  }
  if (!m) return null
  const did = m[1], exp = Number(m[2]), mac = m[3]
  if (!/^\d+$/.test(m[2]) || exp <= Date.now() || exp > Date.now() + PASS_TTL_MS + 24 * 3600 * 1000) return null
  const expect = passSign(did, exp)
  const a = Buffer.from(mac), b = Buffer.from(expect)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  const dev = devicesState.devices.filter(function (d) { return d.did === did })[0]
  if (!dev || dev.revoked) return null
  touchDevice(dev)
  return { did: did, name: dev.name }
}
function passCookieHeader(t, isWan, req) {
  let c = t.cookie || (PASS_COOKIE + '=' + t.did + '.' + t.expMs + '.' + passSign(t.did, t.expMs))
  c += '; HttpOnly; SameSite=Lax; Path=/; Max-Age=' + Math.floor(PASS_TTL_MS / 1000)
  if (isWan || req.headers['x-forwarded-proto'] === 'https') c += '; Secure'
  return c
}
/* A6 吊销断流：did → Set(活跃长响应)；revoke/logout 时 destroy（SSE/长轮询全断） */
const passStreams = new Map()
function passReg(did, res) {
  let s = passStreams.get(did)
  if (!s) { s = new Set(); passStreams.set(did, s) }
  s.add(res)
  res.on('close', function () { const ss = passStreams.get(did); if (ss) { ss.delete(res); if (!ss.size) passStreams.delete(did) } })
}
function passCut(did) {
  const s = passStreams.get(did)
  if (!s) return 0
  const n = s.size
  s.forEach(function (res) { try { res.destroy() } catch (e) {} })
  passStreams.delete(did)
  return n
}
function revokeDevice(did) {
  const dev = devicesState.devices.filter(function (d) { return d.did === did })[0]
  if (!dev) return false
  dev.revoked = true
  dev.revokedAt = Date.now()
  devicesFlush(true)
  passCut(did)
  return true
}
/* A7 判定器：basicAuthed=凭据类型必须 Basic（cookie 不批，手机敏感区验证卡片用）；
   pubnetDeny=公网（X-Real-IP in headers，镜像 /_exec task221 判据）硬拒 403 的持久写口/破坏性/主目录读 */
function basicAuthed(req) {
  /* 产出审 P2-1：与 A3 同口径收窄——公网（X-Real-IP 在）只认 auth-ext；当前两钥同值无差异，防将来拆钥后口径漂移 */
  const h = req.headers['authorization'] || ''
  if ('x-real-ip' in req.headers) return AUTH_EXT_EXPECT !== null && h === AUTH_EXT_EXPECT
  return h === AUTH_EXPECT || (AUTH_EXT_EXPECT !== null && h === AUTH_EXT_EXPECT)
}
const PUBNET_DENY_WRITE = ['/_settings/prompts', '/_profile', '/_settings/deepseek', '/_settings/zhipu', '/_settings/volc', '/_settings/deepseek/delete', '/_settings/zhipu/delete', '/_settings/volc/delete', '/_model-alias', '/_fs/rmdir', '/_fs/rename', '/_import', '/_unimport', '/_vault/apply']
const PUBNET_DENY_GET = ['/_fs/home/read', '/_fs/home/raw', '/_vault/pick']
function pubnetDeny(method, pn) {
  if (method === 'GET') return PUBNET_DENY_GET.indexOf(pn) >= 0
  if (method === 'PUT' || method === 'POST') return PUBNET_DENY_WRITE.indexOf(pn) >= 0
  return false
}
function basicOnlyFace(pn) {
  return pn === '/_vault' || pn === '/_settings/deepseek/active' || pn === '/_settings/zhipu/active' || pn === '/_settings/volc/active'
}

/* task295 A4：静态壳白名单（登录卡片渲染所需最小集；全等匹配，decode 混淆路径不命中走鉴权闸）
   task369（2026-11-17 修「桌面小DJ打开了没有反应」）：模块化后壳文件不止 13 项——登录卡片本体在
   /src/app/boot.js，白名单里没有它 → 未登录访客的 /src/*.js 全 401 → 页面只剩静态死壳（无卡片、无 app）。
   现按前缀放行 /src/**（纯客户端代码，非数据），数据面（/api、/_fs 等）鉴权不变。
   路径穿越仍由 serveStatic 的 UI_DIR 前缀断言兜底（绝对路径不在 UI_DIR 内 → 403）。 */
const SHELL_FILES = ['/', '/index.html', '/manifest.webmanifest', '/favicon.ico', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/icon.svg', '/apple-touch-icon.png', '/src/core/dom.js', '/src/core/esc.js', '/src/app/markdown.js', '/src/app/imgviewer.js', '/sw.js']
const SHELL_PREFIXES = ['/src/']
function shellWhite(pn) {
  if (SHELL_FILES.indexOf(pn) >= 0) return true
  for (let i = 0; i < SHELL_PREFIXES.length; i++) if (pn.indexOf(SHELL_PREFIXES[i]) === 0) return true
  return false
}
function serveShell(req, res, pn) { return serveStatic(req, res, pn) }

/* ---------- task369：桌面免密自动登录（一次性票据） ----------
   背景：Windows 桌面图标点开只见到死壳（无 cookie → 模块 401 → 连登录卡片都加载不出来），
   每次重登还要手输 24 位密码。方案：本地启动器带 Basic 找设备现签一张 ≤5 分钟票据
   （GET /_ticket），浏览器打开 /_login?e&k 验票 → Set-Cookie 90 天通行证 → 302 回 /。
   票据按「槽位」复用同一 did（HMAC(DEVKEY,'slot:'+name)），反复启动不会把设备表撑爆；
   槽位被吊销则拒签（吊销优先于自动登录）。 */
const TICKET_TTL_MS = 5 * 60 * 1000
function ticketName(ua) { return String(ua || '').indexOf('Windows NT') >= 0 ? 'Windows 电脑' : '电脑' }
function ticketSign(e) { return crypto.createHmac('sha256', DEVKEY).update('tk:' + e).digest('hex') }
function slotDid(name) { return crypto.createHmac('sha256', DEVKEY).update('slot:' + name).digest('hex').slice(0, 16) }
function handleTicketIssue(req, res) {
  if (!basicAuthed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
  const e = Date.now() + TICKET_TTL_MS
  return json(res, 200, { ok: true, exp: e, ttlMs: TICKET_TTL_MS, url: '/_login?e=' + e + '&k=' + ticketSign(e) })
}
function handleTicketLogin(req, res, urlObj) {
  const now = Date.now()
  const e = Number(urlObj.searchParams.get('e') || 0)
  const k = String(urlObj.searchParams.get('k') || '')
  if (!e || !/^\d{1,16}$/.test(String(e)) || e <= now || e > now + TICKET_TTL_MS + 60 * 1000) {
    return json(res, 403, { ok: false, error: '登录票据已过期，请重新打开桌面图标' })
  }
  if (!safeEqConst(k, ticketSign(e))) return json(res, 403, { ok: false, error: '登录票据无效' })
  const name = ticketName(req.headers['user-agent'])
  const did = slotDid(name)
  let dev = devicesState.devices.filter(function (d) { return d.did === did })[0]
  /* 槽位被吊销：回首页让登录卡片出现（浏览器里一段 JSON 403 对主人没有意义） */
  if (dev && dev.revoked) {
    res.writeHead(302, { 'Location': '/', 'Cache-Control': 'no-store' })
    return res.end()
  }
  if (!dev) {
    dev = { did: did, name: name, ua: cut40(req.headers['user-agent'], 40), createdAt: now, lastSeenAt: now, revoked: false }
    devicesState.devices.push(dev)
  } else {
    dev.name = name
    dev.ua = cut40(req.headers['user-agent'], 40)
    dev.lastSeenAt = now
  }
  devicesFlush(true)
  console.log('[littleDJ] task369: 桌面票据登录 did=' + did + ' name=' + name)
  const t = { did: did, expMs: now + PASS_TTL_MS }
  res.writeHead(302, {
    'Set-Cookie': passCookieHeader(t, 'x-real-ip' in req.headers, req),
    'Location': '/',
    'Cache-Control': 'no-store'
  })
  return res.end()
}
/* task295 A2：登录（恒时比较；外网只验 auth-ext、内网两套均验；失败不区分用户/密码错；成功重置锁定）
   ⚠ task303-fu1 教训同源：正确密码永远放行（防浏览器自动重试把主人锁死）——锁定只拦「密码错误」的请求 */
function safeEqConst(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b))
  if (ba.length !== bb.length) return false
  return crypto.timingSafeEqual(ba, bb)
}
function handleLogin(req, res) {
  const isWan = 'x-real-ip' in req.headers
  return readBody(req, function (err, d) {
    if (err) return json(res, 400, { ok: false, error: '请求格式不对' })
    const user = String((d && d.user) || '')
    const pass = String((d && d.pass) || '')
    const name = cut40(String((d && d.name) || '').trim() || '手机', 40)
    const tryV = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64')
    const okMain = safeEqConst(tryV, AUTH_EXPECT)
    const okExt = AUTH_EXT_EXPECT !== null && safeEqConst(tryV, AUTH_EXT_EXPECT)
    const ok = isWan ? okExt : (okMain || okExt)
    if (ok) {
      authFails.delete(authIpOf(req))
      const t = passIssue(name, req.headers['user-agent'])
      res.writeHead(200, {
        'Set-Cookie': passCookieHeader(t, isWan, req),
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json; charset=utf-8'
      })
      return res.end(JSON.stringify({ ok: true, did: t.did, name: name }))
    }
    if (authLocked(req)) {
      const st = authFails.get(authIpOf(req))
      const wait = st && st.lockedUntil > Date.now() ? Math.ceil((st.lockedUntil - Date.now()) / 1000) : 900
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': String(wait), 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify({ ok: false, error: '尝试次数过多，已临时锁定，请 ' + wait + ' 秒后再试' }))
    }
    if (process.env.AUTH_LOCK_OFF !== '1') bumpAuthFails(authIpOf(req))
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify({ ok: false, error: '用户名或密码不对' }))
  })
}
/* task295 A5/R2-P2-1：探针仅认 cookie——Basic 头也 401（防 Basic 200 启动后 SSE 无凭据循环重连）
   产出审 P2-2：200/401 均 no-store（不缓存认证状态） */
function handleAuthProbe(req, res) {
  const pv = passVerify(req.headers.cookie)
  if (!pv) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    return res.end(JSON.stringify({ ok: false }))
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY' })
  return res.end(JSON.stringify({ ok: true, did: pv.did, name: pv.name }))
}
function handleLogout(req, res) {
  const pv = passVerify(req.headers.cookie)
  if (pv) revokeDevice(pv.did)
  res.writeHead(200, {
    'Set-Cookie': PASS_COOKIE + '=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
    'Content-Type': 'application/json; charset=utf-8'
  })
  return res.end(JSON.stringify({ ok: true }))
}
function handleDevices(req, res, urlObj) {
  if (req.method === 'GET') {
    /* task359：列表只回浏览器设备（工具 UA 不返回——测试垃圾前台零显示，自动吊销归后台；
       全量真相含 revoked 在 devices.json，审计走文件；POST 踢除按 did 不受此过滤影响） */
    return json(res, 200, { ok: true, devices: devicesState.devices.filter(function (d) { return !isToolUa(d.ua) }).map(function (d) {
      return { did: d.did, name: d.name, ua: d.ua, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, revoked: !!d.revoked }
    }) })
  }
  if (req.method === 'POST') {
    /* 踢除设备须 Basic 头（R2 裁决：防被窃 cookie 反踢全设备自锁）；前端做密码二次确认 */
    if (!basicAuthed(req)) return json(res, 401, { ok: false, error: '踢除设备需要再次验证密码', basicOnly: true })
    return readBody(req, function (err, d) {
      if (err) return json(res, 400, { ok: false, error: '请求格式不对' })
      const did = String((d && d.did) || '')
      if (!/^[0-9a-f]{16}$/.test(did)) return json(res, 400, { ok: false, error: '设备号格式不对' })
      const ok = revokeDevice(did)
      return json(res, 200, { ok: ok })
    })
  }
  return json(res, 405, { ok: false, error: 'method not allowed' })
}

/* task221：DJH 最高权限通道（主人授权「完全操控鸿蒙 PC」，POST /_exec）----------
   安全闸三层（方案审 censor-deepseek P0-1 修法）：
   ① X-Real-IP 存在=公网 nginx 反代穿透（remoteAddress 会被改写成 127.0.0.1）→ 一律 403（镜像 /_procs/kill 判据）
   ② 只认内网主密码 AUTH_EXPECT，不认 auth-ext 外网凭据（execAuthed 独立于 authed）
   ③ remoteAddress 私网判定（纵深防御）
   审计 data/exec-audit.jsonl 逐条留痕（8MB 滚存一代 .old；写失败不阻断响应） */
const EXEC_AUDIT_FILE = path.join(ROOT, 'data', 'exec-audit.jsonl')
const EXEC_AUDIT_MAX = 8 * 1024 * 1024
const EXEC_HEAD_KEEP = 60 * 1024
const EXEC_TAIL_KEEP = 4 * 1024
const EXEC_MAX_PARALLEL = 2
let execRunning = 0

function execAuthed(req) {
  return (req.headers['authorization'] || '') === AUTH_EXPECT
}

function execIpPrivate(raw) {
  let ip = String(raw || '')
  if (ip.indexOf('::ffff:') === 0) ip = ip.slice(7)
  if (!ip) return false
  if (ip === '::1') return true
  if (/^127\./.test(ip)) return true
  if (/^10\./.test(ip)) return true
  if (/^192\.168\./.test(ip)) return true
  const m = /^172\.(\d{1,3})\./.exec(ip)
  if (m) { const n = Number(m[1]); return n >= 16 && n <= 31 }
  return /^fe80:/i.test(ip)
}

// 按码点安全截断（不把 UTF-16 代理对切半，方案审 P2-1）
function execCutStr(s, n) {
  if (typeof s !== 'string' || s.length <= n) return s || ''
  let cut = n
  const code = s.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut -= 1
  return s.slice(0, cut)
}

// 边收边截（方案审 P1-2）：头 60KB + 尾 4KB 环形保留，全程不持有全量输出（大 chunk 中间态 ≤ 4KB+chunk 大小）
function execOutLimiter() {
  let head = ''
  let tail = ''
  let dropped = 0
  return {
    push: function (c) {
      let s = String(c || '')
      if (!s) return
      if (head.length < EXEC_HEAD_KEEP) {
        const need = EXEC_HEAD_KEEP - head.length
        if (s.length <= need) { head += s; return }
        head += s.slice(0, need)
        s = s.slice(need)
      }
      tail += s
      if (tail.length > EXEC_TAIL_KEEP) {
        dropped += tail.length - EXEC_TAIL_KEEP
        tail = tail.slice(tail.length - EXEC_TAIL_KEEP)
      }
    },
    text: function () {
      if (!dropped) return head + tail
      return head + '\n…[截断 ' + dropped + ' 字符]…\n' + tail
    }
  }
}

function execAudit(rec) {
  try {
    fs.mkdirSync(path.dirname(EXEC_AUDIT_FILE), { recursive: true })
    try { if (fs.statSync(EXEC_AUDIT_FILE).size > EXEC_AUDIT_MAX) fs.renameSync(EXEC_AUDIT_FILE, EXEC_AUDIT_FILE + '.old') } catch (e1) {}
    fs.appendFileSync(EXEC_AUDIT_FILE, JSON.stringify(rec) + '\n')
  } catch (e) { console.error('[littleDJ] exec audit write failed: ' + (e && e.message)) }
}

/* ---------- 休息态（task71 S2b）：config/rest-mode.json 是唯一真相源 ----------
   读：缺失/坏档/结构非法 → on:false（fail-open=在线，不抛错）。
   写：同目录 tmp → renameSync、0600；失败清 tmp 并抛错，由调用方 500，缓存不动（fail-closed）。
   缓存：mtime+size 1s 窗口；写入成功后立即失效，保证同轮可见。 */
const REST_FILE = path.join(CONFIG, 'rest-mode.json')
const REST_AUDIT_FILE = path.join(CONFIG, 'rest-audit.jsonl')
const REST_WATERMARK = '【当前模式：休息中'
const REST_ON_SPOKEN = ['我去休息了', '我去睡了', '我休息了']
const REST_OFF_SPOKEN = ['我回来了', '我上线了', '上线了']
let restCache = null // { at, mtimeMs, size, value }

function restDefault() {
  return { on: false, since: null, source: null, by: '主人', rev: 0, updated: 0 }
}

function restNormalize(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return restDefault()
  const on = j.on === true
  const sinceNum = Number(j.since)
  return {
    on: on,
    since: (on && isFinite(sinceNum) && sinceNum > 0) ? sinceNum : null,
    source: (j.source === 'spoken' || j.source === 'button') ? j.source : null,
    by: (typeof j.by === 'string' && j.by) ? j.by : '主人',
    rev: isFinite(Number(j.rev)) ? Number(j.rev) : 0,
    updated: isFinite(Number(j.updated)) ? Number(j.updated) : 0
  }
}

function restRead() {
  try {
    const st = fs.statSync(REST_FILE)
    if (restCache && restCache.mtimeMs === st.mtimeMs && restCache.size === st.size && (Date.now() - restCache.at) < 1000) {
      return restCache.value
    }
    const v = restNormalize(JSON.parse(fs.readFileSync(REST_FILE, 'utf8')))
    restCache = { at: Date.now(), mtimeMs: st.mtimeMs, size: st.size, value: v }
    return v
  } catch (e) {
    // ENOENT / 坏 JSON / 权限异常一律 fail-open=在线；不写、不抛
    restCache = null
    return restDefault()
  }
}

function restWrite(state) {
  const tmp = REST_FILE + '.tmp-' + process.pid + '-' + Date.now()
  try {
    fs.mkdirSync(CONFIG, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e) {}
    fs.renameSync(tmp, REST_FILE)
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {}
    throw e
  }
  restCache = null // 写成功后失效缓存，下一次 restRead 必读新盘（同轮可见）
}

function restAudit(state, sid) {
  const line = JSON.stringify({ at: new Date().toISOString(), on: state.on, source: state.source, by: '主人', sid: sid || undefined, rev: state.rev }) + '\n'
  try {
    fs.appendFileSync(REST_AUDIT_FILE, line, { mode: 0o600 })
    try { fs.chmodSync(REST_AUDIT_FILE, 0o600) } catch (e) {}
  } catch (e) {
    // 审计失败不阻断状态写入，只留 stderr 一行
    console.error('[rest] 审计追加失败 code=' + ((e && e.code) || 'unknown'))
  }
}

// 按钮与口述共用同一写路径：写状态 + 审计，返回新状态；失败抛错
function restSet(on, source, sid) {
  const cur = restRead()
  const now = Date.now()
  const next = {
    on: on === true,
    since: on === true ? ((cur.on && cur.since) ? cur.since : now) : null,
    source: source === 'spoken' ? 'spoken' : 'button',
    by: '主人',
    rev: (Number(cur.rev) || 0) + 1,
    updated: now
  }
  restWrite(next)
  restAudit(next, sid)
  return next
}

function restPad(n) { return n < 10 ? '0' + n : String(n) }
function restWatermark(state) {
  const d = new Date(state.since || Date.now())
  const t = d.getFullYear() + '-' + restPad(d.getMonth() + 1) + '-' + restPad(d.getDate()) + ' ' + restPad(d.getHours()) + ':' + restPad(d.getMinutes())
  const src = state.source === 'spoken' ? '口述' : '输入框按钮'
  return '【当前模式：休息中（主人已授权 · 起于 ' + t + ' · 来源：' + src + '）】\n' +
    '休息态边界：已排队任务可自主推进；不可逆/高风险动作仍须等主人。'
}

function restPartsHasWatermark(parts) {
  if (!Array.isArray(parts)) return false
  return parts.some(function (p) { return p && p.type === 'text' && String(p.text || '').indexOf(REST_WATERMARK) >= 0 })
}

// 非首条：水印前置到首 part 文本头部；首 part 非 text 则 unshift 一条 text
function restPrependParts(parts, txt) {
  const arr = Array.isArray(parts) ? parts.slice() : []
  if (arr.length && arr[0] && arr[0].type === 'text') {
    arr[0] = Object.assign({}, arr[0], { text: txt + '\n' + String(arr[0].text || '') })
  } else {
    arr.unshift({ type: 'text', text: txt })
  }
  return arr
}

function restNormText(s) {
  return String(s || '').replace(/\s+/g, '').replace(/[，。！？、,.!?~～；;：:]/g, '')
}

// 口述短语检测：仅当该轮纯文本 ≤20 字且归一后整串精确命中才触发（防引述/反问误伤）
function restDetectSpoken(parts, sid) {
  try {
    if (!Array.isArray(parts)) return
    const raw = parts.map(function (p) { return (p && p.type === 'text') ? String(p.text || '') : '' }).join('')
    if (Array.from(raw.replace(/\s+/g, '')).length > 20) return
    const t = restNormText(raw)
    if (!t) return
    if (REST_ON_SPOKEN.indexOf(t) >= 0) { restSet(true, 'spoken', sid); return }
    if (REST_OFF_SPOKEN.indexOf(t) >= 0) { restSet(false, 'spoken', sid); return }
  } catch (e) {
    // 检测失败按在线处理，主流程不中断
    console.error('[rest] 口述检测失败 code=' + ((e && e.code) || 'unknown'))
  }
}

/* ---------- 链路模式（task137）：config/chain-mode.json 唯一真相源，与休息态同构 ----------
   mode 三值白名单：'direct'=大管家亲自做（等价主人当轮说「你直接做」）| 'flat'=压扁链
   （派执行单时小管家一肩挑：接单+拆解+执行，御史照过）| 'full'=标准五角色全链（默认）。
   缺失/坏档/非法值一律 fail-open='full'（不抛错）；'full' 不注入水印（默认态省 token）。
   写：tmp→renameSync 0600，失败清 tmp 抛错由调用方 500；缓存 mtime+size 1s 窗，写后失效。 */
const CHAIN_FILE = path.join(CONFIG, 'chain-mode.json')
const CHAIN_AUDIT_FILE = path.join(CONFIG, 'chain-audit.jsonl')
const CHAIN_WATERMARK = '【链路模式：'
const CHAIN_MODES = ['direct', 'flat', 'full']
let chainCache = null

function chainDefault() { return { mode: 'full', since: null, source: null, rev: 0, updated: 0 } }
function chainNormalize(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return chainDefault()
  const mode = CHAIN_MODES.indexOf(j.mode) >= 0 ? j.mode : 'full'
  const sinceNum = Number(j.since)
  return {
    mode: mode,
    since: (isFinite(sinceNum) && sinceNum > 0) ? sinceNum : null,
    source: (j.source === 'button' || j.source === 'spoken') ? j.source : null,
    rev: isFinite(Number(j.rev)) ? Number(j.rev) : 0,
    updated: isFinite(Number(j.updated)) ? Number(j.updated) : 0
  }
}
function chainRead() {
  try {
    const st = fs.statSync(CHAIN_FILE)
    if (chainCache && chainCache.mtimeMs === st.mtimeMs && chainCache.size === st.size && (Date.now() - chainCache.at) < 1000) {
      return chainCache.value
    }
    const v = chainNormalize(JSON.parse(fs.readFileSync(CHAIN_FILE, 'utf8')))
    chainCache = { at: Date.now(), mtimeMs: st.mtimeMs, size: st.size, value: v }
    return v
  } catch (e) {
    // ENOENT / 坏 JSON / 权限异常一律 fail-open=全链；不写、不抛
    chainCache = null
    return chainDefault()
  }
}
function chainWrite(state) {
  const tmp = CHAIN_FILE + '.tmp-' + process.pid + '-' + Date.now()
  try {
    fs.mkdirSync(CONFIG, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e) {}
    fs.renameSync(tmp, CHAIN_FILE)
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {}
    throw e
  }
  chainCache = null // 写成功后失效缓存，下一次 chainRead 必读新盘（同轮可见）
}
function chainAudit(state) {
  const line = JSON.stringify({ at: new Date().toISOString(), mode: state.mode, source: state.source, by: '主人', rev: state.rev }) + '\n'
  try {
    fs.appendFileSync(CHAIN_AUDIT_FILE, line, { mode: 0o600 })
    try { fs.chmodSync(CHAIN_AUDIT_FILE, 0o600) } catch (e) {}
  } catch (e) {
    console.error('[chain] 审计追加失败 code=' + ((e && e.code) || 'unknown'))
  }
}
// 按钮与口述共用同一写路径（口述短语检测暂未接入，归一逻辑先留位）：写状态 + 审计，失败抛错
function chainSet(mode, source) {
  if (CHAIN_MODES.indexOf(mode) < 0) mode = 'full'
  const cur = chainRead()
  const now = Date.now()
  const next = {
    mode: mode,
    since: (cur.mode === mode && cur.since) ? cur.since : now, // 同模式重复设置保留原起时
    source: source === 'spoken' ? 'spoken' : 'button',
    rev: (Number(cur.rev) || 0) + 1,
    updated: now
  }
  chainWrite(next)
  chainAudit(next)
  return next
}
function chainWatermark(state) {
  if (!state || state.mode === 'full') return '' // 默认态不注入，省 token
  const d = new Date(state.since || Date.now())
  const t = d.getFullYear() + '-' + restPad(d.getMonth() + 1) + '-' + restPad(d.getDate()) + ' ' + restPad(d.getHours()) + ':' + restPad(d.getMinutes())
  const src = state.source === 'spoken' ? '口述' : '输入框按钮'
  if (state.mode === 'direct') {
    return '【链路模式：大管家亲自做（主人已选 · 起于 ' + t + ' · 来源：' + src + '）】\n' +
      '亲自做边界：本模式等价于主人当轮说「你直接做」——大管家直接用 write/bash 执行，不走派单链；' +
      '留痕回执（动了哪个文件/跑了什么命令/为什么）与 docs 留档、版本号等收尾纪律照旧；L2 大活过御史后收尾。'
  }
  return '【链路模式：压扁链（主人已选 · 起于 ' + t + ' · 来源：' + src + '）】\n' +
    '压扁链边界：派执行单时小管家一肩挑（接单+拆解+执行），不再转枢机与执笔；御史质检环节照常保留，禁以压扁为由豁免审查。'
}
function chainPartsHasWatermark(parts) {
  if (!Array.isArray(parts)) return false
  return parts.some(function (p) { return p && p.type === 'text' && String(p.text || '').indexOf(CHAIN_WATERMARK) >= 0 })
}

/* ---------- 回答/任务模式（task395）：config/answer-mode.json 唯一真相源，与链路模式同构 ----------
   mode 两值白名单：'answer'=仅回答（禁改文件/跑命令/写码/派单，主人当轮明示才可执行）
   | 'task'=任务（默认=可回答同时动代码，主人 2026-11-23 拍板默认 task）。
   缺失/坏档/非法值一律 fail-open='task'（不抛错）；'task' 默认态不注入水印（默认态省 token，同 chain full 策略）。 */
const ANSWER_FILE = path.join(CONFIG, 'answer-mode.json')
const ANSWER_AUDIT_FILE = path.join(CONFIG, 'answer-audit.jsonl')
const ANSWER_WATERMARK = '【当前模式：回答'
const ANSWER_MODES = ['answer', 'task']
let answerCache = null

function answerDefault() { return { mode: 'task', since: null, source: null, rev: 0, updated: 0 } }
function answerNormalize(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return answerDefault()
  const mode = ANSWER_MODES.indexOf(j.mode) >= 0 ? j.mode : 'task'
  const sinceNum = Number(j.since)
  return {
    mode: mode,
    since: (isFinite(sinceNum) && sinceNum > 0) ? sinceNum : null,
    source: (j.source === 'button' || j.source === 'spoken') ? j.source : null,
    rev: isFinite(Number(j.rev)) ? Number(j.rev) : 0,
    updated: isFinite(Number(j.updated)) ? Number(j.updated) : 0
  }
}
function answerRead() {
  try {
    const st = fs.statSync(ANSWER_FILE)
    if (answerCache && answerCache.mtimeMs === st.mtimeMs && answerCache.size === st.size && (Date.now() - answerCache.at) < 1000) {
      return answerCache.value
    }
    const v = answerNormalize(JSON.parse(fs.readFileSync(ANSWER_FILE, 'utf8')))
    answerCache = { at: Date.now(), mtimeMs: st.mtimeMs, size: st.size, value: v }
    return v
  } catch (e) {
    // ENOENT / 坏 JSON / 权限异常一律 fail-open=任务；不写、不抛
    answerCache = null
    return answerDefault()
  }
}
function answerWrite(state) {
  const tmp = ANSWER_FILE + '.tmp-' + process.pid + '-' + Date.now()
  try {
    fs.mkdirSync(CONFIG, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e) {}
    fs.renameSync(tmp, ANSWER_FILE)
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {}
    throw e
  }
  answerCache = null // 写成功后失效缓存，下一次 answerRead 必读新盘（同轮可见）
}
function answerAudit(state) {
  const line = JSON.stringify({ at: new Date().toISOString(), mode: state.mode, source: state.source, by: '主人', rev: state.rev }) + '\n'
  try {
    fs.appendFileSync(ANSWER_AUDIT_FILE, line, { mode: 0o600 })
    try { fs.chmodSync(ANSWER_AUDIT_FILE, 0o600) } catch (e) {}
  } catch (e) {
    console.error('[answer] 审计追加失败 code=' + ((e && e.code) || 'unknown'))
  }
}
// 按钮写路径：写状态 + 审计，失败抛错；同模式重复设置保留原起时（与 chainSet 同口径）
function answerSet(mode, source) {
  if (ANSWER_MODES.indexOf(mode) < 0) mode = 'task'
  const cur = answerRead()
  const now = Date.now()
  const next = {
    mode: mode,
    since: (cur.mode === mode && cur.since) ? cur.since : now,
    source: source === 'spoken' ? 'spoken' : 'button',
    rev: (Number(cur.rev) || 0) + 1,
    updated: now
  }
  answerWrite(next)
  answerAudit(next)
  return next
}
function answerWatermark(state) {
  if (!state || state.mode !== 'answer') return '' // 默认态（任务）不注入，省 token
  const d = new Date(state.since || Date.now())
  const t = d.getFullYear() + '-' + restPad(d.getMonth() + 1) + '-' + restPad(d.getDate()) + ' ' + restPad(d.getHours()) + ':' + restPad(d.getMinutes())
  const src = state.source === 'spoken' ? '口述' : '输入框按钮'
  return '【当前模式：回答（主人已选 · 起于 ' + t + ' · 来源：' + src + '）】\n' +
    '回答模式边界：本轮只回答问题、讲解、讨论——禁止改文件、跑命令、写代码、建任务牌、派单等一切执行类动作；' +
    '除非主人在本轮消息正文中明确下达具体执行指令（如修/改/跑/做/部署/执行/你直接做等），仅询问做法、讨论方案不算。\n' +
    '本模式优先于休息态/链路模式：其他模式水印中的「自主推进」「等价于主人当轮说」均不构成本模式例外；' +
    '只有主人在本轮消息正文中明确指示执行才可。'
}
function answerPartsHasWatermark(parts) {
  if (!Array.isArray(parts)) return false
  return parts.some(function (p) { return p && p.type === 'text' && String(p.text || '').indexOf(ANSWER_WATERMARK) >= 0 })
}

const IMPORTS_FILE = path.join(CONFIG, 'imports.json')
const PROJECTS_FILE = path.join(CONFIG, 'projects.json')
const ORDER_FILE = path.join(CONFIG, 'project-order.json')

function loadImports() { const v = readJson(IMPORTS_FILE, []); return Array.isArray(v) ? v : [] }
function saveImports(list) { writeJson(IMPORTS_FILE, list) }
function registered() { const v = readJson(PROJECTS_FILE, []); return Array.isArray(v) ? v : [] }
function saveRegistered(list) { writeJson(PROJECTS_FILE, list) }
function loadOrder() { const v = readJson(ORDER_FILE, []); return Array.isArray(v) ? v.filter(function (k) { return typeof k === 'string' }) : [] }
function saveOrder(list) { writeJson(ORDER_FILE, list) }
/* ---------- 会话手动排序（task141）：config/conv-order.json —— { 项目key: [会话id, ...] } ----------
   同项目内的会话顺序；未列出的会话按原排序（created 降序）排在后面。读取容错（坏档/非法值→空表），
   写入复用 writeJson（tmp+rename）。单项目上限 CONV_ORDER_MAX 条，id ≤128 字符。 */
const CONV_ORDER_FILE = path.join(CONFIG, 'conv-order.json')
const CONV_ORDER_MAX = 500
function convOrderClean(arr) {
  return (Array.isArray(arr) ? arr : [])
    .filter(function (s) { return typeof s === 'string' && s.length > 0 && s.length <= 128 })
    .slice(0, CONV_ORDER_MAX)
}
function loadConvOrder() {
  const v = readJson(CONV_ORDER_FILE, {})
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out = {}
  Object.keys(v).forEach(function (k) {
    if (!k || k.length > 128) return
    const clean = convOrderClean(v[k])
    if (clean.length) out[k] = clean
  })
  return out
}
function saveConvOrder(map) { writeJson(CONV_ORDER_FILE, map) }

/* ---------- 左栏软删除（task56）：config/hidden-sessions.json 只存“列表可见性”，不动会话数据 ----------
   结构：{ version: 1, hidden: [会话id...] }；读取容错（缺失/坏 JSON/结构非法 → 空清单），
   写入走同目录 tmp + rename 原子替换，权限 0600；空操作不重写文件。上限 HIDDEN_MAX fail-closed。 */
const HIDDEN_FILE = path.join(CONFIG, 'hidden-sessions.json')
const HIDDEN_VERSION = 1
const HIDDEN_MAX = 2000
const DELETE_SESSION_RE = /^\/api\/session\/([^/?#]+)$/

function hiddenIdOk(v) { return typeof v === 'string' && v.length >= 1 && v.length <= 128 }

function hiddenNormalize(list) {
  const out = [], seen = {}
  if (!Array.isArray(list)) return out
  list.forEach(function (v) {
    if (!hiddenIdOk(v) || seen[v]) return
    seen[v] = 1
    out.push(v)
  })
  return out
}

function writeHiddenAtomic(list) {
  const body = JSON.stringify({ version: HIDDEN_VERSION, hidden: list }, null, 2)
  const tmp = HIDDEN_FILE + '.tmp-' + process.pid + '-' + Date.now()
  try {
    fs.mkdirSync(path.dirname(HIDDEN_FILE), { recursive: true })
    fs.writeFileSync(tmp, body, { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e) {}
    fs.renameSync(tmp, HIDDEN_FILE)
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {}
    throw e
  }
}

function readHidden() {
  let raw = null
  try { raw = fs.readFileSync(HIDDEN_FILE, 'utf8') } catch (e) {
    if (e && e.code === 'ENOENT') return { version: HIDDEN_VERSION, hidden: [] }
    return { version: HIDDEN_VERSION, hidden: [], warning: '隐藏清单读取失败，已按全部可见处理' }
  }
  let doc
  try { doc = JSON.parse(raw) } catch (e) {
    // 坏 JSON：备份原文件（只重命名不删除），避免一次损坏让软删永久失效
    try { fs.renameSync(HIDDEN_FILE, HIDDEN_FILE + '.bad-' + Date.now()) } catch (e2) {}
    return { version: HIDDEN_VERSION, hidden: [], warning: '隐藏清单格式损坏，已备份原文件并按全部可见处理' }
  }
  if (Array.isArray(doc)) { // 旧格式（裸数组）自动迁移
    const legacy = hiddenNormalize(doc)
    try { writeHiddenAtomic(legacy) } catch (e) {}
    return { version: HIDDEN_VERSION, hidden: legacy }
  }
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.hidden)) {
    return { version: HIDDEN_VERSION, hidden: [], warning: '隐藏清单结构非法，已按全部可见处理' }
  }
  return { version: HIDDEN_VERSION, hidden: hiddenNormalize(doc.hidden) }
}

// 返回 {ok:true, action, changed, hidden} 或 {ok:false, code, error}
function hiddenApply(action, ids) {
  const doc = readHidden()
  const set = new Set(doc.hidden)
  let changed = 0
  ids.forEach(function (id) {
    if (action === 'hide') {
      if (set.has(id)) return
      set.add(id); changed++
    } else if (set.has(id)) {
      set.delete(id); changed++
    }
  })
  if (changed === 0) return { ok: true, action: action, changed: 0, hidden: doc.hidden }
  if (action === 'hide' && set.size > HIDDEN_MAX) {
    /* task162：原文案「到「显示全部」恢复」是死指引（该入口 task143 已删），改为实际可行路径 */
    return { ok: false, code: 409, error: '隐藏清单已满（' + HIDDEN_MAX + '），请先恢复部分已隐藏会话' }
  }
  const next = Array.from(set)
  try { writeHiddenAtomic(next) } catch (e) {
    return { ok: false, code: 500, error: '隐藏清单写入失败：' + ((e && e.message) || '未知错误') }
  }
  return { ok: true, action: action, changed: changed, hidden: next }
}

// 彻底删除成功后同步清 hidden；失败不影响 DELETE 结果
function hiddenRestore(ids) {
  try {
    const doc = readHidden()
    const set = new Set(doc.hidden)
    let changed = false
    ids.forEach(function (id) { if (set.has(id)) { set.delete(id); changed = true } })
    if (changed) writeHiddenAtomic(Array.from(set))
  } catch (e) {}
}

/* ---------- 彻底删除前归档（task60 增量 R3）：先归档后删除，fail-closed ----------
   归档目录 config/session-archive/（运行根、仓库外、不入 git）；一会话一文件（<sid>.json，0600），
   同 id 幂等原子覆盖。纯留底：不开放任何恢复/查看/清理的 UI 或 HTTP 接口，找回走 AI 读文件。 */
const ARCHIVE_DIR = path.join(CONFIG, 'session-archive')
const ARCHIVE_VERSION = 1
const ARCHIVE_RE = /^[A-Za-z0-9_-]{1,128}$/ // sid 落盘文件名白名单，防路径穿越
const ARCHIVE_GET_TIMEOUT = 30000
const _archiving = new Map()

function archivePath(sid) {
  if (typeof sid !== 'string' || !ARCHIVE_RE.test(sid)) throw new Error('会话 id 非法')
  return path.join(ARCHIVE_DIR, sid + '.json')
}

function writeArchiveAtomic(sid, doc) {
  const file = archivePath(sid)
  const body = JSON.stringify(doc, null, 2)
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now()
  try {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
    fs.writeFileSync(tmp, body, { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e) {}
    fs.renameSync(tmp, file)
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {}
    throw e
  }
}

// boot-state 命中 = 1、未命中 = 0；文件不存在 = 0；坏档/结构非法 = null（留档缺 pwa，不阻断归档）。
// 独立读原始文件只为识别坏档（loadBootState 容错后无法区分），只读不写，不改 loadBootState。
function archivePwaFlag(sid) {
  try {
    const j = JSON.parse(fs.readFileSync(BOOT_STATE, 'utf8'))
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null
    return (isFinite(Number(j[sid])) && Number(j[sid]) > 0) ? 1 : 0
  } catch (e) {
    if (e && e.code === 'ENOENT') return 0
    return null
  }
}

// 后端只读 GET（4098，AUTH_EXPECT）；非 2xx 带 httpCode，404/410 标 notFound 供上层判「无数据可归」
function archiveGetJson(p, cb) {
  let done = false
  const finish = function (err, data) { if (done) return; done = true; cb(err, data) }
  const preq = http.request({ host: BACKEND.host, port: BACKEND.port, method: 'GET', path: p, headers: { authorization: AUTH_EXPECT } }, function (pres) {
    let b = ''
    pres.setEncoding('utf8')
    pres.on('data', function (c) { b += c })
    pres.on('end', function () {
      const code = pres.statusCode || 0
      if (code < 200 || code >= 300) {
        const e = new Error('后端读取失败（HTTP ' + code + '）')
        e.httpCode = 502
        if (code === 404 || code === 410) e.notFound = true
        return finish(e)
      }
      let d
      try { d = JSON.parse(b) } catch (e2) { return finish(new Error('后端响应格式异常（非 JSON）')) }
      finish(null, d)
    })
    pres.on('error', function (e3) { finish(new Error('后端响应中断：' + ((e3 && e3.message) || e3))) })
  })
  preq.setTimeout(ARCHIVE_GET_TIMEOUT, function () {
    try { preq.destroy(new Error('超时（' + (ARCHIVE_GET_TIMEOUT / 1000) + ' 秒）')) } catch (e4) {}
  })
  preq.on('error', function (e5) { finish(new Error('后端读取失败：' + ((e5 && e5.message) || e5))) })
  preq.end()
}

// 两跳只读后端 → 组装文档 → 原子写；成功 cb(null)，失败 cb(Error{httpCode})。
// 同 id 并发：首个请求执行，后到的挂同一批回调（Node 单进程前提，写入本身原子 rename，不做跨进程锁）。
function archiveSession(sid, cb) {
  try { archivePath(sid) } catch (e) { e.httpCode = 400; return cb(e) }
  const waiting = _archiving.get(sid)
  if (waiting) { waiting.push(cb); return }
  const cbs = [cb]
  _archiving.set(sid, cbs)
  const finish = function (err) {
    _archiving.delete(sid)
    cbs.forEach(function (f) { try { f(err) } catch (e) {} })
  }
  archiveGetJson('/session/' + encodeURIComponent(sid), function (err, session) {
    if (err) return finish(err)
    if (!session || typeof session !== 'object' || Array.isArray(session)) {
      const e = new Error('会话数据格式异常')
      e.httpCode = 502
      return finish(e)
    }
    archiveGetJson('/session/' + encodeURIComponent(sid) + '/message', function (err2, messages) {
      if (err2) return finish(err2)
      if (!Array.isArray(messages)) {
        const e = new Error('消息数据格式异常')
        e.httpCode = 502
        return finish(e)
      }
      const doc = { version: ARCHIVE_VERSION, id: sid, title: typeof session.title === 'string' ? session.title : '' }
      const pwa = archivePwaFlag(sid)
      if (pwa !== null) doc.pwa = pwa
      doc.at = Date.now()
      doc.src = 'hard-delete'
      doc.session = session
      doc.messages = messages
      try { writeArchiveAtomic(sid, doc) } catch (e) {
        const w = new Error('本地写入失败：' + ((e && e.message) || '未知错误'))
        w.httpCode = 500
        return finish(w)
      }
      finish(null)
    })
  })
}

function ensureProjects() { fs.mkdirSync(PROJECTS, { recursive: true }) }

// 本地 projects 目录 + 已登记的外部绝对路径（如鸿蒙 PC 上的 DAG 仓库）
function listProjects() {
  ensureProjects()
  const map = new Map()
  try {
    fs.readdirSync(PROJECTS, { withFileTypes: true })
      .filter(function (d) { return d.isDirectory() })
      .forEach(function (d) { map.set(d.name, path.join(PROJECTS, d.name)) })
  } catch (e) {}
  registered().forEach(function (p) {
    if (p && p.name && p.path && fs.existsSync(p.path)) map.set(p.name, path.resolve(p.path))
  })
  return Array.from(map, function (e) { return { name: e[0], path: e[1] } })
    .sort(function (a, b) { return a.name.localeCompare(b.name) })
}

function allowedRoots() {
  const roots = [PROJECTS]
  listProjects().forEach(function (p) { roots.push(p.path) })
  loadImports().forEach(function (i) { roots.push(i.path) })
  return roots
}

function safeResolve(rel) {
  const raw = String(rel || '').trim()
  if (!raw) return null
  const isAbs = /^[A-Za-z]:[\\/]/.test(raw) || raw.charAt(0) === '/' || raw.indexOf('\\\\') === 0
  const abs = isAbs ? path.resolve(raw) : path.resolve(PROJECTS, '.' + path.sep + raw)
  const roots = allowedRoots()
  for (let i = 0; i < roots.length; i++) {
    const rr = path.resolve(String(roots[i]))
    if (abs === rr || abs.indexOf(rr + path.sep) === 0 || abs.indexOf(rr + '/') === 0) return abs
  }
  return null
}

function listDir(relPath) {
  const abs = safeResolve(relPath)
  if (!abs) return null
  let entries
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch (e) { return null }
  const out = entries.map(function (d) {
    let size = 0
    try { size = d.isDirectory() ? 0 : fs.statSync(path.join(abs, d.name)).size } catch (e) {}
    return { name: d.name, dir: d.isDirectory(), size: size }
  })
  out.sort(function (a, b) { return a.dir === b.dir ? a.name.localeCompare(b.name) : (a.dir ? -1 : 1) })
  return out
}

// 文件夹选择器：只列目录、不读文件内容；默认限制在用户主目录内
// 可用 LITTLEDJ_BROWSE_ROOTS（path.delimiter 分隔）追加/替换可浏览根目录
function browseRoots() {
  const env = String(process.env.LITTLEDJ_BROWSE_ROOTS || '').trim()
  const list = env ? env.split(path.delimiter) : [os.homedir()]
  return list.filter(Boolean).map(function (r) {
    try { return fs.realpathSync(r) } catch (e) { return path.resolve(r) }
  })
}

function browseDir(raw) {
  const roots = browseRoots()
  if (!roots.length) return null
  const target = raw && String(raw).trim() ? String(raw).trim() : roots[0]
  let abs
  try { abs = fs.realpathSync(path.resolve(target)) } catch (e) { return null }
  const inside = roots.some(function (r) { return abs === r || abs.indexOf(r + path.sep) === 0 })
  if (!inside) return null
  let entries
  try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch (e) { return null }
  const dirs = entries
    .filter(function (d) { return d.isDirectory() && d.name.charAt(0) !== '.' })
    .map(function (d) { return { name: d.name, path: path.join(abs, d.name) } })
    .sort(function (a, b) { return a.name.localeCompare(b.name) })
  return { path: abs, parent: abs === roots[0] ? null : path.dirname(abs), entries: dirs }
}

// ---------- home 只读安全闸（task72 S2）----------
// 独立命名空间 /_fs/home/*：黑名单 → realpath → 黑名单复检 + 白名单（fail-closed）。
// 黑名单常量全部派生自 ROOT(L12)/PROJECTS(L13)/CONFIG(L14)，不硬编码路径。
const HOME_RAW = os.homedir()
const HOME_REAL = (function () { try { return fs.realpathSync(HOME_RAW) } catch (e) { return path.resolve(HOME_RAW) } })()
const HOME_SEP = path.sep
const IS_CI_FS = (process.platform === 'win32' || process.platform === 'darwin')
const MAX_READ_BYTES = 4 * 1024 * 1024
const MAX_ENTRIES = 2000

function realOr(p) { try { return fs.realpathSync(p) } catch (e) { return path.resolve(p) } }
const BLACK_DIRS_ABS = [realOr(ROOT), realOr(CONFIG)]                 // CONFIG 已被 ROOT 覆盖，单列为审计可见
const BLACK_DIR_NAMES = ['backup', 'run', 'logs']                     // C 案：目录名任意位置生效
const PROJECTS_REAL = realOr(PROJECTS)                                // C 案唯一豁免锚点
const BLACK_NAMES = ['auth.txt', 'auth-ext.txt', 'apikeys.json', 'zhipu-keys.json']
const BLACK_GLOBS = [/\.key$/i, /\.pem$/i, /^id_rsa/i, /^id_ed25519/i, /\.token$/i, /\.secret$/i]
const BLACK_SEGMENTS = ['.ssh', '.gnupg']

function nkey(s) { return String(s).normalize('NFKC').toLowerCase() }
function deny(code) { const e = new Error(code); e.code = code; return e }

function underProjects(abs) {
  if (IS_CI_FS) { const a = nkey(abs), r = nkey(PROJECTS_REAL); return a === r || a.indexOf(r + '/') === 0 }
  return abs === PROJECTS_REAL || abs.indexOf(PROJECTS_REAL + HOME_SEP) === 0
}

function underHome(abs) {
  if (IS_CI_FS) { const a = nkey(abs), r = nkey(HOME_REAL); return a === r || a.indexOf(r + '/') === 0 }
  return abs === HOME_REAL || abs.indexOf(HOME_REAL + HOME_SEP) === 0
}

function isBlackName(base) {
  const k = nkey(base)
  if (BLACK_NAMES.indexOf(k) >= 0) return true
  return BLACK_GLOBS.some(function (re) { return re.test(k) })
}

// C 案四层：①ROOT 前缀（PROJECTS 豁免）②任意位置 backup/run/logs 目录名 ③.ssh/.gnupg 段 ④凭据文件名
function isBlackPath(abs) {
  const k = nkey(abs)
  if (!underProjects(abs)) {
    for (let i = 0; i < BLACK_DIRS_ABS.length; i++) {
      const dk = nkey(BLACK_DIRS_ABS[i])
      if (k === dk || k.indexOf(dk + '/') === 0) return true
    }
  }
  const segs = abs.split(/[\\/]+/).filter(Boolean)
  if (segs.some(function (s) { return BLACK_DIR_NAMES.indexOf(nkey(s)) >= 0 })) return true
  if (segs.some(function (s) { return BLACK_SEGMENTS.indexOf(nkey(s)) >= 0 })) return true
  return isBlackName(path.basename(abs))
}

function hasDotSeg(rel) {
  return String(rel).split(/[\\/]+/).filter(Boolean).some(function (s) { return s.charAt(0) === '.' })
}

// 三重闸：入参校验 → 归一化/越界预判/黑名单前检 → realpath → 黑名单复检+白名单 → stat → 硬链接
function homeGate(rawPath, want) {
  if (rawPath == null) rawPath = ''
  if (typeof rawPath !== 'string') throw deny('E_PATH')
  if (want === 'file' && rawPath.trim() === '') throw deny('E_PATH')
  if (/[\u0000-\u001f]/.test(rawPath)) throw deny('E_PATH')
  const s = rawPath.trim() || HOME_REAL
  if (/%(2e|2f|5c)/i.test(s)) throw deny('E_PATH')
  if (process.platform === 'win32' && /^[A-Za-z]:/.test(s)) throw deny('E_PATH')

  const abs = s.charAt(0) === '/' ? path.resolve(s) : path.resolve(HOME_REAL, s)
  const norm = abs.normalize('NFC')
  if (!underHome(norm)) throw deny('E_PATH')
  if (isBlackPath(norm)) throw deny('E_DENY')

  let real
  try { real = fs.realpathSync(norm) }
  catch (e) {
    if (e && (e.code === 'EACCES' || e.code === 'EPERM')) throw deny('E_DENY')
    throw deny(want === 'dir' ? 'E_PATH' : 'E_NOENT')
  }

  if (isBlackPath(real)) throw deny('E_DENY')
  if (!underHome(real)) throw deny('E_PATH')
  if (want === 'file' && hasDotSeg(path.relative(HOME_REAL, real))) throw deny('E_NOENT')

  let st
  try { st = fs.statSync(real) }
  catch (e) {
    if (e && (e.code === 'EACCES' || e.code === 'EPERM')) throw deny('E_DENY')
    throw deny(want === 'dir' ? 'E_PATH' : 'E_NOENT')
  }
  if (want === 'dir' && !st.isDirectory()) throw deny('E_PATH')
  if (want === 'file' && st.isDirectory()) throw deny('E_PATH')
  // 硬链接反绕过：nlink>1（或取不到）一律拒；目录天然 nlink>=2，只判 file
  if (want === 'file' && !(typeof st.nlink === 'number' && st.nlink === 1)) throw deny('E_DENY')
  return { abs: real, st: st }
}

// errno → 稳定错误码（禁 500）
function mapHomeFsError(e) {
  const c = (e && e.code) || ''
  if (c === 'E_DENY' || c === 'E_PATH' || c === 'E_NOENT' || c === 'E_TOOBIG' || c === 'E_BUSY') return c
  if (c === 'EACCES' || c === 'EPERM') return 'E_DENY'
  if (c === 'ENOENT' || c === 'ENOTDIR') return 'E_NOENT'
  if (c === 'EISDIR') return 'E_PATH'
  if (c === 'EMFILE' || c === 'ENFILE') return 'E_BUSY'
  return 'E_PATH'
}

const HOME_ERR = {
  E_PATH: { status: 400, error: '路径无效或越界' },
  E_DENY: { status: 403, error: '该位置禁止访问' },
  E_NOENT: { status: 404, error: '文件不存在' },
  E_TOOBIG: { status: 413, error: '文件过大，无法预览（>4MB）' },
  E_BUSY: { status: 503, error: '服务繁忙，请稍后重试' },
  E_METHOD: { status: 405, error: 'method not allowed' }
}
function jsonHomeErr(res, code) {
  const m = HOME_ERR[code] || HOME_ERR.E_PATH
  return json(res, m.status, { ok: false, error: m.error, code: code })
}
function homeFail(res, e) { return jsonHomeErr(res, mapHomeFsError(e)) }

// 快捷位探测：主目录 + 桌面/文档/下载/图片（候选名依次试，不存在自动隐去）
function homeRoots() {
  const places = [{ key: 'home', name: '主目录', path: HOME_REAL }]
  const cands = [
    { key: 'desktop', name: '桌面', names: ['Desktop', '桌面'] },
    { key: 'documents', name: '文档', names: ['Documents', '文档'] },
    { key: 'downloads', name: '下载', names: ['Download', 'Downloads', '下载'] },
    { key: 'images', name: '图片', names: ['Pictures', 'Images', '图片'] }
  ]
  cands.forEach(function (c) {
    for (let i = 0; i < c.names.length; i++) {
      let r
      try { r = fs.realpathSync(path.join(HOME_REAL, c.names[i])) } catch (e) { continue }
      if (!underHome(r)) continue
      let st
      try { st = fs.statSync(r) } catch (e) { continue }
      if (!st.isDirectory()) continue
      places.push({ key: c.key, name: c.name, path: r })
      break
    }
  })
  return { ok: true, root: HOME_REAL, places: places }
}

// 列目录：dot/黑名单/软链越界一律不列出；目录优先 + 字母序 + 2000 条截断
function homeList(rawPath) {
  const g = homeGate(rawPath, 'dir')
  let dirents
  try { dirents = fs.readdirSync(g.abs, { withFileTypes: true }) } catch (e) { throw deny('E_PATH') }
  const out = []
  dirents.forEach(function (d) {
    const name = d.name
    if (!name || name.charAt(0) === '.') return
    const full = path.join(g.abs, name)
    if (isBlackName(name)) return
    if (isBlackPath(full)) return
    let dir = d.isDirectory()
    const link = d.isSymbolicLink()
    if (link) {
      let r
      try { r = fs.realpathSync(full) } catch (e) { return }
      if (!underHome(r) || isBlackPath(r)) return
      try { dir = fs.statSync(r).isDirectory() } catch (e) { return }
    }
    let size = 0
    if (!dir) { try { size = fs.statSync(full).size } catch (e) { size = 0 } }
    out.push({ name: name, dir: dir, size: size, link: link })
  })
  out.sort(function (a, b) { return a.dir === b.dir ? a.name.localeCompare(b.name) : (a.dir ? -1 : 1) })
  const truncated = out.length > MAX_ENTRIES
  return {
    ok: true,
    path: g.abs,
    parent: g.abs === HOME_REAL ? null : path.dirname(g.abs),
    truncated: truncated,
    entries: truncated ? out.slice(0, MAX_ENTRIES) : out
  }
}

// 读文本：gate → openSync → fstat 复检（nlink/类型/4MB）→ readFileSync(fd)，异常按映射表返回
function homeRead(rawPath) {
  const g = homeGate(rawPath, 'file')
  let fd = -1
  try {
    fd = fs.openSync(g.abs, 'r')
    const st2 = fs.fstatSync(fd)
    if (st2.isDirectory()) throw deny('E_PATH')
    if (!(typeof st2.nlink === 'number' && st2.nlink === 1)) throw deny('E_DENY')
    if (st2.size > MAX_READ_BYTES) throw deny('E_TOOBIG')
    const buf = fs.readFileSync(fd)
    fs.closeSync(fd)
    fd = -1
    const ext = path.extname(g.abs).toLowerCase()
    return { ok: true, content: buf.toString('utf8'), size: buf.length, mime: MIME[ext] || 'text/plain; charset=utf-8' }
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd) } catch (e) {} }
  }
}

// 二进制：gate → openSync → fstat 复检 → createReadStream({fd})；仅 5 种图片内联，其余 octet-stream
function homeRaw(rawPath, res) {
  const g = homeGate(rawPath, 'file')
  const fd = fs.openSync(g.abs, 'r')
  let st2
  try { st2 = fs.fstatSync(fd) } catch (e) { try { fs.closeSync(fd) } catch (_) {} throw e }
  if (st2.isDirectory()) { try { fs.closeSync(fd) } catch (_) {} throw deny('E_PATH') }
  if (!(typeof st2.nlink === 'number' && st2.nlink === 1)) { try { fs.closeSync(fd) } catch (_) {} throw deny('E_DENY') }
  const ext = path.extname(g.abs).toLowerCase()
  const inlineOk = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].indexOf(ext) >= 0
  res.writeHead(200, {
    'Content-Type': inlineOk ? MIME[ext] : 'application/octet-stream',
    'Content-Length': st2.size,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  const rs = fs.createReadStream(null, { fd: fd })
  rs.on('error', function () {
    if (!res.headersSent) return homeFail(res, deny('E_PATH'))
    res.destroy()
  })
  rs.pipe(res)
}

/* task387（modern-web-guidance §8）：静态壳扩展名白名单——只放行浏览器真正需要的资源类型，
   顺带挡住备份/源码/文档（*.bak、*.ts、*.md、tsconfig 等）被匿名整文件下载；缺项会 404，扩品类时记得同步这里 */
const STATIC_EXT_OK = new Set(['.html', '.js', '.css', '.png', '.svg', '.webmanifest', '.ico'])
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/index.html' : pathname
  p = decodeURIComponent(p)
  const abs = path.resolve(UI_DIR, '.' + p)
  // task166 P2-6：与 homeGate 同口径（等值或带分隔符前缀），防 UI_DIR 兄弟目录同前缀绕过
  if (abs !== UI_DIR && abs.indexOf(UI_DIR + path.sep) !== 0) { res.writeHead(403); return res.end('403') }
  if (!STATIC_EXT_OK.has(path.extname(p).toLowerCase())) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Frame-Options': 'DENY' }); return res.end('Not Found') }
  fs.readFile(abs, function (err, buf) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Frame-Options': 'DENY' }); return res.end('Not Found') }
    /* task295 A4：壳响应统一 X-Frame-Options: DENY（全仓无 iframe 引用，不误伤；防登录卡片被点击劫持） */
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY' })
    res.end(buf)
  })
}

function backendRequest(method, p, headers, body, cb) {
  const opts = { host: BACKEND.host, port: BACKEND.port, method: method, path: p || '/', headers: headers || {} }
  const preq = http.request(opts, cb)
  preq.on('error', function (e) { cb(null, e) })
  if (body) preq.end(body); else preq.end()
}

// 请求审计：只记写操作与慢请求，用于排查「消息发出去了但没到后端」这类问题
function logApi(req, urlObj, code, ms) {
  try {
    const interesting = req.method !== 'GET' || ms > 2000
    if (!interesting) return
    console.log('[api] ' + new Date().toISOString() + ' ' + req.method + ' ' + urlObj.pathname + ' -> ' + (code || '-') + ' ' + ms + 'ms')
  } catch (e) {}
}
function proxyApi(req, res, urlObj, bodyOverride, onDone) {
  const t0 = Date.now()
  // onDone 只回调一次：成功走响应 end，失败/后端不可达走 error 分支（P1-2 需要失败清忙，不能哑火）
  let settled = false
  const finish = function (code) {
    if (settled) return
    settled = true
    if (onDone) { try { onDone(code) } catch (e) {} }
  }
  const backendPath = urlObj.pathname.replace(/^\/api/, '') + (urlObj.search || '')
  const headers = Object.assign({}, req.headers)
  delete headers['host']
  delete headers['connection']
  headers['authorization'] = AUTH_EXPECT
  if (bodyOverride != null) headers['content-length'] = Buffer.byteLength(bodyOverride)
  const preq = http.request({ host: BACKEND.host, port: BACKEND.port, method: req.method, path: backendPath || '/', headers: headers }, function (pres) {
    res.writeHead(pres.statusCode || 502, pres.headers)
    pres.on('end', function () {
      logApi(req, urlObj, pres.statusCode, Date.now() - t0)
      // task133：后端活着的实证——任意 2xx 即清宕机标记（含非 /api 目标的正常应答）
      if (pres.statusCode >= 200 && pres.statusCode < 300) backendDownAt = 0
      finish(pres.statusCode || 502)
    })
    pres.pipe(res)
  })
  preq.on('error', function (e) {
    logApi(req, urlObj, 502, Date.now() - t0)
    // task133（枢机 P1-3）：进此 catch 必是连接级失败（HTTP 应答永远走 pres 回调）——宕机置位单点；
    // task134：置位经 backendMarkDown 收口（含打断在途回合：清忙 + 杀死纪元，前端 toast 提示重发）
    backendMarkDown()
    if (!res.headersSent) json(res, 502, { error: 'backend unreachable: ' + e.message })
    else res.end()
    finish(502)
  })
  if (bodyOverride != null) preq.end(bodyOverride)
  else req.pipe(preq)
}

// 后台健康探测：带 3s 超时，永不阻塞 _health（watchdog 靠它判断代理存活）
const _backendHealth = { ok: true, at: 0, latency: 0, err: '' }
function probeBackendHealth() {
  const now = Date.now()
  if (now - _backendHealth.at < 1500) return _backendHealth
  _backendHealth.at = now
  const t0 = Date.now()
  const preq = http.request({ host: BACKEND.host, port: BACKEND.port, method: 'GET', path: '/health', headers: { authorization: AUTH_EXPECT } }, function (pres) {
    pres.resume()
    _backendHealth.ok = pres.statusCode === 200
    _backendHealth.latency = Date.now() - t0
    _backendHealth.err = _backendHealth.ok ? '' : ('HTTP ' + pres.statusCode)
  })
  preq.setTimeout(3000, function () { try { preq.destroy(new Error('timeout')) } catch (e) {} })
  preq.on('error', function (e) { _backendHealth.ok = false; _backendHealth.latency = Date.now() - t0; _backendHealth.err = String((e && e.message) || e) })
  preq.end()
  return _backendHealth
}

/* task133（P2-3）：宕机恢复探测——回调式一次性 /health（3s 超时）。不复用 probeBackendHealth：
   它是同步返回缓存（1.5s 节流）无回调，down 态需要「探测→回调清位→立即再跳派发」的闭环；
   本函数与它共享 BACKEND/AUTH_EXPECT 常量，探测频次由 queueTick 3s 一跳天然节流+backendChecking 防重入。 */
function backendCheckOnce(cb) {
  const preq = http.request({ host: BACKEND.host, port: BACKEND.port, method: 'GET', path: '/health', headers: { authorization: AUTH_EXPECT } }, function (pres) {
    pres.resume()
    cb(pres.statusCode === 200)
  })
  preq.setTimeout(3000, function () { try { preq.destroy(new Error('timeout')) } catch (e) {} })
  preq.on('error', function () { cb(false) })
  preq.end()
}

/* task133：直发前轻量 TCP 存活探测（500ms 超时，本地回环健康时 ~1ms）——治「首条消息无先验直发 502 丢失」：
   serve 进程死亡（端口拒连）在 TCP 层即可判死，不通→置位宕机+消息入队，首条也不丢。
   残余 TOCTOU（探测通过后 serve 才死/半死挂断）：直发 502 置位，下一条入队，不劣于现状。 */
function backendTcpAlive(cb) {
  const sock = net.connect({ host: BACKEND.host, port: BACKEND.port })
  let settledTcp = false
  const done = function (alive) {
    if (settledTcp) return
    settledTcp = true
    try { sock.destroy() } catch (e) {}
    cb(alive)
  }
  sock.setTimeout(500, function () { done(false) })
  sock.once('connect', function () { done(true) })
  sock.once('error', function () { done(false) })
}

const NAME_RE = /^[\w\u4e00-\u9fa5 .\-]{1,64}$/

function forward(req, res) {
  const headers = Object.assign({}, req.headers)
  headers.host = UPSTREAM.host
  const preq = http.request({ host: UPSTREAM.hostname, port: UPSTREAM.port || 80, method: req.method, path: req.url, headers: headers }, function (pres) {
    res.writeHead(pres.statusCode || 502, pres.headers)
    pres.pipe(res)
  })
  preq.on('error', function (e) {
    if (!res.headersSent) json(res, 502, { error: 'upstream unreachable: ' + e.message })
    else res.end()
  })
  req.pipe(preq)
}

// ---- 用量统计：只读读取 deveco.db（消息级 tokens/cost），内存缓存 + 增量刷新 ----
// task315：LITTLEDJ_DEVECO_DB 为自测/调试旋钮（沙箱假库；默认生产库；生产不设）
const DEVECO_DB_FILE = process.env.LITTLEDJ_DEVECO_DB || path.join(os.homedir(), '.local', 'share', 'deveco', 'deveco.db')
const USAGE_OVERLAP_MS = 2 * 60 * 60 * 1000
const USAGE_WINDOW_MS = { day: 30 * 86400000, week: 84 * 86400000, month: 365 * 86400000 }
const USAGE_SQL = "SELECT id, time_created AS tc, json_extract(data,'$.role') AS rl, json_extract(data,'$.providerID') AS p, json_extract(data,'$.modelID') AS m, json_extract(data,'$.tokens.input') AS ti, json_extract(data,'$.tokens.output') AS tout, json_extract(data,'$.cost') AS c FROM message"
let _usageCache = null

function usageDbOpen() {
  let sqlite = null
  try { sqlite = require('node:sqlite') } catch (e) {}
  if (!sqlite || !sqlite.DatabaseSync) throw new Error('当前 Node 不支持 node:sqlite（需 Node 22.5+）')
  if (!fs.existsSync(DEVECO_DB_FILE)) throw new Error('找不到 deveco 数据库：' + DEVECO_DB_FILE)
  return new sqlite.DatabaseSync(DEVECO_DB_FILE, { readOnly: true })
}
function usageRows(sinceTc) {
  const db = usageDbOpen()
  try {
    // WHERE 只用 time_created（走廉价比较），role 在 JS 侧过滤，避免 json_extract 逐行求值拖慢
    return sinceTc > 0
      ? db.prepare(USAGE_SQL + ' WHERE time_created >= ?').all(sinceTc)
      : db.prepare(USAGE_SQL).all()
  } finally { try { db.close() } catch (e) {} }
}
function usageAbsorb(map, rows) {
  let maxTc = 0
  rows.forEach(function (r) {
    if ((r.tc || 0) > maxTc) maxTc = r.tc || 0
    if (r.rl !== 'assistant') return
    const rec = { tc: r.tc || 0, p: r.p || '', m: r.m || '', ti: r.ti || 0, tout: r.tout || 0, c: r.c || 0 }
    map.set(r.id, rec)
  })
  return maxTc
}
function ensureUsageCache(force) {
  if (!force && _usageCache) {
    const rows = usageRows(Math.max(0, _usageCache.maxTc - USAGE_OVERLAP_MS))
    const mt = usageAbsorb(_usageCache.msgs, rows)
    if (mt > _usageCache.maxTc) _usageCache.maxTc = mt
    _usageCache.builtAt = Date.now()
    return _usageCache
  }
  const map = new Map()
  // 首次建缓存也限定在最长统计窗口内，避免对超大库做全表扫描把事件循环卡住
  const since = Math.max(0, Date.now() - USAGE_WINDOW_MS.month - USAGE_OVERLAP_MS)
  const t0 = Date.now()
  const maxTc = usageAbsorb(map, usageRows(since))
  _usageCache = { msgs: map, maxTc: maxTc, builtAt: Date.now() }
  try { console.log('[stats] usage 缓存重建 rows=' + map.size + ' ' + (Date.now() - t0) + 'ms') } catch (e) {}
  return _usageCache
}
function pad2(n) { return n < 10 ? '0' + n : String(n) }
function usageBucketStart(ts, kind) {
  const d = new Date(ts)
  if (kind === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  if (kind === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7))
  return t.getTime()
}
function usageStepStart(start, kind) {
  const d = new Date(start)
  if (kind === 'day' || kind === 'week') d.setDate(d.getDate() + (kind === 'week' ? 7 : 1))
  else d.setMonth(d.getMonth() + 1)
  return d.getTime()
}
function usageBucketKey(start, kind) {
  const d = new Date(start)
  if (kind === 'month') return d.getFullYear() + '-' + pad2(d.getMonth() + 1)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
function usageBucketLabel(start, kind) {
  const d = new Date(start)
  if (kind === 'month') return d.getFullYear() + '-' + pad2(d.getMonth() + 1)
  return pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}
function usageStats(bucket, modelFilter, onlySet) {
  const now = Date.now()
  const from = now - (USAGE_WINDOW_MS[bucket] || USAGE_WINDOW_MS.day)
  const cache = ensureUsageCache(false)
  const list = [], index = new Map()
  for (let s = usageBucketStart(from, bucket); s <= now; s = usageStepStart(s, bucket)) {
    const b = { key: usageBucketKey(s, bucket), label: usageBucketLabel(s, bucket), start: s, input: 0, output: 0, cost: 0, count: 0 }
    list.push(b); index.set(b.key, b)
  }
  const models = new Map()
  const totals = { input: 0, output: 0, cost: 0, count: 0 }
  cache.msgs.forEach(function (rec) {
    if (!rec.tc || rec.tc < from || rec.tc > now) return
    const mid = rec.p + '/' + rec.m
    if (onlySet && !onlySet.has(mid)) return
    models.set(mid, true)
    if (modelFilter !== 'all' && mid !== modelFilter) return
    const b = index.get(usageBucketKey(usageBucketStart(rec.tc, bucket), bucket))
    if (!b) return
    b.input += rec.ti; b.output += rec.tout; b.cost += rec.c; b.count += 1
    totals.input += rec.ti; totals.output += rec.tout; totals.cost += rec.c; totals.count += 1
  })
  return {
    ok: true, bucket: bucket, from: from, to: now,
    models: Array.from(models.keys()).sort(),
    buckets: list, totals: totals,
    builtAt: cache.builtAt, totalMsgs: cache.msgs.size
  }
}

// ---- 主人画像（私有长期记忆）：config/owner-profile/，只存本机、不入 git、不外露 ----
const PROFILE_DIR = path.join(CONFIG, 'owner-profile')
const PROFILE_FILE = path.join(PROFILE_DIR, 'profile.json')
const PROFILE_INDEX = path.join(PROFILE_DIR, 'index.md')
const PROFILE_LOG = path.join(PROFILE_DIR, 'changelog.md')
// task39x（2026-11-19，与 DJH 画像统一）：维度名/顺序/提示与 DJH dsh-owner-profile 完全一致；
// 页面导航顺序改为跟随 profile.json 里 dimensions 的真实顺序（profileDimsOf），DJH 加维度小 DJ 自动跟上。
const PROFILE_DIMS = [
  { id: 'identity', name: '身份与称呼', hint: '主人的称呼、身份、家人与定位' },
  { id: 'style', name: '沟通与风格', hint: '语气、长度、表情与反问偏好' },
  { id: 'decide', name: '决策与协作', hint: '分工、决策速度、沉淀与协作方式' },
  { id: 'tech', name: '技术与环境', hint: '设备全景、技术强弱项与习惯' },
  { id: 'projects', name: '项目与事业', hint: '正在推进的项目与状态' },
  { id: 'interests', name: '兴趣与关注', hint: '长期关注的方向' },
  { id: 'learning', name: '学习方式', hint: '学习习惯与方法' },
  { id: 'phrases', name: '口头禅与触发词', hint: '高频原话与习惯说法' },
  { id: 'rhythm', name: '作息与节奏', hint: '活跃时间与节奏' },
  { id: 'redline', name: '红线与关怀点', hint: '绝对不能碰的事与需要体贴的点' }
]
/* 维度清单唯一真相=profile.json 本身的 dimensions 顺序；PROFILE_DIMS 只提供 name/hint 元数据与种子兜底 */
function profileDimsOf(p) {
  const src = (p && Array.isArray(p.dimensions)) ? p.dimensions : []
  return src.map(function (x) {
    const id = (x && x.id) || ''
    const m = PROFILE_DIMS.filter(function (d) { return d.id === id })[0]
    return { id: id, name: (m && m.name) || id, hint: (m && m.hint) || '' }
  })
}

function profileSeed() {
  const t = 1793797200000
  const it = function (text, source, status) {
    return { text: text, source: source || '主人原话', confidence: status === 'pending' ? 0.4 : 0.95, status: status || 'confirmed', updated: t }
  }
  const dims = {
    identity: [it('称呼我「主人」，自称「小 DJ」。', '规则'), it('定位：个人管家（personal agent），不是通用聊天机器人。', '规则')],
    style: [it('全程简体中文，回答尽量短、直接，不要客套。', '规则'), it('能接受慢、能接受 token 消耗多，最不能接受需求被认错。', '主人原话')],
    decide: [it('不确定就先问，一次一问，不许盲猜；可以接受被反复反问。', '主人原话'), it('大改动先讨论方案再动手，不急着写码。', '主人原话')],
    tech: [it('主力环境：鸿蒙 PC + DevEco Code；littleDJ = 单文件 UI + Node proxy。', '观察'), it('偏好零技术债、可回滚、每次改动留档。', '规则')],
    redline: [it('未经明确指令，绝不动 DAG AI Chat 的任何文件。', '规则'), it('未经授权不 commit/push；不主动安装或启动应用。', '规则')],
    projects: [it('littleDJ：personal agent，当前主线。', '主人原话'), it('日常：先放着不动。', '主人原话'), it('DAG AI Chat：APP 项目，只按指令读写。', '规则')],
    interests: [it('待确认：除了开发工具，还关注哪些领域？', '推断', 'pending')],
    phrases: [it('「查一下原因」= 先诊断、别急着改；「先讨论」= 别写码。', '观察'), it('报错必须翻成能懂的中文。', '规则')],
    learning: [it('待确认：想通过测验/复述掌握哪些主题？', '推断', 'pending')],
    rhythm: [it('待确认：通常的活跃时段与工作节奏？（今日 20:40 后仍在推进）', '观察', 'pending')]
  }
  return {
    version: 1,
    updated: t,
    dimensions: PROFILE_DIMS.map(function (d) { return { id: d.id, items: dims[d.id] || [], suggestions: [] } })
  }
}

function cleanProfileText(v, max) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, max)
}
function cleanProfileItem(it) {
  const text = cleanProfileText(it && it.text, 300)
  if (!text) return null
  let conf = Number(it && it.confidence)
  if (!isFinite(conf)) conf = 0.5
  return {
    text: text,
    source: cleanProfileText(it && it.source, 40) || '主人原话',
    confidence: Math.max(0, Math.min(1, conf)),
    status: (it && it.status === 'confirmed') ? 'confirmed' : 'pending',
    updated: Number(it && it.updated) || Date.now()
  }
}
function sanitizeProfile(d) {
  const src = (d && Array.isArray(d.dimensions)) ? d.dimensions : []
  return {
    version: 1,
    updated: Date.now(),
    dimensions: profileDimsOf(d).map(function (dim) {
      const found = src.filter(function (x) { return x && x.id === dim.id })[0] || {}
      const items = (Array.isArray(found.items) ? found.items : []).slice(0, 60).map(cleanProfileItem).filter(Boolean)
      const sugg = (Array.isArray(found.suggestions) ? found.suggestions : []).slice(0, 20).map(cleanProfileItem).filter(Boolean)
      return { id: dim.id, items: items, suggestions: sugg }
    })
  }
}
function readProfile() {
  const j = readJson(PROFILE_FILE, null)
  if (!j || !Array.isArray(j.dimensions)) return profileSeed()
  const clean = sanitizeProfile(j)
  clean.updated = Number(j.updated) || clean.updated
  return clean
}
function renderProfileIndex(p) {
  const lines = ['# 主人画像（摘要）', '', '> 自动生成，勿手改；改动走 littleDJ「主人画像」页面或 config/owner-profile/profile.json。', '']
  let pending = 0
  profileDimsOf(p).forEach(function (dim) {
    const d = p.dimensions.filter(function (x) { return x.id === dim.id })[0]
    const ok = d ? d.items.filter(function (i) { return i.status === 'confirmed' }) : []
    const pd = d ? d.items.filter(function (i) { return i.status !== 'confirmed' }) : []
    pending += pd.length + (d ? d.suggestions.length : 0)
    if (!ok.length) return
    lines.push('## ' + dim.name)
    ok.forEach(function (i) { lines.push('- ' + i.text) })
    lines.push('')
  })
  if (pending) lines.push('待确认/待采纳：' + pending + ' 条（打开 littleDJ 左栏「主人画像」处理）')
  return lines.join('\n') + '\n'
}
function writeProfile(p, action) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true })
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(p, null, 2))
  fs.writeFileSync(PROFILE_INDEX, renderProfileIndex(p))
  try { fs.chmodSync(PROFILE_FILE, 0o600); fs.chmodSync(PROFILE_INDEX, 0o600) } catch (e) {}
  try {
    const total = p.dimensions.reduce(function (n, d) { return n + d.items.length }, 0)
    fs.appendFileSync(PROFILE_LOG, '- ' + new Date().toISOString() + ' ' + (action || '保存') + '（' + p.dimensions.length + ' 维度 / ' + total + ' 条）\n')
  } catch (e) {}
}

// ---- 约束管理：世界观（常驻注入）/ 开工三查（新会话首条） ----
// 只存本机 config/prompts/，600 权限、不入 git；首次读取时用内置种子落盘。
const PROMPTS_DIR = path.join(CONFIG, 'prompts')
const PROMPTS_LOG = path.join(PROMPTS_DIR, 'changelog.md')
const PROMPT_FILES = {
  worldview: path.join(PROMPTS_DIR, 'worldview.md'),
  boot: path.join(PROMPTS_DIR, 'boot.md')
}
const WORLDVIEW_SEED = [
  // task166 P2-3：种子仅首次建文件用（ensurePrompts），现行文件以 config/prompts/worldview.md 为准；
  // 下方「派完先回主人」句已随 task162 压缩版对齐，后续改世界观请改真实文件、勿依赖种子。
  '# 小 DJ 世界观（常驻注入）',
  '',
  '> 每次请求自动注入；完整规则见 config/RULES.md，这里只放每轮必须知道的。',
  '',
  '## 身份',
  '- 用户称「主人」，我称「小 DJ」，个人管家（personal agent）。',
  '- 全程简体中文；回答短、直接；报错翻成能懂的中文。',
  '- 不确定就先问，一次一问，不许盲猜；主人能接受慢，不能接受需求被认错。',
  '',
  '## 大管家铁律（主会话）',
  '- 主会话=大管家，只接单、判档、派单、汇报；禁止自己改文件、跑命令、写代码、做审查。',
  '- 大管家只对接小管家（steward）；小管家转枢机（secretariat）拆解，执行交执笔（writer），审查交御史（censor-*）。大管家不直接碰枢机。',
  '- 派完先回主人：「任务已安排（小管家：一句话内容），请主人等待」。',
  '- 越级执行=流程事故；只有主人当轮明确说「你直接做」，或机制未就绪且已向主人报备获准，才可例外。',
  '- 拿不准就停手问主人，不许自己顺手做掉。',
  '',
  '## 边界',
  '- 只动当前项目 littleDJ；DAG AI Chat 是独立 APP，未经当轮明确指令不改任何文件。',
  '- 凭据零明文：只读 config/auth.txt、apikeys.json，不外露、不入 git。',
  '- 未经明确指令不 commit/push；不主动安装或启动应用，默认交付到编译通过。',
  '- 模型通道：默认 DeepSeek 官方经本机 4099 中转；禁止绕过中转直连官方；禁止 deveco models --refresh 类刷缓存操作。',
  '',
  '## 流程',
  '- 开工先判档：L0 免审 / L1 枢机自审 / L2 异构御史，存疑就高不就低。',
  '- L2 改动编译后派独立上下文御史审，打回修完再复审，最多 2 轮。',
  '- 每次改动必须留 docs/ MD 记录并登记 docs/README.md，否则视为未完工。',
  '- 派子代理/长任务前先报「派了什么 / 预期上限 / 超时怎么办」；禁止静默等待，超过 60 秒先查日志报状态。',
  '- 收尾：版本号同步、任务牌 state: done、零技术债 grep。',
  '',
  '## 红线',
  '- 零技术债：退役语义零引用；定时器/监听器/异步在销毁点收口；调试打印零残留。',
  '- 需主人手工操作外部界面时，先查官方文档，再按「页面→导航→页签→按钮→填什么」编号原文写清。',
  '- 连续 3 轮修不好即熔断，出死胡同报告等主人决定。',
  '',
  '## 重启恢复',
  '- 新会话首条会带出「未完成任务台账」；看到它就说明服务可能重启过，别当没发生。',
  '- 恢复顺序：读任务牌/文档/代码现状核对真实进度 → 能续做的重派小管家（任务书必须带已完成/待办）→ 拿不准的先把「任务、当前进度、要主人定什么」回报主人 → 更新台账状态。',
  '- 禁止盲目重跑有副作用的步骤；宁可先核对，不要重复执行。',
  '',
  '## 风格',
  '- 主人喜欢被肯定：完成关键节点时真诚夸一句，别油腻。',
  ''
].join('\n')
const BOOT_SEED = [
  // task374：种子与公共段同口径（boot.md 缺失/清空时的兜底）；现行文件以 config/prompts/boot.md 为准。
  '# 开工模板（公共段·各项目通用；本项目专属规则见下方「项目专属段」）',
  '',
  '## 项目归属铁律（最高优先）',
  '- 当前会话所属项目=专属段声明的项目；工作范围=该项目目录，禁止跨项目改文件。',
  '- 在 A 项目会话=做 A 项目任务；要改 B 项目，须主人到 B 项目下开会话。',
  '- 专属段未配置时：不要把其他项目的规则/路径/红线套用到本项目，改动前先问主人。',
  '',
  '## 六查（按序做完再动手；具体路径以专属段为准）',
  '1. 主线：读本项目 README 与文档索引，确认当前主线、最近改动与版本号。',
  '2. 在途：查本项目任务牌目录未完成牌——有牌即前序在途，等待期零改码；仅主人明示才越序。',
  '3. 索引：查本项目代码认知索引（AOCI 或同类），按功能域定位后只读目标区段，禁止无导航整读大文件。',
  '4. 教训：查本项目教训台账，命中同类教训时在任务牌标注编号，不复犯。',
  '5. 断点：看本条注入的台账/任务板/巡检/交接摘要，确认在途任务与上一步断点。',
  '6. 环境：读主人画像与当前模式水印，按入口铁律执行。',
  '',
  '## 三铁律',
  '1. 判档不跳级：L0 免审 / L1 枢机自审 / L2 异构御史；存疑就高不就低。',
  '2. 只动契约清单内的文件；凭据零明文。',
  '3. 先核对后重跑：有副作用的步骤重跑前必须先核对现状。',
  '',
  '## 收尾关卡（通用骨架；每关缺一视为未完工，具体以专属段为准）',
  '版本号按本项目规范同步 / 改动留档并登记 / 任务牌置完成态 / 零技术债 grep / 索引与教训台账刷新 / 定向 commit+推送链。',
  '',
  '## 红线',
  '- 禁止未经授权 commit/push、安装或启动应用、跨项目乱动。',
  '- 项目专属红线见专属段，优先级高于本段。',
  '- 连续 3 轮修不好即熔断，出死胡同报告等主人决定。',
  ''
].join('\n')
function promptMeta(which, text) {
  return { which: which, text: text, path: PROMPT_FILES[which], chars: text.length, tokens: Math.ceil(text.length / 1.7) }
}
function readPrompt(which) {
  const seed = which === 'boot' ? BOOT_SEED : WORLDVIEW_SEED
  try {
    const t = fs.readFileSync(PROMPT_FILES[which], 'utf8')
    return t.trim() ? t : seed
  } catch (e) { return seed }
}
function ensurePrompts() {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true })
  Object.keys(PROMPT_FILES).forEach(function (which) {
    const file = PROMPT_FILES[which]
    if (fs.existsSync(file)) return
    fs.writeFileSync(file, which === 'boot' ? BOOT_SEED : WORLDVIEW_SEED)
    try { fs.chmodSync(file, 0o600) } catch (e) {}
  })
}
function writePrompt(which, text) {
  fs.mkdirSync(PROMPTS_DIR, { recursive: true })
  try { fs.copyFileSync(PROMPT_FILES[which], PROMPT_FILES[which] + '.bak') } catch (e) {}
  fs.writeFileSync(PROMPT_FILES[which], text)
  try { fs.chmodSync(PROMPT_FILES[which], 0o600) } catch (e) {}
  try {
    fs.appendFileSync(PROMPTS_LOG, '- ' + new Date().toISOString() + ' 保存 ' + which + '（' + text.length + ' 字）\n')
  } catch (e) {}
}
function readInstructionPaths() {
  try {
    const file = path.join(os.homedir(), '.config', 'deveco', 'deveco.jsonc')
    const raw = fs.readFileSync(file, 'utf8')
    const m = raw.match(/"instructions"\s*:\s*\[([\s\S]*?)\]/)
    if (!m) return []
    return (m[1].match(/"([^"]+)"/g) || []).map(function (s) { return s.slice(1, -1) })
  } catch (e) { return [] }
}
function readPromptLog() {
  try {
    return fs.readFileSync(PROMPTS_LOG, 'utf8').trim().split('\n').filter(Boolean).slice(-12)
  } catch (e) { return [] }
}
// ---- 角色卡：角色页读取 + 模型写回（生效副本 ~/.config/deveco/agent，源文件在项目 .deveco/agent） ----
const AGENT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/
const AGENT_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/
const AGENT_LIVE_DIR = path.join(os.homedir(), '.config', 'deveco', 'agent')
const AGENT_SOURCE_DIRS = [
  path.join(__dirname, '..', '.deveco', 'agent'),
  path.join(ROOT, '.deveco', 'agent')
]
function parseAgentFrontmatter(text) {
  const out = { tools: [] }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''))
  if (!m) return out
  m[1].split(/\r?\n/).forEach(function (line) {
    if (!line.trim() || /^\s*#/.test(line)) return
    const tm = /^\s{2,}"?([A-Za-z0-9_*-]+)"?\s*:\s*(true|false)\s*$/.exec(line)
    if (tm) {
      if (tm[2] === 'true') out.tools.push(tm[1])
      return
    }
    const mm = /^([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/.exec(line)
    if (!mm) return
    if (mm[1] === 'tools') return
    out[mm[1]] = mm[2].replace(/^["']|["']$/g, '')
  })
  return out
}
function agentCardNames() {
  const names = {}
  ;[AGENT_LIVE_DIR].concat(AGENT_SOURCE_DIRS).forEach(function (dir) {
    try {
      fs.readdirSync(dir).forEach(function (f) {
        if (!/\.md$/i.test(f)) return
        const name = f.replace(/\.md$/i, '')
        if (AGENT_NAME_RE.test(name)) names[name] = 1
      })
    } catch (e) {}
  })
  return Object.keys(names).sort()
}
function agentFilePaths(name) {
  if (!AGENT_NAME_RE.test(name)) return null
  const live = path.join(AGENT_LIVE_DIR, name + '.md')
  let source = ''
  for (let i = 0; i < AGENT_SOURCE_DIRS.length; i++) {
    const f = path.join(AGENT_SOURCE_DIRS[i], name + '.md')
    if (fs.existsSync(f)) { source = f; break }
  }
  return { live: live, source: source }
}
function readTextFile(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (e) { return '' }
}
function promptIsActive(file, list) {
  const abs = path.resolve(file)
  return list.some(function (p) { return path.resolve(p) === abs })
}
/* task263：标签跟角色职责对齐（不写模型名）；task265：角色键与模型解耦——新键 censor-plan/censor-output 上线，旧键 censor-deepseek/glm 退役（薄壳保留注册，历史会话续聊兜底），映射/白名单旧键条目永留 */
const AGENT_LABELS = { butler: '大管家', steward: '小管家', secretariat: '枢机', writer: '执笔', 'censor-plan': '御史·方案审', 'censor-output': '御史·产出审', 'censor-deepseek': '御史·方案审', 'censor-glm': '御史·产出审' }
/* task265：退役键在角色页隐藏（薄壳卡无职责正文，不该露出）；历史数据/续聊不受影响 */
const RETIRED_AGENTS = { 'censor-deepseek': 1, 'censor-glm': 1 }
function rolesPayload() {
  const instr = readInstructionPaths()
  const world = PROMPT_FILES.worldview
  const boot = PROMPT_FILES.boot
  const rules = path.join(CONFIG, 'RULES.md')
  const profile = path.join(CONFIG, 'owner-profile', 'index.md')
  const ROLE_ORDER = ['butler', 'steward', 'secretariat', 'writer', 'censor-plan', 'censor-output']
  const roles = agentCardNames().filter(function (n) { return !RETIRED_AGENTS[n] }).sort(function (a, b) {
    const ia = ROLE_ORDER.indexOf(a), ib = ROLE_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
  }).map(function (name) {
    const fp = agentFilePaths(name)
    const liveExists = !!(fp.live && fs.existsSync(fp.live))
    const sourceExists = !!(fp.source && fs.existsSync(fp.source))
    const text = liveExists ? readTextFile(fp.live) : (sourceExists ? readTextFile(fp.source) : '')
    const fm = parseAgentFrontmatter(text)
    const isPrimary = fm.mode === 'primary'
    const worldActive = promptIsActive(world, instr)
    const profileActive = promptIsActive(profile, instr)
    return {
      name: name,
      label: AGENT_LABELS[name] || '',
      description: fm.description || '',
      mode: fm.mode || '',
      model: fm.model || '',
      color: fm.color || '',
      tools: fm.tools || [],
      livePath: fp.live,
      liveExists: liveExists,
      sourcePath: fp.source || '',
      sourceExists: sourceExists,
      prompts: [
        { key: 'worldview', label: '世界观（每轮注入）', path: world, exists: fs.existsSync(world), active: worldActive, note: worldActive ? 'deveco.jsonc instructions 自动注入' : '未在 instructions 中' },
        { key: 'profile', label: '主人画像摘要', path: profile, exists: fs.existsSync(profile), active: profileActive, note: profileActive ? 'deveco.jsonc instructions 自动注入' : '未在 instructions 中' },
        { key: 'boot', label: '开工三查（首条注入）', path: boot, exists: fs.existsSync(boot), active: isPrimary, note: isPrimary ? '主会话首条经 proxy 注入一次' : '子代理会话不经过 proxy 首条注入' },
        { key: 'rules', label: '完整规则（人读参考）', path: rules, exists: fs.existsSync(rules), active: false, note: '不自动注入；每轮生效的是上面的世界观' },
        { key: 'card', label: '角色卡（本角色）', path: fp.live, exists: liveExists, active: liveExists, note: liveExists ? '全局生效副本，deveco 启动时加载' : (sourceExists ? '仅项目源文件，未部署到全局，当前不生效' : '文件缺失') }
      ]
    }
  })
  return {
    ok: true,
    liveDir: AGENT_LIVE_DIR,
    sourceDirs: AGENT_SOURCE_DIRS,
    instructions: instr,
    restartHint: '角色卡由 deveco 在启动时加载；改完模型需重启 serve 才生效。',
    roles: roles
  }
}
function setAgentModel(text, model) {
  const m = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text)
  if (!m) throw new Error('角色卡缺少 frontmatter')
  let fm = m[2]
  if (/^model\s*:.*$/m.test(fm)) fm = fm.replace(/^model\s*:.*$/m, 'model: ' + model)
  else if (/^name\s*:.*$/m.test(fm)) fm = fm.replace(/^(name\s*:.*)$/m, '$1\nmodel: ' + model)
  else fm = fm + '\nmodel: ' + model
  if (fm === m[2]) return text
  return m[1] + fm + m[3] + text.slice(m[0].length)
}
function writeAgentModel(name, model) {
  const fp = agentFilePaths(name)
  if (!fp) throw new Error('角色名不合法')
  if (!AGENT_MODEL_RE.test(model)) throw new Error('模型格式应为 provider/model')
  const targets = []
  if (fp.source) targets.push(fp.source)
  targets.push(fp.live)
  const written = []
  targets.forEach(function (file) {
    const base = fs.existsSync(file) ? readTextFile(file) : (fp.source ? readTextFile(fp.source) : '')
    if (!base.trim()) return
    const next = setAgentModel(base, model)
    if (next === base) return
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try { fs.copyFileSync(file, file + '.bak') } catch (e) {}
    fs.writeFileSync(file, next)
    written.push(file)
  })
  return written
}
// 开工三查注入状态：每个会话只注入一次（换浏览器也不会重复）
const BOOT_STATE = path.join(PROMPTS_DIR, 'boot-state.json')
const HANDOFF_FILE = path.join(PROMPTS_DIR, 'handoff.json')
function loadBootState() {
  const j = readJson(BOOT_STATE, {})
  return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}
}
function saveBootState(s) {
  const keys = Object.keys(s).sort(function (a, b) { return s[a] - s[b] })
  while (keys.length > 500) delete s[keys.shift()]
  try { writeJson(BOOT_STATE, s) } catch (e) {}
}
function loadHandoff() {
  const j = readJson(HANDOFF_FILE, {})
  return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}
}
function saveHandoff(s) {
  const now = Date.now()
  Object.keys(s).forEach(function (k) {
    if (!s[k] || !s[k].text || (now - (s[k].at || 0)) > 86400000) delete s[k]
  })
  const keys = Object.keys(s).sort(function (a, b) { return (s[a].at || 0) - (s[b].at || 0) })
  while (keys.length > 50) delete s[keys.shift()]
  try { writeJson(HANDOFF_FILE, s) } catch (e) {}
}
// 只取不删：等后端真正接收成功后再删，避免首条失败重发时丢摘要
function peekHandoff(sid) {
  const s = loadHandoff()
  const h = s[sid]
  return (h && h.text) ? String(h.text) : ''
}
function dropHandoff(sid) {
  const s = loadHandoff()
  if (!s[sid]) return
  delete s[sid]
  saveHandoff(s)
}
// ---- task374：boot 注入按项目拆分（公共段 boot.md + 专属段 boot-projects/<项目目录名>.md） ----
// 归属判定：serve 会话对象自带 directory 字段 → 取 basename 为项目 key；
// 专属段未配置的登记项目惰性生成模板（新建项目零手工，公共段全局生效）；未登记目录不落盘只注入短提示。
const PROJECT_BOOT_DIR = path.join(PROMPTS_DIR, 'boot-projects')
const PROJECT_BOOT_KEY_RE = /^[\w.\- ]{1,64}$|^[<>:"/\\|?*·\u4e00-\u9fff][\u4e00-\u9fff\w.\- ]{0,63}$/ // 安全目录名（含中文），禁 .. 与路径分隔
const sessionDirCache = new Map() // sid -> directory（会话目录不变，进程内缓存；boot 首条注入依据）
function projectBootKey(dir) {
  const base = path.basename(String(dir || '').trim())
  if (!base || base === '.' || base === '..') return ''
  if (!PROJECT_BOOT_KEY_RE.test(base) || base.indexOf('..') >= 0 || /[\\/]$/.test(base)) return ''
  return base
}
function projectBootTemplate(key, proj) {
  const name = (proj && proj.name) || key
  const p = (proj && proj.path) || ''
  return [
    '# 项目专属段：' + name + '（待配置——自动生成模板）',
    '',
    '## 项目身份',
    '- 项目路径：' + (p || '（未登记）'),
    '- 本段为自动生成模板，专属规则待主人补充。',
    '',
    '## 归属（默认规则，主人补充前生效）',
    '- 你在本项目会话=只做本项目任务；工作范围限本目录。',
    '- 改动前先问主人；不动其他项目、不删数据、未经授权不 commit/push。',
    '- 不要把其他项目的规则/路径/红线套用到本项目。',
    '',
    '## 待主人补充',
    '- 主线文档 / 任务牌位置 / 代码索引 / 收尾流程 / 专属红线',
    '',
    '（补充方式：直接编辑本文件，下次该项目新会话首条注入即带上）',
    ''
  ].join('\n')
}
// 返回 { key, name, text }；text 空串=未配置（由调用方注入短提示）。读失败/未登记一律不抛错（注入链健壮优先）。
function projectBootText(dir) {
  const key = projectBootKey(dir)
  if (!key) return null
  const file = path.join(PROJECT_BOOT_DIR, key + '.md')
  try {
    const t = fs.readFileSync(file, 'utf8')
    if (t.trim()) return { key: key, name: key, text: t.trim() }
  } catch (e) {}
  // P1-2（task374 御审）：listProjects 不在 try 内会沿 queueDispatch 同步链抛出（SSE idle 路径无异常边界=崩 proxy）；异常按未登记降级
  let proj = null
  try {
    proj = listProjects().filter(function (p) {
      return projectBootKey(p.path) === key || p.name === key
    })[0]
  } catch (e) { proj = null }
  if (!proj) return { key: key, name: key, text: '' }
  const text = projectBootTemplate(key, proj)
  try {
    fs.mkdirSync(PROJECT_BOOT_DIR, { recursive: true })
    fs.writeFileSync(file, text, { mode: 0o600 }) // P2-5：建文件即 600，免 chmod 前窗口
    try { fs.chmodSync(file, 0o600) } catch (e2) {}
    try { fs.appendFileSync(PROMPTS_LOG, '- ' + new Date().toISOString() + ' 自动生成项目专属段模板 ' + key + '\n') } catch (e3) {}
  } catch (e4) { /* 写盘失败降级：本次仍注入模板内容，下次再试落盘 */ }
  return { key: key, name: proj.name, text: text }
}
// sid → 会话 directory（archiveGetJson 直查 serve，30s 超时兜底；成功填进程内缓存）
function sessionDirOf(sid, cb) {
  if (sessionDirCache.has(sid)) return cb(null, sessionDirCache.get(sid))
  archiveGetJson('/session/' + encodeURIComponent(sid), function (err, session) {
    if (err) return cb(err)
    const dir = (session && typeof session.directory === 'string') ? session.directory : ''
    if (dir) sessionDirCache.set(sid, dir)
    cb(null, dir)
  })
}

// ---- task393：技能按需注入（向 DJH skill 体系学习）----
// 技能文件：<运行根>/config/prompts/skills/*.md（头注释 name/triggers）。本轮用户消息
// 命中触发词且该会话未注入过 → 独立 text part 插 index 1（不并入 wmTxt 水印合并文本，
// 不遮蔽 parts[0] 首前缀「【开工三查」——worldview 入口分流判据）。每会话每技能仅一次，
// 标记只在 serve 2xx 接收成功后落（skillCommit，两处成功点），失败重发可重新注入。
// 全函数 fail-open：queueDispatch 调 promptInject 无局部 try/catch，本区炸不得。
const SKILLS_DIR = path.join(PROMPTS_DIR, 'skills')
const SKILL_STATE_FILE = path.join(PROMPTS_DIR, 'skill-state.json')
const SKILL_LOG = path.join(PROMPTS_DIR, 'skill-inject.log')
function skillGateway(parts, sid) {
  const out = { marks: [], block: '' }
  try {
    if (!Array.isArray(parts) || !sid) return out
    const text = parts.map(function (p) { return (p && p.type === 'text') ? String(p.text || '') : '' }).join('\n')
    if (!text.trim()) return out
    const skills = skillInject.readSkills(SKILLS_DIR)
    if (!skills.length) return out
    const state = skillInject.loadSkillState(SKILL_STATE_FILE)
    const seen = (state && state[sid]) || {}
    const hits = skillInject.matchSkills(text, skills).filter(function (s) { return !seen[s.file] })
    if (!hits.length) return out
    out.marks = hits.map(function (s) { return s.file })
    out.block = hits.map(skillInject.formatSkillBlock).join('\n\n')
    return out
  } catch (e) {
    return { marks: [], block: '' }
  }
}
// serve 2xx 成功后落标记（skill-state + 独立 skill-inject.log，不动 changelog.md）
function skillCommit(sid, marks) {
  try {
    if (!sid || !Array.isArray(marks) || !marks.length) return
    const state = skillInject.loadSkillState(SKILL_STATE_FILE)
    const slot = state[sid] || {}
    const now = Date.now()
    marks.forEach(function (f) { slot[f] = now })
    state[sid] = slot
    skillInject.saveSkillState(SKILL_STATE_FILE, state)
    try {
      fs.appendFileSync(SKILL_LOG, '- ' + new Date().toISOString() + ' sid=' + String(sid).slice(0, 12) + '… inject ' + marks.join(',') + '\n')
    } catch (e2) { /* 日志失败不阻断 */ }
  } catch (e) { /* fail-open：下轮可能重复注入一次，可接受 */ }
}
// 技能独立 part 固定插 index 1（紧跟合成后的首 part；parts 单元素时即末尾）
function skillInjectAppend(parts, skill) {
  if (!skill || !skill.marks || !skill.marks.length || !skill.block) return parts
  if (!Array.isArray(parts)) return parts
  const arr = parts.slice()
  arr.splice(Math.min(1, arr.length), 0, { type: 'text', text: skill.block })
  return arr
}

// 注入决策唯一来源（task80 S2a 抽出）：直接发送与队列出队投喂共用，杜绝两套实现。
// 该会话首条 → injectBootText（开工三查/台账/交接/休息态+链路模式水印）；非首条 → 仅两水印前置；否则原样。
// task137：链路模式（direct/flat）水印与休息态水印同链注入，full 默认态不注入省 token。
// task395：回答/任务模式水印同链注入第三元，task 默认态不注入省 token。
// task395 产审 P0-1：回答态**独占水印**——rest/chain 水印里的「自主推进」「等价主人当轮说『你直接做』」
// 恰好命中回答态例外词，叠加注入会让回答态名存实亡；answer 态时三元只留 answer。
// task393：技能命中（skillGateway）时独立 part 插 index 1（首条/水印/无水印三分支都携带）。
function promptInject(parts, sid) {
  const answer = answerRead()
  // 复审 P2-6：抑制条件只看 mode（若带 parts 水印 guard，主人引述水印原文会使 answerOn=false
  // → rest/chain 反向授权水印合流；防重注入由 answerTxt 的 guard 承担，抑制与防重分离）
  const answerOn = answer.mode === 'answer'
  const rest = restRead()
  const restTxt = (!answerOn && rest.on && !restPartsHasWatermark(parts)) ? restWatermark(rest) : ''
  const chain = chainRead()
  const chainTxt = (!answerOn && chain.mode !== 'full' && !chainPartsHasWatermark(parts)) ? chainWatermark(chain) : ''
  const answerTxt = (answerOn && !answerPartsHasWatermark(parts)) ? answerWatermark(answer) : ''
  const wmTxt = [restTxt, chainTxt, answerTxt].filter(Boolean).join('\n')
  const skill = skillGateway(parts, sid) // task393（fail-open）
  const st = loadBootState()
  if (!st[sid]) {
    const inj = injectBootText(parts, sid, wmTxt)
    return { parts: skillInjectAppend(inj.parts, skill), changed: true, shouldMark: true, usedHandoff: inj.handoff, skillMarks: skill.marks }
  }
  // P2-4：与原版对齐——parts 非数组时不进水印分支（避免给坏请求凭空造 parts）
  if (Array.isArray(parts)) {
    if (wmTxt) return { parts: skillInjectAppend(restPrependParts(parts, wmTxt), skill), changed: true, shouldMark: false, usedHandoff: false, skillMarks: skill.marks }
    if (skill.marks.length) return { parts: skillInjectAppend(parts, skill), changed: true, shouldMark: false, usedHandoff: false, skillMarks: skill.marks }
  }
  return { parts: parts, changed: false, shouldMark: false, usedHandoff: false, skillMarks: [] }
}
function injectBootText(parts, sid, wmText) {
  const boot = readPrompt('boot').trim()
  let head = '【开工三查（自动注入 · 仅本会话首条 · 入口 PWA）】\n' + boot
  // task374：项目专属段——紧随公共段；查不到目录（serve 异常/降级）=只公共段，不阻断
  const dir = sid ? (sessionDirCache.get(sid) || '') : ''
  if (dir) {
    const pb = projectBootText(dir)
    if (pb && pb.text) {
      head += '\n\n——— 项目专属段（' + pb.name + '）———\n' + pb.text
    } else {
      const shown = (pb && pb.name) || path.basename(dir)
      const key = (pb && pb.key) || ''
      head += '\n\n——— 项目专属段（' + shown + ' · 未配置）———\n' +
        '⚠ 本项目（' + dir + '）尚未配置专属开工规则，先按公共段执行；不要把其他项目的规则/路径/红线套用过来，改动前先问主人。\n' +
        (key
          ? '配置方式：编辑 ' + path.join(ROOT, 'config', 'prompts', 'boot-projects') + '/' + key + '.md（不存在则创建），下次该项目新会话生效。'
          : '该项目目录名无法自动生成专属段文件（含特殊字符），请主人以安全目录名配置。')
    }
  }
  const handoff = sid ? peekHandoff(sid) : ''
  const ledger = bootLedgerText()
  if (ledger) head += '\n\n' + ledger
  const boardTxt = bootBoardText()
  if (boardTxt) head += '\n\n' + boardTxt
  const patrolTxt = bootPatrolText()
  if (patrolTxt) head += '\n\n' + patrolTxt
  if (handoff) head += '\n\n' + handoff
  // task71/task137：模式水印（休息态/链路模式）只能作为 boot head 追加段，位置在分隔线之前；
  // 绝不拼到 parts[0].text 最前 —— 首前缀必须仍是「【开工三查（自动注入」（worldview 入口分流判据）
  if (wmText) head += '\n\n' + wmText
  head += '\n\n——— 主人本轮消息 ———'
  const arr = Array.isArray(parts) ? parts.slice() : []
  if (arr.length && arr[0] && arr[0].type === 'text') {
    arr[0] = Object.assign({}, arr[0], { text: head + '\n' + String(arr[0].text || '') })
  } else {
    arr.unshift({ type: 'text', text: head })
  }
  return { parts: arr, handoff: !!handoff }
}
function handlePromptAsync(req, res, urlObj, sid) {
  const len = Number(req.headers['content-length'] || 0)
  if (len > 20 * 1024 * 1024) {
    req.resume()
    return json(res, 413, { error: '请求体过大（上限 20MB）' })
  }
  let raw = ''
  req.on('data', function (c) { raw += c })
  // task374：end 回调 async 化（内部含会话目录预热 await）
  req.on('end', async function () {
    let shouldMark = false
    let usedHandoff = false
    let skillMarks = [] // task393：本轮注入的技能（2xx 成功后 skillCommit 落标记）
    let parsed = null
    try { parsed = JSON.parse(raw || '{}') } catch (e) { parsed = null }
    // task71：口述短语检测先于注入判断，命中即写状态并失效缓存（下一段 restRead 同轮可见）
    if (parsed) { try { restDetectSpoken(parsed.parts, sid) } catch (e) {} }
    // task374：预热会话目录（首条注入项目专属段依据；3s 竞速，serve 慢/挂=降级公共段不阻断；迟到回调仍填缓存供出队路径复用）
    // P2-3（御审）：仅 boot-state 未标记（=可能首条注入）的会话才预热，老会话非首条不再多等 3s（消 L-003 窗口放大）
    let needDirWarm = true
    try { needDirWarm = !loadBootState()[sid] } catch (e) { needDirWarm = true }
    if (needDirWarm) {
      try {
        await Promise.race([
          new Promise(function (r) { sessionDirOf(sid, function () { r() }) }),
          new Promise(function (r) { const t = setTimeout(r, 3000); if (t.unref) t.unref() })
        ])
      } catch (e) {}
    }
    const partsOk = !!(parsed && Array.isArray(parsed.parts) && parsed.parts.length)

    // task367：async 化后 res 必答兜底（P2-③）——OCR/注入异常不悬挂请求。
    // P1-2（产审）：busyTimer/busySettled 提升到本作用域，direct 异常收口时先停 60s 兜底定时器
    // 再清忙，防其迟到回调误清「同 sid 新回合」的忙态；enqueue 路径未置忙不清。
    let directBusySettled = false
    let directBusyTimer = null
    const failPrompt = function (tag, e) {
      ocrLog('WARN handlePromptAsync ' + tag + ' 异常：' + String((e && e.message) || e))
      if (tag === 'direct') {
        directBusySettled = true
        if (directBusyTimer) { clearTimeout(directBusyTimer); directBusyTimer = null }
        if (queueBusy[sid]) { delete queueBusy[sid]; queueTickSoon() }
      }
      if (!res.headersSent) return json(res, 502, { error: '消息处理异常（' + tag + '），请重试' })
      try { res.end() } catch (e2) {}
    }

    const doEnqueue = async function () {
      // task80 S2a：目标会话有队列/正在生成 → 入队并回 202（绝不 abort 当前轮，绝不透传给 serve）
      // task133：serve 宕机同样入队——宕机排队，恢复后自动派发（不置忙，不依赖忙语义）
      // P0-1：入队时把请求体里的 model/agent 一并留存（存在才存），出队整包投喂
      // task367：入队前 OCR 转写（出队 queueFeed→proxyApi 直打后端绕过本函数——入队前转写无绕过）
      try { await ocrGate(parsed, sid) } catch (e) { ocrLog('WARN ocrGate 异常（入队路径，gate 内部已降级）：' + String((e && e.message) || e)) }
      const q = queueEnqueue(sid, parsed.parts, queueEcho(parsed.parts), queueBodyExtra(parsed))
      if (q.code === 409) return json(res, 409, { ok: false, error: 'queue_full', count: q.count })
      if (q.deduped) return json(res, 202, { ok: true, deduped: true, count: q.count, serveDown: !!backendDownAt })
      return json(res, 202, { ok: true, queued: true, position: q.position, count: q.count, serveDown: !!backendDownAt })
    }

    const doDirect = async function () {
      let out = raw
      let bodyDirty = false // task367：OCR/promptInject 任一改过 parts 都必须重建投喂 body（P0-1：不能只靠 promptInject.changed）
      // P1-2：进入投喂前乐观置忙——在途窗口内的第二条必被 queueShouldQueue 拦成 202 入队，
      // 绝不再透传给 serve（那里会取消当前轮，L-003）。失败/非 2xx/超时回调里清忙，2xx 保持忙直到 idle。
      // task367（P2-② 重排）：置忙提到 OCR/promptInject 之前——OCR 在途窗口（≤28s）同样受忙态保护，防连发 L-003
      queueMarkBusy(sid)
      // task367：OCR 转写（GLM 纯文本模型的图片附件→DeepSeek OCR 文本替换；详见 task367 段注释）
      try {
        const og = await ocrGate(parsed, sid)
        if (og && og.changed) bodyDirty = true
      } catch (e) { ocrLog('WARN ocrGate 异常（直发路径，gate 内部已降级）：' + String((e && e.message) || e)) }
      try {
        const inj = promptInject(parsed.parts, sid)
        if (inj.changed) {
          parsed.parts = inj.parts
          shouldMark = inj.shouldMark
          usedHandoff = inj.usedHandoff
          skillMarks = inj.skillMarks || [] // task393：serve 2xx 后落技能去重标记
          bodyDirty = true
        }
      } catch (e) { /* 注入失败保 raw/OCR 结果 */ }
      if (bodyDirty) {
        try { out = JSON.stringify(parsed) } catch (e) { out = raw }
      }
      let busySettled = directBusySettled // P1-2：吸收 failPrompt 兜底已收口的态（兜底先到则 settleBusy 全短路）
      let busyTimer = null
      const settleBusy = function (code) {
        if (busySettled || directBusySettled) return
        busySettled = true
        directBusySettled = true
        if (busyTimer) clearTimeout(busyTimer)
        if (directBusyTimer) { clearTimeout(directBusyTimer); directBusyTimer = null }
        if (code >= 200 && code < 300) {
          if (shouldMark) {
            const st = loadBootState()
            st[sid] = Date.now()
            saveBootState(st)
          }
          if (usedHandoff) dropHandoff(sid)
          if (skillMarks.length) skillCommit(sid, skillMarks) // task393：serve 真正接收成功才落技能标记
          queueMarkBusy(sid)
          queueWatchSession(sid)
          return
        }
        // 失败/超时：清忙，允许重发；已入队的消息由定时器兜底出队
        if (queueBusy[sid]) { delete queueBusy[sid]; queueTickSoon() }
      }
      busyTimer = setTimeout(function () { settleBusy(0) }, QUEUE_DIRECT_TIMEOUT_MS)
      directBusyTimer = busyTimer // P1-2：failPrompt 兜底可停此 timer
      if (busyTimer.unref) busyTimer.unref()
      // 只有后端真正接收成功（2xx）才落「已注入」与删除交接摘要，失败重发仍可重新注入
      return proxyApi(req, res, urlObj, out, settleBusy)
    }

    const doEnqueueS = function () { Promise.resolve(doEnqueue()).catch(function (e) { failPrompt('enqueue', e) }) }
    const doDirectS = function () { Promise.resolve(doDirect()).catch(function (e) { failPrompt('direct', e) }) }
    if (partsOk && (queueShouldQueue(sid) || backendDownAt)) return doEnqueueS()
    if (partsOk) {
      // task133：无宕机先验时直发前 TCP 存活探测（500ms，本地回环健康 ~1ms）——serve 进程死（端口拒连）
      // 首条也不丢：不通→置位+入队。残余 TOCTOU（探测通过后 serve 才死）：直发 502 置位，下一条入队，不劣于现状。
      return backendTcpAlive(function (alive) {
        if (!alive) {
          backendMarkDown() // task134：置位收口（含打断在途回合）
          return doEnqueueS()
        }
        return doDirectS()
      })
    }
    return doDirectS() // 非文本 parts / JSON 坏：原样直发（旧语义）
  })
}

/* 停当前轮（P1-1）：POST /api/session/<sid>/abort 经 proxy 时先「暂停出队」再透传 abort。
   动机：只 abort 的话，idle 一到 /_queue/next 会自动续跑下一条，主人以为「停了」其实在跑队列。
   做法：该 sid 队列非空 → queuePaused 置 true 并落盘（先置、后透传：abort 失败/网络异常也保持暂停，
         宁可手动「继续」，不误续）；队列空 → 不改语义，原样透传。
   红线：这里只做「暂停判定 + 透传 abort」，不调用第二颗停止键、不改写/不清空队列。 */
function handleSessionAbort(req, res, urlObj, sid) {
  if (sid && queueList(sid).length) {
    queueSetPaused(sid, true)
    queueSave()
  }
  return proxyApi(req, res, urlObj, null, function (code) {
    // abort 真成功（2xx/已结束）→ 该轮已终止，清忙标记；paused 兜住出队，不会抢跑
    if ((code >= 200 && code < 300) || code === 404 || code === 410) {
      if (queueBusy[sid]) delete queueBusy[sid]
    }
  })
}

/* ---------- 消息队列（task80 S2a）----------
   动机：主人在一轮生成中再发消息会被 serve 取消当前轮（L-003 复发）；改为入队，本轮照常跑完。
   口径（方案稿 §4/§10 定稿）：
   - 落盘 config/queue-state.json：{version,queues:{sid:[{id,at,parts,echo,model?,agent?,state}]},paused:{sid:1}}
     state=queued|inflight；model/agent 只在入队请求体里存在且形状合法时保存（不伪造）
   - 写：同目录 tmp-<pid>-<rand> → renameSync、0600；每个事件一次写
   - 读：仅「文件不存在」=空队列；JSON 损坏/结构非法 → 改名 .bad-<时间戳> 留证 + queueWarnBy['*']，不静默清空
   - 入队：同一文本 500ms 内只入队一次（去重，绝不拼接/改写原文）；上限 10 条/会话，超限 409
   - 出队：单飞 idle→dispatching→idle；投喂复用 proxyApi + promptInject（与 handlePromptAsync 同源），不直连 4098
     出队只替换 parts，条目里存着的 model/agent 原样带回（P0-1）
   - 触发（S2a 实测定稿）：主 = 本进程自订阅后端 SSE 的 session.idle / session.status；
     兜底 = 3s 轮询 /api/session/status（实测恒返回 {}，空 map 不改变任何状态）+ 消息完成度探测
   - paused：随队列落盘（P1-1「停当前/停全部」联动），重启只恢复「队列非空」的 paused：
     空队列的 paused 一律丢弃，避免「重启后静默死局」
   - 唯一写者是 proxy；UI 只读（多标签写权仲裁不在 S2a） */
const QUEUE_FILE = path.join(CONFIG, 'queue-state.json')
const QUEUE_VERSION = 1
const QUEUE_MAX = 10
const QUEUE_DEDUPE_MS = 500
const QUEUE_POLL_MS = 3000
const QUEUE_ECHO_MAX = 200
const QUEUE_BUSY_TTL = 10 * 60 * 1000 // 忙标记硬上限：超时必清，防僵死拦截
const QUEUE_SSE_SILENT_MS = 30000 // SSE 静默阈值，超过则改用消息完成度探测兜底
const QUEUE_PROBE_MIN_MS = 8000 // 忙标记陈旧多久才允许探测（避免长任务频繁查）
const QUEUE_RETRY_LIMIT = 3 // 连续投喂失败上限：到限暂停该会话派发（消息保留，不丢）
const QUEUE_DIRECT_TIMEOUT_MS = 60 * 1000 // 直接投喂乐观置忙的超时兜底：到点仍未回包则清忙（防僵死拦截）
const QUEUE_FEED_TIMEOUT_MS = 120 * 1000 // 出队投喂超时兜底：到点按失败回调，防 dispatching 卡死
const QUEUE_HEAL_MIN_MS = 5000 // 同一 sid 订阅自愈最小间隔（与 queueResubscribe 的 5s 退避同频）
const QUEUE_HEAL_REDIAL_WARN = 60 // 自愈重订累计阈值：达此值告警一次（约单目录连续 5 分钟 1 次/5s）
/* task133 宕机排队：后端健康状态机（内存态，proxy 重启自愈）
   - backendDownAt：0=健康；>0=首次判宕机时刻。置位单点=proxyApi preq.on('error')（连接级唯一入口，task133 枢机 P1-3：
     进该 catch 即连接级，不做 e.code 枚举——枚举漏 EPIPE 且与语义重复）；清位=后端任意 2xx / 探测 /health 200。
   - lastConnErrAt：P1-1 桥接——queueDispatch 失败回调只能拿到 code=502（连接失败与 serve 应答 502 同形），
     用「502 且最近 2s 内发生过连接级失败」判连接级（不烧 attempts 不暂停）；写点全文件恰 1 处。
   - backendChecking：探测 in-flight 防重入（P2-3，参照 queueProbing 模式）。 */
let backendDownAt = 0
let lastConnErrAt = 0
let backendChecking = false

/* task134：宕机置位收口——置位 + 立即打断在途回合（清忙 + 记杀死纪元）。
   缘起 2026-11-09 事故：serve 重启杀掉在途回合后，busy 挂到 TTL、前端永远等不到 idle 一直转圈，
   主人静默干等 10 分钟无人报丧（task133 已知缺口「挂起死等不通知」的补口）。
   改法：置位瞬间对全部 busy 会话清忙（serve 已死，忙无意义；主人新消息可直发不被拦）
   + queueKilledAt 纪元（前端 3s 轮询 /_queue 发现 turnInterrupt 新纪元即 toast「被打断，请重发」）。
   lastConnErrAt 每次调用都刷新（保持 P1-1「502+2s 时间窗」桥接语义，含已置位时的重复触发）。 */
function backendMarkDown() {
  lastConnErrAt = Date.now()
  if (backendDownAt) return
  backendDownAt = Date.now()
  Object.keys(queueBusy).forEach(function (sid) {
    delete queueBusy[sid]
    queueKilledAt[sid] = Date.now()
  })
  queueTickSoon()
}

let queueDoc = queueFresh()
let queueWarnBy = {} // sid -> 告警文案；键 '*' = 文件级/全局告警
let queueTimer = null
let queueTickQueued = false
let queueSseAtBy = {} // sid -> 最近一次「本会话」SSE 事件时刻（60s 剪枝）
let queueIdleAtBy = {} // sid -> 最近一次 run 级 idle 事件时刻（删忙唯一凭据，60s 剪枝）
let queueBadSeq = 0
const queuePaused = {} // sid -> true（内存态）
const queueBusy = {} // sid -> 置忙时间戳
const queueBusyEpoch = {} // sid -> 本次忙周期的纪元（task124：置忙迁移 false→true 时取 Date.now()，删忙点一律不重置——跨周期时间戳不复用，纪元证人 CAS 用；不落盘）
const queueKilledAt = {} // sid -> 在途回合被 serve 重启杀死时刻（task134：宕机置位瞬间清忙并记纪元；/_queue 回执 turnInterrupt 携带，前端见新纪元 toast「请重发」；60s 剪枝归零不误报）
let queueWitnessWarned = false // 纪元证人删忙告警单次闸（task124 F3″）
let queueForceWarned = false // force 强制发送告警单次闸（task124 F3″）
let queueTickWarned = false // tick 异常告警单次闸（task124 产出审 P2-1）
const queueDirs = {} // sid -> directory（订阅 SSE 用）
const queueLast = {} // sid -> {txt, at}（500ms 去重）
const queueSubs = {} // directory -> {req, retry}
const queueProbing = {} // sid -> true（消息完成度探测单飞）
const queueHealAt = {} // sid -> 上次自愈尝试时刻（5s 节流，60s 剪枝）
const queueDirMissAt = {} // sid -> 上次补查 directory 时刻（5s 节流，60s 剪枝）
let queueHealRedial = 0 // 自愈重订累计次数（不落盘，重启归零）
let queueHealRedialWarned = false // 阈值告警单次闸
const dispatching = new Set() // 出队单飞：sid 在 dispatching 中
// 注：queueSseAtBy/queueIdleAtBy/queueHealAt/queueDirMissAt 等内存态不落盘是有意的——重启视为「无事件」，由 tick 探测/自愈重建。

function queueFresh() { return { version: QUEUE_VERSION, queues: {}, paused: {} } }

function queueWarnSet(sid, msg) { queueWarnBy[sid || '*'] = String(msg || '') }
function queueWarnClear(sid) { delete queueWarnBy[sid] }
function queueItemOk(it) {
  return !!it && typeof it === 'object' && typeof it.id === 'string' && it.id.length > 0 && it.id.length <= 64 &&
    Array.isArray(it.parts) && it.parts.length > 0
}

function queueSave() {
  const body = JSON.stringify(queueDoc, null, 2)
  const tmp = QUEUE_FILE + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8)
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true })
    fs.writeFileSync(tmp, body, { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e) {}
    fs.renameSync(tmp, QUEUE_FILE)
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {}
    console.error('[queue] 落盘失败 code=' + ((e && e.code) || 'unknown'))
    queueWarnSet('*', '排队消息保存失败（' + ((e && e.code) || '未知错误') + '），重启后可能丢失')
  }
}

function queueBad(reason) {
  const bad = QUEUE_FILE + '.bad-' + Date.now() + (queueBadSeq ? '-' + queueBadSeq : '')
  queueBadSeq++
  try { fs.renameSync(QUEUE_FILE, bad) } catch (e) {}
  queueWarnSet('*', '队列文件' + reason + '，已备份留证（' + path.basename(bad) + '），未恢复任何排队消息')
  return null
}

// 启动恢复：只恢复 state=queued；inflight 不重投（避免重复执行），丢弃并记 warn
function queueLoad() {
  queueDoc = queueFresh()
  queueWarnBy = {}
  queueSseAtBy = {}
  let raw = null
  try { raw = fs.readFileSync(QUEUE_FILE, 'utf8') } catch (e) {
    if (!e || e.code !== 'ENOENT') queueWarnSet('*', '队列文件读取失败（' + ((e && e.code) || '未知') + '），已按空队列处理')
    return
  }
  let doc = null
  try { doc = JSON.parse(raw) } catch (e) { return queueBad('格式损坏') }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !doc.queues || typeof doc.queues !== 'object' || Array.isArray(doc.queues)) {
    return queueBad('结构非法')
  }
  let restored = 0
  let dropped = 0
  Object.keys(doc.queues).forEach(function (sid) {
    const arr = doc.queues[sid]
    if (!Array.isArray(arr)) return
    const keep = []
    arr.forEach(function (it) {
      if (!queueItemOk(it)) return
      if (it.state === 'inflight') { dropped++; return }
      const item = {
        id: it.id,
        at: Number(it.at) || Date.now(),
        parts: it.parts,
        echo: String(it.echo == null ? '' : it.echo).slice(0, QUEUE_ECHO_MAX),
        state: 'queued'
      }
      // P0-1：旧档无 model/agent 字段 → 不补、不猜；有且合法才恢复（出队时原样带回）
      if (it.model && typeof it.model === 'object' && !Array.isArray(it.model)) item.model = it.model
      if (typeof it.agent === 'string' && it.agent) item.agent = it.agent
      keep.push(item)
    })
    if (keep.length) { queueDoc.queues[sid] = keep; restored += keep.length }
  })
  // P1-1：重启只恢复「仍有排队消息」的 paused；空队列的 paused 丢弃（避免静默死局）
  if (doc.paused && typeof doc.paused === 'object' && !Array.isArray(doc.paused)) {
    Object.keys(doc.paused).forEach(function (sid) {
      if (doc.paused[sid] && queueDoc.queues[sid] && queueDoc.queues[sid].length) {
        queuePaused[sid] = true
        queueDoc.paused[sid] = 1 // 同步镜像：否则下一次 queueSave 会把 paused 写丢
      }
    })
  }
  if (dropped) {
    queueWarnSet('*', '已恢复 ' + restored + ' 条未投喂消息；另有 ' + dropped + ' 条「投喂中」消息因重启未重投（避免重复执行）')
  }
}

function queueEcho(parts) {
  if (!Array.isArray(parts)) return ''
  const t = parts.map(function (p) { return (p && p.type === 'text') ? String(p.text || '') : '[附件]' }).join(' ')
  return t.replace(/\s+/g, ' ').trim().slice(0, QUEUE_ECHO_MAX)
}

function queueList(sid) { return queueDoc.queues[sid] || [] }

// P1-1：paused 唯一写入口（内存 + 落盘镜像）。不落盘会丢「abort 联动暂停」，多端也就不一致。
function queueSetPaused(sid, on) {
  if (!sid) return
  if (on) queuePaused[sid] = true
  else delete queuePaused[sid]
  const mirror = {}
  Object.keys(queuePaused).forEach(function (k) { if (queuePaused[k]) mirror[k] = 1 })
  queueDoc.paused = mirror
}

function queuePayload(sid) {
  const list = queueList(sid)
  return {
    session: sid,
    paused: !!queuePaused[sid],
    warn: queueWarnBy[sid] || queueWarnBy['*'] || '',
    count: list.length,
    items: list.map(function (it) {
      return { id: it.id, at: it.at, echo: it.echo, state: it.state === 'inflight' ? 'inflight' : 'queued' }
    }),
    // task124 尾追（回执字段，不落盘）：后端忙真相 + 纪元，供前端矛盾态判定与证人携带
    busy: !!queueBusy[sid],
    busyAt: queueBusy[sid] || 0,
    busyEpoch: queueBusyEpoch[sid] || 0,
    // task133：宕机排队态（内存派生，不落盘）
    serveDown: !!backendDownAt,
    downSince: backendDownAt || 0,
    // task134：在途回合被 serve 重启杀死的纪元（0=无/已剪枝归零；前端见新纪元 toast「请重发」）
    turnInterrupt: queueKilledAt[sid] || 0
  }
}

// 入队：返回 {ok,queued|deduped,position,count} 或 {ok:false,code:409,error:'queue_full',count}
// extra = 请求体里与 parts 同源的 model/agent（P0-1）：存在且形状合法才存，绝不伪造
function queueEnqueue(sid, parts, echo, extra) {
  if (!sid || typeof sid !== 'string') return { ok: false, code: 400, error: 'session 无效' }
  if (!Array.isArray(parts) || !parts.length) return { ok: false, code: 400, error: 'parts 必填且不能为空' }
  const list = queueList(sid)
  const txt = JSON.stringify(parts)
  const last = queueLast[sid]
  if (last && last.txt === txt && (Date.now() - last.at) < QUEUE_DEDUPE_MS) {
    return { ok: true, deduped: true, count: list.length }
  }
  if (list.length >= QUEUE_MAX) return { ok: false, code: 409, error: 'queue_full', count: list.length }
  const item = {
    id: 'q_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    parts: parts, // 原样保存：出队投喂不得二次拼接/改写（红线③）
    echo: String(echo == null ? '' : echo).slice(0, QUEUE_ECHO_MAX),
    state: 'queued'
  }
  const ex = (extra && typeof extra === 'object' && !Array.isArray(extra)) ? extra : {}
  if (ex.model && typeof ex.model === 'object' && !Array.isArray(ex.model)) item.model = ex.model
  if (typeof ex.agent === 'string' && ex.agent) item.agent = ex.agent
  if (!queueDoc.queues[sid]) queueDoc.queues[sid] = []
  queueDoc.queues[sid].push(item)
  queueLast[sid] = { txt: txt, at: Date.now() }
  queueSave()
  queueEnsureTimer()
  return { ok: true, queued: true, position: queueDoc.queues[sid].length, count: queueDoc.queues[sid].length, id: item.id }
}

// 从请求体挑出可随条目保存的 model/agent（只认存在且合法的字段；缺字段=出队时不带，行为同旧版）
function queueBodyExtra(d) {
  const out = {}
  if (d && d.model && typeof d.model === 'object' && !Array.isArray(d.model)) out.model = d.model
  if (d && typeof d.agent === 'string' && d.agent) out.agent = d.agent
  return out
}

// 出队请求体：parts 用注入后的新值，model/agent 原样带回（P0-1 整包投喂）
function queueOutBody(parts, item) {
  const out = { parts: parts }
  if (item && item.model && typeof item.model === 'object' && !Array.isArray(item.model)) out.model = item.model
  if (item && typeof item.agent === 'string' && item.agent) out.agent = item.agent
  return JSON.stringify(out)
}

function queueRemove(sid, id) {
  const list = queueDoc.queues[sid]
  if (!list || !list.length) return { ok: false, code: 404, error: 'not_found' }
  let idx = -1
  for (let i = 0; i < list.length; i++) if (list[i].id === id) { idx = i; break }
  if (idx < 0) return { ok: false, code: 404, error: 'not_found' }
  if (list[idx].state !== 'queued') return { ok: false, code: 409, error: 'inflight' }
  list.splice(idx, 1)
  if (!list.length) { delete queueDoc.queues[sid]; queueSetPaused(sid, false) }
  queueSave()
  return { ok: true, count: queueList(sid).length }
}

// 清空 = 清队列并退出 paused（方案 §3 暂停态三终态）
function queueClear(sid) {
  delete queueDoc.queues[sid]
  queueSetPaused(sid, false)
  delete queueSseAtBy[sid]
  delete queueIdleAtBy[sid]
  delete queueHealAt[sid]
  delete queueDirMissAt[sid]
  queueWarnClear(sid)
  queueSave()
  return { ok: true, count: 0 }
}

// P1-1：「停止全部」→ 所有非空队列先挂出队，再 abort（避免 abort 后 idle 抢跑下一条）
function queuePauseNonEmpty() {
  let n = 0
  Object.keys(queueDoc.queues).forEach(function (sid) {
    const list = queueDoc.queues[sid]
    if (list && list.length && !queuePaused[sid]) { queueSetPaused(sid, true); n++ }
  })
  if (n) queueSave()
  return n
}

function queueShouldQueue(sid) {
  if (dispatching.has(sid)) return true
  if (queueList(sid).length) return true
  if (queuePaused[sid]) return true
  if (queueBusy[sid] && (Date.now() - queueBusy[sid]) < QUEUE_BUSY_TTL) return true
  return false
}

function queueMarkBusy(sid) {
  if (!sid) return
  // task124 纪元：只在闲→忙迁移瞬间写纪元（同一回合多次 busy 事件/置忙不重写），删忙点不重置
  if (!queueBusy[sid]) queueBusyEpoch[sid] = Date.now()
  queueBusy[sid] = Date.now()
  queueEnsureTimer()
}

// 出队投喂：与 handlePromptAsync 等价路径（proxyApi 透传给 serve），不直连、不另起实现
function queueFeed(sid, body, cb) {
  let code = 0
  let done = false
  const sink = new Writable({ write: function (c, e, done2) { done2() } })
  sink.writeHead = function (c2) { code = c2; sink.headersSent = true }
  const fakeReq = {
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) },
    method: 'POST',
    pipe: function () {}
  }
  // once 语义 + 超时兜底：无论成功/失败/超时都只回调一次，避免 dispatching 卡死或双发
  const finish = function (c3) {
    if (done) return
    done = true
    clearTimeout(timer)
    cb(c3 || code || 502)
  }
  const timer = setTimeout(function () { finish(504) }, QUEUE_FEED_TIMEOUT_MS)
  if (timer.unref) timer.unref()
  proxyApi(fakeReq, sink, { pathname: '/api/session/' + encodeURIComponent(sid) + '/prompt_async', search: '' }, body, finish)
}

function queueDispatch(sid) {
  if (!sid || dispatching.has(sid) || queuePaused[sid]) return false
  const list = queueList(sid)
  if (!list.length) return false
  const item = list[0]
  if (item.state !== 'queued') return false
  dispatching.add(sid)
  item.state = 'inflight' // 先落盘：重启时该条不重投
  queueSave()
  const prep = promptInject(item.parts, sid)
  // P0-1：只替换/注入 parts，条目存着的 model/agent 原样带回，整包投喂 serve
  const body = queueOutBody(prep.parts, item)
  queueFeed(sid, body, function (code) {
    dispatching.delete(sid)
    const arr = queueList(sid)
    if (code >= 200 && code < 300) {
      if (arr.length && arr[0] === item) arr.shift()
      if (!arr.length) { delete queueDoc.queues[sid]; queueSetPaused(sid, false) }
      queueMarkBusy(sid) // task124：统一收口（含纪元迁移守卫）
      queueWarnClear(sid) // 该会话已恢复正常派发，旧的重试告警必须消失
      queueSave()
      if (prep.shouldMark) {
        const st = loadBootState()
        st[sid] = Date.now()
        saveBootState(st)
      }
      if (prep.usedHandoff) dropHandoff(sid)
      if (prep.skillMarks && prep.skillMarks.length) skillCommit(sid, prep.skillMarks) // task393：出队成功同样落技能标记
    } else {
      // task133（枢机 P1-1）：连接级失败（502 且 2s 内发生过连接级错误——queueFeed 回调只拿 code，
      // 连接失败与 serve 应答 502 同形，靠 lastConnErrAt 时间窗区分）→ 不烧 attempts 不暂停：
      // 宕机不算投喂失败，等恢复探测（queueTick 首步）清位后自动派发。
      const connLevel = code === 502 && lastConnErrAt && (Date.now() - lastConnErrAt) < 2000
      if (connLevel) {
        item.state = 'queued'
        queueSave()
      } else {
        item.state = 'queued'
        item.attempts = (Number(item.attempts) || 0) + 1
        if (item.attempts >= QUEUE_RETRY_LIMIT) {
          queueSetPaused(sid, true)
          queueWarnSet(sid, '会话 ' + String(sid).slice(0, 12) + '… 连续 ' + item.attempts + ' 次投喂失败（HTTP ' + code + '），已暂停派发，排队消息保留')
        }
        queueSave()
      }
    }
    queueEnsureTimer()
  })
  return true
}

// 消息完成度探测：最后一条 assistant 消息已 completed 即「很可能收尾」；只用于触发订阅自愈/补 dir，绝不当删忙凭据（L-003）
function queueMsgIdle(sid, cb) {
  archiveGetJson('/session/' + encodeURIComponent(sid) + '/message', function (err, list) {
    if (err || !Array.isArray(list) || !list.length) return cb(false)
    for (let i = list.length - 1; i >= 0; i--) {
      const info = (list[i] && (list[i].info || list[i])) || {}
      if (info.role !== 'assistant') continue
      const t = info.time || {}
      return cb(!!t.completed)
    }
    cb(false)
  })
}

function queueTryDispatch(sid) {
  if (!sid) return false
  if (queuePaused[sid] || dispatching.has(sid)) return false
  if (queueBusy[sid] && (Date.now() - queueBusy[sid]) < QUEUE_BUSY_TTL) return false
  return queueDispatch(sid)
}

function queueHasWork() {
  const now = Date.now()
  if (Object.keys(queueBusy).some(function (k) { return (now - queueBusy[k]) < QUEUE_BUSY_TTL })) return true
  if (Object.keys(queueDoc.queues).some(function (k) { return queueDoc.queues[k] && queueDoc.queues[k].length })) return true
  if (backendDownAt > 0) return true // task133（枢机 P2-1）：down 态探测永跑，防「down+队列空→tick 停→标记冻结」
  return false
}

function queueTickSoon() {
  if (queueTickQueued) return
  queueTickQueued = true
  const t = setTimeout(function () { queueTickQueued = false; queueTick() }, 200)
  if (t.unref) t.unref()
}

function queueEnsureTimer() {
  if (queueTimer) return
  if (!queueHasWork()) return
  queueTimer = setTimeout(queueTick, QUEUE_POLL_MS)
  if (queueTimer.unref) queueTimer.unref()
}

function queueTick() {
  queueTimer = null
  try {
    const now = Date.now()
    Object.keys(queueBusy).forEach(function (sid) {
      if ((now - queueBusy[sid]) >= QUEUE_BUSY_TTL) delete queueBusy[sid] // task124：TTL 清忙不动纪元（时间戳跨周期不复用）
    })
    // 时间戳 map 统一 60s 剪枝：判据阈值 30s，剪掉 ≥60s 等价「从未见过」，无行为损失
    const stale = 2 * QUEUE_SSE_SILENT_MS
    ;[queueSseAtBy, queueIdleAtBy, queueHealAt, queueDirMissAt, queueKilledAt].forEach(function (m) {
      Object.keys(m).forEach(function (k) { if ((now - m[k]) >= stale) delete m[k] })
    })
    if (!queueHasWork()) return
    // task133：宕机态首步探测——仍挂则本跳不派发（不烧 attempts；finally 依赖 P2-1 的 hasWork 重排）；
    // 恢复则清位 + queueTickSoon(200ms) 立即再跳派发（闭环 ≤3s 探测 + 0.2s 再跳）
    if (backendDownAt) {
      if (backendChecking) return
      backendChecking = true
      backendCheckOnce(function (ok) {
        backendChecking = false
        if (ok && backendDownAt) { backendDownAt = 0; queueTickSoon() }
      })
      return
    }
    const sids = Object.keys(queueDoc.queues)
    for (let i = 0; i < sids.length; i++) {
      const sid = sids[i]
      if (queuePaused[sid] || dispatching.has(sid)) continue
      queueHeal(sid, now) // 订阅自愈：只补订阅/补 dir，不投喂
      const busyAt = queueBusy[sid] || 0
      if (busyAt && (now - busyAt) < QUEUE_BUSY_TTL) {
        // 门禁只看「本会话」事件新鲜度：其他目录/会话再热闹也不遮蔽本会话的探测
        const sidSseFresh = queueSseAtBy[sid] && (now - queueSseAtBy[sid]) < QUEUE_SSE_SILENT_MS
        if (!sidSseFresh && !queueProbing[sid] && (now - busyAt) > QUEUE_PROBE_MIN_MS) {
          queueProbing[sid] = true
          queueMsgIdle(sid, function (idle) {
            delete queueProbing[sid]
            if (idle) queueHeal(sid, Date.now()) // 只补自愈/补 dir，绝不删忙投喂
          })
        }
        continue
      }
      if (queueDispatch(sid)) break
    }
  } catch (e) {
    // task124（终审 P1-7+产出审 P2-1）：tick 抛错不得导致「不重排 + 进程崩溃」双风险；单次闸防 3s 复现刷日志
    if (!queueTickWarned) {
      queueTickWarned = true
      try { console.error('[queue] tick 异常（已吞，继续调度，仅提示一次）: ' + (e && e.message)) } catch (e2) {}
    }
  } finally {
    queueEnsureTimer()
  }
}

/* ---- 后端 SSE 订阅（S2a 实测：/api/session/status 恒返回 {}，busy/idle 只能靠事件）----
   按目录订阅；断线 5s 重连（最多 5 次）；事件只更新队列内部状态，不改变任何 /api 透传行为 */
function queueOnEvent(d) {
  if (!d || typeof d !== 'object' || !d.type) return
  const p = d.properties || {}
  const sid = p.sessionID
  if (!sid || typeof sid !== 'string') return
  queueSseAtBy[sid] = Date.now() // 按会话记录：别的会话的事件不得遮蔽本会话静默判定
  const st = p.status || {}
  if (d.type === 'session.status') {
    if (st.type === 'busy') queueMarkBusy(sid) // task124：统一收口（含纪元迁移守卫）
    else if (st.type === 'idle') {
      queueIdleAtBy[sid] = Date.now(); delete queueBusy[sid]; queueTryDispatch(sid)
      try { reapHintIdle(sid) } catch (e) {} // task234：跑完瞬间收口台账（不等 60s tick）
    }
    return
  }
  if (d.type === 'session.idle') {
    queueIdleAtBy[sid] = Date.now()
    delete queueBusy[sid]
    queueTryDispatch(sid)
    try { reapHintIdle(sid) } catch (e) {} // task234：同上
  }
}

function queueSubscribe(dir, retry) {
  if (!dir || queueSubs[dir]) return
  const ctx = { req: null, retry: Number(retry) || 0 }
  queueSubs[dir] = ctx
  const preq = http.request({
    host: BACKEND.host,
    port: BACKEND.port,
    method: 'GET',
    path: '/event?directory=' + encodeURIComponent(dir),
    headers: { authorization: AUTH_EXPECT, accept: 'text/event-stream' }
  }, function (pres) {
    if (pres.statusCode !== 200) {
      try { pres.resume() } catch (e) {}
      delete queueSubs[dir]
      queueResubscribe(dir, ctx.retry)
      return
    }
    ctx.retry = 0 // A-1：连接健康即清零历史断线次数，避免累计 5 次被误判死
    let buf = ''
    pres.setEncoding('utf8')
    pres.on('data', function (c) {
      buf += c
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        const m = /^data: (.+)$/.exec(line)
        if (!m) continue
        let d = null
        try { d = JSON.parse(m[1]) } catch (e) { continue }
        queueOnEvent(d)
      }
    })
    pres.on('end', function () { delete queueSubs[dir]; queueResubscribe(dir, ctx.retry) })
    pres.on('error', function () { delete queueSubs[dir]; queueResubscribe(dir, ctx.retry) })
  })
  ctx.req = preq
  preq.on('error', function () { delete queueSubs[dir]; queueResubscribe(dir, ctx.retry) })
  preq.end()
}

// 断线 5s 重连；上限 5 次（防后端长期不可用时空转）
function queueResubscribe(dir, retry) {
  if (!dir || retry >= 5) return
  const key = 'retry:' + dir
  if (queueSubs[key]) return
  queueSubs[key] = retry + 1
  const t = setTimeout(function () {
    delete queueSubs[key]
    queueSubscribe(dir, retry + 1)
  }, 5000)
  if (t.unref) t.unref()
}

// 会话目录（订阅 SSE 必需）：缓存 sid→directory
function queueWatchSession(sid) {
  if (!sid || typeof sid !== 'string') return
  if (queueDirs[sid]) { queueSubscribe(queueDirs[sid]); return }
  archiveGetJson('/session/' + encodeURIComponent(sid), function (err, s) {
    if (err || !s || typeof s !== 'object') return
    const dir = s.directory || s.path
    if (!dir || typeof dir !== 'string') return
    queueDirs[sid] = dir
    queueSubscribe(dir)
  })
}

// 订阅自愈（task108 R2）：只在「真有活在等」的 tick 里调；5s 节流；必须同查 queueSubs[dir] 与 'retry:'+dir 两把键，否则与退避定时器双开
function queueHeal(sid, now) {
  if (!sid) return
  if ((now - (queueHealAt[sid] || 0)) < QUEUE_HEAL_MIN_MS) return
  const dir = queueDirs[sid]
  if (!dir) {
    // 目录未知：异步补查（自节流），不阻塞 tick
    if ((now - (queueDirMissAt[sid] || 0)) < QUEUE_HEAL_MIN_MS) return
    queueDirMissAt[sid] = now
    queueHealAt[sid] = now
    queueWatchSession(sid)
    return
  }
  if (queueSubs[dir] || queueSubs['retry:' + dir]) return // 已订阅 / 正在退避重连：不插手
  queueHealAt[sid] = now
  queueHealRedial++
  if (!queueHealRedialWarned && queueHealRedial >= QUEUE_HEAL_REDIAL_WARN) {
    queueHealRedialWarned = true
    console.error('[queue] 订阅自愈重订累计 ' + queueHealRedial + ' 次（目录 ' + dir + '），疑似僵尸订阅持续掉线')
  }
  queueSubscribe(dir, 0) // retry 归零重订
}

function queueBoot() {
  queueLoad()
  Object.keys(queueDoc.queues).forEach(function (sid) { queueWatchSession(sid) })
  queueEnsureTimer()
}


// ---- 任务台账派生层（task15）：从 deveco.db 只读派生「运行中会话」，供任务面板展示 ----
// 批次3（2026-11-05，P0-2）：派生实现抽到 server/task-derive.js（proxy 与 worker 共用，单一来源）；
// 高频读路径改经 worker 线程派生（主线程 event loop 不再被同步读库阻塞），
// 1.5s 缓存 + 单飞串行化 + 10s 超时降级；低频写路径仍用同步版保证实时校验。
const TASK_OVERRIDE_FILE = path.join(CONFIG, 'task-ledger-overrides.json')
// ---- task119 合并单：任务状态事件旁路（append-only，效率统计「卡住时间」唯一数据源） ----
// 缘起：overrides 条目是单值 {state,at,note} 且 reopen 整条删——interrupt 痕迹在标记 reopen 瞬间被抹掉，
// 「卡住区间」无法从 overrides 派生（御史方案审 P0-1 实证）。此旁路只追加不回改，删文件即回滚。
const TASK_EVENTS_FILE = path.join(CONFIG, 'task-events.jsonl')
const TASK_EVENTS_MAX_BYTES = 512 * 1024
const TASK_EVENTS_KEEP = 2000
const { Worker } = require('node:worker_threads')
const TD = require('./task-derive')
const SD = require('./stall-detect') // task315：在途静默检查判定纯函数（编排与注入留在本文件）
const TASK_STALE_MS = TD.TASK_STALE_MS
const TASK_STALE_RULES = TD.TASK_STALE_RULES
const TASK_SESSION_COLS = TD.TASK_SESSION_COLS
const taskDbOpen = TD.taskDbOpen
const staleFlagOf = TD.staleFlagOf
const taskDegraded = TD.taskDegraded
const deriveTasksSafe = TD.deriveTasksSafe // 同步版：仅 taskOpPayload 低频校验与测试导出用

const TASK_CACHE_TTL_MS = 1500 // 缓存窗口：窗口内重复请求直接复用
let taskCache = null // { at, dbPath, payload }
let taskInflight = false // 串行化：同一时刻至多一个派生 worker 在途

function deriveInWorker(dbPath, cb) {
  let w = null
  let done = false
  try {
    w = new Worker(path.join(__dirname, 'tasks-worker.js'), { workerData: { dbPath: dbPath || null } })
  } catch (e) {
    return cb(taskDegraded('worker-error', '派生线程启动失败：' + String((e && e.message) || e)))
  }
  const finish = function (r) {
    if (done) return
    done = true
    clearTimeout(timer)
    try { w.terminate() } catch (e) { /* 已退 */ }
    cb(r)
  }
  const timer = setTimeout(function () {
    finish(taskDegraded('timeout', '任务派生超时（>10s），已降级显示'))
  }, 10000)
  w.on('message', finish)
  w.on('error', function (e) { finish(taskDegraded('worker-error', '派生线程异常：' + String((e && e.message) || e))) })
  w.on('exit', function (code) { if (!done) finish(taskDegraded('worker-exit', '派生线程退出 code=' + code)) })
}

// 缓存版派生：命中直接回；过期触发后台刷新（本次不等）；无缓存回 warming 降级（UI 已消费 degraded）
function deriveTasksCached(dbPath) {
  const p = dbPath || DEVECO_DB_FILE
  const now = Date.now()
  if (taskCache && taskCache.dbPath === p && now - taskCache.at < TASK_CACHE_TTL_MS) {
    return taskCache.payload
  }
  if (!taskInflight) {
    taskInflight = true
    deriveInWorker(p, function (r) {
      taskInflight = false
      taskCache = { at: Date.now(), dbPath: p, payload: r }
    })
  }
  if (taskCache && taskCache.dbPath === p) return taskCache.payload // 陈旧好过空
  return taskDegraded('warming', '任务派生预热中，稍后自动刷新')
}

// ---- 覆盖层：人工标记的中断/完成（config/task-ledger-overrides.json，不入 git） ----
function loadOverrides() {
  const j = readJson(TASK_OVERRIDE_FILE, null)
  if (!j || typeof j !== 'object' || !j.overrides || typeof j.overrides !== 'object') return { version: 1, overrides: {} }
  return { version: 1, overrides: j.overrides }
}

// 把覆盖结果套到派生列表上（只改 state 与展示字段，不改派生事实）
// task119：双 key 模型——state 条目按根 id 套行（现状）；eta 条目按子会话 id（t.runnerSession）套行，
// 两路独立互不干扰（「有 eta 无 state」条目不再被吞）。overdue 只在行 state==='running' 且任务口径内
// （inTask!==false，显式过滤 24h 归档）时计——行内/etas/patrol/boot 四出口共用此谓词（P1-2）。
// task180：自动完成标记前缀（applyOverrides 判定「新活动后自动失效」共用；定义在调用点之前防 TDZ）
const AUTO_DONE_NOTE_PREFIX = 'auto-done'
function applyOverrides(tasks, store) {
  const s = store || loadOverrides()
  const map = s.overrides || {}
  const now = Date.now()
  // task126 F1'：rootId→最新 eta 索引（同根多任务取 setAt 最新、并列取后写者——行级单槽近似，任务级明细走 etas 映射）
  const etaRootIdx = {}
  Object.keys(map).forEach(function (k) {
    const e0 = map[k] && map[k].eta
    if (e0 && Number(e0.minutes) > 0 && e0.rootId) {
      const old = etaRootIdx[e0.rootId]
      if (!old || (Number(e0.setAt) || 0) >= (Number(old.e.setAt) || 0)) etaRootIdx[e0.rootId] = { e: e0, k: k }
    }
  })
  // task254：克隆隔离——原实现在派生缓存行上原地改 state，导致「queue→start / done→reopen」后 30s 缓存窗口内
  //   仍显示旧态（冒烟实测 start 后行仍 queued）；改为返回新行数组，派生缓存保持纯净、多次 apply 幂等
  const out = (Array.isArray(tasks) ? tasks : []).map(function (t0) { return Object.assign({}, t0) })
  out.forEach(function (t) {
    const o = map[t.id]
    // task180：自动完成（note 以 auto-done 开头）在新活动后自动失效——防止 mid-flow 静默被误判 done 后
    // 卡死后续串行派单（旧版 done override 恒 done，新子会话不会清）。人工 done/interrupt 不受影响。
    const autoDoneStale = !!(o && o.state === 'done' && String(o.note || '').indexOf(AUTO_DONE_NOTE_PREFIX) === 0 &&
      Number(t.lastEventAt) > (Number(o.at) || 0))
    // task254：排队态——同一条目通道覆盖派生 running（单行输出，无 union 双行）；排队期 ETA 不生效（从 start 起算）
    if (o && o.state === 'queued') {
      t.state = 'queued'
      t.queueAt = Number(o.queuedAt) || 0
      if (o.title) t.queueTitle = String(o.title)
      if (o.directory) t.queueDirectory = String(o.directory)
    } else if (o && (o.state === 'interrupted' || o.state === 'done' || o.state === 'waiting') && !autoDoneStale) {
      // task334：waiting（op=hold 显式等待中）与人工收口同通道套用——auto-reap 天然跳过、UI 显示「等待中」
      t.state = o.state
      t.overrideAt = o.at || 0
      t.overrideNote = String(o.note || '')
      if (o.migrated) t.overrideMigrated = true // task126 F4'：批量迁移标记样本，统计层剔除
    }
    // task254：start 标记——把 inTask=false 的「亲自做」行提升进任务口径（闸门/UI/收口链可见）；
    // done/interrupt 收口时条目整体重写自然清除该标记
    if (o && o.taskRunning && !o.state) {
      t.taskRunning = true
      t.taskStartedAt = Number(o.startedAt) || 0
      if (t.inTask === false) t.inTask = true
      if (o.directory) t.queueDirectory = String(o.directory)
    }
    // task126 F1'：runner 键优先（顺延/清账写它，读序不变零回归）；runnerSession 漂移后 rootId 兜底
    const e1 = t.runnerSession ? (map[t.runnerSession] && map[t.runnerSession].eta) : null
    const hit = (e1 && Number(e1.minutes) > 0) ? { e: e1, k: t.runnerSession } : (etaRootIdx[t.id] || null)
    if (hit && Number(hit.e.minutes) > 0) {
      const e = hit.e
      const dl = (Number(e.setAt) || 0) + Number(e.minutes) * 60000
      t.etaMinutes = Number(e.minutes) || 0
      t.etaDeadline = dl
      t.etaChildId = hit.k // task126 F2'A：nudge 定位「实际命中的 eta 条目 id」（rootId 兜底时≠runnerSession）
      t.etaOverdueMin = (t.state === 'running' && t.inTask !== false && dl > 0 && now >= dl)
        ? Math.floor((now - dl) / 60000) : 0
    }
  })
  return out
}

// task119 P2-1：覆盖层原子写（.tmp+rename）——覆盖层是人工标记唯一持久化点，
// 直写截断=全部标记静默丢失（loadOverrides 读失败回退空）；只替换 saveOverrideOp 的调用点，不动全局 writeJson。
function writeOverrideStore(store) {
  const tmp = TASK_OVERRIDE_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2))
  fs.renameSync(tmp, TASK_OVERRIDE_FILE)
}

// task119 合并单：事件文件整体重写（滚动截断用）；file 参数化纯函数（单测不污染真 config）
function writeTaskEvents(file, lines) {
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, lines.join('\n') + (lines.length ? '\n' : ''))
  fs.renameSync(tmp, file)
}

// task119 合并单：状态事件旁路 append（interrupt/done/reopen 三 op 实际写盘成功后调用）。
// 旁路语义：任何失败只吞错不阻断主流程（人工标记本体已在 overrides 落盘）；
// 滚动截断失败时仍 append 原始行（截断失败不能丢事件——御史二轮 P2-2）。
function appendTaskEvent(sid, op, at) {
  try {
    const line = JSON.stringify({ sid: String(sid || ''), op: String(op || ''), at: Number(at) || Date.now() })
    let st = null
    try { st = fs.statSync(TASK_EVENTS_FILE) } catch (e) { st = null }
    if (st && st.size > TASK_EVENTS_MAX_BYTES) {
      try {
        const raw = fs.readFileSync(TASK_EVENTS_FILE, 'utf8').split('\n').filter(function (l) { return l.trim() })
        writeTaskEvents(TASK_EVENTS_FILE, raw.slice(-TASK_EVENTS_KEEP))
      } catch (e) { /* 滚动失败仍继续 append 原始行 */ }
    }
    fs.appendFileSync(TASK_EVENTS_FILE, line + '\n')
  } catch (e) { /* 旁路失败静默：统计缺一条事件好过丢人工标记 */ }
}

// 旧 schema（task15 前）：{task:{...}} 或直接提交任务对象的 upsert。已软退役，只识别不落盘。
function isLegacyTaskUpsert(body) {
  const b = body && typeof body === 'object' ? body : {}
  if (b.task) return true
  return !b.sessionId && !b.op
}

// 校验并保存一次人工标记；返回 {ok:true,...} 或 {ok:false,error:'...'}，重复提交结果一致（幂等）
// knownIds（可选）：派生清单里的合法会话 id 集合；HTTP 层传它即可在写盘前校验「会话存在」（不存在返回 code:404）
//   ★ op='eta' 时豁免 knownIds（task119：eta 挂子会话 id，不在根派生清单；派单瞬间子会话落库有毫秒级竞态，写失败不阻断派单可后补）
// runnerSid（可选，task119）：state 三 op 落库时连带清除该根行 runnerSession 的 eta 条目（done/interrupt/reopen 连带删）
function saveOverrideOp(body, knownIds, runnerSid) {
  const b = body && typeof body === 'object' ? body : {}
  const sessionId = String(b.sessionId || '')
  const op = String(b.op || '')
  const note = String(b.note == null ? '' : b.note)
  if (!/^ses_[A-Za-z0-9_-]+$/.test(sessionId)) return { ok: false, error: 'sessionId 不合法' }
  if (['interrupt', 'done', 'reopen', 'eta', 'queue', 'start', 'hold'].indexOf(op) < 0) return { ok: false, error: 'op 只支持 interrupt / done / reopen / eta / queue / start / hold' }
  if (note.length > 200) return { ok: false, error: 'note 过长（上限 200 字）' }

  // ---- task119：op='eta' 子会话 ETA 通道（豁免 knownIds 与派生数据；永不触碰 state/at/note）----
  if (op === 'eta') {
    if (sessionId.length > 128) return { ok: false, error: 'sessionId 过长（上限 128 字符）' }
    const m = Number(b.etaMinutes)
    if (!Number.isInteger(m) || m < 0 || m > 240) return { ok: false, error: 'etaMinutes 只支持 0~240 的整数（0=清除）' }
    const store = loadOverrides()
    const old = store.overrides[sessionId]
    if (m === 0) {
      // 清除：childId 条目（只有 eta）整条删；防御分支——误传根 id 且条目带 state 时只删 eta 子对象
      if (old && old.eta) {
        const rest = Object.assign({}, old)
        delete rest.eta
        if (rest.state !== undefined || rest.at !== undefined || rest.note !== undefined) store.overrides[sessionId] = rest
        else delete store.overrides[sessionId]
        try { writeOverrideStore(store) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
        return { ok: true, sessionId: sessionId, op: op, cleared: 1 }
      }
      return { ok: true, sessionId: sessionId, op: op, cleared: 0 } // 无 eta 也算成功（幂等）
    }
    // 幂等：同 id 同 minutes 且 setAt 距今 <5min 不重写文件（保留原时间戳；限频防轮询刷写）
    if (old && old.eta && Number(old.eta.minutes) === m && (Date.now() - (Number(old.eta.setAt) || 0)) < 5 * 60 * 1000) {
      return { ok: true, sessionId: sessionId, op: op, eta: old.eta, pruned: 0 }
    }
    // read-merge-write：绝不整条替换（P1-1）——误传根 id 也不得抹掉人工 state 标记
    const role = String(b.role == null ? '' : b.role).slice(0, 24)
    const title = String(b.title == null ? '' : b.title).slice(0, 60)
    store.overrides[sessionId] = Object.assign({}, old || {}, {
      // task126 F1'：写入时只读反查顶层根存条目内字段 rootId（失败留空照写——派单瞬间毫秒竞态属正常，兜底不生效而已）
      eta: { minutes: m, setAt: Date.now(), role: role, title: title, note: note, rootId: rootOfChildDb(sessionId) }
    })
    // 条目上限（P1-3）：eta 条目 ≤300，超限按 setAt 最旧淘汰（优先淘汰 eta-only 条目；响应带 pruned 计数）
    let pruned = 0
    const etaKeys = Object.keys(store.overrides).filter(function (k) { return store.overrides[k] && store.overrides[k].eta })
    if (etaKeys.length > 300) {
      etaKeys.map(function (k) { return { k: k, at: Number(store.overrides[k].eta.setAt) || 0 } })
        .sort(function (a, b2) { return a.at - b2.at })
        .slice(0, etaKeys.length - 300)
        .forEach(function (x) {
          const rest = Object.assign({}, store.overrides[x.k])
          delete rest.eta
          if (rest.state !== undefined || rest.at !== undefined || rest.note !== undefined) store.overrides[x.k] = rest
          else delete store.overrides[x.k]
          pruned++
        })
    }
    try { writeOverrideStore(store) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
    return { ok: true, sessionId: sessionId, op: op, eta: store.overrides[sessionId].eta, pruned: pruned }
  }

  if (knownIds) {
    const known = knownIds instanceof Set ? knownIds : new Set(Array.isArray(knownIds) ? knownIds : [])
    if (!known.has(sessionId)) return { ok: false, code: 404, error: 'session not found' }
  }

  // ---- task254：任务队列（同项目 FIFO 排队 + 开工闸）----
  if (op === 'queue') {
    const dir = String(b.directory == null ? '' : b.directory).slice(0, 300)
    if (!dir) return { ok: false, error: 'op=queue 需要 directory（项目路径）' }
    const title = String(b.title == null ? '' : b.title).slice(0, 60)
    const qStore = loadOverrides()
    const qOld = qStore.overrides[sessionId]
    if (qOld && qOld.state === 'queued') {
      return { ok: true, sessionId: sessionId, op: op, state: 'queued', override: qOld, dup: 1, position: queuePositionOf(qStore, dir, sessionId) }
    }
    // task254 P1-1（产出审）：在跑/已开工条目不接受 queue 覆盖（会丢 taskRunning/startedAt，且退出 auto-reap 兜底）
    if (qOld && qOld.taskRunning && !qOld.state) {
      return { ok: false, error: '该会话任务已开工（running），如需重排请先收口（op=done/interrupt）' }
    }
    if (qOld && (qOld.state === 'interrupted' || qOld.state === 'done')) {
      return { ok: false, error: '该会话任务已收口（' + qOld.state + '），如需重排请先 op=reopen' }
    }
    const qAt = Date.now()
    const qEta = Number(b.etaMinutes)
    qStore.overrides[sessionId] = {
      state: 'queued', queuedAt: qAt, at: qAt, note: note,
      title: title, directory: dir,
      etaMinutes: (Number.isInteger(qEta) && qEta > 0 && qEta <= 240) ? qEta : 0,
      role: String(b.role == null ? '' : b.role).slice(0, 24)
    }
    try { writeOverrideStore(qStore) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
    appendTaskEvent(sessionId, 'queue', qAt)
    return { ok: true, sessionId: sessionId, op: op, state: 'queued', override: qStore.overrides[sessionId], position: queuePositionOf(qStore, dir, sessionId) }
  }
  if (op === 'start') {
    const sStore = loadOverrides()
    const sOld = sStore.overrides[sessionId]
    // 已收口的任务要重新开工必须先 reopen（与 op=queue 同口径；防 start 直接覆盖收口条目绕过语义）
    if (sOld && (sOld.state === 'interrupted' || sOld.state === 'done')) {
      return { ok: false, error: '该会话任务已收口（' + sOld.state + '），如需重开请先 op=reopen' }
    }
    const force = !!b.force
    const now = Date.now()
    // directory：排队条目 > 派生行
    let dir = sOld && sOld.directory ? String(sOld.directory) : ''
    if (!dir) dir = dirOfTaskRow(sessionId)
    if (!dir) return { ok: false, error: 'op=start 需要 directory 或已登记的排队条目' }
    // 硬闸：同 directory 的未收口在途（排位更前 queued ∪ 任务口径 running）；force（主人越序）放行并留痕
    const ahead = queueAheadOf(dir, sessionId)
    if (!force && ahead.length) {
      return { ok: false, code: 409, error: '同项目有在途任务，请排队等待（等【队列调度】唤醒）', ahead: ahead.map(function (x) { return { id: x.id, title: x.queueTitle || x.title || '', state: x.state } }) }
    }
    const startedAt = now
    const sEntry = { taskRunning: true, startedAt: startedAt, at: startedAt, directory: dir }
    if (sOld && sOld.eta) sEntry.eta = sOld.eta // 保留 ETA 子对象（start 前的 eta 照旧生效）
    sStore.overrides[sessionId] = sEntry
    try { writeOverrideStore(sStore) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
    appendTaskEvent(sessionId, 'start', startedAt)
    return { ok: true, sessionId: sessionId, op: op, state: 'running', override: sEntry, force: force, skippedAhead: force ? ahead.length : 0 }
  }
  // ---- task334：op='hold' 显式等待中（挂后台任务型）——会话 AI 静默但职责未尽（如测试台无限循环监督），
  // auto-reap 不收口（reapDecide 对 state!=='running' 天然 skip）、任务板显示「等待中」不折叠。
  // 解除=op=reopen（清条目回 running）；queue/start 可直接覆盖（新任务接管语义）。
  if (op === 'hold') {
    const hStore = loadOverrides()
    const hOld = hStore.overrides[sessionId]
    if (hOld && hOld.state === 'waiting' && String(hOld.note || '') === note) {
      return { ok: true, sessionId: sessionId, op: op, state: 'waiting', dup: 1, override: { state: 'waiting', at: hOld.at || 0, note: String(hOld.note || '') } }
    }
    const holdAt = Date.now() // at 单源：写盘与事件旁路同一时刻
    // task334 P2-5：read-merge 保留旧条目的 eta / taskRunning / startedAt / directory——
    //   丢 directory 会让 ledgerInTask/开工闸失锚；taskRunning/startedAt 保留供解除后统计链不 断（P2-6：hold 可直接覆盖 done/interrupted 条目＝「新职责接管」语义，与 queue/start 的「先 reopen」守卫有意不同——监督会话场景正是 done 后直接 hold）
    const hEntry = { state: 'waiting', at: holdAt, note: note }
    if (hOld && hOld.eta) hEntry.eta = hOld.eta // 等待期展示用；reopen 按既有语义清账（重派时应重新落 ETA，P2-8 注释修正）
    if (hOld && hOld.taskRunning) hEntry.taskRunning = true
    if (hOld && hOld.startedAt) hEntry.startedAt = Number(hOld.startedAt) || 0
    if (hOld && hOld.directory) hEntry.directory = String(hOld.directory)
    hStore.overrides[sessionId] = hEntry
    try { writeOverrideStore(hStore) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
    appendTaskEvent(sessionId, 'hold', holdAt)
    /* task334 P1-4：hold 打开开工闸（waiting 不再算在途）——与 done/interrupt 同钩子拉起队首排队任务，
       否则被 hold 会话身后的 queued 收不到【队列调度】要等下一次人工 close/force */
    try { queuePromote(dirOfTaskRow(sessionId)) } catch (e) {}
    return { ok: true, sessionId: sessionId, op: op, state: 'waiting', override: hEntry }
  }
  const store = loadOverrides()
  if (op === 'reopen') {
    // task119 合并单 P2-6：overrides 本就无该条 → 重复点 reopen 直接成功返回，不写盘不留事件
    if (!store.overrides[sessionId]) {
      return { ok: true, sessionId: sessionId, op: op, state: 'running', override: null }
    }
    delete store.overrides[sessionId]
    const reopenedAt = Date.now() // at 单源：事件旁路与写盘同一时刻（禁二次 Date.now()）
    // task119：reopen 连带清该根行 runnerSession 的 eta（旧 ETA 早已过期，留着reopen即爆超时；由 taskOpPayload 反查传入）
    if (runnerSid && store.overrides[runnerSid] && store.overrides[runnerSid].eta) {
      const r = etaPrune(store, runnerSid)
      try { writeOverrideStore(store) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
      appendTaskEvent(sessionId, 'reopen', reopenedAt)
      return { ok: true, sessionId: sessionId, op: op, state: 'running', override: null, etaCleared: r }
    }
    try { writeOverrideStore(store) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
    appendTaskEvent(sessionId, 'reopen', reopenedAt)
    return { ok: true, sessionId: sessionId, op: op, state: 'running', override: null }
  }
  const state = op === 'interrupt' ? 'interrupted' : 'done'
  const old = store.overrides[sessionId]
  // 幂等：同一会话同一状态且备注未变时不重写文件（保留原始时间戳）
  if (old && old.state === state && String(old.note || '') === note) {
    return { ok: true, sessionId: sessionId, op: op, state: state, override: { state: old.state, at: old.at || 0, note: String(old.note || '') } }
  }
  const markedAt = Date.now() // at 单源：store 落盘与事件旁路共用同一时刻（禁二次 Date.now()）
  store.overrides[sessionId] = { state: state, at: markedAt, note: note }
  // task119：done/interrupt 连带清 runnerSession 的 eta（双 key 下 state 条目替换本就不含 eta，连带删是必需而非冗余）
  // task126 F1'：同扫 rootId 兜底命中的孤儿 eta（根行级人工判死 → 同根全部在途 ETA 一并清账；
  //   仅 done/interrupt 做同扫，op=eta 0 回执清账按子 id 精确清不同扫；reopen 不恢复属预期——重派时应重新落 ETA）
  let etaCleared = 0
  if (runnerSid && store.overrides[runnerSid] && store.overrides[runnerSid].eta) {
    etaCleared = etaPrune(store, runnerSid)
  }
  Object.keys(store.overrides).forEach(function (k) {
    const ent = store.overrides[k]
    if (ent && ent.eta && String(ent.eta.rootId || '') === sessionId && k !== runnerSid) {
      etaCleared += etaPrune(store, k)
    }
  })
  try { writeOverrideStore(store) } catch (e) { return { ok: false, error: '写入失败：' + String((e && e.message) || e) } }
  appendTaskEvent(sessionId, state === 'done' ? 'done' : 'interrupt', markedAt)
  // task254：收口拉起——人工与 auto-reap 两路共用此钩子（单点覆盖）；无在途时唤醒同项目队首排队任务
  try { queuePromote(dirOfTaskRow(sessionId)) } catch (e) {}
  return { ok: true, sessionId: sessionId, op: op, state: state, override: store.overrides[sessionId], etaCleared: etaCleared }
}

// task119：从条目里摘掉 eta 子对象；返回是否实际删除（供 etaCleared 计数）
function etaPrune(store, sid) {
  const o = store.overrides[sid]
  if (!o || !o.eta) return 0
  const rest = Object.assign({}, o)
  delete rest.eta
  if (rest.state !== undefined || rest.at !== undefined || rest.note !== undefined) store.overrides[sid] = rest
  else delete store.overrides[sid]
  return 1
}

// ---- task254：任务队列 helper（同项目 FIFO / 开工闸 / 收口拉起 / 断链收口）----
// 语义：队列=右栏任务面板的分区视图；排队条目走 overrides state 通道（applyOverrides 覆盖派生行，单行无 union）。
function dirOfTaskRow(sid) {
  try {
    const der = deriveTasksCached()
    if (!der || !der.ok) return ''
    const rows = applyOverrides(der.tasks)
    for (let i = 0; i < rows.length; i++) {
      const t = rows[i]
      if (t && String(t.id) === String(sid)) return String(t.queueDirectory || t.directory || '')
    }
  } catch (e) {}
  return ''
}
// 排队位次（1=队首）：同 directory 的 queued 条目按 queuedAt 排序
function queuePositionOf(store, dir, sid) {
  const map = (store && store.overrides) || {}
  const list = Object.keys(map).filter(function (k) {
    return map[k] && map[k].state === 'queued' && String(map[k].directory || '') === dir
  }).map(function (k) { return { k: k, at: Number(map[k].queuedAt) || 0 } })
    .sort(function (a, b) { return a.at - b.at })
  for (let i = 0; i < list.length; i++) if (list[i].k === sid) return i + 1
  return list.length + 1
}
// 开工闸：同 directory 的未收口在途（排位更前的 queued ∪ 任务口径 running）
// task254 P0-1（产出审）：sid 自身是 queued 时只把 queuedAt 更早的算 ahead（FIFO 队首放行）；
//   插队者（未排队直接 start）维持全部算 ahead——否则队首 start 永远 409，队列≥2 即死锁
function queueAheadOf(dir, sid) {
  let rows = null
  try {
    const der = deriveTasksCached()
    if (!der || !der.ok) return []
    rows = applyOverrides(der.tasks)
  } catch (e) { return [] }
  let meQueued = false
  let myQAt = 0
  rows.forEach(function (r) {
    if (r && String(r.id) === String(sid)) {
      meQueued = r.state === 'queued'
      myQAt = Number(r.queueAt) || 0
    }
  })
  return rows.filter(function (r) {
    if (!r || String(r.id) === String(sid)) return false
    if (String(r.queueDirectory || r.directory || '') !== dir) return false
    if (r.state === 'queued') return meQueued ? (Number(r.queueAt) || 0) < myQAt : true
    if (r.state === 'running' && (r.inTask !== false || r.taskRunning)) return true
    return false
  })
}
// 收口拉起：该 directory 无在途 running 时，唤醒排位最前 queued（注入带防伪标识：合法开工许可）
function queuePromote(dir) {
  if (!dir) return { skipped: 'no-dir' }
  let rows = null
  try {
    const der = deriveTasksCached()
    if (!der || !der.ok) return { skipped: 'derive' }
    rows = applyOverrides(der.tasks)
  } catch (e) { return { skipped: 'throw' } }
  const inDir = rows.filter(function (r) { return r && String(r.queueDirectory || r.directory || '') === dir })
  const active = inDir.filter(function (r) { return r.state === 'running' && (r.inTask !== false || r.taskRunning) })
  if (active.length) return { skipped: 'still-active', active: active.length }
  const queued = inDir.filter(function (r) { return r.state === 'queued' })
    .sort(function (a, b) { return (Number(a.queueAt) || 0) - (Number(b.queueAt) || 0) })
  if (!queued.length) return { skipped: 'empty' }
  const head = queued[0]
  const key = String(head.id)
  const now = Date.now()
  if (queuePromotedAt[key] && now - queuePromotedAt[key] < QUEUE_PROMOTE_DEBOUNCE_MS) return { skipped: 'debounced' }
  queuePromotedAt[key] = now
  const title = String(head.queueTitle || head.title || '')
  const text = '【队列调度·程序触发】前序任务已收口，轮到你的任务（排队 #' + queued.length + ' → #1）：' + title +
    '。这是队列调度开工许可（非巡逻提醒），请按任务书开工；非主人指令、不得转做其它事。'
  const q = queueEnqueue(key, [{ type: 'text', text: text }], '[队列调度]', {})
  reapLogLine({
    at: now, task: 'task254', sid: key, action: 'promote', why: 'prev-closed',
    dir: dir.slice(0, 160), queueLen: queued.length, enqueued: !!(q && q.ok)
  })
  if (q && q.ok) queueTickSoon()
  return { ok: !!(q && q.ok), sid: key, queueLen: queued.length }
}
// 断链收口（每 tick 挂载）：①queued 超时未开工作废 ②start 后无 runner 静默超 30min 中断释放闸位
function queueHygiene(now) {
  let rows = null
  try {
    const der = deriveTasksCached()
    if (!der || !der.ok) return { skipped: 'derive' }
    rows = applyOverrides(der.tasks)
  } catch (e) { return { skipped: 'throw' } }
  const firstTick = (now - AUTO_REAP_BOOT_AT) <= AUTO_REAP_TICK_MS * 2 // 重启首 tick 只观察
  let expired = 0, timedOut = 0
  rows.forEach(function (r) {
    if (!r) return
    const key = String(r.id)
    if (r.state === 'queued') {
      if (!firstTick && now - (Number(r.queueAt) || 0) > QUEUE_MAX_WAIT_MS) {
        const rr = saveOverrideOp({ sessionId: key, op: 'done', note: 'auto-queue-expired（排队超 ' + Math.round(QUEUE_MAX_WAIT_MS / 3600000) + 'h 未开工，已作废，可重新 op=queue）' })
        if (rr && rr.ok) {
          expired++
          reapLogLine({ at: now, task: 'task254', sid: key, action: 'queue-expired', dir: String(r.queueDirectory || r.directory || '').slice(0, 160) })
        }
      }
      return
    }
    if (r.taskRunning && r.state === 'running' && !String(r.runnerSession || '')) {
      if (!firstTick && now - (Number(r.lastEventAt) || 0) > AUTO_REAP_MIN_MS) {
        const rr = saveOverrideOp({ sessionId: key, op: 'interrupt', note: 'auto-start-timeout（开工后静默超 30min 且无 runner，释放闸位）' })
        if (rr && rr.ok) {
          timedOut++
          reapLogLine({ at: now, task: 'task254', sid: key, action: 'start-timeout', dir: String(r.queueDirectory || r.directory || '').slice(0, 160) })
        }
      }
    }
  })
  return { expired: expired, timedOut: timedOut }
}

// ---- task126：ETA 链路完善（rootId 兜底 / 取证摘要 / 超时主动提醒） ----
// 子会话元信息只读点查（session 表；不碰 message/part 大表；失败返回 null——派单瞬间毫秒竞态属正常）
function sessionMetaOf(sid) {
  if (!sid || typeof sid !== 'string') return null
  try {
    const db = TD.taskDbOpen()
    try {
      const row = db.prepare('SELECT id, parent_id AS parent, agent, title FROM session WHERE id = ?').get(String(sid))
      return row ? { id: String(row.id), parent: row.parent ? String(row.parent) : '', agent: row.agent == null ? '' : String(row.agent), title: String(row.title || '') } : null
    } finally { try { db.close() } catch (e2) {} }
  } catch (e) { return null }
}

// 子会话 → 顶层根 id（沿 parent 链上行 ≤12 层；到不了根/无库/未落库一律返回 ''——条目照写，兜底不生效而已）
function rootOfChildDb(sid) {
  const meta = sessionMetaOf(sid)
  if (!meta) return ''
  let cur = meta
  for (let i = 0; i < 12 && cur && cur.parent; i++) {
    const up = sessionMetaOf(cur.parent)
    if (!up) return ''
    cur = up
  }
  return (cur && !cur.parent) ? cur.id : ''
}

// F5'：runner 子会话末条消息摘要（steward 四态判读取证 + UI 任务卡展示）
// 约束四条：仅 running+inTask 行由 tasksGetPayload 触发；30s 缓存；走 serve 只读 API（不碰派生层红线）；失败空串绝不拖垮 /_tasks
const LAST_TEXT_CACHE = {} // runnerSid -> {at, text}
const LAST_TEXT_TTL_MS = 30 * 1000
const LAST_TEXT_KEEP_MS = 10 * 60 * 1000
function lastEventTextOf(sid) {
  const c = LAST_TEXT_CACHE[sid]
  return (c && (Date.now() - c.at) < LAST_TEXT_KEEP_MS) ? c.text : ''
}
function lastEventTextWarm(runnerSids) {
  const now = Date.now()
  const due = (Array.isArray(runnerSids) ? runnerSids : []).filter(function (sid, i) {
    return sid && runnerSids.indexOf(sid) === i && (!LAST_TEXT_CACHE[sid] || (now - LAST_TEXT_CACHE[sid].at) > LAST_TEXT_TTL_MS)
  }).slice(0, 24)
  due.forEach(function (sid) {
    const prevText = (LAST_TEXT_CACHE[sid] || {}).text || ''
    LAST_TEXT_CACHE[sid] = { at: now, text: prevText } // 先占位防刷新风暴
    archiveGetJson('/session/' + encodeURIComponent(sid) + '/message', function (err, d) {
      // task126 P0-2 二修（御史复审实锤）：消息形状={info:{id,role,time…}, parts:[…]}——parts 在消息顶层、
      // 不在 info 里（原从 info.parts 取恒空）；parts[0] 常是 reasoning/step，须 find(type==='text')。
      // 数组消费+尾部倒序回看 6 条（跳过 model-switched 等系统事件型）。
      let text = ''
      const list = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : [])
      for (let i = list.length - 1; i >= 0 && i >= list.length - 6; i--) {
        const it = list[i] || {}
        let s = ''
        if (Array.isArray(it.parts)) {
          const tp = it.parts.find(function (p) { return p && p.type === 'text' && p.text })
          if (tp) s = String(tp.text)
        }
        if (!s && it.text) s = String(it.text)
        if (s) { text = s.replace(/\s+/g, ' ').trim().slice(0, 40); break }
      }
      LAST_TEXT_CACHE[sid] = { at: Date.now(), text: text }
    })
  })
}

// F2'A：超时主动提醒（逐级上报）——patrol/watchdog 只管调，全部护栏在网关裁决
// 护栏：注入前重查 overdue / 每子任务 30min 冷却 + 3 次封顶 / 全局 10min 冷却 / rest-mode 小时预算 /
//       目标暂停不发 / 根级仅 PWA butler（TUI build 会话禁注入，防污染主人对话流）/ 入队复用既有投喂链（忙时排队不打断当前轮）
const NUDGE_FILE = path.join(CONFIG, 'nudge-state.json')
const NUDGE_CHILD_COOLDOWN_MS = 30 * 60 * 1000
const NUDGE_CHILD_MAX = 3
const NUDGE_GLOBAL_COOLDOWN_MS = 10 * 60 * 1000
const NUDGE_REST_HOUR_MAX = 2
function nudgeLoad() {
  const j = readJson(NUDGE_FILE, null)
  if (j && typeof j === 'object' && !Array.isArray(j) && j.perChild && typeof j.perChild === 'object') return j
  return { version: 1, perChild: {}, history: [] }
}
// task126 P2-1：限频态原子写（tmp+rename+0600，与 writeOverrideStore 同款——半截 JSON 会清零冷却态致多发）
function nudgeSave(s) {
  const tmp = NUDGE_FILE + '.tmp-' + process.pid
  try {
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e0) {}
    fs.renameSync(tmp, NUDGE_FILE)
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {}
  }
}
function nudgePayload(d) {
  const sid = String((d && d.sessionId) || '')
  if (!/^ses_[A-Za-z0-9_-]+$/.test(sid)) return { code: 400, body: { ok: false, error: 'sessionId 无效（应为 eta 条目所在的子会话 id）' } }
  const store = loadOverrides()
  const e = store.overrides[sid] && store.overrides[sid].eta
  if (!e || !(Number(e.minutes) > 0)) return { code: 200, body: { ok: true, sent: false, reason: 'no-eta' } }
  const rootId = String(e.rootId || '')
  if (!rootId) return { code: 200, body: { ok: true, sent: false, reason: 'no-root' } }
  // 注入前重查（防巡检快照过期误报）：根行必须 running 且行内 overdue
  const der = deriveTasksCached()
  if (!der.ok) return { code: 200, body: { ok: true, sent: false, reason: 'degraded' } }
  const row = applyOverrides(der.tasks, store).filter(function (t) { return t.id === rootId })[0]
  if (!row || !(Number(row.etaOverdueMin) > 0)) return { code: 200, body: { ok: true, sent: false, reason: 'not-overdue' } }
  // 目标=父会话（逐级上报：派它的人来查它）；**任何注入目标若是根会话，必须 agent==='butler'（PWA 大管家）——
  // TUI 根（agent=build，实测 556 个）与 null 根一律拒绝，防程序消息污染主人对话流（task126 产出审 P0-1 修正：原「!target 才校验」恒不触发）**
  const meta = sessionMetaOf(sid)
  if (!meta) return { code: 200, body: { ok: true, sent: false, reason: 'no-session' } }
  let target = meta.parent
  let rootGuard = false
  if (!target) {
    // 边界：eta 条目自身挂在根会话上——按根级规则校验
    const rmeta = sessionMetaOf(rootId)
    if (!rmeta || rmeta.agent !== 'butler') return { code: 200, body: { ok: true, sent: false, reason: 'tui-root-guard' } }
    target = rootId
    rootGuard = true
  } else {
    // target 存在：判断它是否根会话（无父即根）——是根则必须 butler
    const tmeta = sessionMetaOf(target)
    if (!tmeta) return { code: 200, body: { ok: true, sent: false, reason: 'no-target-session' } }
    if (!tmeta.parent) {
      if (tmeta.agent !== 'butler') return { code: 200, body: { ok: true, sent: false, reason: 'tui-root-guard' } }
      rootGuard = true
    }
  }
  if (queuePaused[target]) return { code: 200, body: { ok: true, sent: false, reason: 'target-paused' } }
  // 限频三闸：单任务冷却+封顶 / 全局冷却 / 休息态小时预算
  const st = nudgeLoad()
  const now = Date.now()
  const pc = st.perChild[sid] || { count: 0, lastAt: 0 }
  if (Number(pc.count) >= NUDGE_CHILD_MAX) return { code: 200, body: { ok: true, sent: false, reason: 'child-max', count: pc.count } }
  if (now - (Number(pc.lastAt) || 0) < NUDGE_CHILD_COOLDOWN_MS) return { code: 200, body: { ok: true, sent: false, reason: 'child-cooldown' } }
  const lastG = st.history.length ? Number(st.history[st.history.length - 1].at || 0) : 0
  if (now - lastG < NUDGE_GLOBAL_COOLDOWN_MS) return { code: 200, body: { ok: true, sent: false, reason: 'global-cooldown' } }
  const rest = restRead()
  if (rest && rest.on) {
    const cnt = st.history.filter(function (h) { return Number(h.at || 0) > now - 3600000 }).length
    if (cnt >= NUDGE_REST_HOUR_MAX) return { code: 200, body: { ok: true, sent: false, reason: 'rest-budget' } }
  }
  // 注入：入队复用既有投喂链（busy 时排队等当前轮结束，绝不打断在途生成）
  const text = '【系统自动提醒·程序触发】子代理任务「' + String(e.title || row.title || '').replace(/[\r\n]+/g, ' ').slice(0, 30) +
    '」已超预计 ' + row.etaOverdueMin + ' 分钟（预计 ' + (Number(e.minutes) || 0) + ' 分钟，承接角色 ' + (String(e.role || '-') || '-') + '）。' +
    '请按超时查验协议处理：在做→POST /_tasks {"sessionId":"' + sid + '","op":"eta","etaMinutes":<新预计>} 顺延；已完成→同接口 etaMinutes 0 清账；暂停/宕机观察→上报主人。' +
    '此消息由巡逻程序自动发送，非主人指令，不得当作新任务执行。'
  const q = queueEnqueue(target, [{ type: 'text', text: text }], '[系统自动提醒]', {})
  if (!q.ok) return { code: 200, body: { ok: true, sent: false, reason: 'enqueue-failed:' + String(q.error || '') } }
  queueTickSoon()
  pc.count = Number(pc.count) + 1
  pc.lastAt = now
  st.perChild[sid] = pc
  st.history.push({ at: now, child: sid, target: target, root: rootId, overdueMin: row.etaOverdueMin, rootGuard: rootGuard })
  while (st.history.length > 200) st.history.shift()
  nudgeSave(st)
  return { code: 200, body: { ok: true, sent: true, target: target, overdueMin: row.etaOverdueMin, count: pc.count } }
}

// ---- task315：在途任务静默检查（软提醒）——auto-reap 60s tick 内的非破坏分支 ----
// 事故（2026-11-15）：censor-plan 子会话 13:48 起静默，ETA 14:22 到点、auto-reap 30min 收口要 14:19，
// 主人 14:14 报障落在 0~30min 盲区——「叫醒承接人核对」缺一条早期分支。本分支在 runner 静默
// ≥STALL_CHECK_MIN_MS（默认 15min=派生 stale 硬边界，env clamp 5~30）时向承接根会话投一条软提醒
// （不 abort / 不改 override / 不删 eta），其余交给既有链（nudge 超时查验、auto-reap 30min 收口）。
// 判定纯函数在 server/stall-detect.js（照 wedge-detect 先例）；本段只做编排与注入：
//   复用本 tick 的 probe/busy 不另发探针 / 首 tick 只 log 不注入不写计数 / enqueue 前重读 override /
//   queueEnqueue 成功补 queueTickSoon、deduped 不计次 / 软提醒成功写 nudge perChild.lastAt（30min 双向去重）/
//   状态 tmp+rename+0600 原子写 / tick 末尾按当前 rows 差集清计数 / 一切失败只记日志绝不拖垮既有链。
const STALL_CHECK_MIN_MS = SD.clampStallMin(process.env.LITTLEDJ_STALL_CHECK_MIN) * 60 * 1000
const STALL_CHECK_CHILD_COOLDOWN_MS = 20 * 60 * 1000
const STALL_CHECK_CHILD_MAX = 2
const STALL_CHECK_MAX_PER_TICK = 2
const STALL_CHECK_GLOBAL_MAX_PER_HOUR = 3
const STALL_CHECK_BUDGET_MS = 15 * 1000
const STALL_CHECK_STATE_FILE = path.join(CONFIG, 'stall-check-state.json')
const STALL_CHECK_LOG_FILE = path.join(ROOT, 'logs', 'stall-check.log')
const STALL_CHECK_DENY_DIRS = (process.env.LITTLEDJ_STALL_CHECK_DENY_DIRS || 'DAG_AI_Chat').split(',').map(function (s) { return s.trim() }).filter(Boolean)
const STALL_NUDGE_DEDUPE_MS = NUDGE_CHILD_COOLDOWN_MS // 30min：与 /_nudge、auto-reap 收口共享抑制窗口

function stallCheckStateLoad() {
  const j = readJson(STALL_CHECK_STATE_FILE, null)
  if (j && typeof j === 'object' && !Array.isArray(j) && j.perChild && typeof j.perChild === 'object') return j
  return SD.newStallState()
}
function stallCheckStateSave(s) {
  const tmp = STALL_CHECK_STATE_FILE + '.tmp-' + process.pid
  try {
    fs.mkdirSync(path.dirname(STALL_CHECK_STATE_FILE), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e0) {}
    fs.renameSync(tmp, STALL_CHECK_STATE_FILE)
  } catch (e) { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {} }
}
// 审计：固定字段 root/runner/title/silenceMin/etaDeadline/attempt/target/result；不打印凭据
function stallLogLine(entry) {
  try {
    fs.mkdirSync(path.dirname(STALL_CHECK_LOG_FILE), { recursive: true })
    fs.appendFileSync(STALL_CHECK_LOG_FILE, JSON.stringify(entry) + '\n', { mode: 0o600 })
  } catch (e) {}
}
// auto-reap 近 30min 是否已对该行/runner 动作过（tail 读审计 jsonl 末 64KB；任何失败=无记录，兜底放行给自身护栏）
function stallReapRecentAt(rootId, runner, now) {
  try {
    const st = fs.statSync(AUTO_REAP_LOG_FILE)
    if (!st || !st.size) return 0
    const fd = fs.openSync(AUTO_REAP_LOG_FILE, 'r')
    const len = Math.min(st.size, 65536)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, st.size - len)
    fs.closeSync(fd)
    let last = 0
    buf.toString('utf8').split('\n').forEach(function (l) {
      if (!l) return
      try {
        const j = JSON.parse(l)
        if (j && Number(j.at) > now - STALL_NUDGE_DEDUPE_MS &&
          (String(j.sid) === rootId || String(j.rootId) === rootId || String(j.runnerSession) === runner) &&
          ['done', 'interrupt', 'close', 'notify'].indexOf(String(j.action)) >= 0) {
          const at = Number(j.at) || 0
          if (at > last) last = at
        }
      } catch (e) {}
    })
    return last
  } catch (e) { return 0 }
}
// 编排段（autoReapTick 末段同步调用；不抛、不阻塞下一 tick）：
// stallCands = 本 tick 内 reapDecide 判 skip 且原因 ∈ {run-in-progress, user-pending, not-stalled} 的行
function stallCheckPass(stallCands, rows, firstTick, now) {
  if (process.env.LITTLEDJ_NO_STALL_CHECK === '1') return { skipped: 'disabled' } // tick 入口一键关（P2-4）
  const out = { checked: 0, reminded: 0, injected: 0, deduped: 0, failed: 0 }
  const deadline = Date.now() + STALL_CHECK_BUDGET_MS
  const st = stallCheckStateLoad()
  let hiddenSet = null
  let restOn = false
  try { const r = restRead(); restOn = !!(r && r.on) } catch (e) {}
  let budgetOut = false
  for (let i = 0; i < (stallCands ? stallCands.length : 0); i++) {
    if (Date.now() > deadline) { budgetOut = true; break } // 单 tick 总预算 15s（P1-4）
    if (out.injected + out.deduped >= STALL_CHECK_MAX_PER_TICK) break // 单 tick ≤2
    const c = stallCands[i]
    const row = c.row
    const runner = String(row.runnerSession || '')
    out.checked++
    // P1-5 目标解析：runner 沿 parentID 上溯到根（rootOfChildDb；中间层死/到不了根/未落库一律 ''）
    let target = null
    let targetWhy = ''
    const rootId = rootOfChildDb(runner)
    if (!rootId) targetWhy = 'unresolved'
    else {
      const tmeta = sessionMetaOf(rootId)
      if (!tmeta) targetWhy = 'meta-404'
      else {
        if (hiddenSet == null) { try { hiddenSet = new Set(readHidden().hidden || []) } catch (e0) { hiddenSet = new Set() } }
        target = {
          id: tmeta.id, agent: String(tmeta.agent || ''), isRoot: !tmeta.parent,
          hidden: hiddenSet.has(rootId), paused: !!queuePaused[rootId],
          rowRootOk: (rootId === String(row.id))
        }
      }
    }
    // P1-7 去重入口：nudge perChild.lastAt（软提醒自己也写它 → 双向 30min 互静默）
    let nudgeLastAt = 0
    try {
      const ns = nudgeLoad()
      const npc = ns.perChild && ns.perChild[runner]
      nudgeLastAt = npc ? (Number(npc.lastAt) || 0) : 0
    } catch (e) {}
    const pc = st.perChild[runner] || { count: 0, lastAt: 0 }
    const hourCount = st.history.filter(function (h) { return Number(h.at || 0) > now - 3600000 }).length
    let d = null
    try {
      d = SD.decideStallCheck(row, c.probe, c.busy, {
        child: pc, hourCount: hourCount, rest: restOn, nudgeLastAt: nudgeLastAt,
        reapLastAt: stallReapRecentAt(String(row.id), runner, now),
        target: target, targetWhy: targetWhy
      }, now, {
        minMs: STALL_CHECK_MIN_MS, denyDirs: STALL_CHECK_DENY_DIRS,
        childCooldownMs: STALL_CHECK_CHILD_COOLDOWN_MS, childMax: STALL_CHECK_CHILD_MAX,
        globalMaxPerHour: STALL_CHECK_GLOBAL_MAX_PER_HOUR, restHourMax: NUDGE_REST_HOUR_MAX,
        nudgeDedupeMs: STALL_NUDGE_DEDUPE_MS, firstTick: !!firstTick, reapWhy: c.reapWhy
      })
    } catch (e) { d = { action: 'skip', why: 'decide-throw' } }
    if (!d || d.action !== 'remind') {
      if (d && d.why === 'first-tick') {
        // 首 tick 只 log 观察、不注入、不写计数（P1-4；first-tick 放在判定链最后=其余全过的形态）
        stallLogLine({ at: now, task: 'task315', root: String(row.id), runner: runner, title: String(row.title || '').slice(0, 80), silenceMin: Math.max(1, Math.floor((Number(d.silenceMs) || 0) / 60000)), etaDeadline: Number(row.etaDeadline) || 0, attempt: (Number(pc.count) || 0) + 1, target: rootId || '', result: 'observe:first-tick' })
      }
      continue
    }
    out.reminded++
    // enqueue 前重读 override（P1-4：防与人工标记 / auto-reap 收口竞态）
    try {
      const fo = loadOverrides().overrides[String(row.id)]
      if (fo && (fo.state === 'done' || fo.state === 'interrupted' || fo.state === 'queued' || fo.state === 'waiting')) { /* task334 P1-5：waiting 不注入静默提醒（挂后台任务别打扰） */
        stallLogLine({ at: Date.now(), task: 'task315', root: String(row.id), runner: runner, title: String(row.title || '').slice(0, 80), silenceMin: d.silenceMin, etaDeadline: Number(row.etaDeadline) || 0, attempt: d.attempt, target: d.targetId, result: 'skip:override-changed:' + String(fo.state) })
        continue
      }
    } catch (e) {}
    const text = SD.buildStallText(row, { runner: runner, silenceMin: d.silenceMin, etaDeadline: Number(row.etaDeadline) || 0 })
    let q = null
    try { q = queueEnqueue(d.targetId, [{ type: 'text', text: text }], '[系统自动提醒]', {}) } catch (e) { q = { ok: false, error: 'throw' } }
    let result = ''
    if (q && q.ok && q.deduped) {
      result = 'deduped' // 2s 文本去重命中：不算注入成功、不写计数（P2-2）
      out.deduped++
    } else if (q && q.ok) {
      result = 'enqueue-ok'
      out.injected++
      queueTickSoon()
      SD.recordStallResult(st, runner, 'sent', now, { target: d.targetId, root: String(row.id), silenceMin: d.silenceMin, attempt: d.attempt })
      // P1-7 去重出口：软提醒成功 → 写 nudge perChild.lastAt/stallLastAt（未知字段原样保留、不动 nudge count）
      try {
        const ns = nudgeLoad()
        const npc = (ns.perChild && ns.perChild[runner]) || { count: 0, lastAt: 0 }
        npc.lastAt = now
        npc.stallLastAt = now
        if (!ns.perChild) ns.perChild = {}
        ns.perChild[runner] = npc
        nudgeSave(ns)
      } catch (e) {}
    } else {
      result = 'enqueue-failed:' + String((q && q.error) || '')
      out.failed++
    }
    stallLogLine({ at: Date.now(), task: 'task315', root: String(row.id), runner: runner, title: String(row.title || '').slice(0, 80), silenceMin: d.silenceMin, etaDeadline: Number(row.etaDeadline) || 0, attempt: d.attempt, target: d.targetId, result: result })
  }
  // P1-10：tick 末尾按当前 rows 差集清计数（行消失 / 非 running / runner 换人 → 计数作废）
  // 产出审 P1-3 修复：首 tick 只观察（不 prune/不写盘）；其余 tick 仅在实际有变化时落盘（退役每 60s 无意义写盘）
  if (!firstTick) {
    const before = JSON.stringify(st.perChild)
    SD.pruneStallState(st, rows)
    if (out.injected > 0 || JSON.stringify(st.perChild) !== before) stallCheckStateSave(st)
  }
  out.tracked = Object.keys(st.perChild).length
  if (out.injected || out.deduped || out.failed || budgetOut) {
    stallLogLine({ at: Date.now(), task: 'task315', result: budgetOut ? 'tick-budget-out' : 'tick', checked: out.checked, reminded: out.reminded, injected: out.injected, deduped: out.deduped, failed: out.failed })
  }
  return out
}

// ---- task157：auto-reap 静默自动查验与自动关闭（2026-11-09 主人原话：「疑似中断不要让我去 check，
//   你要有机制去看一下，断了就关了，而不是放在那里」「一旦静默就得有机制去看」）----
// 判活三信号（任一即活，物理判据）：① runner queueBusy 在途（TTL 10min）② !stalled（派生层 childMaxTu 新鲜）
//   ③ runner 末条 assistant 的 time.completed 缺失且 created 距今 < 阈值（run 未结束=长命令闭口）。
// R1 实测（2026-11-09 sleep700 跨 TTL）：busy 于 t+10min 被 TTL 清、time_updated 全程停更；
//   末条 assistant created→completed 跨 713s、完成前 completed 恒缺失 ⇒ 信号③兜住长命令窗口，阈值 30min 可用。
// 处置 = override interrupt（可 reopen）+ saveOverrideOp 连带清 eta + 通知根（同 rootGuard）+ 审计 jsonl。
// 护栏：连续 2 tick 命中才动手 / 单轮上限 5 / 处置前重读 override / probe 失败只观察 / 进程启动首个 tick 只记不杀。
const AUTO_REAP_MIN_MS = 30 * 60 * 1000
// task234（主人 2026-11-12「太磨叽了，我是急性子，最好能够瞬间」）：5min→8s。
//   判据未变（末条 assistant 且 time.completed 存在 = run 已收尾、无待处理输入，属硬证据），8s 只防同刻抖动。
const AUTO_DONE_MIN_MS = 8 * 1000
// task234：5min→60s 兜底轮询（主通道改为 session.idle 事件驱动，tick 只兜丢事件）
// task315：LITTLEDJ_AUTO_REAP_TICK_MS 仅为 E2E 自测/调试旋钮（默认 60s；<1000 视为非法回落默认，生产不设）
const AUTO_REAP_TICK_MS = (function () {
  const v = Number(process.env.LITTLEDJ_AUTO_REAP_TICK_MS)
  return (Number.isFinite(v) && v >= 1000) ? v : 60 * 1000
})()
const AUTO_REAP_CAND_MIN_MS = 30 * 1000 // task234：候选静默门槛 3min→30s——tick 才看得见「刚跑完」的行
const AUTO_REAP_MAX_PER_TICK = 5
const AUTO_REAP_MAX_PROBE_PER_TICK = 30 // task180：每 tick 最多 probe 30 行（task234 起候选门槛=静默 30s，done 静默门槛 8s），限流防 tick 超时
const AUTO_REAP_PROBE_TIMEOUT_MS = 4000
const AUTO_REAP_LOG_FILE = path.join(CONFIG, 'auto-reap-log.jsonl')
const AUTO_REAP_STATE_FILE = path.join(CONFIG, 'auto-reap-state.json')
// task254：任务队列常量——排队 4h 未开工自动作废（最后防线；前序卡死由 auto-reap/start-timeout 先兜）；
// 拉起防抖 10min（同一队首重复注入抑制，防 tick 反复叫醒同一条）
const QUEUE_MAX_WAIT_MS = 4 * 3600 * 1000
const QUEUE_PROMOTE_DEBOUNCE_MS = 10 * 60 * 1000
const queuePromotedAt = {}
const AUTO_REAP_BOOT_AT = Date.now()
let autoReapTimer = null
let autoReapInTick = false

function reapLogLine(entry) {
  try { fs.appendFileSync(AUTO_REAP_LOG_FILE, JSON.stringify(entry) + '\n', { mode: 0o600 }) } catch (e) {}
}
function reapStateLoad() {
  const j = readJson(AUTO_REAP_STATE_FILE, null)
  if (j && typeof j === 'object' && j.cand && typeof j.cand === 'object') return { version: 1, cand: j.cand }
  return { version: 1, cand: {} }
}
function reapStateSave(s) {
  const tmp = AUTO_REAP_STATE_FILE + '.tmp-' + process.pid
  try {
    fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
    try { fs.chmodSync(tmp, 0o600) } catch (e0) {}
    fs.renameSync(tmp, AUTO_REAP_STATE_FILE)
  } catch (e) { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch (e2) {} }
}
// 纯函数（selftest 直测）：单行判定。row=applyOverrides 后的行；probe=reapProbeRunner 结果；busy=runner 是否在途
// task180：终态分两类——①「活了」（末条 assistant 已 completed）→ kind='done'，独立 5min 门槛、不要求 stalled；
//   ②「死了」（末条 user 无回复 / run 未结束僵尸）→ kind='interrupt'，沿用 30min+stalled。
//   旧版把①也归 close→interrupt，正常结束被标成中断，且 done 从不自动发生 ⇒ ETA 永不清账（主人 2026-11-10 报障）。
function reapDecide(row, probe, busy, now) {
  if (!row || row.inTask === false) return { action: 'skip', why: 'not-in-task' }
  if (row.state && row.state !== 'running') return { action: 'skip', why: 'overridden' }
  if (!String(row.runnerSession || '')) return { action: 'skip', why: 'no-runner' }
  if (busy) return (Number(row.etaOverdueMin) > 0) ? { action: 'extend', why: 'alive-busy' } : { action: 'skip', why: 'alive-busy' }
  if (!probe || !probe.ok) return { action: 'skip', why: 'probe-failed' } // 拿不到一手证据绝不判死
  // task180：「活了」判据只认硬证据——末条 assistant 且 time.completed 存在（run 已收尾、无待处理输入）。
  // 不要求 stalled（done 要快于 interrupt），也不看根会话 lastEventAt（probe 证据已足够）。
  if (String(probe.lastRole) === 'assistant' && Number(probe.completed) > 0) {
    const silentMs = now - (Number(probe.completed) || 0)
    if (silentMs < AUTO_DONE_MIN_MS) return { action: 'skip', why: 'recently-ended', silentMs: silentMs }
    return { action: 'close', kind: 'done', why: 'ended-unmarked', silentMs: silentMs, anchorAt: probe.completed }
  }
  if (row.stale !== 'stalled') return { action: 'skip', why: 'not-stalled' }
  if (probe.lastRole === 'user') {
    // P1-2 修正：末条是 user 时锚点必须用该 user 消息的 created（lastMsgCreated），
    // 不能用 lastA.created（那是上一条 assistant 的生成开始时刻，age 会虚高一个生成时长）
    const uCreated = Number(probe.lastMsgCreated) || 0
    const age = now - uCreated
    if (!uCreated || age < AUTO_REAP_MIN_MS) return { action: 'skip', why: 'user-pending' }
    return { action: 'close', kind: 'interrupt', why: 'no-reply-silent', anchorAt: uCreated, silentMs: age }
  }
  if (!probe.completed) {
    const age = now - (Number(probe.created) || 0)
    if (age < AUTO_REAP_MIN_MS) return { action: 'skip', why: 'run-in-progress' }
    return { action: 'close', kind: 'interrupt', why: 'run-zombie', anchorAt: probe.created, silentMs: age }
  }
  // 兜底（理论不可达：assistant+completed 已在上面 done 分支处理）
  return { action: 'skip', why: 'recently-ended' }
}
// 拉 runner 末条消息摘要（serve HTTP 一手；不碰 deveco.db message 大表——task-derive 红线）
function reapProbeRunner(sid, cb) {
  let fin = false
  const done = function (r) { if (!fin) { fin = true; cb(r) } }
  const timer = setTimeout(function () { done({ ok: false, why: 'timeout' }) }, AUTO_REAP_PROBE_TIMEOUT_MS)
  if (timer.unref) timer.unref()
  try {
    backendRequest('GET', '/session/' + encodeURIComponent(sid) + '/message', { authorization: AUTH_EXPECT }, null, function (pres, perr) {
      if (perr || !pres) return done({ ok: false, why: 'backend-error' })
      let buf = ''
      pres.on('data', function (d) { buf += d })
      pres.on('end', function () {
        try {
          const arr = JSON.parse(buf)
          if (!Array.isArray(arr) || !arr.length) return done({ ok: false, why: 'empty' })
          const last = arr[arr.length - 1] || {}
          let lastA = null
          for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] && arr[i].info && arr[i].info.role === 'assistant') { lastA = arr[i]; break } }
          const tm = (lastA && lastA.info && lastA.info.time) || {}
          // task315：末条 assistant 是否有 running 状态的 tool part（stallCheck 判活信号；reapDecide 不读）
          let hasRunningPart = false
          if (lastA && Array.isArray(lastA.parts)) {
            for (let i = 0; i < lastA.parts.length; i++) {
              const p = lastA.parts[i]
              if (p && p.type === 'tool' && p.state && p.state.status === 'running') { hasRunningPart = true; break }
            }
          }
          done({ ok: true, lastRole: String((last.info && last.info.role) || ''), created: Number(tm.created) || 0, completed: Number(tm.completed) || 0, lastMsgCreated: Number(last.info && last.info.time && last.info.time.created) || 0, hasRunningPart: hasRunningPart })
        } catch (e) { done({ ok: false, why: 'parse-error' }) }
      })
    })
  } catch (e) { done({ ok: false, why: 'throw' }) }
}
// ---- task234：子代理收口「事件驱动」即时化 ----
// 背景（主人 2026-11-12）：「太磨叽了，我是急性子，最好能够瞬间」——旧链最长 = 2 tick×5min + 5min 静默 ≈ 15min。
// 机制：serve 的 session.idle / session.status(idle) 是「该会话 run 已收尾」的一手信号 → 若该 sid 正是台账中
//   running 行的 runnerSession，立即 probe 一次（末条 assistant + time.completed）→ 命中即写 auto-done。
// 护栏：① 每 sid 1s 防抖（同一次收尾可能连发事件）；② probe 失败/无 completed 一律不动（绝不拿不到证据就收口）；
//   ③ 处置前重读 override（与 tick R3 同口径，防人工标记竞态）；④ 本通道只做 done——interrupt 仍只走 tick 的 2 连击，
//   事件不判死；⑤ note 仍带 auto-done 前缀 → 行有新活动时 applyOverrides 自动失效，不永久压制被复用会话。
const REAP_HINT_DEBOUNCE_MS = 1000
const reapHintAt = {}
function reapCloseDone(key, runner, probe, why, now, staleMin) {
  const fresh = loadOverrides()
  const f = fresh.overrides[key]
  // task254 P1-1/⑥：auto-done 条目已被新活动失效（同 applyOverrides 谓词）时允许重标——
  // 旧条目不删是历史设计（防误杀转场），但「失效条目堵死重标」会造成 already-marked 死锁（2026-11-12 实测 4 会话卡 400~1180min）
  let staleAuto = false
  if (f && f.state === 'done' && String(f.note || '').indexOf(AUTO_DONE_NOTE_PREFIX) === 0) {
    try {
      const der = deriveTasksCached()
      if (der && der.ok) {
        const row = der.tasks.filter(function (t) { return t && String(t.id) === String(key) })[0]
        staleAuto = !!(row && Number(row.lastEventAt) > (Number(f.at) || 0))
      }
    } catch (e) {}
  }
  if (f && (f.state === 'interrupted' || f.state === 'done' || f.state === 'waiting') && !staleAuto) return { ok: false, why: 'already-marked' } /* task334 P0-1：waiting 也算已标记——防 probe 4s 窗口内 hold 被 auto-done 覆盖（原事故复发路径） */
  const silentMs = Math.max(0, now - (Number(probe.completed) || 0))
  const silentTxt = silentMs < 60000 ? Math.max(1, Math.round(silentMs / 1000)) + 's' : Math.max(1, Math.round(silentMs / 60000)) + 'm'
  const note = AUTO_DONE_NOTE_PREFIX + '（静默 ' + silentTxt + '）'
  const r = saveOverrideOp({ sessionId: key, op: 'done', note: note }, null, runner)
  const ok = !!(r && r.ok)
  reapLogLine({
    at: now, task: 'task180', sid: key, rootId: key, runnerSession: runner,
    staleMin: (staleMin == null ? null : staleMin), action: 'done', why: why,
    silentMs: silentMs, note: note, writeOk: ok, etaCleared: (r && r.etaCleared) || 0
  })
  return { ok: ok, silentMs: silentMs, note: note }
}
function reapHintIdle(sid) {
  if (!sid || typeof sid !== 'string') return
  const now = Date.now()
  if (reapHintAt[sid] && now - reapHintAt[sid] < REAP_HINT_DEBOUNCE_MS) return
  reapHintAt[sid] = now
  let rows = null
  try {
    const der = deriveTasksCached()
    if (!der || !der.ok) return
    rows = applyOverrides(der.tasks)
  } catch (e) { return }
  const row = rows.find(function (t) {
    return t && t.runnerSession === sid && t.inTask !== false && (!t.state || t.state === 'running')
  })
  if (!row) return
  const rootId = String(row.id)
  const staleMin = Number(row.staleMinutes) || null
  // 事件已证明该会话 run 收尾，静默门槛对事件通道不设（tick 通道的 8s 门槛只为轮询防抖）
  reapProbeRunner(sid, function (probe) {
    try {
      if (!probe || !probe.ok) return
      if (String(probe.lastRole) !== 'assistant' || !Number(probe.completed)) return
      const r = reapCloseDone(rootId, sid, probe, 'ended-event', Date.now(), staleMin)
      if (r && r.ok) {
        const st = reapStateLoad()
        if (st.cand[rootId]) { delete st.cand[rootId]; reapStateSave(st) }
      }
    } catch (e) {}
  })
}
// 通知根会话（rootGuard 同式：butler 根注入；TUI/build 根跳过通知但关闭照做）
function autoReapNotify(rootId, runner, note) {
  try {
    const meta = sessionMetaOf(rootId)
    if (!meta) return 'no-session'
    if (meta.parent) return 'not-root'
    if (String(meta.agent || '') !== 'butler') return 'tui-root-guard'
    const text = '【系统自动提醒·程序触发】检测到子代理任务（' + String(runner).slice(0, 24) + '）静默超阈值，已按 task157 机制自动关闭（' + note + '）。' +
      '如属误杀：POST /_tasks {"sessionId":"' + rootId + '","op":"reopen"} 可恢复。此消息由自动机制发送，非主人指令，不得当作新任务执行。'
    const q = queueEnqueue(rootId, [{ type: 'text', text: text }], '[系统自动关闭]', {})
    if (q && q.ok) queueTickSoon()
    return (q && q.ok) ? 'sent' : ('enqueue-failed:' + String((q && q.error) || ''))
  } catch (e) { return 'throw' }
}
// 单轮 tick：候选 → probe → decide → 计数 → 关闭/顺延。串行异步，全程不抛。
function autoReapTick(cb) {
  if (autoReapInTick) { if (cb) cb({ skipped: 'in-tick' }); return }
  autoReapInTick = true
  const finish = function (r) { autoReapInTick = false; if (cb) try { cb(r) } catch (e) {} }
  let der = null
  try { der = deriveTasksCached() } catch (e) { der = { ok: false, reason: 'throw' } }
  if (!der || !der.ok) return finish({ skipped: 'derive-' + String((der && der.reason) || 'fail') })
  const rows = applyOverrides(der.tasks)
  const now = Date.now()
  /* task254：队列断链收口（queued 超时作废 / start 后无 runner 静默中断），独立 try 不阻塞 reap */
  let qh = null
  try { qh = queueHygiene(now) } catch (e) { qh = { throw: 1 } }
  const st = reapStateLoad()
  /* task234：为在跑行的根会话订阅目录 SSE——事件驱动收口（session.idle 即时处置）的前提。
     queueWatchSession 幂等（queueDirs 缓存 sid→dir，同目录只订阅一次），失败静默不影响 tick。 */
  try {
    rows.forEach(function (t) {
      if (t && t.inTask !== false && (!t.state || t.state === 'running') && t.runnerSession && t.id) queueWatchSession(String(t.id))
    })
  } catch (e) {}
  // P1-1 修正：重启后首 tick 保护——用 <=2*TICK_MS（原 <TICK_MS 在 interval 恰 5min 边界永不成立，
  // 等于首 tick 保护失效）；配合 autoReapStart 启动清陈旧 cand 双保险
  const firstTickAfterBoot = (now - AUTO_REAP_BOOT_AT) <= AUTO_REAP_TICK_MS * 2
  // task180：done 分支要快于 interrupt——候选门槛 task234 起=静默 30s（原 3min；旧版只看 stalled=15min+，
  // 已完成任务最长挂 25min 才收口）。上限 AUTO_REAP_MAX_PROBE_PER_TICK 防 tick 超时，最旧优先。
  const cands = rows.filter(function (t) {
    if (t.inTask === false || (t.state && t.state !== 'running') || !String(t.runnerSession || '')) return false
    // task234：静默门槛改毫秒直算（原 staleMinutes>=3 会让「刚跑完」的行白等 3min 才进候选）
    return t.stale === 'stalled' || (now - (Number(t.lastEventAt) || 0)) >= AUTO_REAP_CAND_MIN_MS
  }).sort(function (a, b) { return (Number(a.lastEventAt) || 0) - (Number(b.lastEventAt) || 0) })
    .slice(0, AUTO_REAP_MAX_PROBE_PER_TICK)
  const seen = {}
  const stallCands = [] // task315：本 tick 内 reapDecide 判 skip 且原因允许进静默检查的行（复用同一 probe）
  let idx = 0, closed = 0, extended = 0
  const step = function () {
    if (idx >= cands.length) {
      Object.keys(st.cand).forEach(function (k) { if (!seen[k]) delete st.cand[k] })
      reapStateSave(st)
      /* task315：在途静默检查（非破坏软提醒；复用本 tick 的 probe/cands，不另发探针；失败只记日志不影响 reap） */
      let _sc = null
      try { _sc = stallCheckPass(stallCands, rows, firstTickAfterBoot, now) } catch (e) { _sc = { skipped: 'throw' } }
      /* task184：同 tick 顺带跑派单角色核对（独立 try；核对完成/异常后再 finish，失败不影响 reap 结果） */
      let _acDone = false
      const _acFinish = function (r) {
        if (_acDone) return
        _acDone = true
        finish({ closed: closed, extended: extended, checked: cands.length, queueHygiene: qh, stallCheck: _sc, agentCheck: r || null })
      }
      try { agentCheckStep(_acFinish) } catch (e) { _acFinish({ skipped: 'throw' }) }
      return
    }
    const row = cands[idx++]
    const key = String(row.id)
    const runner = String(row.runnerSession || '')
    seen[key] = 1
    const busyNow = !!(queueBusy[runner] && (now - Number(queueBusy[runner])) < QUEUE_BUSY_TTL)
    reapProbeRunner(runner, function (probe) {
      let d = null
      try { d = reapDecide(row, probe, busyNow, now) } catch (e) { d = { action: 'skip', why: 'decide-throw' } }
      // task315：reap 判 skip 且原因属于 {run-in-progress,user-pending,not-stalled} → 收进静默检查候选
      if (d && d.action === 'skip' && SD.reapSkipAllowsStall(d.why)) {
        stallCands.push({ row: row, probe: probe, busy: busyNow, reapWhy: d.why })
      }
      const prev = st.cand[key] || { n: 0, ext: 0, lastAt: 0, lastNotifyAt: 0 }
      if (d.action === 'close' && !firstTickAfterBoot) {
        prev.n = Number(prev.n || 0) + 1
        prev.lastAt = now
        st.cand[key] = prev
        // task234：done 分支已有 completed 硬证据，1 次命中即处置（配合 8s 静默门槛）；interrupt 仍 2 连击防误杀
        const needN = (d.kind === 'done') ? 1 : 2
        if (prev.n >= needN && closed < AUTO_REAP_MAX_PER_TICK) {
          // R3：处置前重读 override（防与人工标记竞态）
          const fresh = loadOverrides()
          const f = fresh.overrides[key]
          // task254 ⑥：auto-done 已被新活动失效时允许重标（与 reapCloseDone 同谓词），防已失效条目堵死收口链
          const staleAuto = !!(f && f.state === 'done' && String(f.note || '').indexOf(AUTO_DONE_NOTE_PREFIX) === 0 &&
            Number(row.lastEventAt) > (Number(f.at) || 0))
          const already = f && (f.state === 'interrupted' || f.state === 'done' || f.state === 'waiting') && !staleAuto /* task334 P0-1：waiting 同守——tick R3 重读与 reapCloseDone 同口径 */
          if (already) { delete st.cand[key] }
          else {
            const kind = d.kind === 'done' ? 'done' : 'interrupt'
            const silentTxt = Math.max(1, Math.round((Number(d.silentMs) || 0) / 60000))
            // task180：done=自动收口（不打扰主人，只记审计）；interrupt=auto-reap 原语义（通知根会话）
            const note = kind === 'done' ? (AUTO_DONE_NOTE_PREFIX + '（静默 ' + silentTxt + 'm）')
              : ('auto-reap（静默 ' + silentTxt + 'm）')
            const r = saveOverrideOp({ sessionId: key, op: kind, note: note }, null, runner)
            const ok = !!(r && r.ok)
            reapLogLine({
              at: now, task: 'task180', sid: key, rootId: key, runnerSession: runner,
              staleMin: Number(row.staleMinutes) || null, action: kind, why: d.why,
              silentMs: Number(d.silentMs) || 0, note: note, writeOk: ok, etaCleared: (r && r.etaCleared) || 0
            })
            if (ok) {
              closed++
              if (kind !== 'done') {
                const nres = autoReapNotify(key, runner, note)
                reapLogLine({ at: Date.now(), task: 'task157', sid: key, action: 'notify', result: nres })
              }
            }
            delete st.cand[key]
          }
        }
      } else if (d.action === 'extend' && !firstTickAfterBoot) {
        // 活但超时 → 自动顺延 +10min（最多 2 回；超了只记观察，绝不因「跑太久」关）
        prev.ext = Number(prev.ext || 0)
        if (prev.ext < 2) {
          const oldMin = Number(row.etaMinutes) || 0
          const newMin = Math.min(240, oldMin + 10)
          const etaSid = String(row.etaChildId || runner)
          const rr = saveOverrideOp({ sessionId: etaSid, op: 'eta', etaMinutes: newMin }, null, runner)
          if (rr && rr.ok) {
            prev.ext++
            extended++
            reapLogLine({ at: now, task: 'task157', sid: key, runnerSession: runner, action: 'extend', why: d.why, etaMinutes: newMin })
          }
          st.cand[key] = prev
        }
      } else {
        if (st.cand[key]) delete st.cand[key]
      }
      step()
    })
  }
  step()
}
function autoReapStart() {
  if (autoReapTimer) return
  // P1-1（R2）：进程重启后清零连续 tick 计数——旧计数不得跨重启直通关闭；
  // 清空后首 tick 重新累积 n=1，第二 tick（≥10min）才可能动手
  try {
    const s = reapStateLoad()
    if (Object.keys(s.cand).length) { s.cand = {}; reapStateSave(s) }
  } catch (e) {}
  autoReapTimer = setInterval(function () { try { autoReapTick() } catch (e) {} }, AUTO_REAP_TICK_MS)
  if (autoReapTimer.unref) autoReapTimer.unref()
}

// ---- task184：派单角色丢失自动核对闸 ----
// 背景：宿主 serve 的 task 工具偶发丢失 subagent_type、静默回落 build/general（库内 4 例）——
//   御史会话实际以 build 全工具运行（可改码/派单/commit），「只审不改」边界被绕过。
// 机制：随 autoReapTick（5min）顺带扫描最近 60min 新建子会话，判据见 task-derive.agentMismatchOf；
//   命中 → 审计 jsonl → 已被 override 标终态的跳过 → 自动 abort（cancelAbortOne）→ 通知父根会话。
// 护栏：同 sid 幂等、首 2 tick 只观察、连败 2 次退避、同根熔断 ≥3 停 abort、rootId 空按 sid 单计。
const AGENT_CHECK_STATE_FILE = path.join(CONFIG, 'agent-check-state.json')
const AGENT_CHECK_LOG_FILE = path.join(CONFIG, 'agent-mismatch-log.jsonl')
const AGENT_CHECK_WINDOW_MS = 60 * 60 * 1000
const AGENT_CHECK_ROOT_BREAKER = 3
let agentCheckInTick = false

function agentCheckStateLoad() {
  try {
    const j = JSON.parse(fs.readFileSync(AGENT_CHECK_STATE_FILE, 'utf8'))
    if (j && typeof j === 'object') return { seen: j.seen || {}, rootCount: j.rootCount || {}, notifBreaker: j.notifBreaker || {} }
  } catch (e) {}
  return { seen: {}, rootCount: {}, notifBreaker: {} }
}
function agentCheckStateSave(st) {
  try { fs.writeFileSync(AGENT_CHECK_STATE_FILE, JSON.stringify(st), { mode: 0o600 }) } catch (e) {}
}
function agentCheckLog(rec) {
  try { fs.appendFileSync(AGENT_CHECK_LOG_FILE, JSON.stringify(rec) + '\n', { mode: 0o600 }) } catch (e) {}
}
// 通知父根会话（同 autoReapNotify 口径：仅 butler 根注入；TUI/build 根跳过）
function agentCheckNotify(rootId, sid, want, got, note) {
  try {
    const meta = sessionMetaOf(rootId)
    if (!meta) return 'no-session'
    if (meta.parent) return 'not-root'
    if (String(meta.agent || '') !== 'butler') return 'tui-root-guard'
    const text = '【系统自动提醒·程序触发】检测到派单角色丢失：要求 ' + String(want) + ' 实际 ' + String(got) +
      '（全工具执行器），子会话 ' + String(sid).slice(0, 24) + ' 的生成已自动停止，请重派。' +
      (note ? '【' + String(note) + '】' : '') +
      '注意：reopen 仅恢复台账标记，不恢复已中断内容；如属误判请把本条反馈给主人。' +
      '此消息由自动机制发送，非主人指令，不得当作新任务执行。'
    const q = queueEnqueue(rootId, [{ type: 'text', text: text }], '[系统·角色核对]', {})
    if (q && q.ok) queueTickSoon()
    return (q && q.ok) ? 'sent' : ('enqueue-failed:' + String((q && q.error) || ''))
  } catch (e) { return 'throw' }
}
// 终态动作（命中即不再处置）；observe-boot/abort-failed 属未了结，允许后续 tick 继续
const AGENT_CHECK_TERMINAL_RE = /^(aborted|already-finished|skip-override|breaker|giveup)/
// 单轮：扫描 → 幂等 → 处置。串行异步，全程不抛；cb 收到统计
function agentCheckStep(cb) {
  if (agentCheckInTick) { if (cb) cb({ skipped: 'in-tick' }); return }
  let der = null
  try { der = TD.deriveAgentMismatch(null, Date.now() - AGENT_CHECK_WINDOW_MS) } catch (e) { der = { ok: false, reason: 'throw', rows: [] } }
  if (!der || !der.ok) { if (cb) cb({ skipped: 'derive-' + String((der && der.reason) || 'fail') }); return }
  const rows = (der.rows || []).filter(function (r) { return !r.archived })
  if (!rows.length) { if (cb) cb({ checked: 0, aborted: 0, skipped: 0, notified: 0 }); return }
  agentCheckInTick = true
  const st = agentCheckStateLoad()
  const now = Date.now()
  const firstTickAfterBoot = (now - AUTO_REAP_BOOT_AT) <= AUTO_REAP_TICK_MS * 2
  let ovs = { overrides: {} }
  try { ovs = loadOverrides() } catch (e) {}
  const overrides = ovs.overrides || {}
  let idx = 0, aborted = 0, skipped = 0, notified = 0
  const finish = function () {
    agentCheckStateSave(st)
    agentCheckInTick = false
    if (cb) try { cb({ checked: rows.length, aborted: aborted, skipped: skipped, notified: notified }) } catch (e) {}
  }
  const step = function () {
    if (idx >= rows.length) return finish()
    const r = rows[idx++]
    const sid = r.id
    const prior = st.seen[sid]
    /* P1-2：已被 auto-reap/人工标终态的跳过（防同 tick 双处置）；终态动作也跳过（幂等） */
    if (prior && AGENT_CHECK_TERMINAL_RE.test(String(prior.action || ''))) { skipped++; return step() }
    const ov = overrides[sid]
    if (ov && (ov.state === 'interrupted' || ov.state === 'done' || ov.state === 'waiting')) { /* task334 P2-13：waiting 同跳（挂后台任务不核对派单角色） */
      st.seen[sid] = { at: now, action: 'skip-override:' + ov.state }
      agentCheckLog({ at: now, task: 'task184', sid: sid, rootId: r.rootId, want: r.want, agent: r.agent, action: 'skip-override', state: ov.state })
      skipped++; return step()
    }
    /* 首 tick 只观察（写 seen 防重复审计；observe-boot 非终态，下 tick 会真处置） */
    if (firstTickAfterBoot) {
      st.seen[sid] = { at: now, action: 'observe-boot' }
      agentCheckLog({ at: now, task: 'task184', sid: sid, rootId: r.rootId, want: r.want, agent: r.agent, action: 'observe-boot' })
      skipped++; return step()
    }
    const rootKey = r.rootId || ('sid:' + sid) /* P1-1：无根不按 '' 聚合 */
    const rc = Number(st.rootCount[rootKey] || 0)
    if (rc >= AGENT_CHECK_ROOT_BREAKER) {
      st.seen[sid] = { at: now, action: 'breaker-stop' }
      agentCheckLog({ at: now, task: 'task184', sid: sid, rootId: r.rootId, want: r.want, agent: r.agent, action: 'breaker-stop', rootCount: rc })
      /* P1-1（产出审）：熔断只通知一次（同根）——serve 角色加载故障期需人工介入，不能静默 */
      st.notifBreaker = st.notifBreaker || {}
      if (!st.notifBreaker[rootKey]) {
        st.notifBreaker[rootKey] = 1
        const nres = agentCheckNotify(r.rootId, sid, r.want, r.agent, '已熔断·请人工检查 serve 角色加载')
        if (nres === 'sent') notified++
        agentCheckLog({ at: now, task: 'task184', sid: sid, action: 'notify', result: nres, note: 'breaker-stop' })
      }
      skipped++; return step()
    }
    st.seen[sid] = { at: now, action: 'aborting' } /* P2-3：先占位再 abort */
    agentCheckStateSave(st)
    cancelAbortOne(sid, function (res) {
      const result = (res && res.result) || 'failed'
      if (result === 'aborted') {
        aborted++
        st.rootCount[rootKey] = rc + 1
        st.seen[sid] = { at: Date.now(), action: 'aborted' }
        agentCheckLog({ at: Date.now(), task: 'task184', sid: sid, rootId: r.rootId, want: r.want, agent: r.agent, action: 'abort', result: result })
        const nres = agentCheckNotify(r.rootId, sid, r.want, r.agent)
        if (nres === 'sent') notified++
        agentCheckLog({ at: Date.now(), task: 'task184', sid: sid, action: 'notify', result: nres })
      } else if (result === 'already-finished') {
        st.seen[sid] = { at: Date.now(), action: 'already-finished' } /* P2-4：只审计不通知 */
        agentCheckLog({ at: Date.now(), task: 'task184', sid: sid, rootId: r.rootId, want: r.want, agent: r.agent, action: 'already-finished' })
        skipped++
      } else {
        const fails = (Number(prior && prior.fail) || 0) + 1
        st.seen[sid] = { at: Date.now(), action: 'abort-failed', fail: fails }
        agentCheckLog({ at: Date.now(), task: 'task184', sid: sid, rootId: r.rootId, want: r.want, agent: r.agent, action: 'abort-failed', httpStatus: (res && res.httpStatus) || 0, fail: fails })
        if (fails >= 2) { /* 连败 2 次：改只通知+审计，不再重试 */
          st.seen[sid] = { at: Date.now(), action: 'giveup-after-fails', fail: fails }
          const nres = agentCheckNotify(r.rootId, sid, r.want, r.agent)
          if (nres === 'sent') notified++
          agentCheckLog({ at: Date.now(), task: 'task184', sid: sid, action: 'notify', result: nres, note: 'giveup-after-fails' })
        }
      }
      agentCheckStateSave(st)
      step()
    })
  }
  try { step() } catch (e) {
    /* P2-1（产出审）：同步段未预期异常兜底——复位在途标志，防核对闸静默停摆至重启 */
    agentCheckInTick = false
    if (cb) try { cb({ skipped: 'throw' }) } catch (e2) {}
  }
}

// 开工三查注入用：派生 + 覆盖 → 最近 20 个非归档/未完成根会话；降级时返回非空告警行（绝不静默空注入）
function bootLedgerText(dbPath) {
  const der = deriveTasksCached(dbPath)
  if (!der.ok) {
    return '【任务台账派生失败：' + String(der.reason || 'unknown') + '】请人工核对会话列表（旧台账已退役：task-ledger.json.retired-20261105）'
  }
  const tasks = applyOverrides(der.tasks)
  // 已排序（lastEventAt 倒序）：只取「任务口径内」（inTask = step>0 且未归档，派生层单一来源）
  // 且未被人工 done 的条目；interrupted 保留（它仍是「未完成」）。
  // 用 !== false 而非 === true：旧结构/降级时宁可多注入，不可漏在途任务（重启恢复红线）。
  const pick = tasks.filter(function (t) {
    return t.inTask !== false && t.state !== 'done'
  }).slice(0, 20)
  if (!pick.length) return ''
  const lines = ['【未完成任务台账（serve 库只读派生：先核对现状，再决定续做或重来）】']
  pick.forEach(function (t) {
    const silent = t.staleMinutes == null ? '-' : String(t.staleMinutes)
    /* task159：已标记中断的行（人工/auto-reap）保留在台账提醒续做，但文案必须反映「已标记」，
       不得再说「待人工标记」——否则主人已关的任务看起来还挂着等人处理。
       P2-1（御史）：overrideNote 自身已含「静默 39m」时省略行尾静默段，避免「静默…（静默…）」重复 */
    if (t.state === 'interrupted') {
      const note = String(t.overrideNote || '')
      const head = note ? '已中断，' + note : '已中断'
      const tail = note.indexOf('静默') >= 0 ? '（可 reopen 续做）' : '（静默 ' + silent + ' 分钟，可 reopen 续做）'
      lines.push('- [' + t.id + '] ' + (t.title || '(未命名)') + ' · ' + head + tail + ' · step=' + (Number(t.step) || 0) + ' · runner=' + (t.runnerSession || '-'))
      return
    }
    /* task334 P1-2：waiting（op=hold 显式等待中·挂后台任务）——不得落入下方 stalled「疑似中断」分支，
       否则每个新会话的开工三查都会诱导 AI 收口被 hold 的会话（原事故的文本复发入口） */
    if (t.state === 'waiting') {
      const wnote = String(t.overrideNote || '') || '挂后台任务'
      lines.push('- [' + t.id + '] ' + (t.title || '(未命名)') + ' · 等待中（' + wnote + '；勿收口，解除用 POST /_tasks op=reopen）· step=' + (Number(t.step) || 0) + ' · runner=' + (t.runnerSession || '-'))
      return
    }
    /* task148：停摆行不再标 running（派生 state 恒 running 与展示脱钩），改标「疑似中断」，与删除锁/在跑口径统一 */
    if (t.stale === 'stalled') {
      lines.push('- [' + t.id + '] ' + (t.title || '(未命名)') + ' · 疑似中断（静默 ' + silent + ' 分钟，待人工标记完成/中断）· step=' + (Number(t.step) || 0) + ' · runner=' + (t.runnerSession || '-'))
      return
    }
    const flag = t.stale === 'quiet' ? '静默 ' + silent + ' 分钟' : '活跃'
    lines.push('- [' + t.id + '] ' + (t.title || '(未命名)') + ' · ' + t.state + ' · ' + flag +
      ' · step=' + (Number(t.step) || 0) + ' · runner=' + (t.runnerSession || '-'))
  })
  // task119：ETA 超时点名段——仅存在超时任务时出现（无超时任务时本函数输出与改前逐字节一致，P1-5 零恶化）；
  // 行 state==='running' 且 inTask!==false 才计 overdue（applyOverrides 统一谓词）；≤5 行 overdue 降序+溢出提示。
  // 文案禁判死措辞（派生层永不自动判死）：统一「已超预计 Nm·待查验」；查验交小管家判读四态（在做/暂停/宕机观察/已完成未标）。
  const overdue = pick.filter(function (t) { return Number(t.etaOverdueMin) > 0 })
    .sort(function (a, b) { return (Number(b.etaOverdueMin) || 0) - (Number(a.etaOverdueMin) || 0) })
  if (overdue.length) {
    lines.push('【ETA 超时点名（已超预计·待查验；查验交小管家判读：在做/暂停/宕机观察/已完成未标，正做则更新预计）】')
    overdue.slice(0, 5).forEach(function (t) {
      const tt = String(t.title || '(未命名)').replace(/[\r\n]+/g, ' ') // P2-11：title 用台账行同源数据+滤换行
      lines.push('- [' + t.id + '] ' + tt + ' · 已超预计 ' + t.etaOverdueMin + 'm（预计 ' +
        (Number(t.etaMinutes) || 0) + 'm）待查验 · runner=' + (t.runnerSession || '-'))
    })
    if (overdue.length > 5) lines.push('（另有 ' + (overdue.length - 5) + ' 项超时，明细见 /_tasks）')
  }
  lines.push('（核对后更新：人工确认用 {sessionId, op} 标记 interrupt/done/reopen；拿不准的先把「任务、当前进度、要主人定什么」一起回报）')
  return lines.join('\n')
}

// ---- 任务板（T08，2026-11-05 更名）：主人想法清单，落 config/board.json；文本即数据，行首 [x] 视为已划掉 ----
const BOARD_FILE = path.join(CONFIG, 'board.json')
const BOARD_MAX = 64 * 1024
function loadBoard() {
  const j = readJson(BOARD_FILE, {})
  return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}
}
function boardPending(b) {
  return String((b && b.text) || '').split(/\r?\n/).map(function (l) { return l.trim() })
    .filter(function (l) { return l && !/^\[x\]/i.test(l) })
}
function bootBoardText() {
  try {
    const pend = boardPending(loadBoard()).slice(0, 5)
    if (!pend.length) return ''
    return '【任务板 · 待办（主人留言原样保存；下一步建议优先从待办里挑，做完一条在左栏划掉）】\n' +
      pend.map(function (l) { return '- ' + l }).join('\n')
  } catch (e) { return '' }
}
// ---- 备忘录（task216）：多条 txt 式文档，服务端存储（data/notes.json）跨端可见；tmp→rename 原子写 ----
const NOTES_FILE = path.join(ROOT, 'data', 'notes.json')
const NOTES_MAX_ITEMS = 200          // 条数上限（fail-closed）
const NOTES_MAX_CONTENT = 64 * 1024  // 单条正文字符上限（同任务板 64KB 口径）
const NOTES_MAX_TOTAL = 1024 * 1024  // 全文件内容总量上限（防无限膨胀）
let notesCache = null                // 内存单例（proxy 单线程，读写无竞态）
function loadNotes() {
  if (notesCache) return notesCache
  const j = readJson(NOTES_FILE, null)
  notesCache = (j && Array.isArray(j.list)) ? j : { list: [], updatedAt: 0 }
  return notesCache
}
function saveNotes(n) {
  n.updatedAt = Date.now()
  fs.mkdirSync(path.dirname(NOTES_FILE), { recursive: true })
  const tmp = NOTES_FILE + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(n, null, 2))
  fs.renameSync(tmp, NOTES_FILE)
}
function notesPublic(n) {
  return {
    notes: n.list.slice().sort(function (a, b) { return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) }),
    updatedAt: n.updatedAt
  }
}
function notesTotal(n) {
  let t = 0
  n.list.forEach(function (x) { t += String(x.content || '').length + String(x.title || '').length })
  return t
}

// task294：密码本（账号密码库）——task298 起静态加密 AES-256-GCM（共享模块 server/vault-crypto.js）
// 状态机（方案稿 rev.2 §三，fail-closed）：唯一允许空库=「vault.json 与 vault.key 都不存在」（全新安装）；
// 其余任何 读失败/parse/未知 version/shape/v2 解密/schema/key 变化 → vaultError（GET 500 / POST 409，文件字节零变化）
const VCRYPTO = require('./vault-crypto')
const VAULT_FILE = path.join(ROOT, 'data', 'vault.json')
const VAULT_KEY_FILE = path.join(ROOT, 'config', 'vault.key')
const VAULT_MAX_ITEMS = 800
const VAULT_MAX_NOTE = 4096
let vaultCache = null        // 明文 {items:[...],updatedAt}（仅内存）
let vaultError = null        // fail-closed 状态；置位后修复需重启 proxy（缓存清零）
let vaultKeyCache = null     // key 缓存（saveVault 写前重读比对，P1-1.③）

function vaultErrThrow (msg) {
  vaultError = msg || '密码本已停止读写（fail-closed 保护，未覆盖现有文件）'
  const e = new Error(vaultError)
  e.vaultFail = true
  throw e
}
const VAULT_FC = '密码本已停止读写（fail-closed 保护，未覆盖现有文件）。请排查 config/vault.key 与 data/vault.json'

/* task331：密码本条目 → 供应商 Key 提取——密码字段整段就是 Key 时直接用；
   夹杂备注文字（拍照 OCR/人工随手记）时按供应商形态正则捞（DeepSeek=sk- 前缀，智谱/火山=首段无空白长令牌）。
   捞不出返回空串，由 /_vault/apply 翻成中文错误让主人先整理密码本条目。 */
function vaultExtractKey(pw, provider) {
  const t = String(pw || '').replace(/^\s+|\s+$/g, '')
  if (!t) return ''
  if (!/\s/.test(t)) return t
  if (provider === 'deepseek') {
    const m = t.match(/sk-[A-Za-z0-9]{16,}/)
    return m ? m[0] : ''
  }
  const m2 = t.match(/[A-Za-z0-9._~+\/=-]{16,128}/)
  return m2 ? m2[0] : ''
}

function loadVault() {
  if (vaultError) { const e = new Error(vaultError); e.vaultFail = true; throw e }
  if (vaultCache) return vaultCache

  // 启动清理 stale tmp（仅主文件可读时，P1-2.④）
  try {
    fs.accessSync(VAULT_FILE)
    const dir = path.dirname(VAULT_FILE)
    fs.readdirSync(dir).forEach(function (n) { if (n.indexOf('vault.json.tmp-') === 0) { try { fs.unlinkSync(path.join(dir, n)) } catch (e) {} } })
  } catch (e) {}

  let raw = null, exists = true
  try { raw = fs.readFileSync(VAULT_FILE, 'utf8') }
  catch (e) { if (e && e.code === 'ENOENT') exists = false; else vaultErrThrow(VAULT_FC + '：vault.json 读取失败') }

  if (!exists) {
    // 产出审 P1-2：key 判「存在性」用 fs.existsSync（loadKey 只认合法 32B，key 文件在但损坏时会误判全新安装→生成新 key 覆盖）
    if (fs.existsSync(VAULT_KEY_FILE)) vaultErrThrow(VAULT_FC + '：vault.json 缺失但 vault.key 存在（非全新安装，拒空库）')
    // 全新安装：生成 key + 立即落空 v2（不留 key-only 假故障态，方案审 r2 P1-3）
    let key
    try { key = VCRYPTO.ensureKey(ROOT) } catch (e) { vaultErrThrow(VAULT_FC + '：vault.key 生成失败') }
    vaultKeyCache = key
    vaultCache = { items: [], updatedAt: Date.now() }
    const env = VCRYPTO.encryptVault(key, { items: [] })
    env.updatedAt = vaultCache.updatedAt
    try { vaultAtomicWrite(env) } catch (e) { vaultCache = null; vaultErrThrow(VAULT_FC + '：空库初始化写入失败') }
    return vaultCache
  }

  let j = null
  try { j = JSON.parse(raw) } catch (e) { j = null }
  if (!j || typeof j !== 'object') vaultErrThrow(VAULT_FC + '：vault.json 不是合法 JSON')

  if (VCRYPTO.isV1(j)) {
    // v1（明文）→ v2 迁移：全程同步、明文只在内存（产出审 P1-1：先写 tmp→读 tmp 校验→绿再 rename，v1 任何情况下不动）
    let key
    try { key = VCRYPTO.ensureKey(ROOT) } catch (e) { vaultErrThrow(VAULT_FC + '：迁移期 vault.key 生成失败（v1 原文件未动）') }
    let env
    try { env = VCRYPTO.encryptVault(key, { items: j.items }) } catch (e) { vaultErrThrow(VAULT_FC + '：迁移期加密失败（v1 原文件未动）') }
    env.updatedAt = Number(j.updatedAt) || Date.now()
    const tmp = VAULT_FILE + '.tmp-' + process.pid
    try {
      fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true })
      const fd = fs.openSync(tmp, 'w', 0o600)
      try { fs.writeSync(fd, JSON.stringify(env, null, 2)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      const back = VCRYPTO.decryptVault(key, JSON.parse(fs.readFileSync(tmp, 'utf8')))
      if (JSON.stringify({ items: back.items }) !== JSON.stringify({ items: j.items })) throw new Error('读回校验不等')
      fs.renameSync(tmp, VAULT_FILE)
      try { fs.chmodSync(VAULT_FILE, 0o600) } catch (e) {}
      try { VCRYPTO.syncDir(path.dirname(VAULT_FILE)) } catch (e) {}
      // 迁移成功：留一份 v2 密文备份（P2-8，防新代码 bug；密文可安全留盘）
      try { fs.writeFileSync(VAULT_FILE + '.v2bak', JSON.stringify(env, null, 2), { mode: 0o600 }) } catch (e) {}
    } catch (e) {
      try { fs.unlinkSync(tmp) } catch (e2) {}
      vaultErrThrow(VAULT_FC + '：v1→v2 迁移失败（v1 原文件未动，tmp 已清理）')
    }
    vaultKeyCache = key
    vaultCache = { items: j.items, updatedAt: env.updatedAt }
    return vaultCache
  }

  if (j.version === 2) {
    const key = VCRYPTO.loadKey(ROOT)
    if (!key) vaultErrThrow(VAULT_FC + '：vault.key 缺失/非法（v2 已存在，不自动生成新 key）')
    let payload
    try { payload = VCRYPTO.decryptVault(key, j) } catch (e) { vaultErrThrow(VAULT_FC + '：' + (e && e.message)) }
    vaultKeyCache = key
    vaultCache = { items: payload.items, updatedAt: Number(j.updatedAt) || 0 }
    return vaultCache
  }

  vaultErrThrow(VAULT_FC + '：未知 version/shape')
}

/* v2 原子写：tmp(open 0600)+write+fsync+close+rename+目录 fsync（FUSE 不支持目录 fsync 时静默——残余风险=断电丢 rename，docs 已记） */
function vaultAtomicWrite(env) {
  fs.mkdirSync(path.dirname(VAULT_FILE), { recursive: true })
  const tmp = VAULT_FILE + '.tmp-' + process.pid
  const fd = fs.openSync(tmp, 'w', 0o600)
  try { fs.writeSync(fd, JSON.stringify(env, null, 2)); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, VAULT_FILE)
  try { fs.chmodSync(VAULT_FILE, 0o600) } catch (e) {}
  try { VCRYPTO.syncDir(path.dirname(VAULT_FILE)) } catch (e) {}
}

function saveVault(v) {
  // 最后一道写闸（方案审 P0-2.④）：fail-closed 状态下一律拒写
  if (vaultError) { const e = new Error(vaultError); e.vaultFail = true; throw e }
  v.updatedAt = Date.now()
  // P1-1.③：写前重读 key 文件与缓存比对（运行中 key 被删/换 → 拒写）
  const key = VCRYPTO.loadKey(ROOT)
  if (!key) vaultErrThrow(VAULT_FC + '：vault.key 缺失/非法，拒写')
  if (vaultKeyCache && !key.equals(vaultKeyCache)) vaultErrThrow(VAULT_FC + '：vault.key 已变化（运行中不得替换 key），拒写')
  if (!vaultKeyCache) vaultKeyCache = key
  const env = VCRYPTO.encryptVault(key, { items: v.items })
  env.updatedAt = v.updatedAt
  vaultAtomicWrite(env)
}
function vaultTrim(s, n) { return String(s == null ? '' : s).slice(0, n) }
function vaultPublic(v) {
  return {
    items: v.items.slice().sort(function (a, b) { return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0) }),
    updatedAt: v.updatedAt
  }
}

// T10（巡察使启用）：开工三查附巡检摘要（只报告不修复；报告过期 60 分钟不注入，fail-open）
function bootPatrolText() {
  try {
    const j = readJson(path.join(CONFIG, 'patrol-report.json'), null)
    if (!j || !j.generatedAt) return ''
    const ts = Date.parse(j.generatedAt)
    if (!(ts > 0)) return ''
    const ageMin = Math.max(0, Math.round((Date.now() - ts) / 60000))
    if (ageMin > 60) return ''
    const s = j.summary || {}
    const bad = (j.items || []).filter(function (x) { return x.result === 'fail' || x.result === 'degraded' })
      .map(function (x) { return x.id + '(' + x.result + ')' }).slice(0, 3)
    return '【巡察使巡检（' + ageMin + ' 分钟前）：pass ' + (s.pass || 0) + ' / warn ' + (s.warn || 0) +
      ' / fail ' + (s.fail || 0) + (bad.length ? '；异常项：' + bad.join('、') + '（只报告不修复，需主人裁决）' : '；无异常') + '】'
  } catch (e) { return '' }
}
// ---- 监视台（T11）：只读聚合快照，人看右栏「监视」页签、AI 读 config/watch-state.json（同一份） ----
function tcpUp(port, cb) {
  const s = net.createConnection({ port: port, host: '127.0.0.1' })
  const done = function (ok) { try { s.destroy() } catch (e) {}; cb(ok) }
  s.setTimeout(800, function () { return done(false) })
  s.on('connect', function () { return done(true) })
  s.on('error', function () { return done(false) })
}
function readProc(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (e) { return '' }
}
function watchPayload(cb) {
  const ports = [
    { name: 'DeepSeek 中转', port: 4099 },
    { name: '智谱中转', port: 4100 },
    { name: 'deveco serve', port: 4098 },
    { name: '小DJ 网关 proxy', port: 4097 }
  ]
  let left = ports.length
  const services = []
  ports.forEach(function (p) {
    tcpUp(p.port, function (up) {
      services.push({ name: p.name, port: p.port, up: !!up })
      if (--left === 0) {
        services.sort(function (a, b) { return a.port - b.port })
        let tasksBlock = { total: 0, counts: {} }
        try {
          const der = deriveTasksCached()
          if (der.ok) {
            const ts = applyOverrides(der.tasks)
            const counts = { active: 0, quiet: 0, stalled: 0, archived: 0, held: 0 }
            ts.forEach(function (t) {
              if (t.state === 'waiting') { counts.held++; return } /* task334 P2-3：waiting 单列 held，不计入疑似中断 */
              if (counts[t.stale] != null) counts[t.stale]++
            })
            // 「在跑」= 任务口径内（inTask）且人工未判死；纯聊天根会话（step=0）不再计入
            tasksBlock = { total: ts.length, counts: counts, /* task148：停摆行(stalled)不计「在跑」 */ running: ts.filter(function (t) { return t.state === 'running' && t.inTask !== false && t.stale !== 'stalled' }).length,
              // task119：ETA 超时计数（监视台「超时 N」行数据源；明细走 /_tasks、计数走 /_watch 各司其职，无清单双写）
              etaOverdueCount: ts.filter(function (t) { return Number(t.etaOverdueMin) > 0 }).length }
          }
        } catch (e) {}
        let patrolBlock = { ok: false }
        try {
          const j = readJson(path.join(CONFIG, 'patrol-report.json'), null)
          if (j && j.generatedAt) {
            const ageMin = Math.max(0, Math.round((Date.now() - Date.parse(j.generatedAt)) / 60000))
            patrolBlock = { ok: true, ageMin: ageMin, alert: j.alert || '', summary: j.summary || {} }
          }
        } catch (e) {}
        const meminfo = readProc('/proc/meminfo')
        const memAvail = Number((/MemAvailable:\s+(\d+)/.exec(meminfo) || [])[1] || 0)
        const memTotal = Number((/MemTotal:\s+(\d+)/.exec(meminfo) || [])[1] || 0)
        const load1 = Number((/([\d.]+)\s/.exec(readProc('/proc/loadavg')) || [])[1] || 0)
        return cb({
          ok: true,
          at: new Date().toISOString(),
          services: services,
          tasks: tasksBlock,
          patrol: patrolBlock,
          res: { memAvailableMb: Math.round(memAvail / 1024), memTotalMb: Math.round(memTotal / 1024), load1: load1 }
        })
      }
    })
  })
}
const WATCH_STATE_FILE = path.join(CONFIG, 'watch-state.json')
if (!process.env.LITTLEDJ_NO_WATCH_SNAP) {
  setInterval(function () {
    try {
      watchPayload(function (p) {
        try { writeJson(WATCH_STATE_FILE, p) } catch (e) {}
      })
    } catch (e) {}
  }, 30000).unref()
}
// ---- task121：进程管理（内存面板）——只列/只关当前用户进程；小DJ 全家硬保护；kill=SIGTERM 温和关闭不追杀 ----
const PROCS_MAX = 40
const PROCS_CACHE_MS = 5000
let _procsCache = null // { at, payload }：列表 5s 缓存防连点；kill 成功即失效
const PROC_PROTECT_MATCH = ['proxy.js', 'deepseek-relay', 'zhipu-relay', 'ensure-deepseek-relay', 'cli.js serve', 'deveco serve', 'watchdog', 'start-tunnel.sh', '-R 18097'] // 御史P1-1：start-tunnel.sh 守护循环（while 重连）也是小DJ 全家，漏网即违背硬保护承诺
function procUidOf(statusText) {
  const m = /Uid:\s+(\d+)/.exec(statusText || '')
  return m ? Number(m[1]) : null
}
function procProtected(pid, cmdline) {
  if (pid === process.pid) return true
  const s = String(cmdline || '').split('\0').join(' ') // 御史P1-A：cmdline 以 \0 分隔 argv，indexOf 带空格特征（cli.js serve 等）必须先归一成空格，否则结构性永不命中（两轮漏网实测血泪）
  for (let i = 0; i < PROC_PROTECT_MATCH.length; i++) { if (s.indexOf(PROC_PROTECT_MATCH[i]) >= 0) return true }
  return false
}
function procsListPayload(force) {
  const now = Date.now()
  if (!force && _procsCache && now - _procsCache.at < PROCS_CACHE_MS) return _procsCache.payload
  const myUid = process.getuid()
  const procs = []
  let sumMb = 0
  let ids = []
  try { ids = fs.readdirSync('/proc') } catch (e) {}
  ids.forEach(function (id) {
    if (!/^[0-9]+$/.test(id)) return
    const dir = '/proc/' + id
    const status = readProc(dir + '/status')
    if (!status) return
    if (procUidOf(status) !== myUid) return // 只列当前用户；系统/他人/内核线程天然隐藏
    const cmdline = readProc(dir + '/cmdline')
    if (!cmdline) return // 读不到 cmdline（权限/已退出）不列，不编数据
    const statm = readProc(dir + '/statm')
    const rssPages = Number((/^\d+\s+(\d+)/.exec(statm.trim()) || [])[1] || 0)
    const argv = cmdline.split('\0').filter(Boolean)
    const name = (argv.slice(0, 3).join(' ') || '').slice(0, 120)
    if (!name) return
    const rssMb = Math.round(rssPages * 4096 / 1048576 * 10) / 10
    sumMb += rssMb
    procs.push({ pid: Number(id), name: name, rssMb: rssMb, prot: procProtected(Number(id), cmdline) })
  })
  procs.sort(function (a, b) { return b.rssMb - a.rssMb })
  const payload = { ok: true, me: process.pid, ts: new Date().toISOString(), total: procs.length, sumMb: Math.round(sumMb * 10) / 10, procs: procs.slice(0, PROCS_MAX) }
  _procsCache = { at: now, payload: payload }
  return payload
}
function procsKillPayload(d) {
  const pid = Number(d && d.pid)
  if (!Number.isInteger(pid) || pid <= 0) return { code: 400, body: { ok: false, error: '进程号不合法' } }
  if (pid === process.pid) return { code: 403, body: { ok: false, error: '这是小DJ 网关自己，已保护不可关闭' } }
  const status = readProc('/proc/' + pid + '/status') // kill 前重读复核（防 pid 复用）
  if (!status) return { code: 404, body: { ok: false, error: '进程已退出（可能刚被关闭）' } }
  if (procUidOf(status) !== process.getuid()) return { code: 403, body: { ok: false, error: '只能关闭您自己用户名下的进程' } }
  if (procProtected(pid, readProc('/proc/' + pid + '/cmdline'))) return { code: 403, body: { ok: false, error: '小DJ 服务进程已保护，不可在这里关闭（serve/中转/watchdog/隧道）' } }
  try {
    process.kill(pid, 'SIGTERM')
    _procsCache = null
    return { code: 200, body: { ok: true, sent: 'SIGTERM' } }
  } catch (e) {
    if (e && e.code === 'ESRCH') return { code: 404, body: { ok: false, error: '进程已退出（可能刚被关闭）' } }
    if (e && e.code === 'EPERM') return { code: 403, body: { ok: false, error: '系统拒绝：权限不足（可能不是您的进程）' } }
    return { code: 500, body: { ok: false, error: '关闭失败：' + (e && e.message) } }
  }
}

// ---- 跨沙箱域重启 serve（★2026-11-08）----
// 背景：桌面双击脚本跑在 HiShell 域（uid 20020100），serve 由 AI 会话域的 watchdog 拉起（uid 20020192），
//      PID 命名空间隔离 → 桌面 ps 看不到、kill 不到，端口被占只能 ABORT（假失败）。
// 修法：网关与 serve 同域，由网关代劳「杀+等 watchdog 拉活」，桌面脚本改调本端点。
function findServePids(port) {
  const out = []
  const myUid = process.getuid()
  let ids = []
  try { ids = fs.readdirSync('/proc') } catch (e) {}
  ids.forEach(function (id) {
    if (!/^[0-9]+$/.test(id)) return
    const status = readProc('/proc/' + id + '/status')
    if (!status) return
    if (procUidOf(status) !== myUid) return
    const raw = readProc('/proc/' + id + '/cmdline')
    if (!raw) return
    const argv = raw.split('\0').filter(Boolean)
    if (!argv.length) return
    // ⚠自伤血泪（2026-11-08 实测）：只按 cmdline 子串匹配会把「命令行里恰好含 serve --port N 的任意进程」
    // （grep/编辑器/测试命令自身）一起杀掉——必须先认可执行文件，只匹配 node/deveco。
    const base = path.basename(argv[0])
    if (base !== 'node' && base !== 'deveco') return
    const joined = argv.join(' ')
    if (joined.indexOf('serve --port ' + port) < 0) return
    if (joined.indexOf('proxy.js') >= 0) return
    out.push(Number(id))
  })
  return out
}
function serveHealth(cb) {
  // task166 P1-1：单飞守卫——旧写法 timeout 分支先 cb 后 destroy()，destroy 触发 error 事件第二
  // 次回调（实测 2 次），会破坏 /_serve/restart 的 tick 轮询状态机（setTimeout 翻倍）
  let done = false
  const finish = function (up, code) { if (done) return; done = true; cb(up, code) }
  const rq = http.get({ host: '127.0.0.1', port: BACKEND.port, path: '/health', timeout: 3000 }, function (r) {
    r.resume()
    finish(true, r.statusCode)
  })
  rq.on('error', function () { finish(false, 0) })
  rq.on('timeout', function () { rq.destroy(); finish(false, 0) })
}
function spawnServe() {
  const bin = process.env.HOME ? process.env.HOME + '/npm/bin/deveco' : '/storage/Users/currentUser/npm/bin/deveco'
  const exe = fs.existsSync(bin) ? bin : 'deveco'
  const logf = path.join(ROOT, 'logs', 'serve.log')
  let out = 'ignore'
  try { out = fs.openSync(logf, 'a') } catch (e) {}
  try {
    const c = spawn(exe, ['serve', '--port', String(BACKEND.port), '--hostname', '127.0.0.1'], { detached: true, stdio: ['ignore', out, out] })
    c.unref()
    return true
  } catch (e) { return false }
}
function serveRestartPayload(cb) {
  const port = BACKEND.port
  const oldPids = findServePids(port)
  const t0 = Date.now()
  let spawned = false
  if (!oldPids.length) {
    return serveHealth(function (up) {
      if (up) return cb({ code: 409, body: { ok: false, error: '本沙箱域看不到 serve 进程（跨域运行），无法代为重启', hint: '请重启整机后双击桌面「启动小DJ」把全家搬回同一域' } })
      cb({ code: 500, body: { ok: false, error: '本沙箱域看不到 serve 进程，且端口 4098 无响应' } })
    })
  }
  oldPids.forEach(function (p) { try { process.kill(p, 'SIGTERM') } catch (e) {} })
  // task134 补口（2026-11-09 实测事故）：主动重启路径不经过任何 API 失败回调，
  // 旧版只挂 busy 不置宕机 → 打断纪元永不触发、主人新消息被拦成队列、前端无限转圈。
  // 杀进程即置位收口（清忙 + 记 queueKilledAt，前端 3s 轮询可见）；恢复清位由 queueTick 探测闭环负责。
  backendMarkDown()
  _procsCache = null
  let phase = 'down' // down=等旧实例掉线；up=等新实例恢复
  let downAt = 0
  const tick = function () {
    serveHealth(function (up) {
      const ms = Date.now() - t0
      if (phase === 'down') {
        if (!up) {
          phase = 'up'
          downAt = Date.now()
        } else if (ms > 25000) {
          return cb({ code: 500, body: { ok: false, error: '旧 serve 25s 仍未退出（端口仍被占）', oldPids: oldPids } })
        }
      } else {
        if (up) {
          return cb({ code: 200, body: { ok: true, oldPids: oldPids, newPids: findServePids(port), ms: ms, downMs: Date.now() - downAt, spawned: spawned } })
        }
        if (!spawned && Date.now() - downAt > 30000) { // watchdog 未拉活 → 网关自起兜底
          spawned = true
          spawnServe()
        }
        if (ms > 75000) {
          return cb({ code: 500, body: { ok: false, error: 'serve 已停但 75s 内未恢复（watchdog 未拉起且自起失败）' } })
        }
      }
      setTimeout(tick, 2000)
    })
  }
  setTimeout(tick, 1500)
}

// GET /_tasks 响应体（纯函数，HTTP 层只转发；便于无监听单测）
function tasksGetPayload(dbPath) {
  const der = deriveTasksCached(dbPath)
  if (!der.ok) {
    return {
      code: 200,
      body: {
        ok: false, degraded: true, source: 'derived',
        reason: der.reason, hint: der.hint,
        staleRules: TASK_STALE_RULES, tasks: [], etas: {}
      }
    }
  }
  const tasks = applyOverrides(der.tasks)
  tasksAttachLastText(tasks) // task126 F5'：末条消息摘要（缓存同步读+后台预热）
  const counts = { active: 0, quiet: 0, stalled: 0, archived: 0, held: 0 }
  tasks.forEach(function (t) {
    if (t.state === 'waiting') { counts.held++; return } /* task334 P2-3：waiting 单列 held（与 watch/patrol 同口径） */
    if (counts[t.stale] != null) counts[t.stale]++
  })
  return {
    code: 200,
    body: {
      ok: true, source: 'derived', staleRules: TASK_STALE_RULES,
      total: tasks.length, counts: counts, tasks: tasks, etas: etaMapOf(tasks)
    }
  }
}

// task126 F5'：仅对任务口径内 running 行附 runner 末条消息摘要（同步读缓存；响应后后台预热，30s 刷新）
function tasksAttachLastText(tasks) {
  const act = (Array.isArray(tasks) ? tasks : []).filter(function (t) {
    return t.state === 'running' && t.inTask !== false && t.runnerSession
  })
  act.forEach(function (t) { t.lastEventText = lastEventTextOf(t.runnerSession) })
  lastEventTextWarm(act.map(function (t) { return t.runnerSession }))
}

// task119 P1-2：/_tasks 尾部 eta 映射（按子会话 id 索引）——未挂到任何行的 eta 条目（live-only 子会话）照常输出，
// 但 overdueMin 只对能 join 到「任务口径内 running 行」的条目计算（与行内/patrol/boot 同一谓词），join 不到恒 0——
// 已完成/被弃子会话的 eta 永久超时误报防线。
function etaMapOf(tasks) {
  const map = loadOverrides().overrides || {}
  const rowByRunner = {}
  ;(Array.isArray(tasks) ? tasks : []).forEach(function (t) { if (t.runnerSession) rowByRunner[t.runnerSession] = t })
  const now = Date.now()
  const etas = {}
  Object.keys(map).forEach(function (sid) {
    const e = map[sid] && map[sid].eta
    if (!e || !(Number(e.minutes) > 0)) return
    const t = rowByRunner[sid]
    const running = !!(t && t.inTask !== false && t.state === 'running')
    const dl = (Number(e.setAt) || 0) + Number(e.minutes) * 60000
    etas[sid] = {
      minutes: Number(e.minutes) || 0,
      deadline: dl,
      overdueMin: (running && dl > 0 && now >= dl) ? Math.floor((now - dl) / 60000) : 0,
      role: String(e.role || ''),
      title: String(e.title || ''),
      rootId: String(e.rootId || '') // task126 F1'：UI 按根聚合角色级 ETA 链明细用
    }
  })
  return etas
}

// ---- task119 合并单：任务有效时间统计（只读聚合，效率面板数据源） ----
// 口径（方案稿 §二+§8.2/§9 终版）：
//   样本 = 近 14 天 state==='done'（按 overrideAt 归天；interrupted 单列且仅 inTask!==false，archived 僵尸不计）
//   t0 = 该任务全部后代子会话最早 tc（真派单起点；无后代防御回退根 created，UI 标 t≈）
//   T = done.at − t0；T>48h 记 excluded（跨周末挂起失真样本）
//   A = 后代区间 [tc,tu] 并集 ∩ [t0,done.at]，再 min(A,T)（P1-2 下钳：子会话晚于 done.at 的尾巴不外溢）
//   K = 事件旁路扫描式配对：唯一开区间，interrupt 已有开区间则忽略，reopen|done 收口累加；K 上钳 T−A
//   W = T − A − K（下钳 0；含等主人/排队/挂起过夜——v1 不细分，口径小字明示）
//   角色 = 会话跨度均值（tu−tc 直接均值，含挂起，标题写死与 A 并集口径显式区分——P1-8）
function dayKeyOf(ms) {
  const d = new Date(Number(ms))
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// 纯函数：连续 interrupt 只计一段（P1-B 第六断言）；孤立 reopen/done 忽略；区间一律 ∩ [t0,end]
function stuckMsOf(events, t0, end) {
  let openAt = 0
  let sum = 0
  ;(Array.isArray(events) ? events : []).forEach(function (e) {
    const at = Number(e && e.at) || 0
    if (e && e.op === 'interrupt') {
      if (!openAt) openAt = at // 已有开区间则忽略（保守不重置）
    } else if ((e && e.op === 'reopen') || (e && e.op === 'done')) {
      if (openAt) {
        const a = Math.max(openAt, t0)
        const b = Math.min(at, end)
        if (b > a) sum += b - a
        openAt = 0
      }
    }
  })
  return sum
}

// 区间并集总长（区间先钳 [t0,end] 再排序合并；tu<tc 规范化为零长）
function unionMsOf(desc, t0, end) {
  const ivs = (Array.isArray(desc) ? desc : [])
    .map(function (d) {
      const a = Math.max(Number(d && d.tc) || 0, t0)
      const b = Math.min(Math.max(Number(d && d.tu) || 0, Number(d && d.tc) || 0), end)
      return b > a ? [a, b] : null
    })
    .filter(Boolean)
    .sort(function (x, y) { return x[0] - y[0] })
  let sum = 0
  let cur = null
  ivs.forEach(function (iv) {
    if (cur && iv[0] <= cur[1]) { if (iv[1] > cur[1]) cur[1] = iv[1] }
    else { if (cur) sum += cur[1] - cur[0]; cur = iv }
  })
  if (cur) sum += cur[1] - cur[0]
  return sum
}

// 纯函数聚合（module.exports 供单测）：tasks=applyOverrides 后的派生行
function taskStatsOf(tasks, eventsByRoot, descByRoot, nowMs) {
  const DAY_MS = 24 * 3600 * 1000
  const now = Number(nowMs) || Date.now()
  const winStart = now - 14 * DAY_MS
  const T_MAX_MS = 48 * 3600 * 1000
  const days = []
  for (let i = 13; i >= 0; i--) {
    const d = { date: dayKeyOf(now - i * DAY_MS), done: 0, totalMin: 0, activeMin: 0, waitMin: 0, stuckMin: 0 }
    days.push(d)
  }
  const byDate = {}
  days.forEach(function (d) { byDate[d.date] = d })
  const overall = { done: 0, excluded: 0, interrupted: 0, totalMin: 0, activeMin: 0, waitMin: 0, stuckMin: 0 }
  const roleAgg = {}
  let tApprox = 0
  ;(Array.isArray(tasks) ? tasks : []).forEach(function (t) {
    if (!t) return
    const doneAt = Number(t.overrideAt) || 0
    // task126 F4'：批量迁移标记样本剔除（at 聚簇回填 migrated；不计 done/interrupted/excluded，单列 migratedSkip）
    if (t.overrideMigrated && (t.state === 'done' || t.state === 'interrupted')) {
      overall.migratedSkip = (Number(overall.migratedSkip) || 0) + 1
      return
    }
    if (t.state === 'interrupted') {
      if (t.inTask !== false && doneAt >= winStart) overall.interrupted++
      return
    }
    if (t.state !== 'done' || doneAt < winStart) return
    const desc = descByRoot[t.id] || []
    let t0 = desc.length ? Math.min.apply(null, desc.map(function (d) { return Number(d.tc) || 0 })) : (Number(t.timeCreated) || 0)
    if (!desc.length) tApprox++
    const T = doneAt - t0
    if (!(T > 0) || T > T_MAX_MS) { overall.excluded++; return }
    const aRaw = unionMsOf(desc, t0, doneAt)
    const A = Math.min(aRaw, T)
    let K = stuckMsOf(eventsByRoot[t.id] || [], t0, doneAt)
    if (K > T - A) K = Math.max(T - A, 0)
    const W = Math.max(T - A - K, 0)
    const dk = dayKeyOf(doneAt)
    if (byDate[dk]) {
      const d = byDate[dk]
      d.done++
      d.totalMin += T / 60000
      d.activeMin += A / 60000
      d.waitMin += W / 60000
      d.stuckMin += K / 60000
    }
    overall.done++
    overall.totalMin += T / 60000
    overall.activeMin += A / 60000
    overall.waitMin += W / 60000
    overall.stuckMin += K / 60000
    desc.forEach(function (d) {
      const r = String(d.agent || '')
      if (!r) return
      if (!roleAgg[r]) roleAgg[r] = { role: r, count: 0, spanMin: 0 }
      roleAgg[r].count++
      roleAgg[r].spanMin += (Number(d.tu) || Number(d.tc) || 0) - (Number(d.tc) || 0) > 0
        ? ((Number(d.tu) || 0) - (Number(d.tc) || 0)) / 60000 : 0
    })
  })
  days.forEach(function (d) {
    if (d.done > 0) {
      d.avgTotalMin = Math.round(d.totalMin / d.done)
      d.avgActiveMin = Math.round(d.activeMin / d.done)
      d.avgWaitMin = Math.round(d.waitMin / d.done)
      d.avgStuckMin = Math.round(d.stuckMin / d.done)
    } else {
      d.avgTotalMin = d.avgActiveMin = d.avgWaitMin = d.avgStuckMin = 0
    }
    delete d.totalMin; delete d.activeMin; delete d.waitMin; delete d.stuckMin
  })
  if (overall.done > 0) {
    overall.avgTotalMin = Math.round(overall.totalMin / overall.done)
    overall.avgActiveMin = Math.round(overall.activeMin / overall.done)
    overall.avgWaitMin = Math.round(overall.waitMin / overall.done)
    overall.avgStuckMin = Math.round(overall.stuckMin / overall.done)
  } else {
    overall.avgTotalMin = overall.avgActiveMin = overall.avgWaitMin = overall.avgStuckMin = 0
  }
  delete overall.totalMin; delete overall.activeMin; delete overall.waitMin; delete overall.stuckMin
  const roles = Object.keys(roleAgg).map(function (k) {
    const r = roleAgg[k]
    return { role: r.role, count: r.count, avgSpanMin: Math.round(r.spanMin / Math.max(r.count, 1)) }
  }).sort(function (a, b) { return b.count - a.count }).slice(0, 6)
  return { days: days, overall: overall, roles: roles, tApprox: tApprox }
}

// 事件旁路全量读取（文件自带 512KB 滚动，量小；坏行跳过不整体失败）
function readTaskEventsByRoot() {
  const byRoot = {}
  try {
    const raw = fs.readFileSync(TASK_EVENTS_FILE, 'utf8')
    raw.split('\n').forEach(function (l) {
      if (!l.trim()) return
      try {
        const e = JSON.parse(l)
        if (e && e.sid && e.at) (byRoot[e.sid] = byRoot[e.sid] || []).push({ op: String(e.op || ''), at: Number(e.at) || 0 })
      } catch (err) { /* 坏行跳过 */ }
    })
  } catch (e) { /* 无文件=零事件，正常 */ }
  Object.keys(byRoot).forEach(function (k) { byRoot[k].sort(function (a, b) { return a.at - b.at }) })
  return byRoot
}

// GET /_taskstats（只读；60s 单键缓存；面板打开才拉——低频路径走同步派生先例 2718）
const TASK_STATS_WINDOW_DAYS = 14
let taskStatsCache = null // { at, payload }
function taskStatsGetPayload() {
  if (taskStatsCache && Date.now() - taskStatsCache.at < 60000) {
    return { code: 200, body: taskStatsCache.payload }
  }
  const der = deriveTasksSafe()
  if (!der || !der.ok) {
    return { code: 503, body: { ok: false, degraded: true, error: (der && der.hint) || '任务派生暂不可用，稍后自动重试' } }
  }
  const tasks = applyOverrides(der.tasks)
  const winStart = Date.now() - TASK_STATS_WINDOW_DAYS * 24 * 3600 * 1000
  const doneRoots = tasks.filter(function (t) { return t.state === 'done' && (Number(t.overrideAt) || 0) >= winStart })
    .map(function (t) { return t.id })
  const descByRoot = {}
  let truncated = false
  for (let i = 0; i < doneRoots.length; i += 50) { // 分批 ≤50（SQLite 变量上限保守 999）
    const r = TD.deriveDescendantsOf(null, doneRoots.slice(i, i + 50), winStart - 48 * 3600 * 1000)
    if (r && r.ok) {
      r.rows.forEach(function (row) { (descByRoot[row.root] = descByRoot[row.root] || []).push(row) })
      if (r.truncated) truncated = true
    }
  }
  const stats = taskStatsOf(tasks, readTaskEventsByRoot(), descByRoot, Date.now())
  const body = { ok: true, generatedAt: Date.now(), days: TASK_STATS_WINDOW_DAYS, stats: stats, truncated: truncated }
  taskStatsCache = { at: Date.now(), payload: body }
  return { code: 200, body: body }
}

// ---- 会话上下文占用映射（task189）：只读 deveco.db，每会话取最近一条「有值」assistant ----
// 口径与 ui/index.html updateUsage 同构：used = tokens.input + tokens.cache.read + tokens.output
// （上下文实读入 + 本轮输出）；窗口分母由前端按该会话 providerID/modelID 匹配，服务端只回 used。
const CTX_MAP_WINDOW_MS = 3 * 24 * 3600 * 1000 // 覆盖窗=近 3 天（实测 13206 行 / 664ms）
const CTX_MAP_OVERLAP_MS = 2 * 3600 * 1000 // 增量 overlap（对齐 USAGE_OVERLAP_MS）
const CTX_MAP_MAX_ROWS = 60000 // 窗内行数护栏：超限收窄到 1 天（库增长防卡顿）
const CTX_MAP_NARROW_MS = 24 * 3600 * 1000
const CTX_MAP_SQL = "SELECT session_id AS sid, time_created AS tc, json_extract(data,'$.role') AS rl, json_extract(data,'$.tokens.input') AS ti, json_extract(data,'$.tokens.output') AS tout, json_extract(data,'$.tokens.cache.read') AS tcr, json_extract(data,'$.providerID') AS p, json_extract(data,'$.modelID') AS m FROM message WHERE time_created >= ?"
let ctxMapCache = null // { map:{sid:{u,tc,p,m}}, maxTc, at, from, narrowed }

// 单行取值：仅 assistant 且 prompt(input+cache.read)>0（与 updateUsage 判据严格同构）；
// 无值行返回 null——聚合时跳过，某会话最近一条无值则沿用更早有效值（防中断消息吞掉显示）
function ctxRowValue(r) {
  if (!r || r.rl !== 'assistant') return null
  const prompt = (r.ti || 0) + (r.tcr || 0)
  if (prompt <= 0) return null
  return { u: prompt + (r.tout || 0), tc: r.tc || 0, p: r.p || '', m: r.m || '' }
}
function ctxMapAbsorb(map, rows) {
  let maxTc = 0
  rows.forEach(function (r) {
    if ((r.tc || 0) > maxTc) maxTc = r.tc || 0
    const v = ctxRowValue(r)
    if (!v) return
    const cur = map[r.sid]
    if (!cur || v.tc >= cur.tc) map[r.sid] = v
  })
  return maxTc
}
// 窗口边界维护（方案审 P1-1 定死）：每次增量同轮剔除滑出 4 天硬边界（3 天窗 + 1h 缓冲防悬浮删建）的键
function ctxMapPrune(map, now) {
  const floor = now - CTX_MAP_WINDOW_MS - 3600000
  Object.keys(map).forEach(function (sid) {
    if (((map[sid] || {}).tc || 0) < floor) delete map[sid]
  })
}
// 缓存语义（P1-1）：首次全量扫 3 天窗；之后 60s 最小间隔做增量（非 TTL 过期重扫）；
// 增量异常 → 缓存置空，下次请求全量重建（失败兜底）
function ctxMapPayload() {
  const now = Date.now()
  try {
    if (!ctxMapCache) {
      const db = usageDbOpen()
      let from = now - CTX_MAP_WINDOW_MS, narrowed = false, rows
      try {
        rows = db.prepare(CTX_MAP_SQL).all(from)
        if (rows.length > CTX_MAP_MAX_ROWS) {
          from = now - CTX_MAP_NARROW_MS; narrowed = true
          rows = db.prepare(CTX_MAP_SQL).all(from)
        }
      } finally { try { db.close() } catch (e) {} }
      const map = {}
      const maxTc = ctxMapAbsorb(map, rows)
      ctxMapCache = { map: map, maxTc: maxTc, at: Date.now(), from: from, narrowed: narrowed }
    } else if (now - ctxMapCache.at >= 60000) {
      const db = usageDbOpen()
      let rows
      try {
        rows = db.prepare(CTX_MAP_SQL).all(Math.max(0, (ctxMapCache.maxTc || now) - CTX_MAP_OVERLAP_MS))
      } finally { try { db.close() } catch (e) {} }
      const mt = ctxMapAbsorb(ctxMapCache.map, rows)
      if (mt > (ctxMapCache.maxTc || 0)) ctxMapCache.maxTc = mt
      ctxMapPrune(ctxMapCache.map, now)
      ctxMapCache.at = Date.now()
    }
    return { ok: true, builtAt: ctxMapCache.at, from: ctxMapCache.from, narrowed: !!ctxMapCache.narrowed, count: Object.keys(ctxMapCache.map).length, map: ctxMapCache.map }
  } catch (e) {
    ctxMapCache = null
    return { ok: false, error: '上下文映射暂不可用：' + ((e && e.message) || e) }
  }
}

// POST/PUT /_tasks 响应体（同 GET：纯函数）；op 校验全部交给 saveOverrideOp，旧 schema 只回提示不落盘
function taskOpPayload(body, dbPath) {
  if (isLegacyTaskUpsert(body)) {
    return {
      code: 200,
      body: { ok: true, deprecated: true, note: '台账已从 serve 库只读派生，upsert 已退役；人工确认请用 {sessionId, op}' }
    }
  }
  // task119：op='eta' 提前分支——豁免派生双闸（knownIds 校验与派生降级拒绝）。
  // 理由：eta 挂子会话 id（不在根派生清单）；派单瞬间子会话落库有毫秒级竞态；eta 写入不消费派生数据；写失败不阻断派单可后补。
  if (body && typeof body === 'object' && String(body.op || '') === 'eta') {
    const re = saveOverrideOp(body, null)
    if (!re.ok) return { code: re.code || 400, body: { ok: false, error: re.error } }
    return {
      code: 200,
      body: { ok: true, sessionId: re.sessionId, op: 'eta', eta: re.eta || null, cleared: re.cleared || 0, pruned: re.pruned || 0 }
    }
  }
  const der = deriveTasksSafe(dbPath)
  if (!der.ok) {
    // 派生降级时无法校验「会话是否存在」，宁可不写
    return {
      code: 200,
      body: { ok: false, degraded: true, reason: der.reason, hint: der.hint, error: '任务台账暂不可用（派生降级），本次未写入' }
    }
  }
  const known = new Set(der.tasks.map(function (t) { return t.id }))
  // task119：state 三 op 连带删——从派生清单反查该根行 runnerSession，落库时连带清其 eta（反查不到行/无 runner 则跳过连带）
  const row = der.tasks.filter(function (t) { return t.id === String((body && body.sessionId) || '') })[0]
  const runnerSid = (row && row.runnerSession) || ''
  const r = saveOverrideOp(body, known, runnerSid)
  if (!r.ok) return { code: r.code || 400, body: { ok: false, error: r.error, ahead: r.ahead } }
  return { code: 200, body: { ok: true, sessionId: r.sessionId, op: r.op, override: r.override, etaCleared: r.etaCleared || 0, position: r.position, force: r.force, skippedAhead: r.skippedAhead } }
}

// ---- 批量取消子代理（task79 S2a）：POST /_tasks/abort-all（UI 走 /api 前缀） ----
// 枚举只读 deveco.db session 表（24h 窗与 task-derive archived 同源；不查 message 大表）；
// 真实模式逐项 POST 后端 abort 并留痕；dryRun=1 只预览枚举结果，不 abort、不写审计。
const CANCEL_AUDIT_FILE = path.join(CONFIG, 'cancel-audit.jsonl')
const CANCEL_AUDIT_REL = 'config/cancel-audit.jsonl'
const TASKQUEUE_DIR = path.join(__dirname, '..', '.taskqueue')
const CANCEL_WINDOW_MS = TASK_STALE_MS.archived
const CANCEL_CONCURRENCY = 4
const CANCEL_ABORT_TIMEOUT_MS = 5000

function cancelIso(ms) {
  const t = Number(ms) || 0
  return t > 0 ? new Date(t).toISOString() : ''
}

function cancelTimeText(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + restPad(d.getMonth() + 1) + '-' + restPad(d.getDate()) + ' ' +
    restPad(d.getHours()) + ':' + restPad(d.getMinutes())
}

// 沿 parent_id 上溯到根会话（防环：最多 32 层；父会话不在表内即视为根）
function cancelRootOf(parents, sid, immediateParent) {
  let cur = immediateParent || ''
  if (!cur) return sid
  let guard = 0
  while (cur && guard++ < 32) {
    const up = parents.get(cur)
    if (up == null) return cur
    cur = up
  }
  return cur || immediateParent || sid
}

// 只读枚举 + 父链表；schema 缺可选列（agent/title）时降级为空串而不是整体失败
function cancelScan() {
  let db
  try {
    db = taskDbOpen()
  } catch (e) {
    return { ok: false, reason: (e && e.reason) || 'db-unavailable', hint: '暂时读不到 deveco 会话库，无法枚举子代理' }
  }
  try {
    let cols = []
    try { cols = db.prepare('PRAGMA table_info(session)').all().map(function (r) { return String(r.name) }) } catch (e) { cols = [] }
    const has = function (c) { return cols.indexOf(c) >= 0 }
    const sql = 'SELECT id, parent_id, time_updated' +
      (has('agent') ? ', agent' : ", '' AS agent") +
      (has('title') ? ', title' : ", '' AS title") +
      ' FROM session WHERE parent_id IS NOT NULL AND time_updated > ?'
    const rows = db.prepare(sql).all(Date.now() - CANCEL_WINDOW_MS)
    const parents = new Map()
    try {
      db.prepare('SELECT id, parent_id FROM session').all().forEach(function (r) {
        parents.set(String(r.id || ''), r.parent_id == null ? null : String(r.parent_id))
      })
    } catch (e) { /* 父链不可得时 rootId 退回直接父会话 */ }
    const items = rows.map(function (r) {
      const sid = String(r.id || '')
      const pid = r.parent_id == null ? '' : String(r.parent_id)
      return {
        sessionId: sid,
        rootId: cancelRootOf(parents, sid, pid),
        agent: String(r.agent || ''),
        title: String(r.title || ''),
        lastActive: Number(r.time_updated) || 0
      }
    })
    return { ok: true, items: items, parents: parents }
  } catch (e) {
    return { ok: false, reason: 'db-unavailable', hint: '读取会话库失败：' + String((e && e.message) || e) }
  } finally {
    try { db.close() } catch (e) {}
  }
}

// 单项 abort：2xx=aborted；404/410=already-finished（幂等无害）；其余与不可达=failed
function cancelAbortOne(sid, cb) {
  let done = false
  const finish = function (r) { if (done) return; done = true; cb(r) }
  let preq = null
  try {
    preq = http.request({
      host: BACKEND.host, port: BACKEND.port, method: 'POST',
      path: '/session/' + encodeURIComponent(sid) + '/abort',
      headers: { authorization: AUTH_EXPECT, 'content-type': 'application/json', 'content-length': 2 }
    }, function (pres) {
      pres.resume()
      pres.on('end', function () {
        const code = pres.statusCode || 0
        const result = (code >= 200 && code < 300) ? 'aborted'
          : (code === 404 || code === 410) ? 'already-finished' : 'failed'
        finish({ result: result, httpStatus: code })
      })
      pres.on('error', function () { finish({ result: 'failed', httpStatus: 0 }) })
    })
  } catch (e) {
    return finish({ result: 'failed', httpStatus: 0 })
  }
  preq.setTimeout(CANCEL_ABORT_TIMEOUT_MS, function () { try { preq.destroy(new Error('timeout')) } catch (e) {} })
  preq.on('error', function () { finish({ result: 'failed', httpStatus: 0 }) })
  preq.end('{}')
}

// 并发上限 4 的批量 abort；结果顺序与入参一致
function cancelRunBatch(items, cb) {
  const out = new Array(items.length)
  if (!items.length) return cb(out)
  let next = 0, running = 0, finished = 0
  const pump = function () {
    while (running < CANCEL_CONCURRENCY && next < items.length) {
      const i = next++
      running++
      cancelAbortOne(items[i].sessionId, function (r) {
        out[i] = { item: items[i], result: r.result, httpStatus: r.httpStatus }
        running--
        finished++
        if (finished === items.length) return cb(out)
        pump()
      })
    }
  }
  pump()
}

// 审计（权威层）：一次请求一行，0600；失败只 stderr 一行，不阻断响应
function cancelAuditAppend(rec) {
  try {
    fs.appendFileSync(CANCEL_AUDIT_FILE, JSON.stringify(rec) + '\n', { mode: 0o600 })
    // 文件已存在且模式非 0600 时修正（本机 FUSE 可能回落到 0660，如实记录不强改）
    try { fs.chmodSync(CANCEL_AUDIT_FILE, 0o600) } catch (e) {}
  } catch (e) {
    console.error('[cancel] 审计追加失败 code=' + ((e && e.code) || 'unknown'))
  }
}

// 根会话步数：优先派生层 step；派生降级时退回直接数子会话（同源同口径）
function cancelStepOf(parents) {
  const known = new Map()
  const der = deriveTasksSafe()
  if (der && der.ok) der.tasks.forEach(function (t) { known.set(String(t.id), Number(t.step) || 0) })
  return function (rid) {
    if (known.has(rid)) return known.get(rid)
    let n = 0
    parents.forEach(function (p) { if (p === rid) n++ })
    return n
  }
}

// 牌 md 事件行（尽力层）：按 rootId 扫 .taskqueue/*.md；同请求按绝对路径去重每牌一行；失败静默
function cancelBoardAppend(trigger, rows, stepOf) {
  const groups = new Map()
  rows.forEach(function (r) {
    const rid = r.item.rootId
    if (!rid) return
    let g = groups.get(rid)
    if (!g) { g = { aborted: 0, already: 0, failed: 0 }; groups.set(rid, g) }
    if (r.result === 'aborted') g.aborted++
    else if (r.result === 'already-finished') g.already++
    else g.failed++
  })
  let files = []
  try { files = fs.readdirSync(TASKQUEUE_DIR) } catch (e) { return }
  const when = cancelTimeText(Date.now())
  const written = new Set()
  files.forEach(function (f) {
    if (!/\.md$/.test(f)) return
    const abs = path.join(TASKQUEUE_DIR, f)
    if (written.has(abs)) return
    let text = ''
    try { text = fs.readFileSync(abs, 'utf8') } catch (e) { return }
    const hit = []
    groups.forEach(function (g, rid) { if (text.indexOf(rid) >= 0) hit.push({ g: g, rid: rid }) })
    if (!hit.length) return
    const sum = { aborted: 0, already: 0, failed: 0 }
    hit.forEach(function (h) { sum.aborted += h.g.aborted; sum.already += h.g.already; sum.failed += h.g.failed })
    const n = sum.aborted + sum.already + sum.failed
    const steps = hit.map(function (h) { return String(stepOf(h.rid)) })
    const line = '- [取消事件·自动] ' + when + ' · 触发=' + trigger + ' · 停止子代理 ' + n +
      ' 个(成功' + sum.aborted + '/已结束' + sum.already + '/失败' + sum.failed + ')' +
      ' · 取消时根会话步数=' + steps.join('/') + ' · 明细 ' + CANCEL_AUDIT_REL
    written.add(abs)
    try {
      // 末字符非换行先补，避免与原文粘连
      const prefix = (text.length && text.charAt(text.length - 1) !== '\n') ? '\n' : ''
      fs.appendFileSync(abs, prefix + line + '\n', { flag: 'a' })
    } catch (e) { /* 静默：jsonl 权威层已兜底 */ }
  })
}

// POST /_tasks/abort-all（UI 走 /api 前缀）。dryRun=1 或 body {dryRun:true} 只预览：
// 清单含 willCancel，不 abort、不写审计；此时 attempted 为「将会尝试」的候选数。
function handleAbortAll(req, res, urlObj) {
  return readBody(req, function (err, raw) {
    // task167 加固：坏 body/超限时拒绝执行（原逻辑降级空 body 会以 dryRun=false 真跑批量 abort）
    if (err) return json(res, err.code === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: err.code === 'BODY_TOO_LARGE' ? '请求体过大' : '请求格式不对（JSON 解析失败）' })
    const d = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {}
    const dryRun = urlObj.searchParams.get('dryRun') === '1' || d.dryRun === true
    const trigger = d.trigger === 'ui' ? 'ui' : 'api'
    // 调用方 sid：优先 x-session-id 头，其次 callerSessionId（body / query）；用于防自噬
    const hdrSid = String(req.headers['x-session-id'] || '').trim()
    const callerSid = hdrSid || String(d.callerSessionId || urlObj.searchParams.get('callerSessionId') || '').trim()
    const scan = cancelScan()
    if (!scan.ok) {
      return json(res, 200, {
        ok: false, degraded: true, reason: scan.reason, hint: scan.hint,
        dryRun: dryRun, attempted: 0, excluded_self: null, results: [], auditFile: CANCEL_AUDIT_REL
      })
    }
    // P1-1：停止全部 → 所有非空队列先挂出队（先于 abort，避免 abort 后 idle 抢跑下一条）；dryRun 不写状态
    const pausedQueues = dryRun ? 0 : queuePauseNonEmpty()
    // 防自噬：调用方自己的会话若在枚举集内则剔除（子代理调用必须传自身 sid）
    const excluded = (callerSid && scan.items.some(function (it) { return it.sessionId === callerSid })) ? callerSid : null
    const items = scan.items.filter(function (it) { return it.sessionId !== excluded })
    if (dryRun) {
      return json(res, 200, {
        ok: true, dryRun: true, attempted: items.length, excluded_self: excluded, pausedQueues: pausedQueues,
        results: items.map(function (it) {
          return {
            sessionId: it.sessionId, rootId: it.rootId, agent: it.agent, title: it.title,
            lastActive: cancelIso(it.lastActive), willCancel: true
          }
        }),
        auditFile: CANCEL_AUDIT_REL
      })
    }
    cancelRunBatch(items, function (rows) {
      const results = rows.map(function (r) {
        const o = {
          sessionId: r.item.sessionId, rootId: r.item.rootId, agent: r.item.agent, title: r.item.title,
          lastActive: cancelIso(r.item.lastActive), result: r.result
        }
        if (r.httpStatus) o.httpStatus = r.httpStatus
        return o
      })
      // 审计：stopped 记全部尝试及归类，failed 单列失败项
      cancelAuditAppend({
        ts: new Date().toISOString(),
        trigger: trigger,
        callerSessionId: callerSid || null,
        excluded_self: excluded,
        stopped: results.map(function (r) {
          const o = { sessionId: r.sessionId, rootId: r.rootId, agent: r.agent, result: r.result }
          if (r.httpStatus) o.httpStatus = r.httpStatus
          return o
        }),
        failed: results.filter(function (r) { return r.result === 'failed' }).map(function (r) { return r.sessionId })
      })
      try { cancelBoardAppend(trigger, rows, cancelStepOf(scan.parents)) } catch (e) { /* 尽力层静默 */ }
      return json(res, 200, {
        ok: true, dryRun: false, attempted: results.length, excluded_self: excluded, pausedQueues: pausedQueues,
        results: results, auditFile: CANCEL_AUDIT_REL
      })
    })
  })
}

// 汇总所有项目目录下的会话（默认工作目录 + 每个项目目录 + 导入项目），按更新时间倒序
// limit：后端 /session 默认只回 100 条，子会话会把根挤没（littleDJ 只剩 4 根），故显式抬到 5000。
//   5000 为余量上限（当前无目录超 1000）；若后端忽略该参数则退回现状少显示根，不报错。
//   默认行为与其他 /_sessions 消费方不受破坏：仅多回根、并新增 childCount 字段（纯增量）。
const SESSIONS_LIMIT = 5000
function collectSessions(cb) {
  const dirs = []
  const pushDir = function (p) {
    if (!p) return
    const abs = path.resolve(String(p))
    if (dirs.indexOf(abs) < 0) dirs.push(abs)
  }
  listProjects().forEach(function (p) { pushDir(p.path) })
  // 导入项目（config/imports.json）也要查：否则从外部路径导入的小DJ 侧栏永远是 0 对话
  loadImports().forEach(function (i) { if (i && i.path && fs.existsSync(i.path)) pushDir(i.path) })
  const all = [], seen = {}, seenChild = {}, childCount = {}
  let left = dirs.length + 1
  const finish = function () {
    if (--left > 0) return
    all.sort(function (a, b) { return ((b.time && b.time.updated) || 0) - ((a.time && a.time.updated) || 0) })
    // childCount：按「已请求目录」的返回计数（P2-1 口径，非全局），供左栏只在确有子会话的根上画 caret
    all.forEach(function (s) { s.childCount = childCount[s.id] || 0 })
    /* task60：来源前缀正证据——boot-state 记录过 = 首条消息经 PWA；纯增量字段，只读不写盘 */
    const _bs = loadBootState()
    const _bv = Object.keys(_bs).map(function (k) { return Number(_bs[k]) })
      .filter(function (n) { return isFinite(n) && n > 0 })
    // 纪元 = max(功能上线基线, 现存最小记录)：只做下限，记录被裁剪/被旧备份覆盖时自动扩大未知区
    const _ep = _bv.length ? Math.max(1793799932537, Math.min.apply(null, _bv)) : 0
    all.forEach(function (s) {
      if (isFinite(Number(_bs[s.id])) && Number(_bs[s.id]) > 0) { s.pwa = 1; return }
      const c = (s.time && s.time.created) || 0
      const u = (s.time && s.time.updated) || 0
      // 空活动（updated <= created）/ 纪元前 / 纪元不可得 → 未知：不写字段，前端按问答
      if (!_ep || !c || c < _ep || u <= c) return
      s.pwa = 0
    })
    cb(all)
  }
  const absorb = function (body) {
    try {
      const list = JSON.parse(body)
      if (Array.isArray(list)) list.forEach(function (s) {
        if (!s || !s.id) return
        if (s.parentID) {
          // 子代理会话不进侧栏，但为其父累计 childCount（同一子会话跨目录响应只计一次）
          if (seenChild[s.id]) return
          seenChild[s.id] = 1
          childCount[s.parentID] = (childCount[s.parentID] || 0) + 1
          return
        }
        if (seen[s.id]) return
        seen[s.id] = 1
        all.push(s)
      })
    } catch (e) {}
  }
  // 默认工作目录的会话（老机器上历史会话都在这里）
  backendRequest('GET', '/session?limit=' + SESSIONS_LIMIT, { authorization: AUTH_EXPECT }, null, function (pres) {
    if (!pres) return finish()
    let b = ''
    pres.on('data', function (c) { b += c })
    pres.on('end', function () { absorb(b); finish() })
  })
  dirs.forEach(function (dir) {
    backendRequest('GET', '/session?directory=' + encodeURIComponent(dir) + '&limit=' + SESSIONS_LIMIT, { authorization: AUTH_EXPECT }, null, function (pres) {
      if (!pres) return finish()
      let b = ''
      pres.on('data', function (c) { b += c })
      pres.on('end', function () { absorb(b); finish() })
    })
  })
}

// ---- TUI 提示音桥：订阅端集合 + 同音型 800ms 限频广播 ----
const bellClients = new Set()
const bellLast = {}
function bellBroadcast(kind) {
  const now = Date.now()
  if (now - (bellLast[kind] || 0) < 800) return false
  bellLast[kind] = now
  const payload = 'event: bell\ndata: ' + JSON.stringify({ kind: kind, at: now }) + '\n\n'
  bellClients.forEach(function (res) { try { res.write(payload) } catch (e) {} })
  return true
}

// ---- task386-fu4：DJH 积分板实时同步（djh.example.com/status-pills-api，cookie 存 config/*.txt 0600 不入 git） ----
// 链路：djh_pass（网关通行证，90 天）+ dsh-auth-xxx（dsh 会话票，浏览器换票同名同值）；任一失效自动换票一次。
// 失败回退本地 config/score-snapshot.json（DJH 5 分钟推送快照），前端据 at 判「已过期」。
const DJH_BASE = 'https://djh.example.com'
const DJH_PASS_FILE = path.join(CONFIG, 'djh-pass.txt')
const DJH_AUTH_FILE = path.join(CONFIG, 'djh-dsh-auth.txt')
const DJH_SCORE_TTL = 60 * 1000
let djhScoreCache = null

function djhReadCookie() {
  try {
    const a = fs.readFileSync(DJH_PASS_FILE, 'utf8').trim()
    if (!a) return ''
    let b = ''
    try { b = fs.readFileSync(DJH_AUTH_FILE, 'utf8').trim() } catch (e) {}
    return b ? (a + '; ' + b) : a
  } catch (e) { return '' }
}
function djhFetchJson(pathname, cookie, ms) {
  const ac = new AbortController()
  const timer = setTimeout(function () { ac.abort() }, ms || 8000)
  return fetch(DJH_BASE + pathname, {
    method: 'POST',
    headers: { cookie: cookie, 'content-type': 'application/json' },
    body: '{}',
    signal: ac.signal
  }).then(function (r) {
    return r.text().then(function (t) {
      let b = null
      try { b = JSON.parse(t) } catch (e) {}
      return { status: r.status, body: b }
    })
  }).finally(function () { clearTimeout(timer) })
}
function djhRefreshDshAuth(passCookie) {
  const ac = new AbortController()
  const timer = setTimeout(function () { ac.abort() }, 8000)
  return fetch(DJH_BASE + '/', {
    method: 'GET',
    headers: { cookie: passCookie, accept: 'text/html' },
    redirect: 'manual',
    signal: ac.signal
  }).then(function (r) {
    const sc = r.headers.get('set-cookie') || ''
    const c = sc.split(';')[0]
    if (c && c.indexOf('=') > 0) {
      try { fs.writeFileSync(DJH_AUTH_FILE, c + '\n', { mode: 0o600 }) } catch (e) {}
      return c
    }
    return ''
  }).finally(function () { clearTimeout(timer) })
}
/* djh 响应 → littleDJ 快照同构（前端 sysPanelQuo 零改动消费；cn/intl 用 coin 当余额） */
function djhScoreNormalize(stateBody, rhBody, rhIntlBody, wbBody, bzBody, msBody) {
  const st = (stateBody && stateBody.value) || {}
  const pick = function (x) { return (x && x.value) || null }
  const cnv = pick(rhBody), intlv = pick(rhIntlBody), wbv = pick(wbBody), bzv = pick(bzBody), msv = pick(msBody)
  const out = { at: Date.now(), source: 'djh-live' }
  if (st.ds) out.ds = st.ds
  if (st.glm) out.glm = st.glm
  if (st.cloud) out.cloud = st.cloud
  out.or = st.or || { ok: false, error: '未返回' }
  if (cnv) out.cn = { ok: !!cnv.ok, granted: !!cnv.granted, amount: cnv.amount, balance: (cnv.coin != null ? cnv.coin : cnv.balance), coin: cnv.coin, updatedAt: cnv.updatedAt }
  if (intlv) out.intl = { ok: !!intlv.ok, granted: !!intlv.granted, amount: intlv.amount, balance: (intlv.coin != null ? intlv.coin : intlv.balance), coin: intlv.coin, updatedAt: intlv.updatedAt }
  if (wbv) out.wb = wbv
  if (bzv) out.bz = { ok: !!bzv.ok, balance: bzv.balance, granted: !!bzv.granted, updatedAt: bzv.updatedAt }
  if (msv) out.ms = msv
  return out
}
function djhScoreFetch() {
  let passCookie = ''
  try { passCookie = fs.readFileSync(DJH_PASS_FILE, 'utf8').trim() } catch (e) {}
  if (!passCookie) return Promise.resolve(null)
  const cookie = djhReadCookie()
  const eps = ['/status-pills-api/state', '/status-pills-api/rh', '/status-pills-api/rh-intl', '/status-pills-api/wb', '/status-pills-api/breeze', '/status-pills-api/ms']
  const pullAll = function (ck) {
    return Promise.all(eps.map(function (p) {
      return djhFetchJson(p, ck).catch(function () { return { status: 0, body: null } })
    }))
  }
  return pullAll(cookie).then(function (arr) {
    if (arr[0] && arr[0].status === 401) {
      /* dsh 会话票过期 → 用 djh_pass 重新换票，重试一次 */
      return djhRefreshDshAuth(passCookie).then(function (newAuth) {
        if (!newAuth) return null
        return pullAll(passCookie + '; ' + newAuth)
      })
    }
    return arr
  }).then(function (arr) {
    if (!arr || !arr[0] || arr[0].status !== 200 || !arr[0].body || !arr[0].body.ok) return null
    const value = djhScoreNormalize(
      arr[0].body,
      arr[1] && arr[1].body,
      arr[2] && arr[2].body,
      arr[3] && arr[3].body,
      arr[4] && arr[4].body,
      arr[5] && arr[5].body
    )
    djhScoreCache = { at: Date.now(), value: value }
    return value
  })
}
function scoreSnapshotLocal() {
  try {
    const f = path.join(ROOT, 'config', 'score-snapshot.json')
    if (!fs.existsSync(f)) return { ok: false, error: '数据还没同步' }
    const st = fs.statSync(f)
    if (!globalThis._scoreCache || globalThis._scoreCache.mtime !== st.mtimeMs) {
      globalThis._scoreCache = { mtime: st.mtimeMs, value: JSON.parse(fs.readFileSync(f, 'utf8')) }
    }
    return globalThis._scoreCache.value
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) }
  }
}

const server = http.createServer(function (req, res) {
  if (UPSTREAM) return forward(req, res)
  /* task295 产出审 P0-1：URL 解析提前到鉴权之前后，畸形请求目标（如 "GET /\ HTTP/1.1"、
     absolute-form、"//["）会让 new URL 抛 ERR_INVALID_URL——未捕获即进程退出（未认证单请求 DoS）。
     显式兜底 400，与 Node 默认解析器行为对齐（生产修复 2026-11-15，御史初审 P0） */
  let urlObj
  try { urlObj = new URL(req.url, 'http://x') } catch (e) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Bad Request')
  }
  const pn = urlObj.pathname

  /* task295 A7a：公网硬拒 403（X-Real-IP 存在=外网 nginx 反代必带，空头同判，镜像 /_exec task221 判据）——
     持久写口（注入文档/画像/换 Key）与破坏性文件操作、主目录个人文件读；cookie 是 90 天 bearer，
     必须挡「吊销也不回滚的持久后门」（方案审 R2-P0-1） */
  if ('x-real-ip' in req.headers && pubnetDeny(req.method, pn)) {
    return json(res, 403, { ok: false, error: '该操作仅限内网执行（公网链路已硬拒）' })
  }
  /* task295 A4：静态壳白名单 13 项（登录卡片渲染最小集）——未认证可取；
     白名单外静态文件一律走下方鉴权闸（默认拒绝），?v= 查询在 pathname 之外天然剥离 */
  if (shellWhite(pn)) return serveShell(req, res, pn)
  /* task295 A2/A5：登录/探针/登出三端点——自带鉴权与失败计数；匿名探针 401 不计数（R2-P1-4 口径） */
  if (pn === '/_login' && req.method === 'POST') return handleLogin(req, res)
  /* task369：桌面启动器票据登录（GET）——票面 e/k 自带时效与签名，本身即凭据，故放在鉴权闸之前 */
  if (pn === '/_login' && req.method === 'GET') return handleTicketLogin(req, res, urlObj)
  if (pn === '/_auth' && req.method === 'GET') return handleAuthProbe(req, res)
  if (pn === '/_logout' && req.method === 'POST') return handleLogout(req, res)
  if (!authGuard(req)) {
    if (authLocked(req)) {
      res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '900' })
      return res.end('尝试次数过多，已临时锁定（防爆破保护），请稍后再试')
    }
    /* task295（方案审 P1-1）：数据面 401 一律不带 WWW-Authenticate 挑战——防浏览器自动弹
       Basic 框盖住登录卡片、防 SSE 无凭据循环重连；Basic 主动头仍认（已存凭据/脚本/watchdog 零影响） */
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
    return res.end('Auth required')
  }
  /* task369：桌面启动器现签一次性票据（须 Basic＝必须知道密码，cookie 不批） */
  if (pn === '/_ticket' && req.method === 'GET') return handleTicketIssue(req, res)
  /* task295 A7b：Basic-only 面（密码本 /_vault、明文 Key /_settings/deepseek/active 与 zhipu/active）——内外网均须
     Basic 头，cookie 不批（手机端「敏感区验证」卡片再输一次，凭据仅存内存刷新即失） */
  if (basicOnlyFace(pn) && !basicAuthed(req)) {
    return json(res, 401, { ok: false, error: '此区域需要再次验证密码', basicOnly: true })
  }

  try {
    // ---- TUI 提示音桥：TUI 插件 POST /_tui/bell，转发给所有 /_tui/event SSE 订阅端（开着的 PWA 放音） ----
    if (pn === '/_tui/event') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      })
      res.write('retry: 3000\n\n')
      bellClients.add(res)
      /* task295 A6：通行证设备的长流登记（吊销/登出即 destroy 断流） */
      const pvBell = passVerify(req.headers.cookie)
      if (pvBell) passReg(pvBell.did, res)
      const hb = setInterval(function () { try { res.write(': hb\n\n') } catch (e) {} }, 15000)
      req.on('close', function () { clearInterval(hb); bellClients.delete(res) })
      return
    }
    if (pn === '/_tui/bell' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const kind = ['done', 'ask', 'error', 'agent'].indexOf(d && d.kind) >= 0 ? d.kind : 'done'
        const sent = bellBroadcast(kind)
        return json(res, 200, { ok: true, kind: kind, sent: sent, clients: bellClients.size })
      })
    }

    // ---- 语音对话（task46）：/_voice/voices 配置探查+备注名（task55）| /_voice/tts 合成 | /_voice/stt 识别 ----
    if (pn === '/_voice/voices') {
      if (req.method === 'GET') {
        const c = voiceCfg()
        if (!c) return json(res, 200, { ok: false, error: '语音凭据未配置（' + path.join(ROOT, 'config', 'voice.json') + '，语音对话不可用' })
        return json(res, 200, { ok: true, voices: voiceListPayload(c) })
      }
      if (req.method === 'PUT' || req.method === 'POST') return voiceNameUpdate(req, res)
      return json(res, 405, { ok: false, error: '不支持的请求方法' })
    }
    if (pn === '/_voice/tts' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: '请求格式不对' })
        const pid = String((d && d.providerId) || '').trim()
        if (pid) return voiceTtsByProvider(res, d, pid)
        const c = voiceCfg()
        if (!c) return json(res, 500, { error: '语音凭据未配置（' + path.join(ROOT, 'config', 'voice.json') + '，语音对话不可用' })
        const text = voiceCleanText(d && d.text)
        if (!text) return json(res, 400, { error: '要朗读的文本不能为空' })
        if (text.length > VOICE_TEXT_MAX) return json(res, 400, { error: '文本太长（最多 ' + VOICE_TEXT_MAX + ' 字），请分段' })
        const fmt = (d && d.fmt === 'wav') ? 'wav' : 'mp3'
        let voice = String((d && d.voice) || '').trim()
        const known = (c.tts.voices || []).some(function (v) { return v.id === voice })
        if (!known) voice = (c.tts.voices && c.tts.voices[0] && c.tts.voices[0].id) || ''
        const run = function () {
          return voiceTts(c, text, voice, fmt).then(function (out) {
            res.writeHead(200, { 'Content-Type': out.mime, 'Content-Length': out.buf.length, 'Cache-Control': 'no-store' })
            res.end(out.buf)
          }).catch(function (e) {
            if (e && e.bizCode) return json(res, 502, { error: '语音合成失败（火山码 ' + e.bizCode + '）：' + e.message })
            return json(res, 502, { error: '语音合成失败：' + ((e && e.message) || '网络异常') })
          })
        }
        _ttsChain = _ttsChain.then(run, run)
        return
      })
    }
    if (pn === '/_voice/stt' && req.method === 'POST') {
      return readRawBody(req, VOICE_STT_MAX_BYTES, function (err, buf) {
        if (err) return json(res, 400, { error: '音频太大（上限 2MB，约 60 秒），请说短一点' })
        const c = voiceCfg()
        if (!c) return json(res, 500, { error: '语音凭据未配置（' + path.join(ROOT, 'config', 'voice.json') + '，语音对话不可用' })
        const run = function () {
          return voiceStt(c, buf).then(function (text) {
            if (!text) return json(res, 502, { error: '没听清，请靠近一点再说一遍' })
            json(res, 200, { ok: true, text: text })
          }).catch(function (e) {
            json(res, 502, { error: (e && e.message) || '语音识别失败' })
          })
        }
        _sttChain = _sttChain.then(run, run)
        return
      })
    }

    // ---- 多供应商 TTS 配置（task68 S2b）：/_tts/providers CRUD，Key 只回掩码 ----
    if (pn === '/_tts/providers') {
      const method = req.method
      if (method === 'GET') {
        const data = ttsProvidersLoad()
        if (!data || !Array.isArray(data.providers)) return json(res, 200, { ok: false, error: (data && data.error) || '供应商配置读取失败' })
        return json(res, 200, { ok: true, seedVersion: data.seedVersion || 1, providers: ttsProvidersSorted(data).map(ttsProviderPublic) })
      }
      if (method === 'POST' || method === 'PUT') {
        const len = Number(req.headers['content-length'] || 0)
        if (len > 256 * 1024) return json(res, 413, { ok: false, error: '请求体过大' })
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
          if (!d || typeof d !== 'object' || Array.isArray(d)) return json(res, 400, { ok: false, error: '请求体必须是对象' })
          const data = ttsProvidersLoad()
          if (!data || !Array.isArray(data.providers)) return json(res, 200, { ok: false, error: (data && data.error) || '供应商配置读取失败' })
          if (method === 'POST') return ttsProviderCreate(res, data, d)
          return ttsProviderUpdate(res, data, d)
        })
      }
      if (method === 'DELETE') {
        const id = String(urlObj.searchParams.get('id') || '').trim()
        if (!id) return json(res, 400, { ok: false, error: '缺少供应商 id' })
        const data = ttsProvidersLoad()
        if (!data || !Array.isArray(data.providers)) return json(res, 200, { ok: false, error: (data && data.error) || '供应商配置读取失败' })
        const i = data.providers.findIndex(function (p) { return p && p.id === id })
        if (i < 0) return json(res, 404, { ok: false, error: '供应商不存在' })
        if (data.providers.length <= 1) return json(res, 400, { ok: false, error: '至少保留一家供应商，不能全部删除' })
        data.providers.splice(i, 1)
        try {
          ttsProvidersWrite(data)
        } catch (e) {
          console.error('[tts-providers] 写入失败 path=' + TTS_PROVIDERS_FILE + ' code=' + ((e && e.code) || 'unknown'))
          return json(res, 500, { ok: false, error: '供应商配置保存失败，请检查 config 目录写入权限' })
        }
        return json(res, 200, { ok: true, id: id })
      }
      return json(res, 405, { ok: false, error: '不支持的请求方法' })
    }

    // 批量取消子代理（task79 S2a）：内部直连用 /_tasks/abort-all，UI 走 /api/_tasks/abort-all；
    // 必须挂在 /api/ 透传之前，否则会被当成后端路径 404。鉴权由顶部 authed() 统一守门。
    if (pn === '/_tasks/abort-all' || pn === '/api/_tasks/abort-all') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' })
      return handleAbortAll(req, res, urlObj)
    }

    if (pn.indexOf('/api/') === 0) {
      /* task295 A6：PWA 主事件流 /api/event——通行证设备登记，吊销/登出即断（前端轮询 /_auth 自愈回卡片） */
      if (pn === '/api/event') {
        const pvApi = passVerify(req.headers.cookie)
        if (pvApi) passReg(pvApi.did, res)
      }
      const pm = pn.match(/^\/api\/session\/([^/]+)\/prompt_async$/)
      if (pm && req.method === 'POST') return handlePromptAsync(req, res, urlObj, decodeURIComponent(pm[1]))
      // P1-1：停当前轮联动 paused（任何端经 proxy 停当前都走这里，服务端为唯一真相源）
      const am = pn.match(/^\/api\/session\/([^/]+)\/abort$/)
      if (am && req.method === 'POST') return handleSessionAbort(req, res, urlObj, decodeURIComponent(am[1]))
      // 彻底删除会话（仅根路径 ^/api/session/<id>$）：先归档，成功才透传 DELETE，2xx 后同步清 hidden；
      // task163：前端入口已退役（隐藏为唯一维护入口），接口保留供主人明示清理时人工/AI 调用
      // 归档失败 fail-closed（不回 DELETE，会话数据不动）；/children、/message、/prompt_async 等子路径原样透传
      if (req.method === 'DELETE') {
        const dm = DELETE_SESSION_RE.exec(pn)
        if (dm) {
          let sid = dm[1]
          try { sid = decodeURIComponent(dm[1]) } catch (e) {}
          return archiveSession(sid, function (err) {
            if (err && err.notFound) {
              // 会话已不存在：无数据可归，原样透传（响应由后端决定）
              return proxyApi(req, res, urlObj, null, function (code) {
                if (code >= 200 && code < 300) hiddenRestore([sid])
              })
            }
            if (err) {
              // 读失败/格式异常 → 502；本地写入失败 → 500；一律拒删，错误信息不含凭据
              return json(res, (err && err.httpCode) || 502, {
                ok: false, archived: false,
                error: '归档失败（' + ((err && err.message) || '未知错误') + '），已拒绝彻底删除，会话数据未改动'
              })
            }
            return proxyApi(req, res, urlObj, null, function (code) {
              if (code >= 200 && code < 300) hiddenRestore([sid])
            })
          })
        }
      }
      return proxyApi(req, res, urlObj)
    }

    if (pn === '/_dirs') {
      return json(res, 200, {
        projects: listProjects(),
        imports: loadImports().filter(function (i) { return i.path && fs.existsSync(i.path) }),
        order: loadOrder(),
        root: ROOT
      })
    }

    if (pn === '/_projects/order' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const order = (d && Array.isArray(d.order)) ? d.order : null
        if (!order) return json(res, 400, { error: 'order 必须是数组' })
        const clean = order
          .filter(function (k) { return typeof k === 'string' && k.length > 0 && k.length <= 128 })
          .slice(0, 500)
        saveOrder(clean)
        return json(res, 200, { ok: true, order: clean })
      })
    }

    // 会话手动排序（task141）：GET 全表；POST 保存单项目顺序 {projKey, ids}
    if (pn === '/_conv-order') {
      if (req.method === 'GET') return json(res, 200, { order: loadConvOrder() })
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { error: 'bad json' })
          const projKey = (d && typeof d.projKey === 'string') ? d.projKey.slice(0, 128) : ''
          if (!projKey) return json(res, 400, { error: 'projKey 必填' })
          if (!d || !Array.isArray(d.ids)) return json(res, 400, { error: 'ids 必须是数组' })
          const clean = convOrderClean(d.ids)
          const map = loadConvOrder()
          if (clean.length) map[projKey] = clean; else delete map[projKey]
          try { saveConvOrder(map) } catch (e) {
            console.error('[conv-order] 保存失败 code=' + ((e && e.code) || 'unknown'))
            return json(res, 500, { ok: false, error: '排序保存失败，请检查 config 目录写入权限' })
          }
          return json(res, 200, { ok: true, projKey: projKey, ids: clean })
        })
      }
      return json(res, 405, { error: 'method not allowed' })
    }

    // ---- 设置：官方 DeepSeek API Key ----
    /* ===== task337：模型别名（跨设备同步单源）=====
       GET  /_model-alias        → { ok, alias, savedAt }（别名非凭据，公网可读——下拉/比价/角色页渲染依赖）
       POST /_model-alias {alias, force?} → 全量覆写（前端始终持全量合并后的 map 上行；key/值/条目校验在 writeModelAlias）
       task343：入参清洗后为空且现有库非空 → 409 ALIAS_EMPTY_GUARD（确认清空必须 force:true，防生产断言/空客户端误清库）*/
    if (pn === '/_model-alias') {
      if (req.method === 'GET') return json(res, 200, { ok: true, alias: readModelAlias(), savedAt: readModelAliasSavedAt() })
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { error: 'bad json' })
          const inMap = (d && d.alias && typeof d.alias === 'object' && !Array.isArray(d.alias)) ? d.alias : null
          if (!inMap) return json(res, 400, { error: 'body 需要 { alias: {...} }' })
          const force = !!(d && d.force === true)
          let clean = null
          try { clean = writeModelAlias(inMap, { force: force }) } catch (e) {
            if (e && e.code === 'ALIAS_EMPTY_GUARD') return json(res, 409, { error: (e && e.message) || '拒绝清空非空别名库', guard: 'empty-overwrite' })
            return json(res, 400, { error: (e && e.message) || '别名保存失败' })
          }
          return json(res, 200, { ok: true, count: Object.keys(clean).length })
        })
      }
    }

    if (pn === '/_settings/deepseek') {
      if (req.method === 'GET') {
        const store = readApiKeys()
        const plain = readDeepseekKey()
        const enc = hasStoredCredential()
        const activeRec = store.keys.filter(function (k) { return k.name === store.active })[0]
        return json(res, 200, {
          configured: !!activeRec || !!plain || enc,
          masked: activeRec ? maskKey(activeRec.key) : (plain ? maskKey(plain) : (enc ? '已加密保存' : '')),
          active: store.active,
          keys: store.keys.map(function (k) {
            return { name: k.name, masked: maskKey(k.key), active: k.name === store.active }
          }),
          provider: 'deepseek'
        })
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { error: 'bad json' })
          const key = String((d && d.apiKey) || '').trim()
          if (!key) return json(res, 400, { error: 'API Key 不能为空' })
          if (!/^sk-[A-Za-z0-9]{16,}$/.test(key)) return json(res, 400, { error: 'Key 格式不对：应以 sk- 开头（官方 DeepSeek API Key）' })
          const name = String((d && d.name) || '').trim().slice(0, 32) || '默认'
          try {
            writeDeepseekKey(key)
            const store = readApiKeys()
            const old = store.keys.filter(function (k) { return k.name === name })[0]
            if (old) old.key = key
            else store.keys.push({ name: name, key: key, created: Date.now() })
            store.active = name
            writeApiKeys(store)
          } catch (e) { return json(res, 500, { error: '保存失败：' + (e && e.message) }) }
          return json(res, 200, { ok: true, masked: maskKey(key), active: name })
        })
      }
    }

    // 切换当前使用的命名 Key（自动填入：返回明文供设置页回填）
    if (pn === '/_settings/deepseek/active' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String((d && d.name) || '').trim()
        const rec = findNamedKey(name)
        if (!rec) return json(res, 404, { error: '找不到该 Key：' + name })
        try {
          writeDeepseekKey(rec.key)
          const store = readApiKeys()
          store.active = name
          writeApiKeys(store)
        } catch (e) { return json(res, 500, { error: '切换失败：' + (e && e.message) }) }
        return json(res, 200, { ok: true, name: name, key: rec.key, masked: maskKey(rec.key) })
      })
    }

    // 测试连接：调官方 /models 验证 Key（可带 apiKey 测未保存的新 Key）
    if (pn === '/_settings/deepseek/test' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        let key = (d && d.apiKey) ? String(d.apiKey).trim() : readDeepseekKey()
        if (!key) { const rec = findNamedKey(readApiKeys().active); if (rec) key = rec.key }
        if (!key) return json(res, 200, { ok: false, error: '还没有可用的 API Key' })
        const r = https.request('https://api.deepseek.com/models', {
          method: 'GET', timeout: 10000,
          headers: { authorization: 'Bearer ' + key }
        }, function (pres) {
          let b = ''
          pres.on('data', function (c) { b += c })
          pres.on('end', function () {
            if (pres.statusCode === 200) {
              let models = []
              try { models = (JSON.parse(b).data || []).map(function (m) { return m.id }) } catch (e) {}
              return json(res, 200, { ok: true, models: models })
            }
            if (pres.statusCode === 401) return json(res, 200, { ok: false, error: 'API Key 无效（官方返回 401）' })
            return json(res, 200, { ok: false, error: '官方返回 HTTP ' + pres.statusCode })
          })
        })
        r.on('timeout', function () { r.destroy(); return json(res, 200, { ok: false, error: '连接官方超时（10 秒）' }) })
        r.on('error', function (e) { return json(res, 200, { ok: false, error: '网络错误：' + e.message }) })
        r.end()
      })
    }

    // 余额：查官方 /user/balance（可用当前 Key 或指定新 Key）
    if (pn === '/_settings/deepseek/balance' && (req.method === 'GET' || req.method === 'POST')) {
      const run = function (apiKey) {
        let key = apiKey ? String(apiKey).trim() : readDeepseekKey()
        if (!key) { const rec = findNamedKey(readApiKeys().active); if (rec) key = rec.key }
        if (!key) return json(res, 200, { ok: false, error: '还没有可用的 API Key' })
        const r = https.request('https://api.deepseek.com/user/balance', {
          method: 'GET', timeout: 10000,
          headers: { authorization: 'Bearer ' + key }
        }, function (pres) {
          let b = ''
          pres.on('data', function (c) { b += c })
          pres.on('end', function () {
            if (pres.statusCode !== 200) return json(res, 200, { ok: false, error: '官方返回 HTTP ' + pres.statusCode })
            try {
              const d = JSON.parse(b)
              const infos = Array.isArray(d.balance_infos) ? d.balance_infos : []
              const i = infos[0] || {}
              const cur = i.currency === 'USD' ? '$' : '¥'
              return json(res, 200, {
                ok: true,
                balance: i.total_balance ? (cur + ' ' + i.total_balance) : '',
                available: !!d.is_available,
                infos: infos
              })
            } catch (e) { return json(res, 200, { ok: false, error: '余额返回解析失败' }) }
          })
        })
        r.on('timeout', function () { r.destroy(); return json(res, 200, { ok: false, error: '查询余额超时（10 秒）' }) })
        r.on('error', function (e) { return json(res, 200, { ok: false, error: '网络错误：' + e.message }) })
        r.end()
      }
      if (req.method === 'POST') return readBody(req, function (err, d) { if (err) return json(res, 400, { error: 'bad json' }); run(d && d.apiKey) })
      return run('')
    }

    // 删除命名 Key（若删的是当前使用中的 Key，同时清除凭据库里的 Key）
    if (pn === '/_settings/deepseek/delete' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String((d && d.name) || '').trim()
        const store = readApiKeys()
        const idx = store.keys.findIndex(function (k) { return k.name === name })
        if (idx < 0) return json(res, 404, { error: '找不到该 Key：' + name })
        const wasActive = store.active === name
        store.keys.splice(idx, 1)
        if (wasActive) {
          store.active = ''
          try {
            let j = {}
            try { j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8')) || {} } catch (e) {}
            if (j.deepseek && typeof j.deepseek === 'object') delete j.deepseek.key
            fs.writeFileSync(DEVECO_AUTH_FILE, JSON.stringify(j, null, 2))
          } catch (e) { return json(res, 500, { error: '删除失败：' + (e && e.message) }) }
        }
        try { writeApiKeys(store) } catch (e) { return json(res, 500, { error: '删除失败：' + (e && e.message) }) }
        return json(res, 200, { ok: true, active: store.active, wasActive: wasActive })
      })
    }

    // ---- 设置：智谱官方 Token Plan（GLM Coding Plan） ----
    if (pn === '/_settings/zhipu') {
      if (req.method === 'GET') {
        const store = readZhipuKeys()
        const plain = readZhipuKey()
        const enc = hasStoredZhipuCredential()
        const activeRec = store.keys.filter(function (k) { return k.name === store.active })[0]
        return json(res, 200, {
          configured: !!activeRec || !!plain || enc,
          masked: activeRec ? maskKey(activeRec.key) : (plain ? maskKey(plain) : (enc ? '已加密保存' : '')),
          active: store.active,
          keys: store.keys.map(function (k) {
            return { name: k.name, masked: maskKey(k.key), active: k.name === store.active }
          }),
          provider: ZHIPU_PROVIDER,
          baseUrl: ZHIPU_BASE
        })
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { error: 'bad json' })
          const key = String((d && d.apiKey) || '').trim()
          if (!key) return json(res, 400, { error: 'API Key 不能为空' })
          const name = String((d && d.name) || '').trim().slice(0, 32) || '默认'
          try {
            writeZhipuKey(key)
            const store = readZhipuKeys()
            const old = store.keys.filter(function (k) { return k.name === name })[0]
            if (old) old.key = key
            else store.keys.push({ name: name, key: key, created: Date.now() })
            store.active = name
            writeZhipuKeys(store)
          } catch (e) { return json(res, 500, { error: '保存失败：' + (e && e.message) }) }
          return json(res, 200, { ok: true, masked: maskKey(key), active: name })
        })
      }
    }

    if (pn === '/_settings/zhipu/active' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String((d && d.name) || '').trim()
        const rec = findZhipuKey(name)
        if (!rec) return json(res, 404, { error: '找不到该 Key：' + name })
        try {
          writeZhipuKey(rec.key)
          const store = readZhipuKeys()
          store.active = name
          writeZhipuKeys(store)
        } catch (e) { return json(res, 500, { error: '切换失败：' + (e && e.message) }) }
        return json(res, 200, { ok: true, name: name, key: rec.key, masked: maskKey(rec.key) })
      })
    }

    // 测试连接：调智谱 /models 验证 Key
    if (pn === '/_settings/zhipu/test' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        const key = (d && d.apiKey) ? String(d.apiKey).trim() : resolveZhipuKey()
        if (!key) return json(res, 200, { ok: false, error: hasStoredZhipuCredential() ? 'Key 已加密保存，请在设置里重新输入一次以启用测试与配额' : '还没有可用的 API Key' })
        httpsGetJson(ZHIPU_BASE + '/models', { authorization: 'Bearer ' + key }, function (e, code, body) {
          if (e) return json(res, 200, { ok: false, error: '网络错误：' + e.message })
          if (code === 200) {
            let models = []
            try { models = (body.data || []).map(function (m) { return m.id }) } catch (ex) {}
            return json(res, 200, { ok: true, models: models })
          }
          if (code === 401) return json(res, 200, { ok: false, error: 'API Key 无效（智谱返回 401）' })
          return json(res, 200, { ok: false, error: '智谱返回 HTTP ' + code })
        })
      })
    }

    // 配额：5 小时 / 一周 两个百分比（Token Plan 额度）
    if (pn === '/_settings/zhipu/quota' && (req.method === 'GET' || req.method === 'POST')) {
      const run = function (apiKey) {
        const key = apiKey ? String(apiKey).trim() : resolveZhipuKey()
        if (!key) return json(res, 200, { ok: false, error: hasStoredZhipuCredential() ? 'Key 已加密保存，请在设置里重新输入一次以启用测试与配额' : '还没有可用的 API Key' })
        httpsGetJson(ZHIPU_QUOTA_URL, { authorization: 'Bearer ' + key }, function (e, code, body) {
          if (e) return json(res, 200, { ok: false, error: '网络错误：' + e.message })
          if (code !== 200 || !body) return json(res, 200, { ok: false, error: '智谱返回 HTTP ' + code })
          if (body.code && body.code !== 200) return json(res, 200, { ok: false, error: body.msg || ('智谱错误码 ' + body.code) })
          const q = parseZhipuQuota(body)
          if (!q.fiveHour && !q.week) return json(res, 200, { ok: false, error: '配额返回格式无法识别' })
          return json(res, 200, { ok: true, fiveHour: q.fiveHour, week: q.week, raw: q.raw })
        })
      }
      if (req.method === 'POST') return readBody(req, function (err, d) { if (err) return json(res, 400, { error: 'bad json' }); run(d && d.apiKey) })
      return run('')
    }

    // 删除命名 Key（若删的是当前使用中的 Key，同时清除凭据库里的 Key）
    if (pn === '/_settings/zhipu/delete' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String((d && d.name) || '').trim()
        const store = readZhipuKeys()
        const idx = store.keys.findIndex(function (k) { return k.name === name })
        if (idx < 0) return json(res, 404, { error: '找不到该 Key：' + name })
        const wasActive = store.active === name
        store.keys.splice(idx, 1)
        if (wasActive) {
          store.active = ''
          try {
            let j = {}
            try { j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8')) || {} } catch (e) {}
            if (j[ZHIPU_PROVIDER] && typeof j[ZHIPU_PROVIDER] === 'object') delete j[ZHIPU_PROVIDER].key
            fs.writeFileSync(DEVECO_AUTH_FILE, JSON.stringify(j, null, 2))
          } catch (e) { return json(res, 500, { error: '删除失败：' + (e && e.message) }) }
        }
        try { writeZhipuKeys(store) } catch (e) { return json(res, 500, { error: '删除失败：' + (e && e.message) }) }
        return json(res, 200, { ok: true, active: store.active, wasActive: wasActive })
      })
    }

    // ---- 设置：火山方舟（Volcengine Ark · 豆包 Doubao）API Key ----
    /* task328（主人 2026-11-15 口述「API Key 管理里加上火山的 apikey 输入，输入方式和 DS 一样」）：
       接口形状与 /_settings/deepseek、/_settings/zhipu 完全同构；火山无余额/额度查询接口，只做 Key 存取 + 连通性测试。 */
    if (pn === '/_settings/volc') {
      if (req.method === 'GET') {
        const store = readVolcKeys()
        const plain = readVolcKey()
        const enc = hasStoredVolcCredential()
        const activeRec = store.keys.filter(function (k) { return k.name === store.active })[0]
        return json(res, 200, {
          configured: !!activeRec || !!plain || enc,
          masked: activeRec ? maskKey(activeRec.key) : (plain ? maskKey(plain) : (enc ? '已加密保存' : '')),
          active: store.active,
          keys: store.keys.map(function (k) {
            return { name: k.name, masked: maskKey(k.key), active: k.name === store.active }
          }),
          provider: VOLC_PROVIDER,
          baseUrl: VOLC_BASE
        })
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { error: 'bad json' })
          const key = String((d && d.apiKey) || '').trim()
          if (!key) return json(res, 400, { error: 'API Key 不能为空' })
          /* 火山方舟 Key 形态不止一种（UUID 式 / 新版前缀式），只做宽松校验：16~128 位、无空白、限可见 ASCII */
          if (!/^[A-Za-z0-9._~+\/=-]{16,128}$/.test(key)) return json(res, 400, { error: 'Key 格式不对：长度应在 16~128 位之间、不含空白（火山方舟控制台 → API Key 管理里复制）' })
          const name = String((d && d.name) || '').trim().slice(0, 32) || '默认'
          try {
            writeVolcKey(key)
            const store = readVolcKeys()
            const old = store.keys.filter(function (k) { return k.name === name })[0]
            if (old) old.key = key
            else store.keys.push({ name: name, key: key, created: Date.now() })
            store.active = name
            writeVolcKeys(store)
          } catch (e) { return json(res, 500, { error: '保存失败：' + (e && e.message) }) }
          return json(res, 200, { ok: true, masked: maskKey(key), active: name })
        })
      }
    }

    // 切换当前使用的命名 Key（返回明文供前端验证连接，Basic-only 面）
    if (pn === '/_settings/volc/active' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String((d && d.name) || '').trim()
        const rec = findVolcKey(name)
        if (!rec) return json(res, 404, { error: '找不到该 Key：' + name })
        try {
          writeVolcKey(rec.key)
          const store = readVolcKeys()
          store.active = name
          writeVolcKeys(store)
        } catch (e) { return json(res, 500, { error: '切换失败：' + (e && e.message) }) }
        return json(res, 200, { ok: true, name: name, key: rec.key, masked: maskKey(rec.key) })
      })
    }

    // 测试连接：调火山 Ark /models 验证 Key（可带未保存的新 Key；返回账号可见模型清单供前端补全下拉）
    if (pn === '/_settings/volc/test' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        const key = (d && d.apiKey) ? String(d.apiKey).trim() : resolveVolcKey('')
        if (!key) return json(res, 200, { ok: false, error: '还没有可用的 API Key' })
        httpsGetJson(VOLC_BASE + '/models', { authorization: 'Bearer ' + key }, function (e, code, body) {
          if (e) return json(res, 200, { ok: false, error: '网络错误：' + e.message })
          if (code === 200) {
            const root = body || {}
            const arr = Array.isArray(root.data) ? root.data : (Array.isArray(root.items) ? root.items : (Array.isArray(root.models) ? root.models : []))
            const models = arr.map(function (m) { return m && (m.id || m.model || m.model_id || m.name) }).filter(function (x) { return typeof x === 'string' && x })
            return json(res, 200, { ok: true, models: models })
          }
          if (code === 401 || code === 403) return json(res, 200, { ok: false, error: 'API Key 无效或无权访问（火山返回 ' + code + '）' })
          return json(res, 200, { ok: false, error: '火山返回 HTTP ' + code + (body && body.error && body.error.message ? ('：' + String(body.error.message).slice(0, 160)) : '') })
        })
      })
    }

    // 删除命名 Key（若删的是当前使用中的 Key，同时清除凭据库里的 Key）
    if (pn === '/_settings/volc/delete' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String((d && d.name) || '').trim()
        const store = readVolcKeys()
        const idx = store.keys.findIndex(function (k) { return k.name === name })
        if (idx < 0) return json(res, 404, { error: '找不到该 Key：' + name })
        const wasActive = store.active === name
        store.keys.splice(idx, 1)
        if (wasActive) {
          store.active = ''
          try {
            let j = {}
            try { j = JSON.parse(fs.readFileSync(DEVECO_AUTH_FILE, 'utf8')) || {} } catch (e) {}
            if (j[VOLC_PROVIDER] && typeof j[VOLC_PROVIDER] === 'object') delete j[VOLC_PROVIDER].key
            fs.writeFileSync(DEVECO_AUTH_FILE, JSON.stringify(j, null, 2))
          } catch (e) { return json(res, 500, { error: '删除失败：' + (e && e.message) }) }
        }
        try { writeVolcKeys(store) } catch (e) { return json(res, 500, { error: '删除失败：' + (e && e.message) }) }
        return json(res, 200, { ok: true, active: store.active, wasActive: wasActive })
      })
    }

    // 用量统计（只读 deveco.db；消息级 tokens/cost，按天/周/月聚合；only 限定有别名的模型）
    if (pn === '/_stats/usage' && req.method === 'GET') {
      const bucket = String(urlObj.searchParams.get('bucket') || 'day')
      if (!USAGE_WINDOW_MS[bucket]) return json(res, 400, { ok: false, error: 'bucket 只能是 day/week/month' })
      const model = String(urlObj.searchParams.get('model') || 'all')
      const only = String(urlObj.searchParams.get('only') || '')
      const onlySet = only ? new Set(only.split(',').filter(function (s) { return s })) : null
      try {
        if (urlObj.searchParams.get('refresh') === '1') ensureUsageCache(true)
        return json(res, 200, usageStats(bucket, model, onlySet))
      } catch (e) {
        return json(res, 200, { ok: false, error: String(e && e.message || e) })
      }
    }

    // 主人画像：只存本机 config/owner-profile/，不入 git、不外露
    if (pn === '/_profile') {
      if (req.method === 'GET') {
        const p = readProfile()
        try { if (!fs.existsSync(PROFILE_FILE)) writeProfile(p, '初始化') } catch (e) {}
        return json(res, 200, { dims: profileDimsOf(p), profile: p })
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const len = Number(req.headers['content-length'] || 0)
        if (len > 256 * 1024) return json(res, 413, { ok: false, error: '画像内容过大（上限 256KB）' })
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: 'bad json' })
          const p = sanitizeProfile(d && d.profile ? d.profile : d)
          try { writeProfile(p, cleanProfileText(d && d.action, 40) || '保存') } catch (e) { return json(res, 500, { ok: false, error: '保存失败：' + (e && e.message) }) }
          return json(res, 200, { ok: true, profile: p })
        })
      }
      return json(res, 405, { ok: false, error: 'method not allowed' })
    }

    // task386-fu4 积分快照（只读）：右上角「积分」面板消费——
    // ①优先实时拉 DJH 积分板（status-pills-api，cookie config/djh-*.txt；60s 内存缓存）
    // ②失败回退 config/score-snapshot.json（DJH 5 分钟推送快照；at 过期由前端标黄）
    if (pn === '/_score' && req.method === 'GET') {
      if (djhScoreCache && Date.now() - djhScoreCache.at < DJH_SCORE_TTL) return json(res, 200, djhScoreCache.value)
      djhScoreFetch().then(function (v) {
        return json(res, 200, v || scoreSnapshotLocal())
      }).catch(function () {
        return json(res, 200, scoreSnapshotLocal())
      })
      return
    }
    // 休息态（task71）：GET 读当前状态；POST 切换并写审计（唯一真相源 config/rest-mode.json）
    if (pn === '/_rest') {
      if (req.method === 'GET') {
        const r = restRead()
        return json(res, 200, { on: r.on, since: r.since, source: r.source, rev: r.rev })
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
          if (!d || typeof d !== 'object' || Array.isArray(d)) return json(res, 400, { ok: false, error: '请求体必须是对象' })
          if (typeof d.on !== 'boolean') return json(res, 400, { ok: false, error: 'on 必须是布尔值（true 或 false）' })
          const source = d.source === 'spoken' ? 'spoken' : 'button'
          let next
          try {
            next = restSet(d.on, source, '')
          } catch (e) {
            console.error('[rest] 状态写入失败 code=' + ((e && e.code) || 'unknown'))
            return json(res, 500, { ok: false, error: '休息态保存失败，请检查 config 目录写入权限' })
          }
          return json(res, 200, { ok: true, on: next.on, since: next.since, source: next.source, rev: next.rev })
        })
      }
      return json(res, 405, { ok: false, error: '不支持的请求方法' })
    }

    // 链路模式（task137）：GET 读状态；POST 切换三态（direct=亲自做/flat=压扁链/full=五角色全链），
    // 唯一真相源 config/chain-mode.json；source 暂只 button（口述留位）
    if (pn === '/_chain') {
      if (req.method === 'GET') {
        const c = chainRead()
        return json(res, 200, { mode: c.mode, since: c.since, source: c.source, rev: c.rev })
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
          if (!d || typeof d !== 'object' || Array.isArray(d)) return json(res, 400, { ok: false, error: '请求体必须是对象' })
          if (['direct', 'flat', 'full'].indexOf(d.mode) < 0) return json(res, 400, { ok: false, error: 'mode 必须是 direct / flat / full 之一' })
          let next
          try {
            next = chainSet(d.mode, 'button')
          } catch (e) {
            console.error('[chain] 状态写入失败 code=' + ((e && e.code) || 'unknown'))
            return json(res, 500, { ok: false, error: '链路模式保存失败，请检查 config 目录写入权限' })
          }
          return json(res, 200, { ok: true, mode: next.mode, since: next.since, source: next.source, rev: next.rev })
        })
      }
      return json(res, 405, { ok: false, error: '不支持的请求方法' })
    }

    // 回答/任务模式（task395）：GET 读状态；POST 切换二态（answer=仅回答 / task=任务默认），
    // 唯一真相源 config/answer-mode.json；source 暂只 button（口述留位，与 chain 同口径）
    if (pn === '/_answer') {
      if (req.method === 'GET') {
        const a = answerRead()
        return json(res, 200, { mode: a.mode, since: a.since, source: a.source, rev: a.rev })
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
          if (!d || typeof d !== 'object' || Array.isArray(d)) return json(res, 400, { ok: false, error: '请求体必须是对象' })
          if (['answer', 'task'].indexOf(d.mode) < 0) return json(res, 400, { ok: false, error: 'mode 必须是 answer / task 之一' })
          let next
          try {
            next = answerSet(d.mode, 'button')
          } catch (e) {
            console.error('[answer] 状态写入失败 code=' + ((e && e.code) || 'unknown'))
            return json(res, 500, { ok: false, error: '回答/任务模式保存失败，请检查 config 目录写入权限' })
          }
          return json(res, 200, { ok: true, mode: next.mode, since: next.since, source: next.source, rev: next.rev })
        })
      }
      return json(res, 405, { ok: false, error: '不支持的请求方法' })
    }

    /* ---- 消息队列（task80 S2a）：GET/POST/DELETE 全部走 authed 闸，未鉴权一律 401 ----
       （入口 2764 已有总闸，这里再显式校验一次，保证队列原文不裸奔） */
    if (pn === '/_queue') {
      if (req.method === 'GET') {
        if (!authed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
        const sid = urlObj.searchParams.get('session') || ''
        if (!sid) return json(res, 400, { ok: false, error: 'session 必填' })
        return json(res, 200, queuePayload(sid))
      }
      if (req.method === 'POST') {
        if (!authed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
        // task167：上限 20MB 与 prompt_async 对齐——出队时 body 原样转发 prompt_async，避免入队成功出队 413
        return readBody(req, function (err, d) {
          if (err) return json(res, err.code === 'BODY_TOO_LARGE' ? 413 : 400, { ok: false, error: err.code === 'BODY_TOO_LARGE' ? '请求体过大（上限 20MB）' : '请求格式不对（JSON 解析失败）' })
          const sid = (d && typeof d.session === 'string') ? d.session : ''
          if (!sid) return json(res, 400, { ok: false, error: 'session 必填' })
          const r = queueEnqueue(sid, d.parts, d.echo, { model: d.model, agent: d.agent })
          if (r.code === 409) return json(res, 409, { ok: false, error: 'queue_full', count: r.count })
          if (r.code === 400) return json(res, 400, { ok: false, error: r.error })
          queueWatchSession(sid)
          if (r.deduped) return json(res, 200, { ok: true, deduped: true, count: r.count })
          return json(res, 200, { ok: true, queued: true, position: r.position, count: r.count })
        }, 20 * 1024 * 1024)
      }
      if (req.method === 'DELETE') {
        if (!authed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
        const sid = urlObj.searchParams.get('session') || ''
        if (!sid) return json(res, 400, { ok: false, error: 'session 必填' })
        if (urlObj.searchParams.get('all') === '1') return json(res, 200, queueClear(sid))
        const id = urlObj.searchParams.get('id') || ''
        if (!id) return json(res, 400, { ok: false, error: 'id 必填（清空请传 all=1）' })
        const r = queueRemove(sid, id)
        if (!r.ok) return json(res, r.code || 400, { ok: false, error: r.error })
        return json(res, 200, r)
      }
      return json(res, 405, { ok: false, error: '不支持的请求方法' })
    }
    if (pn === '/_queue/pause' && req.method === 'POST') {
      if (!authed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
        const sid = (d && typeof d.session === 'string') ? d.session : ''
        if (!sid) return json(res, 400, { ok: false, error: 'session 必填' })
        queueSetPaused(sid, true) // 暂停只挂出队，不影响入队（FIFO 排后）
        queueSave()
        return json(res, 200, { ok: true, paused: true, count: queueList(sid).length })
      })
    }
    if (pn === '/_queue/resume' && req.method === 'POST') {
      if (!authed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
        const sid = (d && typeof d.session === 'string') ? d.session : ''
        if (!sid) return json(res, 400, { ok: false, error: 'session 必填' })
        queueSetPaused(sid, false)
        queueSave()
        const list = queueList(sid)
        // 恢复即尝试出队队头（task108 B′：无忙直试；有忙时只认置忙后的本会话 idle 事件凭据，msgIdle 仅触发自愈、不删忙兜底）
        if (list.length && list[0].state === 'queued' && !dispatching.has(sid)) {
          // P2-5（task108 B′ 同口径）：唯一删忙凭据 = 置忙后本会话真 idle 过；回合间隙 msgIdle 恒真，不得删忙投喂（L-003）
          if (queueBusy[sid]) {
            if ((queueIdleAtBy[sid] || 0) >= queueBusy[sid]) { delete queueBusy[sid]; queueTryDispatch(sid) }
            else if (!queueProbing[sid]) {
              queueProbing[sid] = true
              queueMsgIdle(sid, function (idle) { delete queueProbing[sid]; if (idle) queueHeal(sid, Date.now()) })
            }
          } else queueTryDispatch(sid)
        }
        queueEnsureTimer()
        return json(res, 200, { ok: true, paused: false, count: list.length })
      })
    }
    if (pn === '/_queue/next' && req.method === 'POST') {
      if (!authed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
        const sid = (d && typeof d.session === 'string') ? d.session : ''
        if (!sid) return json(res, 400, { ok: false, error: 'session 必填' })
        // UI 收到 session.idle 后调用；内部幂等：单飞在途直接 return
        queueWatchSession(sid)
        // task124 F1″ 纪元证人（CAS）：前端在 session.idle 事件时携带它最后一次读到的忙纪元；
        // 只删「同代」忙——proxy 已自行派发新一轮（纪元已前进）时证人必 stale，杜绝删新忙→双投喂（L-003）。
        // 删忙点不重置纪元、纪元取 Date.now() 跨周期不复用，故旧纪元跨重启/跨轮次都不可能再命中。
        // 产出审 P2-3：证人分支置于 dispatching/paused 早退之前——paused 期同代证人也删忙（忙标记是缓存态，删无副作用；
        // 投喂仍由 queueDispatch 内 paused 护栏拦），避免「暂停期漏 idle → 继续后回退 10min TTL」的 B′ 弱点。
        if (d && d.sawIdle === true && queueBusy[sid]) {
          const epoch = Number(d.epoch) || 0
          if (epoch && epoch === queueBusyEpoch[sid]) { // ① 同代证人：run 确已结束（前端独立 SSE 亲见 run 级 idle）→ 删忙出队
            delete queueBusy[sid]
            if (!queueWitnessWarned) {
              queueWitnessWarned = true
              console.error('[queue] 纪元证人删忙 sid=' + sid + ' epoch=' + epoch + '（proxy 漏收 idle，前端证人自愈）')
            }
            return json(res, 200, { ok: true, witness: 'applied', started: queueDispatch(sid), count: queueList(sid).length })
          }
          // ② 旧代/零代证人：不动作（noop 语义由下方无忙分支承接；忙仍在则落到 B′ 探测）
          return json(res, 200, { ok: true, witness: 'stale', started: false, count: queueList(sid).length })
        }
        if (dispatching.has(sid) || queuePaused[sid]) {
          return json(res, 200, { ok: true, dispatching: dispatching.has(sid), paused: !!queuePaused[sid], count: queueList(sid).length })
        }
        const list = queueList(sid)
        if (!list.length) return json(res, 200, { ok: true, started: false, witness: d && d.sawIdle === true ? 'noop' : undefined, count: 0 })
        // P2-5（task108 B′）：忙标记仍在时，唯一删忙凭据 = 本会话在置忙之后真的收到过 run 级 idle
        // 事件（message.updated 的 time.completed 在回合间隙恒真，不能当凭据，否则会取消在途轮 L-003）
        if (queueBusy[sid]) {
          const busyAt = queueBusy[sid]
          if ((queueIdleAtBy[sid] || 0) >= busyAt) { // ① 凭据充分：删忙并尝试出队
            delete queueBusy[sid]
            return json(res, 200, { ok: true, started: queueDispatch(sid), count: queueList(sid).length })
          }
          // ② 无 idle 凭据 → 只探测（自愈/补 dir），绝不删忙、绝不投喂
          if (!queueProbing[sid]) {
            queueProbing[sid] = true
            queueMsgIdle(sid, function (idle) {
              delete queueProbing[sid]
              if (idle) queueHeal(sid, Date.now())
            })
          }
          return json(res, 200, { ok: true, started: false, probing: true, count: list.length })
        }
        delete queueBusy[sid]
        const started = queueDispatch(sid)
        return json(res, 200, { ok: true, started: started, count: queueList(sid).length })
      })
    }

    // task124 F2″：主人逃生门——强制发送（删忙+立即投喂），会取消当前在跑回合（confirm 已在前端二次确认）
    // 四拒：paused 409 / dispatching / 空队列不删忙 / 队头 inflight 不删忙；成功路径同步短路回执（不等 queueFeed 120s 回调）
    if (pn === '/_queue/force') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method not allowed' })
      if (!authed(req)) return json(res, 401, { ok: false, error: 'Auth required' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: '请求格式不对（JSON 解析失败）' })
        const sid = (d && typeof d.session === 'string') ? d.session : ''
        if (!sid) return json(res, 400, { ok: false, error: 'session 必填' })
        if (queuePaused[sid]) return json(res, 409, { ok: false, error: 'paused' })
        if (dispatching.has(sid)) return json(res, 200, { ok: true, started: false, dispatching: true, count: queueList(sid).length })
        const list = queueList(sid)
        if (!list.length) return json(res, 200, { ok: true, started: false, empty: true, count: 0 })
        if (list[0].state !== 'queued') return json(res, 200, { ok: true, started: false, inflight: true, count: list.length })
        if (queueBusy[sid]) {
          delete queueBusy[sid]
          if (!queueForceWarned) {
            queueForceWarned = true
            console.error('[queue] force 强制发送删忙 sid=' + sid + '（主人确认，取消等待中回合）')
          }
        }
        return json(res, 200, { ok: true, started: queueDispatch(sid), count: queueList(sid).length })
      })
    }

    // 约束管理：世界观 / 开工三查（本机 config/prompts/，600 权限、不入 git）
    if (pn === '/_settings/prompts') {
      if (req.method === 'GET') {
        try { ensurePrompts() } catch (e) {}
        // task374：项目专属段清单（每项目一份 boot-projects/<目录名>.md；exists=非空已配置）
        const projBoots = listProjects().map(function (p) {
          const key = projectBootKey(p.path)
          const file = key ? path.join(PROJECT_BOOT_DIR, key + '.md') : ''
          let exists = false, chars = 0
          if (file) {
            try { const t = fs.readFileSync(file, 'utf8'); exists = !!t.trim(); chars = t.length } catch (e) {}
          }
          return { name: p.name, path: p.path, key: key, file: file, exists: exists, chars: chars }
        })
        return json(res, 200, {
          ok: true,
          prompts: {
            worldview: promptMeta('worldview', readPrompt('worldview')),
            boot: promptMeta('boot', readPrompt('boot'))
          },
          projects: projBoots,
          instructions: readInstructionPaths(),
          log: readPromptLog()
        })
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        const len = Number(req.headers['content-length'] || 0)
        if (len > 256 * 1024) return json(res, 413, { ok: false, error: '内容过大（上限 256KB）' })
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: 'bad json' })
          const which = String((d && d.which) || '')
          if (!PROMPT_FILES[which]) return json(res, 400, { ok: false, error: 'which 必须是 worldview 或 boot' })
          const text = String((d && d.text) || '')
          if (!text.trim()) return json(res, 400, { ok: false, error: '内容不能为空' })
          if (text.length > 60000) return json(res, 400, { ok: false, error: '内容过长（上限 60000 字）' })
          try { writePrompt(which, text) } catch (e) { return json(res, 500, { ok: false, error: '保存失败：' + (e && e.message) }) }
          return json(res, 200, { ok: true, prompt: promptMeta(which, text) })
        })
      }
      return json(res, 405, { ok: false, error: 'method not allowed' })
    }

    // 角色页：读取角色卡与 prompt 来源；写回模型（源+生效副本），改完需重启 serve
    if (pn === '/_roles') {
      if (req.method === 'GET') return json(res, 200, rolesPayload())
      return json(res, 405, { ok: false, error: 'method not allowed' })
    }
    if (pn === '/_roles/model' && (req.method === 'PUT' || req.method === 'POST')) {
      const len = Number(req.headers['content-length'] || 0)
      if (len > 64 * 1024) return json(res, 413, { ok: false, error: '内容过大（上限 64KB）' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: 'bad json' })
        const name = String((d && d.name) || '')
        const model = String((d && d.model) || '').trim()
        if (!AGENT_NAME_RE.test(name) || agentCardNames().indexOf(name) < 0) return json(res, 404, { ok: false, error: '角色不存在' })
        if (!AGENT_MODEL_RE.test(model)) return json(res, 400, { ok: false, error: '模型格式应为 provider/model' })
        try {
          const written = writeAgentModel(name, model)
          return json(res, 200, { ok: true, name: name, model: model, written: written, unchanged: !written.length, needsRestart: true })
        } catch (e) {
          return json(res, 500, { ok: false, error: '写回失败：' + (e && e.message) })
        }
      })
    }

    // 会话交接摘要：自动切换会话时，前端把上一会话摘要暂存，首条消息随开工三查一起注入后即删
    if (pn === '/_handoff' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: 'bad json' })
        const sid = String((d && d.sessionId) || '')
        const text = String((d && d.text) || '').trim()
        if (!/^ses_[A-Za-z0-9_-]+$/.test(sid)) return json(res, 400, { ok: false, error: 'sessionId 不合法' })
        if (!text) return json(res, 400, { ok: false, error: '摘要不能为空' })
        if (text.length > 8000) return json(res, 400, { ok: false, error: '摘要过长（上限 8000 字）' })
        const s = loadHandoff()
        s[sid] = { text: text, at: Date.now() }
        saveHandoff(s)
        return json(res, 200, { ok: true })
      })
    }

    // 任务板（T08）：主人想法清单。GET 读取 / PUT 整存（文本即数据，行首 [x] 视为已划掉；64KB 上限 fail-closed）
    if (pn === '/_board') {
      if (req.method === 'GET') {
        const b = loadBoard()
        return json(res, 200, {
          ok: true,
          text: String(b.text || ''),
          safeN: Number(b.safeN) > 0 ? Number(b.safeN) : 2,
          pending: boardPending(b).length,
          updatedAt: Number(b.updatedAt) || 0
        })
      }
      if (req.method === 'PUT') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: 'bad json' })
          const text = String((d && d.text) || '')
          if (text.length > BOARD_MAX) return json(res, 413, { ok: false, error: '任务板过长（上限 64KB）' })
          const prev = loadBoard()
          const safeN = Number(d && d.safeN) > 0 ? Number(d.safeN) : (Number(prev.safeN) || 2)
          const next = { text: text, safeN: safeN, updatedAt: Date.now() }
          try { writeJson(BOARD_FILE, next) } catch (e) {
            return json(res, 500, { ok: false, error: '写入失败：' + (e && e.message) })
          }
          return json(res, 200, { ok: true, pending: boardPending(next).length, safeN: safeN })
        })
      }
    }

    // task216：备忘录（跨端记事本）——GET 列表 / POST {op:create|save|delete}；原子写 + 上限 fail-closed
    // ⚠save 必须先校验（单条/总量）通过才赋值，防超限请求污染内存单例（方案审确认的 P0 防护）
    if (pn === '/_notes') {
      if (req.method === 'GET') {
        const n = loadNotes()
        return json(res, 200, Object.assign({ ok: true }, notesPublic(n)))
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: 'bad json' })
          const n = loadNotes()
          const op = String((d && d.op) || '')
          if (op === 'create') {
            if (n.list.length >= NOTES_MAX_ITEMS) return json(res, 413, { ok: false, error: '备忘录已达上限 ' + NOTES_MAX_ITEMS + ' 条，请先删除旧条目' })
            const now = Date.now()
            const note = { id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 6), title: '新建备忘', content: '', createdAt: now, updatedAt: now }
            n.list.push(note)
            try { saveNotes(n) } catch (e) { n.list.pop(); return json(res, 500, { ok: false, error: '写入失败：' + (e && e.message) }) }
            return json(res, 200, { ok: true, note: note })
          }
          if (op === 'save') {
            const id = String((d && d.id) || '')
            const cur = n.list.find(function (x) { return x.id === id })
            if (!cur) return json(res, 404, { ok: false, error: '该条备忘不存在（可能已在其它设备删除），请刷新' })
            const nTitle = (d && typeof d.title === 'string') ? d.title.replace(/^\s+|\s+$/g, '').slice(0, 60) : String(cur.title || '')
            const nContent = (d && typeof d.content === 'string') ? d.content : String(cur.content || '')
            if (nContent.length > NOTES_MAX_CONTENT) return json(res, 413, { ok: false, error: '单条备忘过长（上限 64KB）' })
            const nextTotal = notesTotal(n) - String(cur.content || '').length - String(cur.title || '').length + nContent.length + nTitle.length
            if (nextTotal > NOTES_MAX_TOTAL) return json(res, 413, { ok: false, error: '备忘录总量超上限（1MB），请精简' })
            const oldT = cur.title, oldC = cur.content, oldU = cur.updatedAt
            cur.title = nTitle; cur.content = nContent; cur.updatedAt = Date.now()
            try { saveNotes(n) } catch (e) { cur.title = oldT; cur.content = oldC; cur.updatedAt = oldU; return json(res, 500, { ok: false, error: '写入失败：' + (e && e.message) }) }
            return json(res, 200, { ok: true, note: cur })
          }
          if (op === 'delete') {
            const id = String((d && d.id) || '')
            const i = n.list.findIndex(function (x) { return x.id === id })
            if (i < 0) return json(res, 404, { ok: false, error: '该条备忘不存在' })
            const removed = n.list.splice(i, 1)[0]
            try { saveNotes(n) } catch (e) { n.list.splice(i, 0, removed); return json(res, 500, { ok: false, error: '写入失败：' + (e && e.message) }) }
            return json(res, 200, { ok: true })
          }
          return json(res, 400, { ok: false, error: 'op 不合法' })
        })
      }
    }

    // task294：密码本——GET 全量 / POST {op:create|save|delete}；task298 起落盘静态加密，API 形状不变
    // ⚠save 先校验后赋值（同 task216 备忘录 P0 防护：超限请求不得污染内存单例）
    // task298 fail-closed（方案审 P0-2）：loadVault/saveVault 抛 vaultFail → GET 500 / POST 409（文件字节零变化）；响应带 no-store（P1-3）
    /* task295 A7c/A5：设备管理——列表 cookie 可达；踢除须 Basic（防被窃 cookie 反踢全设备） */
    if (pn === '/_devices') {
      return handleDevices(req, res, urlObj)
    }

    if (pn === '/_vault') {
      const jsonNS = function (res2, code, obj) {
        const body = JSON.stringify(obj)
        res2.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' })
        res2.end(body)
      }
      if (req.method === 'GET') {
        try {
          const v = loadVault()
          return jsonNS(res, 200, Object.assign({ ok: true }, vaultPublic(v)))
        } catch (e) {
          if (e && e.vaultFail) return jsonNS(res, 500, { ok: false, error: e.message })
          throw e
        }
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return jsonNS(res, 400, { ok: false, error: 'bad json' })
          try {
            const v = loadVault()
            const op = String((d && d.op) || '')
            if (op === 'create') {
              if (v.items.length >= VAULT_MAX_ITEMS) return jsonNS(res, 413, { ok: false, error: '密码本已达上限 ' + VAULT_MAX_ITEMS + ' 条，请先删除旧条目' })
              const now = Date.now()
              const item = { id: 'v' + now.toString(36) + Math.random().toString(36).slice(2, 6), name: '新建密码', cat: '', account: '', password: '', note: '', createdAt: now, updatedAt: now }
              v.items.push(item)
              try { saveVault(v) } catch (e2) { if (e2 && e2.vaultFail) return jsonNS(res, 409, { ok: false, error: e2.message }); v.items.pop(); return jsonNS(res, 500, { ok: false, error: '写入失败：' + (e2 && e2.message) }) }
              return jsonNS(res, 200, { ok: true, item: item })
            }
            if (op === 'save') {
              const id = String((d && d.id) || '')
              const cur = v.items.find(function (x) { return x.id === id })
              if (!cur) return jsonNS(res, 404, { ok: false, error: '该条目不存在（可能已在其它设备删除），请刷新' })
              const next = {
                name: (d && typeof d.name === 'string') ? vaultTrim(d.name.replace(/^\s+|\s+$/g, ''), 80) || '未命名' : String(cur.name || ''),
                cat: (d && typeof d.cat === 'string') ? vaultTrim(d.cat.replace(/^\s+|\s+$/g, ''), 40) : String(cur.cat || ''),
                account: (d && typeof d.account === 'string') ? vaultTrim(d.account, 400) : String(cur.account || ''),
                password: (d && typeof d.password === 'string') ? vaultTrim(d.password, 400) : String(cur.password || ''),
                note: (d && typeof d.note === 'string') ? vaultTrim(d.note, VAULT_MAX_NOTE) : String(cur.note || '')
              }
              const old = { name: cur.name, cat: cur.cat, account: cur.account, password: cur.password, note: cur.note, updatedAt: cur.updatedAt }
              Object.assign(cur, next); cur.updatedAt = Date.now()
              try { saveVault(v) } catch (e2) { if (e2 && e2.vaultFail) return jsonNS(res, 409, { ok: false, error: e2.message }); Object.assign(cur, old); return jsonNS(res, 500, { ok: false, error: '写入失败：' + (e2 && e2.message) }) }
              return jsonNS(res, 200, { ok: true, item: cur })
            }
            if (op === 'delete') {
              const id = String((d && d.id) || '')
              const i = v.items.findIndex(function (x) { return x.id === id })
              if (i < 0) return jsonNS(res, 404, { ok: false, error: '该条目不存在' })
              const removed = v.items.splice(i, 1)[0]
              try { saveVault(v) } catch (e2) { if (e2 && e2.vaultFail) return jsonNS(res, 409, { ok: false, error: e2.message }); v.items.splice(i, 0, removed); return jsonNS(res, 500, { ok: false, error: '写入失败：' + (e2 && e2.message) }) }
              return jsonNS(res, 200, { ok: true })
            }
            return jsonNS(res, 400, { ok: false, error: 'op 不合法' })
          } catch (e) {
            if (e && e.vaultFail) return jsonNS(res, 409, { ok: false, error: e.message })
            throw e
          }
        })
      }
    }

    /* task331：密码本 → API Key 联通（主人原话「既然密码本里都有，设置里应该是选项框直接选，不需要 Ctrl C Ctrl V」）
       GET /_vault/pick：选取器元数据（id/名称/分类/是否有Key/掩码，明文与账号备注一律不出）；
       POST /_vault/apply：服务端把密码本条目的 Key 直接落成对应供应商 Key（明文不出浏览器）。
       闸门口径：pick 进公网 GET 拒绝名单、apply 进公网写拒绝名单——与保存 Key 同级的敏感面，内网 cookie/Basic 均可。 */
    if (pn === '/_vault/pick' && req.method === 'GET') {
      const vjPick = function (res2, code, obj) {
        const body = JSON.stringify(obj)
        res2.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' })
        res2.end(body)
      }
      try {
        const v = loadVault()
        const items = v.items.map(function (it) {
          const pw = String(it.password || '').replace(/^\s+|\s+$/g, '')
          return { id: it.id, name: String(it.name || ''), cat: String(it.cat || ''), hasKey: !!pw, mask: pw ? maskKey(pw) : '' }
        })
        return vjPick(res, 200, { ok: true, items: items })
      } catch (e) {
        if (e && e.vaultFail) return vjPick(res, 500, { ok: false, error: e.message })
        throw e
      }
    }
    if (pn === '/_vault/apply' && req.method === 'POST') {
      const vjApply = function (res2, code, obj) {
        const body = JSON.stringify(obj)
        res2.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' })
        res2.end(body)
      }
      return readBody(req, function (err, d) {
        if (err) return vjApply(res, 400, { ok: false, error: 'bad json' })
        const provider = String((d && d.provider) || '')
        const stores = {
          deepseek: { read: readApiKeys, write: writeApiKeys, writeKey: writeDeepseekKey },
          zhipu: { read: readZhipuKeys, write: writeZhipuKeys, writeKey: writeZhipuKey },
          volc: { read: readVolcKeys, write: writeVolcKeys, writeKey: writeVolcKey }
        }
        const st = stores[provider]
        if (!st) return vjApply(res, 400, { ok: false, error: 'provider 不合法：只支持 deepseek / zhipu / volc' })
        let item = null
        try {
          item = loadVault().items.find(function (x) { return x.id === String((d && d.id) || '') })
        } catch (e) {
          if (e && e.vaultFail) return vjApply(res, 500, { ok: false, error: e.message })
          throw e
        }
        if (!item) return vjApply(res, 404, { ok: false, error: '密码本里找不到该条目（可能已在别处删除），请重新打开选取器' })
        const key = vaultExtractKey(item.password, provider)
        if (!key) return vjApply(res, 400, { ok: false, error: '该条目的密码字段为空或里面找不到可用的 Key——让小 DJ 先把密码本这条整理成单独的 Key 再选' })
        if (provider === 'deepseek' && !/^sk-[A-Za-z0-9]{16,}$/.test(key)) return vjApply(res, 400, { ok: false, error: 'Key 格式不对：应以 sk- 开头（官方 DeepSeek API Key）' })
        if (provider === 'volc' && !/^[A-Za-z0-9._~+\/=-]{16,128}$/.test(key)) return vjApply(res, 400, { ok: false, error: 'Key 格式不对：长度应在 16~128 位之间、不含空白（火山方舟控制台 → API Key 管理里复制）' })
        const name = String(item.name || '').replace(/^\s+|\s+$/g, '').slice(0, 32) || '默认'
        try {
          st.writeKey(key)
          const store = st.read()
          const old = store.keys.filter(function (k) { return k.name === name })[0]
          if (old) old.key = key
          else store.keys.push({ name: name, key: key, created: Date.now() })
          store.active = name
          st.write(store)
        } catch (e) { return vjApply(res, 500, { ok: false, error: '保存失败：' + (e && e.message) }) }
        return vjApply(res, 200, { ok: true, masked: maskKey(key), active: name, provider: provider })
      })
    }

    // task221：DJH 最高权限通道——POST /_exec 本机执行 shell（安全闸见 execAuthed 注释块，P0-1 三层）
    /* task280：问 AI 旁问——带当前会话上下文直连供应商，流式 NDJSON，不写会话 */
    if (pn === '/_ask' && req.method === 'POST') {
      /* task295 A6：问 AI 流式长响应——通行证设备登记（吊销即断） */
      const pvAsk = passVerify(req.headers.cookie)
      if (pvAsk) passReg(pvAsk.did, res)
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        return askProxy(req, res, d)
      })
    }

    if (pn === '/_exec') {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: '用法：POST /_exec {"cmd":"命令","cwd":"绝对路径(可选)","timeoutMs":15000}' })
      // 产出审 P2：用 in 判定而非真值——空值头 X-Real-IP:'' 也属公网反代标记，一并拒
      if ('x-real-ip' in req.headers) return json(res, 403, { ok: false, error: 'exec 仅限内网使用（公网链路一律拒绝）' })
      if (!execAuthed(req)) return json(res, 403, { ok: false, error: 'exec 仅认内网主密码（auth-ext 外网凭据不批）' })
      const rip = String((req.socket && req.socket.remoteAddress) || '')
      if (!execIpPrivate(rip)) return json(res, 403, { ok: false, error: 'exec 仅限私网来源' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: 'bad json' })
        const cmd = typeof (d && d.cmd) === 'string' ? d.cmd : ''
        if (!cmd.trim()) return json(res, 400, { ok: false, error: 'cmd 不能为空' })
        if (cmd.length > 8000) return json(res, 413, { ok: false, error: 'cmd 过长（上限 8000 字符）' })
        const cwd = (d && typeof d.cwd === 'string' && d.cwd) ? d.cwd : os.homedir()
        if (!path.isAbsolute(cwd)) return json(res, 400, { ok: false, error: 'cwd 必须是绝对路径' })
        let tmo = Number(d && d.timeoutMs)
        if (!isFinite(tmo) || tmo <= 0) tmo = 15000
        tmo = Math.min(60000, Math.max(1000, tmo))
        if (execRunning >= EXEC_MAX_PARALLEL) return json(res, 429, { ok: false, error: 'exec busy（同时最多 ' + EXEC_MAX_PARALLEL + ' 个，请稍后重试）' })
        execRunning += 1
        const t0 = Date.now()
        const outL = execOutLimiter()
        const errL = execOutLimiter()
        let child = null
        let done = false
        let released = false
        let timedOut = false
        let t1 = null
        let t2 = null
        let t3 = null
        function release() { if (released) return; released = true; execRunning = Math.max(0, execRunning - 1) } // P1-3：单点释放
        function finish(code) {
          if (done) return
          done = true
          if (t1) { clearTimeout(t1); t1 = null }
          if (t3) { clearTimeout(t3); t3 = null }
          // 产出审 P1-1：t2（SIGKILL 兜底）故意不清——超时组杀后若 sh 先退，2s 后 KILL 组再兜一次（ESRCH 已被吞）
          const ms = Date.now() - t0
          const codeN = typeof code === 'number' ? code : -1
          execAudit({ ts: t0, ip: rip, cmd: execCutStr(cmd, 2048), code: codeN, ms: ms, timedOut: timedOut })
          return json(res, 200, { ok: true, code: codeN, stdout: outL.text(), stderr: errL.text(), ms: ms, timedOut: timedOut })
        }
        try {
          // detached=true 开新进程组，超时组杀连带孙进程（P1-1）
          child = spawn('sh', ['-c', cmd], { cwd: cwd, detached: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
        } catch (e) {
          release()
          return json(res, 500, { ok: false, error: '启动失败：' + (e && e.message) })
        }
        child.stdout.on('data', function (c) { outL.push(c) })
        child.stderr.on('data', function (c) { errL.push(c) })
        child.on('error', function (e) {
          release()
          if (done) return
          done = true
          if (t1) { clearTimeout(t1); t1 = null }
          if (t2) { clearTimeout(t2); t2 = null }
          if (t3) { clearTimeout(t3); t3 = null }
          try { if (child && child.pid) process.kill(-child.pid, 'SIGKILL') } catch (e1) {}
          // 产出审 P2：失败同样留痕（「逐条留痕」不留缺口）
          execAudit({ ts: t0, ip: rip, cmd: execCutStr(cmd, 2048), code: -1, ms: Date.now() - t0, timedOut: false, error: String((e && e.message) || e) })
          return json(res, 500, { ok: false, error: '执行失败：' + (e && e.message) })
        })
        child.on('close', function (code) {
          release()
          finish(timedOut ? -1 : code)
        })
        t1 = setTimeout(function () {
          timedOut = true
          try { process.kill(-child.pid, 'SIGTERM') } catch (e1) {}
          t2 = setTimeout(function () {
            try { process.kill(-child.pid, 'SIGKILL') } catch (e2) {}
          }, 2000)
        }, tmo)
        // 产出审 P1-2：绝对硬顶——setsid/双 fork 守护可持 stdout 管道逃出组杀，close 永不触发（计数永久泄漏→端点自砖）。
        // tmo+5s 到点：组杀 + 销毁 stdio + 强制收尾（release/finish 均幂等，done 闸防双回包）
        t3 = setTimeout(function () {
          timedOut = true
          try { process.kill(-child.pid, 'SIGKILL') } catch (e1) {}
          try { child.stdout.destroy() } catch (e2) {}
          try { child.stderr.destroy() } catch (e3) {}
          release()
          finish(-1)
        }, tmo + 5000)
        t3.unref()
      })
    }

    // 任务台账：从 deveco.db 只读派生（+ 人工覆盖）；旧 upsert 已软退役
    // 监视台（T11）：只读快照（GET；无任何写操作）
    if (pn === '/_watch' && req.method === 'GET') {
      return watchPayload(function (p) { return json(res, 200, p) })
    }

    // task121：进程管理（内存面板）——GET 只读列表（本用户 uid 过滤+保护标记+5s 缓存）；POST 关闭（uid 复核+保护名单+SIGTERM）
    if (pn === '/_procs' && req.method === 'GET') {
      return json(res, 200, procsListPayload(false))
    }
    if (pn === '/_procs/kill' && req.method === 'POST') {
      // 御史P1-3：杀进程是破坏性写操作，公网（dj.example.com 经 nginx 透传 X-Real-IP）一律拒绝，仅小DJ 本机可操作；列表 GET 保留公网只读
      if (req.headers['x-real-ip']) return json(res, 403, { ok: false, error: '关闭进程属敏感操作，请在小DJ 本机（内网）使用' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: 'bad json' })
        const r = procsKillPayload(d)
        return json(res, r.code, r.body)
      })
    }

    // ★2026-11-08 跨沙箱域重启 serve：桌面脚本（HiShell 域）看不到其它域的 serve，由同域的网关代劳杀+等拉活
    if (pn === '/_serve/restart' && req.method === 'POST') {
      if (req.headers['x-real-ip']) return json(res, 403, { ok: false, error: '重启 serve 属敏感操作，请在小DJ 本机（内网）使用' })
      return serveRestartPayload(function (r) { return json(res, r.code, r.body) })
    }

    // ★2026-11-08 跨沙箱域重启网关自身：桌面域 kill 不到其它域的 proxy，由网关响应后自我退出、watchdog 拉活换血
    if (pn === '/_proxy/restart' && req.method === 'POST') {
      if (req.headers['x-real-ip']) return json(res, 403, { ok: false, error: '重启网关属敏感操作，请在小DJ 本机（内网）使用' })
      json(res, 200, { ok: true, pid: process.pid, hint: '网关将在 1s 后自我退出，watchdog 15~30s 内自动拉活（刷新页面即可）' })
      setTimeout(function () { try { process.kill(process.pid, 'SIGTERM') } catch (e) {} }, 1000)
      return
    }

    // task126 F2'A：超时主动提醒注入（写操作，仅本机；公网拒绝——与 /_serve/restart 同闸）
    if (pn === '/_nudge' && req.method === 'POST') {
      if (req.headers['x-real-ip']) return json(res, 403, { ok: false, error: '超时提醒注入属敏感操作，请在小DJ 本机（内网）使用' })
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: 'bad json' })
        const r = nudgePayload(d || {})
        return json(res, r.code, r.body)
      })
    }

    if (pn === '/_tasks') {
      if (req.method === 'GET') {
        const r = tasksGetPayload()
        return json(res, r.code, r.body)
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: 'bad json' })
          const r = taskOpPayload(d)
          return json(res, r.code, r.body)
        })
      }
      return json(res, 405, { ok: false, error: 'method not allowed' })
    }

    // task157：auto-reap 手动单轮触发（调试/演练/验收；auth 已在入口统一校验）
    if (pn === '/_autoreap' && req.method === 'POST') {
      return autoReapTick(function (r) { json(res, 200, { ok: true, result: r }) })
    }

    // task184：派单角色丢失核对闸（GET 只读状态/审计尾；POST 手动单轮，同 /_autoreap 模式）
    if (pn === '/_agent-check') {
      if (req.method === 'GET') {
        const st = agentCheckStateLoad()
        let tail = []
        try {
          const lines = fs.readFileSync(AGENT_CHECK_LOG_FILE, 'utf8').trim().split('\n')
          tail = lines.slice(-10).map(function (l) { try { return JSON.parse(l) } catch (e) { return null } }).filter(Boolean)
        } catch (e) {}
        return json(res, 200, { ok: true, seen: Object.keys(st.seen).length, rootCount: st.rootCount, log: tail })
      }
      if (req.method === 'POST') {
        return agentCheckStep(function (r) { json(res, 200, { ok: true, result: r }) })
      }
      return json(res, 405, { ok: false, error: 'method not allowed' })
    }

    // task119 合并单：效率统计（只读快照；GET；数据源=派生+覆盖层+事件旁路）
    if (pn === '/_taskstats' && req.method === 'GET') {
      const r = taskStatsGetPayload()
      return json(res, r.code, r.body)
    }

    // task189：会话行上下文百分比数据源（只读快照；GET；服务端只回 used tokens，窗口分母由前端按模型匹配）
    if (pn === '/_ctxmap' && req.method === 'GET') {
      const r = ctxMapPayload()
      return json(res, r.ok ? 200 : 503, r)
    }

    // ---- task194：定时任务 skill（模型比价）——固定路径 + body/query 传 id（方案审 P2：不引入路径参数新模式） ----
    if (pn === '/_skills' && req.method === 'GET') {
      return json(res, 200, { ok: true, skills: skillsScheduler.listSkills() })
    }
    if (pn === '/_skills/settings' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: '请求格式不对（需 JSON）' })
        const r = skillsScheduler.updateSettings(String((d && d.id) || ''), (d && d.settings) || {})
        return json(res, r.ok ? 200 : 400, r)
      })
    }
    if (pn === '/_skills/run' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { ok: false, error: '请求格式不对（需 JSON）' })
        const r = skillsScheduler.runNow(String((d && d.id) || ''))
        return json(res, r.ok ? 200 : 409, r)
      })
    }
    if (pn === '/_skills/log' && req.method === 'GET') {
      const id = String(urlObj.searchParams.get('id') || '')
      const limit = Number(urlObj.searchParams.get('limit') || 10)
      return json(res, 200, { ok: true, log: skillsScheduler.readLog(id, limit) })
    }
    // 比价数据（skill 产出 latest.json，只读）
    if (pn === '/_pricing' && req.method === 'GET') {
      const d = skillsModelPricing.readLatest()
      return d ? json(res, 200, { ok: true, data: d }) : json(res, 404, { ok: false, error: '还没有比价数据（先运行一次模型比价）' })
    }

    if (pn === '/_sessions') {
      return collectSessions(function (all) { json(res, 200, all) })
    }

    // ---- 左栏软删除（task56）：只改列表可见性，不删后端会话数据 ----
    if (pn === '/_hidden-sessions') {
      if (req.method === 'GET') {
        const doc = readHidden()
        const out = { ok: true, version: doc.version, hidden: doc.hidden }
        if (doc.warning) out.warning = doc.warning
        return json(res, 200, out)
      }
      if (req.method === 'POST') {
        return readBody(req, function (err, d) {
          if (err) return json(res, 400, { ok: false, error: '请求格式不对（需 JSON）' })
          const action = d && d.action
          if (action !== 'hide' && action !== 'restore') {
            return json(res, 400, { ok: false, error: 'action 只能是 hide 或 restore' })
          }
          const raw = d && d.ids
          if (!Array.isArray(raw) || raw.length === 0) {
            return json(res, 400, { ok: false, error: 'ids 必须是非空数组' })
          }
          if (raw.length > HIDDEN_MAX) {
            return json(res, 400, { ok: false, error: '单次最多 ' + HIDDEN_MAX + ' 个会话 ID' })
          }
          const ids = hiddenNormalize(raw)
          if (!ids.length) return json(res, 400, { ok: false, error: '没有有效的会话 ID' })
          const r = hiddenApply(action, ids)
          if (!r.ok) return json(res, r.code || 400, { ok: false, action: action, error: r.error })
          return json(res, 200, { ok: true, action: r.action, changed: r.changed, hidden: r.hidden })
        })
      }
      return json(res, 405, { ok: false, error: 'method not allowed' })
    }

    if (pn === '/_health') {
      // 立即回包：代理自身存活不再被后端慢请求拖累（旧实现会让 watchdog 误判 4097 掉线并反复拉起）。
      // 后端状态用后台缓存值，探测超时 3s 且只保留一个在途请求。
      const bh = probeBackendHealth()
      return json(res, 200, {
        ok: true,
        proxy: 'up',
        bootId: PROXY_BOOT_ID, // task135：proxy 启动纪元（前端自动刷新握手用）
        uiRev: uiRev(), // task169：ui/index.html 内容指纹（mtime+size）——纯前端改动自动刷新握手用
        backend: bh.ok ? 'up' : 'down',
        backendLatency: bh.latency,
        backendError: bh.err || undefined
      })
    }

    /* ---- task245：页内自检机器人（真浏览器断言；设备沙箱无 uitest/截屏/playwright，只能让页面自己跑）----
       协议：POST /_selftest/request {suite} → 已打开的页面轮询接单 → 跑断言 → POST /_selftest/report
             → 落 run/selftest/<iso>-<suite>-<id>.json；GET /_selftest/reports?limit=N 读最近报告。 */
    if (pn === '/_selftest/request' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const suite = String((d && d.suite) || '').trim()
        if (!/^[A-Za-z0-9._-]{1,40}$/.test(suite)) return json(res, 400, { error: 'suite 不合法（1-40 位字母数字 . - _）' })
        const reqObj = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          suite: suite, ts: Date.now(), by: String((d && d.by) || 'api').slice(0, 40)
        }
        try {
          fs.mkdirSync(path.dirname(SELFTEST_REQUEST), { recursive: true })
          fs.writeFileSync(SELFTEST_REQUEST, JSON.stringify(reqObj))
        } catch (e) { return json(res, 500, { error: '写请求失败：' + e.message }) }
        console.log('[selftest] request suite=' + suite + ' id=' + reqObj.id)
        return json(res, 200, { ok: true, id: reqObj.id, suite: suite, ts: reqObj.ts })
      })
    }
    if (pn === '/_selftest/pending') {
      let out = null
      try {
        const o = JSON.parse(fs.readFileSync(SELFTEST_REQUEST, 'utf8'))
        /* 2 分钟过期：迟到的页面不跑陈请求（否则会在主人眼皮下突然建个自检项目） */
        if (o && o.id && o.ts && Date.now() - Number(o.ts) < 120000) out = o
      } catch (e) {}
      return json(res, 200, { request: out })
    }
    if (pn === '/_selftest/report' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const suite = String((d && d.suite) || 'unknown').slice(0, 40)
        const rid = String((d && d.id) || '').slice(0, 60)
        const rec = {
          ts: Date.now(), at: new Date().toISOString(), suite: suite, id: rid,
          pass: !!(d && d.pass),
          assertions: Array.isArray(d && d.assertions) ? d.assertions.slice(0, 100) : [],
          snapshot: (d && d.snapshot) || null,
          ua: String((d && d.ua) || '').slice(0, 200)
        }
        const f = path.join(SELFTEST_DIR, new Date().toISOString().replace(/[:.]/g, '-') + '-' + suite + (rid ? '-' + rid : '') + '.json')
        try {
          fs.mkdirSync(SELFTEST_DIR, { recursive: true })
          fs.writeFileSync(f, JSON.stringify(rec, null, 2))
        } catch (e) { return json(res, 500, { error: '落盘失败：' + e.message }) }
        try {
          const cur = JSON.parse(fs.readFileSync(SELFTEST_REQUEST, 'utf8'))
          if (!cur || !cur.id || cur.id === rid) fs.unlinkSync(SELFTEST_REQUEST)
        } catch (e) {}
        console.log('[selftest] report suite=' + suite + ' pass=' + rec.pass + ' id=' + rid + ' → ' + f)
        return json(res, 200, { ok: true, path: f, pass: rec.pass })
      })
    }
    if (pn === '/_selftest/reports') {
      const limit = Math.min(20, Math.max(1, Number(urlObj.searchParams.get('limit') || 5) || 5))
      let files = []
      try {
        files = fs.readdirSync(SELFTEST_DIR).filter(function (x) { return /\.json$/.test(x) }).sort().reverse().slice(0, limit)
      } catch (e) {}
      return json(res, 200, {
        reports: files.map(function (x) {
          try { return Object.assign({ file: x }, JSON.parse(fs.readFileSync(path.join(SELFTEST_DIR, x), 'utf8'))) } catch (e) { return { file: x } }
        })
      })
    }

    // task233：UI 关键写操作审计日志——新建项目链（mkdir/import）曾零日志，报障无从追溯主
    // 人操作是否触达服务器（2026-11-12 task233 诊断直接受阻）；成功与失败出口均留 [ui] 行进 proxy.log
    function uiLog(action, result, detail) {
      console.log('[ui] ' + new Date().toISOString() + ' ' + action + ' ' + result + (detail ? ' ' + detail : ''))
    }

    if (pn === '/_import' && (req.method === 'POST' || req.method === 'PUT')) {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String(d.name || '').trim(), p = String(d.path || '').trim()
        if (!NAME_RE.test(name)) { uiLog('import', 'fail', 'name="' + name + '" err=名称不合法'); return json(res, 400, { error: '名称不合法（1-64 字，支持中英文/数字/空格/.-_）' }) }
        if (!(p.charAt(0) === '/' || /^[A-Za-z]:[\\/]/.test(p) || p.indexOf('\\\\') === 0)) { uiLog('import', 'fail', 'name="' + name + '" err=非绝对路径'); return json(res, 400, { error: '必须是绝对路径' }) }
        if (!fs.existsSync(p)) { uiLog('import', 'fail', 'name="' + name + '" err=路径不存在'); return json(res, 400, { error: '路径不存在：' + p }) }
        if (!fs.statSync(p).isDirectory()) { uiLog('import', 'fail', 'name="' + name + '" err=不是目录'); return json(res, 400, { error: '不是目录' }) }
        const list = loadImports().filter(function (i) { return i.name !== name })
        list.push({ name: name, path: path.resolve(p) })
        saveImports(list)
        uiLog('import', 'ok', 'name="' + name + '" path="' + path.resolve(p) + '"')
        return json(res, 200, { ok: true, name: name, path: path.resolve(p) })
      })
    }

    if (pn === '/_unimport' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String(d.name || '')
        saveImports(loadImports().filter(function (i) { return i.name !== name }))
        saveRegistered(registered().filter(function (i) { return i.name !== name }))
        uiLog('unimport', 'ok', 'name="' + name + '"')
        return json(res, 200, { ok: true })
      })
    }

    if (pn === '/_fs/list') {
      const entries = listDir(urlObj.searchParams.get('path') || '')
      return entries ? json(res, 200, { entries: entries }) : json(res, 400, { error: 'bad path' })
    }

    // 文件夹选择器专用：只返回子目录，不读取文件内容
    if (pn === '/_fs/browse') {
      const r = browseDir(urlObj.searchParams.get('path') || '')
      return r ? json(res, 200, r) : json(res, 400, { error: '无法浏览该目录（默认只允许用户主目录）' })
    }

    // 文件夹选择器专用：在用户主目录（browseRoots）内新建子文件夹（task155）
    // task233：出口审计（与 import 同链：新建文件夹即项目，主人报障须可追溯）
    if (pn === '/_fs/mkdir' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const parent = String((d && d.path) || '').trim()
        const name = String((d && d.name) || '').trim()
        if (!name || name === '.' || name === '..' || name.charAt(0) === '.' ) { uiLog('mkdir', 'fail', 'name="' + name + '" err=空名或隐藏目录'); return json(res, 400, { error: '文件夹名不能为空或隐藏目录' }) }
        if (/[\/\\]/.test(name)) { uiLog('mkdir', 'fail', 'name="' + name + '" err=含斜杠'); return json(res, 400, { error: '文件夹名不能包含斜杠' }) }
        if (name.length > 64) { uiLog('mkdir', 'fail', 'name="' + name + '" err=超长'); return json(res, 400, { error: '文件夹名过长（最多 64 字）' }) }
        const roots = browseRoots()
        if (!roots.length) { uiLog('mkdir', 'fail', 'name="' + name + '" err=无可用目录范围'); return json(res, 400, { error: '没有可用的目录范围' }) }
        let base
        try { base = fs.realpathSync(path.resolve(parent || roots[0])) } catch (e) { uiLog('mkdir', 'fail', 'name="' + name + '" err=当前位置不可用'); return json(res, 400, { error: '当前位置不可用（可能已删除）' }) }
        const inside = roots.some(function (r) { return base === r || base.indexOf(r + path.sep) === 0 })
        if (!inside) { uiLog('mkdir', 'fail', 'name="' + name + '" err=超出主目录范围'); return json(res, 400, { error: '只能在用户主目录内新建文件夹' }) }
        const abs = path.join(base, name)
        if (fs.existsSync(abs)) { uiLog('mkdir', 'fail', 'name="' + name + '" err=同名已存在'); return json(res, 409, { error: '同名文件夹已存在' }) }
        try { fs.mkdirSync(abs) } catch (e) { uiLog('mkdir', 'fail', 'name="' + name + '" err=' + e.message); return json(res, 400, { error: '新建失败：' + e.message }) }
        uiLog('mkdir', 'ok', 'path="' + abs + '"')
        return json(res, 200, { ok: true, path: abs })
      })
    }

    if (pn === '/_fs/read') {
      const abs = safeResolve(urlObj.searchParams.get('path'))
      if (!abs) return json(res, 400, { error: 'bad path' })
      const st = fs.statSync(abs)
      if (st.size > 4 * 1024 * 1024) return json(res, 413, { error: 'file too large' })
      return json(res, 200, { content: fs.readFileSync(abs, 'utf8') })
    }

    if (pn === '/_fs/raw') {
      const abs = safeResolve(urlObj.searchParams.get('path'))
      if (!abs) { res.writeHead(400); return res.end() }
      fs.readFile(abs, function (err, buf) {
        if (err) { res.writeHead(404); return res.end() }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' })
        res.end(buf)
      })
      return
    }

    // ---- home 只读通道（task72 S2）：独立命名空间 /_fs/home/*，旧端点与旧函数零改动 ----
    // 访问日志不额外打印路径；响应头不拼路径；错误体不回显真实路径
    if (pn === '/_fs/home/roots' || pn === '/_fs/home/list' || pn === '/_fs/home/read' || pn === '/_fs/home/raw') {
      if (req.method !== 'GET') return jsonHomeErr(res, 'E_METHOD')
      try {
        if (pn === '/_fs/home/roots') return json(res, 200, homeRoots())
        if (pn === '/_fs/home/list') return json(res, 200, homeList(urlObj.searchParams.get('path')))
        if (pn === '/_fs/home/read') return json(res, 200, homeRead(urlObj.searchParams.get('path')))
        return homeRaw(urlObj.searchParams.get('path'), res)
      } catch (e) {
        if (res.headersSent) { res.destroy(); return }
        return homeFail(res, e)
      }
    }

    // 删除本地项目（仅限 projects 下的直接子目录，前端需二次确认）
    if (pn === '/_fs/rmdir' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const name = String(d.name || '')
        if (!NAME_RE.test(name)) return json(res, 400, { error: 'bad name' })
        const abs = path.resolve(PROJECTS, name)
        if (path.dirname(abs) !== PROJECTS) return json(res, 400, { error: '只允许删除 projects 下的直接子目录' })
        if (!fs.existsSync(abs)) return json(res, 404, { error: '项目不存在：' + name })
        fs.rmSync(abs, { recursive: true, force: true })
        return json(res, 200, { ok: true, name: name })
      })
    }

    // 重命名本地项目（仅限 projects 下的直接子目录）
    if (pn === '/_fs/rename' && req.method === 'POST') {
      return readBody(req, function (err, d) {
        if (err) return json(res, 400, { error: 'bad json' })
        const from = String(d.from || ''), to = String(d.to || '')
        if (!NAME_RE.test(from) || !NAME_RE.test(to)) return json(res, 400, { error: '名称不合法（1-64 字，支持中英文/数字/空格/.-_）' })
        const fromAbs = path.resolve(PROJECTS, from), toAbs = path.resolve(PROJECTS, to)
        if (path.dirname(fromAbs) !== PROJECTS || path.dirname(toAbs) !== PROJECTS) return json(res, 400, { error: '只允许重命名 projects 下的直接子目录' })
        if (!fs.existsSync(fromAbs)) return json(res, 404, { error: '项目不存在：' + from })
        if (fs.existsSync(toAbs)) return json(res, 400, { error: '已有同名项目：' + to })
        fs.renameSync(fromAbs, toAbs)
        return json(res, 200, { ok: true, name: to, path: toAbs })
      })
    }

    return serveStatic(req, res, pn)
  } catch (e) {
    return json(res, 500, { error: String(e && e.message || e) })
  }
})

// 仅在直接运行时监听端口；被 require（测试/派生层复用）时不启动监听，避免端口占用与进程悬挂
if (require.main === module) {
  server.listen(PORT, HOST, function () {
    if (UPSTREAM) console.log('[littleDJ] reverse proxy http://' + HOST + ':' + PORT + ' -> ' + UPSTREAM.href)
    else console.log('[littleDJ] ui+proxy on http://' + HOST + ':' + PORT + '  root=' + ROOT + '  backend=' + BACKEND.host + ':' + BACKEND.port)
    // task80 S2a：启动恢复排队消息（只恢复 queued；inflight 不重投）+ 启动出队轮询
    queueBoot()
    // task157：auto-reap 常驻巡检（5min/tick，unref；重启自愈，不依赖 patrol.sh 存活）
    autoReapStart()
    // task194：定时任务 skill 调度器（60s/tick，unref；启动即算各 skill 首次运行时刻）
    skillsScheduler.start()
  })
  /* task353：内网自签 https（默认 8443）——浏览器安全上下文是 getDisplayMedia（Alt+A 圈屏）/
     剪贴板 / Service Worker 等能力的硬前提；同 handler 同鉴权，Basic/公网闸零差异。
     完全增量：证书缺失/端口被占只 console.warn 降级，绝不影响 4097 主路；LITTLEDJ_TLS_PORT=0 关闭。 */
  ;(function tlsServe () {
    const TLS_PORT = Number(process.env.LITTLEDJ_TLS_PORT === undefined ? 8443 : process.env.LITTLEDJ_TLS_PORT)
    if (!TLS_PORT) return
    let cert, key
    try {
      /* task353-fu2：优先 fullchain（叶子+CA，华为官方建议下发完整链）；无 fullchain 回落单证书 */
      const certPath = process.env.LITTLEDJ_TLS_CERT || (fs.existsSync(path.join(CONFIG, 'tls', 'fullchain.pem')) ? path.join(CONFIG, 'tls', 'fullchain.pem') : path.join(CONFIG, 'tls', 'cert.pem'))
      cert = fs.readFileSync(certPath)
      key = fs.readFileSync(process.env.LITTLEDJ_TLS_KEY || path.join(CONFIG, 'tls', 'key.pem'))
    } catch (e) { console.warn('[littleDJ] tls off（无证书，sh deploy/gen-tls.sh 生成）: ' + e.message); return }
    try {
      const reqFns = server.listeners('request') /* createServer(handler) 即 on('request')，复用同一处理链 */
      const tlsSrv = https.createServer({ cert: cert, key: key }, function (req, res) {
        for (let i = 0; i < reqFns.length; i++) reqFns[i].call(server, req, res)
      })
      /* 超时参数镜像 4097 主路（Node 18+ requestTimeout/keepAliveTimeout 默认值两实例各自持有） */
      tlsSrv.headersTimeout = server.headersTimeout
      tlsSrv.requestTimeout = server.requestTimeout
      tlsSrv.keepAliveTimeout = server.keepAliveTimeout
      tlsSrv.on('error', function (e) { console.warn('[littleDJ] tls ' + TLS_PORT + ' 掉线: ' + e.message) })
      tlsSrv.listen(TLS_PORT, HOST, function () {
        console.log('[littleDJ] tls on https://' + HOST + ':' + TLS_PORT + '（Alt+A 圈屏/剪贴板需此安全上下文）')
      })
    } catch (e) { console.warn('[littleDJ] tls 启动失败（不影响 4097）: ' + e.message) }
  })()
}

/* ===== task280：问 AI（旁问）=====
   宿主侧三段：① 问后端要供应商的 baseURL + key（与 agent 用同一份，避免另存一套密钥）
               ② 读当前会话的完整消息当背景（只留 user/assistant 的纯文本 part）
               ③ 直连 <baseURL>/chat/completions（stream），转成 NDJSON 推给前端
   全程不碰 session/prompt：不建消息、不排队、不落盘 —— 主人要的「不入会话」。 */
const ASK_MAX_CTX = 200000
const ASK_MAX_TURNS = 40
const ASK_SYS = [
  '你是一个浮动小窗里的学习助手。用户在小 DJ 的界面里选中了一段文字，正在向你提问。',
  '',
  '最重要的一条：下面附上的「当前会话的对话记录」只是背景材料，不是你现在要接的话。',
  '不要接着说那段对话、不要点评它、也不要假装你在继续那场对话。你只回答用户在小窗里提的这一个问题。',
  '',
  '回答规则：',
  '1. 结合背景理解用户所指的那个概念，不要脱离背景泛泛而谈。',
  '2. 用户的目标是「搞懂知识点」：先一两句话说清它是什么、解决什么问题，再讲作用与特点，必要时和相近的概念做对比，最后给一个具体的小例子。',
  '3. 回答要短、要密，按行分段。用纯文本 + 简单的 1. 2. 3. 或 - 分点；不要写 Markdown 标题、表格、星号加粗、代码围栏。',
  '4. 背景里没有依据、你也不确定的，直接说不确定，不要编造。',
  '5. 你只能说话：不能执行命令、不能读写文件。'
].join('\n')
let _askProvCache = { at: 0, list: null }

function askProviders(cb) {
  if (_askProvCache.list && Date.now() - _askProvCache.at < 30000) return cb(null, _askProvCache.list)
  const preq = http.request({ host: BACKEND.host, port: BACKEND.port, method: 'GET', path: '/config/providers', headers: { authorization: AUTH_EXPECT } }, function (pres) {
    let b = ''
    pres.setEncoding('utf8')
    pres.on('data', function (c) { b += c })
    pres.on('end', function () {
      if (pres.statusCode !== 200) return cb(new Error('providers HTTP ' + pres.statusCode))
      let d = null
      try { d = JSON.parse(b) } catch (e) { return cb(new Error('providers 不是合法 JSON')) }
      _askProvCache = { at: Date.now(), list: (d && d.providers) || [] }
      cb(null, _askProvCache.list)
    })
  })
  preq.setTimeout(8000, function () { try { preq.destroy(new Error('timeout')) } catch (e) {} })
  preq.on('error', function (e) { cb(e) })
  preq.end()
}

function askTranscript(sessionId, cb) {
  if (!sessionId) return cb([])
  const preq = http.request({ host: BACKEND.host, port: BACKEND.port, method: 'GET', path: '/session/' + encodeURIComponent(sessionId) + '/message', headers: { authorization: AUTH_EXPECT } }, function (pres) {
    if (pres.statusCode !== 200) { pres.resume(); return cb([]) }
    let b = ''
    let bytes = 0
    pres.setEncoding('utf8')
    pres.on('data', function (c) { bytes += c.length; if (bytes <= 12000000) b += c })
    pres.on('end', function () {
      let arr = null
      try { arr = JSON.parse(b) } catch (e) { return cb([]) }
      if (!Array.isArray(arr)) return cb([])
      const out = []
      for (const m of arr) {
        const info = (m && m.info) || {}
        const role = info.role
        if (role !== 'user' && role !== 'assistant') continue
        const texts = []
        for (const p of (m.parts || [])) if (p && p.type === 'text' && typeof p.text === 'string' && p.text) texts.push(p.text)
        const t = texts.join('\n').trim()
        if (t) out.push({ role: role, content: t })
      }
      const kept = []
      let budget = ASK_MAX_CTX
      for (let i = out.length - 1; i >= 0; i--) {
        const it = out[i]
        if (it.content.length > budget) { kept.push({ role: it.role, content: it.content.slice(-budget) }); break }
        budget -= it.content.length
        kept.push(it)
        if (budget <= 0) break
      }
      kept.reverse()
      cb(kept)
    })
  })
  preq.setTimeout(25000, function () { try { preq.destroy(new Error('timeout')) } catch (e) {} })
  preq.on('error', function () { cb([]) })
  preq.end()
}

/* ===== task350：问 AI 联网 =====
   通路选型（2026-11-16 五路实测留痕，见 task350 牌）：
   智谱 MCP web_search_prime tools/call=-401 / 智谱按量 tools=1113 余额不足 / 智谱 coding chat 忽略 web_search 工具 /
   火山方舟 tools 报 MissingParameter(function calling 才认) —— 全不通；
   采用必应结果页直抓（零 key 零依赖，与比价爬虫 skills/model-pricing 同思路），搜到结果拼进最后一条 user 消息再走原链路流式。
   独立纯函数 askWebParse 供 selftest-ask-web 用真样本断言。 */
const ASK_WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
function askWebDecode(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#0?39;/g, "'")
    .replace(/&#(\d+);/g, function (m, n) { try { return String.fromCharCode(+n) } catch (e) { return m } })
    .replace(/\s+/g, ' ').trim()
}
function askWebParse(html) {
  const out = []
  const re = /<li class="b_algo[^"]*"[\s\S]*?<\/li>/g
  let m = null
  while ((m = re.exec(String(html || ''))) !== null) {
    if (out.length >= 5) break
    const block = m[0]
    const am = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block)
    if (!am) continue
    const url = askWebDecode(am[1])
    const title = askWebDecode(am[2]).slice(0, 120)
    if (!/^https?:\/\//.test(url) || !title) continue
    /* 摘要：h2 之后的所有 <p> 文本拼起来（b_caption/b_lineclamp 版式都覆盖），截 220 字 */
    const afterH2 = block.slice(block.indexOf('</h2>') >= 0 ? block.indexOf('</h2>') + 5 : 0)
    const psnips = []
    const pre = /<p[^>]*>([\s\S]*?)<\/p>/g
    let pm = null
    while ((pm = pre.exec(afterH2)) !== null) {
      const t = askWebDecode(pm[1])
      if (t && t.length > 8) psnips.push(t)
      if (psnips.join(' ').length > 240) break
    }
    out.push({ title: title, url: url, snip: psnips.join(' ').slice(0, 220) })
  }
  return out
}
function askWebSearch(query, cb) {
  let done = false
  const finish = function (results, fail) { if (done) return; done = true; cb(results && results.length ? results : null, fail || (results && results.length ? '' : '搜索无结果')) }
  const u = 'https://cn.bing.com/search?q=' + encodeURIComponent(String(query).slice(0, 120)) + '&count=6&mkt=zh-CN&setlang=zh-CN'
  let preq = null
  try {
    preq = https.request(u, { method: 'GET', headers: { 'user-agent': ASK_WEB_UA, 'accept-language': 'zh-CN,zh;q=0.9', accept: 'text/html,application/xhtml+xml' } }, function (pres) {
      if (pres.statusCode !== 200) { pres.resume(); return finish(null, '必应 HTTP ' + pres.statusCode) }
      let b = ''
      let bytes = 0
      pres.setEncoding('utf8')
      pres.on('data', function (c) { bytes += c.length; if (bytes <= 3000000) b += c; else { try { pres.destroy() } catch (e) {} } })
      pres.on('end', function () { finish(askWebParse(b), '') })
      pres.on('error', function (e) { finish(null, '读取失败：' + (e && e.message)) })
    })
  } catch (e) { return finish(null, '请求构造失败：' + (e && e.message)) }
  preq.setTimeout(12000, function () { try { preq.destroy(new Error('timeout')) } catch (e) {} })
  preq.on('error', function (e) { finish(null, '网络错误：' + ((e && e.message) || e)) })
  preq.end()
}
/* task364：联网=工具交给模型自判（主人定版「它自己有判断——问新模型才搜，常识题直答不浪费 token」）。
   task350/358 的「每次必搜/先搜后答」退役，改 OpenAI 兼容 function calling：
   tools:[web_search] + tool_choice:auto → 模型自判调不调；调了才真去必应，tool 结果回填后第二轮续答（二轮撤 tools 防循环）。 */
const ASK_WEB_SYS_ADD = '\n6. 你有一个 web_search 工具（必应搜索）。自己判断要不要用：问题涉及你训练数据截止之后或近期变化的信息（新模型发布、版本号、价格、新闻、时效数据）→ 先调用拿到结果再答，不要拿旧记忆硬答；常识、概念解释、代码、翻译、推理计算等不需要联网的 → 直接回答、不要调用（省时间省费用）。拿不准自己知不知道时，宁可搜一下。附带搜索结果时：新信息以结果为准（不要拿训练记忆反驳），可自然带出来源站点名，不罗列长 URL。'
const ASK_WEB_TOOLS = [{
  type: 'function',
  function: {
    name: 'web_search',
    description: '搜索互联网最新信息（必应）。仅当问题涉及你训练截止日期之后或近期变化的内容——新模型发布、版本更新、价格、新闻、时效性数据——时才调用；常识、概念、代码、翻译等不需要联网的问题一律不调用。',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: '搜索词（≤70 字，提炼问题核心，不要带「帮我搜一下」之类指令词）' } },
      required: ['query']
    }
  }
}]
/* 流式 tool_calls 分片拼接（OpenAI 兼容：delta.tool_calls 按 index 分片下发，arguments 逐片拼接、name/id 首片全量覆盖） */
function askToolAcc() { return { idx: [], calls: {} } }
function askToolMerge(acc, chunks) {
  if (!Array.isArray(chunks)) return acc
  chunks.forEach(function (c) {
    if (!c) return
    const i = (c.index != null) ? c.index : 0
    if (!acc.calls[i]) { acc.calls[i] = { id: '', name: '', args: '' }; acc.idx.push(i) }
    const t = acc.calls[i]
    if (c.id) t.id = c.id
    const fn = c.function || {}
    if (fn.name) t.name = fn.name
    if (fn.arguments) t.args += fn.arguments
  })
  return acc
}
function askToolDone(acc) {
  return (acc.idx || []).slice().sort(function (a, b) { return a - b }).map(function (i) {
    const t = acc.calls[i] || {}
    let args = {}
    try { args = JSON.parse(t.args || '{}') } catch (e) {}
    return { id: t.id || ('call_' + i), name: String(t.name || ''), query: String(args.query || '').trim().slice(0, 120) }
  })
}
function askWebBlockText(results) {
  const stamp = new Date().toISOString().slice(0, 10)
  const blockText = '【联网搜索结果 · ' + stamp + ' · 仅供参考、可能滞后】\n' +
    results.map(function (r, i) { return (i + 1) + '. 《' + r.title + '》' + (r.snip ? ' — ' + r.snip : '') + '\n   来源：' + r.url }).join('\n')
  return blockText.slice(0, 4500)
}

function askProxy(req, res, d) {
  const providerID = String((d && d.providerID) || '')
  const modelID = String((d && d.modelID) || '')
  const sessionId = String((d && d.sessionId) || '')
  const turnsIn = Array.isArray(d && d.turns) ? d.turns.slice(-ASK_MAX_TURNS) : []
  const wantWeb = !(d && d.web === false) /* task364：联网能力常开；搜不搜由模型经 tools 自判（web:false 显式关=不带 tools） */
  if (!providerID || !modelID) return json(res, 400, { error: '缺 providerID / modelID' })
  askProviders(function (err, list) {
    if (err) return json(res, 200, { error: '拿不到供应商配置：' + err.message })
    const prov = (list || []).filter(function (p) { return p && p.id === providerID })[0]
    if (!prov) return json(res, 200, { error: '供应商不存在：' + providerID })
    const base = (prov.options && (prov.options.baseURL || prov.options.baseUrl)) || ''
    const key = prov.key || ''
    if (!base) return json(res, 200, { error: '供应商 ' + providerID + ' 没有可用的接口地址（内置 agent 供应商不支持旁问）' })
    if (!key) return json(res, 200, { error: '供应商 ' + providerID + ' 还没有配置 API Key' })
    askTranscript(sessionId, function (history) {
      const messages = [{ role: 'system', content: ASK_SYS + (wantWeb ? ASK_WEB_SYS_ADD : '') }]
      for (const h of history) messages.push({ role: h.role, content: h.content })
      turnsIn.forEach(function (t) {
        if (!t) return
        const role = t.role === 'assistant' ? 'assistant' : 'user'
        const text = typeof t.text === 'string' ? t.text.slice(0, 20000) : ''
        if (text.trim()) messages.push({ role: role, content: text })
      })
      if (!messages.length || messages[messages.length - 1].role !== 'user') return json(res, 200, { error: '没有问题内容' })
      let u = null
      try { u = new URL(base) } catch (e) { return json(res, 200, { error: '供应商接口地址不合法：' + base }) }
      const mod = u.protocol === 'https:' ? https : http
      const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80)
      const pathName = String(u.pathname || '').replace(/\/$/, '') + '/chat/completions'
      /* task364：响应头/事件通道一次性建好（第一轮与第二轮共用；depth=轮次，0=首轮，1=搜索后续答） */
      let headersSent = false
      let closed = false
      const push = function (o) { if (closed || res.writableEnded) return; try { res.write(JSON.stringify(o) + '\n') } catch (e) { closed = true } }
      res.on('close', function () { closed = true })
      const finish = function () { push({ type: 'done' }); if (!res.writableEnded) res.end() }
      /* useTools：首轮 wantWeb→auto（模型自判）；二轮恒 false（防无限搜索循环）；400 降级重试也 false */
      const go = function (useTools, depth) {
        const payload = { model: modelID, messages: messages, stream: true }
        if (useTools) { payload.tools = ASK_WEB_TOOLS; payload.tool_choice = 'auto' }
        const preq = mod.request({
          host: u.hostname, port: port, method: 'POST', path: pathName,
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, 'accept-encoding': 'identity', 'content-length': Buffer.byteLength(JSON.stringify(payload)) }
        }, function (pres) {
          if (!headersSent) {
            res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no' })
            headersSent = true
            push({ type: 'start', backed: history.length })
          }
          if (pres.statusCode !== 200) {
            let b = ''
            pres.setEncoding('utf8')
            pres.on('data', function (c) { b += c })
            pres.on('end', function () {
              /* task364 降级：带 tools 收 400 ≈ 上游不支持 function calling → notice + 一次性无 tools 重试（depth 不限，同轮降级） */
              if (useTools && pres.statusCode === 400 && depth === 0) {
                push({ type: 'notice', message: '该模型不支持工具调用，联网已让位——按离线知识回答' })
                return go(false, depth)
              }
              let msg = '模型接口 HTTP ' + pres.statusCode
              try { const j = JSON.parse(b); if (j && j.error && (j.error.message || j.error.code)) msg += '：' + (j.error.message || j.error.code) } catch (e) { if (b) msg += '：' + b.slice(0, 200) }
              push({ type: 'error', message: msg })
              finish()
            })
            return
          }
          let buf = ''
          const toolAcc = askToolAcc()
          let rcAcc = '' /* task364：DeepSeek 思考模式要求续轮把 reasoning_content 传回（漏传=HTTP 400）；只回传不推前端 */
          pres.setEncoding('utf8')
          pres.on('data', function (c) {
            buf += c
            let i
            while ((i = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, i).trim()
              buf = buf.slice(i + 1)
              if (!line || line.indexOf('data:') !== 0) continue
              const data = line.slice(5).trim()
              if (data === '[DONE]') continue
              let j = null
              try { j = JSON.parse(data) } catch (e) { continue }
              const ch = j && j.choices && j.choices[0]
              const dl = ch && ch.delta
              if (!dl) continue
              if (typeof dl.content === 'string' && dl.content) push({ type: 'delta', text: dl.content })
              if (typeof dl.reasoning_content === 'string' && dl.reasoning_content) rcAcc += dl.reasoning_content
              if (dl.tool_calls) askToolMerge(toolAcc, dl.tool_calls)
            }
          })
          pres.on('end', function () {
            const calls = askToolDone(toolAcc)
            const ws = calls.filter(function (c) { return c.name === 'web_search' && c.query })[0]
            if (ws && depth === 0) {
              /* 模型判断需要联网 → 真去必应 → tool 结果回填 → 第二轮流式续答（撤 tools 防循环） */
              askWebSearch(ws.query, function (results, failMsg) {
                const asstMsg = { role: 'assistant', content: '', tool_calls: [{ id: ws.id, type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: ws.query }) } }] }
                if (rcAcc) asstMsg.reasoning_content = rcAcc /* DeepSeek 思考模式续轮必须回传 */
                messages.push(asstMsg)
                if (results && results.length) {
                  push({ type: 'search', count: results.length, query: ws.query })
                  messages.push({ role: 'tool', tool_call_id: ws.id, content: askWebBlockText(results) })
                } else {
                  push({ type: 'notice', message: '联网搜索没成功（' + (failMsg || '未知原因') + '），请直接凭已有知识回答并说明可能过时' })
                  messages.push({ role: 'tool', tool_call_id: ws.id, content: '搜索失败：' + (failMsg || '未知原因') + '。请直接凭已有知识回答，并声明信息可能过时。' })
                }
                go(false, depth + 1)
              })
              return
            }
            finish()
          })
          pres.on('error', function (e) { push({ type: 'error', message: '上游错误：' + ((e && e.message) || e) }); if (!res.writableEnded) res.end() })
          res.on('close', function () { closed = true; try { preq.destroy() } catch (e) {} })
        })
        preq.setTimeout(180000, function () { try { preq.destroy(new Error('timeout')) } catch (e) {} })
        preq.on('error', function (e) {
          if (!headersSent && !res.headersSent) return json(res, 200, { error: '连不上模型接口：' + ((e && e.message) || e) })
          if (!res.writableEnded) { try { res.write(JSON.stringify({ type: 'error', message: '连不上模型接口：' + ((e && e.message) || e) }) + '\n') } catch (e2) {} res.end() }
        })
        preq.end(JSON.stringify(payload))
      }
      go(wantWeb, 0)
    })
  })
}

module.exports = {
  deriveTasksSafe: deriveTasksSafe,
  staleFlagOf: staleFlagOf,
  saveOverrideOp: saveOverrideOp, // task126：供单测直调（绕过派生校验的隔离环境）
  appendTaskEvent: appendTaskEvent,
  writeTaskEvents: writeTaskEvents,
  taskStatsOf: taskStatsOf,
  stuckMsOf: stuckMsOf,
  unionMsOf: unionMsOf,
  dayKeyOf: dayKeyOf,
  isLegacyTaskUpsert: isLegacyTaskUpsert,
  bootLedgerText: bootLedgerText,
  tasksGetPayload: tasksGetPayload,
  taskOpPayload: taskOpPayload,
  loadOverrides: loadOverrides,
  applyOverrides: applyOverrides,
  etaMapOf: etaMapOf, // task119：/_tasks 尾部 eta 映射（供单测/御史静态复核）
  // task254：任务队列纯函数/链路（供单测/御史复核）
  queuePositionOf: queuePositionOf,
  queueAheadOf: queueAheadOf,
  queuePromote: queuePromote,
  queueHygiene: queueHygiene,
  writeOverrideStore: writeOverrideStore,
  taskDbOpen: taskDbOpen,
  TASK_STALE_MS: TASK_STALE_MS,
  // task157：auto-reap 判定纯函数（供 selftest 直调）
  reapDecide: reapDecide,
  autoReapTick: autoReapTick,
  // task184：派单角色核对（供 selftest/御史复核）
  agentCheckStep: agentCheckStep,
  agentCheckStateLoad: agentCheckStateLoad,
  // task80 S2a 队列内部函数（供单测/御史静态复核，不对外暴露 HTTP）
  queueBoot: queueBoot,
  queueLoad: queueLoad,
  queueEnqueue: queueEnqueue,
  queueRemove: queueRemove,
  queueClear: queueClear,
  queuePayload: queuePayload,
  queueShouldQueue: queueShouldQueue,
  queueDispatch: queueDispatch,
  queuePauseNonEmpty: queuePauseNonEmpty
}

'use strict'
/**
 * task194：模型比价 skill（第 1 个定时 skill）
 * - 抓取各供应商公开定价页 → 解析统一 schema → 落盘 <ROOT>/data/model-prices/
 * - 本期数据源：DeepSeek 官方定价页（Docusaurus 静态 HTML，服务端渲染表格，直解析）
 * - 失败保留旧数据（不覆盖 latest.json），结果里报错误
 * - 方案审 P1-1：integration「已接入✓」用硬编码 known 映射（真实 provider 配置在 deveco.jsonc，不直读）
 */
const fs = require('fs')
const path = require('path')
const os = require('os')
const https = require('https')
const http = require('http')

const ROOT = require('../paths').ROOT
const DATA_DIR = path.join(ROOT, 'data', 'model-prices')
const LATEST = path.join(DATA_DIR, 'latest.json')

// 已接入供应商（硬编码映射：deepseek/zhipu-plan 为当前后台已配置的两通道；task281 撤 zhipu 按量源——主人只用 Token Plan；
// task303 加 volc-ark 比价；task348 起 volc-ark 标已接入——Key 管理（task328）与本机 serve volcengine provider（10 模型）均已就位）
const KNOWN_PROVIDERS = {
  deepseek: { linked: true, providerKey: 'deepseek', note: '已接入（本机中转 4099）' },
  'zhipu-plan': { linked: true, providerKey: 'zhipuai-coding-plan', note: '已接入（Token Plan · 本机中转 4100）' },
  'volc-ark': { linked: true, providerKey: 'volcengine', note: '已接入（火山方舟 Ark · OpenAI 兼容 /api/v3）' }
}

// task207：各通道接入 URL（比价表「接口」列数据源；主人点名 GLM 官方与 Token Plan URL 不同，DeepSeek 同理）
const API_BASES = {
  deepseek: { api: 'api.deepseek.com', apiFull: 'https://api.deepseek.com（OpenAI 兼容 · 本机中转 4099）' },
  'zhipu-plan': { api: 'open.bigmodel.cn/api/coding/paas/v4', apiFull: 'https://open.bigmodel.cn/api/coding/paas/v4（Coding Plan 专用；另有 /api/anthropic、/api/v1 端点）' },
  'volc-ark': { api: 'ark.cn-beijing.volces.com/api/v3', apiFull: 'https://ark.cn-beijing.volces.com/api/v3（OpenAI 兼容 · 推理接入点 endpoint id 调用）' }
}

const DEFAULTS = {
  sources: [{
    id: 'deepseek',
    name: 'DeepSeek 官方',
    url: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    enabled: true,
    credential: { user: '', pass: '' }
  }, {
    id: 'zhipu-plan',
    name: 'GLM Token Plan',
    url: 'https://docs.bigmodel.cn/cn/coding-plan/overview.md', // task207：文档站 markdown 原文（积分抵扣系数表为 HTML <table>，含 rowSpan）
    enabled: true,
    credential: { user: '', pass: '' }
  }, {
    id: 'volc-ark',
    name: '火山方舟（火山引擎）', // task303：主人说「火山方舟和火山引擎」——同一家（方舟=火山引擎旗下大模型平台），双关键词并入一名防同页重复
    url: 'https://www.volcengine.com/docs/82379/1099320', // 301→docs.volcengine.com/docs/ark/model-pricing（fetchText 跟随重定向 200 可抓）
    enabled: true,
    credential: { user: '', pass: '' }
  }],
  schedule: { mode: 'every3days', time: '08:00', enabled: true }
}

// ---------- HTTP ----------
/* task307：源级请求头集 + 瘦版免疫轮抓。
   火山 CDN 边缘节点对部分请求（UA/节点/时间组合随机）回「客户端渲染瘦版」（0 个 <table>，文档数据藏在编辑器 delta JSON 里），
   换请求头重连即可能换节点缓存拿到 SSR 完整版——故 volc-ark 用「浏览器头→基础头→浏览器头」三轮 + 表格校验；
   其他源（deepseek/zhipu-plan）单次直抓不变（它们无此现象，多抓徒增耗时）。 */
const HEADER_SETS = {
  browser: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Upgrade-Insecure-Requests': '1'
  }
}
const FETCH_PLANS = {
  'volc-ark': ['browser', null, 'browser']
}
function fetchText (url, timeoutMs, depth, extraHeaders) {
  depth = Number(depth) || 0
  return new Promise(function (resolve, reject) {
    let u
    try { u = new URL(url) } catch (e) { return reject(new Error('URL 不合法')) }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('只支持 http/https'))
    const mod = u.protocol === 'https:' ? https : http
    const headers = {
      'User-Agent': 'littleDJ-pricing-bot/1.0 (+personal use; low frequency)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
    if (extraHeaders && typeof extraHeaders === 'object') {
      Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k] })
    }
    const req = mod.get(u, { headers: headers }, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        // 产出审 P1-2：环形重定向无限外发循环 → 5 跳上限
        if (depth >= 5) return reject(new Error('重定向超过 5 跳（疑似环形）'))
        return fetchText(new URL(res.headers.location, url).href, timeoutMs, depth + 1, extraHeaders).then(resolve, reject)
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      const chunks = []
      let size = 0
      res.on('data', function (c) {
        size += c.length
        if (size > 3 * 1024 * 1024) { req.destroy(); return reject(new Error('页面过大（>3MB）')) }
        chunks.push(c)
      })
      res.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')) })
      res.on('error', reject)
    })
    req.setTimeout(Number(timeoutMs) || 25000, function () { req.destroy(); reject(new Error('请求超时')) })
    req.on('error', reject)
  })
}
/* task307：文档抓取（带瘦版免疫）——按源计划多套头轮抓，任一轮拿到「含表格」页面即返；全失败回退末次结果（保底行为同旧版，由解析器报结构错误） */
async function fetchDoc (url, timeoutMs, srcId) {
  const plan = FETCH_PLANS[srcId] || [null]
  let last = null
  for (let i = 0; i < plan.length; i++) {
    const setName = plan[i]
    const html = await fetchText(url, timeoutMs, 0, setName ? HEADER_SETS[setName] : null)
    if (/<table/i.test(html)) return html
    last = html
  }
  return last
}

// ---------- 解析工具 ----------
function stripTags (s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function parseTableRows (tableHtml) {
  const rows = String(tableHtml || '').match(/<tr[\s\S]*?<\/tr>/gi) || []
  return rows.map(function (r) {
    const cells = r.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || []
    return cells.map(stripTags)
  })
}

function cleanModelName (s) {
  return String(s || '').replace(/\(\d+\)$/, '').trim()
}

/**
 * 解析 DeepSeek 定价页（Docusaurus 静态表格）
 * 表格为「键 | 各模型列」布局；价格区多行：档位行 + 空闲/高峰时段行（数值按模型列顺序）
 * 返回 { provider, providerKey, integration, source, fetchedAt, models[], extras[] }
 */
function parseDeepSeek (html, sourceUrl) {
  const tables = String(html || '').match(/<table[\s\S]*?<\/table>/gi) || []
  if (!tables.length) throw new Error('页面里没找到表格（结构可能已改版）')
  const rows = parseTableRows(tables[0])
  if (rows.length < 5) throw new Error('定价表行数异常（结构可能已改版）')

  // 1) 模型名列
  const headRow = rows.filter(function (r) { return r[0] && /模型/.test(r[0]) && r.length >= 2 })[0]
  if (!headRow) throw new Error('找不到「模型」表头行')
  const models = headRow.slice(1).map(cleanModelName).filter(Boolean).map(function (name) {
    return {
      name: name,
      category: 'text', // 尺三：本期单一枚举
      contextText: '',
      maxOutputText: '',
      price: { inputHit: {}, inputMiss: {}, output: {} },
      limits: {},
      free: false
    }
  })
  if (!models.length) throw new Error('模型列表为空')

  // 2) 逐行提取基础字段（vals 少于模型数=共享单元格，全模型同值）
  const spread = function (vals, fn) {
    if (!vals || !vals.length) return
    if (vals.length === 1) { models.forEach(function (m) { fn(m, vals[0]) }); return }
    models.forEach(function (m, i) { if (vals[i]) fn(m, vals[i]) })
  }
  rows.forEach(function (r) {
    const label = String(r[0] || '').replace(/\(\d+\)$/, '').trim()
    const vals = r.slice(1)
    if (label === '上下文长度') spread(vals, function (m, v) { m.contextText = v })
    if (label === '输出长度') spread(vals, function (m, v) { m.maxOutputText = v })
    if (label === '并发限制') spread(vals, function (m, v) { m.limits.concurrency = v })
  })

  // 3) 价格区：档位（缓存命中/未命中/输出）× 时段（空闲/高峰）× 模型列
  let tier = ''
  rows.forEach(function (r) {
    const txt = r.join('|')
    if (/缓存未命中/.test(txt)) tier = 'inputMiss'
    else if (/缓存命中/.test(txt)) tier = 'inputHit'
    else if (/百万tokens输出/.test(txt)) tier = 'output'
    const period = /高峰/.test(txt) ? 'peak' : (/空闲/.test(txt) ? 'offpeak' : '')
    if (!tier || !period) return
    const nums = r.map(function (c) {
      const m = /^(\d+(?:\.\d+)?)\s*元$/.exec(String(c || '').trim())
      return m ? Number(m[1]) : null
    }).filter(function (x) { return x !== null })
    if (nums.length === models.length) {
      models.forEach(function (m, i) { m.price[tier][period] = nums[i] })
    }
  })

  // 4) 附加 API 定价（Search / Fetch / OCR / TTS / ASR 等）——task307：遍历全部「API|计费单位|价格」型表（原来只收第 2 个表，DS 11-13 全家桶 API 后价目表增至 4 个）
  const extras = []
  const cny = function (v) {
    const m = /(\d+(?:\.\d+)?)\s*元/.exec(String(v || ''))
    return m ? Number(m[1]) : null
  }
  tables.slice(1).forEach(function (tb) {
    parseTableRows(tb).forEach(function (r) {
      if (r.length >= 3 && r[0] && !/^(API|项目)$/.test(r[0])) extras.push({ api: r[0], unit: r[1], price: r[2], disc: r[3] || '' })
    })
  })
  /* 5) task307：能力价目 → 比价行（主人定规「所有模型都要进模型比价」）。
     TTS/ASR → category 'audio'、OCR → 'image'（类别筛选下拉两枚举现成）；
     价格挂 output 单值 + price.unit 计价单位标签（UI 跨量纲自动排末尾，同 Token Plan 积分行机制）；
     刊例价入库，限时折扣不塞 offpeak/peak（该区间在 UI 语义=空闲~高峰，塞折扣会被误读）；
     name 带中文括注 → UI 拆灰标签（task212 现成）。
     task345（主人定规「上下文就是上下文，每栏做每栏的事」）：能力介绍+限时折扣写模型级 note 字段
     → UI「备注」列；contextText 恒空（能力 API 无上下文窗口概念，上下文列显 —）。 */
  const CAP_ROWS = [
    { re: /TTS|语音合成/, name: 'DeepSeek TTS（语音合成）', category: 'audio', note: function (p) { return 'stella 女 / tide 男 · 10 语言 · 流式 · 单次≤30 分钟音频' + (p.disc ? ' · 限时 5 折 ' + p.disc + ' 元/万字' : '') } },
    { re: /ASR|语音识别/, name: 'DeepSeek ASR（语音识别）', category: 'audio', note: function (p) { return 'WAV/Opus · ≤120 秒/次 · 不支持流式 · 20 语言自动识别' + (p.disc ? ' · 限时 5 折 ' + p.disc + ' 元/小时' : '') } },
    { re: /OCR|文件解析/, name: 'DeepSeek OCR（文件解析）', category: 'image', note: function () { return 'PDF/Office/图片 → 文本/图文混排' } }
  ]
  extras.forEach(function (e) {
    const cap = CAP_ROWS.filter(function (c) { return c.re.test(e.api) })[0]
    if (!cap) return
    const p = cny(e.price)
    if (p == null) return
    const disc = /\d+(?:\.\d+)?\s*元/.test(String(e.disc || '')) ? cny(e.disc) : null
    models.push({
      name: cap.name,
      category: cap.category,
      contextText: '',
      note: cap.note({ disc: disc != null ? String(disc) : null }),
      maxOutputText: '',
      price: { unit: e.unit ? String(e.unit).replace('每 ', '每').replace(/\s+/g, '') : '', inputMiss: {}, inputHit: {}, output: { offpeak: p, peak: p } },
      limits: {},
      free: false
    })
  })

  return {
    provider: 'DeepSeek 官方',
    providerKey: 'deepseek',
    integration: KNOWN_PROVIDERS.deepseek,
    source: sourceUrl || DEFAULTS.sources[0].url,
    fetchedAt: new Date().toISOString(),
    models: models,
    extras: extras
  }
}

/**
 * task207：解析 GLM Token Plan（Coding Plan）套餐概览 markdown
 * 数据源 docs.bigmodel.cn/cn/coding-plan/overview.md：积分额度表（markdown 管道表）+ 抵扣系数表（HTML <table>，含 rowSpan 合并格）
 * - 抵扣系数表按「产品名称」格锚定 GLM-* 行（rowSpan 使首列时有时无，靠名称定位免疫列错位），取名称后 3 个数值=Input/Cached/Output 系数
 * - MCP 工具三行名称非 GLM-* 自然跳过
 * - 非高峰 5 折 → price.unit='积分'、offpeak=系数×0.5、peak=系数（前端标「积分」并退出 best/数值排序，方案审 P1-2）
 * - 月费无静态公开源（docs/主站均无，主站为 SPA 空壳）→ 不编数，note 指引官网购买页
 */
function parseZhipuPlan (md, sourceUrl) {
  const text = String(md || '')
  const tables = text.match(/<table[\s\S]*?<\/table>/gi) || []
  if (!tables.length) throw new Error('页面里没找到抵扣系数表（结构可能已改版）')
  let rows = null
  tables.forEach(function (tb) {
    if (rows) return
    const rs = parseTableRows(tb)
    if (rs.length && rs[0].some(function (h) { return /Input\s*抵扣系数/.test(String(h || '')) })) rows = rs
  })
  if (!rows) throw new Error('没找到含「Input 抵扣系数」的表（结构可能已改版）')
  const num = function (v) {
    const m = /^-?\d+(?:\.\d+)?$/.exec(String(v || '').trim())
    return m ? Number(m[0]) : null
  }
  const half = function (v) { return Math.round(v * 50) / 100 }
  const models = []
  rows.forEach(function (r) {
    if (!r || !r.length) return
    let ni = -1
    for (let i = 0; i < r.length; i++) { if (/^GLM-/i.test(String(r[i] || ''))) { ni = i; break } }
    if (ni < 0) return /* 表头 / MCP 工具行（联网搜索等）不命中 */
    const nums = r.slice(ni + 1).map(num).filter(function (v) { return v != null })
    if (nums.length < 3) return
    const inp = nums[0], hit = nums[1], out = nums[2]
    models.push({
      name: cleanModelName(r[ni]),
      category: 'text',
      contextText: '1M（[1m] 后缀）',
      maxOutputText: '',
      price: {
        unit: '积分',
        inputMiss: { offpeak: half(inp), peak: inp },
        inputHit: { offpeak: half(hit), peak: hit },
        output: { offpeak: half(out), peak: out }
      },
      limits: {},
      free: false
    })
  })
  if (!models.length) throw new Error('没解析出任何模型（结构可能已改版）')
  const defUrl = (DEFAULTS.sources.filter(function (s) { return s.id === 'zhipu-plan' })[0] || {}).url
  return {
    provider: 'GLM Token Plan',
    providerKey: 'zhipuai-coding-plan',
    integration: KNOWN_PROVIDERS['zhipu-plan'],
    source: sourceUrl || defUrl,
    fetchedAt: new Date().toISOString(),
    note: '订阅积分制：系数单位=积分（每万 tokens 量级），非高峰 5 折；额度 Lite 2,000/5h·10,000/周｜Pro 12,000·60,000｜Max 28,000·140,000；官方口径较按量最高省 92%；月费见官网购买页',
    models: models,
    extras: []
  }
}

/**
 * task303：解析火山方舟（火山引擎 Ark）模型服务价格页
 * 数据源 volcengine.com/docs/82379/1099320（ace-table 编辑器渲染，服务端直出 HTML 表格）：
 * - 页面同表渲染两份（sticky-header 副本带 aria-hidden="true"），必须排除防行×2
 * - 5 个「模型名称」表按序=在线推理（常规）/低延迟/低优/TPM/批量——**只收第一个命中表（常规）**，与 DeepSeek/GLM 按量口径可比
 * - 模型名列 rowspan + 续行空占位 td 混杂 → 不做位置展开，用「值推进」：首格像条件→无名续行；首格空→回溯 lastName
 * - 「空闲/高峰时段」行 = 分时段定价 → 合并进同模型条目 price.*.{offpeak,peak}（UI 显区间、排序用 offpeak）
 * - 同模型按输入长度分档（[0,32]/(32,128]/(128,256]）一档一行（UI「〃」合并现成，task278）
 * - 表内还有 glm/kimi/deepseek 等火山代售第三方模型，全收（跨平台比价）
 * - 「调整前价格…不适用」旧价行按关键词过滤；单元格含零宽字符 U+200B 清洗
 * - 无分时段模型 offpeak=peak 同值（UI 单值展示、正常参与排序）
 */
function parseVolcArk (html, sourceUrl) {
  const tables = String(html || '').match(/<table[\s\S]*?<\/table>/gi) || []
  const zw = function (s) { return String(s || '').replace(/\u200B/g, '') }
  const num = function (v) {
    const m = /^(\d+(?:\.\d+)?)$/.exec(zw(v).trim())
    return m ? Number(m[1]) : null
  }
  const isCond = function (s) { return /^(输入长度|空闲时段|高峰时段|-)/.test(zw(s)) }
  let target = null
  for (let i = 0; i < tables.length && !target; i++) {
    if (/aria-hidden="true"/.test(tables[i].slice(0, 400))) continue /* sticky-header 副本防行×2 */
    const rows = parseTableRows(tables[i])
    if (!rows.length) continue
    const head = rows[0].map(zw)
    if ((head[0] || '').indexOf('模型名称') < 0) continue
    let cin = -1, chit = -1, cout = -1 /* 表头列定位：容忍半角/全角括号两种形态（表内半角、表间全角都出现过） */
    head.forEach(function (h, j) {
      if (/输入[（(]非音频[）)]/.test(h)) cin = j
      else if (/缓存命中[（(]非音频[）)]/.test(h)) chit = j
      else if (/^输出/.test(h)) cout = j
    })
    if (cin > 0 && cout > cin) target = { rows: rows, cin: cin, chit: chit, cout: cout }
  }
  if (!target) throw new Error('找不到「在线推理（常规）」定价表（结构可能已改版）')
  const models = []
  const seen = {}
  let lastName = ''
  let lastEntry = null
  target.rows.forEach(function (r0, ri) {
    if (!ri) return
    const cells = r0.map(zw)
    let name, cond, vals
    if (isCond(cells[0])) { name = lastName; cond = zw(cells[0]).trim(); vals = cells.slice(1) }
    else {
      name = (cells[0] || '').trim() || lastName /* 空占位 td 续行回溯上一模型名 */
      cond = zw(cells[1] || '').trim()
      vals = cells.slice(2)
    }
    if (!name || /不适用/.test(name)) return /* 「调整前价格…不适用」旧价行过滤 */
    lastName = name
    const pick = function (col) { return col > 1 ? num(vals[col - 2]) : null }
    const miss = pick(target.cin)
    const hit = pick(target.chit)
    const out = pick(target.cout)
    if (/空闲时段|高峰时段/.test(cond)) {
      const slot = /空闲/.test(cond) ? 'offpeak' : 'peak'
      let e = (lastEntry && lastEntry.name === name) ? lastEntry : null
      if (!e) { /* 时段行首现（前面没有普通行）→ 新建条目，另一时段等下一行补 */
        e = { name: name, category: 'text', contextText: '', maxOutputText: '',
          price: { inputMiss: { offpeak: null, peak: null }, inputHit: { offpeak: null, peak: null }, output: { offpeak: null, peak: null } },
          limits: {}, free: false }
        models.push(e)
        lastEntry = e
      }
      if (miss != null) e.price.inputMiss[slot] = miss
      if (hit != null) e.price.inputHit[slot] = hit
      if (out != null) e.price.output[slot] = out
      e.free = e.price.inputMiss.peak === 0 && e.price.output.peak === 0
      return
    }
    if (miss == null && out == null) return
    const key = name + '|' + cond
    if (seen[key]) return /* 同名同档跨表重复去重 */
    seen[key] = 1
    const entry = { name: name, category: 'text', contextText: cond === '-' ? '' : cond, maxOutputText: '',
      price: { inputMiss: { offpeak: miss, peak: miss }, inputHit: { offpeak: hit, peak: hit }, output: { offpeak: out, peak: out } },
      limits: {}, free: miss === 0 && out === 0 }
    models.push(entry)
    lastEntry = entry
  })
  if (!models.length) throw new Error('没解析出任何模型（结构可能已改版）')
  const defUrl = (DEFAULTS.sources.filter(function (s) { return s.id === 'volc-ark' })[0] || {}).url
  return {
    provider: '火山方舟（火山引擎）',
    providerKey: 'volc-ark',
    integration: KNOWN_PROVIDERS['volc-ark'],
    source: sourceUrl || defUrl,
    fetchedAt: new Date().toISOString(),
    note: '按量后付费·在线推理（常规）·元/百万 tokens；同模型按输入长度分档（相邻行「〃」合并）；部分模型分空闲/高峰时段；另有音频输入价、低延迟/低优/批量模式与视频图像生成模型见官网',
    models: models,
    extras: [{ api: '缓存存储', unit: '元/M token/小时', price: '0.017' }]
  }
}

// ---------- 运行入口 ----------
async function run (settings) {
  const cfg = settings && typeof settings === 'object' ? settings : DEFAULTS
  const sources = Array.isArray(cfg.sources) ? cfg.sources : DEFAULTS.sources
  const providers = []
  const errors = []
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i]
    if (!src || src.enabled === false) continue
    try {
      const html = await fetchDoc(src.url, 25000, src.id)
      let data
      if (src.id === 'deepseek') data = parseDeepSeek(html, src.url)
      else if (src.id === 'zhipu-plan') data = parseZhipuPlan(html, src.url)
      else if (src.id === 'volc-ark') data = parseVolcArk(html, src.url)
      else throw new Error('暂无「' + String(src.id) + '」解析器（S3+ 逐家接入）')
      const ab = API_BASES[src.id] || {}
      data.api = ab.api || '' /* task207：比价表「接口」列（短显示/title 全量） */
      data.apiFull = ab.apiFull || ''
      providers.push(data)
    } catch (e) {
      errors.push(String(src.id || src.name || ('source' + i)) + '：' + String((e && e.message) || e).slice(0, 200))
    }
  }

  // 落盘：有成功数据才覆盖；失败保留旧文件（前端据 updatedAt 判定过期）
  if (providers.length) {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true })
      const payload = { updatedAt: new Date().toISOString(), providers: providers, errors: errors }
      const tmp = LATEST + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2))
      fs.renameSync(tmp, LATEST)
      const hd = path.join(DATA_DIR, 'history')
      fs.mkdirSync(hd, { recursive: true })
      fs.writeFileSync(path.join(hd, new Date().toISOString().slice(0, 10) + '.json'), JSON.stringify(payload, null, 2))
    } catch (e) {
      return { ok: false, count: 0, error: '落盘失败：' + String((e && e.message) || e).slice(0, 200) }
    }
  }

  const count = providers.reduce(function (n, p) { return n + p.models.length }, 0)
  if (!providers.length) return { ok: false, count: 0, error: errors.join('；') || '没有启用的数据源' }
  return { ok: true, count: count, error: errors.join('；') }
}

/* task348：接入状态按当前映射即时校正（读时自愈）。
   比价缓存每 3 天抓一次，而「已接入」是硬编码映射、会随接入进度变化——只读文件会出现
   「Key 已录入、页面仍显未接入」的陈旧分裂（本次主人目检即此）。读取时以 KNOWN_PROVIDERS 覆盖
   integration，抓取链路与落盘格式不变。 */
function integrationOf (provider) {
  const name = String((provider && provider.provider) || '')
  if (/deepseek/i.test(name)) return KNOWN_PROVIDERS.deepseek
  if (/glm|token\s*plan/i.test(name)) return KNOWN_PROVIDERS['zhipu-plan']
  if (/火山|volc/i.test(name)) return KNOWN_PROVIDERS['volc-ark']
  return null
}
function readLatest () {
  try {
    const d = JSON.parse(fs.readFileSync(LATEST, 'utf8'))
    if (d && Array.isArray(d.providers)) {
      d.providers.forEach(function (p) {
        const ig = integrationOf(p)
        if (ig) p.integration = ig
      })
    }
    return d
  } catch (e) { return null }
}

/**
 * task205：启动迁移——把新增默认数据源（zhipu）并进存量 skills.json（幂等）
 * 同 id 已存在则不动（保留用户的禁用/改写语义）；必须在 scheduler 首次读配置前调用。
 */
function migrateConfig () {
  try {
    const CFG_FILE = path.join(ROOT, 'config', 'skills.json')
    let cfg = null
    try { cfg = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')) } catch (e) { return true /* 无配置文件：scheduler 会走 defaults 全新初始化 */ }
    const entry = cfg && cfg.skills && cfg.skills['model-pricing']
    if (!entry || !Array.isArray(entry.settings && entry.settings.sources)) return true
    /* task207：按 id 补缺源（替代旧版固定下标 sources[1]，防下标漂移，方案审 P2-4）——同 id 已存在一律不动，保留用户禁用/自定义语义 */
    const have = {}
    entry.settings.sources.forEach(function (s) { if (s && s.id) have[s.id] = 1 })
    let changed = false
    /* task228/task281：退役源清理（OpenAI 通道已撤；zhipu 按量源已撤——主人只用 Token Plan，残留配置幂等删除防复抓） */
    const RETIRED_SOURCES = ['openai', 'zhipu']
    const before = entry.settings.sources.length
    entry.settings.sources = entry.settings.sources.filter(function (s) { return !s || RETIRED_SOURCES.indexOf(s.id) < 0 })
    if (entry.settings.sources.length !== before) changed = true
    entry.settings.sources.forEach(function (s) { if (s && s.id) have[s.id] = 1 })
    DEFAULTS.sources.forEach(function (d) {
      if (have[d.id]) return
      entry.settings.sources.push(JSON.parse(JSON.stringify(d)))
      changed = true
    })
    if (!changed) return true
    const tmp = CFG_FILE + '.tmp-' + process.pid
    fs.mkdirSync(path.dirname(CFG_FILE), { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2))
    fs.renameSync(tmp, CFG_FILE)
    return true
  } catch (e) { return false /* 迁移失败不阻断启动：缺的源不生效，已有源照跑 */ }
}

module.exports = {
  id: 'model-pricing',
  name: '模型比价',
  defaults: DEFAULTS,
  run: run,
  readLatest: readLatest,
  migrateConfig: migrateConfig,
  _test: { parseDeepSeek: parseDeepSeek, parseZhipuPlan: parseZhipuPlan, parseVolcArk: parseVolcArk, integrationOf: integrationOf, migrateConfig: migrateConfig, parseTableRows: parseTableRows, stripTags: stripTags, fetchText: fetchText, fetchDoc: fetchDoc, LATEST: LATEST }
}

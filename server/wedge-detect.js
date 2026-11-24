// wedge-detect: 会话卡死（半开回合）判定纯函数（task316）
// 事故背景：2026-11-15 13:40 大管家回合在 question 工具上等主人回答 46 分钟；主人答完
// （14:27:45）紧接着又发一条「继续」（14:27:53），serve 把新提示词收进库却不再起回合——
// 会话留下「assistant 未 completed + 之后还有 user 消息」的半开态；左栏按「本会话有没有在跑的回合」
// 判 idle → 显示「空闲中」，主人看到的就是「卡住但像闲着」。
// 本模块只做判定（纯函数，可打表）：不碰网络、不写文件。
// 判定值域：wedged=true 只覆盖「半开回合」——最后一条 assistant 缺 time.completed/error，
// 且（已有后发 user 消息 或 尾部件静默超过 idleMs），并且不是「等主人回答的 question」、
// 不是「工具还在跑」、不是「刚发生」。
'use strict'

function normMsgs(d) {
  const arr = Array.isArray(d) ? d : (d && Array.isArray(d.data) ? d.data : [])
  return arr.map(function (m) { return m && m.info ? m : { info: m || {}, parts: (m && m.parts) || [] } })
}

function partAt(p) {
  const t = (p && p.time) || {}
  return Number(t.end || t.start || 0) || 0
}

function lastPartAt(m) {
  let mx = 0
  for (const p of (m.parts || [])) {
    const a = partAt(p)
    if (a > mx) mx = a
  }
  return mx || ((m.info && m.info.time && m.info.time.created) || 0)
}

function lastAssistant(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.info && m.info.role === 'assistant') return m
  }
  return null
}

function textOf(m) {
  return (m.parts || []).filter(function (p) { return p.type === 'text' }).map(function (p) { return p.text || '' }).join('\n').trim()
}

// 恢复提示词：优先重放「半开回合之后最后一条 user 原话」——保住主人/系统的原始指令；
// 没有后发 user 时用固定恢复语（不伪装成主人新指令）。
// task377：后发 user 只有空话（「？？」「。。」等无字母/数字/汉字）时不重放——空话驱动不了恢复，
// 且可能让 AI 误以为主人在追问闲聊；改为固定恢复语「从中断处继续」。历史旧指令（open 之前）不重放。
const RECOVER_TEXT = '【卡死自动恢复】请从中断处继续完成刚才的任务，不要从头开始，不要重复已完成的步骤。'
function substantive(t) {
  const m = String(t || '').match(/[\u4e00-\u9fa5A-Za-z0-9]/g)
  return !!m && m.length >= 2
}
function pickTarget(msgs, openCreated) {
  let hasLater = false
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (!m.info || m.info.role !== 'user') continue
    if (m.info.time && m.info.time.created >= openCreated) {
      hasLater = true
      const t = textOf(m)
      if (t && substantive(t)) return t
    }
  }
  if (!hasLater) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (!m.info || m.info.role !== 'user') continue
      const t = textOf(m)
      if (t) return t
    }
  }
  return RECOVER_TEXT
}

function detect(rawMsgs, now, opt) {
  opt = opt || {}
  const minAgeMs = Number(opt.minAgeMs || 8 * 60 * 1000)   // 半开回合至少挂这么久才动手
  const idleMs = Number(opt.idleMs || 12 * 60 * 1000)      // 无后发 user 时，尾部件静默阈值
  const toolIdleMs = Number(opt.toolIdleMs || 20 * 60 * 1000)
  const msgs = normMsgs(rawMsgs)
  now = now || Date.now()
  const open = lastAssistant(msgs)
  if (!open) return { wedged: false, reason: 'no-assistant' }
  const info = open.info || {}
  if (info.error) return { wedged: false, reason: 'errored' }
  if (info.time && info.time.completed) return { wedged: false, reason: 'completed' }
  const parts = open.parts || []
  const pendingQ = parts.some(function (p) {
    return p && p.type === 'tool' && p.tool === 'question' && (!p.state || p.state.status !== 'completed')
  })
  if (pendingQ) return { wedged: false, reason: 'pending-question' }
  const created = (info.time && info.time.created) || 0
  if (!created) return { wedged: false, reason: 'no-created' }
  const ageMs = now - created
  if (ageMs < minAgeMs) return { wedged: false, reason: 'too-young' }
  const idle = now - lastPartAt(open)
  const toolRunning = parts.some(function (p) { return p && p.type === 'tool' && p.state && p.state.status === 'running' })
  if (toolRunning && idle < toolIdleMs) return { wedged: false, reason: 'tool-running' }
  const laterUser = msgs.some(function (m) {
    return m.info && m.info.role === 'user' && m.info.time && m.info.time.created > created
  })
  if (!laterUser && idle < idleMs) return { wedged: false, reason: 'maybe-running' }
  return {
    wedged: true,
    reason: laterUser ? 'open-assistant-with-later-user' : 'open-assistant-idle',
    openMsgId: info.id || '',
    openAgeMin: Math.round(ageMs / 60000),
    idleMin: Math.round(idle / 60000),
    laterUser: laterUser,
    target: pickTarget(msgs, created),
  }
}

module.exports = { normMsgs: normMsgs, lastAssistant: lastAssistant, lastPartAt: lastPartAt, pickTarget: pickTarget, RECOVER_TEXT: RECOVER_TEXT, detect: detect, detectProject: detectProject }

// task366：项目级卡死判定纯函数（2026-11-16 DAG 事故：挂死回合占项目锁→整目录瘫痪）。
// 编排层（wedge-heal）先按目录收集好结构化输入，本函数只做组合判定，不碰网络/文件。
// 三条件（细案 docs/2026-11-16 中转硬超时与项目级卡死自愈-task366.md §三）：
//   ① wedgedMains 非空——目录内 ≥1 主会话被 detect() 判 wedged（detect 自带 pending-question /
//      tool-running / 8min 年龄闸 / 12min 尾静默排除，本函数不重复实现，防两套口径漂移）；
//   ② busyIds 非空——serve /session/status 报该目录有 busy 会话（挂死占锁直接证据）；
//   ③ 近 promptMs（默认 15min）内有被接收的 prompt（「有输入无产出」，防误报）。
// 真值表（自测）：busy 在出字→detect 不命中→①空→不命中；长工具在跑→同前；等回答→同前；
// 目录无人使用→②空→不命中；busy 静默+有 prompt+有 wedged 主会话→命中。
function detectProject(dirState, now, opt) {
  opt = opt || {}
  // P2-6 产出审：promptMs 显式区分「未传=默认」与「传 0=关窗」（|| 会把 0 吞回默认，env=0 语义不成立）
  const promptMs = opt.promptMs === undefined ? 15 * 60 * 1000 : Number(opt.promptMs)
  if (!dirState || typeof dirState !== 'object') return { wedged: false, reason: 'no-input' }
  if (!Array.isArray(dirState.wedgedMains) || !dirState.wedgedMains.length) {
    return { wedged: false, reason: 'no-wedged-main' }
  }
  if (!Array.isArray(dirState.busyIds) || !dirState.busyIds.length) {
    return { wedged: false, reason: 'not-busy' }
  }
  if (!dirState.lastPromptAt || Number(dirState.lastPromptAt) <= 0) {
    return { wedged: false, reason: 'no-recent-prompt' }
  }
  now = now || Date.now()
  if (now - Number(dirState.lastPromptAt) > promptMs) {
    return { wedged: false, reason: 'no-recent-prompt', promptAgeMin: Math.round((now - Number(dirState.lastPromptAt)) / 60000) }
  }
  return {
    wedged: true,
    reason: 'wedged-main+busy+recent-prompt',
    dir: dirState.dir || '',
    busyIds: dirState.busyIds.slice(),
    wedgedMains: dirState.wedgedMains.slice(),
    promptAgeMin: Math.round((now - Number(dirState.lastPromptAt)) / 60000),
  }
}

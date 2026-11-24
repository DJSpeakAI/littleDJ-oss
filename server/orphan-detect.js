// orphan-detect: 悬空回复检测纯函数（task308）
// 事故背景：2026-11-15 11:35 serve 在途 run 挂死 + 11:48 整栈重启，两个会话留下
// 「user 尾消息无人应答 / assistant 空占位（0 parts）」悬空态；task301 autoresume 因打错接口
// （/api/session/<sid>/message 在 serve 上返回 session_message 开关事件而非真实消息）恒判 ok，
// 从 2026-11-15 上线起从未真正续跑过任何会话（教训 L-097）。本模块把「断相判定+候选过滤+指纹+护栏」
// 抽成纯函数，autoresume.js（续跑执行方）与 patrol 哨兵（只报不修方）共用一份口径，防两套漂移。
// 消息形态：统一归一成 {info, parts}（serve 扁平 {id,role,parts,...} 与 proxy 包裹 {info,parts} 皆可入）。
// classify 值域：'empty' | 'ok' | 'our-mark' | 'interrupted-user' | 'interrupted-assistant' | 'pending-question'
// （pending-question=task397 新增：assistant 在 question 工具上等主人点选——不是中断，绝不掐）
'use strict'

const MARK_DEFAULT = '【自动续跑】'
// task397 产审 P1-1：wedge-heal 卡死自愈补的固定恢复语前缀（=wedge-detect RECOVER_TEXT 的开头；
// selftest-autoresume 有断言钉住两处同步）。产审 R3：其它「程序触发」类注入（proxy 里会话内
// 独立成行的系统消息）同属我方——一并列入。经 proxy 注入的前面还带着水印，所以只认「行首」不认「开头」。
const RECOVER_MARK = '【卡死自动恢复】'
// 只收「独立成行的程序消息」前缀；当前模式/链路模式/开工三查/巡察使巡检/OCR 转写这类是贴在
// 主人原话前面的水印，不算系统消息（后面跟着主人的话）。新增程序注入前缀时此处同步 + 补断言。
const SYSTEM_HEADS = [RECOVER_MARK, '【系统自动提醒·程序触发', '【队列调度·程序触发', '【ETA 超时点名（', '【联网搜索结果 · ']
const INTERRUPTED = { 'interrupted-user': 1, 'interrupted-assistant': 1 }

function normMsgs(d) {
  const arr = Array.isArray(d) ? d : (d.data || [])
  return arr.map(function (m) { return m && m.info ? m : { info: m || {}, parts: (m && m.parts) || [] } })
}

function lastMsg(msgs) { return msgs && msgs.length ? msgs[msgs.length - 1] : null }

// task397：等主人点选的提问卡——assistant 消息里 question 工具未完结（pending/running）。
// 事故（2026-11-23「新对话 17:23」）：大管家出提问卡等主人选，尾部件=tool 被判 interrupted-assistant，
// 续跑巡检 27 分钟后掐掉重跑——提问卡作废、只能重问，两次把护栏额度耗光，后面主人真发的消息没人捞。
// 与 wedge-detect 的 pendingQ 同向但有别：那边「非 completed 即等」（更保守，宁可不解封）；这边只认
// state.status=pending/running——error（被掐）与没 state（形态异常）都不算等，否则被掐掉/坏掉的提问永远续不上。
// 产审 R5：状态值域以 serve 实测为准（pending/running/completed/error）；serve 若新增「进行中」状态值，
// 本函数与 wedge-detect 的 pendingQ 两处必须同步，否则这里会把活卡判成中断误掐（本单事故根因形态）。
function hasPendingQuestion(m) {
  const parts = (m && m.parts) || []
  return parts.some(function (p) {
    if (!p || p.type !== 'tool' || p.tool !== 'question') return false
    const st = p.state && p.state.status
    return st === 'pending' || st === 'running'
  })
}

// 断相判定（只看最后一条消息；内部先归一，喂扁平/包裹/原始响应体皆可，幂等）
function classify(rawMsgs, MARK) {
  MARK = MARK || MARK_DEFAULT
  const msgs = normMsgs(rawMsgs)
  const m = lastMsg(msgs)
  if (!m) return 'empty'
  const role = m.info && m.info.role
  // 防御锚（L-097）：接口打错会拿到「开关事件」（只有 type 没有 role）——任何消息都没有 role
  // 时视为空数据，绝不当作正常会话（防再次形同虚设）
  const anyRole = msgs.some(function (x) { return x.info && x.info.role })
  if (!anyRole) return 'empty'
  const parts = m.parts || []
  const lastPart = parts.length ? parts[parts.length - 1].type : ''
  if (role === 'user') {
    const firstText = (parts.filter(function (p) { return p.type === 'text' })[0] || {}).text || ''
    if (firstText.indexOf(MARK) === 0) return 'our-mark'
    return 'interrupted-user'
  }
  if (role === 'assistant') {
    // task308：空占位（0 parts）= run 建了消息但从未产出内容——11:35 事故 09:47 会话的真实形态
    if (parts.length === 0) return 'interrupted-assistant'
    // task397 产审 P2-6：消息级 error（被 abort / serve 硬崩没跑工具清理）=已终态的半截回合，
    // 哪怕里面的 question 还挂着 running 也不是「等人点选」，按中断交给续跑
    if (m.info && m.info.error) return 'interrupted-assistant'
    if (hasPendingQuestion(m)) return 'pending-question' // task397：等主人点选≠中断
    if (lastPart === 'tool' || lastPart === 'step-start' || lastPart === 'reasoning') return 'interrupted-assistant'
    return 'ok'
  }
  return 'ok'
}

function isInterrupted(cls) { return !!INTERRUPTED[cls] }

// task397：我方系统注入的 user 消息——续跑 MARK（直连 serve，在开头）或卡死恢复语（经 proxy，带水印，
// 只能认行首）。产审 P1-1：恢复语不是主人新话，不许拿它清护栏账，否则反复挂死的会话每次自愈后
// 都能重新领 2 次续跑额度。
function isSystemMsg(text, MARK) {
  const t = String(text || '')
  MARK = MARK || MARK_DEFAULT
  if (t.indexOf(MARK) === 0) return true
  return SYSTEM_HEADS.some(function (head) { return t.indexOf(head) === 0 || t.indexOf('\n' + head) >= 0 })
}

// task397：护栏计数是否已被主人的新话作废——lastAt（上次注入续跑的时刻）之后出现过非我方系统的
// user 消息=主人亲自介入过，旧一轮的注入次数不该再压在这一轮头上（否则主人发了新话也会被
// 「attempts>=上限」拦死，没人处理）。
function supersededByUser(rawMsgs, entry, MARK) {
  if (!entry || !entry.lastAt) return false
  return normMsgs(rawMsgs).some(function (x) {
    if (!x.info || x.info.role !== 'user') return false
    const created = (x.info.time && x.info.time.created) || 0
    if (!created || created <= entry.lastAt) return false
    const firstText = ((x.parts || []).filter(function (p) { return p.type === 'text' })[0] || {}).text || ''
    return !isSystemMsg(firstText, MARK)
  })
}

// 双采样指纹：最后消息 id + 序列化长度。仅比 id 不够——流式输出中 id 不变而 parts 在长，
// 会把「正在干活」误判成中断（task301 遗留隐患，task308 补上）
function fingerprint(msgs) {
  const m = lastMsg(msgs)
  if (!m) return { lastId: '', lastLen: 0 }
  return { lastId: m.info && m.info.id || '', lastLen: JSON.stringify(m).length }
}

// 候选过滤：无 parentID 主会话、未归档、最近 recentMs 内活跃、不在隐藏（左栏归档）清单、
// 目录不在拒入表（DAG AI Chat 红线：续跑会驱动该会话 AI 动 DAG 文件，宁可漏救不可越线）
function candidatesFrom(list, opt) {
  opt = opt || {}
  const now = opt.now || Date.now()
  const recentMs = opt.recentMs || 6 * 3600 * 1000
  const hiddenSet = opt.hiddenSet || {}
  const denyDirs = opt.denyDirs || []
  return (list || []).filter(function (s) {
    if (!s || s.parentID) return false
    if (s.archived) return false
    if (hiddenSet[s.id]) return false
    if (!s.time || !s.time.updated || now - s.time.updated > recentMs) return false
    if (denyDirs.length && s.directory) {
      const base = String(s.directory).split(/[\\/]/).filter(Boolean).pop() || ''
      if (denyDirs.indexOf(base) >= 0 || denyDirs.indexOf(s.directory) >= 0) return false
    }
    return true
  }).sort(function (a, b) { return b.time.updated - a.time.updated })
}

// 尾消息年龄闸：悬空判定只认「老的」——正在流式/长工具执行中的会话尾消息不动且年龄小，
// 双采样指纹挡不住「工具跑了 7 分钟」这种形态（上午事故的同源隐患），年龄闸兜底
function ageGate(msgs, minAgeMs, now) {
  now = now || Date.now()
  const m = lastMsg(msgs)
  const created = m && m.info && m.info.time && m.info.time.created
  if (typeof created !== 'number') return false // 拿不到时间戳=数据形态异常，保守拦下
  return now - created >= minAgeMs
}

// 重试护栏：attempts 达上限拒绝；our-mark 重拉须再等 rewaitMs（刚注入的标记提示词要留时间给应答）
// state 形如 { sid: { attempts, lastAt } }；返回 { ok, reason }
function attemptsGuard(state, sid, cls, opt) {
  opt = opt || {}
  const max = opt.max || 2
  const rewaitMs = opt.rewaitMs || 30 * 60 * 1000
  const now = opt.now || Date.now()
  const e = state && state[sid]
  const attempts = (e && e.attempts) || 0
  if (attempts >= max) return { ok: false, reason: 'attempts=' + attempts + '>=' + max }
  if (cls === 'our-mark' && e && e.lastAt && now - e.lastAt < rewaitMs) {
    return { ok: false, reason: 'mark-wait(' + Math.round((now - e.lastAt) / 60000) + 'min<' + Math.round(rewaitMs / 60000) + 'min)' }
  }
  return { ok: true, reason: '' }
}

module.exports = { MARK_DEFAULT: MARK_DEFAULT, RECOVER_MARK: RECOVER_MARK, SYSTEM_HEADS: SYSTEM_HEADS, normMsgs: normMsgs, lastMsg: lastMsg, classify: classify, isInterrupted: isInterrupted, hasPendingQuestion: hasPendingQuestion, isSystemMsg: isSystemMsg, supersededByUser: supersededByUser, fingerprint: fingerprint, candidatesFrom: candidatesFrom, ageGate: ageGate, attemptsGuard: attemptsGuard }

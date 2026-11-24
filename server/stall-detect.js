// stall-detect: 在途任务静默检查（软提醒）判定纯函数（task315）
// 事故背景（2026-11-15）：censor-plan 子会话 13:48 起静默，ETA 14:22 才到点、auto-reap 30min
// 收口要 14:19，主人 14:14 报障落在 0~30min 盲区——没有任何机制「叫醒承接人核对」。
// 本模块只做判定（纯函数，可打表；照 wedge-detect 先例）：不碰网络、不读写文件、不注入。
// 动作语义：非破坏软提醒（不 abort / 不改 override / 不删 eta），由 proxy.js 的
// autoReapTick 末段编排调用（复用同一 tick 的 probe/busy，不另发探针）。
//
// 候选（全部满足才 remind）：row.inTask===true && row.state==='running' && row.runnerSession
//   且 row.stale ∈ {quiet, stalled}（P1-1：不能只认 stalled——旧候选集会与早期阈值互斥）。
// 静默锚点：lastRole==='user' → probe.lastMsgCreated（P1-6 user 锚点）；
//   否则 → max(assistant created, completed)（completed 通常为 0）；缺失回退 row.lastEventAt。
// 判活（任一即跳过）：busy(queueBusy 在途) / probe 失败 / 末条 assistant 已 completed（交给
//   auto-reap done）/ 末条 assistant 带 running 状态的 tool part / 静默 < 阈值（长命令保护：
//   无 completed 且 created 在阈值内 → created 即锚点，天然被 below-threshold 拦下）。
'use strict'

// reapDecide 返回 skip 且原因属于这三类时才允许进 stallCheck（P1-4：
// done/completed/recently-ended 已收口或刚收口，不提醒；alive-busy/overridden 等天然非候选）
const REAP_STALL_SKIPS = ['run-in-progress', 'user-pending', 'not-stalled']

function reapSkipAllowsStall(why) {
  return REAP_STALL_SKIPS.indexOf(String(why || '')) >= 0
}

// LITTLEDJ_STALL_CHECK_MIN 的 clamp：下界 5min（quiet 最小档），上界 30min（贴近 auto-reap），
// 默认 15min（方案稿 §六 rev.3 P1-1 终裁：派生 stale='stalled' 硬边界；任务书 §2.1 的 12min 被 rev.3 取代。
// 取舍=「误报可接受、软提醒非破坏」，坏情况仅每 runner 2 条/20min。）
function clampStallMin(v) {
  const n = Number(v)
  // task315 终裁（2026-11-15 15:49，方案稿 §六 rev.3 P1-1 行）：默认 15min=派生 stale='stalled' 硬边界；
  // env LITTLEDJ_STALL_CHECK_MIN 可调，clamp 5~30。任务书 §2.1 的 12min 已被 rev.3 修订取代（quiet 候选仍保留，
  // 调低阈值时 quiet 档即生效）。
  if (!Number.isFinite(n)) return 15
  return Math.min(30, Math.max(5, n))
}

function denyDirHit(directory, denyDirs) {
  const dir = String(directory || '')
  if (!dir || !Array.isArray(denyDirs) || !denyDirs.length) return false
  const base = dir.split('/').filter(Boolean).pop() || ''
  return denyDirs.indexOf(base) >= 0 || denyDirs.indexOf(dir) >= 0
}

// 纯函数判定。参数：
//   row        = applyOverrides 后的台账行（inTask/state/stale/runnerSession/directory/…）
//   probe      = reapProbeRunner 结果 {ok,lastRole,created,completed,lastMsgCreated,hasRunningPart}
//   busy       = runner 是否 queueBusy 在途（TTL 内）
//   guardState = {child:{count,lastAt}, hourCount, rest, nudgeLastAt, reapLastAt,
//                 target:{id,agent,isRoot,hidden,paused,rowRootOk}|null, targetWhy}
//   now        = 当前毫秒
//   opts       = {minMs, denyDirs, childCooldownMs, childMax, globalMaxPerHour, restHourMax,
//                 nudgeDedupeMs, firstTick, reapWhy}
// 返回 {action:'remind', silenceMin, silenceMs, anchorAt, attempt, targetId} 或 {action:'skip', why, …}
// skip 原因按检查顺序：not-in-task/not-running/no-runner/reap-gate/stale-out/deny-dir/
//   queue-busy/probe-failed/runner-completed/tool-running/below-threshold/no-anchor/
//   nudge-recent/auto-reap-recent/target-*/child-max/child-cooldown/global-max/rest-budget/first-tick
// （first-tick 故意放最后：返回它 = 其余检查全过 = proxy 侧「只 log 观察」的充分条件）
function decideStallCheck(row, probe, busy, guardState, now, opts) {
  const o = opts || {}
  const gs = guardState || {}
  const minMs = Number(o.minMs || 15 * 60 * 1000) // rev.3 P1-1：默认 15min
  if (!row || row.inTask !== true) return { action: 'skip', why: 'not-in-task' }
  if (row.state !== 'running') return { action: 'skip', why: 'not-running' }
  if (!String(row.runnerSession || '')) return { action: 'skip', why: 'no-runner' }
  if (!reapSkipAllowsStall(o.reapWhy)) return { action: 'skip', why: 'reap-gate' }
  if (row.stale !== 'quiet' && row.stale !== 'stalled') return { action: 'skip', why: 'stale-out' }
  if (denyDirHit(row.directory, o.denyDirs === undefined ? ['DAG_AI_Chat'] : o.denyDirs)) return { action: 'skip', why: 'deny-dir' }
  if (busy) return { action: 'skip', why: 'queue-busy' }
  if (!probe || !probe.ok) return { action: 'skip', why: 'probe-failed' }
  // P1-6：末条 assistant 且 completed>0 = runner 已收尾 → 交给 auto-reap done，不提醒。
  // （lastRole='user' 时 completed 属于更早的 assistant，不算收尾——见 reapDecide 同式分流）
  if (String(probe.lastRole) === 'assistant' && Number(probe.completed) > 0) {
    return { action: 'skip', why: 'runner-completed' }
  }
  if (probe.hasRunningPart) return { action: 'skip', why: 'tool-running' }
  // 静默锚点（P1-1/P1-6）：user 尾用该消息自身 created；assistant 尾用 created/completed 较晚者；回退 lastEventAt
  let anchor = 0
  if (String(probe.lastRole) === 'user') anchor = Number(probe.lastMsgCreated) || 0
  else anchor = Math.max(Number(probe.created) || 0, Number(probe.completed) || 0)
  if (!anchor) anchor = Number(row.lastEventAt) || 0
  if (!anchor) return { action: 'skip', why: 'no-anchor' }
  const silenceMs = now - anchor
  if (silenceMs < minMs) return { action: 'skip', why: 'below-threshold', silenceMs: silenceMs }
  const dedupeMs = Number(o.nudgeDedupeMs || 30 * 60 * 1000)
  const nudgeLastAt = Number(gs.nudgeLastAt) || 0
  if (nudgeLastAt && now - nudgeLastAt < dedupeMs) return { action: 'skip', why: 'nudge-recent' }
  const reapLastAt = Number(gs.reapLastAt) || 0
  if (reapLastAt && now - reapLastAt < dedupeMs) return { action: 'skip', why: 'auto-reap-recent' }
  // P1-5：目标必须沿 parentID 上溯到的根，且 agent==='butler'、非 hidden、非 queuePaused、与 row.id 同根
  const target = gs.target
  if (!target) return { action: 'skip', why: 'target-' + (gs.targetWhy || 'unresolved') }
  if (!target.isRoot) return { action: 'skip', why: 'target-not-root' }
  if (String(target.agent || '') !== 'butler') return { action: 'skip', why: 'tui-root' }
  if (target.hidden) return { action: 'skip', why: 'target-hidden' }
  if (target.paused) return { action: 'skip', why: 'target-paused' }
  if (!target.rowRootOk) return { action: 'skip', why: 'root-mismatch' }
  const pc = gs.child || { count: 0, lastAt: 0 }
  const count = Number(pc.count) || 0
  if (count >= Number(o.childMax || 2)) return { action: 'skip', why: 'child-max', count: count }
  const lastAt = Number(pc.lastAt) || 0
  if (lastAt && now - lastAt < Number(o.childCooldownMs || 20 * 60 * 1000)) {
    return { action: 'skip', why: 'child-cooldown' }
  }
  const hourCount = Number(gs.hourCount) || 0
  if (hourCount >= Number(o.globalMaxPerHour || 3)) return { action: 'skip', why: 'global-max' }
  if (gs.rest && hourCount >= Number(o.restHourMax || 2)) return { action: 'skip', why: 'rest-budget' }
  if (o.firstTick) return { action: 'skip', why: 'first-tick', silenceMs: silenceMs }
  return {
    action: 'remind',
    silenceMs: silenceMs,
    silenceMin: Math.floor(silenceMs / 60000),
    anchorAt: anchor,
    attempt: count + 1,
    targetId: String(target.id || '')
  }
}

// 软提醒文案（P2-3：标准前缀 + 尾句；title 去换行截 30；含 runner id / 承接角色 / 静默分钟 / ETA 截止）
function buildStallText(row, info) {
  const title = String((row && row.title) || '').replace(/[\r\n]+/g, ' ').slice(0, 30)
  const runner = String((info && info.runner) || (row && row.runnerSession) || '')
  const role = String((row && row.runnerAgent) || '-')
  const silenceMin = Math.max(1, Number((info && info.silenceMin) || 0))
  const dl = Number((info && info.etaDeadline) || 0)
  let etaSeg = ''
  if (dl > 0) {
    const d = new Date(dl)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    etaSeg = '，ETA 截止 ' + hh + ':' + mm
  }
  const etaSid = String((row && row.etaChildId) || runner)
  return '【系统自动提醒·程序触发】你名下的子任务「' + title + '」已静默 ' + silenceMin + ' 分钟' +
    '（runner ' + runner + '，承接角色 ' + role + etaSeg + '）。' +
    '请立即核对三选一：①仍在跑→更新预计：POST /_tasks {"sessionId":"' + etaSid + '","op":"eta","etaMinutes":<新预计>}；' +
    '②已挂/中断→标记 interrupt 并重派或从中断处续做；③已被其他会话接管→说明并收尾。勿重复已完成步骤。' +
    '此消息由自动机制发送，非主人指令，不得当作新任务执行。'
}

function newStallState() {
  return { version: 1, perChild: {}, history: [] }
}

// 注入结果落账（纯函数，原地改 state 并返回）：
//   sent    → count+1 / lastAt=now / history 追加（≤200 滚动）
//   deduped / 其他 → 不计次不落账（P2-2：2s 文本去重命中不得吞掉一次真提醒的次数）
function recordStallResult(state, runner, outcome, now, extra) {
  const st = state || newStallState()
  if (!st.perChild || typeof st.perChild !== 'object') st.perChild = {}
  if (!Array.isArray(st.history)) st.history = []
  if (outcome === 'sent' && runner) {
    const pc = st.perChild[runner] || { count: 0, lastAt: 0 }
    pc.count = (Number(pc.count) || 0) + 1
    pc.lastAt = Number(now) || Date.now()
    st.perChild[runner] = pc
    const h = { at: pc.lastAt, child: String(runner) }
    const ex = extra || {}
    ;['target', 'root', 'silenceMin', 'attempt'].forEach(function (k) { if (ex[k] !== undefined) h[k] = ex[k] })
    st.history.push(h)
    while (st.history.length > 200) st.history.shift()
  }
  return st
}

// P1-10 清计数：perChild 只保留「当前 rows 里仍是 running 在途行的 runnerSession」，
// 行消失 / state!=='running' / runner 换人 → 计数作废（绝不用承接会话的消息形态清 runner 计数）
function pruneStallState(state, rows) {
  const st = state || newStallState()
  if (!st.perChild || typeof st.perChild !== 'object') return st
  const live = {}
  ;(Array.isArray(rows) ? rows : []).forEach(function (r) {
    if (!r || r.inTask === false || r.state !== 'running') return
    const k = String(r.runnerSession || '')
    if (k) live[k] = true
  })
  Object.keys(st.perChild).forEach(function (k) { if (!live[k]) delete st.perChild[k] })
  return st
}

module.exports = {
  REAP_STALL_SKIPS: REAP_STALL_SKIPS,
  reapSkipAllowsStall: reapSkipAllowsStall,
  clampStallMin: clampStallMin,
  denyDirHit: denyDirHit,
  decideStallCheck: decideStallCheck,
  buildStallText: buildStallText,
  newStallState: newStallState,
  recordStallResult: recordStallResult,
  pruneStallState: pruneStallState
}

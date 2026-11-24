// 任务台账派生层（task15）：从 deveco.db 只读派生「运行中会话」
// 从 server/proxy.js 抽出（批次3，2026-11-05）——proxy 主线程与 worker 线程共用同一实现，
// 保证「单一来源」；worker 线程执行本文件的同步读库，主线程不再被 event loop 阻塞。
//
// 说明：本层只读 session 表，绝不查询 message / part / account / credential
//（凭据红线 + 大表 json_extract 会超时）。
'use strict'
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// task315：LITTLEDJ_DEVECO_DB 为自测/调试旋钮（沙箱假库，默认生产库；生产不设）
const DEVECO_DB_FILE = process.env.LITTLEDJ_DEVECO_DB || path.join(os.homedir(), '.local', 'share', 'deveco', 'deveco.db')

// 阈值唯一来源；与 task15 文档口径锁定
const TASK_STALE_MS = { quiet: 5 * 60 * 1000, stalled: 15 * 60 * 1000, archived: 24 * 3600 * 1000 }
// GET 响应暴露给 UI 的口径（与 TASK_STALE_MS 同源，改阈值时两处同步）
const TASK_STALE_RULES = { quietMin: 5, stalledMin: 15, archivedHours: 24 }

const TASK_SESSION_COLS = ['id', 'parent_id', 'title', 'time_created', 'time_updated']

// 派生 SQL 全部为常量字符串，无用户输入拼接；只看 session 表
const TASK_DERIVE_SQL = [
  'SELECT p.id AS id, p.title AS title, p.directory AS directory,',
  ' p.time_created AS timeCreated, p.time_updated AS timeUpdated,',
  ' (SELECT COUNT(*) FROM session c WHERE c.parent_id = p.id) AS step,',
  ' (SELECT MAX(c.time_updated) FROM session c WHERE c.parent_id = p.id) AS childMaxTu,',
  ' (SELECT c.id FROM session c WHERE c.parent_id = p.id ORDER BY c.time_updated DESC LIMIT 1) AS runnerSession,',
  ' (SELECT c.agent FROM session c WHERE c.parent_id = p.id ORDER BY c.time_updated DESC LIMIT 1) AS runnerAgent',
  ' FROM session p WHERE p.parent_id IS NULL'
].join(' ')
// 老库可能没有 directory 列：缺列时降级为空串而不是整体失败
const TASK_DERIVE_SQL_NO_DIR = TASK_DERIVE_SQL.replace('p.directory AS directory', "'' AS directory")

function taskDbOpen(dbPath) {
  const file = dbPath || DEVECO_DB_FILE
  let sqlite = null
  try { sqlite = require('node:sqlite') } catch (e) {}
  if (!sqlite || !sqlite.DatabaseSync) {
    const err = new Error('当前 Node 不支持 node:sqlite（需 Node 22.5+）')
    err.reason = 'node-sqlite-unsupported'
    throw err
  }
  if (!fs.existsSync(file)) {
    const err = new Error('找不到 deveco 数据库：' + file)
    err.reason = 'db-unavailable'
    throw err
  }
  return new sqlite.DatabaseSync(file, { readOnly: true })
}

// 纯函数：>=5min quiet，>=15min stalled，>=24h archived；时间戳缺失/非法按 archived
function staleFlagOf(now, lastEventAt) {
  const t = Number(lastEventAt)
  if (!Number.isFinite(t) || t <= 0) return 'archived'
  const age = Number(now) - t
  if (age >= TASK_STALE_MS.archived) return 'archived'
  if (age >= TASK_STALE_MS.stalled) return 'stalled'
  if (age >= TASK_STALE_MS.quiet) return 'quiet'
  return 'active'
}

// 纯函数：是否进「任务口径」（task48 收敛口径的唯一来源）
// 判据只有两条：派过子代理（step>0）且未满 24h 归档。**故意不含 state**：
// state 由人工覆盖层判定死活，派生层不认识它；UI 侧 ledgerInTask 与本函数逐字同式。
function taskInScope(step, stale) {
  return Number(step) > 0 && stale !== 'archived'
}

function taskDegraded(reason, hint) {
  return { ok: false, degraded: true, reason: reason, hint: hint, tasks: [] }
}

// 只读派生：成功 {ok:true, tasks:[...]}；失败 {ok:false, degraded:true, reason, hint, tasks:[]}
function deriveTasksSafe(dbPath) {
  let db
  try {
    db = taskDbOpen(dbPath)
  } catch (e) {
    const reason = (e && e.reason) || 'db-unavailable'
    const hint = reason === 'node-sqlite-unsupported'
      ? '当前 Node 版本过低（需 22.5+），任务派生暂不可用'
      : '暂时读不到 deveco 会话库，任务面板按降级模式显示'
    return taskDegraded(reason, hint)
  }
  try {
    let cols = []
    try {
      cols = db.prepare('PRAGMA table_info(session)').all().map(function (r) { return String(r.name) })
    } catch (e) {
      cols = []
    }
    const missing = TASK_SESSION_COLS.filter(function (c) { return cols.indexOf(c) < 0 })
    if (missing.length) {
      return taskDegraded('schema-mismatch', 'deveco 会话表缺列：' + missing.join('、') + '，任务派生已停用')
    }
    const sql = cols.indexOf('directory') >= 0 ? TASK_DERIVE_SQL : TASK_DERIVE_SQL_NO_DIR
    const rows = db.prepare(sql).all()
    const now = Date.now()
    const tasks = rows.map(function (r) {
      const tu = Number(r.timeUpdated) || 0
      const cu = Number(r.childMaxTu) || 0
      const cnt = Number(r.step) || 0
      // task48 疑点②：任务口径内的活跃度以子会话最新活动为准（子代理停了就是停了），
      // 根会话自身时间只做兜底——否则大管家在主会话里持续聊天，会把已停的子任务永远续命成 active。
      // step=0 无子会话，仍按根自身时间（这类行 inTask=false，不进口径，仅保字段完整与排序）。
      const fresh = cnt > 0 ? (cu || tu) : tu
      const lastEventAt = fresh || 0
      const stale = staleFlagOf(now, lastEventAt)
      return {
        id: String(r.id || ''),
        title: String(r.title || ''),
        // state 只表示「人工判定的生命周期」，派生层永不自动判死：默认值恒 running，
        // 死/中断由覆盖层 applyOverrides 改写（task48 起收敛改由 inTask 承担，别在这里加判定）。
        state: 'running',
        phase: '',
        progress: '',
        step: cnt,
        runnerCount: cnt,
        runnerSession: String(r.runnerSession || ''),
        runnerAgent: String(r.runnerAgent || ''),
        lastEventAt: lastEventAt,
        // task375：根会话自身最后更新时间（tu）。lastEventAt 在 step>0 时以子会话为准（task48 口径），
        // 主会话自己干活（无新子代理）不会刷新它——wake/巡检类「找正在干活的人」场景须用 max(lastEventAt, rootTu)。
        rootTu: tu,
        timeCreated: Number(r.timeCreated) || 0,
        stale: stale,
        staleMinutes: lastEventAt > 0 ? Math.floor((now - lastEventAt) / 60000) : null,
        inTask: taskInScope(cnt, stale),
        directory: String(r.directory || '')
      }
    })
    tasks.sort(function (a, b) { return b.lastEventAt - a.lastEventAt })
    return { ok: true, tasks: tasks }
  } catch (e) {
    return taskDegraded('db-unavailable', '读取会话库失败：' + String((e && e.message) || e))
  } finally {
    try { db.close() } catch (e) {}
  }
}

// ---- task119 合并单追加（2026-11-08）：任务后代子会话区间（只读，效率统计用） ----
// WITH RECURSIVE 取全部后代：管家系链多级（steward→secretariat→writer/御史挂在根的孙/曾孙级），
// 只取直接子级会漏角色执行区间（实测库内二级子会话 1008 条、单根最多 554 条后代）。
// 调用方按 ≤50/批传入 rootIds（id 来自库自身且过 ^ses_ 校验，无注入面）；
// winStartMs（窗口起点 ms）按 **time_created** 过滤远窗后代防 LIMIT 截断（产出审 P1-1：tc 剪枝天然安全
// ——子孙 tc 必晚于父 tc；tu 剪枝会把 tu 早于子 tc 的父分支整条误剪，且会使 t0 后移漏 48h 去极值）；
// LIMIT 5000 为单批口径，触顶即 truncated:true（该批如实标注，不影响其余批）。既有派生链零改动。
const TASK_DESC_LIMIT = 5000
function deriveDescendantsOf(dbPath, rootIds, winStartMs) {
  const ids = (Array.isArray(rootIds) ? rootIds : []).map(String)
    .filter(function (s) { return /^ses_[A-Za-z0-9_-]+$/.test(s) })
  if (!ids.length) return { ok: true, rows: [], truncated: false }
  let db
  try {
    db = taskDbOpen(dbPath)
  } catch (e) {
    return { ok: false, degraded: true, reason: (e && e.reason) || 'db-unavailable', rows: [], truncated: false }
  }
  try {
    const ph = ids.map(function () { return '?' }).join(',')
    const sql = [
      'WITH RECURSIVE tree(id, agent, tc, tu, root) AS (',
      ' SELECT p.id, p.agent, p.time_created, p.time_updated, p.id AS root FROM session p WHERE p.id IN (' + ph + ')',
      ' UNION ALL',
      ' SELECT c.id, c.agent, c.time_created, c.time_updated, tree.root FROM session c JOIN tree ON c.parent_id = tree.id',
      ' WHERE c.time_created >= ?',
      ') SELECT id, agent, tc, tu, root FROM tree WHERE id != root ORDER BY root, tc LIMIT ' + TASK_DESC_LIMIT
    ].join(' ')
    const st = db.prepare(sql)
    const rows = st.all.apply(st, ids.concat([Number(winStartMs) || 0])).map(function (r) {
      return {
        id: String(r.id || ''),
        agent: String(r.agent || ''),
        tc: Number(r.tc) || 0,
        tu: Number(r.tu) || 0,
        root: String(r.root || '')
      }
    })
    return { ok: true, rows: rows, truncated: rows.length >= TASK_DESC_LIMIT }
  } catch (e) {
    return { ok: false, degraded: true, reason: 'descendants-query-failed: ' + String((e && e.message) || e), rows: [], truncated: false }
  } finally {
    try { db.close() } catch (e) {}
  }
}

// ---- task184：派单角色丢失检测（只读）----
// 背景：宿主 serve 的 task 工具偶发丢失 subagent_type、静默回落 build/general——
//   派单要求 censor-plan，落库 agent=build（build 全工具 ⇒ 御史越权改码/派单/commit）。
// 判据（三重收窄）：标题后缀 (@<role> subagent) 存在 && role ∈ 白名单 && agent 非空 && role !== agent。
//   白名单=管家系 8（butler/steward/secretariat/writer/censor-plan/censor-output + 退役旧键 censor-deepseek/censor-glm，task265 改名后旧键永留校验历史标题后缀）
//   + 内置 3（build/general/explore）；plan/goal 库内 0 条不列，新增内置角色须同步补表。
// 与 UI 侧 childMismatchAgent 同源（前端无法 require，两处实现由 selftest 交叉断言防漂移）。
const AGENT_ROLE_WHITELIST = {
  butler: 1, steward: 1, secretariat: 1, writer: 1,
  'censor-plan': 1, 'censor-output': 1,
  'censor-deepseek': 1, 'censor-glm': 1,
  build: 1, general: 1, explore: 1
}
const TITLE_ROLE_SUFFIX_RE = /\s*\(@([^)]*)\s+subagent\)\s*$/i

// 纯函数：返回实际 agent（mismatch 值），不命中返回 ''
function agentMismatchOf(title, agent) {
  const m = TITLE_ROLE_SUFFIX_RE.exec(String(title || ''))
  if (!m || !m[1]) return ''
  const want = String(m[1]).trim()
  const got = String(agent || '').trim()
  if (!want || !got) return ''
  if (!AGENT_ROLE_WHITELIST[want]) return ''
  if (want === got) return ''
  return got
}

// 只读扫描：sinceMs 之后新建的、有父会话的 session，返回 mismatch 行（含 rootId 上溯）
function deriveAgentMismatch(dbPath, sinceMs) {
  let db
  try { db = taskDbOpen(dbPath) } catch (e) {
    return { ok: false, reason: (e && e.reason) || 'db-unavailable', rows: [] }
  }
  try {
    const since = Number(sinceMs) || 0
    let cols = []
    try { cols = db.prepare('PRAGMA table_info(session)').all().map(function (r) { return String(r.name) }) } catch (e) { cols = [] }
    const has = function (c) { return cols.indexOf(c) >= 0 }
    const sql = 'SELECT id, parent_id, time_created, time_updated' +
      (has('agent') ? ', agent' : ", '' AS agent") +
      (has('title') ? ', title' : ", '' AS title") +
      (has('time_archived') ? ', time_archived' : ', NULL AS time_archived') +
      ' FROM session WHERE parent_id IS NOT NULL AND time_created > ?'
    const raw = db.prepare(sql).all(since)
    const parents = new Map()
    try {
      db.prepare('SELECT id, parent_id FROM session').all().forEach(function (r) {
        parents.set(String(r.id || ''), r.parent_id == null ? null : String(r.parent_id))
      })
    } catch (e) { /* 父链不可得时 rootId 退回直接父会话 */ }
    const rows = []
    raw.forEach(function (r) {
      const title = String(r.title || '')
      const got = agentMismatchOf(title, String(r.agent || ''))
      if (!got) return
      const sid = String(r.id || '')
      const pid = r.parent_id == null ? '' : String(r.parent_id)
      // rootId 沿 parent 链上溯（≤32 层防环）；父不在表内/为 null 即该层为根
      let cur = pid, guard = 0
      while (cur && guard++ < 32) {
        const up = parents.get(cur)
        if (up == null) break
        cur = up
      }
      const m = TITLE_ROLE_SUFFIX_RE.exec(title)
      rows.push({
        id: sid,
        parentID: pid,
        rootId: cur || pid,
        want: String((m && m[1]) || '').trim(),
        agent: got,
        created: Number(r.time_created) || 0,
        updated: Number(r.time_updated) || 0,
        archived: Number(r.time_archived) || 0
      })
    })
    return { ok: true, rows: rows }
  } catch (e) {
    return { ok: false, reason: 'query-failed: ' + String((e && e.message) || e), rows: [] }
  } finally {
    try { db.close() } catch (e) {}
  }
}

module.exports = {
  DEVECO_DB_FILE: DEVECO_DB_FILE,
  TASK_STALE_MS: TASK_STALE_MS,
  TASK_STALE_RULES: TASK_STALE_RULES,
  TASK_SESSION_COLS: TASK_SESSION_COLS,
  TASK_DERIVE_SQL: TASK_DERIVE_SQL,
  TASK_DERIVE_SQL_NO_DIR: TASK_DERIVE_SQL_NO_DIR,
  taskDbOpen: taskDbOpen,
  staleFlagOf: staleFlagOf,
  taskInScope: taskInScope,
  taskDegraded: taskDegraded,
  deriveTasksSafe: deriveTasksSafe,
  deriveDescendantsOf: deriveDescendantsOf,
  agentMismatchOf: agentMismatchOf,
  deriveAgentMismatch: deriveAgentMismatch
}

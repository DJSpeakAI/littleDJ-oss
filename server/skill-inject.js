// skill-inject.js — 提示词技能按需注入（task393 · 向 DJH skill 体系学习）
// 用途：低频指引存 <运行根>/config/prompts/skills/*.md（git 外），触发词命中本轮用户
//       消息才注入，每会话每技能仅一次——省常驻 token。
// 命名区分：本模块管「提示词技能」（config/prompts/skills/）；server/skills/ 是定时任务
//       框架（scheduler/model-pricing），同名不同义，别混。
// 技能文件头格式（HTML 注释块，无外部依赖）：
//   <!-- littleDJ-skill
//   name: 网页开发规范
//   triggers: 网页开发,H5,PWA,前端页面,modern-web
//   -->
// 全函数 fail-open：任何异常返回空/空数组——依赖点 queueDispatch 调 promptInject 无局部
//       try/catch（proxy.js 外层仅 queueTick 总 catch），本模块炸不得。
// 覆盖边界：仅 PWA 主会话（proxy /prompt 链）；TUI/子代理不经此入口，技能不生效。
'use strict'

const fs = require('fs')
const path = require('path')

const META_RE = /^<!--\s*littleDJ-skill([\s\S]*?)-->/
const BODY_CAP = 8192 // 单技能正文上限（P2-3：防误注入巨型文本）
const STATE_MAX_SIDS = 500 // 照 boot-state 上限；清理排序按每 sid 内最大 ts（值是对象，不能照抄数值比较）

// 解析单个技能文件文本 → { file, name, triggers[], body }；无头/缺字段/空 triggers → null
function parseSkill(text, file) {
  try {
    const s = String(text || '')
    const m = s.match(META_RE)
    if (!m) return null
    let name = ''
    let triggers = []
    m[1].split('\n').forEach(function (line) {
      const nm = line.match(/^\s*name:\s*(.+?)\s*$/)
      if (nm) name = nm[1]
      const tm = line.match(/^\s*triggers:\s*(.+?)\s*$/)
      if (tm) {
        triggers = tm[1].split(/[,，]/).map(function (x) { return x.trim().toLowerCase() }).filter(Boolean)
      }
    })
    if (!name || !triggers.length) return null
    let body = s.slice(m.index + m[0].length).trim()
    if (body.length > BODY_CAP) {
      body = body.slice(0, BODY_CAP) + '\n\n（技能正文超 8KB 上限已截断；全文见技能文件）'
    }
    return { file: file, name: name, triggers: triggers, body: body }
  } catch (e) {
    return null
  }
}

// 读技能目录（仅 .md，按文件名排序）。目录不存在/读失败 → []（fail-open）
function readSkills(dir) {
  const out = []
  try {
    const files = fs.readdirSync(dir).filter(function (f) { return /\.md$/.test(f) }).sort()
    for (let i = 0; i < files.length; i++) {
      try {
        const s = parseSkill(fs.readFileSync(path.join(dir, files[i]), 'utf8'), files[i])
        if (s) out.push(s)
      } catch (e) { /* 单文件坏不连坐 */ }
    }
  } catch (e) {}
  return out
}

// 命中判定：text（本轮用户消息拼接）toLowerCase 后对 triggers 逐词 indexOf；命中任一词即入选
function matchSkills(text, skills) {
  const t = String(text || '').toLowerCase()
  if (!t || !Array.isArray(skills)) return []
  return skills.filter(function (s) {
    return s && Array.isArray(s.triggers) && s.triggers.some(function (k) { return k && t.indexOf(k) >= 0 })
  })
}

// 注入块（结束标记是 UI 折叠剥离依据，proxy 与 messages.ts 两端契约，勿单边改）
function formatSkillBlock(skill) {
  return '【技能加载（自动注入 · 仅本会话一次 · ' + skill.name + '）】\n' + skill.body + '\n——— 技能内容结束 ———'
}

// ---- skill-state：{ sid: { <技能文件名>: ts } }，仅 serve 2xx 成功后由 proxy 侧落 ----

function loadSkillState(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return (j && typeof j === 'object' && !Array.isArray(j)) ? j : {}
  } catch (e) {
    return {}
  }
}

// 500 sid 上限清理：按「每 sid 内最大 ts」排序挤最老（P2-5：值是对象，照抄 boot-state 数值比较会 NaN）
function pruneSkillState(s) {
  const keys = Object.keys(s)
  if (keys.length <= STATE_MAX_SIDS) return s
  keys
    .sort(function (a, b) {
      const ma = Math.max.apply(null, Object.keys(s[a]).map(function (k) { return s[a][k] || 0 }).concat([0]))
      const mb = Math.max.apply(null, Object.keys(s[b]).map(function (k) { return s[b][k] || 0 }).concat([0]))
      return ma - mb
    })
    .slice(0, keys.length - STATE_MAX_SIDS)
    .forEach(function (k) { delete s[k] })
  return s
}

function saveSkillState(file, s) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    pruneSkillState(s)
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(s, null, 2))
    fs.renameSync(tmp, file)
  } catch (e) { /* 写失败=下轮可能重复注入一次，可接受（fail-open） */ }
}

module.exports = {
  parseSkill: parseSkill,
  readSkills: readSkills,
  matchSkills: matchSkills,
  formatSkillBlock: formatSkillBlock,
  loadSkillState: loadSkillState,
  saveSkillState: saveSkillState,
  BODY_CAP: BODY_CAP,
  STATE_MAX_SIDS: STATE_MAX_SIDS,
}

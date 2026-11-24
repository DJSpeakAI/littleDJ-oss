// tool-prune.js — 工具回显剪枝（task393 · 向 DJH tool-result-pruner 学习）
// 用途：发给模型的 messages 里，历史轮的 tool 结果超长时自动剪成「头 4096 + 尾 1024」，
//       防长输出随历史反复重发撑爆上下文。**最新轮豁免**：最后一条 user 消息之后的
//       tool 结果不剪（agent 当前正在用，保全；历史轮才是纯重发负担）。
// 性质：视图剪枝不改存储——serve 侧会话原件不动，仅转发给上游的请求体被剪；
//       每轮独立处理原件，幂等可逆（env 闸 DS_RELAY_NO_PRUNE / ZP_RELAY_NO_PRUNE 即回原状）。
// 覆盖边界：仅 OpenAI chat-completions 形态 messages[].role==='tool'（content 为 string
//       或 [{type:'text',text}]）；/responses function_call_output、Anthropic /messages
//       tool_result 不适用（relay URL 正则虽含三者，本模块只认 OpenAI 形态，其余原样过）。
// 参数依据：DSH 生产值（threshold 8192 / head 4096 / tail 1024，经主人环境长期验证）。
// 全函数 fail-open：任何异常返回 changed:false 原样透传（deepseek-relay prepareBody 链
//       与 zhipu-relay req.on('end') 链都依赖此性质，后者无外层 catch）。
'use strict'

const PRUNE_LIMIT = 8192 // 单条 text 超此长度才剪
const PRUNE_HEAD = 4096
const PRUNE_TAIL = 1024

function pruneMark(origLen) {
  return (
    '\n\n…[relay 剪枝：历史轮工具回显原 ' + origLen + ' 字符，保头 ' + PRUNE_HEAD + '+尾 ' + PRUNE_TAIL +
    '；需要中段请用 offset/limit 分段重读，或 head/tail/sed 范围提取]…\n\n'
  )
}

// 单条 text 剪枝；不超限返回 null（不动）
function pruneText(t) {
  if (typeof t !== 'string' || t.length <= PRUNE_LIMIT) return null
  return t.slice(0, PRUNE_HEAD) + pruneMark(t.length) + t.slice(t.length - PRUNE_TAIL)
}

// 剪枝结果对象（pruned 便于上游计数统计）
function newResult() {
  return { changed: false, prunedCount: 0, savedChars: 0 }
}

function applyToText(text, r) {
  const pruned = pruneText(text)
  if (pruned === null) return null
  r.changed = true
  r.prunedCount++
  r.savedChars += text.length - pruned.length
  return pruned
}

// 主入口：就地改写 body.messages（仅历史轮 tool 消息）。fail-open：异常返回 changed:false。
function pruneToolResults(body) {
  const r = newResult()
  try {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages)) return r
    // 最新轮豁免：从尾向前找最后一条 user，其后的消息一律不动
    let lastUserIdx = -1
    for (let i = body.messages.length - 1; i >= 0; i--) {
      const m = body.messages[i]
      if (m && typeof m === 'object' && m.role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx < 0) return r // 无 user 消息=非正常对话序列，保守不剪
    for (let i = 0; i < body.messages.length; i++) {
      if (i > lastUserIdx) break // 最新轮（最后一条 user 之后）豁免
      const m = body.messages[i]
      if (!m || typeof m !== 'object' || m.role !== 'tool') continue
      if (typeof m.content === 'string') {
        const out = applyToText(m.content, r)
        if (out !== null) m.content = out
      } else if (Array.isArray(m.content)) {
        for (let k = 0; k < m.content.length; k++) {
          const part = m.content[k]
          if (part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string') {
            const out = applyToText(part.text, r)
            if (out !== null) part.text = out
          }
        }
      }
    }
    return r
  } catch (e) {
    return newResult() // fail-open：异常视同未改
  }
}

module.exports = { pruneToolResults, pruneText, pruneMark, PRUNE_LIMIT, PRUNE_HEAD, PRUNE_TAIL }

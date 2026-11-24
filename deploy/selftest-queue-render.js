#!/usr/bin/env node
/* 排队条渲染自测（task153，L-033 沉淀：前端交互类修复必须「修复前 FAIL / 修复后 PASS」可复跑）
   用法：node deploy/selftest-queue-render.js [index.html 路径，默认 ui/index.html]
   原理：从 ui/index.html 抽 queueRender/fmtTime 等函数，在最小 DOM 桩上连跑 N 轮渲染：
     - 后端 busyAt 每轮都变（真实行为：SSE 事件刷新 queueBusy=Date.now()）
     - 断言：#queueBar 内 qhead/qfoot/qitem 恒为 1 份（修复前每次重绘追加一份 → 堆叠）
     - 断言：切会话后不残留上一会话行；空队列置 hidden 且清空
   退出码：0 全 PASS；1 有 FAIL。 */
'use strict'
const fs = require('fs')
const vm = require('vm')
const path = require('path')

/* task381：抽取源由「index.html + 手拼 4 个模块」改为 selftest-load-ui 全量拼接串——
   queueRender/fmtTime 等函数分布已超出旧手拼清单（fmtTime 缺失即此因），全量串=唯一真相。 */
const file = process.argv[2] || path.join(__dirname, '..', 'ui')
const html = require('./selftest-load-ui').loadUiSource(
  file.endsWith('.html') ? path.dirname(file) : file
)

function grab (name) {
  const i = html.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('函数未找到：' + name + '（源码结构变了，请同步更新本自测）')
  let d = 0
  for (let k = html.indexOf('{', i); k < html.length; k++) {
    if (html[k] === '{') d++
    else if (html[k] === '}') { d--; if (!d) return html.slice(i, k + 1) }
  }
  throw new Error('函数体未闭合：' + name)
}
const src = ['fmtTime', '$', 'el', 'queueNowSid', 'queueStopPoll', 'queueStartPoll', 'queueElapsedStart', 'queueRender']
  .map(grab).join('\n')

/* ---- 最小 DOM 桩（只覆盖 queueRender 用到的 API） ---- */
function Node (tag) {
  const n = {
    tagName: tag, children: [], attrs: {}, style: {}, _text: '', _html: '', hidden: false, className: '',
    classList: {
      _s: new Set(),
      add (c) { this._s.add(c) },
      remove (c) { this._s.delete(c) },
      toggle (c, f) { if (f) this._s.add(c); else this._s.delete(c); return this._s.has(c) },
      contains (c) { return this._s.has(c) }
    },
    appendChild (c) { this.children.push(c); c._parent = this; return c },
    remove () { if (this._parent) { const a = this._parent.children; const i = a.indexOf(this); if (i >= 0) a.splice(i, 1) } },
    querySelector (sel) {
      const walk = (x) => {
        for (const c of x.children) {
          if (sel[0] === '#' && c.attrs.id === sel.slice(1)) return c
          if (sel[0] === '.' && String(c.className).split(/\s+/).includes(sel.slice(1))) return c
          const r = walk(c); if (r) return r
        }
        return null
      }
      return walk(this)
    }
  }
  Object.defineProperty(n, 'textContent', { get () { return this._text }, set (v) { this._text = String(v) } })
  Object.defineProperty(n, 'innerHTML', { get () { return this._html }, set (v) { this._html = v; this.children.length = 0 } })
  n.replaceChildren = function (...nodes) { this.children.length = 0; (nodes || []).forEach(x => this.appendChild ? this.appendChild(x) : this.children.push(x)) } /* task387：mock 跟进 replaceChildren */
  Object.defineProperty(n, 'id', { get () { return this.attrs.id || '' }, set (v) { this.attrs.id = v } })
  Object.defineProperty(n, 'title', { get () { return this.attrs.title || '' }, set (v) { this.attrs.title = v } })
  return n
}
const bar = Node('div'); bar.id = 'queueBar'; bar.hidden = true
const document = { hidden: false, querySelector: (s) => (s === '#queueBar' ? bar : null), createElement: (t) => Node(t) }
const S = { busyBy: {}, busyReady: {}, idleEpoch: {}, lastTurnKilled: {}, queueOpen: true }

const ctx = {
  document, S, Q_POLL_MS: 3000, Q_TIMER: null, Q_ELAPSED_T: null, Q_COUNT: 0, Q_WARNED: '', Q_RENDER_FP: '',
  setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {},
  Date, JSON, Math, String, console,
  $: (s) => document.querySelector(s),
  el: (t, c, x) => { const e = Node(t); if (c) e.className = c; if (x != null) e.textContent = x; return e }
}
vm.createContext(ctx)
vm.runInContext(src + '\nthis.queueRender = queueRender;', ctx)

let fail = 0
function check (label, ok, extra) { console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra ? '  ' + extra : '')); if (!ok) fail++ }

const sid = 'ses_A'
S.busyBy[sid] = true; S.busyReady[sid] = true
function payload (tick, sid2, echo, id, items) {
  return {
    session: sid2 || sid, paused: false, count: items ? items.length : 1,
    items: items || [{ id: id || 'q_1', at: Date.now() - 5000, echo: echo || '和你推荐的，兄弟', state: 'queued' }],
    busy: true, busyAt: Date.now() + tick, busyEpoch: 111, serveDown: false, turnInterrupt: 0
  }
}

/* ① 20 轮渲染（busyAt 每轮变化）→ 只应存在一份 head/item/foot */
for (let i = 0; i < 20; i++) ctx.queueRender(payload(i * 3000))
const cnt = (cls) => bar.children.filter((c) => c.className === cls).length
check('20 轮重绘后 qhead 唯一', cnt('qhead') === 1, '(实际 ' + cnt('qhead') + ')')
check('20 轮重绘后 qfoot 唯一', cnt('qfoot') === 1, '(实际 ' + cnt('qfoot') + ')')
check('20 轮重绘后 qitem 唯一', cnt('qitem') === 1, '(实际 ' + cnt('qitem') + ')')

/* ② 切会话同形状 payload → 不得复用上一会话 DOM */
ctx.queueRender(payload(0, 'ses_B', '另一会话', 'q_9'))
const row = bar.children.find((c) => c.className === 'qitem')
check('切会话后首行为新会话内容', !!row && row.children[0].textContent === '另一会话')

/* ③ 空队列 → hidden + 清空 */
ctx.queueRender({ session: 'ses_B', items: [], paused: false, busy: false })
check('空队列置 hidden 且清空 DOM', bar.hidden === true && bar.children.length === 0)

console.log(fail ? '\nRESULT: FAIL（' + fail + ' 项）' : '\nRESULT: PASS')
process.exit(fail ? 1 : 0)

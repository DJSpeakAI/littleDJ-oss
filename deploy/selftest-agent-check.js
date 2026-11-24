#!/usr/bin/env node
// task184 派单角色丢失核对闸 专项自测
// 运行：node deploy/selftest-agent-check.js   （EXIT=0 全过）
// 覆盖：①server 判据矩阵 ②UI 同源判据交叉断言（防双实现漂移）③真库只读扫描形状 ④机制静态断言
'use strict'
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const TD = require(path.join(__dirname, '..', 'server', 'task-derive.js'))
const P = require(path.join(__dirname, '..', 'server', 'proxy.js'))
const REPO = path.join(__dirname, '..')
const UI = path.join(REPO, 'ui', 'index.html')
const PROXY = path.join(REPO, 'server', 'proxy.js')
let pass = 0, fail = 0
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name + (extra ? ' -> ' + extra : '')) }
  else { fail++; console.log('FAIL ' + name + (extra ? ' -> ' + extra : '')) }
}
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  ok(name + ' (got ' + g + ')', g === w)
}

if (typeof TD.agentMismatchOf !== 'function') { console.error('FAIL: agentMismatchOf 未导出'); process.exit(2) }
if (typeof TD.deriveAgentMismatch !== 'function') { console.error('FAIL: deriveAgentMismatch 未导出'); process.exit(2) }
if (typeof P.agentCheckStep !== 'function') { console.error('FAIL: agentCheckStep 未导出'); process.exit(2) }

/* ---- ① server 判据矩阵 ---- */
const CASES = [
  // [title, agent, 期望返回(实际agent)或 '']
  ['方案审：拖拽加载与自定义回答 (@censor-plan subagent)', 'build', 'build'],                 // task265 新键·命中·回落 build
  ['task147 产出审 (@censor-output subagent)', 'build', 'build'],                             // task265 新键·命中·回落 build
  ['御史终审桌面卡片代码 (@censor-plan subagent)', 'general', 'general'],                     // 命中·回落 general
  ['只读诊断右栏任务面板 (@steward subagent)', 'build', 'build'],                            // 命中·回落 build
  ['串角色 (@censor-plan subagent)', 'censor-output', 'censor-output'],                       // 命中·串角色
  ['产出审：拖拽加载与问答增强 (@censor-output subagent)', 'censor-output', ''],              // 不命中·一致
  ['历史产出审 (@censor-deepseek subagent)', 'build', 'build'],                               // task265 退役旧键·命中（历史标题兜底）
  ['历史产出审 (@censor-glm subagent)', 'censor-glm', ''],                                    // task265 退役旧键·不命中·一致
  ['标题 (@build subagent)', 'build', ''],                                                     // 不命中·内置一致
  ['普通标题', 'butler', ''],                                                                  // 不命中·无后缀
  ['标题 (@nonsense subagent)', 'build', ''],                                                  // 不命中·后缀不在白名单
  ['标题 (@censor-plan subagent)', '', ''],                                                    // 不命中·agent 空
  ['标题 (@censor-plan subagent)', null, ''],                                                  // 不命中·agent null
  ['', 'build', '']                                                                            // 不命中·空标题
]
CASES.forEach(function (c, i) { eq('server-判据#' + (i + 1), TD.agentMismatchOf(c[0], c[1]), c[2]) })

/* ---- ② UI 同源判据交叉断言（前端无法 require；从 UI 源提取后 vm 执行）
   task381：提取源由「直读 index.html」改为 selftest-load-ui 拼接串——CHILD_TITLE_SUFFIX_RE 等
   已迁入 ts 模块产物，直读 index.html 恒 MISS（与 edge-swipe 同因）。 ---- */
const html = require('./selftest-load-ui').loadUiSource(path.join(REPO, 'ui'))
function grab(re, name) {
  const m = html.match(re)
  if (!m) throw new Error('UI 提取失败：' + name)
  return m[0]
}
let uiJudge = null
try {
  const src = [
    grab(/var CHILD_TITLE_SUFFIX_RE = [^\n]+/, 'CHILD_TITLE_SUFFIX_RE'),
    grab(/var AGENT_ROLE_WHITELIST = [^\n]+/, 'AGENT_ROLE_WHITELIST'),
    grab(/function childMismatchAgent\(c\)\{[\s\S]*?\n\}/, 'childMismatchAgent')
  ].join('\n')
  const ctx = { __out: null }
  vm.createContext(ctx)
  vm.runInContext(src + '\n__out = childMismatchAgent;', ctx)
  uiJudge = ctx.__out
} catch (e) {
  ok('ui-提取', false, String(e && e.message))
}
ok('ui-提取 childMismatchAgent', typeof uiJudge === 'function')
if (typeof uiJudge === 'function') {
  CASES.forEach(function (c, i) {
    let got = null
    try { got = uiJudge({ title: c[0], agent: c[1] }) } catch (e) { got = 'THROW:' + (e && e.message) }
    eq('ui-同源判据#' + (i + 1), got, c[2])
  })
}
// 白名单同源：两边键集合一致（防一边补表另一边漏）
try {
  const uiWlSrc = grab(/var AGENT_ROLE_WHITELIST = (\{[^}]*\})/, '白名单字面量')
  const uiWl = vm.runInNewContext('(' + uiWlSrc.replace(/^var AGENT_ROLE_WHITELIST = /, '') + ')')
  const proxySrc = fs.readFileSync(PROXY, 'utf8')
  const tdSrc = fs.readFileSync(path.join(REPO, 'server', 'task-derive.js'), 'utf8')
  const wantKeys = ['butler', 'steward', 'secretariat', 'writer', 'censor-plan', 'censor-output', 'censor-deepseek', 'censor-glm', 'build', 'general', 'explore'] /* task265：新旧键并存（旧键退役永留） */
  eq('ui-白名单键', Object.keys(uiWl).sort(), wantKeys.slice().sort())
  ok('server-白名单在 task-derive 源内同集', wantKeys.every(function (k) { return tdSrc.indexOf("'" + k + "'") >= 0 || tdSrc.indexOf(k + ':') >= 0 }))
  ok('proxy 只经 TD 判据（无自建白名单双实现）', proxySrc.indexOf('AGENT_ROLE_WHITELIST') < 0 && proxySrc.indexOf('agentMismatchOf') >= 0)
} catch (e) {
  ok('白名单同源断言', false, String(e && e.message))
}

/* ---- ③ 真库只读扫描形状（不写库；锁定「命中即存量 mismatch」与 rootId 上溯） ---- */
try {
  const r = TD.deriveAgentMismatch(null, Date.now() - 30 * 24 * 3600 * 1000)
  ok('db-扫描 ok', r.ok === true, 'reason=' + (r.reason || ''))
  if (r.ok) {
    ok('db-命中非空（存量应 ≥1，零命中需人工确认判据是否失效）', r.rows.length >= 1, 'rows=' + r.rows.length)
    ok('db-每行 rootId 非空且不等于自身', r.rows.every(function (x) { return x.rootId && x.rootId !== x.id }))
    ok('db-每行 want∈白名单', r.rows.every(function (x) { return ['butler', 'steward', 'secretariat', 'writer', 'censor-plan', 'censor-output', 'censor-deepseek', 'censor-glm', 'build', 'general', 'explore'].indexOf(x.want) >= 0 }))
    ok('db-每行 agent 与 want 严格不等', r.rows.every(function (x) { return x.agent !== x.want }))
    ok('db-行字段齐全', r.rows.every(function (x) { return 'id' in x && 'parentID' in x && 'rootId' in x && 'want' in x && 'agent' in x && 'created' in x && 'updated' in x && 'archived' in x }))
  }
} catch (e) {
  ok('db-扫描异常', false, String(e && e.message))
}

/* ---- ④ 机制静态断言（护栏存在性，防实现回退） ---- */
const px = fs.readFileSync(PROXY, 'utf8')
const asserts = [
  ['tick 挂载（autoReapTick 内调用 agentCheckStep）', /agentCheckStep\(_acFinish\)/.test(px)],
  ['独立 try 隔离', /try \{ agentCheckStep\(_acFinish\) \} catch/.test(px)],
  ['首 tick 观察保护', /firstTickAfterBoot/.test(px) && /observe-boot/.test(px)],
  ['同 sid 幂等（seen + 终态正则）', /AGENT_CHECK_TERMINAL_RE/.test(px)],
  ['override 终态跳过（P1-2）', /skip-override/.test(px)],
  ['rootId 空按 sid 单计（P1-1）', /'sid:' \+ sid/.test(px)],
  ['连败 2 次退避', /giveup-after-fails/.test(px)],
  ['同根熔断', /AGENT_CHECK_ROOT_BREAKER/.test(px) && /breaker-stop/.test(px)],
  ['先占位再 abort（P2-3）', /action: 'aborting'/.test(px)],
  ['already-finished 只审计（P2-4）', /already-finished/.test(px)],
  ['通知文案含 reopen 降级说明（P1-3）', /reopen 仅恢复台账标记/.test(px)],
  ['复用 cancelAbortOne', /cancelAbortOne\(sid, function/.test(px)],
  ['端点 /_agent-check', /pn === '\/_agent-check'/.test(px)],
  ['审计文件 0600', /agent-mismatch-log\.jsonl/.test(px) && /mode: 0o600/.test(px)],
  ['熔断只通知一次（P1-1 产出审）', /notifBreaker/.test(px) && /已熔断/.test(px)],
  ['同步段异常兜底复位（P2-1）', /skipped: 'throw'/.test(px)]
]
asserts.forEach(function (a) { ok('静态·' + a[0], a[1]) })

console.log('\n==== ' + pass + ' PASS / ' + fail + ' FAIL ====')
process.exit(fail ? 1 : 0)

#!/usr/bin/env node
/* deploy/vault-tool.js —— task298 密码本逃生工具（方案稿 §六，只读诊断 + 显式导出）
   设计依据：方案审 r1 P1-4 / 尺三-3 减法——只留 verify/export 两命令：
   - verify：只读校验（key 可载 + v2 可解 + schema 合法），零口令零写盘零明文打印
   - export：解密明文 → 默认 stdout；--out 必须绝对路径 + 0600 + 显式 --yes（人工确认才落明文副本）
   口令零 argv：不接收任何口令参数（本机工具，读 LITTLEDJ_ROOT 或默认值由 server/paths.js 解析；不碰生产 auth.txt）
   用法：
     node deploy/vault-tool.js verify
     node deploy/vault-tool.js export [--out /abs/path --yes] */
'use strict'
const fs = require('fs')
const path = require('path')
const VC = require(path.join(__dirname, '..', 'server', 'vault-crypto'))

const ROOT = require('../server/paths').ROOT
const VP = VC.vaultPath(ROOT)

function fail (msg) { console.error('FAIL: ' + msg); process.exit(1) }

function loadEnv () {
  let raw
  try { raw = fs.readFileSync(VP, 'utf8') }
  catch (e) { fail('vault.json 读取失败：' + (e && e.message) + '（路径 ' + VP + '）') }
  let j = null
  try { j = JSON.parse(raw) } catch (e) { j = null }
  if (!j || j.version !== 2) fail('vault.json 不是 v2 加密格式（v1 明文或损坏；v1 请先经 proxy 迁移）')
  return j
}

const cmd = process.argv[2]
if (cmd === 'verify') {
  const key = VC.loadKey(ROOT)
  if (!key) fail('vault.key 缺失/非法（' + VC.keyPath(ROOT) + '，需 32 字节 base64）')
  const env = loadEnv()
  let payload
  try { payload = VC.decryptVault(key, env) } catch (e) { fail('解密失败：' + (e && e.message)) }
  const n = payload.items.length
  console.log('OK: key 合法 + v2 解密成功 + schema 合法；条数=' + n + '（值不打印）')
  process.exit(0)
}

if (cmd === 'export') {
  const key = VC.loadKey(ROOT)
  if (!key) fail('vault.key 缺失/非法（key 丢失=数据不可解，无明文快照）')
  const env = loadEnv()
  let payload
  try { payload = VC.decryptVault(key, env) } catch (e) { fail('解密失败：' + (e && e.message)) }
  const outIdx = process.argv.indexOf('--out')
  if (outIdx < 0) {
    process.stdout.write(JSON.stringify({ version: 1, items: payload.items }, null, 2) + '\n') // 默认 stdout（P1-4.②）
    process.exit(0)
  }
  const outPath = process.argv[outIdx + 1]
  if (!outPath || !path.isAbsolute(outPath)) fail('--out 必须绝对路径')
  if (process.argv.indexOf('--yes') < 0) fail('落明文文件必须显式 --yes（产生明文副本，请确认目的地安全）')
  fs.writeFileSync(outPath, JSON.stringify({ version: 1, items: payload.items }, null, 2), { mode: 0o600 })
  try { fs.chmodSync(outPath, 0o600) } catch (e) {}
  console.log('OK: 明文已导出 ' + outPath + '（0600；用完请尽快删除）')
  process.exit(0)
}

fail('用法：node deploy/vault-tool.js verify | export [--out /abs/path --yes]')

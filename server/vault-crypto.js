// server/vault-crypto.js —— task298 密码本静态加密共享模块（proxy 与 vault-tool 共用，杜绝两份实现漂移）
// 设计依据：docs/2026-11-15 密码本静态加密改造-task298-方案稿.md rev.2 + 方案审裁决书 r2（P1-1/P1-2/P2-2）
'use strict'
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const VAULT_AAD = 'littleDJ-vault-v2'

function vaultPath (root) { return path.join(root, 'data', 'vault.json') }
function keyPath (root) { return path.join(root, 'config', 'vault.key') }

/* 目录 fsync（FUSE 不支持时由调用方记档，残余风险=断电丢 rename） */
function syncDir (dir) {
  const fd = fs.openSync(dir, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

/* 读 key：缺失/非法一律返回 null（不抛）；base64 先 trim（P2-2：Node base64 解码对非法字符宽松，靠 32B 长度校验兜底） */
function loadKey (root) {
  let raw = null
  try { raw = fs.readFileSync(keyPath(root), 'utf8') } catch (e) { return null }
  if (!raw) return null
  let buf = null
  try { buf = Buffer.from(String(raw).trim(), 'base64') } catch (e) { return null }
  if (!buf || buf.length !== 32) return null
  return buf
}

/* key 原子写：tmp(open 0600)+write+fsync+rename+chmod 兜底+目录 fsync 尽力而为（P1-1.②） */
function writeKeyAtomic (root, keyBuf) {
  if (!keyBuf || keyBuf.length !== 32) throw new Error('key 必须为 32 字节')
  const kp = keyPath(root)
  fs.mkdirSync(path.dirname(kp), { recursive: true })
  const tmp = kp + '.tmp-' + process.pid
  const fd = fs.openSync(tmp, 'w', 0o600)
  try { fs.writeSync(fd, keyBuf.toString('base64')); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  fs.renameSync(tmp, kp)
  try { fs.chmodSync(kp, 0o600) } catch (e) {}
  try { syncDir(path.dirname(kp)) } catch (e) {}
  return keyBuf
}

/* 只在「全新安装」或「v1 迁移」时由调用方调用；v2 已存在而 key 缺失时禁止调用（P1-1.①） */
function ensureKey (root) {
  const cur = loadKey(root)
  if (cur) return cur
  return writeKeyAtomic(root, crypto.randomBytes(32))
}

/* 明文 {items:[...]} → v2 envelope（不含 updatedAt，由调用方补充）；每次随机新 iv（禁复用，P2-2） */
function encryptVault (keyBuf, itemsObj) {
  if (!keyBuf || keyBuf.length !== 32) throw new Error('key 非法（32B）')
  if (!itemsObj || !Array.isArray(itemsObj.items)) throw new Error('payload schema 非法（items 数组）')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', keyBuf, iv)
  c.setAAD(Buffer.from(VAULT_AAD, 'utf8'))
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(itemsObj), 'utf8')), c.final()])
  const tag = c.getAuthTag() // 16B
  return { version: 2, alg: 'aes-256-gcm', aad: VAULT_AAD, iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') }
}

/* v2 envelope → {items:[...]}；任何一步异常抛错（调用方一律转 fail-closed，P2-2） */
function decryptVault (keyBuf, env) {
  if (!keyBuf || keyBuf.length !== 32) throw new Error('key 非法（32B）')
  if (!env || typeof env !== 'object' || env.version !== 2 || env.alg !== 'aes-256-gcm' || env.aad !== VAULT_AAD) throw new Error('envelope 不合法（version/alg/aad）')
  let iv, tag, ct
  try {
    iv = Buffer.from(String(env.iv || '').trim(), 'base64')
    tag = Buffer.from(String(env.tag || '').trim(), 'base64')
    ct = Buffer.from(String(env.ct || '').trim(), 'base64')
  } catch (e) { throw new Error('密文参数 base64 非法') }
  if (iv.length !== 12) throw new Error('iv 必须为 12 字节')
  if (tag.length !== 16) throw new Error('tag 必须为 16 字节')
  if (ct.length === 0) throw new Error('ct 为空')
  const d = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv)
  d.setAAD(Buffer.from(VAULT_AAD, 'utf8'))
  d.setAuthTag(tag) // 必须在 final 前（P2-2）
  let pt
  try { pt = Buffer.concat([d.update(ct), d.final()]) } catch (e) { throw new Error('解密失败（tag 不符或密文损坏）') }
  let payload = null
  try { payload = JSON.parse(pt.toString('utf8')) } catch (e) { throw new Error('解密后 payload 非法 JSON') }
  if (!payload || !Array.isArray(payload.items)) throw new Error('payload schema 非法（items 数组）')
  return payload
}

/* v1 识别（方案审 r2 P1-2：真实 v1 无 version 字段——saveVault 旧写 {items,updatedAt}） */
function isV1 (j) {
  if (!j || typeof j !== 'object' || !Array.isArray(j.items)) return false
  if (j.ct !== undefined || j.iv !== undefined || j.tag !== undefined) return false
  return j.version === undefined || j.version === 1
}

module.exports = { VAULT_AAD, vaultPath, keyPath, syncDir, loadKey, writeKeyAtomic, ensureKey, encryptVault, decryptVault, isV1 }

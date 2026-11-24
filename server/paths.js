'use strict'
// server/paths.js —— 运行根单一真相源（task400）
// 解析优先级：LITTLEDJ_ROOT 覆盖 > 旧家（主目录下的 littleDJ，哨兵 config/auth.txt 存在）> 新家 <仓库>/runtime（同哨兵）> 抛错。
// 为什么旧家优先（与方案稿 rev.2「新家优先」的差别，产出审 #1 请核）：
//   自测普遍用 HOME=沙箱 做隔离——旧家跟着 $HOME 走，沙箱里有哨兵就落沙箱；生产里新旧两家只存其一
//   （搬家 = 整目录 mv），谁有哨兵谁生效。「新家优先」会让「HOME=沙箱但没设 LITTLEDJ_ROOT」的进程
//   在搬家后静默写进真实运行根。新家另加一道闸：仓库不在当前 $HOME 之下（HOME 被改写）时不可选。
// 不变量：任何入口不得自建空运行根——两家都没哨兵就抛错，不 mkdir、不回落。
// 旧家回落是兼容期（task400），观察 3 天后由 task401 删除。shell 侧同口径见 deploy/runtime-root.sh。
const fs = require('fs')
const os = require('os')
const path = require('path')

const REPO = path.resolve(__dirname, '..')
const NEW_ROOT = path.join(REPO, 'runtime')
const LEGACY_ROOT = path.join(os.homedir(), 'littleDJ')   // 跟随 $HOME：自测沙箱的隔离语义保持不变
const SENTINEL = path.join('config', 'auth.txt')

function hasSentinel(root) {
  try { return fs.statSync(path.join(root, SENTINEL)).isFile() } catch (e) { return false }
}
function inside(parent, child) {
  const rel = path.relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}
function resolveRoot() {
  if (process.env.LITTLEDJ_ROOT) return process.env.LITTLEDJ_ROOT
  if (hasSentinel(LEGACY_ROOT)) return LEGACY_ROOT
  if (inside(os.homedir(), REPO) && hasSentinel(NEW_ROOT)) return NEW_ROOT
  throw new Error('运行根不存在：' + LEGACY_ROOT + ' 与 ' + NEW_ROOT + ' 都没有 ' + SENTINEL +
    '——拒绝自建空根（从备份恢复，或用 LITTLEDJ_ROOT 指定）')
}

const ROOT = resolveRoot()

module.exports = { REPO, ROOT, NEW_ROOT, LEGACY_ROOT, SENTINEL, hasSentinel }

// deveco.db 在线备份：SQLite Online Backup API（node:sqlite backup）
// 用途：deploy/db-backup.sh 调用；serve 无需停机，只短暂持读锁
// 用法：node deploy/db-backup.js <输出路径>
'use strict'
const { DatabaseSync, backup } = require('node:sqlite')
const fs = require('node:fs')
const path = require('node:path')

const DB = process.env.DEVECO_DB || '/storage/Users/currentUser/.local/share/deveco/deveco.db'
const OUT = process.argv[2]

function log(s) { console.log('[db-backup ' + ts() + '] ' + s) }

function ts() {
  const d = new Date()
  const p = function (n) { return String(n).padStart(2, '0') }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

function human(n) {
  if (n >= 1024 * 1024 * 1024) return (n / 1024 / 1024 / 1024).toFixed(2) + ' GiB'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MiB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KiB'
  return n + ' B'
}

async function main() {
  if (!OUT) {
    console.error('用法: node deploy/db-backup.js <输出路径>')
    process.exit(2)
  }
  if (!fs.existsSync(DB)) {
    console.error('源库不存在: ' + DB)
    process.exit(2)
  }
  const st = fs.statSync(DB)
  const dir = path.dirname(OUT)
  fs.mkdirSync(dir, { recursive: true })

  // 空间预检：备份文件与原库同尺寸，留 15% 余量（gzip 阶段另需同量临时空间由 .sh 负责）
  if (typeof fs.statfsSync === 'function') {
    const sf = fs.statfsSync(dir)
    const avail = Number(sf.bavail) * Number(sf.bsize)
    const need = st.size * 1.15
    log('源库 ' + human(st.size) + '，目标分区可用 ' + human(avail) + '，需要 ≥ ' + human(need))
    if (avail < need) {
      console.error('可用空间不足（需 ≥ ' + human(need) + '），拒绝开始')
      process.exit(3)
    }
  }

  if (fs.existsSync(OUT)) fs.rmSync(OUT)
  log('开始在线备份 -> ' + OUT)
  const t0 = Date.now()
  const db = new DatabaseSync(DB, { readOnly: true })
  try {
    await backup(db, OUT)
  } finally {
    try { db.close() } catch (e) { /* 已关闭 */ }
  }
  const sz = fs.statSync(OUT).size
  log('备份完成 ' + human(sz) + '，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's')
  console.log('RESULT: ok path=' + OUT + ' bytes=' + sz)
}

main().catch(function (e) {
  console.error('RESULT: fail ' + (e && e.message))
  process.exitCode = 1
})

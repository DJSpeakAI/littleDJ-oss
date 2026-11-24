'use strict'
// db-clean-event-online：serve 运行中在线分批清 event 流水（task378 每周清理的数据库步）
// 与 db-clean.js 的区别：不停 serve、不备份核心表（只删可再生流水，兜底=backup/ 的 gz 全量+近期 core 备份）、
// 小批 5000 行 + busy_timeout 5s + 批间同步小睡，把与 serve 的写锁竞争压到毫秒级。
// freelist 复用语义：删后文件不缩，但新写入复用空闲页 → 周周清=库体积稳态（不 VACUUM 不缩文件，见 task377 文档）。
// 用法：node db-clean-event-online.js [--dry]；env LITTLEDJ_DEVECO_DB 指定库、LITTLEDJ_EVENT_KEEP 调保留行数。
const { DatabaseSync } = require('node:sqlite')

const DB = process.env.LITTLEDJ_DEVECO_DB || '/storage/Users/currentUser/.local/share/deveco/deveco.db'
const DRY = process.argv.includes('--dry')
const KEEP = Number(process.env.LITTLEDJ_EVENT_KEEP || 20000)
const BATCH = 5000
const SLEEP_MS = 300
const MAX_DELETE = 4000000 // 单次上限护栏（400 万行≈80GB，正常周增量 ~70 万行远达不到）

function log(s) { console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + s) }
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) }

const db = new DatabaseSync(DB)
try {
  db.exec('PRAGMA busy_timeout=5000')
  const before = db.prepare('SELECT COUNT(*) c FROM event').get().c
  const max = db.prepare('SELECT MAX(rowid) m FROM event').get().m || 0
  const cutoff = max - KEEP
  const target = Math.max(0, cutoff)
  if (target <= 0) { log('event 行数 ' + before + ' ≤ 保留窗 ' + KEEP + '，无需清理'); console.log('RESULT: ok deleted=0 remain=' + before); return }
  if (DRY) {
    const est = db.prepare('SELECT COUNT(*) c FROM event WHERE rowid <= ?').get(target).c
    log('[dry] 将删除 ' + est + ' 行（保留最近 ' + KEEP + '，当前共 ' + before + '）')
    console.log('RESULT: dry wouldDelete=' + est + ' remain=' + (before - est))
    return
  }
  let total = 0
  while (total < MAX_DELETE) {
    let r
    try {
      r = db.prepare('DELETE FROM event WHERE rowid IN (SELECT rowid FROM event WHERE rowid <= ? ORDER BY rowid LIMIT ?)').run(target, BATCH)
    } catch (e) {
      if (String(e.message).indexOf('locked') >= 0 || String(e.message).indexOf('busy') >= 0) { log('写锁竞争，等 2s 重试（已删 ' + total + '）'); sleepSync(2000); continue }
      throw e
    }
    total += r.changes
    try { db.prepare('PRAGMA wal_checkpoint(PASSIVE)').get() } catch (e) { /* serve 在读时 PASSIVE 不阻塞，失败下批再试 */ }
    if (r.changes === 0) break
    log('已删 ' + total + ' / 目标 ~' + (before - KEEP))
    sleepSync(SLEEP_MS) // 给 serve 让出写窗口
  }
  const after = db.prepare('SELECT COUNT(*) c FROM event').get().c
  const fl = db.prepare('PRAGMA freelist_count').get().freelist_count
  log('清理完成：' + before + ' -> ' + after + ' 行（删除 ' + total + '）；freelist ' + fl + ' 页（≈' + (fl * 4096 / 1073741824).toFixed(2) + 'GB 可复用，不 VACUUM 不缩文件）')
  console.log('RESULT: ok deleted=' + total + ' remain=' + after + ' freelistGB=' + (fl * 4096 / 1073741824).toFixed(2))
} catch (e) {
  console.log('RESULT: fail ' + (e && e.message))
  process.exitCode = 1
} finally {
  try { db.close() } catch (e) {}
}

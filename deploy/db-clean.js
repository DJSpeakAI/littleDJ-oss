// deveco.db event 表瘦身：备份核心表 → 分批清 event（保留最近 2 万行）→ wal 归零
// 仅供 deploy/db-shrink.sh 调用（serve 必须已停）；分批 + 每批 checkpoint 控制 wal 峰值
'use strict';
var { DatabaseSync } = require('node:sqlite');

var DB = '/storage/Users/currentUser/.local/share/deveco/deveco.db';
var BK = require('../server/paths').ROOT + '/backup/deveco-core-' + new Date().toISOString().slice(0, 10) + '.db';
var KEEP = 20000;
var BATCH = 50000;
var CORE_TABLES = ['session', 'session_message', 'session_input', 'message', 'part', 'project', 'project_directory', 'todo', 'permission'];

function log(s){ console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + s) }

var db = new DatabaseSync(DB);
try {
  // 1. 备份核心表（event 不备——它就是要清的流水）
  var fs = require('fs');
  fs.mkdirSync(require('../server/paths').ROOT + '/backup', { recursive: true });
  if (fs.existsSync(BK)) fs.unlinkSync(BK);
  db.exec("ATTACH '" + BK + "' AS bk");
  CORE_TABLES.forEach(function (t) {
    try { db.exec('CREATE TABLE bk.' + t + ' AS SELECT * FROM main.' + t); log('备份 ' + t + ' 完成') }
    catch (e) { log('备份 ' + t + ' 跳过: ' + e.message) }
  });
  db.exec('DETACH bk');
  log('核心表备份完成 -> ' + BK);

  // 2. 分批清 event
  var before = db.prepare('SELECT COUNT(*) c FROM event').get().c;
  var max = db.prepare('SELECT MAX(rowid) m FROM event').get().m || 0;
  var cutoff = max - KEEP;
  var total = 0;
  while (true) {
    var r = db.prepare('DELETE FROM event WHERE rowid IN (SELECT rowid FROM event WHERE rowid <= ? ORDER BY rowid LIMIT ?)').run(cutoff, BATCH);
    total += r.changes;
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (r.changes === 0) break;
    log('已删 ' + total + ' / 目标 ~' + (before - KEEP));
  }
  var after = db.prepare('SELECT COUNT(*) c FROM event').get().c;
  log('清理完成：' + before + ' -> ' + after + ' 行（删除 ' + total + '）');

  // 3.5 task377：--vacuum 时实际缩文件（历史遗留——11-04 首版只删不 vacuum，11-18 复胖到 59GB/event 51GB）。
  // 前置：serve 必须已停（db-shrink.sh 保证）；耗时与库大小成正比（59GB 预计 10~20min）；临时空间≈库大小。
  if (process.argv.includes('--vacuum')) {
    var vpc0 = db.prepare('PRAGMA page_count').get().page_count;
    log('VACUUM 开始（page_count=' + vpc0 + '，≈' + (vpc0 * 4096 / 1073741824).toFixed(1) + 'GB）...');
    var vt = Date.now();
    db.exec('VACUUM');
    var vpc1 = db.prepare('PRAGMA page_count').get().page_count;
    log('VACUUM 完成：耗时 ' + Math.round((Date.now() - vt) / 1000) + 's，page_count ' + vpc0 + ' -> ' + vpc1 + '（≈' + (vpc1 * 4096 / 1073741824).toFixed(2) + 'GB）');
  }

  // 3. 空间报告（删后进 freelist 复用，文件不变小但不复发膨胀）
  var pc = db.prepare('PRAGMA page_count').get().page_count;
  var fl = db.prepare('PRAGMA freelist_count').get().freelist_count;
  log('db 页 ' + pc + '，freelist ' + fl + ' 页（可复用 ~' + (fl * 4096 / 1024 / 1024 / 1024).toFixed(2) + ' GB，需 VACUUM 才实际缩文件）');
  console.log('RESULT: ok deleted=' + total + ' remain=' + after);
} catch (e) {
  console.log('RESULT: fail ' + (e && e.message));
  process.exitCode = 1;
} finally {
  try { db.close() } catch (e) {}
}

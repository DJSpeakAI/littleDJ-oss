#!/bin/sh
# 数据保命：deveco.db 在线备份 -> gzip 压缩 -> 完整性校验 -> 按天轮转
# 用法：sh deploy/db-backup.sh
# 特点：在线备份（SQLite Online Backup API），serve 无需停机；只短暂持读锁
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
BK_DIR="$ROOT/backup"
LOG="$ROOT/logs/db-backup.log"
KEEP_DAYS="${DB_BACKUP_KEEP_DAYS:-7}"

PATH="$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

mkdir -p "$BK_DIR" "$ROOT/logs"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BK_DIR/deveco-full-$STAMP.db"

log "=== db-backup start (db=$ROOT) ==="

node "$REPO/deploy/db-backup.js" "$OUT" >> "$LOG" 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then
  log "在线备份失败 rc=$RC，中止（不删除任何已有备份）"
  exit "$RC"
fi

log "压缩中（gzip，原文件可临时占用同尺寸空间）..."
nice -n 10 gzip -6 "$OUT"
RC=$?
if [ "$RC" -ne 0 ]; then
  log "gzip 失败 rc=$RC"
  exit "$RC"
fi
GZ="$OUT.gz"

if gzip -t "$GZ" 2>/dev/null; then
  log "gzip 完整性校验通过: $GZ ($(ls -lh "$GZ" | awk '{print $5}'))"
else
  log "gzip 校验失败: $GZ（保留文件待人工排查）"
  exit 1
fi

# 轮转：只清理本脚本产出的 deveco-full-*.db.gz，不碰其它备份文件
OLD=$(find "$BK_DIR" -maxdepth 1 -name "deveco-full-*.db.gz" -mtime +"$KEEP_DAYS" -type f 2>/dev/null)
if [ -n "$OLD" ]; then
  echo "$OLD" | while read -r f; do
    [ -n "$f" ] && log "轮转删除过期备份: $f" && rm -f "$f"
  done
fi

log "=== db-backup done: $GZ ==="
echo "RESULT: ok $GZ"

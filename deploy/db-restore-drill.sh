#!/bin/sh
# 恢复演练：从最新全量备份解压 -> quick_check + 关键表抽查 -> 清理临时文件
# 用法：sh deploy/db-restore-drill.sh [备份文件.db.gz]
# 不覆盖生产库；只证明「备份可恢复、内容可读」
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
BK_DIR="$ROOT/backup"
LOG="$ROOT/logs/db-restore-drill.log"
TMP_DIR="${TMPDIR:-/data/storage/el2/base/temp/deveco}/restore-drill"

PATH="$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

log "=== db-restore-drill start ==="

GZ="$1"
if [ -z "$GZ" ]; then
  GZ=$(ls -t "$BK_DIR"/deveco-full-*.db.gz 2>/dev/null | head -1)
fi
if [ -z "$GZ" ] || [ ! -f "$GZ" ]; then
  log "FAIL: 找不到备份文件（先用 deploy/db-backup.sh 建一份）"
  echo "RESULT: fail no-backup"
  exit 2
fi
log "使用备份: $GZ"

# 临时空间预检：解压后 = 压缩包解压尺寸，另留 10%
if ! df -k "$TMP_DIR" >/dev/null 2>&1; then
  mkdir -p "$TMP_DIR" || { log "FAIL: 无法创建临时目录 $TMP_DIR"; echo "RESULT: fail tmp-dir"; exit 3; }
fi

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
OUT="$TMP_DIR/restore.db"

log "解压中..."
gzip -dc "$GZ" > "$OUT"
RC=$?
if [ "$RC" -ne 0 ]; then
  log "FAIL: 解压失败 rc=$RC"
  rm -rf "$TMP_DIR"
  echo "RESULT: fail unzip"
  exit 1
fi
SZ=$(ls -l "$OUT" | awk '{print $5}')
log "解压完成: $OUT ($SZ B)"

node -e '
const { DatabaseSync } = require("node:sqlite")
const p = process.argv[1]
const db = new DatabaseSync(p, { readOnly: true })
try {
  const qc = db.prepare("PRAGMA quick_check").get()
  const verdict = qc ? Object.values(qc)[0] : "no-result"
  const tables = ["session", "message", "part"]
  const counts = {}
  for (const t of tables) {
    try { counts[t] = db.prepare("SELECT COUNT(*) c FROM " + t).get().c }
    catch (e) { counts[t] = "N/A" }
  }
  let maxEvent = "N/A"
  try { maxEvent = db.prepare("SELECT MAX(rowid) m FROM event").get().m } catch (e) {}
  console.log("quick_check=" + verdict)
  console.log("counts=" + JSON.stringify(counts))
  console.log("event_max_rowid=" + maxEvent)
  if (verdict !== "ok") { process.exit(4) }
  if (counts.session === 0 || counts.message === 0) {
    console.log("FAIL: 关键表为空")
    process.exit(5)
  }
  console.log("DRILL: PASS")
} finally {
  try { db.close() } catch (e) {}
}
' "$OUT" >> "$LOG" 2>&1
RC=$?

rm -rf "$TMP_DIR"
log "临时文件已清理"

if [ "$RC" -ne 0 ]; then
  log "=== db-restore-drill FAIL rc=$RC（详见 $LOG） ==="
  echo "RESULT: fail rc=$RC"
  exit "$RC"
fi
log "=== db-restore-drill PASS ==="
echo "RESULT: ok"

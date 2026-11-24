#!/bin/sh
# deveco.db 瘦身一键脚本：停守护与 serve -> 备份核心表 -> 清 event 流水 -> 无条件拉活
# 用法：nohup sh deploy/db-shrink.sh >/dev/null 2>&1 &
# 注意：执行期间 littleDJ 页面会断流几分钟，watchdog 拉活后自动恢复。
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
LOG="$ROOT/logs/db-shrink.log"

# PATH 兜底（与 watchdog.sh 同源）
PATH="$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

echo "[$(date '+%F %T')] db-shrink start" >> "$LOG"

# 1. 停守护（防清理中途拉活 serve 造成写冲突），再停 serve
pkill -f "littleDJ/deploy/watchdog.sh" 2>/dev/null; sleep 1
pkill -f "serve --port 4098" 2>/dev/null; sleep 4
pkill -9 -f "serve --port 4098" 2>/dev/null; sleep 1
echo "[$(date '+%F %T')] serve/watchdog stopped" >> "$LOG"

# 2. 备份 + 清理（分批删 event，保留最近 2 万行）+ task377 VACUUM 实际缩文件
node "$REPO/deploy/db-clean.js" --vacuum >> "$LOG" 2>&1
RC=$?

# 3. 无论成败，拉活全家（幂等，会重新带起 watchdog）
sh "$REPO/deploy/start-harmony.sh" >> "$LOG" 2>&1
echo "[$(date '+%F %T')] services restarted rc=$RC" >> "$LOG"
echo "[$(date '+%F %T')] db-shrink done" >> "$LOG"

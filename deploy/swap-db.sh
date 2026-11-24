#!/bin/sh
# ⚠ 已过期，勿直接运行（task166 审计 2026-11-10）：2026-11-05 库损坏事故的一次性换库脚本，
#   下方 NEW 指向的抢救库文件已不存在；直接运行只会走「回滚 → 保持不变」分支，属死工具。
#   仅作历史存档（AOCI deploy/ 条目已标「一次性」）；需同类操作请按当前场景重写。
# 一次性换库：带伤生产库让位 -> 抢救库硬链接就位 -> 拉起全家 -> 验证
# 2026-11-05 库损坏修复专用；执行前请确认：watchdog 已停、抢救库 quick_check ok
REPO="/storage/Users/currentUser/project/littleDJ"
# 历史一次性脚本（2026-11-04 救库）：下面的路径是当时的救援路径，不参与运行根默认值；task400 静态闸对本文件整文件白名单
ROOT="$HOME/littleDJ"
NEW="/storage/Users/currentUser/littleDJ/backup/deveco.db.rescued-2026-11-0423260"
DB_DIR="/storage/Users/currentUser/.local/share/deveco"
TS=$(date +%Y%m%d-%H%M%S)
LOG="$ROOT/logs/db-swap-$TS.log"
PATH="$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

log "=== db swap begin ==="

# 1) 杀 serve（同 restart-serve.sh：grep 拿 pid + 连子进程）
PIDS=$(ps -ef | grep "deveco serve --port 4098" | grep -v grep | awk '{print $2}')
log "serve pids: $PIDS"
for p in $PIDS; do
  kill $(ps -ef | awk -v pp=$p '$3==pp{print $2}') $p 2>/dev/null
done
i=0
while curl -sf -m 1 http://127.0.0.1:4098/health >/dev/null 2>&1; do
  i=$((i+1))
  if [ $i -ge 15 ]; then kill -9 $PIDS 2>/dev/null; sleep 1; break; fi
  sleep 1
done
sleep 2
if curl -sf -m 1 http://127.0.0.1:4098/health >/dev/null 2>&1; then
  log "FATAL: serve 杀不掉，中止换库（库未动）"
  exit 1
fi
log "serve stopped"

# 2) 旧库让位（mv 保数据不删；wal/shm 一并）
cd "$DB_DIR" || { log "FATAL: cd $DB_DIR 失败"; exit 1; }
if [ -f deveco.db ]; then mv deveco.db "deveco.db.old-$TS" && log "mv deveco.db -> deveco.db.old-$TS"; fi
if [ -f deveco.db-wal ]; then mv deveco.db-wal "deveco.db-wal.old-$TS" && log "wal 让位"; fi
if [ -f deveco.db-shm ]; then mv deveco.db-shm "deveco.db-shm.old-$TS" && log "shm 让位"; fi

# 3) 抢救库硬链接就位（秒级；备份目录原名保留 = 同一份数据双名）
if [ ! -f "$NEW" ]; then log "FATAL: 抢救库不存在 $NEW，回滚"; mv "deveco.db.old-$TS" deveco.db 2>/dev/null; exit 1; fi
if ! ln "$NEW" deveco.db; then log "FATAL: ln 失败，回滚"; mv "deveco.db.old-$TS" deveco.db 2>/dev/null; exit 1; fi
chgrp 1006 deveco.db 2>/dev/null || log "WARN: chgrp 1006 失败（可能非 root，serve 同组可读即可）"
chmod 660 deveco.db
log "rescued linked: $(ls -l deveco.db | awk '{print $1, $3, $4, $5}')"

# 4) 拉起全家（serve + watchdog；relay/proxy 已在跑会幂等跳过）
sh "$REPO/deploy/start-harmony.sh" >> "$LOG" 2>&1
sleep 5

# 5) 验证
if curl -sf -m 3 http://127.0.0.1:4098/health >/dev/null 2>&1; then
  log "serve /health OK（新库上运行）"
else
  log "WARN: serve health 未过，等 watchdog/start-harmony 重试（详见 $LOG）"
fi
log "=== db swap done ==="

#!/bin/sh
# weekly-cleanup：每周日 09:00 全家清理（task378；由 watchdog.sh 周日窗口触发，也可手动跑）
# 主人原话（2026-11-18）：「把这个变成每周任务，每周日上午9点自动清理，不仅清 event，说白了电脑也可以全部清理……鸿蒙pc比较严格，好像不是什么都可以清理的，反正你能清的就清」
# 清单（全部=可再生产物，逐项幂等、可 --dry 预演）：
#   ① event 流水在线清（db-clean-event-online.js，保留最近 2 万行，serve 不停）
#   ② ~/.hdc/*.log 调试日志 >3 天删（曾堆积 2.6GB）
#   ③ ~/deveco/task* 临时目录（mtime>7 天整目录删——在途任务的文件 mtime 常新，天然不误删）
#   ④ serve 日志 ~/.local/share/deveco/log/deveco.log >100MB 截尾保 20MB（cat 回写保 inode，serve 无感）；
#      该目录 .running-* >7 天删、其他 *.log >30 天删
#   ⑤ <运行根>/logs/*.log >3MB 截尾保 2MB（watchdog/tunnel/relay 等长跑日志）
#   ⑥ <运行根>/cache/img-tiles/* 切图缓存清空（可再生）
#   ⑦ ~/.local/share/deveco/tool-output 工具输出 >7 天删
# 红线（永不清）：config/ data/ backup/（含 10.4GB gz 兜底）/ 任何项目目录 / db-wal/db-shm / serve 正在写的文件（截尾用 cat 保 inode）
# 用法：sh weekly-cleanup.sh [--dry]；单实例锁 10 分钟。
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
HOME_DIR="$(cd "$HOME" && pwd)"
LOG="$ROOT/logs/weekly-cleanup.log"
LOCK="$ROOT/run/weekly-cleanup.lock"
DRY="n"; [ "$1" = "--dry" ] && DRY="y"

PATH="$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

log() { echo "$(date '+%F %T') [weekly-cleanup] $*" >> "$LOG"; [ "$DRY" = "y" ] && echo "[dry] $*" ; }

avail_gb() { node -e "try{const s=require('fs').statfsSync('$HOME_DIR');console.log((s.bavail*s.bsize/1e9).toFixed(2))}catch(e){console.log('?')}"; }

# 单实例锁（stale 10min）
mkdir -p "$ROOT/run" "$ROOT/logs" 2>/dev/null
if [ -f "$LOCK" ]; then
  _old=$(cat "$LOCK" 2>/dev/null)
  _now=$(date +%s)
  [ -n "$_old" ] && [ $((_now - _old)) -lt 600 ] && { log "上一轮仍在跑（$((_now-_old))s），退出"; exit 0; }
fi
echo "$(date +%s)" > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

_A0=$(avail_gb)
log "=== 开始（mode=dry:$DRY，磁盘 avail ${_A0}GB）==="

# ① event 在线清（注意：DRY=y 才传 --dry；不能用 ${DRY:+--dry}——DRY="n" 非空也会展开）
if [ -f "$REPO/deploy/db-clean-event-online.js" ]; then
  _dd=""
  [ "$DRY" = "y" ] && _dd="--dry"
  _r=$(node "$REPO/deploy/db-clean-event-online.js" $_dd 2>&1 | tail -3)
  log "① event 在线清：$(echo "$_r" | tr '\n' ' ')"
else
  log "① 跳过（db-clean-event-online.js 不存在）"
fi

# ② ~/.hdc/*.log >2 天（hdc 调试日志 100MB 高速轮转——实测 3 天 2.6GB，>3 天阈值清不动；收紧到 2 天）
_now=$(date +%s)
_n=0
for f in "$HOME_DIR"/.hdc/*.log; do
  [ -f "$f" ] || continue
  _fy=$(stat -c %Y "$f" 2>/dev/null); [ -n "$_fy" ] || continue
  if [ "$DRY" = "y" ]; then [ $((_now - _fy)) -gt $((2*86400)) ] && _n=$((_n+1))
  else [ $((_now - _fy)) -gt $((2*86400)) ] && rm -f "$f" && _n=$((_n+1)); fi
done
log "② hdc 调试日志 >2 天：$_n 个"

# ③ ~/deveco/task* 临时目录 >7 天（按目录 mtime）
_n=0
for d in "$HOME_DIR"/deveco/task*; do
  [ -d "$d" ] || continue
  _dy=$(stat -c %Y "$d" 2>/dev/null); [ -n "$_dy" ] || continue
  if [ $((_now - _dy)) -gt $((7*86400)) ]; then
    if [ "$DRY" = "y" ]; then _n=$((_n+1)); else rm -rf "$d" 2>/dev/null && _n=$((_n+1)); fi
  fi
done
log "③ deveco/task* 临时目录 >7 天：$_n 个"

# ④ serve 日志轮转
DVL="$HOME_DIR/.local/share/deveco/log/deveco.log"
if [ -f "$DVL" ]; then
  _sz=$(stat -c %s "$DVL" 2>/dev/null || echo 0)
  if [ "$_sz" -gt 104857600 ]; then
    if [ "$DRY" = "y" ]; then log "④ serve 日志 $(( _sz / 1048576 ))MB → 将截尾保 20MB"
    else tail -c 20971520 "$DVL" > "$DVL.tmp" 2>/dev/null && cat "$DVL.tmp" > "$DVL" && rm -f "$DVL.tmp" && log "④ serve 日志 $(( _sz / 1048576 ))MB → 20MB（cat 保 inode）"
    fi
  else log "④ serve 日志 $(( _sz / 1048576 ))MB 未达 100MB，跳过"; fi
fi
if [ "$DRY" = "y" ]; then
  _n=$(find "$HOME_DIR/.local/share/deveco/log" -maxdepth 1 -name '.running-*' -mtime +7 2>/dev/null | wc -l)
  _m=$(find "$HOME_DIR/.local/share/deveco/log" -maxdepth 1 -name '*.log' ! -name 'deveco.log' -mtime +30 2>/dev/null | wc -l)
else
  _n=$(find "$HOME_DIR/.local/share/deveco/log" -maxdepth 1 -name '.running-*' -mtime +7 -delete 2>/dev/null | wc -l); _n=${_n:-0}
  _m=$(find "$HOME_DIR/.local/share/deveco/log" -maxdepth 1 -name '*.log' ! -name 'deveco.log' -mtime +30 -delete 2>/dev/null | wc -l); _m=${_m:-0}
fi
log "④ log 目录残留：.running->7天 清 $_n 个；旧 .log>30天 清 $_m 个"

# ⑤ littleDJ 大日志截尾 >3MB → 保 2MB
for f in "$ROOT"/logs/*.log; do
  [ -f "$f" ] || continue
  _sz=$(stat -c %s "$f" 2>/dev/null || echo 0)
  [ "$_sz" -gt 3145728 ] || continue
  if [ "$DRY" = "y" ]; then log "⑤ $(basename "$f") $(( _sz / 1048576 ))MB → 将截尾保 2MB"
  else tail -c 2097152 "$f" > "$f.tmp" 2>/dev/null && cat "$f.tmp" > "$f" && rm -f "$f.tmp" && log "⑤ $(basename "$f") $(( _sz / 1048576 ))MB → 2MB"; fi
done

# ⑥ img-tiles 缓存
if [ -d "$ROOT/cache/img-tiles" ]; then
  if [ "$DRY" = "y" ]; then log "⑥ img-tiles 将清空（$(ls "$ROOT/cache/img-tiles" 2>/dev/null | wc -l) 项）"
  else rm -rf "$ROOT/cache/img-tiles"/* 2>/dev/null; log "⑥ img-tiles 已清空"; fi
fi

# ⑦ tool-output >7 天
if [ "$DRY" = "y" ]; then
  _n=$(find "$HOME_DIR/.local/share/deveco/tool-output" -type f -mtime +7 2>/dev/null | wc -l)
else
  find "$HOME_DIR/.local/share/deveco/tool-output" -type f -mtime +7 -delete 2>/dev/null
  _n="done"
fi
log "⑦ tool-output >7 天：$_n"

_A1=$(avail_gb)
log "=== 完成（磁盘 avail ${_A0}GB → ${_A1}GB）==="
echo "RESULT: ok avail ${_A0}GB -> ${_A1}GB"

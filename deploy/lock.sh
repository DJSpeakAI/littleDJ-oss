#!/bin/sh
# deploy/lock.sh —— 任务锁龄工具（task114 · M1，2026-11-08）
#
# 用法：
#   sh deploy/lock.sh acquire <slug> <holder> <files>   # 建锁（已存在即拒，绝不覆盖）
#   sh deploy/lock.sh read    <slug>                    # 锁内容 + mtime 龄 + ghost_suspect
#   sh deploy/lock.sh touch   <slug> <holder>           # 刷 mtime 续命（holder 不符即拒）
#   sh deploy/lock.sh release <slug> <holder>           # 持有人显式释放（holder 不符即拒）
#   sh deploy/lock.sh list                               # 全锁清单：路径/holder/龄/ghost_suspect
#
# 幽灵锁判据（M1，censor-glm 第二轮定稿）：锁文件 mtime 龄 > TTL（默认 20 分钟，
# 环境变量 LOCK_TTL_MINUTES 覆盖）⇒ ghost_suspect。
#   - heartbeat 字段若存在仅作辅助显示，绝不参与判定（历史锁无该字段，按它判会误杀在途锁）。
#   - 本工具对 ghost 锁只报告、绝不删锁、绝不自动接管（接管 = M2 三证 + 互斥序列，另见枢机契约模板）。
#   - release 是持有人正常释放通道，与 ghost 处置无关，且要求 holder 逐字匹配。
#
# 锁三行格式（RULES.md §149 约定，格式不变）：
#   holder=<牌号>
#   acquiredAt=<时间>
#   files=<路径>
#
# 环境变量：
#   LOCK_TTL_MINUTES  幽灵判定阈值（默认 20）
#   LOCK_DIR          锁目录（默认 <脚本上级>/.taskqueue/locks；演练请指到 /tmp 假目录）

set -u

REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LOCK_DIR="${LOCK_DIR:-$REPO/.taskqueue/locks}"
TTL_MIN="${LOCK_TTL_MINUTES:-20}"

cmd="${1:-}"
slug="${2:-}"
lockfile=""

now_epoch() { date +%s; }
file_mtime() { stat -c %Y "$1" 2>/dev/null || echo 0; }

age_minutes() {
  _m=$(file_mtime "$1")
  _n=$(now_epoch)
  [ "$_m" -gt 0 ] 2>/dev/null || { echo "-1"; return; }
  echo $(( (_n - _m) / 60 ))
}

field_of() { # $1=文件 $2=字段名 → 取 holder=/files= 行的值
  sed -n "s/^$2=//p" "$1" 2>/dev/null | head -n 1
}

need_slug() {
  case "$slug" in
    "" | */* | *" "*) echo "ERROR: 非法 slug '$slug'（应为文件名安全串，如 ui-index-html）" >&2; exit 2 ;;
  esac
  lockfile="$LOCK_DIR/$slug.lock"
}

cmd="${1:-}"
case "$cmd" in

  acquire)
    holder="${3:-}"; files="${4:-}"
    [ -n "$holder" ] && [ -n "$files" ] || { echo "ERROR: acquire <slug> <holder> <files>" >&2; exit 2; }
    need_slug
    mkdir -p "$LOCK_DIR"
    if [ -e "$lockfile" ]; then
      echo "BUSY: $lockfile 已存在 holder=$(field_of "$lockfile" holder) acquiredAt=$(field_of "$lockfile" acquiredAt)"
      exit 3
    fi
    # noclobber 原子创建，防并发双写
    ( set -C
      : > "$lockfile" ) 2>/dev/null || { echo "BUSY: $lockfile 并发竞争中未获锁" >&2; exit 3; }
    {
      echo "holder=$holder"
      echo "acquiredAt=$(date '+%F %T')"
      echo "files=$files"
    } > "$lockfile"
    echo "ACQUIRED: $lockfile holder=$holder"
    ;;

  read)
    need_slug
    [ -f "$lockfile" ] || { echo "NOT_FOUND: $lockfile" >&2; exit 4; }
    age=$(age_minutes "$lockfile")
    ghost=no
    [ "$age" -gt "$TTL_MIN" ] 2>/dev/null && ghost=yes
    echo "lock=$lockfile"
    echo "holder=$(field_of "$lockfile" holder)"
    echo "acquiredAt=$(field_of "$lockfile" acquiredAt)"
    echo "files=$(field_of "$lockfile" files)"
    hb=$(field_of "$lockfile" heartbeat)
    [ -n "$hb" ] && echo "heartbeat=$hb (辅助显示，不参与判定)"
    echo "ageMinutes=$age"
    echo "ttlMinutes=$TTL_MIN"
    echo "ghost_suspect=$ghost"
    ;;

  touch)
    holder="${3:-}"
    [ -n "$holder" ] || { echo "ERROR: touch <slug> <holder>" >&2; exit 2; }
    need_slug
    [ -f "$lockfile" ] || { echo "NOT_FOUND: $lockfile" >&2; exit 4; }
    cur=$(field_of "$lockfile" holder)
    [ "$cur" = "$holder" ] || { echo "DENIED: holder 不符（lock=$cur, 请求=$holder），拒绝续命" >&2; exit 5; }
    touch -c "$lockfile"   # -c：不存在不创建；内容零改动
    echo "TOUCHED: $lockfile holder=$holder ageMinutes=$(age_minutes "$lockfile")"
    ;;

  release)
    holder="${3:-}"
    [ -n "$holder" ] || { echo "ERROR: release <slug> <holder>" >&2; exit 2; }
    need_slug
    [ -f "$lockfile" ] || { echo "NOT_FOUND: $lockfile" >&2; exit 4; }
    cur=$(field_of "$lockfile" holder)
    [ "$cur" = "$holder" ] || { echo "DENIED: holder 不符（lock=$cur, 请求=$holder），拒绝释放" >&2; exit 5; }
    rm -f "$lockfile"
    echo "RELEASED: $lockfile holder=$holder"
    ;;

  list)
    [ -d "$LOCK_DIR" ] || { echo "EMPTY: $LOCK_DIR 不存在"; exit 0; }
    found=0
    for f in "$LOCK_DIR"/*.lock; do
      [ -f "$f" ] || continue
      found=1
      age=$(age_minutes "$f")
      ghost=no
      [ "$age" -gt "$TTL_MIN" ] 2>/dev/null && ghost=yes
      echo "$(basename "$f") | holder=$(field_of "$f" holder) | ageMinutes=$age | ghost_suspect=$ghost"
    done
    # 有锁是正常态，退出码恒 0（防 set -e 调用方把「有锁」误读成工具失败——产出审 P1-1）
    if [ "$found" -eq 0 ]; then echo "EMPTY: $LOCK_DIR 无 .lock 文件"; fi
    exit 0
    ;;

  *)
    echo "用法: sh $0 {acquire <slug> <holder> <files> | read <slug> | touch <slug> <holder> | release <slug> <holder> | list}" >&2
    exit 2
    ;;
esac

#!/bin/sh
# deveco.jsonc 配置闸（L-029 防复发核心件，2026-11-09）
# 背景：task129 R5 凭记忆写 `agents` 根键（deveco schema 只认单数 `agent`），
#       重启 serve 后新进程起不来、deveco code TUI 读同一配置也起不来，全家瘫 30+ 分钟；
#       watchdog 15s 拉活全部无效——它救不了配置级故障。故立本闸：
#   1) 校验 deveco.jsonc（deveco debug config：好配置 exit 0 / 坏配置必 exit 1，已实测）
#   2) 坏则自动从最新有效备份恢复（.bak* 按修改时间新→旧逐个试，最多 12 个；
#      坏文件保留为 .invalid-<时间戳> 取证，绝不静默丢弃）
#   3) 无可恢复备份 → exit 1。调用方据此【拒绝杀活 serve】（restart-serve.sh）
#      或【跳过 serve 启动、其余组件照常】（start-harmony.sh）。
# 用法：sh deploy/config-guard.sh           校验 + 自愈
#       CHECK=1 sh deploy/config-guard.sh   只校验不自愈（改配置后的预检/CI）
# 测试：LITTLEDJ_DEVCFG=<路径> 可覆盖配置位置（仅供沙箱测试，正常勿用）
PATH="/bin:/usr/bin:$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"
CFG="${LITTLEDJ_DEVCFG:-$HOME/.config/deveco/deveco.jsonc}"

log() { echo "[config-guard][$(date '+%F %T')] $*"; }

# deveco 不在 = 无判据，不拦（宁可放行也不能让闸自己变成新的故障源）
command -v deveco >/dev/null 2>&1 || { log "WARN: deveco 不在 PATH，无法校验，放行"; exit 0; }

[ -f "$CFG" ] || { log "OK: 配置不存在（$CFG），deveco 走默认，放行"; exit 0; }

if DEVECO_CONFIG="$CFG" deveco debug config >/dev/null 2>&1; then
  log "OK: $CFG 校验通过"
  exit 0
fi
log "BAD: $CFG 校验失败（deveco debug config exit!=0）"

if [ -n "${CHECK:-}" ]; then
  log "CHECK 模式：不自愈，退出 1"
  exit 1
fi

# 自愈：坏文件先取证保存
BADSAVE="${CFG}.invalid-$(date +%Y%m%d-%H%M%S)"
cp "$CFG" "$BADSAVE" && chmod 600 "$BADSAVE" 2>/dev/null

# 备份按时间新→旧逐个校验（备份文件名均无空格，for + ls 安全；有则首批命中即用）
RESTORED=0
USEDBAK=""
for B in $(ls -t "${CFG}".bak* 2>/dev/null | head -12); do
  [ -f "$B" ] || continue
  if DEVECO_CONFIG="$B" deveco debug config >/dev/null 2>&1; then
    cp "$B" "$CFG" && chmod 600 "$CFG" 2>/dev/null
    RESTORED=1
    USEDBAK="$B"
    break
  fi
  log "skip: 备份 $B 也无效"
done

if [ "$RESTORED" = 1 ]; then
  # 复验落盘后的正式文件（防 cp/chmod 环节意外）
  if DEVECO_CONFIG="$CFG" deveco debug config >/dev/null 2>&1; then
    log "RESTORED: 已自愈，从 $USEDBAK 恢复；坏文件取证在 $BADSAVE"
    exit 0
  fi
  log "FAIL: 恢复后复验仍失败（意外），回滚现场"
fi

# 全失败：放回坏文件保持现场 + 退出 1（调用方保住活 serve）
cp "$BADSAVE" "$CFG" 2>/dev/null
log "FAIL: 无可用有效备份（.bak* 前 12 个全试过），配置保持坏样现场，取证在 $BADSAVE"
exit 1

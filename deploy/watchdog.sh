#!/bin/sh
# littleDJ 崩溃自动拉活守护（watchdog）
# 周期探测 relay(4099)/zhipu-relay(4100)/serve(4098)/proxy(4097)，有缺失就调幂等的 start-harmony.sh 拉活；tls(8443) 只告警不拉活（task353）。
# 不做开机自启：由 start-harmony.sh 顺手带起（也可手动单独运行）。
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
RUN_DIR="$ROOT/run"
PID_FILE="$RUN_DIR/watchdog.pid"
LOG="$ROOT/logs/watchdog.log"
INTERVAL="${LITTLEDJ_WATCHDOG_INTERVAL:-15}"

mkdir -p "$RUN_DIR" "$ROOT/logs" 2>/dev/null

# 单实例：旧 watchdog 存活则本实例直接退出
if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "[watchdog] 已在运行 pid=$(cat "$PID_FILE")，本次不重复启动"
  exit 0
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"; exit 0' TERM INT

# PATH 兜底：历史上从桌面等环境拉起时 node/deveco 不在 PATH（nohup: exec node: No such file or directory）
PATH="$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# T10（巡察使启用）：每 N 跳跑一次只读巡检（默认 60×15s ≈ 15 分钟），LITTLEDJ_NO_PATROL=1 可关；
# 巡检只探不修（patrol.sh 红线），报告落 config/patrol-report.json 供开工三查摘要与大管家问状态用
PATROL_EVERY="${LITTLEDJ_PATROL_EVERY:-60}"
# task306（挂死空轮自动处置）：同一节奏后台跑 autoheal-stuck.js——判定从严（assistant 尾消息
# 0 parts/仅 step-start、无 error、无 completed、创建超 10 分钟）只做 abort，审计落 run/autoheal-log.jsonl；
# LITTLEDJ_NO_AUTOHEAL=1 可关、LITTLEDJ_AUTOHEAL_EVERY=0 同关。relay 侧内容看门狗在 zhipu-relay.js。
AUTOHEAL_EVERY="${LITTLEDJ_AUTOHEAL_EVERY:-60}"
# task309：autoresume 周期续跑（默认 80 跳 ≈ 20 分钟；LITTLEDJ_AUTORESUME_EVERY=0 关、LITTLEDJ_NO_AUTORESUME=1 同关）
# 补「消息进了库但 serve 在途挂死/重启把队列冲掉」的悬空态（2026-11-15 11:35 事故形态）：autoheal 只
# 解封挂死空轮（abort），续跑归 autoresume（双采样+尾消息年龄闸+护栏上限；判定与巡检哨兵共源 server/orphan-detect.js）
AUTORESUME_EVERY="${LITTLEDJ_AUTORESUME_EVERY:-80}"
# task316：半开回合（assistant 未 completed + 后发 user）自动解封；默认 4 跳≈60s 一轮，LITTLEDJ_NO_WEDGE=1 关
WEDGE_EVERY="${LITTLEDJ_WEDGE_EVERY:-4}"
# task378：每周日 09:00 全家清理（event 流水+hdc 老日志+临时目录+日志轮转+缓存）；每小时查一次窗口，
# state 记「上次运行的周日日期」防同周重跑；LITTLEDJ_NO_WEEKLY_CLEANUP=1 可关、手动 sh deploy/weekly-cleanup.sh 随时可跑
WEEKLY_CHECK_EVERY="${LITTLEDJ_WEEKLY_CHECK_EVERY:-240}"
case "$AUTOHEAL_EVERY" in ''|*[!0-9]*|0[0-9]*) AUTOHEAL_EVERY=60 ;; esac
case "$PATROL_EVERY" in ''|*[!0-9]*|0[0-9]*) PATROL_EVERY=60 ;; esac
case "$AUTORESUME_EVERY" in ''|*[!0-9]*|0[0-9]*) AUTORESUME_EVERY=80 ;; esac
case "$WEDGE_EVERY" in ''|*[!0-9]*|0[0-9]*) WEDGE_EVERY=4 ;; esac
case "$WEEKLY_CHECK_EVERY" in ''|*[!0-9]*|0[0-9]*) WEEKLY_CHECK_EVERY=240 ;; esac
_tick=0
# task378：周日 09:00 后的任一小时检触发一次（state 先写后跑，防 nohup 起慢重复触发；错过整个周日=下周再跑）
run_weekly_cleanup() {
  [ -z "$LITTLEDJ_NO_WEEKLY_CLEANUP" ] || return 0
  [ -f "$REPO/deploy/weekly-cleanup.sh" ] || return 0
  [ "$(date +%u)" = "7" ] || return 0
  [ "$(date +%H)" -ge 9 ] 2>/dev/null || return 0
  _key=$(date +%F)
  _last=""
  [ -f "$RUN_DIR/weekly-cleanup.state" ] && _last=$(cat "$RUN_DIR/weekly-cleanup.state" 2>/dev/null)
  [ "$_last" = "$_key" ] && return 0
  echo "$_key" > "$RUN_DIR/weekly-cleanup.state"
  log "[watchdog] 周日清理窗口触发 weekly-cleanup（anchor=$_key）"
  LITTLEDJ_ROOT="$ROOT" nohup sh "$REPO/deploy/weekly-cleanup.sh" >> "$ROOT/logs/weekly-cleanup.log" 2>&1 &
}
run_patrol() {
  [ "$PATROL_EVERY" -gt 0 ] || return 0
  [ -x "$REPO/deploy/patrol.sh" ] || return 0
  [ -f "$ROOT/config/auth.txt" ] || return 0
  LITTLEDJ_ROOT="$ROOT" sh "$REPO/deploy/patrol.sh" --quiet >> "$ROOT/logs/patrol.log" 2>&1 &
}
run_autoheal() {
  [ "$AUTOHEAL_EVERY" -gt 0 ] || return 0
  [ -f "$REPO/server/autoheal-stuck.js" ] || return 0
  [ -f "$ROOT/config/auth.txt" ] || return 0
  [ -n "$LITTLEDJ_NO_AUTOHEAL" ] && return 0
  LITTLEDJ_ROOT="$ROOT" node "$REPO/server/autoheal-stuck.js" >> "$ROOT/logs/autoheal.log" 2>&1 &
}
# task309：悬空回复周期续跑（autoresume 自带单实例锁/双采样/年龄闸/护栏上限，幂等可重叠调度）
run_autoresume() {
  [ "$AUTORESUME_EVERY" -gt 0 ] || return 0
  [ -f "$REPO/server/autoresume.js" ] || return 0
  [ -n "$LITTLEDJ_NO_AUTORESUME" ] && return 0
  LITTLEDJ_ROOT="$ROOT" nohup node "$REPO/server/autoresume.js" --reason periodic >> "$ROOT/logs/autoresume.log" 2>&1 &
}
# task316：卡死半开回合自动解封（detect→abort+重放→必要时 serve 重启；自带单实例锁/冷却/全局安静窗）
run_wedge() {
  [ "$WEDGE_EVERY" -gt 0 ] || return 0
  [ -f "$REPO/server/wedge-heal.js" ] || return 0
  [ -f "$ROOT/config/auth.txt" ] || return 0
  [ -n "$LITTLEDJ_NO_WEDGE" ] && return 0
  LITTLEDJ_ROOT="$ROOT" nohup node "$REPO/server/wedge-heal.js" >/dev/null 2>&1 &
}

log "[watchdog] 启动 pid=$$ 探测间隔=${INTERVAL}s 巡检每${PATROL_EVERY}跳 自愈每${AUTOHEAL_EVERY}跳 续跑每${AUTORESUME_EVERY}跳 卡死自愈每${WEDGE_EVERY}跳"
echo "[watchdog] 崩溃守护已启动 pid=$$ 间隔=${INTERVAL}s 日志=$LOG"

probe_once() {
  curl -sf -m 8 "http://127.0.0.1:${DS_RELAY_PORT:-4099}/health" >/dev/null 2>&1 || { log "[watchdog] 探测失败项: relay(4099)"; return 1; }
  curl -sf -m 8 "http://127.0.0.1:${ZP_RELAY_PORT:-4100}/health" >/dev/null 2>&1 || { log "[watchdog] 探测失败项: zhipu-relay(4100)"; return 1; }
  # 2026-11-12：serve 的 /health 已不可靠（未知路径被 web 层反代到 opencode.ai，返回 200 HTML 且 1-4.5s），
  # 改探 /api/session（实测 73ms 稳定 JSON）；否则 -m 8 间歇超时 → 连环拉活风暴
  curl -sf -m 8 "http://127.0.0.1:${LITTLEDJ_BACKEND_PORT:-4098}/api/session" >/dev/null 2>&1 || { log "[watchdog] 探测失败项: serve(4098)"; return 1; }
  AUTH="$(cat "$ROOT/config/auth.txt" 2>/dev/null)"
  curl -sf -m 8 -u "$AUTH" "http://127.0.0.1:${LITTLEDJ_PORT:-4097}/_health" >/dev/null 2>&1 || { log "[watchdog] 探测失败项: proxy(4097)"; return 1; }
  # task353：内网 https(8443) 只告警不拉活——proxy 单进程双端口，proxy 死时 4097 探测已兜底拉活；
  # 8443 单独挂多为端口被占，拉活救不了反而风暴；证书不存在=未启用不计
  if [ -f "$ROOT/config/tls/cert.pem" ]; then
    curl -sfk -m 8 -u "$AUTH" "https://127.0.0.1:${LITTLEDJ_TLS_PORT:-8443}/_health" >/dev/null 2>&1 || log "[watchdog] WARN: tls(${LITTLEDJ_TLS_PORT:-8443}) 探测失败（4097 正常则多为端口被占）"
  fi
  # 外网隧道（T12·SSH -R）：探测特征进程；密钥缺失=未部署，不计入失败
  # 2026-11-12：隧道失败改为只告警不拉活——远端端口被僵死连接占用（remote port forwarding failed）时，
  # 本机拉活动作（重跑 start-tunnel）救不了，只会叠并发守护循环制造连环拉活风暴；tunnel 自带重连循环自愈
  [ -f "$HOME/.ssh/dagai_ecs_key" ] && { pgrep -f "ssh .*-R ${LITTLEDJ_TUNNEL_PORT:-18097}:" >/dev/null 2>&1 || log "[watchdog] WARN: 外网隧道进程不在（start-tunnel 自带重连；持续失败需人工查远端端口占用）"; }
  return 0
}

# task381：拉活循环保护——时间窗内拉活次数超限=疑似崩溃循环（proxy 起来就崩的连环拉活风暴），停拉+告警；
# 恢复=人工排障后删 $RUN_DIR/watchdog-revive.state（或等窗口自然过期）；阈值/窗口 env 可调。
REVIVE_MAX="${LITTLEDJ_WATCHDOG_MAX_REVIVE:-3}"
REVIVE_WINDOW="${LITTLEDJ_WATCHDOG_REVIVE_WINDOW:-1800}"
REVIVE_STATE="$RUN_DIR/watchdog-revive.state"
revive_tick() {
  _now=$(date +%s); _win=0; _cnt=0
  if [ -f "$REVIVE_STATE" ]; then
    _win=$(cut -d' ' -f1 "$REVIVE_STATE" 2>/dev/null)
    _cnt=$(cut -d' ' -f2 "$REVIVE_STATE" 2>/dev/null)
  fi
  case "$_win" in ''|*[!0-9]*) _win=0;; esac
  case "$_cnt" in ''|*[!0-9]*) _cnt=0;; esac
  if [ $((_now - _win)) -ge "$REVIVE_WINDOW" ]; then _win=$_now; _cnt=0; fi
  _cnt=$((_cnt + 1))
  echo "$_win $_cnt" > "$REVIVE_STATE"
  if [ "$_cnt" -gt "$REVIVE_MAX" ]; then
    log "[watchdog] 疑似崩溃循环：${REVIVE_WINDOW}s 窗口内第 ${_cnt} 次拉活，本跳停拉（恢复=删 $REVIVE_STATE；env 可调 LITTLEDJ_WATCHDOG_MAX_REVIVE/LITTLEDJ_WATCHDOG_REVIVE_WINDOW）"
    return 1
  fi
  return 0
}

while :; do
  sleep "$INTERVAL"
  _tick=$((_tick + 1))
  [ $((_tick % PATROL_EVERY)) -eq 0 ] && run_patrol
  [ "$AUTOHEAL_EVERY" -gt 0 ] && [ $((_tick % AUTOHEAL_EVERY)) -eq 0 ] && run_autoheal
  [ "$AUTORESUME_EVERY" -gt 0 ] && [ $((_tick % AUTORESUME_EVERY)) -eq 0 ] && run_autoresume
  [ "$WEDGE_EVERY" -gt 0 ] && [ $((_tick % WEDGE_EVERY)) -eq 0 ] && run_wedge
  [ "$WEEKLY_CHECK_EVERY" -gt 0 ] && [ $((_tick % WEEKLY_CHECK_EVERY)) -eq 0 ] && run_weekly_cleanup
  # task301 断网→回网探测：回网后自动续跑被中断会话（autoresume 自带幂等/双采样；flag 掉线即清）
  _nc="$(curl -s -o /dev/null -m 6 -w '%{http_code}' https://open.bigmodel.cn 2>/dev/null)"
  if [ -n "$_nc" ] && [ "$_nc" != "000" ]; then
    if [ ! -f "$RUN_DIR/net-up.flag" ]; then
      echo 1 > "$RUN_DIR/net-up.flag"
      log "[watchdog] 网络恢复(http=$_nc)，触发 autoresume(netback)"
      LITTLEDJ_ROOT="$ROOT" nohup node "$REPO/server/autoresume.js" --reason netback >> "$ROOT/logs/autoresume.log" 2>&1 &
    fi
  else
    rm -f "$RUN_DIR/net-up.flag" 2>/dev/null
  fi
  probe_once && continue
  # 单次超时可能只是后端忙：隔 5 秒再确认一次，仍失败才拉活
  sleep 5
  probe_once && continue
  log "[watchdog] 连续两次探测失败，执行 start-harmony.sh 拉活"
  if revive_tick; then
    LITTLEDJ_NO_WATCHDOG=1 LITTLEDJ_NO_OPEN=1 sh "$REPO/deploy/start-harmony.sh" >> "$LOG" 2>&1
    log "[watchdog] 拉活动作完成"
  fi
done

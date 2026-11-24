#!/bin/sh
# 重启 UI proxy(4097)——加载 server/proxy.js 新代码；serve/relay/watchdog 不动
# 场景：proxy 路由/广播通道等改动需重启才生效（watchdog 只拉活不更新代码）
# 用法：sh deploy/restart-proxy.sh
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
PORT="${LITTLEDJ_PORT:-4097}"
BACKEND_PORT="${LITTLEDJ_BACKEND_PORT:-4098}"
LOG="$ROOT/logs/proxy-restart.log"

# PATH 兜底（★2026-11-08 桌面双击场景）：桌面双击的 PATH 不含 node/deveco，
# 与 start-harmony.sh 的兜底保持同一组路径（v0.079.1 教训：目标环境验证必须复刻）。
PATH="/bin:/usr/bin:$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"
export PATH

ts() { date '+%F %T'; }
mkdir -p "$ROOT/logs"
echo "[$(ts)] === proxy restart begin ===" >> "$LOG"

# 1) 杀现有 proxy（cmdline 含 server/proxy.js 的 node 进程；杀完清残留）
# ⚠2026-11-08 自伤修复：只认 ps 第 8 列（可执行文件）=node，否则「命令行里含 server/proxy.js 的任意进程」
# （如 node --check server/proxy.js、编辑器、grep）会被一起杀掉
PIDS=$(ps -ef | grep -F "server/proxy.js" | grep -v grep | awk '$8 == "node" {print $2}')
if [ -z "$PIDS" ]; then
  # ★2026-11-08 跨沙箱域分支：proxy 不在本 PID 命名空间（典型=由其它域的 watchdog 拉起，如 AI 会话域）
  # 且端口健康 → 请网关自我退出换血（POST /_proxy/restart），watchdog 15~30s 内拉活。
  PROXY_PORT="${LITTLEDJ_PORT:-4097}"
  if curl -sf -m 3 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$PROXY_PORT/_health" >/dev/null 2>&1; then
    echo "[$(ts)] proxy 不可见但端口健康 → 经网关自我重启通道换血" >> "$LOG"
    OLD=$(curl -s -m 5 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$PROXY_PORT/_procs" | sed -n 's/.*"me":\([0-9][0-9]*\).*/\1/p')
    echo "[$(ts)] 跨域换血前 gw pid=$OLD" >> "$LOG"
    R=$(curl -s -m 10 -u "$(cat "$ROOT/config/auth.txt")" -X POST "http://127.0.0.1:$PROXY_PORT/_proxy/restart")
    echo "[$(ts)] 自我重启应答: $R" >> "$LOG"
    i=0
    NEW=""
    while [ $i -lt 45 ]; do
      sleep 2
      NEW=$(curl -s -m 3 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$PROXY_PORT/_procs" 2>/dev/null | sed -n 's/.*"me":\([0-9][0-9]*\).*/\1/p')
      [ -n "$NEW" ] && [ "$NEW" != "$OLD" ] && break
      i=$((i+1))
    done
    if [ -n "$NEW" ] && [ "$NEW" != "$OLD" ]; then
      echo "✅ proxy 跨域换血成功（新网关 pid=$NEW，旧 pid=$OLD）"
      echo "[$(ts)] proxy up (cross-domain), new pid=$NEW old=$OLD" >> "$LOG"
      # 金丝雀：/_procs 是新版本特征端点
      C=$(curl -s -m 5 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$PROXY_PORT/_procs")
      echo "$C" | grep -q '"ok":true' && echo "[$(ts)] 金丝雀 /_procs OK" >> "$LOG" || echo "[$(ts)] WARN: /_procs 异常: $C" >> "$LOG"
      echo "[$(ts)] === proxy restart done (cross-domain) ===" >> "$LOG"
      exit 0
    fi
    echo "[$(ts)] !!! 跨域换血失败：90s 内未见新网关（watchdog 未拉活？）" >> "$LOG"
    echo "❌ proxy 跨域换血失败：90s 内网关未恢复。请双击桌面「启动小DJ.sh」拉起。"
    exit 1
  fi
fi
[ -n "$PIDS" ] && echo "[$(ts)] killing proxy pids: $PIDS" >> "$LOG"
for p in $PIDS; do kill $p 2>/dev/null; done

# 2) 等端口释放（最多 10s），超时强杀
i=0
while curl -sf -m 1 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$PORT/_health" >/dev/null 2>&1; do
  i=$((i+1))
  if [ $i -ge 10 ]; then kill -9 $PIDS 2>/dev/null; sleep 1; break; fi
  sleep 1
done
sleep 1

# 3) 幂等拉活（start-harmony.sh 内部有端口/健康双重防重）
sh "$REPO/deploy/start-harmony.sh" >> "$LOG" 2>&1

# 4) 验证新端点已上线（POST /_tui/bell 应答 200 {ok:true}；404=没加载新代码）
#    ★task46 补 /_voice/voices 金丝雀：旧代码探针 /_tui/bell 分不刷新旧（v0.089 老路由），
#    /_voice 是 v0.092 新增路由，404 即新代码未生效（典型原因：AI 会话 PID 命名空间外杀不动旧进程）
sleep 1
R=$(curl -s -m 3 -u "$(cat "$ROOT/config/auth.txt")" -H 'content-type: application/json' \
  -d '{"kind":"done"}' "http://127.0.0.1:$PORT/_tui/bell")
if echo "$R" | grep -q '"ok":true'; then
  echo "[$(ts)] proxy up, /_tui/bell 已生效 ($R)" >> "$LOG"
  echo "proxy 重启完成，/_tui/bell 已生效（$R）"
else
  echo "[$(ts)] WARN: proxy up but /_tui/bell 异常: $R" >> "$LOG"
  echo "WARN：proxy 已起但 /_tui/bell 异常（$R），详见 $LOG"
fi
V=$(curl -s -m 3 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$PORT/_voice/voices")
if echo "$V" | grep -q '"ok":true'; then
  echo "[$(ts)] /_voice/voices 金丝雀 OK：v0.092+ 语音路由已生效" >> "$LOG"
  echo "语音路由（v0.092+）已生效"
else
  echo "[$(ts)] WARN: /_voice/voices 404/异常: $V —— 跑的还是旧代码（旧进程没被杀掉，AI 会话沙箱外进程 kill 不到时会出现）" >> "$LOG"
  echo "WARN：语音路由未生效（仍是旧代码）——旧 proxy 进程可能没杀掉；请在非 AI 沙箱终端重跑本脚本，或重启机器后双击桌面「启动小DJ.sh」"
fi
echo "[$(ts)] === proxy restart done ===" >> "$LOG"

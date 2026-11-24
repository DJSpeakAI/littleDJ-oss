#!/bin/sh
# littleDJ 本机启动（鸿蒙 PC）：deveco serve(4098) + UI proxy(4097)
# 幂等：端口已在监听则跳过
set -e
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
PORT="${LITTLEDJ_PORT:-4097}"
BACKEND_PORT="${LITTLEDJ_BACKEND_PORT:-4098}"
RELAY_PORT="${DS_RELAY_PORT:-4099}"
ZP_RELAY_PORT="${ZP_RELAY_PORT:-4100}"

# PATH 兜底：从桌面等环境拉起时 node/deveco 可能不在 PATH
PATH="/bin:/usr/bin:$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

# setsid 兜底：桌面 zsh 的 PATH 里可能没有 /bin，会报 "setsid: not found" 导致全家静默拉不起来
# （2026-11-05 二次事故）；找不到就退化为普通 nohup，至少服务能起
SETSID="$(command -v setsid 2>/dev/null || true)"
if [ -z "$SETSID" ]; then
  for c in /bin/setsid /usr/bin/setsid /system/bin/setsid; do
    [ -x "$c" ] && { SETSID="$c"; break; }
  done
fi

# task400（第 1 轮方案审 P1-7）：运行根里没有凭据就拒启——永不自建空根、永不写默认口令
lj_require_root || { echo "!!! 运行根缺 config/auth.txt：$ROOT——拒绝启动（从备份恢复，或用 LITTLEDJ_ROOT 指定）" >&2; exit 2; }
mkdir -p "$ROOT/projects" "$ROOT/logs"

# 端口快速探测（800ms 超时）：进程活着但响应慢时，绝不再拉起第二个实例把自己顶掉
port_open() {
  node -e "const n=require('net');const s=n.connect($1,'127.0.0.1');const t=setTimeout(function(){s.destroy();process.exit(1)},800);s.on('connect',function(){clearTimeout(t);s.destroy();process.exit(0)});s.on('error',function(){clearTimeout(t);process.exit(1)})" >/dev/null 2>&1
}

# 本机 DeepSeek 中转（绕过 serve 内核 brotli 流式解压 bug，详见 docs/2026-11-04 DeepSeek流式修复）
if ! curl -sf -m 2 "http://127.0.0.1:$RELAY_PORT/health" >/dev/null 2>&1; then
  # setsid 脱离会话/进程组/控制终端：防「谁会话里拉起就随谁陪葬」（2026-11-05 连坐回收事故）
  ${SETSID:+$SETSID }nohup node "$REPO/server/deepseek-relay.js" >> "$ROOT/logs/relay.log" 2>&1 < /dev/null &
  ok=0; i=0
  while [ $i -lt 5 ]; do
    sleep 1
    if curl -sf -m 2 "http://127.0.0.1:$RELAY_PORT/health" >/dev/null 2>&1; then ok=1; break; fi
    i=$((i+1))
  done
  [ $ok -eq 1 ] || echo "WARN: relay($RELAY_PORT) 未就绪，DeepSeek 将不可用，详见 $ROOT/logs/relay.log"
fi

# 本机智谱 Token Plan 中转（同源问题：压缩流式响应解压丢字节）
if ! curl -sf -m 2 "http://127.0.0.1:$ZP_RELAY_PORT/health" >/dev/null 2>&1; then
  ${SETSID:+$SETSID }nohup node "$REPO/server/zhipu-relay.js" >> "$ROOT/logs/zhipu-relay.log" 2>&1 < /dev/null &
  ok=0; i=0
  while [ $i -lt 5 ]; do
    sleep 1
    if curl -sf -m 2 "http://127.0.0.1:$ZP_RELAY_PORT/health" >/dev/null 2>&1; then ok=1; break; fi
    i=$((i+1))
  done
  [ $ok -eq 1 ] || echo "WARN: zhipu relay($ZP_RELAY_PORT) 未就绪，智谱 Token Plan 将不可用，详见 $ROOT/logs/zhipu-relay.log"
fi

# 让 deepseek / zhipu 走 relay（用户配置，不依赖会被回写的 models.json 缓存；task228：OpenAI 段已退役撤除）
DS_RELAY_URL="http://127.0.0.1:$RELAY_PORT" ZP_RELAY_URL="http://127.0.0.1:$ZP_RELAY_PORT/api/coding/paas/v4" node "$REPO/server/ensure-deepseek-relay.js" || echo "WARN: relay 配置写入失败"

# 配置闸（L-029，2026-11-09 全瘫事故防复发）：deveco.jsonc 坏 = serve 必起不来，
# 冷启动场景闸不过就跳过 serve 启动（proxy/隧道/watchdog 照常），配置修好后 watchdog 下一跳自动拉活
CFG_OK=1
if ! sh "$REPO/deploy/config-guard.sh" >> "$ROOT/logs/config-guard.log" 2>&1; then
  CFG_OK=0
  echo "!!! deveco.jsonc 无效且自愈失败，本次跳过 serve 启动（详见 $ROOT/logs/config-guard.log）"
fi

# 2026-11-12：serve 的 /health 已不可靠（web 层把未知路径反代到 opencode.ai，200 HTML + 1-4.5s），
# 探测改用 /api/session（实测 73ms 稳定 JSON）；否则 -m 2 永远超时 → serve 假死时永远「跳过重复启动」拉不活
if [ "$CFG_OK" = "1" ] && ! curl -sf -m 2 "http://127.0.0.1:$BACKEND_PORT/api/session" >/dev/null 2>&1; then
  # 健康检查超时可能只是后端忙：端口仍在监听就不重复拉起（否则会刷 EADDRINUSE/ServeError）
  if port_open "$BACKEND_PORT"; then
    echo "INFO: serve($BACKEND_PORT) 端口在监听但 /api/session 探测超时，跳过重复启动"
  else
    ${SETSID:+$SETSID }nohup deveco serve --port "$BACKEND_PORT" --hostname 127.0.0.1 >> "$ROOT/logs/serve.log" 2>&1 < /dev/null &
    sleep 4
  fi
fi

# task301 自动续跑：serve 就绪后恢复中断会话（脚本自带锁/双采样/防循环，无事则秒退；独立后台跑不阻塞启动）
if [ "$CFG_OK" = "1" ]; then
  ${SETSID:+$SETSID }nohup node "$REPO/server/autoresume.js" --reason restart >> "$ROOT/logs/autoresume.log" 2>&1 < /dev/null &
fi

if ! curl -sf -m 2 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$PORT/_health" >/dev/null 2>&1; then
  if port_open "$PORT"; then
    echo "INFO: proxy($PORT) 端口在监听但 /_health 超时，跳过重复启动"
  else
    cd "$REPO"
    LITTLEDJ_ROOT="$ROOT" LITTLEDJ_BACKEND_PORT="$BACKEND_PORT" LITTLEDJ_HOST=0.0.0.0 \
      ${SETSID:+$SETSID }nohup node server/proxy.js >> "$ROOT/logs/proxy.log" 2>&1 < /dev/null &
    sleep 1
  fi
fi

# 外网隧道（T12·SSH 反向隧道，2026-11-06）：start-tunnel.sh 内部幂等+断线重连；
# setsid 常驻同上教训——禁止 AI 会话内直启，仅经本脚本（桌面双击链路）或 watchdog 拉活
${SETSID:+$SETSID }nohup sh "$REPO/deploy/tunnel/start-tunnel.sh" >> "$ROOT/logs/tunnel.log" 2>&1 < /dev/null &

# 崩溃自动拉活守护（幂等：watchdog.sh 内部有单实例 pid 保护；LITTLEDJ_NO_WATCHDOG=1 可跳过）
# setsid 是关键：watchdog 必须脱离会话存活，否则拉起它的会话一结束全家连坐回收（2026-11-05 事故根因）
if [ -z "${LITTLEDJ_NO_WATCHDOG:-}" ]; then
  ${SETSID:+$SETSID }nohup sh "$REPO/deploy/watchdog.sh" >> "$ROOT/logs/watchdog.log" 2>&1 < /dev/null &
fi

IP=$(ifconfig wlan0 2>/dev/null | sed -n 's/.*inet addr:\([0-9.]*\).*/\1/p' | head -1)
[ -z "$IP" ] && IP="<鸿蒙PC局域网IP>"
echo "littleDJ 已就绪"
echo "  电脑用（麦克风可用）: http://localhost:$PORT"
echo "  手机/平板用（内网）  : http://$IP:$PORT   (账号见 $ROOT/config/auth.txt)"
echo "  手机外网（麦克风可用）: https://dj.example.com"

# task373 双击即见面：服务就绪后自动用默认浏览器打开小DJ（aa 隐式 Want，失败静默不影响启动）。
# 场景：主人双击本脚本 = 要用小DJ，不该再手动开浏览器点书签（2026-11-17 旧书签 https 升级踩坑）。
# 自动化场景（watchdog 拉活等）带 LITTLEDJ_NO_OPEN=1 跳过，免打扰。
if [ -z "${LITTLEDJ_NO_OPEN:-}" ] && command -v aa >/dev/null 2>&1; then
  if aa start -U "http://localhost:$PORT" >/dev/null 2>&1; then
    echo "  ↗ 已在默认浏览器打开小DJ"
  else
    echo "  （自动打开浏览器未成功，请手动访问上方任一地址）"
  fi
fi

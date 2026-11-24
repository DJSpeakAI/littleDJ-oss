#!/bin/sh
# 重启 deveco serve(4098)——只动 serve，不动 proxy；relay 缺失时顺手幂等拉起
# 场景：models 缓存里 deepseek.api 换中转地址等改动，需重启 serve 才生效
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
BACKEND_PORT="${LITTLEDJ_BACKEND_PORT:-4098}"
RELAY_PORT="${DS_RELAY_PORT:-4099}"
ZP_RELAY_PORT="${ZP_RELAY_PORT:-4100}"
LOG="$ROOT/logs/serve-restart.log"

# PATH 兜底（★2026-11-08 桌面双击失败根因，v0.079.1 同款教训重演）：
# 桌面双击（文件管理器→HiShell 交互 zsh）的 PATH 不含 node/deveco，
# 实锤 `node: inaccessible or not found` + `nohup: exec deveco: No such file or directory`
# → relay 配置写失败(WARN) + serve 拉不起来 → 端口被旧实例占着 ABORT exit=1。
# 与 start-harmony.sh 的兜底保持同一组路径。
PATH="/bin:/usr/bin:$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"
export PATH

ts() { date '+%F %T'; }

# task255：serve 恢复后唤醒大管家执行重启恢复协议（检查在途断点→续做→报信主人）。
# 唤醒=固定格式程序消息（非主人语义）；判断与续做全由 AI 做，代码只保证「必然有人被叫醒」。
# WAKE_SID 为空（快照失败）时跳过，绝不阻塞重启本身。
wakeButler() {
  if [ -z "$WAKE_SID" ]; then
    echo "[$(ts)] wake skipped: no WAKE_SID (snapshot empty)" >> "$LOG"
    return 0
  fi
  WAKE_MSG="【serve-restart-done · 程序消息（restart-serve.sh 自动发送，非主人指令）】serve 已重启完成。请立即执行重启恢复协议：①按下方快照逐个核对重启前在途任务的断点（读会话最后内容，判断做到哪）；②该续做的逐个发带断点上下文的续做指令（串行推进，勿并发打爆）；③已答完/正在等主人确认的只标状态、绝不乱推；④完成后第一时间向主人报信（重启结果+续做清单）。重启前活跃快照：${WAKE_SNAP#*|}"
  WAKE_JSON=$(node -e "console.log(JSON.stringify(process.argv[1]))" "$WAKE_MSG" 2>/dev/null)
  if [ -z "$WAKE_JSON" ]; then
    echo "[$(ts)] wake skipped: JSON escape failed" >> "$LOG"
    return 0
  fi
  R=$(curl -s -m 15 -u "$(cat "$ROOT/config/auth.txt")" -H 'Content-Type: application/json' \
    -X POST "http://127.0.0.1:${LITTLEDJ_PORT:-4097}/api/session/$WAKE_SID/prompt_async" \
    -d "{\"parts\":[{\"type\":\"text\",\"text\":$WAKE_JSON}]}")
  echo "[$(ts)] wake butler -> $WAKE_SID : $R" >> "$LOG"
}

mkdir -p "$ROOT/logs"
echo "[$(ts)] === serve restart begin ===" >> "$LOG"

# 0) relay 幂等拉起（deepseek / zhipu 流量走它）
if ! curl -sf -m 2 "http://127.0.0.1:$RELAY_PORT/health" >/dev/null 2>&1; then
  nohup node "$REPO/server/deepseek-relay.js" >> "$ROOT/logs/relay.log" 2>&1 &
  sleep 1
fi
if ! curl -sf -m 2 "http://127.0.0.1:$ZP_RELAY_PORT/health" >/dev/null 2>&1; then
  nohup node "$REPO/server/zhipu-relay.js" >> "$ROOT/logs/zhipu-relay.log" 2>&1 &
  sleep 1
fi

# 0.5) 确保用户配置里 deepseek / zhipu 走 relay（models.json 缓存会被 serve 回写，改缓存不可靠）
DS_RELAY_URL="http://127.0.0.1:$RELAY_PORT" ZP_RELAY_URL="http://127.0.0.1:$ZP_RELAY_PORT/api/coding/paas/v4" node "$REPO/server/ensure-deepseek-relay.js" || echo "WARN: relay 配置写入失败"

# 0.6) 配置闸（L-029，2026-11-09 全瘫事故防复发）：deveco.jsonc 坏 = serve 必起不来。
#      先校验（坏则自动从有效备份自愈）；闸不过 = 绝不杀活 serve 陪葬，直接拒绝重启。
if ! sh "$REPO/deploy/config-guard.sh" >> "$LOG" 2>&1; then
  echo "[$(ts)] !!! config-guard 拦截：deveco.jsonc 无效且无备份可自愈，拒绝重启（保住现有 serve）" >> "$LOG"
  echo "❌ deveco.jsonc 校验失败且自愈失败，已拒绝重启（活 serve 保住）。请人工修复配置；坏文件取证见 .invalid-* ，改完跑 CHECK=1 sh deploy/config-guard.sh 预检"
  exit 1
fi

# 0.7) task255 重启前快照：抓最近活跃的大管家会话（serve 死后查不到，必须在杀之前拿）
WAKE_SID=""
WAKE_SNAP=""
if command -v node >/dev/null 2>&1; then
  WAKE_SNAP=$(curl -sf -m 5 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:${LITTLEDJ_PORT:-4097}/_tasks" 2>/dev/null | node -e "
let raw='';process.stdin.on('data',c=>raw+=c).on('end',()=>{
  try{const d=JSON.parse(raw);const items=Array.isArray(d)?d:(d.tasks||[]);
    const now=Date.now();
    // task375 修复：不再依赖 state==='running'（task180 auto-done 会把「工具长任务静默5min」的在途主会话
    // 误标 done——2026-11-18 重启实测：真正在途的大管家被跳过、唤醒发给了 state 卡 running 的陈年会话）。
    // 改判据：freshness=max(lastEventAt, rootTu)（rootTu=根会话自身更新——派过子代理的主会话 lastEventAt
    // 停在子代理完成时刻，主会话自己干活只刷 rootTu；stale 分档也是 lastEventAt 口径，不能当筛选条件）。
    // 二审 P1-3：手工 hold 态仍排除（waiting/queued/interrupted——等待中会话不许被叫醒）；done/running 放行
    //（auto-done 误标由 rootTu 活跃度兜底；窗口由旧 6h 收紧为 2h）。
    const live=items.filter(t=>t&&String(t.directory||'').indexOf('littleDJ')>=0
      &&t.state!=='waiting'&&t.state!=='queued'&&t.state!=='interrupted')
      .map(t=>({t:t,f:Math.max(Number(t.lastEventAt)||0,Number(t.rootTu)||0)}))
      .filter(x=>now-x.f<2*3600*1000)
      .sort((a,b)=>b.f-a.f).slice(0,5);
    if(live.length){console.log(live[0].t.id+'|'+live.map(x=>x.t.id.slice(-8)+' '+String(x.t.title).slice(0,20)).join('; '))}
  }catch(e){}
})" 2>/dev/null)
  WAKE_SID=$(echo "$WAKE_SNAP" | cut -d'|' -f1)
fi
echo "[$(ts)] wake snapshot: sid=$WAKE_SID snap=${WAKE_SNAP#*|}" >> "$LOG"

# 1) 杀现有 serve（含子进程）
# cmdline 兼容两种形式：`deveco serve --port N` 与 `node …/cli.js serve --port N`（v0.087.4 修假成功 bug）
PIDS=$(ps -ef | grep "serve --port $BACKEND_PORT" | grep -v grep | grep -v restart-serve | awk '$8 == "node" || $8 == "deveco" {print $2}')
if [ -n "$PIDS" ]; then
  echo "[$(ts)] killing serve pids: $PIDS" >> "$LOG"
else
  echo "[$(ts)] WARN: no serve process visible by ps (ghost sandbox? verifying port next)" >> "$LOG"
  # ★2026-11-08 跨沙箱域分支：serve 不在本 PID 命名空间（典型=由其它域的 watchdog 拉起，如 AI 会话域，
  # 本域 kill 结构上不可能成功）且端口健康 → 交给与 serve 同域运行的网关代劳（POST /_serve/restart）。
  PROXY_PORT="${LITTLEDJ_PORT:-4097}"
  if curl -sf -m 3 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then
    echo "[$(ts)] serve 不可见但端口健康 → 经网关跨域重启（$PROXY_PORT/_serve/restart）" >> "$LOG"
    R=$(curl -s -m 100 -u "$(cat "$ROOT/config/auth.txt")" -X POST "http://127.0.0.1:$PROXY_PORT/_serve/restart")
    echo "[$(ts)] 跨域重启应答: $R" >> "$LOG"
    if echo "$R" | grep -q '"ok":true'; then
      echo "✅ serve 跨域重启成功（经网关代劳，旧实例已换新）"
      sleep 2
      P=$(curl -sf -m 5 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$BACKEND_PORT/config/providers" 2>/dev/null)
      echo "$P" | grep -q "http://127.0.0.1:$RELAY_PORT" && echo "[$(ts)] serve up, deepseek -> 127.0.0.1:$RELAY_PORT (via relay)" >> "$LOG" || echo "[$(ts)] WARN: serve up but deepseek NOT via relay (models.json cache overwritten?)" >> "$LOG"
      echo "$P" | grep -q "http://127.0.0.1:$ZP_RELAY_PORT" && echo "[$(ts)] serve up, zhipu -> 127.0.0.1:$ZP_RELAY_PORT (via relay)" >> "$LOG" || echo "[$(ts)] WARN: serve up but zhipu NOT via relay (models.json cache overwritten?)" >> "$LOG"
      echo "[$(ts)] === serve restart done (cross-domain) ===" >> "$LOG"
      wakeButler
      exit 0
    fi
    echo "[$(ts)] !!! 跨域重启失败: $R" >> "$LOG"
    echo "❌ serve 跨域重启失败：$R"
    exit 1
  fi
fi
for p in $PIDS; do
  kill $(ps -ef | awk -v pp=$p '$3==pp{print $2}') $p 2>/dev/null
done

# 2) 等端口释放（最多 15s），超时强杀
i=0
while curl -sf -m 1 "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; do
  i=$((i+1))
  if [ $i -ge 15 ]; then
    kill -9 $PIDS 2>/dev/null
    sleep 1
    break
  fi
  sleep 1
done
sleep 2

# 2.5) 端口仍被占用 = 旧 serve 未死（杀不到/幽灵沙箱），FAIL 退出，绝不带着旧实例假成功
if curl -sf -m 1 "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then
  echo "[$(ts)] !!! port $BACKEND_PORT still occupied after kill: old serve alive (ghost sandbox), ABORT" >> "$LOG"
  exit 1
fi

# 3) 拉起 serve（最多重试 3 次）
ok=0
try=1
while [ $try -le 3 ]; do
  nohup deveco serve --port "$BACKEND_PORT" --hostname 127.0.0.1 >> "$ROOT/logs/serve.log" 2>&1 &
  j=0
  while [ $j -lt 20 ]; do
    sleep 3
    if curl -sf -m 2 "http://127.0.0.1:$BACKEND_PORT/health" >/dev/null 2>&1; then ok=1; break; fi
    j=$((j+1))
  done
  [ $ok -eq 1 ] && break
  echo "[$(ts)] serve start try $try failed" >> "$LOG"
  try=$((try+1))
done

if [ $ok -ne 1 ]; then
  echo "[$(ts)] !!! serve restart FAILED, fallback: sh $REPO/deploy/start-harmony.sh" >> "$LOG"
  exit 1
fi

# 4) 验证 deepseek / zhipu 是否走本机中转
sleep 2
P=$(curl -sf -m 5 -u "$(cat "$ROOT/config/auth.txt")" "http://127.0.0.1:$BACKEND_PORT/config/providers" 2>/dev/null)
echo "$P" | grep -q "http://127.0.0.1:$RELAY_PORT" && echo "[$(ts)] serve up, deepseek -> 127.0.0.1:$RELAY_PORT (via relay)" >> "$LOG" || echo "[$(ts)] WARN: serve up but deepseek NOT via relay (models.json cache overwritten?)" >> "$LOG"
echo "$P" | grep -q "http://127.0.0.1:$ZP_RELAY_PORT" && echo "[$(ts)] serve up, zhipu -> 127.0.0.1:$ZP_RELAY_PORT (via relay)" >> "$LOG" || echo "[$(ts)] WARN: serve up but zhipu NOT via relay (models.json cache overwritten?)" >> "$LOG"
wakeButler
echo "[$(ts)] === serve restart done ===" >> "$LOG"

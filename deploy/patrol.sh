#!/bin/sh
# littleDJ 巡察使（patrol）：只读巡检 + 人工归档
# 巡检固定 12 项：9 项实检（task_stall / process_alive / injection_size / aoci_sync / chain_check / eta_overdue / agent_mismatch / orphan_reply / project_wedge）+ 3 项二期（docs_size / log_size / event_rows）。
# 红线：只读、只探不拉活、不写后端任何状态；凭据只进 curl -u，绝不打印、绝不落日志。
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
RUN_DIR="$ROOT/run"
PID_FILE="$RUN_DIR/patrol.pid"
HEARTBEAT="$RUN_DIR/patrol.heartbeat"
REPORT="$ROOT/config/patrol-report.json"
PATROL_LOG_DIR="$ROOT/logs/patrol"
MAX_SECONDS="${PATROL_MAX_SECONDS:-120}"
HB_STALE_SECONDS="${PATROL_HEARTBEAT_STALE_SECONDS:-0}"
PORT_PROXY="${LITTLEDJ_PORT:-4097}"
PORT_SERVE="${LITTLEDJ_BACKEND_PORT:-4098}"
PORT_RELAY="${DS_RELAY_PORT:-4099}"
PORT_ZP="${ZP_RELAY_PORT:-4100}"

# PATH 兜底：与 deploy/watchdog.sh:23 一致（桌面/计划任务拉起时 node 不在 PATH）
PATH="$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"

case "$MAX_SECONDS" in ''|*[!0-9]*) MAX_SECONDS=120 ;; esac
case "$HB_STALE_SECONDS" in ''|*[!0-9]*) HB_STALE_SECONDS=0 ;; esac

usage() {
  cat <<'USAGE_EOF'
用法：
  patrol.sh                              全量巡检（写报告 + 追加摘要 + stdout 一行摘要）
  patrol.sh --quiet                      同上，但不输出 stdout（文件照写）
  patrol.sh --archive <源文件绝对路径> [--dest <归档目录>]
                                         只做归档（不跑巡检）；--dest 缺省 <repo>/docs/archive/
  patrol.sh --help                       显示本用法

环境变量：
  LITTLEDJ_ROOT                      运行根（LITTLEDJ_ROOT 覆盖；默认由 deploy/runtime-root.sh 解析：主目录下的旧家有凭据则用它，否则 <仓库>/runtime）
  PATROL_MAX_SECONDS                 单次巡检总时限，默认 120 秒（超出则剩余项 skipped + exit 2）
  PATROL_HEARTBEAT_STALE_SECONDS     心跳超龄阈值，默认 0=不判超龄
  DS_RELAY_PORT / ZP_RELAY_PORT / LITTLEDJ_BACKEND_PORT / LITTLEDJ_PORT
                                     端口覆盖（默认 4099 / 4100 / 4098 / 4097）

退出码：0 实检全过；1 实检有 fail/warn/degraded；2 自身失败（锁被占 / 凭据缺失 / 401 / 超时截断 / 报告写不出）
USAGE_EOF
}

# ---------------- 归档子命令（只动传入的源文件，不碰巡检路径） ----------------
archive_run() {
  a_src="$1"
  a_dest="$2"
  case "$a_src" in
    /*) : ;;
    *) echo "归档失败：源必须是绝对路径（$a_src）" >&2; exit 2 ;;
  esac
  [ -e "$a_src" ] || { echo "归档失败：源不存在（$a_src）" >&2; exit 2; }
  [ -f "$a_src" ] || { echo "归档失败：源不是普通文件（$a_src）" >&2; exit 2; }
  mkdir -p -- "$a_dest" || { echo "归档失败：归档目录创建不了（$a_dest）" >&2; exit 2; }
  a_name=$(basename -- "$a_src")
  a_ts=$(date '+%Y%m%d-%H%M%S')
  a_gz="$a_dest/$a_name.$a_ts.gz"
  a_kept="$a_dest/$a_name"
  [ -e "$a_gz" ] && { echo "归档失败：归档物已存在，拒绝覆盖（$a_gz）" >&2; exit 2; }
  [ -e "$a_kept" ] && { echo "归档失败：归档目录已有同名原件，拒绝覆盖（$a_kept）" >&2; exit 2; }
  a_bytes=$(wc -c < "$a_src" | tr -d ' ')
  a_sha=$(sha256sum "$a_src" | cut -d' ' -f1)
  # 先压 gz、再移动原件：归档目录同时留 .gz 与原件，任何一步都可逆
  gzip -c "$a_src" > "$a_gz" || { rm -f "$a_gz"; echo "归档失败：压缩失败（$a_src）" >&2; exit 2; }
  mv -- "$a_src" "$a_kept" || { echo "归档失败：原件移动失败（$a_src）" >&2; exit 2; }
  M_ID="$a_name.$a_ts" M_ORIG="$a_src" M_ARC="$a_gz" M_KEPT="$a_kept" M_BYTES="$a_bytes" M_SHA="$a_sha" \
  M_MANIFEST="$a_dest/MANIFEST.jsonl" node - <<'NODE_EOF'
'use strict'
const fs = require('fs')
const e = process.env
// 单引号安全转义，保证 restoreCmd 原样可被 sh 执行
const sq = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'" }
const rec = {
  id: e.M_ID,
  archivedAt: new Date().toISOString(),
  originalPath: e.M_ORIG,
  archivePath: e.M_ARC,
  originalBytes: Number(e.M_BYTES),
  algo: 'sha256',
  sha256: e.M_SHA,
  restoreCmd: 'gunzip -c ' + sq(e.M_ARC) + ' > ' + sq(e.M_ORIG),
  trigger: 'manual'
}
fs.appendFileSync(e.M_MANIFEST, JSON.stringify(rec) + '\n')
process.stdout.write('已归档：' + e.M_ARC + '（原件保留于 ' + e.M_KEPT + '）\n')
NODE_EOF
  [ $? -eq 0 ] || { echo "归档失败：MANIFEST 写入失败（$a_dest/MANIFEST.jsonl）" >&2; exit 2; }
  exit 0
}

# ---------------- 参数解析 ----------------
ACTION="patrol"
QUIET=0
ARCHIVE_SRC=""
ARCHIVE_DEST="$REPO/docs/archive/"
DEST_SET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --quiet) QUIET=1; shift ;;
    --archive)
      [ $# -ge 2 ] || { echo "参数错误：--archive 需要源文件绝对路径" >&2; exit 2; }
      ACTION="archive"; ARCHIVE_SRC="$2"; shift 2 ;;
    --dest)
      [ $# -ge 2 ] || { echo "参数错误：--dest 需要归档目录" >&2; exit 2; }
      ARCHIVE_DEST="$2"; DEST_SET=1; shift 2 ;;
    *) echo "参数错误：未知参数 $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$ACTION" = "archive" ]; then
  [ -n "$ARCHIVE_SRC" ] || { echo "参数错误：--archive 源为空" >&2; exit 2; }
  [ -n "$ARCHIVE_DEST" ] || { echo "参数错误：--dest 目录为空" >&2; exit 2; }
  archive_run "$ARCHIVE_SRC" "$ARCHIVE_DEST"
fi
[ "$DEST_SET" -eq 0 ] || { echo "参数错误：--dest 只能与 --archive 一起用" >&2; exit 2; }

# ---------------- 巡检主流程 ----------------
mkdir -p -- "$RUN_DIR" "$ROOT/logs" "$(dirname -- "$REPORT")" 2>/dev/null
# task399：临时目录改落 $RUN_DIR——鸿蒙环境 TMPDIR=$HOME，mktemp -d 会把巡检草稿 tmp.XXXX 丢进主目录；
# 被杀（KILL/超时）来不及走 cleanup 的残留，按 3 天龄在下次巡检开头顺手清
export TMPDIR="$RUN_DIR"
find "$RUN_DIR" -maxdepth 1 -type d -name 'tmp.????????' -mtime +3 -exec rm -rf -- {} + 2>/dev/null

# 单实例锁：旧实例存活就直接 exit 2（自身失败），不抢锁
if [ -f "$PID_FILE" ]; then
  OTHER_PID=$(cat "$PID_FILE" 2>/dev/null | tr -d ' \r\n')
  if [ -n "$OTHER_PID" ] && kill -0 "$OTHER_PID" 2>/dev/null; then
    echo "巡检自身失败：已有实例在跑（pid=$OTHER_PID），本次退出" >&2
    exit 2
  fi
fi
printf '%s\n' "$$" > "$PID_FILE" || { echo "巡检自身失败：锁文件写不出（$PID_FILE）" >&2; exit 2; }

TMP_DIR=""
cleanup() {
  rm -f -- "$PID_FILE"
  if [ -n "$TMP_DIR" ]; then rm -rf -- "$TMP_DIR"; fi
}
# trap 体内不做 exit；INT/TERM 走 exit，由 EXIT trap 负责收口清理
trap 'cleanup' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

TMP_DIR=$(mktemp -d) || { echo "巡检自身失败：临时目录建不了" >&2; exit 2; }

START_SECONDS=$(date +%s)
START_MS=$(node -e 'process.stdout.write(String(Date.now()))' 2>/dev/null)
case "$START_MS" in ''|*[!0-9]*) START_MS=0 ;; esac

TRUNCATED=0
SELF_FAIL=0

# 凭据：只读一次，只用于 curl -u；任何日志/输出都不许出现
AUTH_FILE="$ROOT/config/auth.txt"
AUTH=""
AUTH_OK=0
if [ -f "$AUTH_FILE" ] && [ -s "$AUTH_FILE" ]; then
  AUTH="$(cat "$AUTH_FILE")"
  [ -n "$AUTH" ] && AUTH_OK=1
fi
[ "$AUTH_OK" -eq 1 ] || SELF_FAIL=1

elapsed_hit() {
  e_now=$(date +%s)
  [ $((e_now - START_SECONDS)) -ge "$MAX_SECONDS" ]
}

probe_port() {
  p_name=$1
  p_port=$2
  p_path=$3
  p_auth=$4
  p_url="http://127.0.0.1:$p_port$p_path"
  if [ "$p_auth" -eq 1 ]; then
    p_code=$(curl -s -o "$TMP_DIR/port.$p_name.body" -m 8 -w '%{http_code}' -u "$AUTH" "$p_url")
  else
    p_code=$(curl -s -o "$TMP_DIR/port.$p_name.body" -m 8 -w '%{http_code}' "$p_url")
  fi
  printf '%s' "$p_code" > "$TMP_DIR/port.$p_name.code"
}

collect_pids() {
  c_name=$1
  c_keyword=$2
  ps -ef 2>/dev/null | grep -F "$c_keyword" | grep -v grep | awk '{print $2}' > "$TMP_DIR/pids.$c_name.txt" 2>/dev/null
}

# 1) task_stall：只读 GET /_tasks（绝不 POST/PUT，不写覆盖层/DB）
if elapsed_hit; then
  TRUNCATED=1
else
  if [ "$AUTH_OK" -eq 1 ]; then
    code=$(curl -s -o "$TMP_DIR/tasks.json" -m 8 -w '%{http_code}' -u "$AUTH" "http://127.0.0.1:$PORT_PROXY/_tasks")
    printf '%s' "$code" > "$TMP_DIR/task.code"
    [ "$code" = "401" ] && SELF_FAIL=1
  else
    printf '%s' 'skip:auth-missing' > "$TMP_DIR/task.code"
  fi
fi

# 2) process_alive：端口探活 + pid 只读探测 + patrol 心跳；只探不拉活
if elapsed_hit; then
  TRUNCATED=1
else
  printf '1' > "$TMP_DIR/pa.ran"
  probe_port relay "$PORT_RELAY" "/health" 0
  probe_port zhipu_relay "$PORT_ZP" "/health" 0
  probe_port serve "$PORT_SERVE" "/health" 0
  if [ "$AUTH_OK" -eq 1 ]; then
    probe_port proxy "$PORT_PROXY" "/_health" 1
  else
    printf '%s' 'skip:auth-missing' > "$TMP_DIR/port.proxy.code"
  fi
  collect_pids relay 'deepseek-relay.js'
  collect_pids zhipu_relay 'zhipu-relay.js'
  collect_pids serve 'deveco serve'
  collect_pids proxy 'server/proxy.js'
  collect_pids watchdog 'watchdog.sh'
  collect_pids patrol 'patrol.sh'
  # watchdog：pid 文件 + kill -0 判活；ps 命中的 pid 另记
  printf '%s' '' > "$TMP_DIR/wd.pid.txt"
  printf '0' > "$TMP_DIR/wd.alive"
  if [ -f "$RUN_DIR/watchdog.pid" ]; then
    wd_raw=$(cat "$RUN_DIR/watchdog.pid" 2>/dev/null | tr -d ' \r\n')
    printf '%s' "$wd_raw" > "$TMP_DIR/wd.pid.txt"
    if [ -n "$wd_raw" ] && kill -0 "$wd_raw" 2>/dev/null; then
      printf '1' > "$TMP_DIR/wd.alive"
    fi
  fi
fi

# 3) injection_size：只 wc -c 两个注入文件；缺失如实记，不当 0
if elapsed_hit; then
  TRUNCATED=1
else
  : > "$TMP_DIR/inj.txt"
  for inj_f in "$ROOT/config/prompts/worldview.md" "$ROOT/config/RULES.md"; do
    if [ -f "$inj_f" ]; then
      inj_b=$(wc -c < "$inj_f" | tr -d ' ')
      printf '%s|%s\n' "$inj_f" "$inj_b" >> "$TMP_DIR/inj.txt"
    else
      printf '%s|MISSING\n' "$inj_f" >> "$TMP_DIR/inj.txt"
    fi
  done
fi

# 4) aoci_sync：AOCI 索引对账（只读；缺 git 环境 skip 不误报）
if elapsed_hit; then
  TRUNCATED=1
else
  printf '1' > "$TMP_DIR/aoci.ran"
  sh "$REPO/deploy/aoci-check.sh" --patrol > "$TMP_DIR/aoci.raw" 2>&1
  printf '%s' "$?" > "$TMP_DIR/aoci.exit"
fi

# 5) chain_check：御史只审不改 + 任何档位一级不跳 的链路检查点（纯只读断言）
# 每条断言一行写 chain.txt：A1|pass / A2|warn / …；值域 pass|warn|skip，汇总在 node 侧
chain_assert() {
  if [ ! -f "$1" ] || ! grep -Fq "$2" "$1"; then
    CHAIN_A2_BAD=$((CHAIN_A2_BAD + 1))
  fi
}
if elapsed_hit; then
  TRUNCATED=1
else
  : > "$TMP_DIR/chain.txt"
  AGENT_DIR="$HOME/.config/deveco/agent"
  RULES_FILE="$ROOT/config/RULES.md"
  QUICK_CARD="$REPO/docs/管家系/速查卡.md"

  # A1 工具位：只锁 tools 块窗口（`tools:` 行至 `---` 行），裸 grep 全文会误中「禁止 edit/write」铁律行
  a1_bad=""
  # task265：御史新键（旧键 censor-deepseek/glm 薄壳退役不再入列）
  for a1_role in steward censor-plan censor-output; do
    a1_card="$AGENT_DIR/$a1_role.md"
    if [ ! -f "$a1_card" ]; then
      a1_bad="$a1_bad $a1_role:missing"
    # task319 巡检修：正则加行首锚定——steward 的 `todowrite: true`（task271 主人拍板）会被旧正则子串误伤成 write 命中
    elif sed -n '/^tools:/,/^---/p' "$a1_card" | grep -Eq '^[[:space:]]*(write|edit):[[:space:]]*true'; then
      a1_bad="$a1_bad $a1_role:tool"
    fi
  done
  if [ -z "$a1_bad" ]; then
    printf 'A1|pass\n' >> "$TMP_DIR/chain.txt"
  else
    printf 'A1|warn\n' >> "$TMP_DIR/chain.txt"
  fi

  # A2 权威条文：附录 A/B 全部 grep -Fq 逐条跑，全 0=pass，任一缺失=warn
  CHAIN_A2_BAD=0
  chain_assert "$RULES_FILE" '任何档位都必须走 大管家→小管家→枢机→执笔/御史 全链，一级不跳'
  chain_assert "$RULES_FILE" '## §17 御史只审不改·链路检查点'
  chain_assert "$RULES_FILE" 'git rev-parse --short HEAD、git status --porcelain 全量、全局 6 文件 sha256 指纹'
  chain_assert "$RULES_FILE" '比对范围限定该单涉改白名单，白名单外变化不参与判定'
  chain_assert "$RULES_FILE" '无法归因=越权嫌疑'
  chain_assert "$RULES_FILE" 'patrol.sh 第 5 实检项 chain_check 为唯一权威对账'
  chain_assert "$RULES_FILE" '同单第 2 次违反=熔断停单等主人'
  chain_assert "$AGENT_DIR/butler.md" '任何档位一级不跳（RULES §15 权威条文）'
  chain_assert "$AGENT_DIR/steward.md" '基线三要素（HEAD、porcelain 全量、全局 6 文件 sha256 指纹）'
  chain_assert "$AGENT_DIR/secretariat.md" '审段基线三要素与越权自证要求'
  chain_assert "$AGENT_DIR/censor-plan.md" '越权自证（接单）：基线 HEAD='
  chain_assert "$AGENT_DIR/censor-plan.md" '越权自证（结案）：复核 HEAD='
  chain_assert "$AGENT_DIR/censor-plan.md" '本裁决未改任何文件'
  chain_assert "$AGENT_DIR/censor-plan.md" '同单第 2 次违反即熔断停单（RULES §17）'
  chain_assert "$AGENT_DIR/censor-output.md" '越权自证（接单）：基线 HEAD='
  chain_assert "$AGENT_DIR/censor-output.md" '越权自证（结案）：复核 HEAD='
  chain_assert "$AGENT_DIR/censor-output.md" '本裁决未改任何文件'
  chain_assert "$AGENT_DIR/censor-output.md" '同单第 2 次违反即熔断停单（RULES §17）'
  if [ "$CHAIN_A2_BAD" -eq 0 ]; then
    printf 'A2|pass\n' >> "$TMP_DIR/chain.txt"
  else
    printf 'A2|warn\n' >> "$TMP_DIR/chain.txt"
  fi

  # A3 旧语义：五卡 + RULES + 速查卡不得再出现跳枢机语义；.bak 与 docs/管家系/README.md 不纳入
  a3_hits=$(grep -rn '按契约直接派 writer' "$AGENT_DIR" "$RULES_FILE" "$QUICK_CARD" 2>/dev/null | grep -v '\.bak')
  if [ -z "$a3_hits" ]; then
    printf 'A3|pass\n' >> "$TMP_DIR/chain.txt"
  else
    printf 'A3|warn\n' >> "$TMP_DIR/chain.txt"
  fi

  # A4 在途牌检查点段（task185 收紧）：仅查 state 行为在途态的任务牌；N≥57 须含 `## 检查点`；
  # ⚠ 词表边界（task185 御史 P2-2）：state 用词表外新词（todo/queued 等）会静默跳过——新增在途 state 词须同步本块词表；立牌规范锁英文键 `- state:`（中文键「- 状态：」不会被提取，P2-3）
  # done/terminated/无 state/裁决书不查（历史牌按立牌当时惯例，不追溯）；日期式编号（≥7 位）解析失败=skip
  a4_checked=0
  a4_bad=""
  for a4_f in "$REPO"/.taskqueue/task*.md; do
    [ -f "$a4_f" ] || continue
    a4_base=$(basename -- "$a4_f")
    case "$a4_base" in
      *裁决书*) continue ;;
    esac
    a4_num=$(printf '%s' "$a4_base" | sed -n 's/^task\([0-9][0-9]*\)-.*$/\1/p')
    [ -n "$a4_num" ] || continue
    a4_trim=$(printf '%s' "$a4_num" | sed 's/^0*//')
    [ -n "$a4_trim" ] || a4_trim=0
    if [ "${#a4_num}" -ge 7 ] || [ "$a4_trim" -ge 1000000 ]; then
      continue
    fi
    [ "$a4_trim" -ge 57 ] || continue
    a4_state=$(sed -n 's/^- state:[[:space:]]*//p' "$a4_f" | head -n 1)
    case "$a4_state" in
      *doing*|*in_progress*|*waiting*|*pending*|*blocked*) ;;
      *) continue ;;
    esac
    a4_checked=$((a4_checked + 1))
    if ! grep -q '^## 检查点' "$a4_f"; then
      a4_bad="$a4_bad $a4_base"
    fi
  done
  if [ -n "$a4_bad" ]; then
    printf 'A4|warn\n' >> "$TMP_DIR/chain.txt"
  elif [ "$a4_checked" -eq 0 ]; then
    printf 'A4|skip\n' >> "$TMP_DIR/chain.txt"
  else
    printf 'A4|pass\n' >> "$TMP_DIR/chain.txt"
  fi

  # A5 裁决书自证行：task57 牌内「越权自证」≥2 行=pass；牌不存在=skip
  a5_files=0
  a5_hits=0
  for a5_f in "$REPO"/.taskqueue/task57-*.md; do
    [ -f "$a5_f" ] || continue
    a5_files=$((a5_files + 1))
    a5_c=$(grep -c '越权自证' "$a5_f" 2>/dev/null)
    case "$a5_c" in ''|*[!0-9]*) a5_c=0 ;; esac
    a5_hits=$((a5_hits + a5_c))
  done
  if [ "$a5_files" -eq 0 ]; then
    printf 'A5|skip\n' >> "$TMP_DIR/chain.txt"
  elif [ "$a5_hits" -ge 2 ]; then
    printf 'A5|pass\n' >> "$TMP_DIR/chain.txt"
  else
    printf 'A5|warn\n' >> "$TMP_DIR/chain.txt"
  fi
fi

# task309：orphan_reply 悬空回复哨兵——只报不修（patrol 红线），复用 autoresume --scan-only 的
# 同一份判定口径（server/orphan-detect.js：续跑执行方与巡检哨兵共用，防两套漂移）。
# 分级：悬空且护栏未放弃 → warn（等 autoresume 周期续跑处理）；悬空且护栏已放弃 → fail（需主人人工）。
# serve 等待上限压到 8s：serve 掉线时本项 skip，不烧穿 patrol 120s 总时限。
if elapsed_hit; then
  TRUNCATED=1
else
  printf '1' > "$TMP_DIR/orphan.ran"
  LITTLEDJ_ROOT="$ROOT" LITTLEDJ_AUTORESUME_WAIT_SERVE_MS=8000 \
    node "$REPO/server/autoresume.js" --scan-only --json --reason patrol \
    > "$TMP_DIR/orphan.json" 2> "$TMP_DIR/orphan.err"
  printf '%s' "$?" > "$TMP_DIR/orphan.exit"
fi

# 收口成报告：JSON 全部由 node 生成（本机无 jq），禁止 shell 裸拼转义
export P_TMP="$TMP_DIR" P_ROOT="$ROOT" P_REPO="$REPO" P_HB_FILE="$HEARTBEAT"
export P_SELF_PID="$$" P_PPID="$PPID" P_START_MS="$START_MS" P_MAX_SECONDS="$MAX_SECONDS"
export P_HB_STALE_SECONDS="$HB_STALE_SECONDS"
export P_PORT_RELAY="$PORT_RELAY" P_PORT_ZP="$PORT_ZP" P_PORT_SERVE="$PORT_SERVE" P_PORT_PROXY="$PORT_PROXY"
export P_TRUNCATED="$TRUNCATED" P_SELF_FAIL="$SELF_FAIL"

node - <<'NODE_EOF'
'use strict'
const fs = require('fs')
const path = require('path')

const e = process.env
const TMP = e.P_TMP
const ROOT = e.P_ROOT
const REPO = e.P_REPO
const HB_FILE = e.P_HB_FILE
const HB_THRESHOLD = Number(e.P_HB_STALE_SECONDS) || 0
const SELF_PID = Number(e.P_SELF_PID) || 0
const PARENT_PID = Number(e.P_PPID) || 0
const MAX_SECONDS = Number(e.P_MAX_SECONDS) || 0
const TRUNCATED = e.P_TRUNCATED === '1'
const SELF_FAIL = e.P_SELF_FAIL === '1'
// 注入层体积上限 20480 字节：来源 = DAG 20KB 口径 + 立项方案第三节（超限就报主人拆分）
const INJECTION_LIMIT = 20480
const PORTS = {
  relay: Number(e.P_PORT_RELAY),
  zhipu_relay: Number(e.P_PORT_ZP),
  serve: Number(e.P_PORT_SERVE),
  proxy: Number(e.P_PORT_PROXY)
}
const PORT_ORDER = ['relay', 'zhipu_relay', 'serve', 'proxy']

const START_MS = Number(e.P_START_MS) || Date.now()
const nowMs = Date.now()
const durationMs = Math.max(0, nowMs - START_MS)

function readText(p) {
  try { return fs.readFileSync(p, 'utf8') } catch (err) { return null }
}
function readLines(p) {
  const v = readText(p)
  if (v === null) return []
  return v.split(/\r?\n/).filter(function (s) { return s.trim() !== '' })
}
function readTrim(p) {
  const v = readText(p)
  return v === null ? null : v.trim()
}
function pad2(n) { return n < 10 ? '0' + n : '' + n }
function localStamp(d) {
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds())
}
function pidList(name, exclude) {
  return readLines(path.join(TMP, 'pids.' + name + '.txt'))
    .map(function (s) { return Number(s) })
    .filter(function (n) { return Number.isFinite(n) && n > 0 && exclude.indexOf(n) < 0 })
}
function skippedSkeleton(id, reason) {
  return { id: id, phase: 'active', result: 'skipped', detail: { reason: reason } }
}

// ---- 1) task_stall ----
function taskItem() {
  const raw = readTrim(path.join(TMP, 'task.code'))
  const skeleton = {
    staleRules: null, counts: null, quiet: [], stalled: [], archived: [], total: 0
  }
  if (raw === null) {
    skeleton.reason = 'timeout'
    return { id: 'task_stall', phase: 'active', result: 'skipped', detail: skeleton }
  }
  if (raw.indexOf('skip:') === 0) {
    const why = raw.slice(5)
    skeleton.reason = why
    if (why === 'auth-missing') skeleton.hint = 'config/auth.txt 缺失或为空：无法读任务台账'
    return { id: 'task_stall', phase: 'active', result: 'skipped', detail: skeleton }
  }
  if (raw === '401') {
    skeleton.reason = 'http-401'
    skeleton.hint = 'proxy 凭据无效：核对 config/auth.txt（按自身失败退出 2）'
    return { id: 'task_stall', phase: 'active', result: 'skipped', detail: skeleton }
  }
  if (raw === '000') {
    skeleton.reason = 'proxy-unreachable'
    skeleton.hint = 'proxy 端口无响应，由 process_alive 定夺'
    return { id: 'task_stall', phase: 'active', result: 'skipped', detail: skeleton }
  }
  if (raw !== '200') {
    skeleton.reason = 'http-' + raw
    return { id: 'task_stall', phase: 'active', result: 'skipped', detail: skeleton }
  }
  let body = null
  try { body = JSON.parse(readText(path.join(TMP, 'tasks.json')) || '') } catch (err) { body = null }
  if (!body || typeof body !== 'object') {
    skeleton.reason = 'parse-error'
    skeleton.hint = 'GET /_tasks 返回 200 但响应体不是合法 JSON'
    return { id: 'task_stall', phase: 'active', result: 'fail', detail: skeleton }
  }
  const rules = body.staleRules || null
  if (body.ok === false) {
    return {
      id: 'task_stall', phase: 'active', result: 'degraded',
      detail: {
        reason: body.reason || 'degraded',
        hint: body.hint || '',
        staleRules: rules,
        counts: body.counts || null,
        quiet: [], stalled: [], archived: [], total: 0
      }
    }
  }
  const tasks = Array.isArray(body.tasks) ? body.tasks : []
  const pick = function (t) {
    return {
      id: t.id,
      title: t.title,
      stale: t.stale,
      staleMinutes: t.staleMinutes == null ? null : t.staleMinutes,
      lastEventAt: t.lastEventAt
    }
  }
  // task157：任务口径过滤——step=0 普通会话（从未派过子代理）不算「疑似中断」，排除后
  // task_stall 才与左栏/任务面板同口径（task48：inTask = step>0 且未归档）；
  // 已 override 关闭（state∈{interrupted,done}）的行同样不计入告警（主人 2026-11-09：
  // 「疑似中断不要让我去 check，断了就关了」——已关任务还报 fail＝逼主人 check）。
  // task334 P1-1：waiting（op=hold 显式等待中·挂后台任务）同 closed——巡检不得把等待中报成疑似中断呼主人。
  const isClosed = function (t) { return t.state === 'interrupted' || t.state === 'done' || t.state === 'waiting' }
  const quiet = tasks.filter(function (t) { return t.inTask !== false && t.stale === 'quiet' }).map(pick)
  const stalled = tasks.filter(function (t) { return t.inTask !== false && t.stale === 'stalled' && !isClosed(t) }).map(pick)
  const archived = tasks.filter(function (t) { return t.stale === 'archived' }).map(pick)
  // task157 P1-5 复审：counts 必须本地重算——body.counts 是 /_tasks 按 stale 透传、不含 state 过滤，
  // 直接透传会出现「result=pass 但 counts.stalled>0」自相矛盾（大管家读数字仍报「疑似中断 N 项」）。
  const closedStalled = tasks.filter(function (t) { return t.stale === 'stalled' && isClosed(t) }).length
  const held = tasks.filter(function (t) { return t.state === 'waiting' }).length /* task334：等待中单列（closedStalled 含 waiting，held 供看板区分人工收口/挂后台） */
  const counts = {
    active: tasks.filter(function (t) { return t.stale === 'active' }).length,
    quiet: quiet.length, stalled: stalled.length, archived: archived.length, closedStalled: closedStalled, held: held
  }
  return {
    id: 'task_stall', phase: 'active',
    // 阈值只从响应 staleRules 透传；脚本内不定义 5/15/24
    result: stalled.length ? 'fail' : 'pass',
    detail: { staleRules: rules, counts: counts, quiet: quiet, stalled: stalled, archived: archived, total: tasks.length }
  }
}

// ---- 2) process_alive ----
function heartbeatDetail() {
  let ageSeconds = null
  let missing = true
  try {
    const st = fs.statSync(HB_FILE)
    missing = false
    ageSeconds = Math.max(0, Math.floor((Date.now() - st.mtimeMs) / 1000))
  } catch (err) {}
  const stale = !missing && HB_THRESHOLD > 0 && ageSeconds > HB_THRESHOLD
  return { file: HB_FILE, ageSeconds: ageSeconds, stale: stale, thresholdSeconds: HB_THRESHOLD, missing: missing }
}

function portEntry(name) {
  const raw = readTrim(path.join(TMP, 'port.' + name + '.code'))
  const pids = pidList(name, [])
  if (raw === null) {
    return { port: PORTS[name], portAlive: null, pids: pids, result: 'skipped', reason: 'timeout' }
  }
  if (raw.indexOf('skip:') === 0) {
    return { port: PORTS[name], portAlive: null, pids: pids, result: 'skipped', reason: raw.slice(5) }
  }
  const alive = raw === '200'
  let result
  if (alive && pids.length) result = 'pass'
  else if (alive) result = 'warn'
  else if (pids.length) result = 'pass'
  else result = 'fail'
  return { port: PORTS[name], portAlive: alive, httpCode: raw, pids: pids, result: result }
}

function processItem() {
  const hb = heartbeatDetail()
  const ran = fs.existsSync(path.join(TMP, 'pa.ran'))
  const ports = {}
  PORT_ORDER.forEach(function (name) { ports[name] = portEntry(name) })
  // patrol 自身：selfPid=$$；ps 列表排除自身与直接父 shell（`sh -c "... patrol.sh"` 会误命中）
  const patrolPids = pidList('patrol', [SELF_PID, PARENT_PID])
  const wdPidText = readTrim(path.join(TMP, 'wd.pid.txt'))
  const wdPid = wdPidText && /^[0-9]+$/.test(wdPidText) ? Number(wdPidText) : null
  const wdAlive = (readTrim(path.join(TMP, 'wd.alive')) || '0') === '1'
  const wdPids = pidList('watchdog', [])
  let wdResult
  if (wdAlive && wdPid) wdResult = 'pass'
  else if (wdPids.length) wdResult = 'warn'
  else wdResult = 'fail'

  const detail = {
    ports: ports,
    watchdog: {
      pidFile: path.join(ROOT, 'run', 'watchdog.pid'),
      pid: wdPid, pidAlive: wdAlive, pids: wdPids, result: wdResult
    },
    patrol: { selfPid: SELF_PID, pids: patrolPids, result: 'pass' },
    patrolHeartbeat: hb
  }
  if (!ran) {
    detail.reason = 'timeout'
    return { id: 'process_alive', phase: 'active', result: 'skipped', detail: detail }
  }
  let hasFail = hb.stale === true
  let hasWarn = false
  let portSkipped = 0
  PORT_ORDER.forEach(function (name) {
    const r = ports[name].result
    if (r === 'fail') hasFail = true
    else if (r === 'warn') hasWarn = true
    else if (r === 'skipped') portSkipped++
  })
  if (wdResult === 'fail') hasFail = true
  else if (wdResult === 'warn') hasWarn = true
  let result
  if (hasFail) result = 'fail'
  else if (hasWarn) result = 'warn'
  else if (portSkipped === PORT_ORDER.length) result = 'skipped'
  else result = 'pass'
  if (result === 'skipped') detail.reason = 'ports-skipped'
  return { id: 'process_alive', phase: 'active', result: result, detail: detail }
}

// ---- 3) injection_size ----
function injectionItem() {
  const raw = readText(path.join(TMP, 'inj.txt'))
  if (raw === null) {
    return {
      id: 'injection_size', phase: 'active', result: 'skipped',
      detail: { reason: 'timeout', files: {}, totalBytes: null, limitBytes: INJECTION_LIMIT, exceeded: null, missing: [] }
    }
  }
  const files = {}
  const missing = []
  let total = 0
  raw.split(/\r?\n/).forEach(function (line) {
    if (!line) return
    const i = line.lastIndexOf('|')
    if (i < 0) return
    const p = line.slice(0, i)
    const v = line.slice(i + 1)
    if (v === 'MISSING') {
      // 缺失如实记 null 并计入 missing，不当 0、不静默；本项按 fail 处理
      files[p] = null
      missing.push(p)
    } else {
      const n = Number(v)
      if (Number.isFinite(n)) { files[p] = n; total += n }
    }
  })
  const exceeded = total > INJECTION_LIMIT
  const result = (missing.length || exceeded) ? 'fail' : 'pass'
  return {
    id: 'injection_size', phase: 'active', result: result,
    detail: { files: files, totalBytes: total, limitBytes: INJECTION_LIMIT, exceeded: exceeded, missing: missing }
  }
}

// ---- 4) aoci_sync ----
function aociItem() {
  const ran = readText(path.join(TMP, 'aoci.ran'))
  if (ran === null) {
    return { id: 'aoci_sync', phase: 'active', result: 'skipped', detail: { reason: 'timeout' } }
  }
  const raw = readText(path.join(TMP, 'aoci.raw')) || ''
  const lines = raw.split(/\r?\n/).filter(Boolean)
  const head = lines[0] || ''
  const m = head.match(/^result=(\w+)$/)
  const result = m ? m[1] : 'warn'
  const notes = lines.slice(1)
  const detail = { notes: notes }
  if (!m) detail.reason = 'format'
  return { id: 'aoci_sync', phase: 'active', result: result, detail: detail }
}

// ---- 5) chain_check ----
function chainItem() {
  const raw = readText(path.join(TMP, 'chain.txt'))
  if (raw === null) {
    return { id: 'chain_check', phase: 'active', result: 'skipped', detail: { reason: 'timeout', asserts: [] } }
  }
  const asserts = []
  raw.split(/\r?\n/).forEach(function (line) {
    if (!line) return
    const i = line.indexOf('|')
    if (i <= 0) return
    const key = line.slice(0, i)
    const val = line.slice(i + 1)
    if (val === 'pass' || val === 'warn' || val === 'skip') asserts.push({ id: key, result: val })
  })
  if (!asserts.length) {
    return { id: 'chain_check', phase: 'active', result: 'skipped', detail: { reason: 'no-assert', asserts: asserts } }
  }
  const bad = asserts.filter(function (a) { return a.result === 'warn' })
  const allSkip = asserts.every(function (a) { return a.result === 'skip' })
  let result = 'pass'
  if (bad.length) result = 'warn'
  else if (allSkip) result = 'skipped'
  return { id: 'chain_check', phase: 'active', result: result, detail: { asserts: asserts } }
}

// ---- 6) eta_overdue（task119：任务预计时间超时巡检；只读 task_stall 已落的 tasks.json，零新增 curl）----
// 读行内字段（applyOverrides 统一谓词已控：仅 state=running 且 inTask 时计 overdue）；不读 etas 映射（live-only 条目服务端恒 0）。
function etaItem() {
  const raw = readTrim(path.join(TMP, 'task.code'))
  const skeleton = { overdue: [], total: 0 }
  if (raw === null) return { id: 'eta_overdue', phase: 'active', result: 'skipped', detail: Object.assign({ reason: 'timeout' }, skeleton) }
  if (raw.indexOf('skip:') === 0 || raw === '401' || raw === '000' || raw !== '200') {
    return { id: 'eta_overdue', phase: 'active', result: 'skipped', detail: Object.assign({ reason: raw.indexOf('skip:') === 0 ? raw.slice(5) : (raw === '200' ? 'http-other' : 'http-' + raw) }, skeleton) }
  }
  let body = null
  try { body = JSON.parse(readText(path.join(TMP, 'tasks.json')) || '') } catch (err) { body = null }
  if (!body || typeof body !== 'object') {
    return { id: 'eta_overdue', phase: 'active', result: 'skipped', detail: Object.assign({ reason: 'no-data' }, skeleton) }
  }
  if (body.ok === false) {
    // 台账降级≠无超时（防「无数据=pass」假绿）：显式 skipped(degraded)
    return { id: 'eta_overdue', phase: 'active', result: 'skipped', detail: Object.assign({ reason: 'degraded', degraded: body.reason || 'degraded' }, skeleton) }
  }
  const tasks = Array.isArray(body.tasks) ? body.tasks : []
  const overdue = tasks.filter(function (t) { return Number(t.etaOverdueMin) > 0 })
    .sort(function (a, b) { return (Number(b.etaOverdueMin) || 0) - (Number(a.etaOverdueMin) || 0) })
    .map(function (t) {
      return { id: t.id, title: String(t.title || '').replace(/[\r\n]+/g, ' '), overdueMin: Number(t.etaOverdueMin) || 0,
        etaMinutes: Number(t.etaMinutes) || 0, runner: t.runnerSession || '', child: t.etaChildId || (t.runnerSession || '') }
    })
  // task126：nudge 定位清单落盘（shell 层逐个 POST /_nudge；全部护栏在网关裁决，此处 fire-and-forget）
  try { fs.writeFileSync(path.join(TMP, 'nudge.list'), overdue.map(function (t) { return t.child }).filter(Boolean).join('\n') + '\n') } catch (eN) {}
  // task126 F1.5：在途零 ETA 提示（running 且 inTask 且开跑>10min 仍无行内 etaMinutes——pass 级 detail 注记，防软约束静默失效）
  const nowMs = Date.now()
  const noEta = tasks.filter(function (t) {
    return t.state === 'running' && t.inTask !== false && !(Number(t.etaMinutes) > 0) &&
      t.timeCreated && (nowMs - Number(t.timeCreated)) > 10 * 60 * 1000
  }).map(function (t) { return { id: t.id, title: String(t.title || '').replace(/[\r\n]+/g, ' ') } })
  if (overdue.length) {
    return { id: 'eta_overdue', phase: 'active', result: 'warn',
      detail: { overdue: overdue.slice(0, 5), total: overdue.length, hint: '已超预计·待查验（文案禁判死：查验交小管家判读四态）' } }
  }
  return { id: 'eta_overdue', phase: 'active', result: 'pass', detail: Object.assign({ noEta: noEta.slice(0, 5), noEtaTotal: noEta.length, noEtaHint: noEta.length ? '存在开跑>10min 未落 ETA 的在途任务（软约束未被执行，可补落）' : '' }, skeleton) }
}

// ---- 7) agent_mismatch（task184：派单角色丢失核对闸的审计复查；只读 config/agent-mismatch-log.jsonl）----
// 语义：abort 条目=曾检测到「要求 X 实际 Y（全工具）」并已自动停止的派单——出现即 serve 角色加载故障信号。
// 注意（方案审 P2-5）：熔断后仍持续写审计属期望行为，持续 fail 指向 serve 能否正常加载自定义 agent，非巡检自身故障。
function agentItem() {
  const file = path.join(ROOT, 'config', 'agent-mismatch-log.jsonl')
  let lines = []
  try { const rawA = readText(file); lines = rawA ? String(rawA).trim().split('\n').filter(Boolean) : [] } catch (eA) { lines = [] }
  const nowMs = Date.now()
  const recent = []
  lines.slice(-300).forEach(function (l) {
    try {
      const o = JSON.parse(l)
      if (o && o.task === 'task184' && o.action === 'abort' && (nowMs - (Number(o.at) || 0)) <= 24 * 3600 * 1000) recent.push(o)
    } catch (eJ) {}
  })
  if (!recent.length) return { id: 'agent_mismatch', phase: 'active', result: 'pass', detail: { aborted24h: 0 } }
  const last = recent[recent.length - 1]
  return {
    id: 'agent_mismatch', phase: 'active',
    result: recent.length > 5 ? 'fail' : 'warn',
    detail: {
      aborted24h: recent.length,
      last: { at: last.at, sid: last.sid, want: last.want, agent: last.agent },
      hint: '派单角色丢失=serve 角色加载故障（非巡检自身故障）；持续出现请检查 serve 能否正常加载自定义 agent'
    }
  }
}

// ---- 8) orphan_reply（task309）—— 悬空回复哨兵（只报不修，口径与 autoresume 共源） ----
function orphanItem() {
  const ran = fs.existsSync(path.join(TMP, 'orphan.ran'))
  const scanExit = readTrim(path.join(TMP, 'orphan.exit'))
  if (!ran || scanExit === null) return { id: 'orphan_reply', phase: 'active', result: 'skipped', detail: { reason: 'truncated' } }
  let scan = null
  try { scan = JSON.parse(fs.readFileSync(path.join(TMP, 'orphan.json'), 'utf8')) } catch (err) {}
  if (String(scanExit) !== '0' || !scan || !Array.isArray(scan.orphans)) {
    let errTxt = ''
    try { errTxt = fs.readFileSync(path.join(TMP, 'orphan.err'), 'utf8').trim().slice(0, 160) } catch (err) {}
    return { id: 'orphan_reply', phase: 'active', result: 'skipped', detail: { reason: 'scan-failed', exit: String(scanExit), stderr: errTxt } }
  }
  const orphans = scan.orphans.map(function (o) {
    return { id: o.id, title: o.title, cls: o.cls, ageMin: o.ageMin, attempts: o.attempts, gaveUp: !!o.gaveUp }
  })
  const gaveUp = orphans.filter(function (o) { return o.gaveUp }).length
  const result = gaveUp > 0 ? 'fail' : (orphans.length ? 'warn' : 'pass')
  // task397：等主人点选提问卡的会话——不是故障、不改分级，单列出来让主人知道该点哪张卡
  // （2026-11-23「新对话 17:23」：提问卡等了 7 小时没人知道它在等人）
  const waiting = Array.isArray(scan.waiting) ? scan.waiting : []
  return {
    id: 'orphan_reply', phase: 'active', result: result,
    detail: { scanned: scan.scanned || 0, orphans: orphans, gaveUp: gaveUp, youngSkipped: scan.youngSkipped || 0, waiting: waiting },
    hint: waiting.length
      ? '有 ' + waiting.length + ' 个会话在等主人点选提问卡（不是故障，点一下就好）：' + waiting.map(function (w) { return (w.title || w.id) + '「' + (w.q || '') + '」已等 ' + w.ageMin + 'min' }).join('；')
      : undefined
  }
}

// ---- 9) project_wedge（task366）—— 项目级卡死哨兵（读 wedge-heal 近 24h 项目级 WARN）----
// 分级：0=pass / ≥1=warn（有目录疑似被挂死回合占锁）/ ≥3=fail（持续告警需人工重启 serve）。
// 解析失败（jsonl 损坏）计入 warn，不静默 fail-open；status-parse-fail/msg-budget 类「自身探测故障」
// 不升 fail（P1-4 产出审：serve 抖动时每目录每轮一条，60s 就堆到 fail 会误导主人重启 serve）。
function projectWedgeItem() {
  const files = [path.join(ROOT, 'run', 'wedge-heal-log.jsonl'), path.join(ROOT, 'run', 'wedge-heal-log.jsonl.old')]
  const cutoff = Date.now() - 24 * 3600 * 1000
  let anyFile = false
  let parseFail = false
  const wedgeWarns = []   // 真命中（挂死占锁形态）
  const infraWarns = []   // 自身探测故障（status-parse-fail / msg-budget）
  for (const f of files) {
    const lines = readLines(f)
    if (!lines.length) continue
    anyFile = true
    for (const line of lines) {
      let j = null
      try { j = JSON.parse(line) } catch (err) { parseFail = true; continue }
      if (!j || j.event !== 'project-wedge' || j.level !== 'warn') continue
      const ts = Date.parse(j.ts || '')
      if (!isFinite(ts)) { parseFail = true; continue } // P2-4：缺/坏 ts 也算解析失败
      if (ts < cutoff) continue
      if (j.reason === 'status-parse-fail' || j.reason === 'msg-budget-exhausted') infraWarns.push({ dir: j.dir, reason: j.reason })
      else wedgeWarns.push({ dir: j.dir, reason: j.reason, abortIneffective: !!j.abortIneffective })
    }
  }
  if (!anyFile) return { id: 'project_wedge', phase: 'active', result: 'skipped', detail: { reason: 'no-jsonl（wedge-heal 尚未写过项目级日志）' } }
  if (parseFail) return { id: 'project_wedge', phase: 'active', result: 'warn', detail: { reason: 'jsonl-parse-fail（部分行损坏）', wedgeWarns: wedgeWarns.length, infraWarns: infraWarns.length } }
  // 真命中 ≥3 才 fail；infra（自身故障）只抬到 warn，永不单独 fail
  const result = wedgeWarns.length >= 3 ? 'fail' : ((wedgeWarns.length + infraWarns.length) ? 'warn' : 'pass')
  return {
    id: 'project_wedge', phase: 'active', result: result,
    detail: { wedgeWarns24h: wedgeWarns.length, infraWarns24h: infraWarns.length, recent: wedgeWarns.slice(-5).concat(infraWarns.slice(-3)) },
    hint: 'wedgeWarns=目录疑似被挂死回合占锁：≥1 关注（wedge-heal 已告警+尝试 abort 并补一句恢复语，task397 起不再吞主人排在后面的消息）、≥3 需主人重启 serve（绝不自动重启）；infraWarns=探测自身故障（status 解析失败/预算耗尽），只 warn 不 fail'
  }
}

// ---- 10~12) 二期未启用（不读日志/DB、不做任何检查） ----
function deferredItem(id, reason) {
  return { id: id, phase: 'phase2_deferred', result: 'deferred', detail: { reason: reason } }
}

const items = [
  taskItem(),
  processItem(),
  injectionItem(),
  aociItem(),
  chainItem(),
  etaItem(),
  agentItem(),
  orphanItem(),
  projectWedgeItem(),
  deferredItem('docs_size', '文档体积巡检二期再做；口径 A：仅活文档受限、历史档案豁免，本阶段不读 docs/'),
  deferredItem('log_size', '日志体积巡检二期再做，本阶段不读 logs/'),
  deferredItem('event_rows', '事件行数巡检二期再做，走既有 deploy/db-clean.js，本阶段不读 DB')
]

const active = items.filter(function (x) { return x.phase === 'active' })
const summary = { active: active.length, pass: 0, warn: 0, fail: 0, degraded: 0, skipped: 0, deferred: items.length - active.length }
active.forEach(function (x) { if (summary[x.result] != null) summary[x.result]++ })

let exitCode = 0
if (SELF_FAIL || TRUNCATED) exitCode = 2
else if (active.some(function (x) { return x.result === 'fail' || x.result === 'warn' || x.result === 'degraded' })) exitCode = 1

const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  root: ROOT,
  repo: REPO,
  durationMs: durationMs,
  maxSeconds: MAX_SECONDS,
  timeoutTruncated: TRUNCATED,
  exitCode: exitCode,
  alert: exitCode === 0 ? 'none' : 'needs_owner',
  summary: summary,
  items: items
}

function abnormalBody(x) {
  const d = x.detail || {}
  if (x.id === 'project_wedge') { // P2-3 产出审：专属摘要分支（dir/reason 可读）
    if (x.result === 'skipped') return '未判定（' + (d.reason || 'skipped') + '） vs 需 wedge-heal 项目级日志'
    if (d.reason === 'jsonl-parse-fail') return 'jsonl 解析失败（wedge=' + (d.wedgeWarns || 0) + ' infra=' + (d.infraWarns || 0) + '） vs 需日志可解析'
    const w = d.wedgeWarns24h || 0
    const i = d.infraWarns24h || 0
    const recent = (d.recent || []).slice(0, 3).map(function (r) { return (r.dir || '?').split(/[\\/]/).pop() + '[' + (r.reason || '?') + ']' }).join('、')
    return '挂死占锁告警 ' + w + ' 条（' + (recent || '-') + '）+ 探测故障 ' + i + ' 条 vs 需 0 告警（wedge≥3=需重启 serve）'
  }
  if (x.id === 'task_stall') {
    if (x.result === 'fail') {
      const list = d.stalled || []
      const shown = list.slice(0, 3).map(function (s) { return s.id }).join('、')
      const ids = list.length > 3 ? shown + ' 等 ' + list.length + ' 项' : shown
      let maxMin = 0
      list.forEach(function (s) { if ((s.staleMinutes || 0) > maxMin) maxMin = s.staleMinutes || 0 })
      const rule = d.staleRules ? 'stalledMin=' + d.staleRules.stalledMin : '阈值未知'
      return 'stalled=' + list.length + ' 项（' + ids + '，最长静默 ' + maxMin + ' 分钟） vs ' + rule
    }
    if (x.result === 'degraded') {
      return '台账派生降级 ' + (d.reason || 'unknown') + (d.hint ? '（' + d.hint + '）' : '') + ' vs 需可读任务台账'
    }
    if (x.result === 'skipped') {
      return '未判定（' + (d.reason || 'skipped') + '） vs 需 GET /_tasks 返回 200'
    }
    return x.result
  }
  if (x.id === 'eta_overdue') {
    if (x.result === 'warn') {
      const list = d.overdue || []
      const shown = list.slice(0, 3).map(function (s) { return s.id + '(' + (s.overdueMin || 0) + 'm)' }).join('、')
      const ids = (d.total || list.length) > 3 ? shown + ' 等 ' + (d.total || list.length) + ' 项' : shown
      return '已超预计 ' + (d.total || list.length) + ' 项（' + ids + '）待查验 vs 无超时'
    }
    if (x.result === 'skipped') return '未判定（' + (d.reason || 'skipped') + (d.degraded ? '：' + d.degraded : '') + '） vs 需 GET /_tasks 返回 200'
    return x.result
  }
  if (x.id === 'process_alive') {
    if (x.result === 'skipped') return '未判定（' + (d.reason || 'skipped') + '） vs 需端口活或 pid 命中'
    const bad = []
    PORT_ORDER.forEach(function (name) {
      const p = d.ports[name]
      if (p.result === 'fail') bad.push(name + ':' + p.port + ' 端口无响应且无进程')
      else if (p.result === 'warn') bad.push(name + ':' + p.port + ' 端口活但 ps 未命中')
      else if (p.result === 'skipped') bad.push(name + ':' + p.port + ' 跳过（' + (p.reason || '?') + '）')
    })
    if (d.watchdog.result === 'fail') bad.push('watchdog 无 pid 文件且 ps 未命中')
    else if (d.watchdog.result === 'warn') bad.push('watchdog pid 文件不在但 ps 命中')
    if (d.patrolHeartbeat.stale) bad.push('patrol 心跳超龄 ' + d.patrolHeartbeat.ageSeconds + 's')
    else if (d.patrolHeartbeat.missing) bad.push('patrol 心跳文件缺失')
    return (bad.join('；') || '部分服务异常') + ' vs 需端口活或 pid 命中'
  }
  if (x.id === 'injection_size') {
    if (x.result === 'skipped') return '未判定（' + (d.reason || 'skipped') + '） vs 阈值 ' + d.limitBytes + ' bytes'
    const parts = []
    if (d.missing && d.missing.length) parts.push('缺失 ' + d.missing.join('、'))
    if (d.exceeded) parts.push(d.totalBytes + ' bytes')
    else if (!parts.length) parts.push(d.totalBytes + ' bytes')
    return parts.join('；') + ' vs 阈值 ' + d.limitBytes + ' bytes'
  }
  if (x.id === 'aoci_sync') {
    if (x.result === 'skipped') return '未判定（' + (x.detail.reason || 'skipped') + '）'
    return ((x.detail && x.detail.notes && x.detail.notes.join('；')) || x.result) + ' vs 需索引与代码同步'
  }
  if (x.id === 'orphan_reply') {
    if (x.result === 'skipped') return '未判定（' + (d.reason || 'skipped') + (d.stderr ? '：' + d.stderr : '') + '） vs 需 scan-only 可跑'
    const list = d.orphans || []
    const shown = list.slice(0, 3).map(function (o) { return (o.title || o.id) + '(' + o.cls + ',' + o.ageMin + 'm' + (o.gaveUp ? ',已放弃' : '') + ')' }).join('、')
    const ids = list.length > 3 ? shown + ' 等 ' + list.length + ' 项' : shown
    return '悬空 ' + list.length + ' 项（' + ids + '）' + (d.gaveUp ? '，其中 ' + d.gaveUp + ' 项护栏已放弃需人工' : '') + ' vs 无悬空'
  }
  if (x.id === 'chain_check') {
    if (x.result === 'skipped') return '未判定（' + (d.reason || 'skipped') + '） vs 需链路检查点断言可跑'
    const bad = (d.asserts || []).filter(function (a) { return a.result === 'warn' })
    return (bad.map(function (a) { return a.id }).join('、') || x.result) + ' 未过 vs 需链路检查点全过'
  }
  return x.result
}

const ts = localStamp(new Date())
let summaryText
if (exitCode === 0) {
  summaryText = ts + ' 巡检正常（' + active.length + ' 项实检全过 / ' + (items.length - active.length) + ' 项二期未启用）exit=0 耗时' + durationMs + 'ms'
  // task397：有会话在等主人点选提问卡——全过也提一句（不改分级/exit，只让人看见）
  const waiting = active.filter(function (x) { return x.detail && Array.isArray(x.detail.waiting) && x.detail.waiting.length })
    .reduce(function (a, x) { return a.concat(x.detail.waiting) }, [])
  if (waiting.length) {
    summaryText += '\n💬 等主人点选提问卡 ' + waiting.length + ' 个（不是故障，点一下就好）：' + waiting.map(function (w) { return (w.title || w.id) + '「' + (w.q || '') + '」已等 ' + w.ageMin + 'min' }).join('；')
  }
} else {
  const rows = ['⚠ 需决策 ' + ts + ' 巡检异常 exit=' + exitCode + ' 耗时' + durationMs + 'ms']
  active.forEach(function (x) {
    if (x.result !== 'pass') rows.push(x.id + ': ' + abnormalBody(x))
  })
  summaryText = rows.join('\n')
}

try {
  fs.writeFileSync(path.join(TMP, 'report.tmp'), JSON.stringify(report, null, 2) + '\n')
  fs.writeFileSync(path.join(TMP, 'summary.txt'), summaryText + '\n')
  fs.writeFileSync(path.join(TMP, 'exit'), String(exitCode))
} catch (err) {
  process.stderr.write('巡检自身失败：报告生成失败（' + String(err && err.message) + '）\n')
  process.exit(1)
}
NODE_EOF
NODE_RC=$?

if [ "$NODE_RC" -ne 0 ] || [ ! -f "$TMP_DIR/report.tmp" ] || [ ! -f "$TMP_DIR/exit" ] || [ ! -f "$TMP_DIR/summary.txt" ]; then
  echo "巡检自身失败：报告生成异常（node 退出码 $NODE_RC）" >&2
  exit 2
fi

EXIT_CODE=$(cat "$TMP_DIR/exit")
case "$EXIT_CODE" in ''|*[!0-9]*) EXIT_CODE=2; echo "巡检自身失败：退出码异常" >&2 ;; esac

# task126 F2'A：超时主动提醒——把超时任务的 eta 条目 id 逐个交网关 /_nudge（护栏全在网关：重查/冷却/封顶/预算；fire-and-forget 不影响巡检时序与退出码）
if [ "$AUTH_OK" -eq 1 ] && [ -s "$TMP_DIR/nudge.list" ]; then
  while IFS= read -r NUDGE_SID; do
    [ -n "$NUDGE_SID" ] || continue
    curl -s -m 8 -o /dev/null -u "$AUTH" -X POST "http://127.0.0.1:$PORT_PROXY/_nudge" \
      -H 'Content-Type: application/json' -d "{\"sessionId\":\"$NUDGE_SID\"}" 2>/dev/null &
  done < "$TMP_DIR/nudge.list"
  wait 2>/dev/null
fi

DAY_FILE="$PATROL_LOG_DIR/$(date '+%Y-%m-%d').md"
mkdir -p -- "$PATROL_LOG_DIR" 2>/dev/null

# 纠正行：摘要文件能写就落一行，写不进返回 1（不覆盖、不静默）
append_note() {
  [ -n "$DAY_FILE" ] || return 1
  ( printf '%s\n' "$1" >> "$DAY_FILE" ) 2>/dev/null
}

# 报告已落地但最终退出码被后续失败改成 2 时，回填 exitCode/alert 保持一致
patch_report_exit() {
  REPORT_PATH="$REPORT" node - <<'NODE_EOF'
'use strict'
const fs = require('fs')
const p = process.env.REPORT_PATH
try {
  const r = JSON.parse(fs.readFileSync(p, 'utf8'))
  r.exitCode = 2
  r.alert = 'needs_owner'
  fs.writeFileSync(p + '.patch', JSON.stringify(r, null, 2) + '\n')
  fs.renameSync(p + '.patch', p)
} catch (err) {
  process.stderr.write('回填原因：' + String(err && err.message) + '\n')
  process.exit(1)
}
NODE_EOF
}

# 摘要先落盘：即使随后报告/心跳失败，也留得下本轮判定
SUMMARY_OK=0
if ( cat -- "$TMP_DIR/summary.txt" >> "$DAY_FILE" ) 2>/dev/null; then
  SUMMARY_OK=1
else
  EXIT_CODE=2
  echo "巡检自身失败：摘要写入失败（$DAY_FILE）" >&2
fi

# 原子落地：先写临时文件再 mv
if mv -f -- "$TMP_DIR/report.tmp" "$REPORT" 2>/dev/null; then
  REPORT_OK=1
else
  REPORT_OK=0
  EXIT_CODE=2
  # 旧报告会冒充本轮结果，先删掉再报错
  rm -f -- "$REPORT" 2>/dev/null
  echo "巡检自身失败：报告写不出（$REPORT）" >&2
  append_note "⚠ 巡检自身失败：报告写不出（$REPORT）exit=2"
fi

# 摘要没写进文件时，报告里的 exitCode 也要跟着纠正
if [ "$REPORT_OK" -eq 1 ] && [ "$SUMMARY_OK" -eq 0 ]; then
  if ! patch_report_exit; then
    EXIT_CODE=2
    echo "巡检自身失败：报告 exitCode 回填失败（$REPORT）" >&2
  fi
fi

# 只有报告正常落地后才刷新心跳
if [ "$REPORT_OK" -eq 1 ]; then
  if ( printf '%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" > "$HEARTBEAT" ) 2>/dev/null; then
    :
  else
    EXIT_CODE=2
    echo "巡检自身失败：心跳写不出（$HEARTBEAT），下次可能误报超龄" >&2
    append_note "⚠ 巡检自身失败：心跳写不出（$HEARTBEAT）exit=2"
    if ! patch_report_exit; then
      EXIT_CODE=2
      echo "巡检自身失败：报告 exitCode 回填失败（$REPORT）" >&2
    fi
  fi
fi

if [ "$QUIET" -eq 0 ]; then
  cat -- "$TMP_DIR/summary.txt"
fi
exit "$EXIT_CODE"

#!/bin/sh
# task343-fu2 生产断言：模型别名写保护（4097 主口）
# 安全口径（御审 P0/P1）：基线只读检查 → 非空直接 SKIP（不碰真实文件）→ 快照 → 才允许写探针 →
#   成功/失败/INT/TERM 都由 restore 还原；快照失败/未触碰（TOUCHED=0）时 restore 一律 no-op，绝不 rm 真实文件；
#   成功路径用 cmp 校验 live/.bak 与快照一致后才报 PASS；凭据走 umask 077 的 curl rc。
# 用法：sh deploy/prod-alias-guard.sh
set -u
BASE="${LITTLEDJ_ALIAS_BASE:-http://127.0.0.1:4097}"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
AUTH_FILE="${LITTLEDJ_ALIAS_AUTH:-$LJ_ROOT/config/auth.txt}"
CFG="${LITTLEDJ_ALIAS_CFG:-$LJ_ROOT/config/model-alias.json}"
BAK="${LITTLEDJ_ALIAS_BAK:-$CFG.bak}"
TMP="${LITTLEDJ_ALIAS_TMP:-/tmp/lj-alias-prod.$$}"
HAD_LIVE=0
HAD_BAK=0
SNAP_LIVE_OK=0
SNAP_BAK_OK=0
TOUCHED=0

restore() {
  # 只有确实写过真实库才还原；快照失败/未触碰时绝不 rm/cp 真实文件
  [ "$TOUCHED" = 1 ] || return 0
  [ "$SNAP_LIVE_OK" = 1 ] || return 1
  [ "$SNAP_BAK_OK" = 1 ] || return 1
  if [ "$HAD_LIVE" = 1 ]; then cp -p "$TMP.live" "$CFG" || return 1
  else rm -f "$CFG" || return 1; fi
  if [ "$HAD_BAK" = 1 ]; then cp -p "$TMP.bak" "$BAK" || return 1
  else rm -f "$BAK" || return 1; fi
  return 0
}
cleanup() {
  if [ "$TOUCHED" = 1 ]; then
    if restore; then
      rm -f "$TMP.live" "$TMP.bak" 2>/dev/null || true
    else
      echo "FAIL 还原失败：快照保留在 $TMP.live / $TMP.bak，请手动恢复 $CFG / $BAK" >&2
    fi
  else
    rm -f "$TMP.live" "$TMP.bak" "$TMP.live.new" "$TMP.bak.new" 2>/dev/null || true
  fi
  rm -f "$TMP.curlrc" 2>/dev/null || true
}
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap cleanup EXIT

[ -f "$AUTH_FILE" ] || { echo "SKIP 无 auth.txt（非本机运行）"; exit 0; }
OLD_UMASK="$(umask)"
umask 077
printf 'user = "%s"\n' "$(cat "$AUTH_FILE")" > "$TMP.curlrc" || { umask "$OLD_UMASK"; echo "FAIL 无法创建 curlrc"; exit 1; }
umask "$OLD_UMASK"
chmod 600 "$TMP.curlrc" 2>/dev/null || true

get() { curl -s -K "$TMP.curlrc" "$BASE/_model-alias"; }
post() { curl -s -K "$TMP.curlrc" -H 'Content-Type: application/json' -d "$1" "$BASE/_model-alias"; }
code() { curl -s -o /dev/null -w '%{http_code}' -K "$TMP.curlrc" -H 'Content-Type: application/json' -d "$1" "$BASE/_model-alias"; }

# 基线只读：非空直接 SKIP（此时尚未快照/TOUCHED=0，exit 不会写/删真实文件）
BASE_JSON="$(get)"
echo "GET 基线: $BASE_JSON"
if [ -z "$BASE_JSON" ] || ! printf '%s' "$BASE_JSON" | grep -q '"ok":true'; then
  echo "FAIL GET 基线异常（proxy 未起/鉴权失败）" >&2
  exit 1
fi
if ! printf '%s' "$BASE_JSON" | grep -q '"alias":{}'; then
  echo "SKIP 基线非空（主人真实别名在库，拒绝跑破坏性断言；现场未改动）"
  exit 0
fi

# 写前快照：先记 HAD_*（存在性），再 cp 到 .new 后 mv；快照失败直接退出，不碰真实文件
if [ -f "$CFG" ]; then
  HAD_LIVE=1
  cp -p "$CFG" "$TMP.live.new" && mv "$TMP.live.new" "$TMP.live" || { echo "FAIL live 快照失败（未触碰真实库）" >&2; exit 1; }
fi
SNAP_LIVE_OK=1
if [ -f "$BAK" ]; then
  HAD_BAK=1
  cp -p "$BAK" "$TMP.bak.new" && mv "$TMP.bak.new" "$TMP.bak" || { echo "FAIL .bak 快照失败（未触碰真实库）" >&2; exit 1; }
fi
SNAP_BAK_OK=1

# 从这一行起才允许写真实库
TOUCHED=1
R1="$(post '{"alias":{"deepseek/__t343a__":"A","deepseek/__t343b__":"B"}}')"
echo "POST 双探针: $R1"
printf '%s' "$R1" | grep -q '"count":2' || { echo "FAIL 双探针 count!=2" >&2; exit 1; }
printf '%s' "$(get)" | grep -q '__t343a__' || { echo "FAIL GET 复读不到探针" >&2; exit 1; }

HTTP="$(code '{"alias":{}}')"
echo "空覆写无 force HTTP=$HTTP"
[ "$HTTP" = "409" ] || { echo "FAIL 空覆写未被 409 拦截：运行 proxy 可能无守卫" >&2; exit 1; }
printf '%s' "$(get)" | grep -q '__t343b__' || { echo "FAIL 守卫失败后库被改动" >&2; exit 1; }

R2="$(post '{"alias":{},"force":true}')"
echo "force 清空: $R2"
printf '%s' "$R2" | grep -q '"count":0' || { echo "FAIL force 清空失败" >&2; exit 1; }
grep -q '__t343a__' "$BAK" || { echo "FAIL 清空前未留 .bak 备份" >&2; exit 1; }
printf '%s' "$(get)" | grep -q '"alias":{}' || { echo "FAIL 清空后库非空" >&2; exit 1; }

# 成功：显式还原 + cmp 终态校验；失败不报 PASS
restore || { echo "FAIL 还原失败（快照保留在 $TMP.live / $TMP.bak）" >&2; exit 1; }
if [ "$HAD_LIVE" = 1 ]; then cmp -s "$TMP.live" "$CFG" || { echo "FAIL live 还原后与快照不一致" >&2; exit 1; }
else [ ! -f "$CFG" ] || { echo "FAIL live 应不存在但仍在" >&2; exit 1; }; fi
if [ "$HAD_BAK" = 1 ]; then cmp -s "$TMP.bak" "$BAK" || { echo "FAIL .bak 还原后与快照不一致" >&2; exit 1; }
else [ ! -f "$BAK" ] || { echo "FAIL .bak 应不存在但仍在" >&2; exit 1; }; fi

trap - EXIT INT TERM
rm -f "$TMP.live" "$TMP.bak" "$TMP.live.new" "$TMP.bak.new" "$TMP.curlrc" 2>/dev/null || true
echo "PASS 别名写保护全链（写前备份/拒空覆写/force/原子写；live+.bak 快照 cmp 校验还原）"

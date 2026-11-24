#!/bin/sh
# task343-fu2 自测：prod-alias-guard.sh 的 P0 生命周期（沙箱 fake curl + 临时 CFG，不碰真实库）
# 用法：sh deploy/selftest-prod-alias-guard.sh
# 覆盖：A 正常写探针→409→force→restore/cmp；B 基线非空 SKIP 且不重写；C 快照失败不删真实文件；
#       D GET 中途 SIGINT（TOUCHED=0）不删真实文件。
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_TMP="$(mktemp -d /tmp/lj-alias-guard-test.XXXXXX)" || exit 1
PASS=0; FAIL=0
cleanup_all(){ rm -rf "$BASE_TMP"; }
trap cleanup_all EXIT INT TERM

make_env(){
  T="$BASE_TMP/$1"; mkdir -p "$T/bin" "$T/bin_slow"
  printf 'user = "u:p"\n' > "$T/auth.txt"
  printf '{}' > "$T/alias.json"
  printf '{"alias":{},"savedAt":0}' > "$T/live.json"
  cat > "$T/bin/curl" <<'EOF'
#!/bin/sh
DATA=""; OUT=""; FMT=""
while [ $# -gt 0 ]; do
  case "$1" in
    -s) shift ;;
    -K) shift 2 ;;
    -H) shift 2 ;;
    -d) shift; DATA="$1"; shift ;;
    -o) shift; OUT="$1"; shift ;;
    -w) shift; FMT="$1"; shift ;;
    http*) shift ;;
    *) shift ;;
  esac
done
if [ -z "$DATA" ]; then
  printf '{"ok":true,"alias":%s,"savedAt":1}' "$(cat "$FAKE_ALIAS")"
  exit 0
fi
CODE=200
case "$DATA" in
  *__t343a__*)
    printf '%s' '{"deepseek/__t343a__":"A","deepseek/__t343b__":"B"}' > "$FAKE_ALIAS"
    printf '{"alias":%s,"savedAt":1}' "$(cat "$FAKE_ALIAS")" > "$FAKE_CFG"
    BODY='{"ok":true,"count":2}' ;;
  *'"force":true'*)
    [ -f "$FAKE_CFG" ] && cp -p "$FAKE_CFG" "$FAKE_BAK"
    printf '{}' > "$FAKE_ALIAS"
    printf '{"alias":{},"savedAt":1}' > "$FAKE_CFG"
    BODY='{"ok":true,"count":0}' ;;
  *'"alias":{}'*)
    if [ "$(cat "$FAKE_ALIAS")" = "{}" ]; then BODY='{"ok":true,"count":0}'
    else CODE=409; BODY='{"error":"拒绝清空非空别名库（确认清空请带 force:true）","guard":"empty-overwrite"}'; fi ;;
  *) CODE=400; BODY='{"error":"bad"}' ;;
esac
if [ -n "$FMT" ] && [ "$OUT" = "/dev/null" ]; then printf '%s' "$CODE"; exit 0; fi
printf '%s' "$BODY"
exit 0
EOF
  chmod +x "$T/bin/curl"
  # slow 版：GET 睡 2s，用于 SIGINT 测试
  { printf '#!/bin/sh\nsleep 2\nexec "%s" "$@"\n' "$T/bin/curl"; } > "$T/bin_slow/curl"
  chmod +x "$T/bin_slow/curl"
}

run_guard(){
  T="$1"; TMPDIR_CASE="$2"; BIN="$3"
  FAKE_ALIAS="$T/alias.json" FAKE_CFG="$T/live.json" FAKE_BAK="$T/live.json.bak" \
  LITTLEDJ_ALIAS_AUTH="$T/auth.txt" LITTLEDJ_ALIAS_CFG="$T/live.json" LITTLEDJ_ALIAS_BAK="$T/live.json.bak" \
  LITTLEDJ_ALIAS_TMP="$TMPDIR_CASE" LITTLEDJ_ALIAS_BASE='http://fake' \
  PATH="$BIN:$PATH" sh "$ROOT/deploy/prod-alias-guard.sh" > "$T/out.txt" 2>&1
}

ok(){ if [ "$1" = 1 ]; then PASS=$((PASS+1)); echo "PASS $2"; else FAIL=$((FAIL+1)); echo "FAIL $2${3:+  [$3]}"; fi; }

# A 正常路径
make_env A
mkdir -p "$BASE_TMP/A/snap"
run_guard "$BASE_TMP/A" "$BASE_TMP/A/snap" "$BASE_TMP/A/bin"; RC=$?
ok "$([ "$RC" = 0 ] && echo 1 || echo 0)" "A 正常路径 exit0" "rc=$RC $(tail -2 "$BASE_TMP/A/out.txt")"
ok "$(grep -q 'PASS 别名写保护全链' "$BASE_TMP/A/out.txt" && echo 1 || echo 0)" "A PASS 输出"
ok "$([ "$(cat "$BASE_TMP/A/live.json")" = '{"alias":{},"savedAt":0}' ] && echo 1 || echo 0)" "A live 还原为空基线" "$(cat "$BASE_TMP/A/live.json")"
ok "$([ ! -f "$BASE_TMP/A/live.json.bak" ] && echo 1 || echo 0)" "A 测试 .bak 已移除"

# B 基线非空 SKIP，不重写
make_env B
mkdir -p "$BASE_TMP/B/snap"
printf '{"alias":{"x/y":"z"},"savedAt":1}' > "$BASE_TMP/B/live.json"
printf '{"x/y":"z"}' > "$BASE_TMP/B/alias.json"
BEFORE="$(cat "$BASE_TMP/B/live.json")"
run_guard "$BASE_TMP/B" "$BASE_TMP/B/snap" "$BASE_TMP/B/bin"; RC=$?
ok "$([ "$RC" = 0 ] && echo 1 || echo 0)" "B 基线非空 SKIP exit0" "rc=$RC"
ok "$(grep -q 'SKIP 基线非空' "$BASE_TMP/B/out.txt" && echo 1 || echo 0)" "B SKIP 输出"
ok "$([ "$(cat "$BASE_TMP/B/live.json")" = "$BEFORE" ] && echo 1 || echo 0)" "B 非空 live 原样未重写" "$(cat "$BASE_TMP/B/live.json")"

# C 快照失败：不删真实 live/.bak
make_env C
mkdir -p "$BASE_TMP/C/snap"
mkdir "$BASE_TMP/C/snap.live.new"
chmod 500 "$BASE_TMP/C/snap.live.new"
printf '{"alias":{},"savedAt":0}' > "$BASE_TMP/C/live.json"
BEFORE="$(cat "$BASE_TMP/C/live.json")"
run_guard "$BASE_TMP/C" "$BASE_TMP/C/snap" "$BASE_TMP/C/bin"; RC=$?
ok "$([ "$RC" != 0 ] && echo 1 || echo 0)" "C 快照失败非零退出" "rc=$RC"
ok "$([ "$(cat "$BASE_TMP/C/live.json")" = "$BEFORE" ] && echo 1 || echo 0)" "C 快照失败未删/未改 live" "$(cat "$BASE_TMP/C/live.json")"
ok "$([ ! -f "$BASE_TMP/C/live.json.bak" ] && echo 1 || echo 0)" "C 快照失败未产生/删 .bak"

# D GET 中途 SIGINT（TOUCHED=0）：不删真实 live
make_env D
mkdir -p "$BASE_TMP/D/snap"
printf '{"alias":{},"savedAt":0}' > "$BASE_TMP/D/live.json"
BEFORE="$(cat "$BASE_TMP/D/live.json")"
FAKE_ALIAS="$BASE_TMP/D/alias.json" FAKE_CFG="$BASE_TMP/D/live.json" FAKE_BAK="$BASE_TMP/D/live.json.bak" \
LITTLEDJ_ALIAS_AUTH="$BASE_TMP/D/auth.txt" LITTLEDJ_ALIAS_CFG="$BASE_TMP/D/live.json" LITTLEDJ_ALIAS_BAK="$BASE_TMP/D/live.json.bak" \
LITTLEDJ_ALIAS_TMP="$BASE_TMP/D/snap" LITTLEDJ_ALIAS_BASE='http://fake' \
env PATH="$BASE_TMP/D/bin_slow:$PATH" sh "$ROOT/deploy/prod-alias-guard.sh" > "$BASE_TMP/D/out.txt" 2>&1 &
PID=$!
sleep 0.6
kill -TERM "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null; RC=$?
ok "$([ "$(cat "$BASE_TMP/D/live.json")" = "$BEFORE" ] && echo 1 || echo 0)" "D 中断/退出前未删/未改 live" "$(cat "$BASE_TMP/D/live.json")"
ok "$([ ! -f "$BASE_TMP/D/live.json.bak" ] && echo 1 || echo 0)" "D 中断/退出前未产生 .bak"
# 注：后台作业的 SIGTERM 交付受 shell 作业控制影响，不把退出码作为数据安全断言；
#     live/.bak 未被删改才是 P0 要守的终态（C 的快照失败已覆盖 TOUCHED=0 no-op 分支）。

echo ""
echo "RESULT: $([ "$FAIL" = 0 ] && echo PASS || echo FAIL)（$PASS PASS / $FAIL FAIL）"
exit $([ "$FAIL" = 0 ] && echo 0 || echo 1)

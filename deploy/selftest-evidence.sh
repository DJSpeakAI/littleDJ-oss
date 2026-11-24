#!/bin/sh
# task238 自测：证据化交付收集器（临时 RUNROOT 沙箱，不污染真实证据目录）
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/lj-evidence-selftest-$$"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
FAIL=0
ok(){ echo "PASS $1"; }
bad(){ echo "FAIL $1"; FAIL=$((FAIL+1)); }

OUT="$(LITTLEDJ_ROOT="$TMP" sh "$ROOT/deploy/evidence.sh" \
  --task taskTEST \
  --unverified "手机竖屏未验" \
  -- "sh -c 'echo 自测回显样例; exit 0'" 2>&1)"
SUM="$(printf '%s\n' "$OUT" | tail -1)"
[ -f "$SUM" ] && ok "生成 SUMMARY.md（$SUM）" || bad "未生成 SUMMARY.md：$OUT"
DIR="$(dirname "$SUM")"
[ -f "$DIR/00-meta.txt" ] && ok "00-meta.txt 存在" || bad "00-meta 缺失"
[ -f "$DIR/01-diff.txt" ] && ok "01-diff.txt 存在" || bad "01-diff 缺失"
grep -q "自测回显样例" "$DIR/02-tests.txt" 2>/dev/null && ok "02-tests 捕获自测输出" || bad "02-tests 未捕获输出"
grep -q "\[exit code\] 0" "$DIR/02-tests.txt" 2>/dev/null && ok "02-tests 记录退出码" || bad "退出码未记录"
grep -q "① 改了什么" "$SUM" && grep -q "② 自测回显" "$SUM" && grep -q "③ 真机证据" "$SUM" && grep -q "④ 未验证项" "$SUM" \
  && ok "SUMMARY 四件套齐" || bad "SUMMARY 四件套不全"
grep -q "手机竖屏未验" "$SUM" && ok "--unverified 写入未验证项" || bad "--unverified 丢失"
# 未填未验证项时必须显式报警（缺证据=未完成）
OUT2="$(LITTLEDJ_ROOT="$TMP" sh "$ROOT/deploy/evidence.sh" --task taskNOUNV 2>&1 | tail -1)"
grep -q "缺此项视为交付未完成" "$OUT2" 2>/dev/null && ok "未填未验证项时显式报警" || bad "未验证项缺失未报警"
# 失败命令必须把退出码带出来
OUT3="$(LITTLEDJ_ROOT="$TMP" sh "$ROOT/deploy/evidence.sh" --task taskFAIL -- "sh -c 'exit 7'" 2>&1 | tail -1)"
grep -q "7" "$OUT3" 2>/dev/null && ok "自测失败退出码上屏" || bad "失败退出码未上屏"
# 截图缺失要标注（设备沙箱无截屏权限的如实边界）
OUT4="$(LITTLEDJ_ROOT="$TMP" sh "$ROOT/deploy/evidence.sh" --task taskSHOT --shot /nope/x.png 2>&1 | tail -1)"
grep -q "\[缺失\]/nope/x.png" "$OUT4" 2>/dev/null && ok "截图缺失如实标注" || bad "截图缺失未标注"
# 语法
sh -n "$ROOT/deploy/evidence.sh" && ok "sh -n 语法 OK" || bad "sh -n 语法错误"

echo ""
[ "$FAIL" -eq 0 ] && echo "RESULT: PASS（证据收集器自测全绿）" || echo "RESULT: FAIL（$FAIL 项）"
exit "$FAIL"

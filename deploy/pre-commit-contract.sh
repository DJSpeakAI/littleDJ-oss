#!/bin/sh
# deploy/pre-commit-contract.sh —— P1.5 契约自动化闸门（由 .git/hooks/pre-commit 调用）
#
# 做什么（PLAN-contract.md §5 L4「部署钩子」的落地）：
#   1) staged 里有 ui/src/**/*.js 或 ui/index.html → 先重跑 gen-manifest.js（自动更新 MANIFEST）
#   2) 重跑后 MANIFEST 有变化 → 自动 git add（这一次提交就带上）
#   3) 跑 check-contract.js（C1–C11），非 0 则拒绝提交
#
# 为什么：契约的单一真相是模块首行，MANIFEST 只能由脚本生成；人（和 AI）不可能记得每次跑。
#   把「记得跑」变成「不跑就提交不了」，契约才不会腐烂。
#
# 绕过（不推荐，会在日志里留痕）：git commit --no-verify
set -u

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$REPO" || exit 0
command -v node >/dev/null 2>&1 || { echo "· [契约闸门] 环境无 node，跳过" >&2; exit 0; }
[ -f deploy/gen-manifest.js ] && [ -f deploy/check-contract.js ] || exit 0
[ -d ui/src ] || exit 0

TMP_GEN="${TMPDIR:-/tmp}/dsh-gen-contract.$$"
TMP_CHK="${TMPDIR:-/tmp}/dsh-check-contract.$$"

staged="$(git diff --cached --name-only 2>/dev/null)"
touch_ui=0
printf '%s\n' "$staged" | grep -Eq '^ui/(index\.html|src/.*\.(js|ts))$' && touch_ui=1

if [ "$touch_ui" -eq 1 ]; then
  if ! node deploy/gen-manifest.js >"$TMP_GEN" 2>&1; then
    echo "✗ [契约闸门] MANIFEST 生成失败："
    cat "$TMP_GEN"
    rm -f "$TMP_GEN" "$TMP_CHK"
    exit 1
  fi
  # 注：ui/MANIFEST.md 在 P1.5 时仍可能是 untracked（git diff 对它恒为空），
  #     所以这里不做 diff 判断，直接 add —— 重生后的内容就是权威版本。
  if git add ui/MANIFEST.md 2>/dev/null; then
    echo "· [契约闸门] 检测到 ui 变更：已自动重生并暂存 ui/MANIFEST.md"
  fi
fi

if ! node deploy/check-contract.js >"$TMP_CHK" 2>&1; then
  echo "✗ [契约闸门] 契约校验失败，提交被拒："
  cat "$TMP_CHK"
  echo "  修法：改模块首行 → node deploy/gen-manifest.js → node deploy/check-contract.js"
  rm -f "$TMP_GEN" "$TMP_CHK"
  exit 1
fi

echo "· [契约闸门] C1–C11 通过"
rm -f "$TMP_GEN" "$TMP_CHK"
exit 0

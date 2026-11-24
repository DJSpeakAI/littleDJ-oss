#!/bin/sh
# deploy/pre-commit-lock.sh —— pre-commit 热点文件写锁闸门（task230 · v0.231.0.0）
#
# 用途：git commit 的技术强制闸——staged 文件若被 .taskqueue/locks/ 里任一任务锁占用
#       （RULES §热点文件写锁令牌），且提交者不是持锁牌号，提交直接拒绝。
#       无锁文件零侵入放行（不改变既有无锁流程）。
#
# 安装（.git/hooks/ 不入库，装完留档）：
#   cp deploy/pre-commit-lock.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
#
# 持锁本人提交法：
#   TASK_ID=<牌号> git commit -m "..."        # 牌号须与锁内 holder= 逐字一致
#
# 幽灵锁（锁龄 > LOCK_TTL_MINUTES，默认 20 分钟，同 deploy/lock.sh M1 判据）：
#   本闸门【仍拦截、绝不自动绕过】——ghost 处置属 M2 三证流程（lock.sh 头注释）。
#   先核验：sh deploy/lock.sh read <slug>；确属幽灵再人工 release，然后重新提交。
#
# 环境变量：
#   LOCK_DIR            锁目录（默认 <repo>/.taskqueue/locks；自测指到 /tmp 假目录）
#   LOCK_TTL_MINUTES    幽灵判定阈值（默认 20）
#   TASK_ID             当前提交对应的任务牌号（与 holder 匹配即放行）
#
# slug 约定（RULES §77）：文件路径中 `/` `.` 空格 一律换 `-`，如 ui/index.html → ui-index-html。

set -u

REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0   # 不在 git 仓库：不拦
LOCK_DIR="${LOCK_DIR:-$REPO/.taskqueue/locks}"
TTL_MIN="${LOCK_TTL_MINUTES:-20}"
TASK_ID="${TASK_ID:-}"

staged="$(git -c core.quotePath=false diff --cached --name-only 2>/dev/null)"  # quotePath=false：中文文件名原样输出（task230 实弹验证坑）
[ -n "$staged" ] || exit 0                                       # 无暂存：无意见

blocked=0
now_epoch="$(date +%s)"
TMP_LIST="$(mktemp /tmp/precommit-staged.XXXXXX)" || exit 0
trap 'rm -f "$TMP_LIST"' EXIT
printf '%s\n' "$staged" > "$TMP_LIST"

# 重定向输入（非管道）：while 跑在当前 shell，blocked 无需跨进程传递
while IFS= read -r f; do
  [ -n "$f" ] || continue
  slug="$(printf '%s' "$f" | sed 's|[/ .]|-|g')"
  lf="$LOCK_DIR/$slug.lock"
  [ -f "$lf" ] || continue

  holder="$(sed -n 's/^holder=//p' "$lf" 2>/dev/null | head -n 1)"
  if [ -n "$TASK_ID" ] && [ "$TASK_ID" = "$holder" ]; then
    continue                                                      # 持锁本人：放行
  fi

  mtime="$(stat -c %Y "$lf" 2>/dev/null || echo 0)"
  age=$(( (now_epoch - mtime) / 60 ))
  ghost="no"
  [ "$age" -gt "$TTL_MIN" ] 2>/dev/null && ghost="yes"

  echo "✗ [写锁闸门] $f 被任务锁占用：holder=${holder:-?} 锁龄=${age}min ghost_suspect=$ghost" >&2
  if [ "$ghost" = "yes" ]; then
    echo "  锁已超 ${TTL_MIN} 分钟疑似幽灵：先核验 sh deploy/lock.sh read $slug；确属幽灵再人工 release，勿绕锁。" >&2
  fi
  echo "  持锁牌本人提交：TASK_ID=${holder:-?} git commit ..." >&2
  blocked=1
done < "$TMP_LIST"

# task246：跨机 claim 锁（git 仲裁）——上面的文件锁只管「本仓库内提交的人」，
# 管不到外部写入者（DJH/Windows）、DevEco Code、另一台机器上的会话；这里补一道远端 claim 检查。
# 行为：staged 文件的 slug 被「其它机器/会话」持有 → 直接拒绝提交（holder 会回显）。
# 离线时 fetch 失败 → 用已缓存的 origin 引用判（宁可漏拦，不阻断正常工作），不视为错误。
if [ -f "$REPO/deploy/claim.js" ] && command -v node >/dev/null 2>&1; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    slug="$(printf '%s' "$f" | sed 's|[/ .]|-|g')"
    claim_out="$(cd "$REPO" && node deploy/claim.js check "$slug" 2>&1)"
    claim_rc=$?
    if [ "$claim_rc" -eq 1 ]; then
      echo "✗ [跨机 claim 闸门] $f 被其它机器/会话持有：$claim_out" >&2
      echo "  等工作结束让对方 node deploy/claim.js release $slug，或换文件；禁强拆他人锁（--force 需主人同意）。" >&2
      blocked=1
    fi
  done < "$TMP_LIST"
fi

if [ "$blocked" -ne 0 ]; then
  echo "提交被拒（RULES §热点文件写锁令牌 · deploy/pre-commit-lock.sh）" >&2
  exit 1
fi
exit 0

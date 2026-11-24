#!/bin/sh
# task238（2026-11-12）：证据化交付收集器——把「改了什么 / 自测回显 / 真机断言 / 未验证项」四件套
# 一次性收进一个目录并生成 SUMMARY.md，供大管家直接贴进回执（主人定规：缺证据的「已修复」= 未完成）。
#
# 用法（在仓库根跑）：
#   sh deploy/evidence.sh --task task238 \
#     --suite newproj \                       # 可选：调页内自检机器人（task239 起，真浏览器断言）
#     --shot /path/截图.png \                  # 可多次；截图须外部裁判提供（设备沙箱无截屏权限）
#     --unverified "手机竖屏未验" \             # 可多次：明确写「我没验什么」
#     -- "node deploy/selftest-dirpicker.js"   # 自测命令（原样交给 sh -c）
#
# 产出：$LITTLEDJ_ROOT/run/evidence/<时间>-<任务>/（运行根，不入 git）
#   00-meta.txt     时间 / HEAD / 分支 / git status（脏文件清单）
#   01-diff.txt     本次改动 diff --stat 与未提交 diff 摘要
#   02-tests.txt    自测命令 + 输出尾部 + exit code
#   03-selftest.json 页内自测报告（有 --suite 且机器人可用时）
#   04-shots/       拷贝进来的截图
#   SUMMARY.md      四件套汇总（回执直接贴这段）
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LJ_REPO="$ROOT"
. "$LJ_REPO/deploy/runtime-root.sh"
RUNROOT="$LJ_ROOT"
BASE="${LITTLEDJ_BASE:-http://127.0.0.1:4097}"

TASK=""; SUITE=""; SHOTS=""; UNVER=""; TESTS=""
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASK="${2:-}"; shift 2 ;;
    --suite) SUITE="${2:-}"; shift 2 ;;
    --shot) SHOTS="$SHOTS|${2:-}"; shift 2 ;;
    --unverified) UNVER="$UNVER|${2:-}"; shift 2 ;;
    --) shift; TESTS="$*"; break ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$1（--help 看用法）" >&2; exit 2 ;;
  esac
done

TS="$(date +%Y%m%d-%H%M%S)"
[ -z "$TASK" ] && TASK="task$(date +%H%M)"
DIR="$RUNROOT/run/evidence/$TS-$TASK"
mkdir -p "$DIR/04-shots" || exit 1

HEAD_SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
DIRTY="$(git -C "$ROOT" status --porcelain 2>/dev/null | head -40)"

{
  echo "# 证据元信息"
  echo "- 时间：$(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "- 任务：$TASK"
  echo "- 仓库：$ROOT"
  echo "- 分支：$BRANCH  HEAD：$HEAD_SHA"
  echo "- 运行根：$RUNROOT"
  echo ""
  echo "## git status（工作区）"
  if [ -n "$DIRTY" ]; then echo "$DIRTY"; else echo "(clean)"; fi
} > "$DIR/00-meta.txt"

{
  echo "# 改动摘要"
  echo ""
  echo "## 未提交改动 --stat"
  git -C "$ROOT" diff --stat 2>/dev/null | tail -30
  echo ""
  echo "## 最近一次提交"
  git -C "$ROOT" log -1 --stat --pretty='%h %ad %s' --date=iso 2>/dev/null | head -25
} > "$DIR/01-diff.txt"

TEST_EXIT="skipped"
: > "$DIR/02-tests.txt"
if [ -n "$TESTS" ]; then
  echo "\$ $TESTS" >> "$DIR/02-tests.txt"
  OUT="$(cd "$ROOT" && sh -c "$TESTS" 2>&1)"; TEST_EXIT=$?
  echo "$OUT" | tail -80 >> "$DIR/02-tests.txt"
  echo "" >> "$DIR/02-tests.txt"
  echo "[exit code] $TEST_EXIT" >> "$DIR/02-tests.txt"
fi

ST_JSON=""
if [ -n "$SUITE" ]; then
  if [ -f "$ROOT/deploy/selftest-browser.js" ]; then
    ST_JSON="$(cd "$ROOT" && node deploy/selftest-browser.js --suite "$SUITE" --base "$BASE" --json 2>&1)"
    printf '%s\n' "$ST_JSON" > "$DIR/03-selftest.json"
  else
    echo '{"skipped":"页内自检机器人未安装（task239 起提供）"}' > "$DIR/03-selftest.json"
  fi
fi

SHOT_LIST=""
OLDIFS="$IFS"; IFS='|'
for s in $SHOTS; do
  [ -z "$s" ] && continue
  if [ -f "$s" ]; then
    cp "$s" "$DIR/04-shots/$(basename "$s")" 2>/dev/null && SHOT_LIST="$SHOT_LIST $DIR/04-shots/$(basename "$s")"
  else
    SHOT_LIST="$SHOT_LIST [缺失]$s"
  fi
done
IFS="$OLDIFS"

{
  echo "# 交付回执 · 证据四件套（$TASK）"
  echo ""
  echo "**① 改了什么**"
  echo '```'
  git -C "$ROOT" diff --stat 2>/dev/null | tail -20
  echo '```'
  echo ""
  echo "**② 自测回显**（命令 + 尾部 + 退出码）"
  echo "- 命令：\`${TESTS:-（未提供）}\`"
  echo "- 退出码：**$TEST_EXIT**"
  echo '```'
  sed -n '1,60p' "$DIR/02-tests.txt"
  echo '```'
  echo ""
  echo "**③ 真机证据**"
  if [ -n "$SUITE" ]; then
    echo "- 页内自检（真浏览器）：\`$DIR/03-selftest.json\`"
    head -c 1200 "$DIR/03-selftest.json" 2>/dev/null
    echo ""
  else
    echo "- 页内自检：未跑（加 \`--suite <名字>\` 可跑）"
  fi
  echo "- 截图：${SHOT_LIST:-（无；设备沙箱无截屏权限，需外部裁判提供）}"
  echo ""
  echo "**④ 未验证项（明确写出来，别含糊）**"
  IFS='|'
  for u in $UNVER; do [ -n "$u" ] && echo "- $u"; done
  IFS="$OLDIFS"
  [ -z "$UNVER" ] && echo "- （未填写！按 RULES §20，缺此项视为交付未完成）"
  echo ""
  echo "---"
  echo "目录：$DIR"
} > "$DIR/SUMMARY.md"

echo "$DIR/SUMMARY.md"

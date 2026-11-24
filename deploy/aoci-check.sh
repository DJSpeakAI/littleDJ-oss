#!/bin/sh
# AOCI 索引对账（只读）——「索引有没有烂/有没有漏刷」的自动检测
# 三项对账：
#   1) 覆盖对账：REPO(server/*.js、deploy/*.sh、deploy/*.js、ui/index.html) + ROOT(config/prompts/*.md)
#      逐文件 grep AOCI_INDEX.md 有无条目（双根结构：REPO=git 仓，ROOT=运行根，两者不重叠）
#   2) 涉改对账：AOCI 头部锚点「> 最近同步: <hash> 日期」vs git log <hash>..HEAD -- server deploy ui
#      有新涉改提交且未重新定标 → warn「涉改未刷新」；锚点缺失/不可解析 → warn（禁止静默全绿）
#   3) 未提交对账：git status --porcelain -- server deploy ui 非空 → warn（工作区改动索引看不见）
# git 缺失（PATH 盲区，2026-11-05 setsid 事故同源）→ 第 2/3 项 skip 不误报
# 红线：只读判定，绝不修改 AOCI_INDEX.md；修复永远由收尾动作完成
# 用法：aoci-check.sh            人读明细
#       aoci-check.sh --patrol   机器读（首行 result=pass|warn|skip，供 patrol.sh 第 7 项）
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
AOCI="$REPO/AOCI_INDEX.md"
MODE="${1:-}"

# git 兜底：桌面/沙箱外环境 PATH 可能无 git（同 setsid 事故教训）
GIT_BIN="$(command -v git 2>/dev/null || true)"
if [ -z "$GIT_BIN" ]; then
  for c in /usr/bin/git /bin/git /system/bin/git; do
    [ -x "$c" ] && { GIT_BIN="$c"; break; }
  done
fi

warn=0; skip=0; detail=""

say() { detail="${detail}$1
"; }

[ -f "$AOCI" ] || { echo "AOCI_INDEX.md 不存在"; exit 1; }

# 1) 覆盖对账（不依赖 git）
missing=""
for f in "$REPO"/server/*.js "$REPO"/deploy/*.sh "$REPO"/deploy/*.js "$REPO"/ui/index.html; do
  [ -f "$f" ] || continue
  b=$(basename "$f")
  grep -q "$b" "$AOCI" || missing="$missing $b"
done
# ROOT 侧白名单（只查 AOCI 已登记口径的注入文件；prompts 目录塞非代码文件不误报）
for b in worldview.md boot.md; do
  f="$ROOT/config/prompts/$b"
  [ -f "$f" ] || continue
  grep -q "$b" "$AOCI" || missing="$missing $b"
done
if [ -n "$missing" ]; then
  warn=1
  say "覆盖缺失:$missing"
fi

# 2) 涉改对账（依赖 git + 锚点行）
if [ -z "$GIT_BIN" ]; then
  skip=1
  say "涉改对账:skip(无 git)"
else
  anchor=$(grep -m1 -E '^> *最近同步:' "$AOCI" 2>/dev/null | sed -n 's/^> *最近同步: *\([0-9a-fA-F]\{7,40\}\).*/\1/p')
  if [ -z "$anchor" ]; then
    warn=1
    say "涉改对账:锚点行缺失或格式不识别（需「> 最近同步: <hash> 日期」）"
  else
    if ! "$GIT_BIN" -C "$REPO" cat-file -e "$anchor^{commit}" 2>/dev/null; then
      warn=1
      say "涉改对账:锚点 hash 无效($anchor)"
    else
      changed=$("$GIT_BIN" -C "$REPO" log "$anchor..HEAD" --name-only --pretty=format: -- server deploy ui 2>/dev/null | sed '/^$/d' | sort -u)
      if [ -n "$changed" ]; then
        warn=1
        say "涉改未刷新:$(printf '%s' "$changed" | tr '\n' ' ')"
      fi
    fi
  fi
fi

# 3) 未提交对账（依赖 git）
if [ -z "$GIT_BIN" ]; then
  say "未提交对账:skip(无 git)"
else
  dirty=$("$GIT_BIN" -C "$REPO" status --porcelain -- server deploy ui 2>/dev/null)
  if [ -n "$dirty" ]; then
    warn=1
    say "工作区有未提交源码改动（索引对账不覆盖未提交内容）"
  fi
fi

if [ "$MODE" = "--patrol" ]; then
  if [ "$warn" -eq 1 ]; then result="warn"; elif [ "$skip" -eq 1 ]; then result="skip"; else result="pass"; fi
  printf 'result=%s\n%s' "$result" "$detail"
else
  printf '== AOCI 对账 ==\n%s' "$detail"
  if [ "$warn" -eq 1 ]; then echo '结论: WARN（见上，收尾刷新 AOCI 后消警）'; else echo '结论: 全绿'; fi
fi
[ "$warn" -eq 1 ] && exit 1
exit 0

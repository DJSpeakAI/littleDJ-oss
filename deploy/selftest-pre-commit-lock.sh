#!/bin/sh
# deploy/selftest-pre-commit-lock.sh —— 写锁闸门自测（task230 · v0.231.0.0）
# 五场景（/tmp 假仓库 + 假锁目录，零污染真仓库）：
#   ① 无锁 staged → 放行 exit 0
#   ② 有锁无 TASK_ID → 拒 exit 1 且 stderr 含 holder=task999
#   ③ 有锁 TASK_ID=holder → 放行 exit 0
#   ④ 幽灵锁（mtime 30 分钟前）→ 拒 exit 1 且 stderr 含 ghost 提示
#   ⑤ 带空格文件名（docs/xx yy.md）→ 锁命中不误放（slug 空格转 -）
set -u
REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
GATE="$REPO/deploy/pre-commit-lock.sh"
TS="$(mktemp -d /tmp/lk-gate-selftest.XXXXXX)"
TS_LOCKS="$TS/locks"
mkdir -p "$TS_LOCKS"
git init -q "$TS/repo" || { echo "FAIL: git init"; exit 1; }

pass=0; fail=0
run_case() { # $1=名 $2=期望码 其余=环境（KEY=VAL 前缀由调用方控制）
  name="$1"; want="$2"; shift 2
  got=0; out=$("$@" 2>&1 >/dev/null) || got=$?
  if [ "$got" -eq "$want" ]; then pass=$((pass+1)); echo "PASS ①$name (exit=$got)"
  else fail=$((fail+1)); echo "FAIL ①$name 期望 exit=$want 实得 exit=$got"; echo "$out" | sed 's/^/    /'
  fi
}

# 场景①：无锁
mkdir -p "$TS/repo/ui" && echo x > "$TS/repo/ui/index.html" && git -C "$TS/repo" add ui/index.html
run_case "无锁放行" 0 sh -c "cd '$TS/repo' && LOCK_DIR='$TS_LOCKS' sh '$GATE'"

# 场景②：有锁、无 TASK_ID
printf 'holder=task999\nacquiredAt=2026-11-11 23:00:00\nfiles=ui/index.html\n' > "$TS_LOCKS/ui-index-html.lock"
out=$(cd "$TS/repo" && LOCK_DIR="$TS_LOCKS" sh "$GATE" 2>&1 >/dev/null); rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'holder=task999'; then pass=$((pass+1)); echo "PASS ②有锁无TASK_ID拒绝+提示holder"
else fail=$((fail+1)); echo "FAIL ② rc=$rc out=$out"; fi

# 场景③：TASK_ID=holder
run_case "持锁本人放行" 0 sh -c "cd '$TS/repo' && LOCK_DIR='$TS_LOCKS' TASK_ID=task999 sh '$GATE'"

# 场景④：幽灵锁（mtime 拨回 30 分钟前；本机 touch -d 不认相对日期，用 node utimesSync）
node -e "const fs=require('fs'),t=new Date(Date.now()-30*60000);fs.utimesSync(process.argv[1],t,t)" "$TS_LOCKS/ui-index-html.lock" 2>/dev/null
out=$(cd "$TS/repo" && LOCK_DIR="$TS_LOCKS" sh "$GATE" 2>&1 >/dev/null); rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'ghost_suspect=yes' && printf '%s' "$out" | grep -q '疑似幽灵'; then pass=$((pass+1)); echo "PASS ④幽灵锁拒绝+ghost提示"
else fail=$((fail+1)); echo "FAIL ④ rc=$rc out=$out"; fi

# 场景⑤：带空格文件名
rm -f "$TS_LOCKS/ui-index-html.lock"
touch "$TS_LOCKS/ui-index-html.lock"   # 重置回新鲜锁，仍占用
mkdir -p "$TS/repo/docs" && echo y > "$TS/repo/docs/xx yy.md" && git -C "$TS/repo" add "docs/xx yy.md"
printf 'holder=task888\nacquiredAt=2026-11-11 23:00:00\nfiles=docs/xx yy.md\n' > "$TS_LOCKS/docs-xx-yy-md.lock"
out=$(cd "$TS/repo" && LOCK_DIR="$TS_LOCKS" sh "$GATE" 2>&1 >/dev/null); rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'holder=task888'; then pass=$((pass+1)); echo "PASS ⑤带空格文件名锁命中"
else fail=$((fail+1)); echo "FAIL ⑤ rc=$rc out=$out"; fi
rm -f "$TS_LOCKS/ui-index-html.lock" "$TS_LOCKS/docs-xx-yy-md.lock"   # 清遗留，防污染后续场景

# 场景⑥：中文文件名（本项目牌全中文；quotePath 默认会转义致 slug 失配——task230 实弹坑）
printf 'holder=task777\nacquiredAt=2026-11-11 23:00:00\nfiles=牌\n' > "$TS_LOCKS/-taskqueue-task229-1111-APIKey设置页-md.lock"
mkdir -p "$TS/repo/.taskqueue" && echo z > "$TS/repo/.taskqueue/task229-1111-APIKey设置页.md"
git -C "$TS/repo" add ".taskqueue/task229-1111-APIKey设置页.md"
out=$(cd "$TS/repo" && LOCK_DIR="$TS_LOCKS" sh "$GATE" 2>&1 >/dev/null); rc=$?
if [ "$rc" -eq 1 ] && printf '%s' "$out" | grep -q 'holder=task777'; then pass=$((pass+1)); echo "PASS ⑥中文文件名锁命中"
else fail=$((fail+1)); echo "FAIL ⑥ rc=$rc out=$out"; fi

rm -rf "$TS"
echo "----"
echo "selftest-pre-commit-lock: $pass pass / $fail fail"
[ "$fail" -eq 0 ] || exit 1
exit 0

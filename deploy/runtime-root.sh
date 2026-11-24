# deploy/runtime-root.sh —— 运行根统一解析（task400）。被 source：不直接执行、不从交互 shell source。
# 用法（调用方先算好仓库根，再 source，再取值）：
#   LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
#   . "$LJ_REPO/deploy/runtime-root.sh"
#   ROOT="$LJ_ROOT"
# 优先级与 server/paths.js 一致：LITTLEDJ_ROOT 覆盖 > 旧家（主目录下的 littleDJ，哨兵 config/auth.txt）> 新家 <仓库>/runtime（同哨兵）。
# 新家另加一道闸：仓库不在当前 HOME 之下（HOME 被改写成沙箱）时不可选——自测沙箱不会落到真实运行根。
# 两家都没哨兵 = exit 2：任何入口不得自建空运行根。约定：先 source，再做任何 mkdir -p。
# 旧家回落是兼容期（task400），观察 3 天后由 task401 删除。
# 调用方必须先设 LJ_REPO（仓库根），没设就是接线错误——直接报错，不猜
[ -n "${LJ_REPO:-}" ] || { echo "runtime-root.sh：调用方没先设 LJ_REPO（仓库根）" >&2; exit 2; }
LJ_HOME="${HOME:-/storage/Users/currentUser}"
LJ_NEW="$LJ_REPO/runtime"
LJ_OLD="$LJ_HOME/littleDJ"
LJ_NEW_OK=0
case "$LJ_REPO/" in "$LJ_HOME"/*) LJ_NEW_OK=1 ;; esac
if [ -n "${LITTLEDJ_ROOT:-}" ]; then
  LJ_ROOT="$LITTLEDJ_ROOT"
elif [ -f "$LJ_OLD/config/auth.txt" ]; then
  LJ_ROOT="$LJ_OLD"
elif [ "$LJ_NEW_OK" = 1 ] && [ -f "$LJ_NEW/config/auth.txt" ]; then
  LJ_ROOT="$LJ_NEW"
else
  echo "运行根不存在：$LJ_OLD 与 $LJ_NEW 都没有 config/auth.txt——拒绝自建空根（从备份恢复，或用 LITTLEDJ_ROOT 指定）" >&2
  exit 2
fi
# 只有「启动类」入口才需要调（缺凭据即拒启、永不写默认口令）： lj_require_root || exit 2
lj_require_root() { [ -f "$LJ_ROOT/config/auth.txt" ]; }

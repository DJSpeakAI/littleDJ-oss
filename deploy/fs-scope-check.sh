#!/bin/sh
# task72 S2 · /_fs/home 只读通道越权断言（19 条基准 + 补充 20-25）
# 用法：sh deploy/fs-scope-check.sh          （本机无 bash，/bin/sh 为唯一 shell，故用 POSIX sh）
# 可选：B=http://127.0.0.1:4097 sh deploy/fs-scope-check.sh
# 纪律：
#   1) 全部只读探测；测试物一律自建自清（trap 清理只删本脚本创建的 fstest-* 项）；
#   2) 硬链接用例只用自建源文件，绝不 ln/rm 真实 auth.txt；
#   3) 任一 FAIL → exit 1（禁用改期望值迁就实现）。
set -u

# PATH 兜底（★2026-11-08 随 restart-serve 同源修复）：本脚本 13 处 node -e，
# 桌面域（文件管理器/HiShell zsh）PATH 不含 node → 全部用例假失败。
PATH="/bin:/usr/bin:$PATH:/data/service/hnp/hmos-clt.org/hmos-clt_1.0.0/node/bin:/storage/Users/currentUser/npm/bin:$HOME/npm/bin"
export PATH

B=${B:-http://127.0.0.1:4097}
H=/storage/Users/currentUser
P=$H/project/littleDJ
W=$P
LJ_REPO="$P"
. "$LJ_REPO/deploy/runtime-root.sh"
RREL="${LJ_ROOT#$H/}"
AUTH_FILE="$LJ_ROOT/config/auth.txt"

TB1=$HOME/fstest-hl1.txt
TB2=$HOME/fstest-hl2.txt
TBSRC=$HOME/fstest-hlsrc.txt
TKEY=$HOME/fstest-dummy.key
TUPPER=$HOME/FSTEST.KEY
TFULL=$HOME/ａｕｔｈ．ｔｘｔ
TPNG=$HOME/fstest-pixel.png
TBIG=$HOME/fstest-big.txt
TMANY=$HOME/fstest-many
TLINK=$HOME/fstest-link

PASS=0
FAILN=0
SKIPN=0
FAILED=""

cleanup() {
  rm -f "$TB1" "$TB2" "$TBSRC" "$TKEY" "$TUPPER" "$TFULL" "$TPNG" "$TBIG" 2>/dev/null
  rm -rf "$TMANY" 2>/dev/null
  if [ -L "$TLINK" ]; then rm -f "$TLINK" 2>/dev/null; fi
  return 0
}
trap cleanup EXIT INT TERM

cleanup   # 先清可能残留的自建项
if [ ! -r "$AUTH_FILE" ]; then
  echo "FAIL  无法读取鉴权文件：$AUTH_FILE"
  exit 1
fi
AUTH=$(cat "$AUTH_FILE")

c() { curl -s -o /dev/null -w '%{http_code}' -u "$AUTH" "$@"; }   # 只取状态码
j() { curl -s -u "$AUTH" "$@"; }                                   # 取响应体
enc() { node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$1"; }

ok() { PASS=$((PASS + 1)); echo "PASS  #$1  $2"; }
ng() { FAILN=$((FAILN + 1)); FAILED="$FAILED #$1"; echo "FAIL  #$1  $2  期望=$3 实际=$4"; }
eq() { if [ "$4" = "$3" ]; then ok "$1" "$2"; else ng "$1" "$2" "$3" "$4"; fi; }

# 旧端点 /_fs/list 改前基线（2026-11-06 S2 落码前实测，name|dir 全集与顺序；size 不纳入比对，避免文档合法编辑误报）
# task344 基线同步：backup|d 退役（考古快照清理）、config|d 入列（skills.json 活配置）、locks|d 入列（claim 锁说明，task246）、run|d 清除（历史误写，未入列）
# task381 基线同步：AGENTS.md|f 入列（2026-11-18 创建的运行时注入文件已入 git，实际目录 31→32 项）
BASE15='[".bitfun|d",".deveco|d",".git|d",".hvigor|d",".idea|d",".taskqueue|d","AppScope|d","config|d","deploy|d","docs|d","entry|d","hvigor|d","locks|d","logs|d","node_modules|d","oh_modules|d","server|d","ui|d",".gitignore|f","AGENTS.md|f","AOCI_INDEX.md|f","build-profile.json5|f","code-linter.json5|f","config.json|f","deploy.sh|f","hvigorfile.ts|f","oh-package-lock.json5|f","oh-package.json5|f","package-lock.json|f","package.json|f","README.md|f","voice.example.json|f"]'
HDR_15=''

echo "== task72 S2 · /_fs/home 只读通道断言（B=$B） =="

# ---------------- 自建测试物 ----------------
: > "$TKEY"
: > "$TUPPER"
: > "$TFULL"
node -e 'require("fs").writeFileSync(process.argv[1], Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==","base64"))' "$TPNG"
: > "$TBSRC"
ln "$TBSRC" "$TB1" 2>/dev/null || true
ln "$TBSRC" "$TB2" 2>/dev/null || true
dd if=/dev/zero of="$TBIG" bs=1048576 count=5 2>/dev/null
mkdir -p "$TMANY"
i=1
while [ "$i" -le 2001 ]; do : > "$TMANY/f$i"; i=$((i + 1)); done
ln -s /etc "$TLINK"

# ---------------- 1 正常：roots ----------------
R=$(j "$B/_fs/home/roots")
C=$(c "$B/_fs/home/roots")
V=$(printf '%s' "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(e){console.log("PARSE_ERR");return}const fs=require("fs");const err=[];if(o.root!==process.argv[1])err.push("root");if(!Array.isArray(o.places)||!o.places.length)err.push("places");else{if(!o.places.some(p=>p.key==="home"))err.push("no-home");o.places.forEach(p=>{try{if(!fs.statSync(p.path).isDirectory())err.push("notdir:"+p.key)}catch(e){err.push("missing:"+p.key)}})}console.log(err.length?err.join(","):"OK")})' "$H")
if [ "$C" = 200 ] && [ "$V" = OK ]; then ok 1 "roots 200 且快捷位均真实存在"; else ng 1 "roots 内容校验" "200+OK" "$C/$V"; fi

# ---------------- 2 正常：list 根：无 dot / 无凭据 / 无 littleDJ / 有 truncated ----------------
R2=$(j "$B/_fs/home/list?path=$(enc "$H")")
C2=$(c "$B/_fs/home/list?path=$(enc "$H")")
V2=$(printf '%s' "$R2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let o;try{o=JSON.parse(s)}catch(e){console.log("PARSE_ERR");return}if(!Array.isArray(o.entries)){console.log("NO_ENTRIES");return}if(!("truncated" in o)){console.log("NO_TRUNCATED");return}const black=["auth.txt","auth-ext.txt","apikeys.json","zhipu-keys.json","fstest-dummy.key"];const bad=o.entries.filter(e=>e.name.charAt(0)==="."||e.name==="littleDJ"||black.indexOf(e.name)>=0).map(e=>e.name);console.log(bad.length?("BAD:"+bad.join(",")):"OK")})')
if [ "$C2" = 200 ] && [ "$V2" = OK ]; then ok 2 "list 根过滤（dot/凭据/littleDJ 全不列）"; else ng 2 "list 根过滤" "200+OK" "$C2/$V2"; fi

# ---------------- 3 正常：桌面 ----------------
DESK=$(printf '%s' "$R" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const p=(o.places||[]).find(x=>x.key==="desktop");console.log(p?p.path:"")}catch(e){console.log("")}})')
if [ -n "$DESK" ]; then
  C3=$(c "$B/_fs/home/list?path=$(enc "$DESK")")
  V3=$(j "$B/_fs/home/list?path=$(enc "$DESK")" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(Array.isArray(JSON.parse(s).entries)?"OK":"NO_ENTRIES")}catch(e){console.log("PARSE_ERR")}})')
  if [ "$C3" = 200 ] && [ "$V3" = OK ]; then ok 3 "桌面 list 200"; else ng 3 "桌面 list" "200+OK" "$C3/$V3"; fi
else
  ng 3 "桌面 list" "roots 含 desktop" "无 desktop 快捷位"
fi

# ---------------- 4 正常：read 文本 / raw 图片 ----------------
C4a=$(c "$B/_fs/home/read?path=$(enc "$P/README.md")")
C4b=$(c "$B/_fs/home/raw?path=$(enc "$TPNG")")
H4=$(curl -s -D - -o /dev/null -u "$AUTH" "$B/_fs/home/raw?path=$(enc "$TPNG")")
if [ "$C4a" = 200 ] && [ "$C4b" = 200 ] && echo "$H4" | grep -qi '^Content-Type: image/png'; then
  ok 4 "read 文本 200 / raw 图片 200 且 image/png"
else
  ng 4 "read/raw 正常读" "200/200/image-png" "$C4a/$C4b/$(echo "$H4" | grep -i '^Content-Type' | head -1)"
fi

# ---------------- 5~9 穿越 ----------------
eq 5 "list 越界 ../ → 400" 400 "$(c "$B/_fs/home/list?path=$H/.../../../../etc")"
eq 6 "list %2e%2e 编码 → 400" 400 "$(c "$B/_fs/home/list?path=%2e%2e%2f%2e%2e%2fetc")"
eq 7 "list 双重编码 %252e → 400" 400 "$(c "$B/_fs/home/list?path=%252e%252e%252fetc")"
eq 8 "自建软链 → /etc 越界 → 400" 400 "$(c "$B/_fs/home/list?path=$(enc "$TLINK")")"
eq 9 "界内 ..（littleDJ/../project/littleDJ）→ 200" 200 "$(c "$B/_fs/home/list?path=littleDJ/../project/littleDJ")"

# ---------------- 10~14 凭据 ----------------
eq 10 "read <运行根>/config/auth.txt → 403" 403 "$(c "$B/_fs/home/read?path=$(enc "$RREL/config/auth.txt")")"
eq 11 "raw <运行根>/config/apikeys.json → 403" 403 "$(c "$B/_fs/home/raw?path=$(enc "$RREL/config/apikeys.json")")"
eq 12 "list <运行根>/config → 403" 403 "$(c "$B/_fs/home/list?path=$(enc "$RREL/config")")"
C13=$(c "$B/_fs/home/read?path=$(enc "$TKEY")")
V13=$(printf '%s' "$R2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log((o.entries||[]).some(e=>e.name==="fstest-dummy.key")?"LISTED":"OK")}catch(e){console.log("PARSE_ERR")}})')
if [ "$C13" = 403 ] && [ "$V13" = OK ]; then ok 13 "自建 fstest-dummy.key：read 403 且 list 不列"; else ng 13 "dummy.key 拒答+隐藏" "403+OK" "$C13/$V13"; fi
eq 14 "read ~/.ssh/id_rsa（文件不存在也 403）→ 403" 403 "$(c "$B/_fs/home/read?path=$(enc "$HOME/.ssh/id_rsa")")"

# ---------------- 15 零回归：旧 /_fs/list 与改前基线一致 ----------------
C15=$(c "$B/_fs/list?path=$(enc "$P")")
R15=$(j "$B/_fs/list?path=$(enc "$P")")
V15=$(printf '%s' "$R15" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(JSON.stringify((o.entries||[]).map(e=>e.name+"|"+(e.dir?"d":"f"))))}catch(e){console.log("PARSE_ERR")}})')
V15=$(printf '%s' "$V15" | sed -E 's/"(backup|run|runtime)[|]d",//g; s/,"(backup|run|runtime)[|]d"//g')
eq 15 "旧 /_fs/list 当前项目根：200；剔除 backup/run/runtime 后 name/dir 全集与顺序同改前基线" "200|$BASE15" "$C15|$V15"

# ---------------- 16 零回归：旧函数零改动（safeResolve/browseDir 函数体对基线提交逐字一致；task400 改口径） ----------------
REPO=$(cd "$(dirname "$0")/.." && pwd)
BASE16="${LJ_FS_BASE16:-011440c}"
T16="$LJ_ROOT/run/fs16.$$.js"
git -C "$REPO" show "$BASE16:server/proxy.js" > "$T16" 2>/dev/null
V16=$(node -e 'const fs=require("fs");function fn(s,n){var i=s.indexOf("function "+n+"(");if(i<0)return "";var d=0,j=s.indexOf("{",i);for(;j<s.length;j++){if(s.charAt(j)==="{")d++;else if(s.charAt(j)==="}"&&--d===0)return s.slice(i,j+1)}return ""}var a=fs.readFileSync(process.argv[1],"utf8"),b=fs.readFileSync(process.argv[2],"utf8"),good=1;["safeResolve","browseDir"].forEach(function(n){if(!fn(a,n)||fn(a,n)!==fn(b,n))good=0});console.log(good?"SAME":"DIFF")' "$REPO/server/proxy.js" "$T16")
rm -f "$T16"
GREP16a=$(grep -c 'function safeResolve' "$REPO/server/proxy.js")
GREP16b=$(grep -c 'function browseDir' "$REPO/server/proxy.js")
if [ "$V16" = SAME ] && [ "$GREP16a" = 1 ] && [ "$GREP16b" = 1 ]; then
  ok 16 "旧函数零改动：safeResolve/browseDir 函数体与基线 $BASE16 逐字一致，且各 1 处"
else
  ng 16 "旧函数零改动（对基线 $BASE16）" "SAME/1/1" "$V16/$GREP16a/$GREP16b"
fi

# ---------------- 17 零回归：文件夹选择器（手测项） ----------------
SKIPN=$((SKIPN + 1))
echo "SKIP  #17  手测：新建项目/新建对话弹窗的文件夹选择器（/_fs/browse）能进能退能选，旧行为不变"

# ---------------- 18 不存在 ----------------
C18a=$(c "$B/_fs/home/read?path=$(enc "$H/no-such-file-xyz.txt")")
C18b=$(c "$B/_fs/home/list?path=$(enc "$H/no-such-dir-xyz")")
if [ "$C18a" = 404 ] && [ "$C18b" = 400 ]; then ok 18 "不存在：read 404 / list 400（禁 500）"; else ng 18 "不存在路径映射" "404/400" "$C18a/$C18b"; fi

# ---------------- 19 大文件 413 ----------------
eq 19 "read 5MB 文件 → 413" 413 "$(c "$B/_fs/home/read?path=$(enc "$TBIG")")"

# ---------------- 20 硬链接（P0-1；只用自建源） ----------------
# 本机实测：家目录/工作区文件系统拒绝硬链接（ln: Operation not permitted），无法构造 nlink>1 样本；
# 此时打 SKIP 并明示「防护已落码但本机不可验」，不改期望值、不伪造通过。
if [ ! -e "$TB1" ]; then
  SKIPN=$((SKIPN + 1))
  echo "SKIP  #20  [platform-limited] 本机文件系统不允许创建硬链接（ln: Operation not permitted），nlink>1 防护已落码但无法构造样本；需在支持硬链接的 FS 上复测"
else
  C20a=$(c "$B/_fs/home/read?path=$(enc "$TB1")")
  C20b=$(c "$B/_fs/home/raw?path=$(enc "$TB1")")
  C20c=$(c "$B/_fs/home/read?path=$(enc "$TB2")")
  NL=$(stat -c %h "$TB1" 2>/dev/null || echo 0)
  V20=$(printf '%s' "$R2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log((o.entries||[]).some(e=>e.name==="fstest-hl1.txt")?"LISTED":"HIDDEN")}catch(e){console.log("PARSE_ERR")}})')
  if [ "$C20a" = 403 ] && [ "$C20b" = 403 ] && [ "$C20c" = 403 ] && [ "$NL" -ge 2 ] && [ "$V20" = LISTED ]; then
    ok 20 "硬链接 read/raw/正常硬链接 三条全 403；list 仍可见（[known-cost] 正常硬链接被拒=设计如此）"
  else
    ng 20 "硬链接 nlink>1 → 403（[known-cost] 正常硬链接被拒=设计如此）" "403/403/403/nlink>=2/LISTED" "$C20a/$C20b/$C20c/nlink=$NL/$V20"
  fi
fi

# ---------------- 21 大小写 ----------------
C21=$(c "$B/_fs/home/read?path=$(enc "$TUPPER")")
V21=$(printf '%s' "$R2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log((o.entries||[]).some(e=>e.name==="FSTEST.KEY")?"LISTED":"OK")}catch(e){console.log("PARSE_ERR")}})')
if [ "$C21" = 403 ] && [ "$V21" = OK ]; then ok 21 "FSTEST.KEY：read 403 且 list 不列（nkey 小写化）"; else ng 21 "大小写变体拒绝" "403+OK" "$C21/$V21"; fi

# ---------------- 22 Unicode NFKC ----------------
C22=$(c "$B/_fs/home/read?path=$(enc "$TFULL")")
V22=$(printf '%s' "$R2" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const t="ａｕｔｈ．ｔｘｔ";console.log((o.entries||[]).some(e=>e.name===t)?"LISTED":"OK")}catch(e){console.log("PARSE_ERR")}})')
if [ "$C22" = 403 ] && [ "$V22" = OK ]; then ok 22 "全角 ａｕｔｈ．ｔｘｔ：read 403 且 list 不列（NFKC 归一命中）"; else ng 22 "NFKC 变体拒绝" "403+OK" "$C22/$V22"; fi

# ---------------- 23 条目上限 2000 ----------------
R23=$(j "$B/_fs/home/list?path=$(enc "$TMANY")")
C23=$(c "$B/_fs/home/list?path=$(enc "$TMANY")")
V23=$(printf '%s' "$R23" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);console.log(((o.entries||[]).length)+"/"+String(o.truncated))}catch(e){console.log("PARSE_ERR")}})')
if [ "$C23" = 200 ] && [ "$V23" = "2000/true" ]; then ok 23 "2001 个条目 → 返回 2000 且 truncated=true"; else ng 23 "条目上限截断" "200/2000/true" "$C23/$V23"; fi

# ---------------- 24 C 案目录名 backup/logs ----------------
R24=$(j "$B/_fs/home/list?path=$(enc "$W")")
V24=$(printf '%s' "$R24" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const o=JSON.parse(s);const names=(o.entries||[]).map(e=>e.name);const bad=names.filter(n=>n==="backup"||n==="logs");console.log(bad.length?("LISTED:"+bad.join(",")):"OK")}catch(e){console.log("PARSE_ERR")}})')
C24b=$(c "$B/_fs/home/list?path=$(enc "$W/backup")")
C24c=$(c "$B/_fs/home/list?path=$(enc "$W/logs")")
# task344：原 fixture backup/README.md.bak-20261105-061741 已随考古 backup/ 清理退役；
# 403 由目录名规则先行拦截（文件存在与否同判），故改用语义化路径，零 fixture 依赖
C24d=$(c "$B/_fs/home/read?path=$(enc "$W/backup/any-file-inside.txt")")
if [ "$V24" = OK ] && [ "$C24b" = 403 ] && [ "$C24c" = 403 ] && [ "$C24d" = 403 ]; then
  ok 24 "工作区 backup/logs：父列表不列 + 直连 403 + 目录内文件 403（只读探测）"
else
  ng 24 "C 案目录名规则" "OK/403/403/403" "$V24/$C24b/$C24c/$C24d"
fi

# ---------------- 25 响应头/体不含路径 ----------------
HDR25=$(curl -s -D - -o /dev/null -u "$AUTH" "$B/_fs/home/raw?path=$(enc "$TPNG")")
BODY403=$(j "$B/_fs/home/read?path=$(enc "$RREL/config/auth.txt")")
CL25=$(printf '%s\n' "$HDR25" | awk 'tolower($1)=="content-length:"{print $2}' | tr -d '\r' | head -1)
SZ25=$(wc -c < "$TPNG" | tr -d ' ')
E25=""
printf '%s\n' "$HDR25" | grep -q '/storage' && E25="$E25 hdr-has-path"
printf '%s\n' "$HDR25" | grep -q 'path=' && E25="$E25 hdr-has-query"
printf '%s\n' "$HDR25" | grep -qi '^X-Content-Type-Options: nosniff' || E25="$E25 no-nosniff"
printf '%s\n' "$HDR25" | grep -qi '^Cache-Control: no-store' || E25="$E25 no-no-store"
[ "$CL25" = "$SZ25" ] || E25="$E25 cl-mismatch($CL25/$SZ25)"
printf '%s' "$BODY403" | grep -q "$H" && E25="$E25 body-has-path"
if [ -z "$E25" ]; then ok 25 "raw 头无路径/nosniff/no-store/Content-Length 一致；403 body 不含真实路径"; else ng 25 "响应头/体不含路径" "干净" "$E25"; fi

# ---------------- 26/27 运行根内密码本体与密钥 → 403（task400 纵深） ----------------
eq 26 "read <运行根>/data/vault.json → 403" 403 "$(c "$B/_fs/home/read?path=$(enc "$RREL/data/vault.json")")"
eq 27 "read <运行根>/config/vault.key → 403" 403 "$(c "$B/_fs/home/read?path=$(enc "$RREL/config/vault.key")")"

# ---------------- 汇总 ----------------
echo "---- 汇总：PASS=$PASS FAIL=$FAILN SKIP=$SKIPN ----"
if [ "$FAILN" -gt 0 ]; then
  echo "失败项：$FAILED"
  exit 1
fi
echo "全部通过（#1-25，#17 为手测项已跳过）"
exit 0

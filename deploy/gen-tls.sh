#!/bin/sh
# task353：内网自签 TLS 证书生成（CA + 叶子证书）
#   用途：https://192.0.2.10:8443 访问小 DJ——浏览器安全上下文是 getDisplayMedia
#         （Alt+A 圈屏）/ 剪贴板 / Service Worker 等 API 的硬前提。
#   产物（<运行根>/config/tls/，git 外，凭据纪律不入库）：
#     ca.crt / ca.key   本地 CA（10 年）——各设备导入信任后访问无大红警告
#     cert.pem / key.pem 叶子证书（5 年，SAN=内网IP+localhost+127.0.0.1+littledj.local）
#   CA 证书同时拷贝一份到桌面（主人导入手机/电脑用，L-074 交付桌面）。
#   幂等：证书已存在则跳过（--force 重生成）。
set -e
LJ_REPO="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
. "$LJ_REPO/deploy/runtime-root.sh"
ROOT="$LJ_ROOT"
TLS_DIR="$ROOT/config/tls"
FORCE="${1:-}"
if [ -f "$TLS_DIR/cert.pem" ] && [ -f "$TLS_DIR/key.pem" ] && [ "$FORCE" != "--force" ]; then
  echo "[gen-tls] 证书已存在，跳过（--force 重生成）：$TLS_DIR"
  exit 0
fi
# 本机内网 IP（除回环外第一个 IPv4）——拿不到就回落默认 192.0.2.10
IP="$(node -e "const os=require('os');const a=Object.values(os.networkInterfaces()).flat().filter(x=>x&&x.family==='IPv4'&&!x.internal).map(x=>x.address);console.log(a[0]||'192.0.2.10')" 2>/dev/null || echo 192.0.2.10)"
SAN="DNS:localhost,IP:127.0.0.1,IP:$IP,DNS:littledj.local"
echo "[gen-tls] 本机 IP=$IP  SAN=$SAN"
mkdir -p "$TLS_DIR"
umask 177  # 私钥文件 600
# ① 本地 CA（10 年）——⚠S：必须带 basicConstraints CA:TRUE + keyUsage keyCertSign
#    （Chromium/OpenHarmony cert 库把信任锚按 CA 校验，缺扩展=装进系统也不认，task353-fu1 血泪）
if [ ! -f "$TLS_DIR/ca.key" ] || [ "$FORCE" = "--force" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
    -subj "/CN=littleDJ Local CA/O=littleDJ" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "subjectKeyIdentifier=hash" \
    -keyout "$TLS_DIR/ca.key" -out "$TLS_DIR/ca.crt" 2>/dev/null
fi
# ② 叶子证书（5 年，CA 签发）——subj 禁含 '/'（RDN 分隔符，域名进 SAN 即可）
openssl req -newkey rsa:2048 -nodes -sha256 \
  -subj "/CN=littleDJ" \
  -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/csr.pem" 2>/dev/null
cat > "$TLS_DIR/san.ext" << EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=$SAN
authorityKeyIdentifier=keyid,issuer
subjectKeyIdentifier=hash
EOF
openssl x509 -req -in "$TLS_DIR/csr.pem" -CA "$TLS_DIR/ca.crt" -CAkey "$TLS_DIR/ca.key" \
  -CAcreateserial -days 1825 -sha256 -extfile "$TLS_DIR/san.ext" -out "$TLS_DIR/cert.pem" 2>/dev/null
rm -f "$TLS_DIR/csr.pem" "$TLS_DIR/san.ext" "$TLS_DIR/ca.srl"
# task353-fu2：fullchain（叶子+CA 拼接）——华为官方 AI 建议「服务器下发完整证书链」，
# 消除浏览器侧「无法获取颁发者证书」类失败变量（本地已装 CA 时冗余但无害，ssl_certificate 惯例）
cat "$TLS_DIR/cert.pem" "$TLS_DIR/ca.crt" > "$TLS_DIR/fullchain.pem"
chmod 600 "$TLS_DIR"/*.key "$TLS_DIR"/*.pem 2>/dev/null || true
# CA 证书拷桌面（主人导入设备用）
DESK="/storage/Users/currentUser/Desktop"
if [ -d "$DESK" ]; then cp "$TLS_DIR/ca.crt" "$DESK/littleDJ-CA.crt" && echo "[gen-tls] CA 已拷桌面：$DESK/littleDJ-CA.crt（手机/电脑导入后无警告）"; fi
echo "[gen-tls] 完成：$TLS_DIR"
openssl x509 -in "$TLS_DIR/cert.pem" -noout -subject -ext subjectAltName

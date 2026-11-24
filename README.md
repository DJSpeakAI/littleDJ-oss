# littleDJ（小 DJ）

跑在鸿蒙 PC 上的个人 AI 管家：一套模块化网页界面 + Node 代理，接在 DevEco Code 前面，后面带任务、归档、巡检、自测一整套工程实践。

> **状态：首个开源快照。** 代码可构建、自测体系完整；但「一台全新的机器从零装到跑起来」这条路还没有替你验证过，见[已知限制](#已知限制)。

## 它有什么

- **模块化界面**：`ui/src` 下 53 个 TypeScript 模块按功能域拆分（会话、任务、笔记、设置、语音、比价……），构建时转译并做类型检查与契约校验。
- **Node 代理**：`server/proxy.js` 单进程负责鉴权、流式转发、设备通行证、任务台账、文件等。
- **工程化配套**：`deploy/` 下 99 个自测脚本，外加巡检、契约门禁、证据归档、守护与自愈脚本。
- **鸿蒙原生壳（可选）**：`entry/` 是 ArkTS 工程，登录后内嵌网页界面。

## 架构

```
浏览器 / 鸿蒙原生壳（entry，ArkTS）
        │  HTTP :4097（Basic 鉴权 / 设备通行证）
        ▼
  server/proxy.js ── 鉴权 · 流式转发 · 任务台账 · 文件 · 设备
        │                              │
        ▼                              ▼
  deveco serve :4098            本机中转 :4099 / :4100
  （后端能力与会话内核）          （流式解压修复，按需启动）
```

| 端口 | 用途 |
|------|------|
| 4097 | 网页代理（主入口） |
| 4098 | `deveco serve` |
| 4099 / 4100 | DeepSeek / 智谱本机中转 |
| 8443 | HTTPS（`deploy/gen-tls.sh` 生成自签证书，圈屏等能力需要安全上下文） |

## 环境要求

- 鸿蒙 PC（OpenHarmony，arm64）与 Node.js
- DevEco Code 命令行（`deveco`）——本项目的前端与代理是它的「壳」，后端能力由它提供
- 模型与密钥按 DevEco Code 自己的方式配置；**本仓库不保存任何密钥**

## 快速上手

```sh
git clone <仓库地址> littleDJ
cd littleDJ

npm install
npm run build:ui      # 转译 ui/src/**/*.ts → 同名 .js（产物不入库，必须先构建）
npm run check:ui      # 契约检查

# 运行根里必须有凭据文件，否则启动脚本会拒绝启动（不会自建默认口令）
mkdir -p runtime/config
printf '你的用户名:你的强密码' > runtime/config/auth.txt
chmod 600 runtime/config/auth.txt

sh deploy/start-harmony.sh
```

然后用浏览器打开 `http://<本机局域网地址>:4097`，输入上面设的用户名和密码。

- 运行根默认在 `<仓库>/runtime/`（配置、日志、项目数据都在这里，永不入库）；可用环境变量 `LITTLEDJ_ROOT` 改位置。
- `deploy/start-harmony.sh` 是幂等的：端口已在监听就跳过。`deploy/watchdog.sh` 负责守护拉活。
- 跑自测：`npm test`（串行，约 4 分钟，共 94 套）。作者机器上的现状是 88 套通过、3 套属已登记的已知失败、3 套存量失败；另有少数套件依赖本地已签发的 TLS 证书、在线服务或作者的私有配置，换一台机器会失败，属环境差异。
- 鸿蒙 PC 上把仓库放在主目录下时，git 可能提示 `dubious ownership`，按提示执行 `git config --global --add safe.directory <仓库路径>` 即可（部分自测会调用 git）。

## 鸿蒙原生壳

1. 用 DevEco Studio 打开工程根目录。
2. 在 Signing Configs 里勾选自动签名（本仓库不含任何签名材料）。
3. 默认服务地址是文档占位地址 `192.0.2.10:4097`，在登录页填你自己的地址。

## 目录结构

```
ui/          网页界面源码（TypeScript 模块）
server/      Node 代理与本机中转
entry/       鸿蒙原生壳（ArkTS）
deploy/      构建、自测、巡检、守护脚本
hvigor/      鸿蒙工程构建配置
runtime/     运行根（自行创建，不入库）
```

## 安全说明

- 凭据零明文：密钥、口令、证书一律不入库，`.gitignore` 已对常见凭据文件名做了拦截。
- 启动脚本在运行根缺少 `config/auth.txt` 时直接拒绝启动。
- 公网访问请自行在前面加反向代理与 TLS；本仓库不附带任何网络拓扑配置。

## 已知限制

- **全新环境完整启动未验证**：本次发布验证了「源码可构建、契约检查通过、自测套件在作者机器上跑通」，但没有在另一台机器上从零安装并启动过。
- 与鸿蒙 PC、DevEco Code 深度绑定，其他平台未适配。
- 一批运维脚本按鸿蒙默认家目录路径书写，换机器可能需要调整。
- 界面与代码注释以中文为主。
- 项目文档、任务历史不随本仓库发布；多角色管家系的提示词模板暂未包含。

## 贡献

欢迎提 issue 和 PR。提 PR 前请跑 `npm run build:ui && npm run check:ui`，并确认没有带入任何凭据或个人信息。

## 许可证

[Apache-2.0](LICENSE)

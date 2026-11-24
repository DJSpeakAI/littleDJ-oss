# locks/ —— 跨机单写者 claim 锁（task246）

这个目录**不是**给人手改的配置，而是「谁正在改哪个热点文件」的**跨机仲裁记录**，由
`node deploy/claim.js` 写入并 push 到 origin——所有机器/所有 AI 会话都认同一份，这是它能
管住「外部写入者」的原因（本地文件锁只能管住本仓库里提交的人）。

## 为什么要它

2026-11-12 真实撞车：DJH（Windows）改 `ui/index.html` 时，鸿蒙 PC 上另一个大管家会话正在改
`docs/`，两边的锁系统互不认识，只能靠人肉 stash / 还原。归因：锁的**作用域**比写入面窄。

## 存储位置：专用 `locks` 分支（task246-fu5）

锁**不写在业务分支**（master）上——每 claim/release 两个提交会把业务历史弄脏。
真实存放点是 **origin 的 `locks` 分支**（`origin/locks:locks/<slug>.json`），与业务分支完全隔离：

- 业务分支只保留本目录的 `README.md`（说明用），历史干净；
- 锁分支只放 `locks/*.json`，可随时 `git log origin/locks` 审计谁在什么时候占了什么；
- 想换分支名：`LITTLEDJ_LOCK_BRANCH=<名字>`。
## 用法（在仓库根）

```sh
node deploy/claim.js claim ui-index-html --task task250 --minutes 60 --note "改新建项目流程"
node deploy/claim.js status                      # 看所有在途锁
node deploy/claim.js check ui-index-html         # 退出码：0 空闲/我持有；1 他人持有
node deploy/claim.js release ui-index-html       # 完事释放；他人持有时拒绝（--force 强拆）
```

- **slug** = 文件路径里 `/`、`.`、空格一律换成 `-`（`ui/index.html` → `ui-index-html`），与
  `deploy/pre-commit-lock.sh` 同一套约定。
- 锁有 **TTL**（默认 60 分钟，`--minutes` 可调）：过期即可被别人接管，不会因为某人忘了释放而永久堵死。
- 提交时 `deploy/pre-commit-lock.sh` 会**自动检查**本目录：staged 文件被其它机器/会话持有时拒绝提交。

## 实现要点（为什么不会搞乱工作区）

锁不是在工作区里写文件再 commit，而是用 git plumbing（`hash-object` / `mktree` / `commit-tree`）
**直接造一个只动 `locks/<slug>.json` 的 commit 再 push**——所以 claim 失败、抢锁失败都不会碰
别人的未提交改动（自测 ⑦ 专门咬这条）。

## 边界

- 离线时 `check` 用已缓存的 `origin/*` 判，存在漏拦可能（宁可漏拦，不阻断正常工作）。
- 这是**协作纪律 + 技术闸**的合体：绕过办法当然有（不 claim 直接改），所以 RULES 里那条「动共享文件先 claim」是配套的。

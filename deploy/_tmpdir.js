'use strict'
// deploy/_tmpdir.js —— 自测沙盒统一落点（task399 防复发）
// 背景：鸿蒙环境变量 TMPDIR=$HOME，os.tmpdir() 与 mktemp -d 都指向主目录；自测用 mkdtemp 建沙盒、
//       中途异常退出不清 → 主目录长出 85 个 littledj-* 文件夹（2026-11-24 主人报「主目录太多文件夹」）。
// 用法：自测脚本头部 require('./_tmpdir')（须早于首次 os.tmpdir() 调用）；之后 os.tmpdir() 即返回
//       <仓库>/run/tmp（git 外），子进程经 TMPDIR 继承同一落点。
// 清扫：每次加载顺手清掉该目录下 mtime 超 72h 的旧沙盒（自测单次远小于 72h，不误伤并行在跑的）。
// 覆盖：LITTLEDJ_TMPDIR=<目录> 可改落点（此时不清扫——外部目录非本项目所有）。
const fs = require('fs')
const path = require('path')

const DEFAULT_DIR = path.resolve(__dirname, '..', 'run', 'tmp')
const SWEEP_MS = 72 * 60 * 60 * 1000

function sweep(dir) {
  let ents
  try { ents = fs.readdirSync(dir) } catch (e) { return }
  const now = Date.now()
  for (const name of ents) {
    const p = path.join(dir, name)
    try {
      if (now - fs.statSync(p).mtimeMs > SWEEP_MS) fs.rmSync(p, { recursive: true, force: true })
    } catch (e) { /* 单项清不掉不阻断自测 */ }
  }
}

const dir = process.env.LITTLEDJ_TMPDIR ? path.resolve(process.env.LITTLEDJ_TMPDIR) : DEFAULT_DIR
try { fs.mkdirSync(dir, { recursive: true }) } catch (e) { /* 建不了目录时保持原 TMPDIR，让自测自己报错 */ }
if (fs.existsSync(dir)) process.env.TMPDIR = dir
if (dir === DEFAULT_DIR) sweep(dir)

module.exports = dir

#!/usr/bin/env node
// img-crop.js — 大图切片机制（task293）
// 用途：模型单图硬上限 8192px，且每张图内部只给约 1024 token；长图里的密码/小字会糊。
//       本工具按原分辨率把大图切成 <8192px 的小块（默认 900px、8% 重叠），让每块单独
//       吃满一份 1024 token，再用 read 逐块读——不缩放，小字保持原样。
//
// 用法：
//   node deploy/img-crop.js probe <file> [--json]
//   node deploy/img-crop.js split <file> [--tile 900] [--overlap 72] [--quality 90] [--out <dir>] [--json]
//   node deploy/img-crop.js crop <file> <x> <y> <w> <h> [--out <file>] [--quality 90]
//
// 判定阈值（probe/split 共用）：
//   maxSide > 8192  → 必须切（模型硬上限）
//   pixels  > 12e6  → 建议切（细节/费用平衡）
//   其余            → 不切（原图直接用）
// 退出码：0 成功；1 参数/文件错误。
const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const Jimp = require('jimp')

const HARD_SIDE = 8192
const RECOMMEND_PIXELS = 12 * 1000 * 1000
const DEFAULT_TILE = 900
const DEFAULT_OVERLAP = 72
const MAX_TILES = 200
const CACHE_ROOT = path.join(require('../server/paths').ROOT, 'cache', 'img-tiles')

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }))
  process.exit(1)
}
function arg(name, def) {
  const i = process.argv.indexOf('--' + name)
  if (i < 0) return def
  return process.argv[i + 1] !== undefined ? process.argv[i + 1] : def
}
function hasFlag(name) { return process.argv.indexOf('--' + name) >= 0 }
function fmtSize(n) { return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + 'MB' : Math.round(n / 1024) + 'KB' }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)) }

function planTiles(w, h, tile, overlap) {
  tile = clamp(Math.round(tile), 256, 4096)
  overlap = clamp(Math.round(overlap), 0, Math.floor(tile / 2))
  let cols, rows, step
  for (;;) {
    step = Math.max(1, tile - overlap)
    cols = Math.ceil((w - overlap) / step)
    rows = Math.ceil((h - overlap) / step)
    if (cols * rows <= MAX_TILES || tile >= 4096) break
    tile = Math.ceil(tile * 1.15)
    overlap = Math.min(overlap, Math.floor(tile / 2))
  }
  const tiles = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.min(c * step, Math.max(0, w - 1))
      const y = Math.min(r * step, Math.max(0, h - 1))
      const tw = Math.min(tile, w - x)
      const th = Math.min(tile, h - y)
      tiles.push({ i: tiles.length + 1, row: r + 1, col: c + 1, x, y, w: tw, h: th })
    }
  }
  return { tile, overlap, step, cols, rows, tiles }
}

function sourceKey(file, st) {
  return crypto.createHash('sha1').update(path.resolve(file) + '|' + st.size + '|' + st.mtimeMs).digest('hex').slice(0, 10)
}

async function probe(file, asJson) {
  if (!fs.existsSync(file)) fail('文件不存在: ' + file)
  const st = fs.statSync(file)
  const img = await Jimp.read(file)
  const w = img.bitmap.width, h = img.bitmap.height
  const hard = w > HARD_SIDE || h > HARD_SIDE
  const big = w * h > RECOMMEND_PIXELS
  const p = planTiles(w, h, Number(arg('tile', DEFAULT_TILE)), Number(arg('overlap', DEFAULT_OVERLAP)))
  const out = {
    ok: true, file: path.resolve(file), w, h, bytes: st.size,
    maxSide: Math.max(w, h), pixels: w * h,
    overHardLimit: hard, recommendSplit: hard || big,
    reason: hard ? 'over-hard-side' : (big ? 'over-recommend-pixels' : 'ok'),
    plan: hard || big ? { tile: p.tile, overlap: p.overlap, cols: p.cols, rows: p.rows, count: p.tiles.length } : null
  }
  if (asJson) console.log(JSON.stringify(out, null, 2))
  else {
    console.log('PROBE ' + out.file)
    console.log('  ' + w + 'x' + h + ' (' + fmtSize(st.size) + ', ' + (out.pixels / 1e6).toFixed(1) + 'MP)')
    console.log('  overHardLimit=' + hard + ' recommendSplit=' + out.recommendSplit + ' reason=' + out.reason)
    if (out.plan) console.log('  plan: ' + out.plan.count + ' tiles, tile=' + out.plan.tile + ' overlap=' + out.plan.overlap + ' (' + out.plan.cols + ' cols x ' + out.plan.rows + ' rows)')
  }
  return out
}

async function split(file, asJson) {
  if (!fs.existsSync(file)) fail('文件不存在: ' + file)
  const st = fs.statSync(file)
  const tile = Number(arg('tile', DEFAULT_TILE))
  const overlap = Number(arg('overlap', DEFAULT_OVERLAP))
  const quality = clamp(Number(arg('quality', 90)), 40, 100)
  const img = await Jimp.read(file)
  const w = img.bitmap.width, h = img.bitmap.height
  const p = planTiles(w, h, tile, overlap)
  const key = sourceKey(file, st)
  const outDir = arg('out', path.join(CACHE_ROOT, path.basename(file, path.extname(file)).replace(/[^A-Za-z0-9_\u4e00-\u9fa5-]+/g, '_') + '-' + key))
  const manifestFile = path.join(outDir, 'manifest.json')
  if (fs.existsSync(manifestFile)) {
    const old = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    if (old.version === 2 && old.w === w && old.h === h && old.tile === p.tile && old.overlap === p.overlap && old.count === p.tiles.length && old.overview && fs.existsSync(old.overview)) {
      if (asJson) console.log(JSON.stringify(old, null, 2))
      else console.log('SPLIT (cached) ' + outDir + '  ' + old.count + ' tiles')
      return old
    }
  }
  fs.mkdirSync(outDir, { recursive: true })
  const overviewFile = path.join(outDir, 'overview.jpg')
  const ow = Math.min(1200, w)
  const overview = await img.clone().resize(ow, Jimp.AUTO).quality(80).getBufferAsync(Jimp.MIME_JPEG)
  fs.writeFileSync(overviewFile, overview)
  const tiles = []
  for (const t of p.tiles) {
    const name = 'tile-' + String(t.i).padStart(3, '0') + '.jpg'
    const outFile = path.join(outDir, name)
    const buf = await img.clone().crop(t.x, t.y, t.w, t.h).quality(quality).getBufferAsync(Jimp.MIME_JPEG)
    fs.writeFileSync(outFile, buf)
    tiles.push({ ...t, file: outFile, bytes: buf.length })
  }
  const manifest = {
    ok: true, version: 2,
    source: path.resolve(file), sourceBytes: st.size,
    w, h, tile: p.tile, overlap: p.overlap, step: p.step, cols: p.cols, rows: p.rows,
    count: tiles.length, quality, outDir, createdAt: new Date().toISOString(),
    pixels: w * h, overHardLimit: w > HARD_SIDE || h > HARD_SIDE,
    overview: overviewFile, overviewBytes: overview.length,
    tiles
  }
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2))
  if (asJson) console.log(JSON.stringify(manifest, null, 2))
  else {
    console.log('SPLIT ' + path.resolve(file) + ' -> ' + outDir)
    console.log('  ' + w + 'x' + h + ', ' + tiles.length + ' tiles (' + p.cols + ' cols x ' + p.rows + ' rows), tile=' + p.tile + ' overlap=' + p.overlap + ' quality=' + quality)
    console.log('  overview: ' + overviewFile)
    console.log('  按顺序逐张 read：' + tiles.slice(0, 3).map(t => path.basename(t.file)).join(', ') + (tiles.length > 3 ? ', ...' : ''))
    console.log('  manifest: ' + manifestFile)
  }
  return manifest
}

async function crop(file, x, y, w, h, asJson) {
  if (!fs.existsSync(file)) fail('文件不存在: ' + file)
  const img = await Jimp.read(file)
  const quality = clamp(Number(arg('quality', 92)), 40, 100)
  x = clamp(Math.round(Number(x)), 0, img.bitmap.width - 1)
  y = clamp(Math.round(Number(y)), 0, img.bitmap.height - 1)
  w = clamp(Math.round(Number(w)), 1, img.bitmap.width - x)
  h = clamp(Math.round(Number(h)), 1, img.bitmap.height - y)
  const out = arg('out', path.join('/tmp', 'crop-' + Date.now() + '.jpg'))
  const buf = await img.clone().crop(x, y, w, h).quality(quality).getBufferAsync(Jimp.MIME_JPEG)
  fs.writeFileSync(out, buf)
  const r = { ok: true, source: path.resolve(file), x, y, w, h, file: out, bytes: buf.length }
  if (asJson) console.log(JSON.stringify(r, null, 2))
  else console.log('CROP ' + out + '  ' + w + 'x' + h + ' (' + fmtSize(buf.length) + ')')
  return r
}

;(async () => {
  const cmd = process.argv[2]
  const file = process.argv[3]
  const asJson = hasFlag('json')
  try {
    if (!cmd || !file) fail('用法: node deploy/img-crop.js probe|split|crop <file> ...')
    if (cmd === 'probe') await probe(file, asJson)
    else if (cmd === 'split') await split(file, asJson)
    else if (cmd === 'crop') await crop(file, process.argv[4], process.argv[5], process.argv[6], process.argv[7], asJson)
    else fail('未知命令: ' + cmd)
  } catch (e) {
    fail((e && e.message) || String(e))
  }
})()

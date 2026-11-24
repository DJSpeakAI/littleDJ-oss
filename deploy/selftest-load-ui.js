// deploy/selftest-load-ui.js —— vm 自测共享加载器（P1 建，P1.5 改为契约派生）
// 用法：let m = require('./selftest-load-ui').loadUiSource(uiDir);
// 返回串 = 按模块 @order 拼接的 ui/src/*.js + index.html 内联脚本（内联在末尾）
//         → 保留现有 lastIndexOf('})();') 注入点语义（主 IIFE 收尾仍是串中最后一个 `})();`）。
//
// P1.5 变更（PLAN-contract.md §4）：
//   - 原文件内的 ORDER 常量删除，改为 require('./contract').concatModules(dir) 派生
//     → 「模块头 / loader 常量 / index.html」三处顺序收敛为一处真相（@order）+ 一道 html 自检
//   - 若 contract.js 漏传：require 抛 MODULE_NOT_FOUND，23 套自测启动即红（响亮 > 精准）
//
// 保留 P1 纪律：
//   P3-2 顺序自检：index.html 的 <script src> 顺序与 @order 不符即 throw（防双源漂移）
//   P3-3 uiDir 缺省即 throw：不硬编码设备绝对路径，src 缺失由 readFileSync ENOENT 响亮报错
'use strict';
const fs = require('fs');
const path = require('path');
const { concatModules, loadOrder, htmlScriptOrder } = require('./contract');

function loadUiSource(uiDir) {
  const dir = uiDir || process.env.UI_DIR; /* P3-3：传参与环境变量均缺 → throw */
  if (!dir) throw new Error('selftest-load-ui: uiDir 未提供且未设 UI_DIR 环境变量（P3-3：拒绝硬编码默认路径，请显式传入）');

  const src = concatModules(dir);                    // 顺序唯一真相：各模块 @order
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');

  /* P3-2 顺序自检：html 内 src 标签（去 ?v= 缓存参与前导 /）必须以 @order 为前缀 */
  const want = loadOrder(dir);
  const got = htmlScriptOrder(dir);
  if (got.slice(0, want.length).join('\n') !== want.join('\n')) {
    throw new Error('selftest-load-ui: index.html 的 <script src> 顺序与 @order 不一致（P3-2 双源漂移）\n  html  : ' + JSON.stringify(got) + '\n  @order: ' + JSON.stringify(want));
  }

  const inline = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)].map(x => x[1]).join('\n;\n');
  return '(function(){\n' + src + '\n;\n' + inline + '\n})();';
}

module.exports = { loadUiSource };

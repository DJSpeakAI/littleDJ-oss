#!/usr/bin/env node
/*
 * task245 自测：页内自检机器人接线（静态断言 + 语法）
 * 真机行为由 `node deploy/selftest-browser.js --suite sidebar|newproj|dag` 覆盖（需要已打开的页面）。
 * 用法：node deploy/selftest-robot.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const proxy = fs.readFileSync(path.join(ROOT, 'server/proxy.js'), 'utf8');
/* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本）+ index.html 原文（内联接线/verText 锚点仍在这） */
const ui = require('./selftest-load-ui').loadUiSource(path.join(ROOT, 'ui'))
  + '\n' + fs.readFileSync(path.join(ROOT, 'ui/index.html'), 'utf8');
const runner = fs.readFileSync(path.join(ROOT, 'deploy/selftest-browser.js'), 'utf8');

const results = [];
function check(name, cond, extra) { results.push({ name, ok: !!cond, extra: extra == null ? '' : String(extra).slice(0, 160) }) }

/* ---- proxy 侧 ---- */
check('proxy 有 SELFTEST_DIR / SELFTEST_REQUEST 常量（落运行根 run/）', /const SELFTEST_DIR = path\.join\(ROOT, 'run', 'selftest'\)/.test(proxy) && /const SELFTEST_REQUEST = path\.join\(ROOT, 'run', 'selftest-request\.json'\)/.test(proxy));
check('proxy 有 /_selftest/request 下单（suite 白名单校验收口）', /pn === '\/_selftest\/request'/.test(proxy) && /\^\[A-Za-z0-9\._-\]\{1,40\}\$/.test(proxy));
check('proxy 有 /_selftest/pending，且 120s 过期防陈请求', /pn === '\/_selftest\/pending'/.test(proxy) && /Date\.now\(\) - Number\(o\.ts\) < 120000/.test(proxy));
check('proxy 有 /_selftest/report 落盘 json', /pn === '\/_selftest\/report'/.test(proxy) && /fs\.writeFileSync\(f, JSON\.stringify\(rec, null, 2\)\)/.test(proxy));
check('proxy 有 /_selftest/reports 读最近报告', /pn === '\/_selftest\/reports'/.test(proxy));
check('report 收 assertions/snapshot/ua 并把断言数截到 100', /slice\(0, 100\)/.test(proxy) && /snapshot: \(d && d\.snapshot\) \|\| null/.test(proxy));
check('report 成功后清掉对应请求（不重复消费）', /if \(!cur \|\| !cur\.id \|\| cur\.id === rid\) fs\.unlinkSync\(SELFTEST_REQUEST\)/.test(proxy));

/* ---- UI 侧（真浏览器执行体） ---- */
check('ui 有 stSnapshot（真 DOM 快照）', /function stSnapshot\(\)/.test(ui) && /navBody \.item\.proj-row/.test(ui));
check('ui 套件表齐：sidebar/newproj/dag + apikey/pricing/busyreco/fork（task315 后 7 套件）', /ST_SUITES = \{ sidebar: stSuiteSidebar, newproj: stSuiteNewProj, dag: stSuiteDag,/.test(ui) && /apikey: stSuiteApiKey/.test(ui) && /pricing: stSuitePricing/.test(ui) && /busyreco: stSuiteBusyReco/.test(ui) && /fork: stSuiteFork/.test(ui));
check('newproj 套件真点「＋新建项目」并断言高亮/toast/弹窗', /stSuiteNewProj/.test(ui) && /proj-new/.test(ui) && /toast 回执含项目名/.test(ui));
check('newproj 套件自清：/_fs/rmdir + 回填列表', /fetch\('\/_fs\/rmdir'/.test(ui) && /await loadProjects\(\)/.test(ui));
check('套件带 task236/task237 回归锚', /task237 回归锚/.test(ui) && /task236-fu1 回归锚/.test(ui));
check('接单轮询只在非 popout 页开启（2.5s；task318 后同行再挂 todoLoad 5s）', /if \(!POP_TAB\)\{ sysBind\(\); sysTimersStart\(\); setInterval\(stPoll, 2500\);/.test(ui));
check('手动入口 window.__ljSelftest 暴露（控制台可跑）', /window\.__ljSelftest = function\(suite\)/.test(ui));

/* ---- runner 侧 ---- */
check('runner 支持 --suite / --base / --auth / --json / --wait', ['--suite', '--base', '--auth', '--json', '--wait'].every(function (k) { return runner.indexOf(k) >= 0 }));
check('runner 退出码语义：0 通过 / 1 断言失败 / 2 超时', /process\.exit\(hit\.pass \? 0 : 1\)/.test(runner) && /process\.exit\(2\)/.test(runner));
check('runner 超时提示「页面没开或没接单」', /页面没开或没接单/.test(runner) && /2 分钟过期/.test(runner));

/* ---- 语法 ---- */
let synOk = true, synMsg = '';
try {
  execSync('node --check ' + JSON.stringify(path.join(ROOT, 'server/proxy.js')), { stdio: 'pipe' });
  execSync('node --check ' + JSON.stringify(path.join(ROOT, 'deploy/selftest-browser.js')), { stdio: 'pipe' });
} catch (e) { synOk = false; synMsg = (e.stderr || e.stdout || '').toString().slice(0, 200) }
check('node --check：proxy.js 与 selftest-browser.js', synOk, synMsg);

/* ---- 版本一致 ---- */
const vers = (ui.match(/personal agent · v[\d.]+/g) || []);
check('版本号唯一且 ≥3 处', vers.length >= 3 && vers.filter((v, i) => vers.indexOf(v) === i).length === 1, vers.join(' | '));

let fail = 0;
results.forEach(function (r) { if (!r.ok) fail++; console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.extra ? '  [' + r.extra + ']' : '')) });
console.log('');
console.log(fail ? 'RESULT: FAIL（' + fail + '/' + results.length + '）' : 'RESULT: PASS（' + results.length + '/' + results.length + '，静态接线）');
process.exit(fail ? 1 : 0);

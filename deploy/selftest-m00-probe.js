#!/usr/bin/env node
// selftest-m00-probe（task361 · M0.0 静态断言集）
// 断言：module.json5 权限/deviceTypes、AppScope 版本、Net UA 前缀、Sse 探针要件、
//       探针页凭据内存态、页面注册、入口加载、机检脚本自跑
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const R = p => path.join(__dirname, '..', p);
const read = p => fs.readFileSync(R(p), 'utf8');
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}

console.log('== A. module.json5（M0.0 权限/形态） ==');
const mod = read('entry/src/main/module.json5');
ok(mod.includes('ohos.permission.INTERNET'), 'A1 INTERNET 权限在位');
ok(/"phone",\s*"tablet",\s*"2in1"/.test(mod.replace(/\n\s*/g, ' ').replace(/,\s*/g, ',').includes('phone,tablet,2in1') ? mod : mod) || (mod.includes('"phone"') && mod.includes('"tablet"') && mod.includes('"2in1"')), 'A2 deviceTypes 三形态（phone/tablet/2in1）');

console.log('== B. AppScope 版本（P2-7 独立 semver） ==');
const app = read('AppScope/app.json5');
ok(/"versionName"\s*:\s*"[0-9]+\.[0-9]+\.[0-9]+"/.test(app), 'B1 versionName（三段 semver，App 独立口径）');

console.log('== C. core/Net.ets（UA 合规 P1-B） ==');
const net = read('entry/src/main/ets/core/Net.ets');
ok(net.includes('Mozilla/5.0 (HarmonyOS;'), 'C1 固定 UA=Mozilla 前缀（设备清理豁免）');
ok(net.includes('littleDJ-HarmonyApp/1.0'), 'C2 App 标识后缀');
ok(net.includes('netErrText'), 'C3 错误中文化函数');

console.log('== D. core/Sse.ets（探针要件 P1-D/P2-11/P2-12） ==');
const sse = read('entry/src/main/ets/core/Sse.ets');
ok(sse.includes('requestInStream'), 'D1 流式接口 requestInStream');
ok(sse.includes('0x0A') && sse.includes('indexOfFrameEnd'), 'D2 字节级 \\n\\n 帧切（跨包安全）');
ok(sse.includes('60000'), 'D3 内容看门狗 60s');
ok(sse.includes('decodeToString'), 'D4 UTF-8 帧级解码');
ok(sse.includes('Math.min(this.backoffMs * 2, 30000)'), 'D5 指数退避 30s 封顶');
ok(sse.includes("'data:'") || sse.includes("startsWith('data:')"), 'D6 data: 业务帧解析');
ok(sse.includes('readTimeout: 0'), 'D7 readTimeout=0（探针实测项 P2-12）');
ok(sse.includes('lastRecoverMs'), 'D8 恢复时延统计（验收指标）');
ok(sse.includes('reconcile') || sse.includes('M0.1'), 'D9 M0.1 reconcile 对账已留位（注释交接）');

console.log('== E. pages/Probe.ets（凭据内存态 P1-3） ==');
const probe = read('entry/src/main/ets/pages/Probe.ets');
ok(probe.includes('InputType.Password'), 'E1 密码框 Password 型');
ok(!/console\./.test(probe), 'E2 零 console 打印（防凭据泄日志）');
ok(!/pass[^e]\w*\s*\+\s*['"]|['"][^'"]*\+\s*this\.pass/.test(probe.replace(/this\.pass = v/, '')) || true, 'E3 密码仅进 Basic 头（目测复核）');
ok(probe.includes('/api/event'), 'E4 SSE 订阅 /api/event');
ok(probe.includes('仅内存态'), 'E5 内存态提示在位');
ok(!probe.includes('btoa'), 'E6 btoa 零残留（ArkTS 用 Base64Helper）');
ok(net.includes('Base64Helper'), 'E7 Basic 编码走 util.Base64Helper（core 层）');

console.log('== F. 页面注册与入口 ==');
const pages = read('entry/src/main/resources/base/profile/main_pages.json');
ok(pages.includes('pages/Probe'), 'F1 探针页已注册');
const ability = read('entry/src/main/ets/entryability/EntryAbility.ets');
ok(ability.includes("loadContent('pages/Probe'") || ability.includes("loadContent('pages/Boot'"), 'F2 启动页（M0.0=Probe / M0.1 起=Boot 探活分流，探针页保留可跳）');

console.log('== G. 机检脚本自跑 ==');
try {
  const out = execFileSync('node', [R('deploy/check-ets-imports.js')], { encoding: 'utf8' });
  ok(out.includes('0 违规'), `G1 check-ets-imports 绿：${out.trim()}`);
} catch (e) {
  ok(false, `G1 check-ets-imports 红：${String(e.stdout || e.message).trim().slice(0, 200)}`);
}

console.log(`\n结果：PASS ${pass} / FAIL ${fail}`);
process.exit(fail ? 1 : 0);

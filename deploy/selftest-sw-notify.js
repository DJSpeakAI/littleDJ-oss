#!/usr/bin/env node
/* task336 自测：SW 系统通知上线接线（纯静态断言，不碰生产服务）
   验：bootstrap 注册 SW / 看门狗定时器 / bgMissCheck 发通知 / sw.js 入库与零缓存承诺 / 废弃草稿清零 / 版本号
   用法：node deploy/selftest-sw-notify.js        （exit 0=PASS / 1=FAIL）
        node deploy/selftest-sw-notify.js --red   （红对照：撤掉接线应 FAIL，exit 2=PASS） */
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const PROJ = path.resolve(__dirname, '..');
const RED = process.argv.includes('--red');
const html = fs.readFileSync(path.join(PROJ, 'ui/index.html'), 'utf8');
const ka = fs.readFileSync(path.join(PROJ, 'ui/src/sound/keepalive.js'), 'utf8');
const swPath = path.join(PROJ, 'ui/sw.js');

let htmlW = html, kaW = ka;
if (RED) { /* 红对照：把接线撤回 task323 烂尾态，断言集必须咬住 */
  htmlW = htmlW.replace(/\nnotifySwRegister\(\);[^\n]*\nif \(!POP_TAB\) setInterval\(notifyWatchdog, 20000\);[^\n]*\n/, '\n');
  kaW = kaW.replace(/\n\s*\/\* task336[^\n]*\n\s*[^\n]*try \{ notifyShow\('小 DJ · 任务完成'[^)]*\)[^;]*; \} catch\(e\)\{\}/, '');
}

let pass = 0, fail = 0;
function ok (name, cond) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name) }

ok('bootstrap 调 notifySwRegister()（SW 注册接线）', /(^|\n)notifySwRegister\(\);/.test(htmlW));
ok('bootstrap 挂 20s 看门狗 setInterval(notifyWatchdog, 20000)', /setInterval\(notifyWatchdog, 20000\)/.test(htmlW));
ok('看门狗挂非 popout 页（task206 保活语义）', /if \(!POP_TAB\) setInterval\(notifyWatchdog, 20000\)/.test(htmlW));
ok('bgMissCheck 锁屏补响同时发系统通知（notifyShow）', /notifyShow\('小 DJ · 任务完成'/.test(kaW));
ok('notifyShow 走 SW 优先（reg.showNotification 分支）', /NOTIFY_SW\.reg && typeof NOTIFY_SW\.reg\.showNotification/.test(ka) && /NOTIFY_SW\.reg\.showNotification\(/.test(ka));
ok('notifyShow 判 hidden + 权限（前台不打扰/未授权静默）', /if \(!document\.hidden\) return false/.test(ka) && /Notification\.permission !== 'granted'/.test(ka));
ok('ui/sw.js 存在且处理 notificationclick（聚焦回窗）', fs.existsSync(swPath) && /notificationclick/.test(fs.readFileSync(swPath, 'utf8')));
ok('sw.js 故意不注册 fetch handler（零缓存承诺）', !/addEventListener\(\s*['"]fetch/.test(fs.readFileSync(swPath, 'utf8')));
ok('废弃草稿 notify.js.pending-* 已清零', !fs.existsSync(path.join(PROJ, 'ui/notify.js.pending-task318')));
try { ok('sw.js 已入 git 跟踪（部署通道不缺文件）', execSync('git ls-files -- ui/sw.js', { cwd: PROJ }).toString().trim() === 'ui/sw.js'); }
catch (e) { ok('sw.js 已入 git 跟踪（部署通道不缺文件）', false) }
(function(){ var m = htmlW.match(/personal agent · v[0-9.]+/g) || []; var b = fs.readFileSync(path.join(PROJ, 'ui/src/app/boot.js'), 'utf8').match(/personal agent · v[0-9.]+/g) || []; var p = fs.readFileSync(path.join(PROJ, 'ui/src/pricing/popout.js'), 'utf8').match(/personal agent · v[0-9.]+/g) || []; var all = m.concat(b, p); ok('verText 三处同版（v0.326.0.0）', all.length === 3 && all.every(x => x === all[0]), all.join('|')) })();
ok('内联 script 语法 OK（vm 编译不执行）', (function(){ try { const vm = require('vm'); Array.from(htmlW.matchAll(/<script>([\s\S]*?)<\/script>/g)).forEach(m => new vm.Script(m[1])); return true } catch (e) { return false } })());

const verdict = RED ? (fail > 0) : (fail === 0);
console.log('RESULT: ' + (RED ? '红对照' : '') + (verdict ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(RED ? (verdict ? 2 : 1) : (verdict ? 0 : 1));

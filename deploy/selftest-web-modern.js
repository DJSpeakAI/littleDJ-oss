/* task387 自测：modern-web-guidance 网页现代化改造（体检清单 P0/P1/P2 落地断言）
   覆盖：IME 回车防护 5 处 / 51 脚本全 defer / 内联启动块 DOMContentLoaded 包裹 / innerHTML='' 清零（→replaceChildren）
        / slice().sort|reverse 清零（→toSorted/toReversed+dom.ts polyfill）/ JSON 深拷贝清零（→structuredClone）
        / 滚动条标准属性+@supports 兜底 / :focus-visible / 触屏 hover 还原 / 移动端 iconbtn 44px
        / maskable 图标真独立（≠icon-512 同图）/ ui 部署目录 .bak 零残留 / iconbtn aria-label≥6
        / verText 三处 v0.381.0.0 / proxy 静态白名单 / deploy.sh 凭据零明文
   判别力：计数类断言（51/5/56/0）天然红对照——少一处 defer、漏一处 IME 即 FAIL。
   用法：node deploy/selftest-web-modern.js （exit 0=PASS / 1=FAIL） */
const fs = require('fs'), path = require('path');
const PROJ = path.resolve(__dirname, '..');
const UI = path.join(PROJ, 'ui', 'index.html');
const html = fs.readFileSync(UI, 'utf8');
let pass = 0, fail = 0;
function ok (name, cond, extra) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra != null ? '（' + extra + '）' : '')) }
function readSrc (rel) { return fs.readFileSync(path.join(PROJ, 'ui', 'src', rel), 'utf8') }
function walkSrc () { /* ui/src 全部 .ts 拼接（断言用；.bak 已挪 backup/ui-bak 不在扫描范围） */
  const acc = [];
  (function dir (d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? dir(p) : /\.ts$/.test(f) && acc.push(fs.readFileSync(p, 'utf8')) } })(path.join(PROJ, 'ui', 'src'));
  return acc.join('\n');
}
const SRC = walkSrc();

/* A. IME 回车防护（P0-1：5 处补漏 + panel 原有 1 处不回退） */
const modals = readSrc('app/modals.ts'), tts = readSrc('settings/tts.ts'), boot = readSrc('app/boot.ts'), panel = readSrc('ask/panel.ts');
ok('A1 modals.ts 三处 Enter 全带 IME 防护', (modals.match(/e\.isComposing \|\| e\.keyCode === 229/g) || []).length >= 3, 'hits=' + (modals.match(/e\.isComposing/g) || []).length);
ok('A2 tts.ts 音色别名 Enter 带 IME 防护', /ev\.isComposing \|\| ev\.keyCode === 229/.test(tts));
ok('A3 boot.ts 登录口令 Enter 带 IME 防护', /ev\.key === 'Enter' && !ev\.isComposing && ev\.keyCode !== 229/.test(boot));
ok('A4 panel.ts 原有防护不回退', panel.indexOf('e.isComposing || e.keyCode === 229') >= 0);
/* A5 通用扫描（方案审 P2-7：规范靠机器不靠人看）：src 全部 'Enter' 字符串比较处，窗口内须有 IME 防护或修饰键语义，
   新代码裸奔的 Enter 提交会在此红（红=必查，白名单口径：keyup 不扫/修饰键组合放行，对齐官方 ime-safe-enter-submit Drop when） */
(function () {
  const re = /\.key === 'Enter'/g; let n = 0; const miss = [];
  let m; while ((m = re.exec(SRC))) { n++; const w = SRC.slice(Math.max(0, m.index - 160), m.index + 160); if (!/isComposing|keyCode === 229|keyCode !== 229|shiftKey|ctrlKey|metaKey/.test(w)) miss.push(SRC.slice(SRC.lastIndexOf('\n', m.index) + 1, m.index + 30).split('\n')[0]) }
  ok('A5 Enter 处理器 IME 防护/修饰键语义全覆盖（扫描 ' + n + ' 处）', miss.length === 0, miss.length ? '裸奔：' + miss.slice(0, 3).join(' | ') : 'all guarded');
})();

/* B. 模块脚本全 defer（P0-2；方案审 P1-2/L-063：模块数不写死，裸标签=0 硬界 + defer≥50 宽界，加第 52 个模块不假红） */
const deferN = (html.match(/<script defer src="\/src\//g) || []).length;
const bareN = (html.match(/<script src="\/src\//g) || []).length;
ok('B1 模块脚本全 defer（无裸标签，defer≥50）', deferN >= 50 && bareN === 0, 'defer=' + deferN + ' bare=' + bareN);
ok('B2 --vvh 首帧块保持内联无 defer（体检铁律）', /<script>\s*\n\/\* 首屏防溢出/.test(html) && !/<script defer>\s*\n\/\* 首屏防溢出/.test(html));

/* C. 内联启动块 DOMContentLoaded 包裹（P0-2 配套） */
ok('C1 主内联块以 DOMContentLoaded 开头', /<script>\s*\n\/\* task387（P0-2）[\s\S]*?document\.addEventListener\('DOMContentLoaded', function \(\) \{\s*\n'use strict';/.test(html));
ok('C2 块尾 }); 收口（djSentinel 段之后）', /history\.pushState\(\{ djSentinel: 1 \}, ''\);\s*\n\s*\} catch\(e\)\{\}\s*\n\}\s*\n\}\);/.test(html));
ok('C3 历史拼接重复行已去重（use strict / window.TODO）', (html.match(/'use strict';/g) || []).length === 1 && (html.match(/window\.TODO = TODO/g) || []).length === 1);

/* D. innerHTML='' 清零（P1-1；含双引号变体——产出审/方案审 P2-7 强化；先剥注释防文档描述假红） */
const SRC_CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)[ \t]*\/\/[^\n]*/g, '\n');
ok('D1 ui/src 零 innerHTML 空串清空（单双引号，→replaceChildren）', !/\.innerHTML\s*=\s*(''|"")/.test(SRC_CODE));
ok('D2 replaceChildren 落地 ≥56 处', (SRC.match(/\.replaceChildren\(\)/g) || []).length >= 56, 'n=' + (SRC.match(/\.replaceChildren\(\)/g) || []).length);

/* E. 拷贝排序改 toSorted/toReversed（P1-3）+ polyfill 兜底 */
ok('E1 ui/src 零 .slice().sort( / .slice().reverse(', SRC.indexOf('.slice().sort(') < 0 && SRC.indexOf('.slice().reverse(') < 0);
ok('E2 dom.ts 新 API polyfill（toSorted/toReversed/structuredClone）', readSrc('core/dom.ts').indexOf('toSorted') >= 0 && readSrc('core/dom.ts').indexOf('toReversed') >= 0 && readSrc('core/dom.ts').indexOf('structuredClone') >= 0);

/* F. JSON 深拷贝清零（P1-4；dom.ts polyfill 的降级实现除外——它就是老内核的等价路径） */
const domSrc = readSrc('core/dom.ts');
ok('F1 ui/src 零业务 JSON.parse(JSON.stringify（→structuredClone；polyfill 兜底行除外）', SRC.replace(domSrc, '').indexOf('JSON.parse(JSON.stringify') < 0);

/* G. 滚动条标准属性 + @supports 兜底（P1-2） */
ok('G1 scrollbar-color/scrollbar-width 标准属性上桌', html.indexOf('scrollbar-color: var(--sb-thumb) var(--sb-track)') >= 0 && html.indexOf('scrollbar-width: thin') >= 0);
ok('G2 老内核 @supports 兜底（含 scrollbar-width:auto 还原）', /@supports not \(scrollbar-color: auto\)\{[\s\S]*?scrollbar-width: auto;[\s\S]*?::-webkit-scrollbar\{width:9px/.test(html));
ok('G3 滚动条 token 化（--sb-thumb/--sb-thumb-hover/--sb-track；产出审 P1-2 后 thumb=#5e656d）', html.indexOf('--sb-thumb:#5e656d') >= 0 && html.indexOf('--sb-thumb-hover:#6a7178') >= 0 && html.indexOf('--sb-track:#0d0e10') >= 0);
/* G4 数值断言（方案审 P1-1：不许靠嘴过 3:1）——WCAG 相对亮度公式实算 thumb 对 track 对比度 */
(function () {
  function lum (hex) { const n = parseInt(hex.slice(1), 16); const c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
  function ratio (a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
  const t = html.match(/--sb-thumb:(#[0-9a-fA-F]{6})/), k = html.match(/--sb-track:(#[0-9a-fA-F]{6})/);
  const r = t && k ? ratio(t[1], k[1]) : 0;
  ok('G4 滚动条对比度实算 ≥3:1（WCAG 1.4.11，不许嘴炮）', r >= 3, r.toFixed(2) + ':1');
})();

/* H. 键盘焦点可见（P2-2） */
ok('H1 :focus-visible 全局规则', html.indexOf(':focus-visible{outline:2px solid var(--accent)') >= 0);

/* I. 触屏 hover 不粘住（P2-3） */
ok('I1 @media (hover:none) 还原高频按钮 hover', /@media \(hover:none\)\{ \.iconbtn:hover\{background:none/.test(html));

/* J. 移动端触控目标 44px（P2-4） */
ok('J1 移动端 .iconbtn 44×44', /\.iconbtn\{width:44px;height:44px/.test(html));

/* K. maskable 图标真独立（P2-5：PNG IHDR 尺寸 + 字节差异） */
function pngSize (p) { const b = fs.readFileSync(p); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), size: b.length } }
const m512 = pngSize(path.join(PROJ, 'ui', 'icon-maskable-512.png'));
const i512 = pngSize(path.join(PROJ, 'ui', 'icon-512.png'));
ok('K1 maskable 512×512', m512.w === 512 && m512.h === 512, m512.w + 'x' + m512.h);
ok('K2 maskable 不再与 icon-512 同图（字节差异）', m512.size !== i512.size, m512.size + ' vs ' + i512.size);
ok('K3 manifest maskable ?v 已换', /icon-maskable-512\.png\?v=20261120a/.test(fs.readFileSync(path.join(PROJ, 'ui', 'manifest.webmanifest'), 'utf8')));

/* L. 部署目录 .bak 零残留（P2-6，比体检多扫 ui 根目录） */
let bakN = 0;
(function dir (d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? dir(p) : /\.bak/i.test(f) && bakN++ } })(path.join(PROJ, 'ui'));
ok('L1 ui/ 目录 .bak 零残留（含根目录，比体检清单多兜一处）', bakN === 0, 'n=' + bakN);
ok('L2 备份已挪 backup/ui-bak/（6 个；目录被 .gitignore 忽略，新克隆无此目录时 skip——L1 已足守部署目录）', (function () { try { return fs.readdirSync(path.join(PROJ, 'backup', 'ui-bak')).filter(f => /\.bak/i.test(f)).length >= 6 } catch (e) { return true /* 目录不存在=新克隆/他宿主，非红 */ } })());

/* M. 静态 iconbtn aria-label（P2-7 轻量版） */
ok('M1 iconbtn aria-label ≥6', (html.match(/class="iconbtn" aria-label="/g) || []).length >= 6);

/* N. verText 三处互等（产出审 P2-4：不硬编码版本号，升版免改测试；index 静态一处+boot/popout 各一处） */
(function () {
  const mBoot = readSrc('app/boot.ts').match(/verText'\)\.textContent = 'personal agent · (v[\d.]+)'/);
  const mPop = readSrc('pricing/popout.ts').match(/vt\.textContent = 'personal agent · (v[\d.]+)'/);
  const mHtml = html.match(/id="verText">personal agent · (v[\d.]+)</);
  ok('N1 verText 三处同版（' + ((mHtml && mHtml[1]) || '?') + '）', !!(mBoot && mPop && mHtml) && mBoot[1] === mPop[1] && mPop[1] === mHtml[1]);
})();

/* O. proxy 静态白名单（§8） */
const proxy = fs.readFileSync(path.join(PROJ, 'server', 'proxy.js'), 'utf8');
ok('O1 serveStatic 扩展名白名单上桌', proxy.indexOf('STATIC_EXT_OK') >= 0 && /\.webmanifest/.test(proxy.match(/STATIC_EXT_OK = new Set\(\[[^\]]*\]\)/) ? proxy.match(/STATIC_EXT_OK = new Set\(\[[^\]]*\]\)/)[0] : ''));
ok('O2 .ts/.bak/.md 不在白名单（挡源码/备份匿名下载）', (function () { const m = proxy.match(/STATIC_EXT_OK = new Set\(\[([^\]]*)\]\)/); if (!m) return false; return !/\.ts\b|\.bak|\.md\b/.test(m[1]) })());
/* O3 白名单覆盖自证（方案审 P2-4：静态引用扩展名 ⊆ STATIC_EXT_OK，未来加新资源类型漏配白名单会在此红，不等到线上 404） */
(function () {
  const m = proxy.match(/STATIC_EXT_OK = new Set\(\[([^\]]*)\]\)/); if (!m) { ok('O3 静态引用 ⊆ 白名单', false, 'STATIC_EXT_OK 未解析'); return }
  const okSet = new Set(m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
  const refs = new Set();
  for (const mm of html.matchAll(/(?:src|href)="(\/[^"?]+)"/g)) refs.add(require('path').extname(mm[1]).toLowerCase());
  for (const mm of fs.readFileSync(path.join(PROJ, 'ui', 'manifest.webmanifest'), 'utf8').matchAll(/"src":\s*"(\/[^"?]+)/g)) refs.add(require('path').extname(mm[1]).toLowerCase());
  refs.delete(''); /* '/' 根路径 */
  const bad = [...refs].filter(e => !okSet.has(e));
  ok('O3 页面/manifest 静态引用扩展名 ⊆ 白名单（' + [...okSet].join(' ') + '）', bad.length === 0, bad.length ? '漏配：' + bad.join(' ') : refs.size + ' 类全覆盖');
})();

/* P. deploy.sh 凭据零明文（§8；正则匹配防口令字面再入库，产出审 P2-2） */
/* 开源版：deploy.sh（作者私有部署脚本）未随仓库发布，文件不存在时本项不适用 */
ok('P1 deploy.sh 尾行不再打印口令', !fs.existsSync(path.join(PROJ, 'deploy.sh')) || !/pass\s+0{4,}/.test(fs.readFileSync(path.join(PROJ, 'deploy.sh'), 'utf8')));

console.log('RESULT: ' + (fail ? 'FAIL' : 'PASS') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail ? 1 : 0);

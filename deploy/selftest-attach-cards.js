#!/usr/bin/env node
/* task321 输入区自测（附件三瓷砖恢复 + 手机端待机单行）
 *   ① 附件三瓷砖：点 ＋ 展开 拍照/相册/文件（task321 恢复 task267 口径）
 *   ② 待机单行：手机端待机（body.holdmode）工具行只留 ＋，其余收起
 *   ③ 待机语音条（按住说话 / 轻点进键盘 / 上滑取消）接线（task318/319）
 *   ④ 全屏图片浏览器（对齐 DAG AI Chat）零漂移
 *   ⑤ 原功能零漂移
 *   ⑥ 版本号三处同步（动态口径，L-063：禁写死版本字面量）
 * 退出码 0=全绿，1=有失败 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
/* 模块化后函数源码在 ui/src 各模块（loadUiSource 按 @order 拼接全部模块+内联脚本）；
   HTML 骨架与 CSS 锚点仍在 index.html 原文里，两者拼接保持原单文件锚点口径 */
const ui = require('./selftest-load-ui').loadUiSource(path.join(root, 'ui'))
  + '\n' + fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, hint) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (hint ? '  ← ' + hint : '')); }
}
function has(re) { return typeof re === 'string' ? ui.includes(re) : re.test(ui); }

/* ① 附件三瓷砖退役 + ＋ 直弹系统选择器（task327：主人 2026-11-15 定版「系统面板已含相册/拍照/文件，
      自绘中间层多此一举」。恢复路径=git revert 本单，断言反转时请带 task327 注释整段重写——L-108） */
ok('① ＋ 按钮 #btnPlus 保留在输入栏', has('id="btnPlus"'));
ok('① task327 ＋ 直弹 #filePickInput（桌面/移动统一，无中间层）',
  /\$\('#btnPlus'\)\.onclick = function\(\)\{ \$\('#filePickInput'\)\.click\(\) \};/.test(ui));
ok('① 三瓷砖容器/卡片/相机 input 全退役（task327）',
  !has('id="attachCards"') && !has('id="acCardCam"') && !has('id="acCardGal"') && !has('id="acCardFile"') && !has('id="camInput"'));
ok('① closeAttachPanel/bindAttachCards 函数与导出退役（task327）',
  !/function closeAttachPanel\(\)/.test(ui) && !/function bindAttachCards\(\)/.test(ui)
  && !/window\.closeAttachPanel=closeAttachPanel/.test(ui) && !/window\.bindAttachCards=bindAttachCards/.test(ui));
ok('① 三瓷砖 CSS 退役（基础 display:none / ＋旋转 / 移动端 open grid / 淡入动画，task327）',
  !/\.attach-cards\{display:none\}/.test(ui) && !/#btnPlus\.open\{transform:rotate\(45deg\)\}/.test(ui)
  && !/\.attach-cards\.open\{display:grid/.test(ui) && !/@keyframes acardIn\{/.test(ui));
ok('① 旧卡片接线（cam/gal/fil onclick）零残留（task327）',
  !/bCam\.onclick/.test(ui) && !/bGal\.onclick/.test(ui) && !/bFil\.onclick/.test(ui));
ok('① 面板收起监听（focus/点外部）零残留（task327）', !/addEventListener\('focus', closeAttachPanel\)/.test(ui));
ok('① 发送收面板调用退役（send.js，task327）', !/closeAttachPanel\(\); \/\* task321/.test(ui) && !/^\s*closeAttachPanel\(\);/m.test(ui));
ok('① bindAttachCards 挂载退役（boot 段零调用，task327）', !/bindAttachCards\(\);/.test(ui));
ok('① 旧 #fileInput / pickImages 退役（图片统一走 filePickInput→handleDropFiles，task327）',
  !has('id="fileInput"') && !/function pickImages\(\)/.test(ui) && !/\$\('#fileInput'\)\.click\(\)/.test(ui));
ok('① 文件 input 任意类型仍在', /id="filePickInput" hidden multiple/.test(ui));
ok('① filePickInput change → handleDropFiles（bindImageInput 集中一处）',
  /\$\('#filePickInput'\)\.addEventListener\('change'/.test(ui) && /handleDropFiles\(fs\)/.test(ui));
ok('① bindImageInput 在 index.html 原文仅挂一次（防 filePickInput 双挂重复添加；拼接串因口径固有双份不算）',
  (fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8').match(/bindImageInput\(\);/g) || []).length === 1);

/* ② 待机单行（task321：主人 2026-11-15「默认只有一行，下面这一排都不要显示」；
   task324：＋ 改绝对定位浮左下 → 待机条占满整行、文案真正居中（原 flex 版偏右被主人推翻） */
ok('② 手机端待机收成一排（holdmode → composer-inner relative 定位上下文）',
  /@media \(max-width:940px\)\{\n  body\.holdmode \.composer-inner\{position:relative\}/.test(ui));
ok('② 工具行只留 ＋（其余 ☾/☰/模型/🎙/↑ 收起）',
  /body\.holdmode \.composer-bar > :not\(#btnPlus\)\{display:none\}/.test(ui));
ok('② 待机条那格占满整行（inputwrap width:100%）', /body\.holdmode \.composer-inner > \.inputwrap\{width:100%\}/.test(ui));
ok('② ＋ 绝对定位浮左下且垂直居中于待机条（task325：bottom=框下padding4 + height=条高36 → 与输入区同区间，align-items:center 自动居中）',
  /body\.holdmode \.composer-inner > \.composer-bar\{position:absolute;left:7px;bottom:4px;height:36px;z-index:4/.test(ui));
ok('② task327 inputwrap 去 inline-block 基线空隙（display:flex——空隙 7.6px 曾把 ＋ 顶得低于待机条中心，wrap 高≠textarea 高）',
  /\.inputwrap\{position:relative;display:flex\}/.test(ui));
ok('② 旧 flex 布局零残留（flex:1 / order:-1 已退役）',
  !/body\.holdmode \.composer-inner > \.inputwrap\{flex:1/.test(ui) && !/composer-bar\{order:-1/.test(ui));
/* ⑧ task324：待机（语音）模式下附件缩略行即时显示——主人「不管语音模式还是文本模式都应该直接加载在上面」 */
ok('⑧ 有附件时待机模式不藏缩略行（:not(.has-attach) 条件隐藏）',
  /body\.holdmode:not\(\.has-attach\) \.composer-inner > #attachRow\{display:none!important\}/.test(ui));
ok('⑧ renderAtts 增删/发送统一同步 body.has-attach',
  /classList\.toggle\('has-attach', \(S\.atts\.length \+ \(S\.files \|\| \[\]\)\.length\) > 0\)/.test(ui));
ok('⑧ 发送后清附件仍走 renderAtts（has-attach 随之摘除）',
  /S\.atts = \[\]; S\.files = \[\]; renderAtts\(\);/.test(ui));

/* ③ 待机语音条（task318：对齐 DAG AI Chat 0.499 一栏双态） */
ok('③ 待机条 #holdBar 与两段文案齐', has('id="holdBar"') && has('hb-idle') && has('hb-rec') && has('id="holdRecTxt"'));
ok('③ 待机条默认 hidden（桌面/有草稿不出现）', /<div class="holdbar" id="holdBar" hidden>/.test(ui));
ok('③ 面板盖住输入框（.inputwrap 相对定位 + .holdbar absolute inset:0；task327 起 wrap 带 display:flex）', /\.inputwrap\{position:relative;display:flex\}/.test(ui) && /\.holdbar\{position:absolute;inset:0/.test(ui));
ok('③ 轻点(<300ms)=focus 输入框弹键盘', /if \(!wasArmed\)\{[\s\S]{0,500}?ta\.focus\(\)/.test(ui) && /setTimeout\(holdBarSync, 30\)/.test(ui) && /}, 300\);/.test(ui));
ok('③ 长按 ≥300ms 起录（复用 startVoiceRec）', /HOLD\.armed = true;[\s\S]{0,80}holdStart\(\)/.test(ui) && /HOLD\.pending = true;\s*\n\s*startVoiceRec\(\);/.test(ui));
ok('③ 上滑 ≥60px 进取消态、滑回 <40px 解除', /up >= 60/.test(ui) && /up < 40/.test(ui) && /HOLD\.cancel = true/.test(ui));
ok('③ 松手分流：取消=discard（stopVoiceRec(true)）/ 正常=发送', /function holdEnd\(cancel\)/.test(ui) && /stopVoiceRec\(!!cancel\)/.test(ui));
ok('③ 开录前就松手 → holdAfterStart 收口（首次只提示授权）', /function holdAfterStart\(\)/.test(ui) && /麦克风已就绪，再按住说话就能发/.test(ui) && /holdAfterStart\(\);\s*\/\* task318/.test(ui));
ok('③ 显隐条件含 isMobile + 空输入 + 未聚焦（+按住/转写期间常显）', /b\.hidden = !show/.test(ui) && /isMobile\(\) && \(rec \|\| busy \|\| arming \|\| \(!String\(ta\.value \|\| ''\)\.trim\(\) && document\.activeElement !== ta\)\)/.test(ui));
ok('③ 按住未起录显示「准备麦克风…」', /准备麦克风…/.test(ui) && /var arming = !rec && !busy/.test(ui));
ok('③ 占位符吞噬 body.holdmode', /body\.holdmode #input::placeholder\{color:transparent\}/.test(ui));
ok('③ 绑定挂进 boot（bindHoldBar）', /bindHoldBar\(\); \/\* task318/.test(ui) && /window\.bindHoldBar=bindHoldBar/.test(ui));
ok('③ 语音状态变化同步待机条（micBtnState → holdBarSync）', /holdBarSync\(\); \/\* task318：待机条跟随语音状态/.test(ui));

/* ④ 全屏图片浏览器（对齐 DAG AI Chat） */
ok('④ 查看器全屏黑底 inset:0', /#imgViewer\{position:fixed;inset:0;z-index:60;background:rgba\(0,0,0,\.96\)/.test(ui));
ok('④ ×/左右箭头/计数/保存 元素齐', has('id="ivClose"') && has('id="ivPrev"') && has('id="ivNext"') && has('id="ivCount"') && has('id="ivSave"'));
ok('④ 箭头 [hidden] 显式隐藏（防 display:grid 压 UA）', /#ivPrev\[hidden\],#ivNext\[hidden\]\{display:none\}/.test(ui));
ok('④ ivGo 切换已定义', /function ivGo\(d\)/.test(ui));
ok('④ 单击图片即关（DAG 同款）', /\$\('#imgViewerImg'\)\.onclick = closeImageViewer/.test(ui));
ok('④ 点黑底关闭', /\$\('#imgViewer'\)\.onclick = function\(e\)\{ if \(e\.target === this\) closeImageViewer\(\) \}/.test(ui));
ok('④ 滑动切换（>40px 阈值）', /Math\.abs\(dx\) > 40/.test(ui));
ok('④ ←/→ 键盘切换', /e\.key === 'ArrowLeft'/.test(ui) && /e\.key === 'ArrowRight'/.test(ui));
ok('④ 保存走 a[download]', /link\.download = a\.name/.test(ui));
ok('④ 附件组切换（S.atts findIndex）', /list\.findIndex\(function\(a\)\{ return a\.url === src \}\)/.test(ui));
ok('④ 旧小窗样式已退役（无 top:6vh）', !/top:6vh/.test(ui));
ok('④ 旧按钮 #imgViewerClose 引用零残留', !/imgViewerClose/.test(ui));

/* ⑤ 原功能零漂移（task327：fileInput 已随三瓷砖退役，此处锚不动的部分） */
ok('⑤ #filePickInput 成为 ＋ 唯一附件入口（task327）', /btnPlus'\)\.onclick = function\(\)\{ \$\('#filePickInput'\)\.click\(\) \};/.test(ui) || has("id=\"filePickInput\" hidden multiple"));
ok('⑤ renderAtts 缩略图未改', /function renderAtts\(\)/.test(ui) && /el\('div', 'thumb'\)/.test(ui));
ok('⑤ ESC 关查看器链路仍在', /if \(iv && !iv\.hidden\)\{ closeImageViewer\(\)/.test(ui));
ok('⑤ 图片/文件入口复用既有链（addImageFile/handleDropFiles）', /addImageFile\(f\)/.test(ui) && /handleDropFiles\(fs\)/.test(ui));

/* ⑥ 版本号同步（动态口径，L-063：禁写死版本字面量） */
(function(){ var mm = ui.match(/personal agent · v[0-9.]+/g) || []; ok('⑥ verText 三处且唯一', mm.length === 3 && mm[0] === mm[1] && mm[1] === mm[2], 'got ' + mm.join(',')); })();

/* ⑦ task322：点按穿透 + 长按放大镜（DJ 2026-11-15 实机报障） */
ok('⑦ 待机条 touchstart 非 passive preventDefault（禁长按放大镜 + 掐合成 click）',
  /b\.addEventListener\('touchstart', function\(e\)\{ if \(e\.cancelable\) e\.preventDefault\(\) \}, \{ passive: false \}\)/.test(ui));
ok('⑦ contextmenu / selectstart 一并拦掉', /addEventListener\('contextmenu', function\(e\)\{ e\.preventDefault\(\) \}\)/.test(ui) && /addEventListener\('selectstart', function\(e\)\{ e\.preventDefault\(\) \}\)/.test(ui));
ok('⑦ 轻点幽灵 click 兜底（500ms / ±30px 内吞掉，输入框自身放行）',
  /function holdGhostClick\(e\)/.test(ui) && /HOLD_GUARD\.t = Date\.now\(\) \+ 500/.test(ui)
  && /document\.addEventListener\('click', holdGhostClick, true\)/.test(ui) && /closest\('#holdBar,#input'\)/.test(ui));
ok('⑦ 待机条去高亮闪烁', /-webkit-tap-highlight-color:transparent/.test(ui));

console.log('\nRESULT: ' + (fail === 0 ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(fail === 0 ? 0 : 1);

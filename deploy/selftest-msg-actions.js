/* task195 自测：消息操作按钮「复制 + 叉叉停止」（纯静态断言 + 内联脚本语法，不碰生产服务）
   验：按钮串 / 点击分支 / 死函数清零 / 版本号 / 双内联 script 语法 / 红对照（--red 用旧按钮串应 FAIL）
   用法：node deploy/selftest-msg-actions.js        （exit 0=PASS / 1=FAIL）
        node deploy/selftest-msg-actions.js --red   （红对照：注入旧代码，预期 FAIL，exit 2=PASS） */
const fs = require('fs'), path = require('path'), vm = require('vm');
const PROJ = path.resolve(__dirname, '..');
const UI = path.join(PROJ, 'ui', 'index.html');
const RED = process.argv.includes('--red');
/* task315 模块化迁移（术后修补）：按钮串/点击分支已搬 ui/src/chat/messages.js、verText 三处分布=
   index.html(HTML 初始) + app/boot.js + pricing/popout.js——断言源改为「模块拼接 + index.html 原文」
   （照 selftest-robot 样板；.bak-* 无契约头不进拼接，verText 恰 3 处口径不变） */
let html = require('./selftest-load-ui').loadUiSource(path.join(PROJ, 'ui'))
  + '\n' + fs.readFileSync(UI, 'utf8');

if (RED) {
  /* 红对照：把按钮串换回旧版三按钮，点击分支换回 retry —— 断言集必须能咬住 */
  html = html.replace(
    /acts\.innerHTML = '<button data-act="copy"[\s\S]*?<\/button>';/,
    `acts.innerHTML = '<button data-act="copy" title="复制">⧉</button><button data-act="retry" title="重试">↻</button><button data-act="more" title="更多">⋯</button>';`
  );
}

let pass = 0, fail = 0;
function ok (name, cond) { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name) }

/* ---- 带注释剥离的正文（断言产品代码不依赖注释文案） ---- */
const btnLine = (html.match(/acts\.innerHTML = '<button data-act="copy"[^]*?<\/button>';/) || [''])[0];
const clickBlock = (() => {
  const i = html.indexOf("var act = t && t.closest ? t.closest('[data-act]') : null;");
  return i < 0 ? '' : html.slice(i, i + 1200);
})();
/* 断言产品代码用剥离注释后的正文（注释文案不算产品行为，如 P1 说明行里的「右上角 ■」） */
const clickCode = clickBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

ok('按钮串保留「复制」', btnLine.includes('data-act="copy"'));
ok('按钮串新增「叉叉停止」✕', btnLine.includes('data-act="stop"') && btnLine.includes('✕'));
ok('叉叉 title 说明「停止生成（同电脑 ESC）」', btnLine.includes('title="停止生成（同电脑 ESC）"'));
ok('按钮串不含「刷新」retry（零残留）', !btnLine.includes('data-act="retry"'));
ok('按钮串不含「三个点」more（零残留）', !btnLine.includes('data-act="more"'));
ok('点击分支改为 stop 语义', clickCode.includes("act.dataset.act === 'stop'"));
ok('点击分支 retry 分支零残留', !clickCode.includes("=== 'retry'"));
ok('stop 分支有 S.busy 判定', clickCode.includes('if (S.busy)'));
ok('stop 分支 busy 时调 stopTask()', /if \(S\.busy\)\{ stopTask\(\);/.test(clickCode));
ok('busy toast=「已停止当前对话」（P1：不提停全部）', clickCode.includes('toast(\'已停止当前对话\')'));
ok('toast 不指向手机不可见的 ■（P1 落实）', !clickCode.includes('右上角 ■'));
ok('非 busy 时明确提示', clickCode.includes('当前没有正在生成的回复'));
ok('死函数 retryLast 定义已删（仅注释可提及）', !/function retryLast\s*\(/.test(html));
ok('stop 分支不触碰 stopAll（停全部入口唯一）', !/act\.dataset\.act === 'stop'[^]*?stopAll\(/.test(clickCode));
ok('verText 恰 3 处且同版本（task214 顺手修：原写死 v0.195 每升版必红）', (function(){ var m = html.match(/personal agent · v[0-9.]+/g) || []; return m.length === 3 && m[0] === m[1] && m[1] === m[2] })());
ok('错误文案不再指向已删的 ↻ 按钮（死指引清零）', !/请点「↻」/.test(html));

/* ---- 双内联 script 语法（vm.Script 编译，不执行） ---- */
const scripts = Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map(m => m[1]);
ok('内联 script 块数=2', scripts.length === 2);
scripts.forEach((code, i) => {
  try { new vm.Script(code); ok('内联脚本 #' + (i + 1) + ' 语法 OK', true) }
  catch (e) { ok('内联脚本 #' + (i + 1) + ' 语法 OK（' + (e && e.message) + '）', false) }
});

const verdict = RED ? (fail > 0) : (fail === 0);
console.log('RESULT: ' + (RED ? '红对照' : '') + (verdict ? 'PASS' : 'FAIL') + '（' + pass + ' PASS / ' + fail + ' FAIL）');
process.exit(RED ? (verdict ? 2 : 1) : (verdict ? 0 : 1));

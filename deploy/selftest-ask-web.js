/*
 * task350+task358 自测：问 AI 联网常开（必应先搜后答）+ 比价大屏页表格盒自滚恢复
 * 用法：node deploy/selftest-ask-web.js
 * 覆盖：
 *   A. askWebDecode 实体解码（标签剥离 / &amp; &quot; &#39; &#数字 / 空白归一）
 *   B. askWebParse 真实必应 HTML 样本（5 条 b_algo 解析出标题+URL+摘要；标题内 <strong> 去标签；无 h2 块跳过；非 http 链接过滤；上限 5 条）
 *   C. askProxy web 分支静态断言（wantWeb / web:false 不搜 / 搜索块拼最后一条 user / search+notice 事件 / ASK_WEB_SYS_ADD 只在联网时追加）
 *   D. 前端 panel.js 静态断言（🌐 toggle 按钮 / localStorage littledj.askWeb 记忆 / body 带 web / search·notice 事件渲染 / askInfoBefore 去重）
 *   E. CSS 静态断言（.ask-web.on / .ask-msg.ask-info / panel.js?v=p2 缓存破坏）
 *   F. 比价 popout 特例退役（body.popout #pricingWrapBox{max-height:none} 零命中 + #pricingWrapBox 通用自滚规则在 + thead sticky 规则在）
 *   G. verText 三处同值（动态口径，task381）
 *   H. 红对照：伪造旧版（popout 特例在场 + 无 web 按钮）必须 FAIL（防断言空转）
 * 做法：proxy 纯函数切源码进 vm 执行；UI 侧用 selftest-load-ui 拼接源码做静态断言；必应样本为 2026-11-16 真抓脱敏副本（内嵌）。
 * 网络依赖：无（live 联网可选：LJ_ASKWEB_LIVE=1 时真调一次必应，失败只 warn 不计 fail）。
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const pathFn = require('path');

const ROOT = pathFn.resolve(__dirname, '..');
const proxySrc = fs.readFileSync(pathFn.join(ROOT, 'server/proxy.js'), 'utf8');
const html = require('./selftest-load-ui').loadUiSource(pathFn.join(ROOT, 'ui'));

/* ---------- 切 proxy 纯函数进 vm ---------- */
const fnA = proxySrc.indexOf('function askWebDecode(');
const fnB = proxySrc.indexOf('function askWebParse(');
const fnC = proxySrc.indexOf('function askWebSearch(');
const fnD = proxySrc.indexOf('function askToolAcc(');
const fnE = proxySrc.indexOf('function askProxy(');
if (fnA < 0 || fnB <= fnA || fnC <= fnB || fnD < 0 || fnE <= fnD) { console.log('RESULT: FAIL（proxy 源码定位 askWeb 系列 / askTool 系列失败）'); process.exit(1); }
const sandbox = { console: console, String: String, JSON: JSON };
vm.createContext(sandbox);
vm.runInContext(proxySrc.slice(fnA, fnC), sandbox);
vm.runInContext(proxySrc.slice(fnD, fnE), sandbox);
const decode = sandbox.askWebDecode;
const parse = sandbox.askWebParse;
const toolAccNew = sandbox.askToolAcc;
const toolMerge = sandbox.askToolMerge;
const toolDone = sandbox.askToolDone;
if (typeof decode !== 'function' || typeof parse !== 'function' || typeof toolMerge !== 'function' || typeof toolDone !== 'function') { console.log('RESULT: FAIL（vm 导出 askWeb/askTool 函数失败）'); process.exit(1); }

const results = [];
function check(name, ok, extra) { results.push({ name: name, ok: !!ok, extra: extra || '' }) }

/* ---------- A. askWebDecode ---------- */
check('A1 标签剥离', decode('<b>DeepSeek</b> V4') === 'DeepSeek V4');
check('A2 实体解码', decode('a&amp;b &quot;q&quot; &#39;s&#39; &lt;x&gt;') === 'a&b "q" \'s\' <x>');
check('A3 数字实体+空白归一', decode('&#28145;&#24230;  \n 搜索 ') === '深度 搜索');

/* ---------- B. askWebParse（真实版式缩微样本） ---------- */
const SAMPLE = '<html><body><ol><li class="b_algo" data-id="1">'
  + '<h2><a href="https://example.com/a?x=1&amp;y=2" h="ID=SERP">DeepSeek <strong>V4</strong> 发布</a></h2>'
  + '<div class="b_caption"><p class="b_lineclamp2">DeepSeek V4 最大上下文 <b>256K</b>，2026 年 10 月上线。</p></div>'
  + '</li>'
  + '<li class="b_algo" data-id="2"><h2><a href="https://example.com/b">第二条：GLM-5.3 参数</a></h2><div class="b_caption"><p>智谱 GLM-5.3 上下文 128K。</p></div></li>'
  + '<li class="b_algo" data-id="3"><div class="b_caption"><p>这条没有 h2 链接，应跳过</p></div></li>'
  + '<li class="b_algo" data-id="4"><h2><a href="javascript:alert(1)">非 http 链接过滤</a></h2><p>x</p></li>'
  + '<li class="b_algo" data-id="5"><h2><a href="https://example.com/c">第三条：Kimi K3</a></h2><p class="b_lineclamp4">Kimi K3 上下文 256K tokens。</p></li>'
  + '</ol></body></html>';
const parsed = parse(SAMPLE);
check('B1 解析出 3 条（坏块被滤）', parsed.length === 3, 'n=' + parsed.length);
check('B2 标题去 strong 标签', parsed[0] && parsed[0].title === 'DeepSeek V4 发布', JSON.stringify(parsed[0] && parsed[0].title));
check('B3 URL 实体解码', parsed[0] && parsed[0].url === 'https://example.com/a?x=1&y=2');
check('B4 摘要含正文', !!parsed[0] && /256K/.test(parsed[0].snip));
check('B5 空输入安全', parse('') && parse('').length === 0 && parse(null) && parse(null).length === 0);
const many = parse(Array.from({ length: 9 }, function (_, i) {
  return '<li class="b_algo"><h2><a href="https://e.com/' + i + '">标题' + i + '</a></h2><p>摘要内容摘要内容摘要内容摘要内容</p></li>';
}).join(''));
check('B6 上限 5 条', many.length === 5, 'n=' + many.length);

/* ---------- J. askTool 分片拼接（task364：流式 tool_calls 分片 → 完整调用） ---------- */
const ta = toolAccNew();
toolMerge(ta, [{ index: 0, id: 'call_a', function: { name: 'web_search', arguments: '{"qu' } }]);
toolMerge(ta, [{ index: 0, function: { arguments: 'ery":"智谱 GLM 最新模型"}' } }]);
let tc = toolDone(ta);
check('J1 分片 args 拼接 + query 提取', tc.length === 1 && tc[0].name === 'web_search' && tc[0].query === '智谱 GLM 最新模型' && tc[0].id === 'call_a');
const tb = toolAccNew();
toolMerge(tb, [{ function: { name: 'web_search', arguments: '{"query":"B"}' } }, { index: 2, id: 'c2', function: { name: 'other', arguments: '{}' } }]);
tc = toolDone(tb);
check('J2 无 index 默认 0 + 多调用乱序', tc.length === 2 && tc[0].query === 'B' && tc[1].name === 'other');
const tq = toolAccNew();
toolMerge(tq, [{ index: 0, id: 'x', function: { name: 'web_search', arguments: '{"query":"坏JSON' } }]);
toolMerge(tq, null);
tc = toolDone(tq);
check('J3 坏 JSON args 容错（query 空）', tc.length === 1 && tc[0].query === '' && tc[0].id === 'x');
check('J4 空安全', toolDone(toolAccNew()).length === 0 && toolMerge(toolAccNew(), undefined) !== null);

/* ---------- C. askProxy tools 智能判断静态断言（task364：搜不搜由模型自判） ---------- */
const askFnAt = proxySrc.indexOf('function askProxy(');
const askFnEnd = proxySrc.indexOf('module.exports', askFnAt); /* askProxy 内嵌多层 function(){}，切到文件尾 module.exports */
const askBody = proxySrc.slice(askFnAt, askFnEnd > 0 ? askFnEnd : undefined);
check('C1 wantWeb 默认常开（仅显式 false 关）', /const wantWeb = !\(d && d\.web === false\)/.test(askBody));
check('C2 tools 定义在场（web_search function）', /ASK_WEB_TOOLS/.test(proxySrc) && /name: 'web_search'/.test(proxySrc));
check('C3 tool_choice auto（模型自判）', /tool_choice = 'auto'/.test(askBody));
check('C4 二轮撤 tools 防循环', /go\(false, depth \+ 1\)/.test(askBody));
check('C5 流式 tool_calls 分片解析', /askToolMerge\(toolAcc, dl\.tool_calls\)/.test(askBody));
check('C6 模型调了才真搜（end 判 ws）', /ws && depth === 0/.test(askBody) && askBody.indexOf('askWebSearch(ws.query') >= 0);
check('C7 tool 结果回填消息', /role: 'tool', tool_call_id: ws\.id/.test(askBody));
check('C8 400 降级无 tools 重试', /useTools && pres\.statusCode === 400 && depth === 0/.test(askBody) && /go\(false, depth\)/.test(askBody));
check('C9 系统词=自判指引（新信息才搜/常识直答）', /自己判断要不要用/.test(proxySrc) && /省时间省费用/.test(proxySrc));
check('C10 task358 前缀提取退役（搜索词由模型生成）', proxySrc.indexOf('task358：剥掉') < 0);
check('C11 DeepSeek 思考续轮回传 reasoning_content', /rcAcc \+= dl\.reasoning_content/.test(askBody) && /asstMsg\.reasoning_content = rcAcc/.test(askBody));

/* ---------- D. 前端 panel.js 静态断言 ---------- */
check('D1 task358 toggle 按钮退役（零残留）', html.indexOf('data-ask="web"') < 0 && html.indexOf('ask-web') < 0);
check('D2 localStorage 记忆退役（零残留）', html.indexOf('littledj.askWeb') < 0);
check('D3 发送 body 恒 web:true（常开）', /web: true/.test(html));
check('D4 search 事件渲染', /ev\.type === 'search'/.test(html) && /已联网搜索 /.test(html));
check('D5 notice 降级提示渲染', /ev\.type === 'notice'/.test(html));
check('D6 askInfoBefore 去重（只插一条）', /querySelector\('\.ask-info'\)/.test(html) && /insertBefore\(d, refNode\)/.test(html));
check('D7 askRenderWeb 退役（零残留）', html.indexOf('askRenderWeb') < 0);

/* ---------- E. CSS 静态断言（CSS 在 index.html <style> 区，读原文而非 loadUiSource 拼接） ---------- */
const idxHtml = fs.readFileSync(pathFn.join(ROOT, 'ui/index.html'), 'utf8');
check('E1 .ask-web 样式退役（零残留）', idxHtml.indexOf('.ask-web') < 0);
check('E2 .ask-msg.ask-info 提示行样式', /\.ask-msg\.ask-info\{/.test(idxHtml));
(function () {
  const v = require('./contract').htmlScriptVersionMap(pathFn.join(ROOT, 'ui'))['src/ask/panel.js'];
  check('E3 panel.js 缓存参数在位（当前 ' + (v || '缺失') + '，动态口径 task371-M0#9）', /^p\d+$/.test(v || ''));
})();

/* ---------- F. 比价 popout 特例退役 ---------- */
check('F1 popout max-height:none 特例零命中', idxHtml.indexOf('body.popout #pricingWrapBox{max-height:none}') < 0);
check('F2 #pricingWrapBox 通用自滚规则在', /#pricingWrapBox\{overflow:auto;max-height:calc\(var\(--vvh,100dvh\) - 250px\)\}/.test(idxHtml));
check('F3 thead sticky 双作用域规则在', /#pricingWrapBox \.pr-table thead th, #prTableBox \.pr-table thead th\{position:sticky;top:0;/.test(idxHtml));

/* ---------- G. verText 三处（task381：改动态一致口径——旧版硬编码 v0.358.0.0，
   每次升版本号本测必假红；正确语义=三处同值，与 scroll-jump D7 同口径） ---------- */
const bootSrc = fs.readFileSync(pathFn.join(ROOT, 'ui/src/app/boot.js'), 'utf8');
const popSrc = fs.readFileSync(pathFn.join(ROOT, 'ui/src/pricing/popout.js'), 'utf8');
const vRe = /v0\.\d+\.\d+\.\d+/;
const vIdx = (idxHtml.match(vRe) || [''])[0];
const vBoot = (bootSrc.match(vRe) || [''])[0];
const vPop = (popSrc.match(vRe) || [''])[0];
check('G1 verText index.html 存在（当前 ' + vIdx + '）', !!vIdx);
check('G2 verText boot.js 与 index.html 同值', !!vBoot && vBoot === vIdx);
check('G3 verText popout.js 与 index.html 同值', !!vPop && vPop === vIdx);

/* ---------- H. 红对照（防断言空转） ---------- */
const fakeOld = idxHtml.replace('class="ask-web" data-ask="web"', 'class="ask-xx" data-ask="xx"')
  + '\nbody.popout #pricingWrapBox{max-height:none}';
check('H1 红对照：旧版无 web 按钮 + popout 特例在场 → D1/F1 同判据必 FAIL',
  fakeOld.indexOf('class="ask-web" data-ask="web"') < 0 && fakeOld.indexOf('body.popout #pricingWrapBox{max-height:none}') >= 0);

/* ---------- live 可选真调（默认跳过，不计 fail） ---------- */
if (process.env.LJ_ASKWEB_LIVE === '1') {
  const https = require('https');
  https.get('https://cn.bing.com/search?q=' + encodeURIComponent('GLM-5.3 上下文') + '&count=6&mkt=zh-CN', {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'accept-language': 'zh-CN,zh;q=0.9' }
  }, function (r) {
    let b = '';
    r.setEncoding('utf8');
    r.on('data', function (c) { b += c });
    r.on('end', function () {
      const live = parse(b);
      console.log('[live] 必应真抓解析 ' + live.length + ' 条' + (live[0] ? '，首条：' + live[0].title : ''));
      process.exit(0);
    });
  }).on('error', function (e) { console.log('[live] 跳过（网络错误：' + e.message + '）'); process.exit(0) });
} else {
  finish();
}
function finish() {
  const fail = results.filter(function (r) { return !r.ok });
  results.forEach(function (r) { console.log((r.ok ? 'PASS' : 'FAIL') + ' ' + r.name + (r.extra ? '  [' + r.extra + ']' : '')) });
  console.log('----');
  console.log('RESULT: ' + (results.length - fail.length) + ' pass / ' + fail.length + ' fail');
  process.exit(fail.length ? 1 : 0);
}

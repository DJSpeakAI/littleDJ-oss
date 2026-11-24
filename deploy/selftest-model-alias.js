#!/usr/bin/env node
/* task337 自测：模型别名跨设备同步（服务端单源化）
   用法：node deploy/selftest-model-alias.js
   覆盖：①aliasMerge 纯函数（server 胜/本地新增上行/空值不上行/双空/脏输入）
        ②后端静态断言（路由 GET/POST、PUBNET 拒写、key 正则、条目上限、chmod 600）
        ③前端静态断言（getModelAliases 单源、两保存点走 setModelAliases、
          localStorage 直写残留=0、boot 串接、缓存破坏参数、verText）
   沙箱：vm 提取 ui 真源码函数，零 DOM 依赖；服务端用源码断言（路由真测在重启 proxy 后手工/线上断言） */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadUiSource } = require('./selftest-load-ui.js');

const UI_DIR = process.env.UI_DIR || path.join(__dirname, '..', 'ui');
const PROXY = path.join(__dirname, '..', 'server', 'proxy.js');
const src = loadUiSource(UI_DIR);
const proxySrc = fs.readFileSync(PROXY, 'utf8');

function grab (name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('源码未找到函数：' + name);
  let depth = 0;
  const j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1) }
  }
  throw new Error('函数未闭合：' + name);
}

const out = { pass: 0, fail: 0, items: [] };
function ok (name, cond, detail) {
  out.items.push({ name, pass: !!cond, detail: detail || '' });
  if (cond) out.pass++; else out.fail++;
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  [' + detail + ']' : ''));
}

/* ---------- ① aliasMerge 纯函数 ---------- */
const aliasMerge = new Function('return (' + grab('aliasMerge') + ')')();
(function () {
  const a = aliasMerge(
    { 'zhipuai-coding-plan/glm-5.3': 'GLM 官方' },
    { 'zhipuai-coding-plan/glm-5.3': '本地旧名', 'deepseek/deepseek-flash': '小快闪' }
  );
  ok('①同 key 冲突服务端胜', a.merged['zhipuai-coding-plan/glm-5.3'] === 'GLM 官方', JSON.stringify(a.merged));
  ok('①本地新增 key 进合并并计入上行', a.merged['deepseek/deepseek-flash'] === '小快闪' && a.uploaded['deepseek/deepseek-flash'] === '小快闪', JSON.stringify(a.uploaded));
  ok('①服务端已有 key 不进上行增量', !('zhipuai-coding-plan/glm-5.3' in a.uploaded), JSON.stringify(a.uploaded));
})();
(function () {
  const a = aliasMerge({ 'zhipuai-coding-plan/glm-5.3': 'A' }, { 'zhipuai-coding-plan/glm-5.3[1m]': 'B' });
  ok('①[1m] 拆行 key 是独立 key（合并互不吞）', a.merged['zhipuai-coding-plan/glm-5.3'] === 'A' && a.merged['zhipuai-coding-plan/glm-5.3[1m]'] === 'B', JSON.stringify(a.merged));
})();
(function () {
  const a = aliasMerge({}, { 'x/y': '' , 'a/b': 'ok' });
  ok('①本地空值别名不上行（已清除语义）', a.uploaded['x/y'] === undefined && a.merged['x/y'] === undefined && a.merged['a/b'] === 'ok', JSON.stringify(a.merged));
})();
(function () {
  const a = aliasMerge(null, null);
  ok('①双空输入安全（返回空集）', JSON.stringify(a.merged) === '{}' && JSON.stringify(a.uploaded) === '{}', JSON.stringify(a));
})();
(function () {
  const a = aliasMerge({ 'a/b': 'S' }, {});
  ok('①纯服务端（新设备）原样通过零上行', a.merged['a/b'] === 'S' && Object.keys(a.uploaded).length === 0, JSON.stringify(a));
})();

/* ---------- ② 后端静态断言 ---------- */
ok('②GET /_model-alias 路由存在', /pn === '\/_model-alias'[\s\S]{0,400}req\.method === 'GET'[\s\S]{0,120}readModelAlias\(\)/.test(proxySrc));
ok('②POST /_model-alias 全量覆写+force 透传存在', /req\.method === 'POST'[\s\S]{0,900}writeModelAlias\(inMap, \{ force: force \}\)/.test(proxySrc) && /body 需要 \{ alias:/.test(proxySrc));
ok('②写前备份 .bak（task343：误清可回滚）', /MODEL_ALIAS_BAK/.test(proxySrc) && /copyFileSync\(MODEL_ALIAS_FILE, MODEL_ALIAS_BAK\)/.test(proxySrc));
ok('②拒空覆写守卫（非空库→409/ALIAS_EMPTY_GUARD；force 例外）', /ALIAS_EMPTY_GUARD/.test(proxySrc) && /!Object\.keys\(clean\)\.length && Object\.keys\(cur\)\.length && !force/.test(proxySrc) && /json\(res, 409/.test(proxySrc));
ok('②原子落盘（.tmp + rename，防半截 JSON）', /MODEL_ALIAS_FILE \+ '\.tmp'/.test(proxySrc) && /renameSync\(tmp, MODEL_ALIAS_FILE\)/.test(proxySrc));
ok('②PUBNET_DENY_WRITE 拒公网写别名', /PUBNET_DENY_WRITE = \[[^\]]*'\/_model-alias'/.test(proxySrc));
ok('②ALIAS_KEY_RE key 白名单正则存在（modelID 段允许内斜杠，御审 P1-2）', proxySrc.includes('ALIAS_KEY_RE = /^[a-z0-9-]+') && proxySrc.includes('[A-Za-z0-9._\\[\\]\\/-]+$') && /ALIAS_KEY_RE\.test\(k\)/.test(proxySrc));
ok('②别名条目上限 200 防刷', /别名条目超限（>200）/.test(proxySrc));
ok('②落盘 chmod 600（与 Key 库同规）', /chmodSync\(MODEL_ALIAS_FILE, 0o600\)/.test(proxySrc));
ok('②值 trim + 64 字符截断', /v\.trim\(\)\.slice\(0, 64\)/.test(proxySrc));
ok('②POST body 拒数组形态 alias', /\!Array\.isArray\(d\.alias\)/.test(proxySrc));

/* ---------- ②b 御审 P0/P1 修复项防复发 ---------- */
ok('②bGET 判 HTTP 状态（!r.ok 即 throw，不把错误体当空服务端——御审 P0-2）', /if \(!r\.ok\) throw new Error\('HTTP ' \+ r\.status\);/.test(proxySrc) || /if \(!r\.ok\) throw new Error\('HTTP ' \+ r\.status\)/.test(src) || /fetch\('\/_model-alias'\)\.then\(function\(r\)\{\s*if \(!r\.ok\) throw/.test(src.replace(/\r/g, '')));
ok('②bbootPopout 渲染前水化别名单源（弹窗页独立上下文，御审 P0-1；task343 加 8s 兜底）', /function bootPopout\(\)\{[\s\S]{0,1800}syncModelAliasBoot\(\)[\s\S]{0,900}POP_TAB === 'apikey'/.test(src) && /Promise\.race\(\[\s*syncModelAliasBoot\(\),[\s\S]{0,160}setTimeout\(res, 8000\)/.test(src));
ok('②bPOST 核验三件套：r.ok + d.ok + count（御审 P0-2）', /function aliasPostVerified\(al, force\)\{[\s\S]{0,500}r\.ok && !!\(d && d\.ok\)[\s\S]{0,200}count/.test(src));
ok('②b交互保存失败真分支：up.ok+count 校验 + reject 也落 pending（御审二轮 P1-1/P1-5）', /var onFail = function\(\)\{[\s\S]{0,160}modelAlias\.pending/.test(src) && /up && up\.ok && up\.count === expected/.test(src) && /\}, function\(\)\{\s*onFail\(\);\s*return \{ ok: false, count: 0 \};\s*\}\);/.test(src));
ok('②b上行失败暂存 pending 本地副本（下次启动并入上行，御审 P1-3）', /modelAlias\.pending/.test(src) && /setItem\('littledj\.modelAlias\.pending'/.test(src));
ok('②b清除旧存储前先留 .bak 供回滚回灌（御审 P1-4）', /modelAlias\.bak/.test(src) && /setItem\('littledj\.modelAlias\.bak'/.test(src));
ok('②b页内自测别名段有水化门槛 aliasSynced()（御审 P1-1）', /if \(!aliasSynced\(\)\)/.test(fs.readFileSync(path.join(UI_DIR, 'src/selftest/selftest.js'), 'utf8')));
ok('②b页内自测服务端链等齐后才收尾（stAliasAsync 收集+Promise.all await，断言必进报告——御审二轮 P1-2）', (()=>{ const st=fs.readFileSync(path.join(UI_DIR,'src/selftest/selftest.js'),'utf8'); return /var stAliasAsync = \[\]/.test(st) && st.split('stAliasAsync.push(').length-1>=2 && /await Promise\.all\(stAliasAsync\)/.test(st) && /waitSrvHas\(ak\)/.test(st); })());
ok('②b别名输入框 maxlength=64（与服务端截断一致，御审 P2-5）', fs.readFileSync(path.join(UI_DIR, 'src/pricing/keywin.js'), 'utf8').includes('maxlength="64"') && /aInp\.maxLength = 64/.test(fs.readFileSync(path.join(UI_DIR, 'src/pricing/keywin.js'), 'utf8')));
ok('②bgetModelAliases 返回浅拷贝（防活引用绕过上行，御审 P2-1）', /function getModelAliases\(\)\{[\s\S]{0,220}Object\.keys\(_aliasMap\)\.forEach[\s\S]{0,140}return c;[\s\S]{0,40}\}/.test(src));

/* ---------- ③ 前端静态断言 ---------- */
ok('③getModelAliases 改读内存单源+浅拷贝（不再解析 localStorage，御审 P2-1）', /function getModelAliases\(\)\{[\s\S]{0,260}Object\.keys\(_aliasMap\)\.forEach[\s\S]{0,160}return c;\s*\}/.test(src));
ok('③setModelAliases 内存即更 + 上行走已核验 POST（御审 P0-2）', /function setModelAliases\(al\)\{[\s\S]{0,2000}aliasPostVerified\(_aliasMap, force\)/.test(src));
ok('③setModelAliases 未水化禁写（task343：防空 map 清库）', /function setModelAliases\(al\)\{[\s\S]{0,260}if \(!_aliasSynced\)\{[\s\S]{0,180}别名同步未完成/.test(src));
ok('③清空最后一条需确认 + 自检还原带 force（task343）', /这是最后一条模型别名/.test(src) && /window\.confirm/.test(src) && /typeof _stBusy !== 'undefined' && _stBusy/.test(src) && /force = true/.test(src));
ok('③确认清空即写 bakRestored（防响应丢失后复活，御审 P1-2/P2-1）', /clearedAll = true/.test(src) && /if \(clearedAll && !inTest\) markBakRestored\(\)/.test(src));
ok('③GET 失败保持 _aliasSynced=false（禁写，御审 P1-1）', /\.catch\(function\(\)\{[\s\S]{0,420}_aliasSynced = false;/.test(src));
ok('③local 为空对象 {} 不覆盖 .bak（御审 P1-3）', /if \(local && Object\.keys\(local\)\.length\)\{/.test(src));
ok('③local 与旧 .bak 合并（防部分 local 覆盖全量备份，御审 P2-2）', /aliasMerge\(local, bak\)\.merged/.test(src));
ok('③setModelAliases 失败也 resolve（不抛 unhandled，御审 P1-5）', /return aliasPostVerified\(_aliasMap, force\)\.then\(function\(up\)\{/.test(src) && /onFail\(\);\s*return \{ ok: false, count: 0 \};/.test(src));
ok('③syncModelAliasBoot 服务端空时从 .bak 一次性恢复（task343）', /modelAlias\.bakRestored/.test(src) && /!Object\.keys\(server\)\.length && !Object\.keys\(res\.merged\)\.length && bak/.test(src) && /已从本机备份恢复/.test(src));
ok('③Key 卡别名显式保存按钮 + 回车（task343，不再 oninput 逐字写）', /kv-' \+ prov \+ '-alias-save/.test(src) && /aInp\.onkeydown/.test(src) && !/aInp\.oninput = function\(\)\{ skKvSaveAlias/.test(src));
ok('③syncModelAliasBoot 迁移后清 localStorage（单源化，含 bak 备份）', /function syncModelAliasBoot\(\)\{[\s\S]{0,4000}removeItem\('littledj\.modelAlias'\)/.test(src));
ok('③GET 失败降级=本地+pending 合并兜底且不清（下轮再迁）', /catch\(function\(\)\{\s*\/\* GET 失败[\s\S]{0,240}_aliasMap = fb;/.test(src.replace(/\r/g, '')) || /GET 失败[\s\S]{0,300}var fb = aliasMerge[\s\S]{0,200}_aliasMap = fb;/.test(src));
ok('③window 导出三函数（setModelAliases/aliasMerge/syncModelAliasBoot）', /window\.setModelAliases=setModelAliases; window\.aliasMerge=aliasMerge; window\.syncModelAliasBoot=syncModelAliasBoot;/.test(src));
ok('③boot 在 loadModels 前串接 syncModelAliasBoot + 8s 超时兜底（御审 P2-3）', /Promise\.race\(\[\s*syncModelAliasBoot\(\),[\s\S]{0,120}setTimeout\(res, 8000\)[\s\S]{0,120}\]\)\.then\(function\(\)\{ return loadModelsWithRetry\(6\) \}\)/.test(src));

/* localStorage 直写残留：ui/src 非 .bak 文件里 setItem('littledj.modelAlias' 必须=0（唯一写途径已迁服务端） */
(function () {
  const bad = [];
  const walk = function (dir) {
    fs.readdirSync(dir).forEach(function (f) {
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (f !== '.bak' && !f.includes('.bak-')) walk(p); return }
      if (/\.bak(-|$)/.test(f) || !/\.js$/.test(f)) return;
      const c = fs.readFileSync(p, 'utf8');
      if (/localStorage\.setItem\('littledj\.modelAlias'/.test(c)) bad.push(p.replace(UI_DIR + path.sep, ''));
    });
  };
  walk(UI_DIR);
  ok('③ui/src 全域 localStorage.setItem(littledj.modelAlias) 残留=0（写入单源化）', bad.length === 0, bad.join(', ') || 'clean');
})();
ok('③keywin 两保存点均走 setModelAliases（grep 计数≥2）', (src.match(/setModelAliases\(al\); \/\* task337/g) || []).length >= 2, String((src.match(/setModelAliases\(al\); \/\* task337/g) || []).length));
ok('③页内自测不再读旧 localStorage 存储断言（改单源快照）', !/localStorage\.getItem\('littledj\.modelAlias'/.test(fs.readFileSync(path.join(UI_DIR, 'src/selftest/selftest.js'), 'utf8')));

/* index.html 缓存破坏与版本 */
(function () {
  const idx = fs.readFileSync(path.join(UI_DIR, 'index.html'), 'utf8');
  const boot = fs.readFileSync(path.join(UI_DIR, 'src/app/boot.js'), 'utf8');
  const pop = fs.readFileSync(path.join(UI_DIR, 'src/pricing/popout.js'), 'utf8');
  /* task336：版本号断言改「三处一致」——原「===v0.325.0.0」硬编码，任何升版必假红；
     别名单真正要保证的是三处 verText 同步（index.html / boot.js / popout.js） */
  const vers = [
    (idx.match(/verText">personal agent · (v[\d.]+)</) || [])[1],
    (boot.match(/personal agent · (v[\d.]+)'/) || [])[1],
    (pop.match(/personal agent · (v[\d.]+)'/) || [])[1]
  ].filter(Boolean);
  ok('③verText 三处一致（' + (vers[0] || '?') + '）', vers.length === 3 && vers[0] === vers[1] && vers[1] === vers[2], vers);
  (function () {
    const VMA = require('./contract').htmlScriptVersionMap(UI_DIR);
    const need = ['src/sidebar/data.js', 'src/pricing/keywin.js', 'src/app/boot.js', 'src/pricing/popout.js', 'src/selftest/selftest.js'];
    const miss = need.filter(function (k) { return !/^p\d+$/.test(VMA[k] || ''); });
    ok('③缓存参数在位（task343-fu2；动态口径 task371-M0#9：' + need.map(function (k) { return k.split('/').pop() + '=' + (VMA[k] || '缺失'); }).join(' ') + '）', miss.length === 0);
  })();
})();

console.log('\nRESULT: ' + (out.fail ? 'FAIL' : 'PASS') + '（' + out.pass + ' PASS / ' + out.fail + ' FAIL）');
process.exit(out.fail ? 1 : 0);

// ============================================================
// selftest-tool-prune.js — task393 工具回显剪枝自测
// ============================================================
// 分两组：
//   A 纯函数组：pruneToolResults 直接断言（剪枝/豁免/形态/边界/fail-open）
//   B 接线组：假上游 + 真 deepseek-relay + 真 zhipu-relay（临时端口，
//     不碰生产 4099/4100、不消耗模型额度）——断言上游收到的 body 已按
//     策略剪枝、无旧 content-length（deepseek 无该头走分块 / zhipu 按剪后
//     长度重算）、NO_PRUNE=1 时原样。
// 跑法：node deploy/selftest-tool-prune.js   （EXIT=0 全过）
// ============================================================
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PRUNE = require(path.join(ROOT, 'server', 'tool-prune.js'));
const DS_RELAY = path.join(ROOT, 'server', 'deepseek-relay.js');
const ZP_RELAY = path.join(ROOT, 'server', 'zhipu-relay.js');

const FAKE_PORT = 14199;
const DS_PORT = 14198;
const ZP_PORT = 14197;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

// ---------- A. 纯函数组 ----------
function pureTests() {
  const mk = () => ({
    model: 'x', stream: false,
    messages: [
      { role: 'user', content: '第一轮' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't1', content: 'A'.repeat(20000) },              // 历史轮·超长 string → 剪
      { role: 'tool', tool_call_id: 't1b', content: [{ type: 'text', text: 'B'.repeat(9000) }] }, // 历史轮·超长数组 text → 剪
      { role: 'assistant', content: '结果如上' },
      { role: 'user', content: '第二轮' },
      { role: 'assistant', content: null, tool_calls: [{ id: 't2', type: 'function', function: { name: 'bash', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 't2', content: 'C'.repeat(20000) },              // 最新轮（最后 user 之后）→ 豁免
      { role: 'tool', tool_call_id: 't2b', content: 'short' },                        // 最新轮·短 → 原样
    ],
  });

  const b = mk();
  const r = PRUNE.pruneToolResults(b);
  check('A1 历史轮剪 2 条', r.prunedCount === 2, JSON.stringify(r));
  check('A2 changed=true', r.changed === true);
  check('A3 头 4096 保留', b.messages[2].content.startsWith('A'.repeat(4096)));
  check('A4 尾 1024 保留', b.messages[2].content.endsWith('A'.repeat(1024)));
  check('A5 标记行含「历史轮」与分段读取提示', b.messages[2].content.includes('历史轮工具回显原 20000 字符') && b.messages[2].content.includes('offset/limit'));
  check('A6 剪后长度约 5.2K+标记', b.messages[2].content.length < 6200 && b.messages[2].content.length > 5000, 'len=' + b.messages[2].content.length);
  check('A7 数组形态 text 已剪', b.messages[3].content[0].text.length < 6200 && b.messages[3].content[0].text.includes('历史轮'));
  check('A8 最新轮超长 tool 豁免', b.messages[7].content === 'C'.repeat(20000));
  check('A9 最新轮短 tool 原样', b.messages[8].content === 'short');
  check('A10 assistant/user 不动', b.messages[5].content === '第二轮' && b.messages[4].content === '结果如上');

  // ≤8192 不动（历史轮置前：tool 在 user 之前才属历史轮，放 user 后会被最新轮豁免正当放过）
  const b2 = { messages: [{ role: 'tool', content: 'x'.repeat(8192) }, { role: 'user', content: 'q' }] };
  const r2 = PRUNE.pruneToolResults(b2);
  check('A11 恰好 8192 不剪', !r2.changed && b2.messages[0].content.length === 8192);
  check('A12 8193 才剪', PRUNE.pruneToolResults({ messages: [{ role: 'tool', content: 'x'.repeat(8193) }, { role: 'user', content: 'q' }] }).changed === true);

  // 无 user / 坏输入 fail-open
  check('A13 无 user 全不剪', !PRUNE.pruneToolResults({ messages: [{ role: 'tool', content: 'x'.repeat(20000) }] }).changed);
  check('A14 无 messages 原样', !PRUNE.pruneToolResults({}).changed && !PRUNE.pruneToolResults(null).changed && !PRUNE.pruneToolResults('str').changed);

  // 非文本形态（等价 JSON 序列化后超出）：null/数字 content 不炸
  check('A15 content null 不炸', !PRUNE.pruneToolResults({ messages: [{ role: 'user', content: 'q' }, { role: 'tool', content: null }] }).changed);
}

// ---------- B. 接线组 ----------
let upstreamSeen = { body: '', headers: {} };
const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    upstreamSeen = { body: Buffer.concat(chunks).toString('utf8'), headers: req.headers };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'fake', choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  });
});

function post(port, body) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, path: '/chat/completions', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, Authorization: 'Bearer selftest' }
    }, res => {
      const b = [];
      res.on('data', c => b.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(b).toString() }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

function spawnRelay(script, env) {
  const child = spawn(process.execPath, [script], { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
  child.log = '';
  child.stdout.on('data', d => { child.log += d.toString(); });
  child.stderr.on('data', d => { child.log += d.toString(); });
  return child;
}

async function waitHealth(port) {
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 100));
    try {
      await new Promise((res, rej) => {
        const s = http.get('http://127.0.0.1:' + port + '/health', x => { x.resume(); res(); });
        s.on('error', rej);
      });
      return true;
    } catch (e) { /* retry */ }
  }
  return false;
}

const bigToolBody = () => ({
  model: 'deepseek-flash', stream: false,
  messages: [
    { role: 'user', content: '第一轮' },
    { role: 'tool', content: 'H'.repeat(30000) },
    { role: 'user', content: '第二轮' },
    { role: 'tool', content: 'N'.repeat(30000) },
  ],
});

(async () => {
  pureTests();

  await new Promise(r => upstream.listen(FAKE_PORT, '127.0.0.1', r));
  const dsEnv = {
    DS_RELAY_PORT: String(DS_PORT), DS_RELAY_UPSTREAM: '127.0.0.1',
    DS_RELAY_UPSTREAM_PORT: String(FAKE_PORT), DS_RELAY_UPSTREAM_SCHEME: 'http',
    DS_RELAY_INBOX: '/tmp/selftest-prune-inbox', DS_RELAY_EFFORT: 'off',
  };
  const ds = spawnRelay(DS_RELAY, dsEnv);
  if (!(await waitHealth(DS_PORT))) { console.log('FAIL deepseek-relay 未监听'); ds.kill('SIGKILL'); upstream.close(); process.exit(1); }

  // B1-B5：deepseek-relay 默认开剪
  let resp = await post(DS_PORT, bigToolBody());
  check('B1 ds relay 响应 200', resp.status === 200, 'status=' + resp.status);
  let j = null; try { j = JSON.parse(upstreamSeen.body); } catch (e) {}
  check('B2 ds 上游收到 JSON 可解析', !!j && Array.isArray(j.messages));
  const dsHist = j && j.messages[1] && j.messages[1].content || '';
  const dsNew = j && j.messages[3] && j.messages[3].content || '';
  check('B3 ds 历史轮已剪（含标记行）', dsHist.includes('历史轮工具回显原 30000 字符') && dsHist.length < 6200, 'len=' + dsHist.length);
  check('B4 ds 最新轮豁免', dsNew === 'N'.repeat(30000));
  check('B5 ds 无旧 content-length（无头=分块）', !upstreamSeen.headers['content-length'] || String(upstreamSeen.headers['content-length']) === String(Buffer.byteLength(upstreamSeen.body)));
  check('B6 ds 日志含 pruned 行', /pruned 1 tool results/.test(ds.log), ds.log.slice(-200));
  ds.kill('SIGKILL');
  await new Promise(r => setTimeout(r, 200));

  // B7-B9：deepseek-relay NO_PRUNE=1 原样
  const ds2 = spawnRelay(DS_RELAY, Object.assign({}, dsEnv, { DS_RELAY_NO_PRUNE: '1' }));
  if (!(await waitHealth(DS_PORT))) { console.log('FAIL deepseek-relay(2) 未监听'); ds2.kill('SIGKILL'); upstream.close(); process.exit(1); }
  resp = await post(DS_PORT, bigToolBody());
  j = null; try { j = JSON.parse(upstreamSeen.body); } catch (e) {}
  check('B7 ds NO_PRUNE 历史 tool 原样', j && j.messages[1].content === 'H'.repeat(30000));
  check('B8 ds NO_PRUNE 无 pruned 日志', !/pruned/.test(ds2.log));
  ds2.kill('SIGKILL');
  await new Promise(r => setTimeout(r, 200));

  // B10-B14：zhipu-relay（默认开剪 + content-length 重算）
  const zpEnv = {
    ZP_RELAY_PORT: String(ZP_PORT), ZP_RELAY_UPSTREAM_HOST: '127.0.0.1',
    ZP_RELAY_UPSTREAM_PORT: String(FAKE_PORT), ZP_RELAY_UPSTREAM_SCHEME: 'http',
    ZP_RELAY_NO_CONTENT_WATCHDOG: '1',
  };
  const zp = spawnRelay(ZP_RELAY, zpEnv);
  if (!(await waitHealth(ZP_PORT))) { console.log('FAIL zhipu-relay 未监听'); zp.kill('SIGKILL'); upstream.close(); process.exit(1); }
  resp = await post(ZP_PORT, bigToolBody());
  check('B10 zp relay 响应 200', resp.status === 200, 'status=' + resp.status);
  j = null; try { j = JSON.parse(upstreamSeen.body); } catch (e) {}
  const zpHist = j && j.messages[1] && j.messages[1].content || '';
  check('B11 zp 上游 JSON 可解析+历史已剪', !!j && zpHist.includes('历史轮工具回显原 30000 字符'));
  check('B12 zp 最新轮豁免', j && j.messages[3].content === 'N'.repeat(30000));
  const recvLen = Buffer.byteLength(upstreamSeen.body);
  const claimed = upstreamSeen.headers['content-length'] ? Number(upstreamSeen.headers['content-length']) : null;
  check('B13 zp content-length=剪后实际长度', claimed === recvLen, 'claimed=' + claimed + ' recv=' + recvLen);
  check('B14 zp 日志含 pruned 行', /pruned 1 tool results/.test(zp.log), zp.log.slice(-200));
  zp.kill('SIGKILL');
  await new Promise(r => setTimeout(r, 200));

  // B15-B16：zhipu-relay NO_PRUNE=1 原样（P2-13：zhipu 应急闸独立自测背书）
  const zp2 = spawnRelay(ZP_RELAY, Object.assign({}, zpEnv, { ZP_RELAY_NO_PRUNE: '1' }));
  if (!(await waitHealth(ZP_PORT))) { console.log('FAIL zhipu-relay(2) 未监听'); zp2.kill('SIGKILL'); upstream.close(); process.exit(1); }
  resp = await post(ZP_PORT, bigToolBody());
  j = null; try { j = JSON.parse(upstreamSeen.body); } catch (e) {}
  check('B15 zp NO_PRUNE 历史 tool 原样', j && j.messages[1].content === 'H'.repeat(30000));
  check('B16 zp NO_PRUNE 无 pruned 日志', !/pruned \d/.test(zp2.log));
  zp2.kill('SIGKILL');

  console.log('\nRESULT pass=' + pass + ' fail=' + fail);
  upstream.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });

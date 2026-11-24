// selftest-authed —— task297 反代鉴权纵深回归（防复发：改 authed 必跑）
// 背景：经外网 nginx 反代的流量（必带 X-Real-IP）只认外网强凭据 auth-ext，
//       弱主密码（AUTH_EXPECT）公网链路一律 401；本机/内网直连无此头，行为不变。
// 用法：node deploy/selftest-authed.js（exit 0=全绿）
const fs = require('fs')
const path = require('path')
const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'proxy.js'), 'utf8')
const m = src.match(/function authed\(req\) \{[\s\S]*?\n\}/)
if (!m) { console.error('FAIL: authed() 未在 proxy.js 找到（函数改名/迁移请同步本测）'); process.exit(1) }
// authed 只做恒等比对，常量按真实算法构造即可（Basic base64），不引真凭据（凭据零明文红线）
const AUTH_EXPECT = 'Basic ' + Buffer.from('u:mainpw').toString('base64')
const AUTH_EXT_EXPECT = 'Basic ' + Buffer.from('dj:extpw').toString('base64')
const make = (AE, AEE, passStub) => new Function('AUTH_EXPECT', 'AUTH_EXT_EXPECT', 'passVerify', 'return ' + m[0])(AE, AEE, passStub || function () { return false })
const authed = make(AUTH_EXPECT, AUTH_EXT_EXPECT)
const req = (auth, xri, cookie) => ({ headers: Object.assign({}, auth ? { authorization: auth } : {}, (xri === undefined || xri === null) ? {} : { 'x-real-ip': xri }, cookie ? { cookie: cookie } : {}) })
let pass = 0, fail = 0
const t = (name, got, want) => { if (got === want) { pass++; console.log('PASS', name) } else { fail++; console.log('FAIL', name, 'got=' + got + ' want=' + want) } }
// 源码锚：反代分支必须存在（防将来重构悄悄丢掉）
t('⓪ 源码含 x-real-ip 反代分支', /'x-real-ip' in req\.headers/.test(m[0]), true)
t('① 本机/内网直连+主密码=放行', authed(req(AUTH_EXPECT, null)), true)
t('② 反代流量+主密码=401（主防线）', authed(req(AUTH_EXPECT, '5.6.7.8')), false)
t('③ 反代流量+外网凭据=放行', authed(req(AUTH_EXT_EXPECT, '5.6.7.8')), true)
t('④ 无凭据=拒', authed(req(null, null)), false)
t('⑤ 空头也算反代（x-real-ip:"" 同 401）', authed(req(AUTH_EXPECT, '')), false)
t('⑥ auth-ext 缺失时反代全拒（fail-closed）', make(AUTH_EXPECT, null)(req(AUTH_EXPECT, '5.6.7.8')), false)
// task295：通行证 cookie 通道（内外网均认，先于 Basic 判定）
t('⑦ cookie 有效=放行（无 Basic）', make(AUTH_EXPECT, AUTH_EXT_EXPECT, function () { return { did: 'd1' } })(req(null, null, 'dj_pass=x')), true)
t('⑧ 反代流量+cookie=放行（内外网均认）', make(AUTH_EXPECT, AUTH_EXT_EXPECT, function () { return { did: 'd1' } })(req(null, '5.6.7.8', 'dj_pass=x')), true)
t('⑨ cookie 无效回落 Basic 判定（内网主密码放行）', make(AUTH_EXPECT, AUTH_EXT_EXPECT, function () { return null })(req(AUTH_EXPECT, null)), true)
console.log('---- ' + pass + ' pass / ' + fail + ' fail ----')
process.exit(fail ? 1 : 0)

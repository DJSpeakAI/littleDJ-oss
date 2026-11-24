// 确保 deveco 用户配置里 DeepSeek / 智谱 Token Plan 都走本机中转
// 背景：models.json 缓存会被 serve 启动时回写覆盖，改缓存不可靠；
// provider.<id>.options.baseURL 属于用户配置，不会被缓存刷新覆盖。
// DeepSeek -> 127.0.0.1:4099；智谱 -> 127.0.0.1:4100（保留 /api/coding/paas/v4 路径）。
// task228：OpenAI 通道整体退役（key 额度耗尽，主人拍板撤除）——
//   若历史配置里残留 provider.openai 段（task226 写入），本脚本幂等删除。
// 幂等：已是中转地址则不改；配置不是合法 JSON 时只告警、不覆盖。
const fs = require('fs')
const os = require('os')
const path = require('path')

const DS_TARGET = process.env.DS_RELAY_URL || 'http://127.0.0.1:4099'
const ZP_TARGET = process.env.ZP_RELAY_URL || 'http://127.0.0.1:4100/api/coding/paas/v4'
const CONF_DIR = process.env.XDG_CONFIG_HOME
  ? path.join(process.env.XDG_CONFIG_HOME, 'deveco')
  : path.join(os.homedir(), '.config', 'deveco')
const CONF = path.join(CONF_DIR, 'deveco.jsonc')

function log(msg) { console.log('[ensure-relays] ' + msg) }

let raw
try {
  raw = fs.readFileSync(CONF, 'utf8')
} catch (e) {
  log('WARN 找不到配置 ' + CONF + '（跳过；请先运行一次 deveco）')
  process.exit(0)
}

let conf
try {
  conf = JSON.parse(raw)
} catch (e) {
  log('WARN ' + CONF + ' 含注释或非法 JSON，未改动：' + e.message)
  process.exit(0)
}

if (!conf.provider || typeof conf.provider !== 'object') conf.provider = {}

const targets = [
  { id: 'deepseek', target: DS_TARGET },
  { id: 'zhipuai-coding-plan', target: ZP_TARGET }
]
const changed = []

targets.forEach(function (t) {
  if (!conf.provider[t.id] || typeof conf.provider[t.id] !== 'object') conf.provider[t.id] = {}
  if (!conf.provider[t.id].options || typeof conf.provider[t.id].options !== 'object') {
    conf.provider[t.id].options = {}
  }
  const cur = conf.provider[t.id].options.baseURL
  if (cur === t.target) return
  conf.provider[t.id].options.baseURL = t.target
  changed.push(t.id + ' ' + (cur || '(默认官方)') + ' -> ' + t.target)
})

// task228：OpenAI 通道退役——幂等删除历史写入的 provider.openai 段
if (conf.provider.openai) {
  delete conf.provider.openai
  changed.push('openai 段已撤（task228 退役：relay 4101 停用）')
}

if (!changed.length) {
  log('已就绪：deepseek -> ' + DS_TARGET + '；zhipuai-coding-plan -> ' + ZP_TARGET)
  process.exit(0)
}

try {
  fs.copyFileSync(CONF, CONF + '.bak-littledj')
  fs.writeFileSync(CONF, JSON.stringify(conf, null, 2) + '\n')
  log('已写入：' + changed.join('；') + '（原配置备份 ' + CONF + '.bak-littledj）')
} catch (e) {
  log('ERROR 写入失败：' + e.message)
  process.exit(1)
}

// ============================================================
// selftest-skill-inject.js — task393 技能按需注入自测（纯函数直测）
// ============================================================
// 覆盖：头解析（name/triggers/无头/缺字段/截断）、readSkills 容错、
//   matchSkills 命中语义、formatSkillBlock 两端契约标记、
//   skill-state 500 上限清理（对象值按内部最大 ts 排序）。
// 跑法：node deploy/selftest-skill-inject.js   （EXIT=0 全过）
// ============================================================
require('./_tmpdir'); // task399：沙盒统一落 <仓库>/run/tmp（鸿蒙 TMPDIR=主目录，os.tmpdir() 不再指向 ~/）
const fs = require('fs');
const os = require('os');
const path = require('path');
const SI = require(path.join(__dirname, '..', 'server', 'skill-inject.js'));

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}

// ---------- 解析组 ----------
const good = '<!-- littleDJ-skill\nname: 测试技能\ntriggers: Alpha,贝塔, GAMMA\n-->\n正文第一行\n正文第二行';
const s = SI.parseSkill(good, 't.md');
check('A1 name 解析', s && s.name === '测试技能');
check('A2 triggers 归一小写', s && s.triggers.length === 3 && s.triggers[0] === 'alpha' && s.triggers[1] === '贝塔' && s.triggers[2] === 'gamma');
check('A3 body 剥离头注释', s && s.body.startsWith('正文第一行') && s.body.endsWith('正文第二行'));
check('A4 无头返回 null', SI.parseSkill('# 普通md\n没有头', 'x.md') === null);
check('A5 缺 name 返回 null', SI.parseSkill('<!-- littleDJ-skill\ntriggers: a\n-->正文', 'x.md') === null);
check('A6 空 triggers 返回 null', SI.parseSkill('<!-- littleDJ-skill\nname: n\ntriggers: , ，\n-->正文', 'x.md') === null);
check('A7 坏输入不炸', SI.parseSkill(null, 'x.md') === null);

const big = '<!-- littleDJ-skill\nname: 大技能\ntriggers: big\n-->\n' + 'Z'.repeat(SI.BODY_CAP + 500);
const sb = SI.parseSkill(big, 'big.md');
check('A8 超 8KB 截断+标注', sb && sb.body.length <= SI.BODY_CAP + 100 && sb.body.includes('已截断'));

// ---------- readSkills 组 ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'selftest-skills-'));
fs.writeFileSync(path.join(tmp, 'a.md'), good);
fs.writeFileSync(path.join(tmp, 'b-无头.md'), '# 没有技能头\n应该被跳过');
fs.writeFileSync(path.join(tmp, 'c.md'), '<!-- littleDJ-skill\nname: 丙\ntriggers: cc\n-->\n丙正文');
const skills = SI.readSkills(tmp);
check('B1 读出 2 个（无头跳过）', skills.length === 2, 'len=' + skills.length);
check('B2 文件名排序稳定', skills[0].file === 'a.md' && skills[1].file === 'c.md');
check('B3 目录不存在 → []', Array.isArray(SI.readSkills('/nonexistent-dir-xyz')) && SI.readSkills('/nonexistent-dir-xyz').length === 0);

// ---------- matchSkills 组 ----------
check('C1 命中（大小写不敏感）', SI.matchSkills('请ALPHA一下', skills).length === 1 && SI.matchSkills('请ALPHA一下', skills)[0].name === '测试技能');
check('C2 命中（中文词）', SI.matchSkills('来个贝塔', skills).length === 1);
check('C3 不命中', SI.matchSkills('今天天气不错', skills).length === 0);
check('C4 空文本不命中', SI.matchSkills('', skills).length === 0 && SI.matchSkills(null, skills).length === 0);
check('C5 多技能同轮命中', SI.matchSkills('alpha 和 cc 一起', skills).length === 2);

// ---------- formatSkillBlock 组 ----------
const block = SI.formatSkillBlock(skills[0]);
check('D1 注入块前缀（UI 折叠判据）', block.indexOf('【技能加载（自动注入 · 仅本会话一次 · 测试技能）】') === 0);
check('D2 结束标记（两端契约）', block.endsWith('——— 技能内容结束 ———'));
check('D3 正文居中', block.includes('正文第一行'));

// ---------- skill-state 组 ----------
const stFile = path.join(tmp, 'skill-state.json');
let st = {};
for (let i = 0; i < 520; i++) st['sid' + i] = { 'a.md': 1000 + i };
st['sid5'] = { 'a.md': 1005, 'c.md': 999999 }; // sid5 内部最大 ts 拉高 → 应保留
SI.saveSkillState(stFile, st);
const st2 = SI.loadSkillState(stFile);
check('E1 落盘可读回', Object.keys(st2).length > 0);
check('E2 500 上限清理', Object.keys(st2).length === SI.STATE_MAX_SIDS, 'len=' + Object.keys(st2).length);
check('E3 内部最大 ts 者保留', !!st2['sid5']);
check('E4 最老 sid 被挤掉', !st2['sid0']);
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\nRESULT pass=' + pass + ' fail=' + fail);
process.exit(fail === 0 ? 0 : 1);

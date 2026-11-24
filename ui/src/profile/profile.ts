/* @module profile @order 38 @职责 主人画像 @提供 PROFILE SK PRMETA PRUI profileDimData profileDimMeta prBoxIdOf skFmtTime skFmtDur skModeLabel skFind @依赖 - @依赖运行期 - @DOM契约 - @严格模式 是 @全局占用 PROFILE SK PRMETA PRUI profileDimData profileDimMeta prBoxIdOf skFmtTime skFmtDur skModeLabel skFind @源行 ui/index.html L10802-L10850 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 主人画像 ---------- */
var PROFILE: any = { dims: [], data: null, cur: 'identity' };

function profileDimData(id?){
  if (!PROFILE.data) return { id: id, items: [], suggestions: [] };
  var d = PROFILE.data.dimensions.filter(function(x){ return x.id === id })[0];
  return d || { id: id, items: [], suggestions: [] };
}
function profileDimMeta(id?){
  return PROFILE.dims.filter(function(d){ return d.id === id })[0] || { id: id, name: id, hint: '' };
}
/* ================= task194：定时任务 skill（模型比价=第 1 个 skill） ================= */
var SK: any = { list: [], cur: '', pollT: 0, prPollT: 0, prSort: 'provider', prDir: 1, prData: null, prQ: '', prCat: '', prLink: '', prWrap: 'prWrap', prOrder: null, prW: null, popFitted: false, prUnitCny: false, prRate: 0, kvDraft: { ds: { name: '', key: '' }, zp: { name: '', key: '' } } }; /* 补充：prUnitCny/prRate=task212 积分⇄元显示（汇率本地自定，官方无公开静态源） */ /* kvDraft=Key 管理窗未保存草稿（task215：仅内存，重渲/重开窗回填不丢；prView 已随 task215 退役） */ /* prWrap：当前比价渲染容器（task204 弹窗/右栏双入口共用渲染核心）；prOrder/prW：task208 列序/列宽（localStorage 持久化） */
/* task208：列元数据（唯一真源）——k=排序键/存储键，w=默认列宽，min=拖拽下限，u=表头单位小字（task213：单位上移表头，单元格只显数字） */
var PRMETA = [
  { k: 'provider', t: '供应商', w: 160, min: 96 },
  { k: 'model', t: '模型', w: 210, min: 120 },
  { k: 'alias', t: '别名', w: 158, min: 96 }, /* task283：模型别名列——与设置→API Key→别名同一别名单源（task337 起服务端），行内输入+保存 */
  { k: 'context', t: '上下文', u: 'tokens', w: 92, min: 64 },
  { k: 'input', t: '输入·未命中', u: '元/百万', w: 132, min: 96 },
  { k: 'hit', t: '输入·缓存命中', u: '元/百万', w: 146, min: 96 },
  { k: 'output', t: '输出', u: '元/百万', w: 110, min: 72 },
  { k: 'conc', t: '限速', w: 92, min: 64 },
  { k: 'api', t: '接口', w: 230, min: 110 },
  { k: 'link', t: '接入', w: 84, min: 60 },
  { k: 'note', t: '备注', w: 170, min: 90 } /* task345：模型级备注列——能力 API 介绍/限时折扣等非结构化说明（主人定规「上下文就是上下文，没地方写的放备注」）；旧列序无 note 键自动补末尾 */
];
var PRUI: any = { drag: null, suppress: false, menu: null };
function prBoxIdOf(wrapId?){ return wrapId === 'prWrap' ? 'prTableBox' : wrapId + 'Box' }

function skFmtTime(ms?){
  if (!ms) return '—';
  var d = new Date(ms);
  return (d.getMonth() + 1) + '-' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function skFmtDur(ms?){
  if (!ms) return '';
  return ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(1) + 's';
}
function skModeLabel(m?){
  return { daily: '每天', every3days: '每 3 天', weekly: '每周', monthly: '每月' }[m] || m;
}
function skFind(id?){
  return SK.list.filter(function(x){ return x.id === id })[0];
}

window.PROFILE=PROFILE; window.SK=SK; window.PRMETA=PRMETA; window.PRUI=PRUI; window.profileDimData=profileDimData; window.profileDimMeta=profileDimMeta; window.prBoxIdOf=prBoxIdOf; window.skFmtTime=skFmtTime; window.skFmtDur=skFmtDur; window.skModeLabel=skModeLabel; window.skFind=skFind;

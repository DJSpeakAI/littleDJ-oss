/* @module status @order 20 @职责 右上角常驻胶囊 + 计费口径 @提供 SYS sysActiveUnits sysMemAvailText sysWatch sysFetchQuota sysFetchScore sysPct sysScoreAmt sysSnapGlm sysSnapDs modelBilling refreshBillingViews sysRender sysSetPill sysRow sysStatsEnsure sysStatsNode sysStatsPaint sysPanelMem sysProcsEnsure sysProcsNode sysProcsPaint sysPanelQuo sysPanelTask sysPanelStat sysRenderPanel @依赖 - @依赖运行期 runningUnits getPwaAgentSound playDing kaActive notifyDing S updateUsage syncBalanceLabel toast @DOM契约 - @严格模式 是 @全局占用 SYS sysActiveUnits sysMemAvailText sysWatch sysFetchQuota sysFetchScore sysPct sysScoreAmt sysSnapGlm sysSnapDs modelBilling refreshBillingViews sysRender sysSetPill sysRow sysStatsEnsure sysStatsNode sysStatsPaint sysPanelMem sysProcsEnsure sysProcsNode sysProcsPaint sysPanelQuo sysPanelTask sysPanelStat sysRenderPanel @源行 ui/index.html L5315-L5667 @测试锚点 - @被调用 - */
'use strict';
/* ---------- P2：右上角常驻胶囊（task38）。10s 只拉本机 /_watch；balance/quota/score 120s 低频，失败保旧值 ---------- */
var SYS: any = { memAvailMb: 0, memTotalMb: 0, haveWatch: false, zp5: '', zpW: '', quotaOk: false, scr: null, scrErr: '', watchTimer: null, slowTimer: null, open: false, hoverOpenT: null, hoverCloseT: null, pillText: '', sec: 'all', anchor: null, stats: undefined, statsAt: 0, statsBusy: false, statsRoot: null, statsSig: '', procs: undefined, procsAt: 0, procsBusy: false, procsRoot: null, procsSig: '', killBusy: false };
function sysActiveUnits(){
  return runningUnits(); /* task54：胶囊与左栏/监视页同口径（任务口径内 running），不再把 step=0 死会话算进「在跑」 */
}
function sysMemAvailText(){
  return (SYS.haveWatch && SYS.memAvailMb) ? (SYS.memAvailMb / 1024).toFixed(1) + 'G' : '—';
}
function sysWatch(){
  fetch('/_watch').then(function(r){ return r.json() }).then(function(d){
    if (d && d.ok && d.res){ SYS.haveWatch = true; SYS.memAvailMb = Number(d.res.memAvailableMb) || 0; SYS.memTotalMb = Number(d.res.memTotalMb) || 0; }
    /* task126 F2'B：ETA 超时计数入胶囊；0→N 跳变且页面后台时提示音+系统通知（尊重音色设置，首见不响防刷新轰鸣） */
    var nOver = Number(d && d.tasks && d.tasks.etaOverdueCount) || 0;
    var prev = (SYS.etaOverSeen === true) ? (Number(SYS.etaOver) || 0) : null;
    SYS.etaOver = nOver; SYS.etaOverSeen = true;
    if (prev !== null && nOver > 0 && prev === 0){
      var snd = getPwaAgentSound();
      if (snd !== 'none'){
        playDing(snd);
        if (!kaActive()) notifyDing('小 DJ · 任务超时', nOver + ' 项已超预计时间·待查验，点右上「任务」查看');
      }
    }
    sysRender();
  }).catch(function(){ sysRender(); });
}
function sysFetchQuota(){
  fetch('/_settings/zhipu/quota', { method: 'GET' }).then(function(r){ return r.json() }).then(function(d){
    if (d && d.ok && d.fiveHour){
      SYS.quotaOk = true;
      SYS.zp5 = (d.fiveHour.percentage != null) ? String(d.fiveHour.percentage) : '';
      SYS.zpW = (d.week && d.week.percentage != null) ? String(d.week.percentage) : '';
      sysRender();
    }
  }).catch(function(){}); /* 失败保旧值 */
}
/* task386：全量积分快照（DJH 每 5 分钟推送 config/score-snapshot.json，本端只读）——
   与 djh 积分面板同源：DeepSeek/GLM/四家云/RH 国内外/WorkBuddy/BreezeBlue 一次取全，供右上角额度面板展开。 */
function sysFetchScore(){
  fetch('/_score').then(function(r){ return r.json() }).then(function(d){
    if (d && d.ok !== false && d.at){ SYS.scr = d; SYS.scrErr = ''; sysRender(); }
    else if (d && d.ok === false){ SYS.scrErr = String(d.error || '数据还没同步'); } /* 失败保旧值 */
  }).catch(function(){}); /* 失败保旧值 */
}
/* 快照金额/积分数值格式化：缺失/非法一律「—」，两位小数（djh 同款口径） */
function sysScoreAmt(v?){
  var n = Number(v);
  if (v == null || v === '' || !isFinite(n)) return '—';
  return (Math.round(n * 100) / 100).toFixed(2);
}
/* 快照 GLM 百分比（'fiveHour' | 'week'）：无快照/未就绪 → ''（调用方回退「—」） */
function sysSnapGlm(which?){
  var d = SYS.scr;
  if (!d || d.ok === false || !d.glm || !d.glm.ok) return '';
  var b = d.glm[which];
  return (b && b.percentage != null) ? String(b.percentage) : '';
}
/* 快照 DeepSeek 余额文本：无快照/未就绪 → '' */
function sysSnapDs(){
  var d = SYS.scr;
  if (!d || d.ok === false || !d.ds || !d.ds.ok) return '';
  if (d.ds.amount != null) return '￥ ' + sysScoreAmt(d.ds.amount);
  return d.ds.text ? String(d.ds.text) : '';
}
function sysPct(v?){
  var n = Number(v);
  if (v === '' || v == null || !isFinite(n)) return '—';
  return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10 + '%';
}
/* ---------- 计费口径（task81 S2）：跟随输入框模型所属供应商；缺数据源如实标注，不编数字 ---------- */
/* task386：实时接口（DS 余额 / GLM 配额）优先，DJH 快照兜底——「当前 Key」不再生造「数据源缺失」 */
function modelBilling(){
  var p = S.model.providerID;
  if (p === 'zhipuai-coding-plan'){
    var g5 = SYS.quotaOk ? SYS.zp5 : sysSnapGlm('fiveHour');
    var gw = SYS.quotaOk ? SYS.zpW : sysSnapGlm('week');
    var hasG = g5 !== '' || gw !== '';
    return {
      kind: 'quota',
      brief: hasG ? ('额度 5h ' + sysPct(g5)) : '额度 —',
      full: hasG ? ('额度 5h ' + sysPct(g5) + ' · 本周 ' + sysPct(gw)) : '额度 —（未取到）',
      amount: hasG ? ('额度 5h ' + sysPct(g5) + ' · 本周 ' + sysPct(gw)) : '—'
    };
  }
  if (p === 'deepseek'){
    var ds = S.balance ? S.balance : sysSnapDs();
    return { kind: 'balance', brief: ds ? ('余额 ' + ds) : '余额 —', full: ds ? ('余额 ' + ds) : '余额 —', amount: ds || '—' };
  }
  return { kind: 'none', brief: '余额 —', full: '余额 —', amount: '—' };
}
function refreshBillingViews(){
  sysRender();                    /* 顶栏胶囊 */
  updateUsage(S.lastMsgs || []);  /* 上下文条「余额 /」段 */
  syncBalanceLabel();             /* 计费口径变化 → 胶囊即时同步（task214：原设置页余额标签已退役） */
}
function sysRender(){
  var pill = $('#sysPill'); if (!pill) return;
  var bk = modelBilling();
  var qTxt = bk.kind === 'quota' ? '' : ('周 ' + (SYS.quotaOk ? sysPct(SYS.zpW) : sysPct(sysSnapGlm('week')))); /* task121：GLM 口径改本周；task386 快照兜底 */
  var actN = sysActiveUnits().length;
  var etaN0 = Number(SYS.etaOver) || 0; /* task126 P1-1：合一胶囊（手机端）同款超时态 */
  var txt = '◈' + actN + (etaN0 > 0 ? '!'+etaN0 : '') + '·' + sysMemAvailText() + '·' + bk.brief + (qTxt ? '·' + qTxt : '');
  if (txt !== SYS.pillText){ /* 值未变不重绘胶囊内部 DOM（P2-8）；面板数据独立，照常刷新 */
    SYS.pillText = txt;
    pill.textContent = '';
    pill.appendChild(el('span', 'sp-t', '◈' + actN + (etaN0 > 0 ? '!'+etaN0 : '')));
    pill.appendChild(el('span', 'sp-sep sp-x', '·'));
    pill.appendChild(el('span', 'sp-m', sysMemAvailText()));
    pill.appendChild(el('span', 'sp-sep sp-x', '·'));
    pill.appendChild(el('span', 'sp-b', bk.brief));
    if (qTxt){
      pill.appendChild(el('span', 'sp-sep sp-x', '·'));
      pill.appendChild(el('span', 'sp-q', qTxt));
    }
  }
  /* task120：PC 四拆分胶囊（textContent 比对去重，值未变不碰 DOM）；task126 F2'B：任务胶囊超时态（!M + warn 色，纯显隐零重排） */
  sysSetPill('#sysPMem', '内存 ' + sysMemAvailText());
  sysSetPill('#sysPQuo', '积分'); /* task386-fu2：胶囊只留「积分」二字——金额/周百分比全部收进点开面板（主人 2026-11-19：「把数字去掉，我鼠标移上去面板里能看」） */
  var etaN = Number(SYS.etaOver) || 0;
  sysSetPill('#sysPTask', '任务 ' + actN + (etaN > 0 ? ' !' + etaN : ''));
  var taskPill = $('#sysPTask');
  if (taskPill) {
    taskPill.classList.toggle('warn', etaN > 0);
    /* task157：!N 语义上屏——N=超预计时间待查验数（此前 title 只写「在跑的 AI 任务」，主人 2026-11-09 问过 !2 是什么） */
    taskPill.title = '工作任务：在跑 ' + actN + ' 个' + (etaN > 0 ? ' · ' + etaN + ' 项已超预计时间，待查验' : ' · 无超时');
  }
  pill.classList.toggle('warn', etaN > 0); /* task126 P1-1：合一胶囊同款 warn */
  pill.title = '系统状态：在跑任务 ' + actN + ' 个' + (etaN > 0 ? ' · ' + etaN + ' 项超预计时间待查验' : '') + ' · 内存 · 余额 / 额度';
  if (SYS.open) sysRenderPanel();
}
function sysSetPill(id, txt){
  var b = $(id); if (!b || b.textContent === txt) return;
  b.textContent = txt;
}
function sysRow(label, val?, valCls?){
  var r = el('div', 'sysrow');
  r.appendChild(el('span', null, label));
  r.appendChild(el('b', valCls || null, val));
  return r;
}
/* task119 合并单：效率统计。三态：undefined=加载中 / null=失败(从未成功) / object=正常；
   节流 60s 单窗与后端缓存对齐（防「以为统计坏了」）；statsBusy 防快速连点并发；
   一旦有过成功值，失败/过期期保留旧图不置空（防开关面板闪烁）。 */
function sysStatsEnsure(){
  if (SYS.statsBusy) return;
  if (SYS.statsAt && Date.now() - SYS.statsAt < 60000) return;
  SYS.statsBusy = true;
  SYS.statsAt = Date.now();
  fetch('/_taskstats').then(function(r){ return r.json() }).then(function(d){
    SYS.stats = (d && d.ok) ? d : ((SYS.stats && SYS.stats.days) ? SYS.stats : null);
  }).catch(function(){
    SYS.stats = (SYS.stats && SYS.stats.days) ? SYS.stats : null;
  }).then(function(){
    SYS.statsBusy = false;
    if (SYS.open) sysRenderPanel();
  });
}
/* 统计区块根节点跨重建复用（appendChild 移回同一 node，DOM 身份不变不重绘）；
   仅数据指纹变化时重绘内部内容；禁止每 10s 无变化重建（防毁掉主人在看的图/滚动） */
function sysStatsNode(){
  if (!SYS.statsRoot){
    SYS.statsRoot = el('div');
    SYS.statsSig = '';
  }
  var sig = SYS.stats === undefined ? 'loading' : (SYS.stats === null ? 'fail' : JSON.stringify(SYS.stats.stats && SYS.stats.stats.overall || {}) + '|' + JSON.stringify(SYS.stats.stats && SYS.stats.stats.days || []) + '|' + JSON.stringify(SYS.stats.stats && SYS.stats.stats.roles || []));
  if (sig !== SYS.statsSig){
    SYS.statsSig = sig;
    sysStatsPaint(SYS.statsRoot);
  }
  return SYS.statsRoot;
}
function sysStatsPaint(root){
  root.textContent = '';
  root.appendChild(el('h4', null, '效率 · 近 14 天'));
  try {
    if (SYS.stats === undefined){
      root.appendChild(el('div', 'stat-note', '统计加载中…'));
      return;
    }
    if (SYS.stats === null){
      root.appendChild(el('div', 'stat-note', '统计暂不可用，稍后自动重试'));
      return;
    }
    var st = SYS.stats.stats || {};
    var ov = st.overall || { done: 0, excluded: 0, interrupted: 0, avgTotalMin: 0, avgActiveMin: 0, avgWaitMin: 0, avgStuckMin: 0 };
    /* task126 F4'：迁移批次剔除后短期无样本=预期（防「面板坏了」误判），显式空态提示 */
    if (!Number(ov.done) && !Number(ov.interrupted) && Number(ov.migratedSkip) > 0){
      root.appendChild(el('div', 'stat-note', '暂无有效完成样本（已剔除旧台账批量迁移标记 ' + ov.migratedSkip + ' 条；新任务完成并标记后此处出现数据）'));
      return;
    }
    root.appendChild(sysRow('平均完成（有效）', ov.avgActiveMin + ' 分钟 · n=' + ov.done));
    root.appendChild(sysRow('平均卡住', ov.avgStuckMin + ' 分钟'));
    root.appendChild(sysRow('平均等待 / 总时长', ov.avgWaitMin + ' / ' + ov.avgTotalMin + ' 分钟'));
    if (ov.interrupted > 0) root.appendChild(sysRow('中断（活跃）', ov.interrupted + ' 项'));
    if (ov.excluded > 0) root.appendChild(sysRow('超 48h 已剔除', ov.excluded + ' 项'));
    if (Number(ov.migratedSkip) > 0) root.appendChild(sysRow('迁移批次已剔除', ov.migratedSkip + ' 项'));
    var days = Array.isArray(st.days) ? st.days : [];
    var maxAvg = 0;
    days.forEach(function(d){ if (Number(d.avgActiveMin) > maxAvg) maxAvg = Number(d.avgActiveMin) });
    var chart = el('div', 'stat-chart');
    days.forEach(function(d, i){
      var v = Number(d.avgActiveMin) || 0;
      var b = el('i', 'stat-bar' + (d.done > 0 && v > 0 ? ' on' : ''));
      b.style.height = (v > 0 && maxAvg > 0) ? Math.max(6, Math.round(v / maxAvg * 100)) + '%' : '2px'; /* 防除零：全 0 样本恒 2px 灰线 */
      var dt = d.date || '';
      b.title = dt.slice(5) + ' 完成 ' + (d.done || 0) + ' · 有效 ' + (d.avgActiveMin || 0) + 'm · 等待 ' + (d.avgWaitMin || 0) + 'm · 卡住 ' + (d.avgStuckMin || 0) + 'm';
      chart.appendChild(b);
    });
    root.appendChild(chart);
    var xr = el('div', 'stat-x');
    days.forEach(function(d, i){
      var last = i === days.length - 1; /* 最新一天必显日期（产出审 P2-4：i%3 会让末柱无标签） */
      var s = el('span', null, (i % 3 === 0 || last) ? String(d.date || '').slice(5) : '');
      xr.appendChild(s);
    });
    root.appendChild(xr);
    if (SYS.stats.truncated) root.appendChild(el('div', 'stat-note', '单批后代超 5000 行已截断，个别任务区间可能不完整'));
    var roles = Array.isArray(st.roles) ? st.roles : [];
    if (roles.length){
      root.appendChild(el('h4', null, '角色会话跨度均值（含挂起）'));
      roles.forEach(function(r){
        root.appendChild(sysRow(r.role, r.count + ' 次 · ' + (r.avgSpanMin || 0) + ' 分钟'));
      });
    }
    root.appendChild(el('div', 'stat-note', '按完成时刻归天 · 有效=角色执行区间并集 · 等待含挂起/过夜/等主人标记时间 · 卡住自事件留痕上线起计' + (st.tApprox ? ' · 部分任务起点按会话估算(t≈)' : '')));
  } catch (e) {
    root.appendChild(el('div', 'stat-note', '统计渲染异常：' + String(e && e.message || e))); /* 失败隔离：不连带面板其他区块 */
  }
}
/* task120：面板区块构建（内容自原 sysRenderPanel 原样搬移，口径零新造） */
function sysPanelMem(p){
  p.appendChild(el('h4', null, '内存'));
  p.appendChild(sysRow('总量', (SYS.haveWatch && SYS.memTotalMb) ? (SYS.memTotalMb / 1024).toFixed(1) + ' G' : '—'));
  p.appendChild(sysRow('可用', (SYS.haveWatch && SYS.memAvailMb) ? (SYS.memAvailMb / 1024).toFixed(1) + ' G' : '—'));
  p.appendChild(sysRow('已用', (SYS.haveWatch && SYS.memAvailMb && SYS.memTotalMb) ? ((SYS.memTotalMb - SYS.memAvailMb) / 1024).toFixed(1) + ' G' : '—'));
  var bar = el('div', 'sysbar'); var bi = el('i');
  var usedPct = (SYS.haveWatch && SYS.memTotalMb) ? Math.max(0, Math.min(100, Math.round((1 - SYS.memAvailMb / SYS.memTotalMb) * 100))) : 0;
  if (SYS.haveWatch && SYS.memTotalMb) bi.style.width = usedPct + '%';
  bar.appendChild(bi);
  p.appendChild(bar);
  p.appendChild(sysRow('已用占比', (SYS.haveWatch && SYS.memTotalMb) ? usedPct + '%' : '—'));
  /* task121：进程区块（节点复用+指纹抑制——行内两步确认状态跨 10s 面板重建保留，同 statsRoot 模式） */
  sysProcsEnsure(false);
  p.appendChild(sysProcsNode());
}
/* task121：进程管理（仅本用户；小DJ 全家服务端硬保护；kill=SIGTERM 温和关闭） */
function sysProcsEnsure(force){
  if (!force && SYS.procsBusy) return;
  if (!force && SYS.procsAt && Date.now() - SYS.procsAt < 60000) return;
  SYS.procsBusy = true;
  SYS.procsAt = Date.now();
  fetch('/_procs').then(function(r){ return r.json() }).then(function(d){
    SYS.procs = (d && d.ok) ? d : ((SYS.procs && SYS.procs.ok) ? SYS.procs : null);
  }).catch(function(){
    SYS.procs = (SYS.procs && SYS.procs.ok) ? SYS.procs : null;
  }).then(function(){
    SYS.procsBusy = false;
    if (SYS.open) sysRenderPanel();
  });
}
function sysProcsNode(){
  if (!SYS.procsRoot){
    SYS.procsRoot = el('div');
    SYS.procsSig = '';
  }
  var sig = SYS.procs === undefined ? 'loading' : (SYS.procs === null ? 'fail' : JSON.stringify(SYS.procs.procs || []) + '|' + (SYS.procs.sumMb || 0));
  if (sig !== SYS.procsSig){
    SYS.procsSig = sig;
    sysProcsPaint(SYS.procsRoot);
  }
  return SYS.procsRoot;
}
function sysProcsPaint(root){
  root.textContent = '';
  root.appendChild(el('h4', null, '进程 · 按内存排序（仅本用户）'));
  try {
    if (SYS.procs === undefined){ root.appendChild(el('div', 'stat-note', '进程列表加载中…')); return }
    if (SYS.procs === null){ root.appendChild(el('div', 'stat-note', '进程列表暂不可用，稍后自动重试（若刚更新版本，请重启小DJ 网关）')); return } /* 御史P1-6：旧网关 404 会无限重试，提示主人重启 */
    var list = SYS.procs.procs || [];
    if (!list.length){ root.appendChild(el('div', 'stat-note', '当前没有可显示的本用户进程')); return }
    var listBox = el('div', 'proc-list');
    list.forEach(function(p){
      var row = el('div', 'sysrow proc-row');
      var nm = el('span', 'proc-name', (p.prot ? '🔒 ' : '') + p.name);
      nm.title = p.name + ' · PID ' + p.pid;
      row.appendChild(nm);
      var meta = el('span', 'proc-meta');
      meta.appendChild(el('b', null, p.rssMb + 'M'));
      var btn = el('button', 'proc-kill', '关闭');
      btn.type = 'button';
      if (p.prot){
        btn.textContent = '保护';
        btn.disabled = true;
      } else {
        var armed = false, armT = null;
        var disarm = function(){ armed = false; btn.textContent = '关闭'; btn.classList.remove('proc-kill-armed'); btn.disabled = false };
        btn.onclick = function(){
          if (SYS.killBusy) return;
          if (!armed){ /* 两步确认：首点武装，3s 未点自动解除 */
            armed = true;
            btn.textContent = '确认关闭?';
            btn.classList.add('proc-kill-armed');
            if (armT) clearTimeout(armT);
            armT = setTimeout(disarm, 3000);
            return;
          }
          if (armT) clearTimeout(armT);
          SYS.killBusy = true;
          btn.disabled = true;
          fetch('/_procs/kill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: p.pid }) })
            .then(function(r){ return r.json() })
            .then(function(d){
              SYS.killBusy = false;
              disarm(); /* 进程若抗住 SIGTERM 仍在列表，按钮可再点一次；已消失则整行随指纹重绘消失 */
              if (d && d.ok){ toast('已发送关闭：' + String(p.name || '').slice(0, 40) + '（PID ' + p.pid + '）'); sysProcsEnsure(true) }
              else toast('关闭失败：' + ((d && d.error) || '未知错误'), true, 5000);
            })
            .catch(function(e){
              SYS.killBusy = false;
              disarm();
              toast('关闭失败：网络异常或服务未响应，请稍后再试', true, 5000); /* 御史P1-2/P2-14：签名(isErr,ms)对齐+不回吐英文原始异常 */
            });
        };
      }
      meta.appendChild(btn);
      row.appendChild(meta);
      listBox.appendChild(row);
    });
    root.appendChild(listBox);
    root._procList = listBox;
    listBox.addEventListener('scroll', function(){ root._procScrollTop = listBox.scrollTop });
    var total = SYS.procs.total || list.length;
    if (list.length > 7) root.appendChild(el('div', 'stat-note', '表内上下滚动查看全部 ' + list.length + ' 个（默认露约 7 行）')); /* 7 与 .proc-list 156px（7×22）对应 */
    if (total > list.length) root.appendChild(el('div', 'stat-note', '共 ' + total + ' 个，最多加载前 ' + list.length + ' 个'));
    /* task122：已用内存构成对账——列表求和天然小于「已用」，此处把差额来源写明（不编数据，取不到就不显示） */
    var sumMb = Number(SYS.procs.sumMb);
    if (!isFinite(sumMb) || sumMb <= 0){
      sumMb = 0;
      list.forEach(function(p){ sumMb += Number(p.rssMb) || 0 });
    }
    var usedMb = (SYS.haveWatch && SYS.memTotalMb && SYS.memAvailMb) ? Math.max(0, SYS.memTotalMb - SYS.memAvailMb) : 0;
    if (sumMb > 0) root.appendChild(sysRow('本用户进程合计', (sumMb / 1024).toFixed(1) + ' G'));
    if (usedMb > 0 && sumMb > 0){
      var otherMb = Math.max(0, usedMb - sumMb);
      root.appendChild(sysRow('系统 / 内核 / 其他', '约 ' + (otherMb / 1024).toFixed(1) + ' G'));
    }
    root.appendChild(el('div', 'stat-note', '已用 = 总量 − 可用。本机 /proc 对系统进程不可见（hidepid=invisible），进程 RSS 还会对共享库重复计数，所以上方列表合计小于已用属于正常，不是漏算。'));
    root.appendChild(el('div', 'stat-note', '只列您用户名下的进程；🔒=小DJ 服务全家已保护；关闭=温和终止(SIGTERM)，无响应可稍后再试')); /* 御史P2-6：不承诺「再点一次」强杀（仍SIGTERM） */
  } catch (e) {
    root.appendChild(el('div', 'stat-note', '进程列表渲染异常：' + String((e && e.message) || e))); /* 失败隔离：不连带面板其他区块 */
  }
}
function sysPanelQuo(p){
  /* task386：与 djh 积分面板同源全量上屏（DJH 快照 config/score-snapshot.json）；
     实时接口（DS 余额 / GLM 配额）优先、快照兜底；缺数据源如实「—」，不编数字。 */
  var d = (SYS.scr && SYS.scr.ok !== false && SYS.scr.at) ? SYS.scr : null;
  var acc = (d && d.cloud && d.cloud.accounts) ? d.cloud.accounts : {};
  function accTxt(k?){
    var a = acc[k];
    return (a && a.ok && a.balance != null) ? ('￥ ' + sysScoreAmt(a.balance)) : '—';
  }
  function siteVal(b?){
    return (b && b.ok && b.balance != null) ? ('积分 ' + sysScoreAmt(b.balance)) : '—';
  }
  function checkRow(granted?, amount?, fallback?){
    var n = (amount != null && isFinite(Number(amount))) ? Number(amount) : fallback;
    var r = el('div', 'stat-note');
    r.textContent = (granted ? '☑ 已领 ' : '☐ 未领 ') + n + ' 分';
    r.style.padding = '0 0 4px';
    return r;
  }
  p.appendChild(el('h4', null, '外部 API · 余额与额度'));
  p.appendChild(sysRow('DeepSeek 余额', S.balance ? S.balance : (sysSnapDs() || '—')));
  p.appendChild(sysRow('GLM 5 小时', SYS.quotaOk ? sysPct(SYS.zp5) : sysPct(sysSnapGlm('fiveHour'))));
  p.appendChild(sysRow('GLM 本周', SYS.quotaOk ? sysPct(SYS.zpW) : sysPct(sysSnapGlm('week')))); /* task121：胶囊口径本周；task386 补 5h 行（djh 同款） */
  p.appendChild(sysRow('火山方舟', accTxt('volc')));
  p.appendChild(sysRow('腾讯云', accTxt('tencent')));
  p.appendChild(sysRow('阿里云', accTxt('aliyun')));
  p.appendChild(sysRow('华为云', accTxt('huawei')));
  p.appendChild(el('h4', null, '站点积分 · 每日签到'));
  var cn = d && d.cn, intl = d && d.intl, wb = d && d.wb, bz = d && d.bz;
  p.appendChild(sysRow('RH 中国站', siteVal(cn)));
  if (cn && cn.ok) p.appendChild(checkRow(cn.granted, cn.amount, 30));
  p.appendChild(sysRow('RH 海外站', siteVal(intl)));
  if (intl && intl.ok) p.appendChild(checkRow(intl.granted, intl.amount, 30));
  var wbLabel = 'WorkBuddy';
  if (wb && wb.ok && wb.streak != null) wbLabel += '（连签 ' + wb.streak + ' 天）';
  var wbVal = (wb && wb.ok) ? ('积分 ' + sysScoreAmt(wb.creditsLeft != null ? wb.creditsLeft : wb.totalCredits)) : '—';
  p.appendChild(sysRow(wbLabel, wbVal));
  if (wb && wb.ok) p.appendChild(checkRow(wb.checkedIn, wb.dailyCredit, 100));
  p.appendChild(sysRow('BreezeBlue', (bz && bz.ok && bz.balance != null) ? ('积分 ' + sysScoreAmt(bz.balance)) : '—'));
  /* task386-fu4：djh 同款补 OpenRouter / 魔搭两行（数据源 DJH 实时 state/or 与 /status-pills-api/ms） */
  p.appendChild(sysRow('OpenRouter', (d && d.or && d.or.ok && d.or.balance != null) ? ('$ ' + sysScoreAmt(d.or.balance)) : '—'));
  var ms = d && d.ms;
  var msTxt = '—';
  if (ms && ms.ok){
    var msSt = (ms.today && ms.today[0]) ? String(ms.today[0].state || '') : '';
    msTxt = (msSt ? msSt + ' · ' : '') + '魔粒 ' + sysScoreAmt(ms.magicube);
  }
  p.appendChild(sysRow('魔搭 ModelScope', msTxt));
  if (ms && ms.ok){
    var msChk = el('div', 'stat-note', ms.granted ? '☑ 已领' : '☐ 未领');
    msChk.style.padding = '0 0 4px';
    p.appendChild(msChk);
  }
  /* task386-fu1：主人令删「当前模型计费」整段（含「跟随 DeepSeek 余额」那行）——modelBilling() 仍供胶囊/上下文条使用，此处不再渲染 */
  if (d && d.at){
    var dt = new Date(Number(d.at));
    var p2 = function(n?){ return String(n).padStart(2, '0') };
    /* task386-fu3：快照陈旧显式上屏（DJH 推送 5 分钟一更；>30 分钟视为过期）——旧值不再冒充实时 */
    var ageMs = Date.now() - dt.getTime();
    var stale = ageMs > 30 * 60 * 1000;
    var ageTxt = '';
    if (ageMs > 0){
      var hrs = ageMs / 3600000;
      ageTxt = hrs >= 24 ? ('已过期 ' + Math.floor(hrs / 24) + ' 天') : (hrs >= 1 ? ('已过期 ' + Math.floor(hrs) + ' 小时') : ('已过期 ' + Math.max(1, Math.round(ageMs / 60000)) + ' 分钟'));
    }
    var live = d.source === 'djh-live';
    var note = el('div', 'stat-note', live
      ? ('实时 · DJH 同步 ' + p2(dt.getHours()) + ':' + p2(dt.getMinutes()) + ':' + p2(dt.getSeconds()) + '（60s 缓存）')
      : ('快照同步 ' + dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()) + ' ' + p2(dt.getHours()) + ':' + p2(dt.getMinutes()) + (stale ? ' · ' + ageTxt + '（DJH 推送中断，等源恢复；DS/GLM 为实时）' : ' · DJH 推送（本端只读）')));
    if (!live && stale) note.style.color = 'var(--warn)';
    p.appendChild(note);
  } else if (SYS.scrErr){
    p.appendChild(el('div', 'stat-note', '积分快照：' + SYS.scrErr));
  }
}
function sysPanelTask(p){
  p.appendChild(el('h4', null, '活跃任务'));
  var counts = { queued: 0, running: 0, waiting: 0, blocked: 0 };
  sysActiveUnits().forEach(function(u){ if (counts[u.state] != null) counts[u.state]++ });
  p.appendChild(sysRow('排队 / 执行 / 等待 / 受阻', (counts.queued + counts.running + counts.waiting + counts.blocked) + ' 个', null));
  var r2 = el('div', 'sysrow'); r2.style.color = 'var(--faint)';
  r2.appendChild(el('span', null, counts.running + ' · ' + counts.queued + ' · ' + counts.waiting + ' · ' + counts.blocked));
  p.appendChild(r2);
}
function sysPanelStat(p){
  sysStatsEnsure();
  p.appendChild(sysStatsNode());
}
function sysRenderPanel(){
  var p = $('#sysPanel'); if (!p) return;
  var keepTop = p.scrollTop; /* task119：重建前后保持滚动位置（overflow 后 10s 重建不跳顶） */
  p.textContent = '';
  var sec = SYS.sec || 'all';
  if (!window.matchMedia || !window.matchMedia('(min-width:1121px)').matches) sec = 'all'; /* task120 P2-2：非 PC 只有合一胶囊可点，渲染层恒按全量兜底（不改 SYS.sec，回 PC 后原区块仍在） */
  if (sec === 'mem' || sec === 'all') sysPanelMem(p);
  if (sec === 'quo' || sec === 'all') sysPanelQuo(p);
  if (sec === 'task' || sec === 'all') sysPanelTask(p);
  if (sec === 'stat' || sec === 'all') sysPanelStat(p);
  p.scrollTop = keepTop;
  /* task122-fu1：进程表滚动恢复必须在节点挂回文档后（detach 期间赋 scrollTop 会被浏览器丢弃） */
  if (SYS.procsRoot && SYS.procsRoot._procList) SYS.procsRoot._procList.scrollTop = SYS.procsRoot._procScrollTop || 0;
}
window.SYS=SYS; window.sysActiveUnits=sysActiveUnits; window.sysMemAvailText=sysMemAvailText; window.sysWatch=sysWatch; window.sysFetchQuota=sysFetchQuota; window.sysFetchScore=sysFetchScore; window.sysPct=sysPct; window.sysScoreAmt=sysScoreAmt; window.sysSnapGlm=sysSnapGlm; window.sysSnapDs=sysSnapDs; window.modelBilling=modelBilling; window.refreshBillingViews=refreshBillingViews; window.sysRender=sysRender; window.sysSetPill=sysSetPill; window.sysRow=sysRow; window.sysStatsEnsure=sysStatsEnsure; window.sysStatsNode=sysStatsNode; window.sysStatsPaint=sysStatsPaint; window.sysPanelMem=sysPanelMem; window.sysProcsEnsure=sysProcsEnsure; window.sysProcsNode=sysProcsNode; window.sysProcsPaint=sysProcsPaint; window.sysPanelQuo=sysPanelQuo; window.sysPanelTask=sysPanelTask; window.sysPanelStat=sysPanelStat; window.sysRenderPanel=sysRenderPanel;

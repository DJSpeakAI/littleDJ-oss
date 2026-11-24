/* @module plugins @order 49 @职责 插件专区(task330:截图标注=框选区+圈圈+复制/另存为; task331:补剪贴板复制; task351:Alt+A快捷键; task352:Alt+A圈屏抓屏+发小DJ; task354:http下抓屏自动切https一次直达; task355:整屏截图约束强化=选择器默认整个屏幕) @提供 PLG openPlugins plgAnnotate plgClose plgNorm plgEllipse plgInSel plgPlaceBar plgRedraw plgLayout plgBlob plgToast plgCopy plgSave plgCapture plgSend plgBindHotkey plgHttpsCapUrl plgAutoCapFromUrl @依赖 $ @依赖运行期 window.addImageFile @DOM契约 - @严格模式 是 @全局占用 PLG openPlugins plgAnnotate plgBindHotkey plgBlob plgCapture plgClose plgCopy plgEllipse plgInSel plgLayout plgNorm plgPlaceBar plgRedraw plgSave plgSend plgToast plgHttpsCapUrl plgAutoCapFromUrl @测试锚点 selftest-load-ui ORDER@49 deploy/selftest-altshot.js deploy/selftest-https-cap.js @被调用 bootstrap #btnPlugins plgBindHotkey() */
'use strict';
/* ---------- task330 v2：插件专区（左栏「🧩 插件」入口） ----------
   第 1 号插件：截图标注（微信式两步）——选图后：①拖框选区 ②选区下方工具条只有
   「⭕ 圈圈」（选区内拖动画红椭圆，可多个）和「💾 另存为」（裁剪选区保存/分享）。
   选区外重新拖框=换选区；Esc 关闭。
   task352：Alt+A 主路径=plgCapture 圈屏抓屏（getDisplayMedia 抓一帧→进本标注器，
   对齐 DAG AI Chat「截屏→圈选→标注」四步）；HTTP 内网无安全上下文 → 降级现状
   （选图）+ toast 指路「系统截图后 Ctrl+V」（paste 链路在 attachments.js）。 */
var PLG: any = { mask: null, anno: null, shapes: [], img: null, box: null, drag: null, sel: null, bar: null, keyHandler: null };

function plgClose(){
  if (PLG.anno){ PLG.anno.remove(); PLG.anno = null }
  if (PLG.mask){ PLG.mask.remove(); PLG.mask = null }
  if (PLG.keyHandler){ document.removeEventListener('keydown', PLG.keyHandler, true); PLG.keyHandler = null }
  PLG.shapes = []; PLG.img = null; PLG.box = null; PLG.drag = null; PLG.sel = null; PLG.bar = null;
}

function plgNorm(a?){
  var r = { x: a.x, y: a.y, w: a.w, h: a.h };
  if (r.w < 0){ r.x += r.w; r.w = -r.w }
  if (r.h < 0){ r.y += r.h; r.h = -r.h }
  return r;
}
function plgEllipse(c?, s?, lw?){
  c.strokeStyle = '#ff2d2d'; c.lineWidth = lw;
  c.beginPath();
  c.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.max(1, s.w / 2), Math.max(1, s.h / 2), 0, 0, Math.PI * 2);
  c.stroke();
}
function plgInSel(p?){
  return !!PLG.sel && p.x >= PLG.sel.x && p.x <= PLG.sel.x + PLG.sel.w && p.y >= PLG.sel.y && p.y <= PLG.sel.y + PLG.sel.h;
}
function plgRedraw(){
  var st = PLG.anno; if (!st) return;
  var cv = st.querySelector('canvas'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  /* 选区视觉：外暗内透（微信式）——选区本身不着色，只有一圈细白边 */
  var r = PLG.sel || (PLG.drag && PLG.drag.kind === 'sel' ? plgNorm(PLG.drag) : null);
  if (r){
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0, 0, cv.width, r.y);
    ctx.fillRect(0, r.y + r.h, cv.width, cv.height - r.y - r.h);
    ctx.fillRect(0, r.y, r.x, r.h);
    ctx.fillRect(r.x + r.w, r.y, cv.width - r.x - r.w, r.h);
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    ctx.lineWidth = 3 / PLG.box.scale;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  var lw = 4 / PLG.box.scale;
  var list = PLG.drag && PLG.drag.kind === 'ellipse' ? PLG.shapes.concat([plgNorm(PLG.drag)]) : PLG.shapes;
  for (var i = 0; i < list.length; i++) plgEllipse(ctx, list[i], lw);
}
function plgPlaceBar(){
  var st = PLG.anno; if (!st || !PLG.bar) return;
  if (!PLG.sel){ PLG.bar.style.display = 'none'; return }
  PLG.bar.style.display = 'flex';
  var cv = st.querySelector('canvas'), r = cv.getBoundingClientRect(), k = r.width / cv.width;
  var bw = PLG.bar.offsetWidth || 230, bh = PLG.bar.offsetHeight || 42;
  var x = r.left + (PLG.sel.x + PLG.sel.w) * k - bw;
  var y = r.top + (PLG.sel.y + PLG.sel.h) * k + 8;
  if (y + bh > window.innerHeight - 8) y = r.top + PLG.sel.y * k - bh - 8;
  if (y < 8) y = 8;
  if (x < 8) x = 8;
  if (x + bw > window.innerWidth - 8) x = window.innerWidth - bw - 8;
  PLG.bar.style.left = Math.round(x) + 'px';
  PLG.bar.style.top = Math.round(y) + 'px';
}
function plgLayout(){
  var st = PLG.anno; if (!st || !PLG.img) return;
  var vw = window.innerWidth, vh = window.innerHeight;
  /* 铺满全屏不缩小：取「刚好盖住整个视口」的缩放 */
  var k = Math.max(vw / PLG.img.naturalWidth, vh / PLG.img.naturalHeight);
  var w = Math.round(PLG.img.naturalWidth * k), h = Math.round(PLG.img.naturalHeight * k);
  var holder = st.querySelector('.plg-holder');
  holder.style.left = Math.round((vw - w) / 2) + 'px';
  holder.style.top = Math.round((vh - h) / 2) + 'px';
  holder.style.width = w + 'px'; holder.style.height = h + 'px';
  var cv = st.querySelector('canvas');
  cv.width = PLG.img.naturalWidth; cv.height = PLG.img.naturalHeight;
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  PLG.box = { scale: k };
  plgRedraw();
  plgPlaceBar();
}
function plgToast(text?, ms?){
  var t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;background:rgba(20,20,22,.95);color:#fff;padding:9px 18px;border-radius:10px;font-size:13px;border:1px solid rgba(255,255,255,.15);pointer-events:none;white-space:nowrap;max-width:90vw;overflow:hidden;text-overflow:ellipsis;';
  document.body.appendChild(t);
  setTimeout(function(){ t.remove() }, ms || 2200);
}
function plgBlob(done?){
  /* 裁剪选区+红椭圆 → PNG Blob（复制/保存共用） */
  var st = PLG.anno; if (!st || !PLG.img || !PLG.sel){ done(null); return }
  var out = document.createElement('canvas');
  out.width = Math.round(PLG.sel.w); out.height = Math.round(PLG.sel.h);
  var c = out.getContext('2d');
  c.drawImage(PLG.img, PLG.sel.x, PLG.sel.y, PLG.sel.w, PLG.sel.h, 0, 0, out.width, out.height);
  var lw = 4 / PLG.box.scale;
  for (var i = 0; i < PLG.shapes.length; i++){
    var s = PLG.shapes[i];
    c.strokeStyle = '#ff2d2d'; c.lineWidth = lw;
    c.beginPath();
    c.ellipse(s.x + s.w / 2 - PLG.sel.x, s.y + s.h / 2 - PLG.sel.y, Math.max(1, s.w / 2), Math.max(1, s.h / 2), 0, 0, Math.PI * 2);
    c.stroke();
  }
  if (out.toBlob) out.toBlob(function(b){ done(b) }, 'image/png');
  else done(null);
}
function plgCopy(){
  /* 与电脑端 DJH「双击=复制」同款：复制即退出；剪贴板不可用 → 自动退回分享/保存 */
  if (!PLG.sel){ return }
  plgBlob(function(blob){
    if (!blob){ plgSave(); return }
    var finish = function(){
      plgToast('✅ 已复制，去聊天框长按粘贴', 2400);
      plgClose();
    };
    var fallback = function(){ plgSave() };
    try {
      if (navigator.clipboard && window.ClipboardItem){
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(finish, fallback);
      } else { fallback() }
    } catch(e){ fallback() }
  });
}
function plgSave(){
  var st = PLG.anno; if (!st || !PLG.img || !PLG.sel) return;
  /* 保存完成 = 分享面板正常关闭 → 整个退出（标注器+面板一起收）；
     用户在分享面板点取消 → 留在截图模式（不误退） */
  var done = function(){ plgClose() };
  var finish = function(blob){
    var f = new File([blob], '截图标注.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [f] })){
      navigator.share({ files: [f], title: '截图标注' }).then(done, function(){ /* 取消：留在截图 */ });
    } else {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '截图标注.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function(){ URL.revokeObjectURL(a.href) }, 8000);
      done();
    }
  };
  plgBlob(finish);
}
function plgAnnotate(src?){
  plgClose();
  var im = new Image();
  im.onload = function(){
    PLG.img = im; PLG.shapes = []; PLG.drag = null; PLG.sel = null;
    var st = document.createElement('div');
    st.id = 'plgAnno';
    st.style.cssText = 'position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.9);overflow:hidden;';
    st.innerHTML =
      '<div class="plg-holder" style="position:absolute;box-shadow:0 8px 44px rgba(0,0,0,.7);">' +
      '<img alt="" draggable="false" style="width:100%;height:100%;display:block;user-select:none;-webkit-user-drag:none;">' +
      '<canvas style="position:absolute;inset:0;cursor:crosshair;touch-action:none;"></canvas></div>' +
      '<div class="plg-hint" style="position:absolute;top:14px;left:50%;transform:translateX(-50%);font-size:13px;color:#eee;background:rgba(0,0,0,.55);padding:6px 16px;border-radius:999px;pointer-events:none;white-space:nowrap;">拖动框选区域 · 双击=复制</div>' +
      '<div class="plg-bar" style="position:absolute;display:none;gap:8px;align-items:center;background:rgba(24,24,26,.96);border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:6px;z-index:2;">' +
      '<button data-a="circle" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;line-height:1;border:1px solid #ff2d2d;background:transparent;color:#eee;">⭕ 圈圈</button>' +
      '<button data-a="send" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;line-height:1;border:1px solid rgba(255,255,255,.16);background:transparent;color:#eee;">➕ 发小DJ</button>' +
      '<button data-a="copy" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;line-height:1;border:1px solid rgba(255,255,255,.16);background:transparent;color:#eee;">📋 复制</button>' +
      '<button data-a="save" style="display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;line-height:1;border:1px solid transparent;background:#ff2d2d;color:#fff;font-weight:600;">💾 另存为</button></div>';
    document.body.appendChild(st);
    st.querySelector('img').src = src;
    PLG.anno = st;
    PLG.bar = st.querySelector('.plg-bar');
    var cv = st.querySelector('canvas');
    var nat = function(ev){
      var r = cv.getBoundingClientRect();
      return {
        x: (ev.clientX - r.left) / r.width * PLG.img.naturalWidth,
        y: (ev.clientY - r.top) / r.height * PLG.img.naturalHeight
      };
    };
    cv.addEventListener('pointerdown', function(ev){
      if (ev.button !== 0) return;
      ev.preventDefault();
      var p = nat(ev);
      if (!PLG.sel || !plgInSel(p)){
        PLG.sel = null; PLG.shapes = [];
        PLG.drag = { kind: 'sel', x: p.x, y: p.y, w: 0, h: 0 };
      } else {
        PLG.drag = { kind: 'ellipse', x: p.x, y: p.y, w: 0, h: 0 };
      }
      plgPlaceBar();
      try { cv.setPointerCapture(ev.pointerId) } catch(e){}
    });
    cv.addEventListener('pointermove', function(ev){
      if (!PLG.drag) return;
      var p = nat(ev);
      PLG.drag.w = p.x - PLG.drag.x; PLG.drag.h = p.y - PLG.drag.y;
      plgRedraw();
    });
    var up = function(){
      if (!PLG.drag) return;
      var r = plgNorm(PLG.drag); var kind = PLG.drag.kind;
      PLG.drag = null;
      if (kind === 'sel'){
        PLG.sel = (r.w >= 10 && r.h >= 10) ? r : null;
        if (PLG.sel) st.querySelector('.plg-hint').textContent = '画红椭圆 · ➕=发小DJ · 双击=复制 · 框外重拖=换选区';
      } else if (r.w >= 6 && r.h >= 6){
        PLG.shapes.push(r);
      }
      plgRedraw();
      plgPlaceBar();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    /* 选区内双击 = 复制到剪贴板并退出（与电脑端 DJH 同款；不支持时自动退回保存） */
    cv.addEventListener('dblclick', function(ev){
      if (!PLG.sel || !PLG.img) return;
      var r = cv.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width * PLG.img.naturalWidth;
      var y = (ev.clientY - r.top) / r.height * PLG.img.naturalHeight;
      if (plgInSel({ x: x, y: y })) plgCopy();
    });
    PLG.bar.addEventListener('click', function(ev){
      var a = (ev.target as HTMLElement).getAttribute && ev.target.getAttribute('data-a');
      if (a === 'save'){ plgSave() }
      else if (a === 'copy'){ plgCopy() }
      else if (a === 'send'){ plgSend() } /* task352：圈选直进输入框附件 */
      /* 圈圈是默认唯一画笔，按钮只做提示高亮 */
    });
    PLG.keyHandler = function(ev){
      if (ev.key !== 'Escape') return;
      ev.preventDefault(); ev.stopPropagation();
      if (PLG.anno){ PLG.anno.remove(); PLG.anno = null; PLG.bar = null; PLG.shapes = []; PLG.drag = null; PLG.sel = null }
      else plgClose();
    };
    document.addEventListener('keydown', PLG.keyHandler, true);
    window.addEventListener('resize', plgLayout);
    plgLayout();
  };
  im.src = src;
}

/* task354：http → https 一次直达（内网 IP/localhost 才自动跳；非 IP 域名返回空走降级） */
function plgHttpsCapUrl(){
  if (location.protocol === 'https:') return '';
  var hn = location.hostname || '';
  var isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hn) || hn === 'localhost' || hn.charAt(0) === '[';
  if (!isIp) return '';
  var q = location.search || '';
  if (!/[?&]plgcap=1(?:&|$)/.test(q)) q += (q ? '&' : '?') + 'plgcap=1';
  return 'https://' + hn + ':8443' + (location.pathname || '/') + q;
}
/* task354：https 落地检测 ?plgcap=1 → 清参防刷新重复 + 自动开插件专区 + 抓屏按钮脉冲高亮。
   不自动调 getDisplayMedia（页面加载无用户手势，浏览器必拒）——引导主人点一下按钮即成功。 */
function plgAutoCapFromUrl(){
  try {
    var q = location.search || '';
    if (!/[?&]plgcap=1(?:&|$)/.test(q)) return;
    if (location.protocol !== 'https:') return;
    var nq = q.replace(/([?&])plgcap=1&?/, '$1').replace(/[?&]$/, '');
    try { history.replaceState(null, '', location.pathname + (nq === '?' ? '' : nq) + (location.hash || '')) } catch(e){}
    setTimeout(function(){
      openPlugins();
      if (!document.getElementById('plgPulseKf')){
        var st = document.createElement('style');
        st.id = 'plgPulseKf';
        st.textContent = '@keyframes plgPulse{0%{box-shadow:0 0 0 0 rgba(255,45,45,.85)}100%{box-shadow:0 0 0 16px rgba(255,45,45,0)}}';
        document.head.appendChild(st);
      }
      var b: any = document.querySelector('#plgShot');
      if (b){ b.style.animation = 'plgPulse 1s ease-out 5'; b.style.boxShadow = '0 0 0 3px rgba(255,45,45,.5)' }
      plgToast('✅ 已切到加密页，点一下「抓屏截图」开始', 4200);
    }, 350);
  } catch(e){}
}

function plgCapture(fromBtn?){
  /* task352：圈屏抓屏（Alt+A 主路径，对齐 DAG AI Chat 的 Alt+A 心智）。
     getDisplayMedia 只在安全上下文（https / localhost）存在；HTTP 内网/手机 Web 没有。
     task354：http 下不再只弹提示——点「抓屏截图」/ Alt+A 直接自动切 https://host:8443
     同路径（带 ?plgcap=1），落地自动开插件专区+按钮脉冲高亮，一次点击直达抓屏。
     仅「非 IP 的 http 域名」或「已是 https 但浏览器不支持 getDisplayMedia」保留降级。 */
  var md = navigator.mediaDevices;
  if (!md || !md.getDisplayMedia){
    var httpsUrl = plgHttpsCapUrl();
    if (httpsUrl){
      plgToast('正在切换到加密页抓屏…首次若提示「不安全」，点「高级 → 继续访问」即可', 3800);
      setTimeout(function(){ location.href = httpsUrl }, 350);
      return;
    }
    /* task353：兜底指路地址；外网 https 域名本身安全上下文不会进这分支 */
    plgToast('此处不能直接抓屏：用 https://' + (location.hostname || '192.0.2.10') + ':8443 打开即可圈屏 · 或系统截图后 Ctrl+V', 4200);
    if (fromBtn) return;
    if (!document.querySelector('#plgMask')) openPlugins();
    var pick: any = document.querySelector('#plgPick');
    if (pick) pick.click(); /* keydown 是用户手势，可弹文件选择器 */
    return;
  }
  var stopAll = function(s){ try { s.getTracks().forEach(function(t){ t.stop() }) } catch(e){} };
  /* task355：微信式整屏截图——displaySurface:'monitor' 让选择器默认高亮「整个屏幕」，
     selfBrowserSurface/surfaceSwitching/monitorTypeSurfaces（Chromium 顶级约束）排除自家
     标签与中途切换，分辨率取整屏物理像素（不支持的浏览器自动忽略未知键，零副作用）。
     选择器本身是浏览器安全硬规定，无法去除——默认整屏后主人点一下「分享」即可。 */
  plgToast('弹窗里选「整个屏幕」→ 点「分享/开始」', 3600);
  var sw: any = window.screen || {}, dpr = window.devicePixelRatio || 1;
  md.getDisplayMedia({
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'exclude',
    monitorTypeSurfaces: 'include',
    video: {
      displaySurface: 'monitor',
      width: { ideal: Math.round((sw.width || 1920) * dpr) },
      height: { ideal: Math.round((sw.height || 1080) * dpr) },
      frameRate: { ideal: 5 }
    }
  }).then(function(stream){
    var v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.srcObject = stream;
    var grab = function(){
      try {
        var cv = document.createElement('canvas');
        cv.width = v.videoWidth; cv.height = v.videoHeight;
        if (!cv.width || !cv.height) throw new Error('no frame');
        cv.getContext('2d').drawImage(v, 0, 0);
        var url = cv.toDataURL('image/png');
        stopAll(stream);
        plgAnnotate(url);
      } catch(e){ stopAll(stream); plgToast('抓屏失败，请重试', 2400) }
    };
    v.play().then(function(){
      var t0 = Date.now();
      var poll = function(){
        if (v.videoWidth > 0 && v.readyState >= 2){ grab(); return }
        if (Date.now() - t0 > 2500){ stopAll(stream); plgToast('抓屏失败，请重试', 2400); return }
        setTimeout(poll, 80);
      };
      /* requestVideoFrameCallback 到帧即查（Chromium）；不支持则直接轮询 */
      if (v.requestVideoFrameCallback){ v.requestVideoFrameCallback(function(){ poll() }) }
      else poll();
    }, function(){ stopAll(stream) });
  }, function(){ /* 用户在系统弹窗点取消：静默 */ });
}
function plgSend(){
  /* task352：圈选结果直接进聊天输入框附件（addImageFile 既有链路，发送时随消息上传）；
     模块未挂载（理论不会）→ 退回复制。 */
  if (!PLG.sel) return;
  plgBlob(function(blob){
    if (!blob){ plgSave(); return }
    var f = new File([blob], '截图-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.png', { type: 'image/png' });
    if (typeof window.addImageFile === 'function'){
      plgClose(); /* 先收面板再贴，防遮罩盖住缩略行 */
      window.addImageFile(f);
      plgToast('✅ 截图已加入输入框', 2400);
    } else plgCopy();
  });
}

function plgBindHotkey(){
  /* task351/task352：Alt+A = 圈屏截图（与电脑端 DAG AI Chat 同款心智）。
     桌面 https → getDisplayMedia 抓屏进圈选标注；HTTP 内网/手机 → 降级 task351 行为
     （开面板+弹选图）+ toast 指路「系统截图后 Ctrl+V」。标注进行中不抢键。 */
  document.addEventListener('keydown', function(ev){
    if (!(ev.altKey && !ev.ctrlKey && !ev.metaKey)) return;
    var k = ev.key;
    if (k !== 'a' && k !== 'A') return;
    if (document.querySelector('#plgAnno')) return; /* 正在标注：忽略 */
    ev.preventDefault();
    ev.stopPropagation();
    plgCapture(); /* keydown 是用户手势，getDisplayMedia / 文件选择器都认 */
  }, true);
}
function openPlugins(){
  if (PLG.mask){ plgClose(); return }
  var d = document.createElement('div');
  d.id = 'plgMask';
  d.style.cssText = 'position:fixed;inset:0;z-index:99996;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
  d.innerHTML =
    '<div id="plgPanel" style="width:min(420px,92vw);max-height:86vh;overflow:auto;background:#17191c;border:1px solid #2a2d31;border-radius:16px;padding:18px 18px 16px;color:#e8eaed;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.5);">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;"><span style="font-size:18px">🧩</span><b style="font-size:17px;">插件</b>' +
    '<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#26292d;color:#9aa0a8;">little DJ 插件专区</span>' +
    '<button data-a="close" style="margin-left:auto;border:0;background:transparent;color:#9aa0a8;font-size:16px;cursor:pointer;">✕</button></div>' +
    '<div style="font-size:12px;color:#8a919b;margin-bottom:14px;">我的插件都放在这里（与电脑端 DJH 插件专区同款）</div>' +
    '<div style="border:1px solid #2a2d31;border-radius:12px;padding:14px;margin-bottom:10px;">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="color:#ff2d2d;">📷</span><b style="font-size:15px;">截图标注</b>' +
    '<span style="margin-left:auto;font-size:11px;padding:2px 8px;border-radius:6px;background:#ff2d2d;color:#fff;font-weight:600;">第 1 号插件</span></div>' +
    '<div style="font-size:12.5px;line-height:1.6;color:#a8aeb6;">🖥 抓屏：选屏幕 → 拖框圈选 → 「⭕ 圈圈」标注 → ➕ 发小DJ / 复制 / 另存为（需 https 环境）。<br>📱 手机或内网：系统截屏后「选图标注」，或直接在输入框 Ctrl+V 粘贴。</div>' +
    '<button id="plgShot" style="margin-top:10px;width:100%;padding:11px;border:0;border-radius:10px;background:#ff2d2d;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">🖥 抓屏截图（Alt+A）' + (location.protocol === 'https:' ? '' : ' · 自动切 https') + '</button>' +
    '<button id="plgPick" style="margin-top:8px;width:100%;padding:11px;border:1px solid rgba(255,45,45,.55);border-radius:10px;background:transparent;color:#eee;font-size:14px;cursor:pointer;">📷 选图标注</button>' +
    '<input id="plgFile" type="file" accept="image/*" hidden>' +
    '</div>' +
    '<div style="font-size:11.5px;color:#6f757d;text-align:center;">抓屏需 https：http 下点按钮会自动切到 https://本机IP:8443（首次警告点「高级→继续访问」）；手机或系统截图后「选图标注」/ Ctrl+V 也可</div>' +
    '</div>';
  document.body.appendChild(d);
  PLG.mask = d;
  d.addEventListener('click', function(ev){
    if (ev.target === d){ plgClose(); return }
    var tg: any = ev.target;
    var a = tg.getAttribute && tg.getAttribute('data-a');
    if (a === 'close') plgClose();
  });
  var fi: any = d.querySelector('#plgFile');
  d.querySelector<HTMLElement>('#plgShot').onclick = function(){ plgCapture(true) }; /* task352：面板按钮入口（降级只 toast 不弹选图） */
  d.querySelector<HTMLElement>('#plgPick').onclick = function(){ fi.click() };
  fi.onchange = function(){
    var f = fi.files && fi.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function(){ plgAnnotate(rd.result) };
    rd.readAsDataURL(f);
    fi.value = '';
  };
  PLG.keyHandler = function(ev){
    if (ev.key !== 'Escape') return;
    ev.preventDefault(); ev.stopPropagation(); plgClose();
  };
  document.addEventListener('keydown', PLG.keyHandler, true);
}
window.PLG = PLG; window.openPlugins = openPlugins; window.plgAnnotate = plgAnnotate; window.plgClose = plgClose; window.plgBindHotkey = plgBindHotkey; window.plgCapture = plgCapture; window.plgSend = plgSend; window.plgHttpsCapUrl = plgHttpsCapUrl; window.plgAutoCapFromUrl = plgAutoCapFromUrl;
plgAutoCapFromUrl(); /* task354：https 落地 ?plgcap=1 自动开面板（其余场景零副作用） */

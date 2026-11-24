/* @module questions @order 16 @职责 提问卡片 @提供 _askSoundFor notifyQuestion hideQuestion showQuestion answerQuestion loadPendingQuestion @依赖 - @依赖运行期 playAskDing S clearQuote queuePrompt qAutoGrow toast hasFilesTypes isTextFile TEXT_FILE_MAX @DOM契约 - @严格模式 是 @全局占用 _askSoundFor notifyQuestion hideQuestion showQuestion answerQuestion loadPendingQuestion @源行 ui/index.html L4302-L4491 @测试锚点 - @被调用 - */
'use strict';
/* ---------- 提问卡片（question 工具） ---------- */
var _askSoundFor = '';
function notifyQuestion(q: any): void{
  var id = String((q && (q.id || q.requestID)) || '');
  if (id && id === _askSoundFor) return;
  _askSoundFor = id;
  playAskDing();
}
function hideQuestion(): void{
  var old = document.querySelector('.qcard'); if (old) old.remove();
  S.pendingQ = null;
}
function showQuestion(q: any): void{
  if (!q || !q.questions) return;
  notifyQuestion(q);
  hideQuestion();
  S.pendingQ = q;
  var card = el('div', 'qcard');
  var head = el('h4', null, 'little DJ 在等你确认' + (q.questions.length > 1 ? '（' + q.questions.length + ' 个问题）' : ''));
  var min = el('button', 'qmin', '−');
  min.title = '最小化';
  min.onclick = function(){
    var on = card.classList.toggle('min');
    min.textContent = on ? '▢' : '−';
    min.title = on ? '展开' : '最小化';
  };
  card.appendChild(head);
  card.appendChild(min);
  var body = el('div', 'qbody');
  var sel = q.questions.map(function(){ return [] });
  var customs = q.questions.map(function(){ return '' });
  var qimgs = q.questions.map(function(){ return [] });
  var cinputs = q.questions.map(function(){ return null });

  var submit = function(){
    var ans = q.questions.map(function(_, i){
      var a = sel[i].slice();
      if (customs[i]) a.push(customs[i]);
      return a;
    });
    var extraText = [], extraAtts = [];
    q.questions.forEach(function(_, i){
      if (!qimgs[i].length) return;
      if (customs[i]) extraText.push(customs[i]);
      qimgs[i].forEach(function(a){ extraAtts.push(a) });
    });
    answerQuestion(q, ans, function(){
      if (extraAtts.length){
        clearQuote(); /* task77 §3.4-3：问答面板补充不是"引用某条消息"，调用前清引用 */
        queuePrompt(extraText.join('\n') || '（附图）', extraAtts);
      }
    });
  };

  q.questions.forEach(function(item, qi){
    var g = el('div', 'qgroup');
    g.appendChild(el('div', 'qtext', item.question || ''));
    var opts = el('div', 'opts');
    (item.options || []).forEach(function(o){
      var b = el('button', 'opt');
      b.appendChild(el('div', null, o.label || ''));
      if (o.description) b.appendChild(el('small', null, o.description));
      b.onclick = function(){
        var arr = sel[qi], idx = arr.indexOf(o.label);
        if (item.multiple){
          if (idx >= 0) arr.splice(idx, 1); else arr.push(o.label);
        } else {
          sel[qi] = (idx >= 0) ? [] : [o.label];
        }
        Array.prototype.forEach.call(opts.children, function(c, ci){
          c.classList.toggle('on', sel[qi].indexOf((item.options[ci] || {}).label) >= 0);
        });
      };
      opts.appendChild(b);
    });
    g.appendChild(opts);
    var inp = document.createElement('textarea'); /* task178：单行 input → 多行 textarea（Enter 提交 / Shift+Enter 换行） */
    inp.className = 'qcustom';
    inp.rows = 1;
    inp.placeholder = '自定义回答（可直接输入 / Shift+Enter 换行 / 可贴图、拖 md/txt 文件）';
    inp.oninput = function(){ customs[qi] = inp.value.trim(); qAutoGrow(inp) };
    cinputs[qi] = inp;
    var imgs = el('div', 'qimgs');
    var renderImgs = function(){
      imgs.replaceChildren();
      qimgs[qi].forEach(function(a, ai){
        var t = el('div', 'qimg');
        var im = document.createElement('img'); im.src = a.url; im.alt = a.name;
        im.onclick = function(){ openImageViewer(a.url, a.name) };
        t.appendChild(im);
        var x = el('button', null, '✕'); x.title = '移除';
        x.onclick = function(){ qimgs[qi].splice(ai, 1); renderImgs() };
        t.appendChild(x);
        imgs.appendChild(t);
      });
    };
    inp.addEventListener('paste', function(e){
      var cd = e.clipboardData; if (!cd) return;
      var items = cd.items || [], got = false;
      for (var i = 0; i < items.length; i++){
        if (!items[i].type || items[i].type.indexOf('image/') !== 0) continue;
        var f = items[i].getAsFile(); if (!f) continue;
        got = true;
        if (f.size > 8 * 1024 * 1024){ toast('图片超过 8MB', true); continue }
        var rd = new FileReader();
        rd.onload = (function(file){
          return function(ev){
            qimgs[qi].push({ name: file.name || ('pasted-' + Date.now() + '.png'), mime: file.type, url: String(ev.target.result) });
            renderImgs();
          };
        })(f);
        rd.readAsDataURL(f);
      }
      if (got) e.preventDefault();
    });
    inp.addEventListener('keydown', function(e){
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing){ e.preventDefault(); submit() }
    });
    g.appendChild(inp);
    g.appendChild(imgs);
    body.appendChild(g);
  });

  var foot = el('div', 'qfoot');
  var skip = el('button', null, '跳过');
  skip.onclick = function(){ answerQuestion(q, null) };
  var go = el('button', 'go', '提交');
  go.onclick = submit;
  foot.appendChild(el('span', 'grow'));
  foot.appendChild(skip); foot.appendChild(go);
  body.appendChild(foot);
  card.appendChild(body);
  /* task178：问答卡支持拖文件（方案 B-3）——图片进第一问附件 / 文本追加进第一问自定义回答，
     preventDefault 拦下，不让 document 级当普通附件处理 */
  card.addEventListener('dragover', function(e){ if (hasFilesTypes(e.dataTransfer && e.dataTransfer.types)) e.preventDefault() });
  card.addEventListener('drop', function(e){
    if (!e.dataTransfer) return;
    var fs = e.dataTransfer.files || [];
    if (!fs.length) return;
    e.preventDefault();
    var qi = 0;
    for (var i = 0; i < fs.length; i++){
      var f = fs[i]; if (!f) continue;
      if (f.type && f.type.indexOf('image/') === 0){
        if (f.size > 8 * 1024 * 1024){ toast('图片超过 8MB', true); continue }
        (function(file){
          var rd = new FileReader();
          rd.onload = function(ev){
            qimgs[qi].push({ name: file.name || ('pasted-' + Date.now() + '.png'), mime: file.type, url: String(ev.target.result) });
            renderImgs();
          };
          rd.readAsDataURL(file);
        })(f);
      } else if (isTextFile(f)){
        if (f.size > TEXT_FILE_MAX){ toast('文件超过 256KB，暂不支持：' + (f.name || ''), true); continue }
        (function(file){
          var rd = new FileReader();
          rd.onload = function(ev2){
            customs[qi] = (customs[qi] ? customs[qi] + '\n' : '') + String(ev2.target.result || '');
            if (cinputs[qi]){ cinputs[qi].value = customs[qi]; qAutoGrow(cinputs[qi]); cinputs[qi].focus() }
            toast('已加入回答：' + (file.name || ''), false, 2000);
          };
          rd.readAsText(file);
        })(f);
      } else toast('暂只支持文本类文件与图片：' + (f.name || ''), true);
    }
  });
  $('#composer').insertBefore(card, $('#composer').firstChild);
}
function answerQuestion(q: any, answers: string[], cb?: () => void): void{
  var id = q.id || q.requestID;
  var dir = (S.current && S.current.directory) || '';
  var url = answers
    ? '/api/question/' + encodeURIComponent(id) + '/reply?directory=' + encodeURIComponent(dir)
    : '/api/question/' + encodeURIComponent(id) + '/reject?directory=' + encodeURIComponent(dir);
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: answers ? JSON.stringify({ answers: answers }) : '{}' })
    .then(function(r){ if (!r.ok) return r.text().then(function(t){ throw new Error('HTTP ' + r.status + ' ' + t.slice(0, 120)) }) })
    .then(function(){ hideQuestion(); if (cb) cb() })
    .catch(function(e){ alert('提交回答失败：' + e.message) });
}
function loadPendingQuestion(): void{
  if (!S.current) return;
  var dir = S.current.directory;
  fetch('/api/question?directory=' + encodeURIComponent(dir)).then(function(r){ return r.json() }).then(function(list){
    if (!S.current || S.current.directory !== dir) return;
    var q = (list || []).filter(function(x){ return x.sessionID === S.current.id })[0];
    if (q) showQuestion(q); else hideQuestion();
  }).catch(function(){});
}

window._askSoundFor=_askSoundFor; window.notifyQuestion=notifyQuestion; window.hideQuestion=hideQuestion; window.showQuestion=showQuestion; window.answerQuestion=answerQuestion; window.loadPendingQuestion=loadPendingQuestion;

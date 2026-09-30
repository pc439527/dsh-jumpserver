/**
 * The console page, shipped as a string by the Host.
 *
 * Deliberately dependency-free: no CDN, no build step, no framework, so the
 * page can never drift from the server that serves it. Authentication stays in
 * an HttpOnly cookie, and conversation selection is read from the URL fragment,
 * which is never sent to the Host.
 */
export function consolePage(): string {
  return PAGE
}

/*
 * String.raw is REQUIRED, not stylistic. A plain template literal processes
 * escapes before emitting, so the ANSI-strip regex reached the browser with an
 * escaped closing paren: the group never terminated, the whole inline <script>
 * failed to parse, and the console rendered as static HTML with no tab
 * switching, no buttons and no polling. Raw keeps every backslash the
 * browser's own parser is meant to see.
 */
const PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>JumpServer 控制台</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; color: #c9d1d9; font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  header { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid #21262d; }
  header .chip { padding: 1px 8px; border: 1px solid #30363d; border-radius: 999px; font-size: 11px; }
  header .chip[data-tone=ok] { border-color: rgba(63,185,80,.5); color: #3fb950; }
  header .chip[data-tone=warn] { border-color: rgba(210,153,34,.5); color: #d29922; }
  header .chip[data-tone=err] { border-color: rgba(248,81,73,.5); color: #f85149; }
  nav { display: flex; gap: 4px; padding: 6px 12px; border-bottom: 1px solid #21262d; }
  nav button { background: transparent; color: #8b949e; border: 1px solid transparent; border-radius: 6px; padding: 3px 10px; cursor: pointer; font: inherit; }
  nav button[data-active] { color: #e6edf3; border-color: #30363d; background: #161b22; }
  main { padding: 10px 12px; }
  #term { height: calc(100vh - 220px); overflow-y: auto; background: #010409; border: 1px solid #21262d; border-radius: 8px; padding: 8px 10px; white-space: pre-wrap; word-break: break-all; }
  .in { color: #d29922; } .out { color: #c9d1d9; } .meta { color: #58a6ff; } .err { color: #f85149; }
  .input { display: flex; gap: 8px; margin-top: 8px; }
  input[type=text] { flex: 1; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 6px 8px; font: inherit; }
  input[type=text]:disabled { opacity: .5; }
  button.act { background: #161b22; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; padding: 6px 10px; cursor: pointer; font: inherit; }
  button.act[disabled] { opacity: .45; cursor: default; }
  button.act.danger { border-color: rgba(248,81,73,.5); color: #f85149; }
  button.act[data-on] { border-color: rgba(63,185,80,.55); color: #3fb950; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #161b22; font-size: 12px; }
  th { color: #8b949e; font-weight: 600; }
  .badge { padding: 0 6px; border: 1px solid #30363d; border-radius: 999px; font-size: 11px; }
  .badge.refused { border-color: rgba(88,166,255,.5); color: #58a6ff; }
  .badge.bad { border-color: rgba(248,81,73,.5); color: #f85149; }
  .badge.good { border-color: rgba(63,185,80,.5); color: #3fb950; }
  .muted { color: #8b949e; }
  .notice { margin: 6px 0; padding: 5px 8px; border: 1px solid #30363d; border-radius: 6px; color: #d29922; cursor: pointer; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
</style>
</head>
<body>
<header>
  <strong>JumpServer 控制台</strong>
  <span class="chip" id="state">—</span>
  <span class="chip" id="target">—</span>
  <span class="chip" id="mode">—</span>
  <span class="chip" id="grant">—</span>
  <span class="chip muted" id="sess"></span>
  <span class="muted" id="net"></span>
</header>
<nav>
  <button data-tab="term">终端</button>
  <button data-tab="assets">资产</button>
  <button data-tab="jobs">任务</button>
  <button data-tab="audit">审计</button>
</nav>
<main>
  <section id="pane-term">
    <div id="term"></div>
    <div class="input">
      <input type="text" id="cmd" placeholder="等待授权…" disabled />
      <button class="act" id="send" disabled>发送</button>
      <button class="act danger" id="interrupt" disabled>中断</button>
      <button class="act" id="clear">清屏</button>
      <button class="act" id="follow" data-on="1">跟随：开</button>
    </div>
    <div id="confirm" class="notice" style="display:none"></div>
  </section>
  <section id="pane-assets" style="display:none"></section>
  <section id="pane-jobs" style="display:none">
    <div class="row">
      <button class="act" id="jobsRefresh">刷新</button>
      <button class="act danger" id="interrupt2" disabled>中断</button>
      <span class="muted" id="jobsNote"></span>
    </div>
    <div id="jobList"></div>
  </section>
  <section id="pane-audit" style="display:none">
    <div class="row"><button class="act" id="auditRefresh">刷新</button><span class="muted" id="auditNote"></span></div>
    <div id="auditList"></div>
  </section>
</main>
<script>
// Fragments never reach the Host, so the conversation id cannot leak into
// access logs or the discovery file.
var fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
var SESSION = fragment.get('session') || '';
var sinceSeq = 0;
var following = true;

// Follow mode: ON pins the view to the newest output on every append. OFF
// leaves the scroll position entirely to the operator. Scrolling up breaks
// follow automatically (standard terminal behaviour) and the button says so,
// so nobody is yanked back to the bottom without an explanation.
function setFollow(on) {
  following = on;
  var btn = el('follow');
  btn.textContent = '跟随：' + (on ? '开' : '关');
  if (on) btn.setAttribute('data-on', '1'); else btn.removeAttribute('data-on');
  if (on) { var t = el('term'); t.scrollTop = t.scrollHeight; }
}
var tab = 'term';
var confirmReq = null;

function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
  });
}
function strip(s) {
  // Terminal semantics, matching src/client/ansi.ts's line framer:
  //   ESC [ ... CSI  -> dropped
  //   ESC ] ... BEL  -> dropped (OSC title)
  //   CRLF / LF      -> line break
  //   lone CR        -> cursor to column 0 and OVERWRITE (progress redraw);
  //                     treating it as a newline produced the '???0.5' garbage
  //   BS             -> erase the previous character
  //   other controls -> dropped
  var text = String(s == null ? '' : s);
  var out = '';
  var line = '';
  var i = 0;
  var n = text.length;
  function flush() { out += line + '\n'; line = ''; }
  while (i < n) {
    var c = text.charAt(i);
    if (c === '\u001b') {
      var next = text.charAt(i + 1);
      if (next === '[') {
        var j = i + 2;
        while (j < n && !/[A-Za-z@-~]/.test(text.charAt(j))) j++;
        i = j + 1;
      } else if (next === ']') {
        var k = i + 2;
        while (k < n && text.charAt(k) !== '\u0007') k++;
        i = text.charAt(k) === '\u0007' ? k + 1 : k;
      } else {
        i += 2;
      }
      continue;
    }
    if (c === '\n') { flush(); i += 1; continue; }
    if (c === '\r') {
      if (text.charAt(i + 1) === '\n') { flush(); i += 2; continue; }
      line = '';
      i += 1;
      continue;
    }
    if (c === '\b') { line = line.slice(0, -1); i += 1; continue; }
    if (c === '\t' || c >= ' ') { line += c; i += 1; continue; }
    i += 1;
  }
  if (line.length > 0) out += line;
  else if (out.charAt(out.length - 1) === '\n') out = out.slice(0, -1);
  return out;
}

function api(path, body, method) {
  var init = {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: {},
    credentials: 'same-origin',
    cache: 'no-store'
  };
  if (body !== undefined) {
    init.method = 'POST';
    init.headers['content-type'] = 'application/json';
    var payload = { sessionId: SESSION };
    for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) payload[k] = body[k];
    init.body = JSON.stringify(payload);
  }
  return fetch(path, init).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (data) {
      return { status: res.status, data: data };
    });
  });
}

function setTab(next) {
  tab = next;
  var buttons = document.querySelectorAll('nav button');
  for (var i = 0; i < buttons.length; i++) {
    if (buttons[i].dataset.tab === next) buttons[i].setAttribute('data-active', '');
    else buttons[i].removeAttribute('data-active');
  }
  el('pane-term').style.display = next === 'term' ? '' : 'none';
  el('pane-assets').style.display = next === 'assets' ? '' : 'none';
  el('pane-jobs').style.display = next === 'jobs' ? '' : 'none';
  el('pane-audit').style.display = next === 'audit' ? '' : 'none';
  if (next === 'assets') loadAssets();
  if (next === 'jobs') loadJobs();
  if (next === 'audit') loadAudit();
}

function append(text, cls) {
  var term = el('term');
  var div = document.createElement('div');
  div.className = cls || 'out';
  div.textContent = text;
  term.appendChild(div);
  if (following) term.scrollTop = term.scrollHeight;
}

function renderStatus(st) {
  st = st || {};
  el('state').textContent = String(st.state || '—');
  el('state').dataset.tone =
    st.state === 'ASSET_SHELL' || st.state === 'JUMPSERVER_MENU' || st.state === 'COMMAND_RUNNING' ? 'ok'
      : st.state === 'UNKNOWN' || st.state === 'ERROR' || st.state === 'DISCONNECTED' ? 'err' : 'warn';
  el('target').textContent = st.target ? String(st.target) + (st.hostname ? ' / ' + st.hostname : '') : '未进入资产';
  el('mode').textContent = String(st.permissionMode || '—');
  var granted = st.granted === true;
  el('grant').textContent = granted ? '已授权' : '未授权';
  el('grant').dataset.tone = granted ? 'ok' : 'err';
  el('sess').textContent = SESSION || '(未指定对话)';
  var canType = granted && (st.state === 'ASSET_SHELL' || st.state === 'JUMPSERVER_MENU');
  el('cmd').disabled = !canType;
  el('send').disabled = !canType;
  el('cmd').placeholder = st.state === 'JUMPSERVER_MENU'
    ? '菜单态：p 列资产 / IP 或名称 进入 / q 结束会话'
    : '在已进入的资产上执行一条命令';
  el('interrupt').disabled = !granted;
  el('interrupt2').disabled = !granted;
}

function renderConfirm(req) {
  var box = el('confirm');
  if (req === null) { box.style.display = 'none'; box.textContent = ''; box.onclick = null; return; }
  confirmReq = req;
  box.style.display = '';
  box.textContent = '该命令需要二次确认（' + String(req.risk || 'MODIFY') + '）：' + String(req.command || '') + ' — 点击此处确认执行（仅本次）';
  box.onclick = function () {
    box.style.display = 'none';
    api('/api/jumpserver.manual', { sessionId: SESSION, command: req.command, confirmed: true, confirmToken: req.confirmToken })
      .then(function (res) {
        if (res.data && res.data.ok === true) append('$ ' + String(req.command), 'in');
        else append('确认执行失败：' + String((res.data && (res.data.message || res.data.code)) || res.status), 'err');
        confirmReq = null;
        poll();
      });
  };
}

function poll() {
  api('/api/jumpserver.status', { sessionId: SESSION }).then(function (statusRes) {
    var st = statusRes.data || {};
    el('net').textContent = st.code ? String(st.code) : '';
    renderStatus(st);
    return api('/api/jumpserver.snapshot', { sessionId: SESSION, sinceSeq: sinceSeq });
  }).then(function (snap) {
    var data = snap.data || {};
    if (data.lastSeq !== undefined && Number(data.lastSeq) >= sinceSeq) sinceSeq = Number(data.lastSeq) + 1;
    var events = Array.isArray(data.events) ? data.events : [];
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      if (ev.visibility === 'internal') continue;
      if (ev.type === 'input') append('$ ' + strip(ev.data), 'in');
      else if (ev.type === 'output') append(strip(ev.data), 'out');
      else if (ev.type === 'state') append('[state] ' + String(ev.prev || '?') + ' -> ' + String(ev.state || '?'), 'meta');
      else if (ev.type === 'target') append('[target] ' + String(ev.target || '') + (ev.hostname ? ' (' + ev.hostname + ')' : ''), 'meta');
      else if (ev.type === 'error') append('[error] ' + String(ev.message || ''), 'err');
    }
  }).catch(function () { el('net').textContent = '连接控制台失败'; });
}

function send() {
  var input = el('cmd');
  var command = input.value.trim();
  if (command.length === 0) return;
  input.value = '';
  api('/api/jumpserver.manual', { sessionId: SESSION, command: command }).then(function (res) {
    var data = res.data || {};
    if (data.code === 'MANUAL_CONFIRM_REQUIRED') {
      renderConfirm({ command: command, risk: data.risk, confirmToken: data.confirmToken });
      return;
    }
    if (data.ok === true) append('$ ' + command, 'in');
    else append('执行失败：' + String(data.message || data.code || res.status), 'err');
    poll();
  });
}

function loadAssets() {
  var pane = el('pane-assets');
  pane.innerHTML = '<div class="muted">加载中…</div>';
  api('/api/jumpserver.assets', { sessionId: SESSION }).then(function (res) {
    var data = res.data || {};
    if (!Array.isArray(data.rows)) {
      pane.innerHTML = '<div class="muted">资产列表需要在堡垒机菜单态获取：' + esc(data.message || data.code || '') + '</div>';
      return;
    }
    var rows = data.rows;
    var head = '<div class="muted">共 ' + String(data.count || rows.length) + (data.reportedTotal ? ' / ' + String(data.reportedTotal) : '') + ' 台（健康度 ' + esc(data.health || '?') + '）</div>';
    var body = '<table><thead><tr><th>名称</th><th>IP</th><th>系统</th><th>节点</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      body += '<tr><td>' + esc(rows[i].name) + '</td><td>' + esc(rows[i].ip) + '</td><td>' + esc(rows[i].platform) + '</td><td>' + esc(rows[i].node) + '</td></tr>';
    }
    pane.innerHTML = head + body + '</tbody></table>';
  });
}

function loadJobs() {
  api('/api/jumpserver.jobs', { sessionId: SESSION }).then(function (res) {
    var data = res.data || {};
    var jobs = Array.isArray(data.jobs) ? data.jobs : [];
    el('jobsNote').textContent = jobs.length === 0 ? '本对话没有流式任务' : String(jobs.length) + ' 个任务';
    if (jobs.length === 0) {
      el('jobList').innerHTML = '<div class="muted">用 jumpserver_job_start 启动 tail -f / journalctl -f / tcpdump 后在此查看与停止</div>';
      return;
    }
    var html = '<table><thead><tr><th>状态</th><th>目标</th><th>命令</th><th>输出</th><th></th></tr></thead><tbody>';
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      var cls = j.state === 'RUNNING' ? 'good' : j.state === 'LOST' ? 'bad' : '';
      html += '<tr><td><span class="badge ' + cls + '">' + esc(j.state) + '</span></td><td>' + esc(j.target) + '</td><td>' + esc(j.command) + '</td><td>'
        + String(Math.round((j.bytes || 0) / 1024)) + ' KB</td><td>'
        + '<button class="act" data-stop="' + esc(j.id) + '"' + (j.state !== 'RUNNING' ? ' disabled' : '') + '>停止</button></td></tr>';
    }
    el('jobList').innerHTML = html + '</tbody></table>';
    var stops = document.querySelectorAll('[data-stop]');
    for (var k = 0; k < stops.length; k++) {
      stops[k].onclick = function () {
        var id = this.dataset.stop;
        api('/api/jumpserver.jobStop', { sessionId: SESSION, jobId: id }).then(loadJobs);
      };
    }
  });
}

function fmtTime(value) {
  var d = new Date(String(value || ''));
  if (isNaN(d.getTime())) return String(value || '');
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  } catch (e) { return d.toLocaleTimeString(); }
}

function loadAudit() {
  api('/api/jumpserver.audit', { sessionId: SESSION }).then(function (res) {
    var data = res.data || {};
    var rows = Array.isArray(data.records) ? data.records.slice().reverse() : [];
    el('auditNote').textContent = rows.length === 0 ? '本对话尚无审计记录' : '最近 ' + String(rows.length) + ' 条（存储 UTC，显示 UTC+8）';
    if (rows.length === 0) { el('auditList').innerHTML = ''; return; }
    var html = '<table><thead><tr><th>时间</th><th>操作</th><th>目标</th><th>风险</th><th>结果</th><th>命令 / 原因</th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var refused = String(r.result) === 'BLOCKED' || String(r.result) === 'DENIED' || !!r.refusalReason;
      var bad = !refused && String(r.result) !== 'ok' && String(r.result) !== 'COMPLETED';
      var cls = refused ? 'refused' : bad ? 'bad' : '';
      var detail = refused
        ? String(r.result === 'DENIED' ? '未批准：' : '已拦截：') + esc(r.refusalReason || '')
        : esc(r.redactedCommand || r.command || '');
      html += '<tr><td class="muted">' + esc(fmtTime(r.timestamp)) + '</td><td>' + esc(r.operation) + '</td><td>' + esc(r.target || r.hostname || '—')
        + '</td><td>' + esc(r.risk) + '</td><td><span class="badge ' + cls + '">' + esc(r.result) + '</span></td><td>' + detail + '</td></tr>';
    }
    el('auditList').innerHTML = html + '</tbody></table>';
  });
}

(function wire() {
  var buttons = document.querySelectorAll('nav button');
  for (var i = 0; i < buttons.length; i++) {
    buttons[i].onclick = function () { setTab(this.dataset.tab); };
  }
  el('cmd').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  el('send').onclick = send;
  el('clear').onclick = function () { el('term').textContent = ''; };
  el('follow').onclick = function () { setFollow(!following); };
  el('term').addEventListener('scroll', function () {
    var t = el('term');
    if (following && t.scrollTop + t.clientHeight < t.scrollHeight - 24) setFollow(false);
  });
  setFollow(true);
  el('jobsRefresh').onclick = loadJobs;
  el('auditRefresh').onclick = loadAudit;
  var interrupt = function () {
    api('/api/jumpserver.interrupt', { sessionId: SESSION }).then(function (res) {
      var data = res.data || {};
      el('jobsNote').textContent = String(data.message || (data.ok ? '中断信号已发送' : '没有可中断的任务'));
      append('[interrupt] ' + String(data.message || data.code || ''), 'meta');
      poll();
      if (tab === 'jobs') loadJobs();
    });
  };
  el('interrupt').onclick = interrupt;
  el('interrupt2').onclick = interrupt;
  setTab('term');
  poll();
  setInterval(function () {
    if (tab === 'term') poll();
    else if (tab === 'jobs') loadJobs();
    else if (tab === 'audit') loadAudit();
  }, 2000);
})();
</script>
</body>
</html>`

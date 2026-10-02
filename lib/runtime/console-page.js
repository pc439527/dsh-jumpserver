/**
 * The console page, shipped as a string by the Host.
 *
 * Deliberately dependency-free: no CDN, no build step, no framework, so the
 * page can never drift from the server that serves it. Authentication stays in
 * an HttpOnly cookie, and conversation selection is read from the URL fragment,
 * which is never sent to the Host.
 */
export function consolePage() {
    return PAGE;
}
/*
 * String.raw is REQUIRED, not stylistic. A plain template literal processes
 * escapes before emitting, so the ANSI-strip regex reached the browser with an
 * escaped closing paren: the group never terminated, the whole inline <script>
 * failed to parse, and the console rendered as static HTML with no tab
 * switching, no buttons and no polling. Raw keeps every backslash the
 * browser's own parser is meant to see.
 */
import { CONSOLE_STYLES } from '../console/styles.js';
const PAGE = String.raw `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>JumpServer 控制台</title>
${CONSOLE_STYLES}
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
  <section id="pane-assets" style="display:none">
    <div class="row">
      <input id="assetQuery" type="search" placeholder="搜索名称 / IP / 备注 / 节点" />
      <select id="assetGroup"></select>
      <button class="act" id="assetRefresh">刷新</button>
      <span class="muted" id="assetNote"></span>
    </div>
    <div id="assetList"></div>
  </section>
  <section id="pane-jobs" style="display:none">
    <div class="row">
      <button class="act" id="jobsRefresh">刷新</button>
      <button class="act danger" id="interrupt2" disabled>中断</button>
      <span class="muted" id="jobsNote"></span>
    </div>
    <div id="jobList"></div>
  </section>
  <section id="pane-audit" style="display:none">
    <div class="row"><button class="act" id="auditRefresh">刷新</button><button class="act" id="auditCsv">导出 CSV</button><button class="act" id="auditJson">导出 JSON</button><span class="muted" id="auditNote"></span></div>
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
/**
 * Stateful PTY stream renderer.
 *
 * A PTY delivers a byte STREAM, not messages: an escape sequence, a CR or a BS
 * can be split across two reads. The previous strip() rebuilt its line state on
 * every event, so anything crossing a chunk boundary decoded twice and rendered
 * wrong (50%\r + 100% came out as 5100%, a half CSI leaked as literal text).
 *
 * The framer therefore keeps the pending escape prefix, the current logical
 * line and the carry-over between calls, mirroring src/client/ansi.ts. Tests
 * assert the required property: for every corpus entry and EVERY split point,
 * rendering the chunks equals rendering the whole string.
 */
function makeRenderer() {
  var esc = '';
  var line = '';
  // A CR at the very end of a chunk is ambiguous: CRLF if the next chunk starts
  // with LF, a cursor-to-column-0 overwrite otherwise. Deciding immediately
  // discards a whole line whenever the LF turns out to arrive next.
  var crPending = false;
  function flush() { var out = line + '\n'; line = ''; return out; }
  function render(chunk) {
    var text = String(chunk == null ? '' : chunk);
    var out = '';
    if (crPending) {
      crPending = false;
      if (text.charAt(0) === '\n') { out += flush(); text = text.slice(1); }
      else { line = ''; }
    }
    text = esc + text;
    var i = 0;
    var n = text.length;
    esc = '';
    while (i < n) {
      var c = text.charAt(i);
      if (c === '\u001b') {
        var next = text.charAt(i + 1);
        if (next === '[') {
          var j = i + 2;
          while (j < n && !/[A-Za-z@-~]/.test(text.charAt(j))) j++;
          if (j >= n) { esc = text.slice(i); return out; }
          i = j + 1;
          continue;
        }
        if (next === ']') {
          var k = i + 2;
          while (k < n && text.charAt(k) !== '\u0007') k++;
          if (k >= n) { esc = text.slice(i); return out; }
          i = k + 1;
          continue;
        }
        if (next === '') { esc = c; return out; }
        i += 2;
        continue;
      }
      if (c === '\n') { out += flush(); i += 1; continue; }
      if (c === '\r') {
        if (i + 1 >= n) { crPending = true; i += 1; continue; }
        if (text.charAt(i + 1) === '\n') { out += flush(); i += 2; continue; }
        line = '';
        i += 1;
        continue;
      }
      if (c === '\b') { line = line.slice(0, -1); i += 1; continue; }
      if (c === '\t' || c >= ' ') { line += c; i += 1; continue; }
      i += 1;
    }
    return out;
  }
  // The not-yet-terminated line belongs to the next event, so keep it and
  // hand back only what is safe to append now.
  function renderTake(chunk) { var out = render(chunk); return { out: out, pending: line }; }
  return { render: render, renderTake: renderTake };
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

/**
 * Tell the Host this console is on screen.
 *
 * The right column registers the browser tab type as multiple, so it cannot
 * tell one console from another. This heartbeat is what lets the client open a
 * console only when none is already showing this conversation - and open again
 * as soon as this one is closed.
 */
function heartbeat() {
  if (SESSION.length === 0) return;
  try {
    fetch('/api/jumpserver.consoleAlive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION, heartbeat: true }),
      credentials: 'same-origin',
    }).catch(function () {});
  } catch (e) {
    /* telemetry must never break the console */
  }
}
// 10s beats the 60s Host TTL with room for timer throttling in a hidden window.
heartbeat();
setInterval(heartbeat, 10000);

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

/**
 * Hard cap on terminal rows kept in the DOM.
 *
 * The observer already ring-buffers on the Host, but the page appended a <div>
 * per line forever: a long-running tail -f grew the document without bound.
 * Old rows are dropped in one batch (not one call per line, which would force a
 * layout each time) once the cap is exceeded by a margin.
 */
var TERM_MAX_ROWS = 5000;
var TERM_TRIM_BATCH = 500;

function trimTerm(term) {
  var excess = term.childElementCount - TERM_MAX_ROWS;
  if (excess < TERM_TRIM_BATCH) return;
  for (var i = 0; i < excess; i++) term.removeChild(term.firstElementChild);
}

function append(text, cls) {
  var term = el('term');
  var div = document.createElement('div');
  div.className = cls || 'out';
  div.textContent = text;
  term.appendChild(div);
  trimTerm(term);
  if (following) term.scrollTop = term.scrollHeight;
}

// One renderer for the terminal pane: it must survive across events, since a
// CR/BS/escape can be split between two of them.
var terminal = makeRenderer();

/**
 * Append one PTY chunk: completed lines as their own rows, and the line still
 * being written into a single reusable row so a partial line is never frozen
 * into the scrollback (or duplicated when its tail arrives).
 */
function termRender(chunk) {
  var step = terminal.renderTake(chunk);
  if (step.out.length > 0) append(step.out.replace(/\n$/, ''), 'out');
  var box = el('term');
  var live = el('termLive');
  if (live === null) {
    live = document.createElement('div');
    live.id = 'termLive';
    box.appendChild(live);
  }
  live.className = 'out';
  live.textContent = step.pending;
  if (following) box.scrollTop = box.scrollHeight;
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
  renderInterrupt(st.state);
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
      });
  };
}

/**
 * One in-flight snapshot at a time, chained.
 *
 * The snapshot route long-polls (it waits for the next PTY event), so a
 * setInterval poll overlapped requests: a 2s timer against a route that holds
 * for up to 12s stacked roughly six concurrent snapshots, each re-reading the
 * same events and racing on sinceSeq. Chaining means exactly one request exists
 * at any moment and sinceSeq can only move forward.
 *
 * Status rides along in the snapshot payload, so the separate /status round
 * trip per cycle is gone too.
 */
function pump() {
  api('/api/jumpserver.snapshot', { sessionId: SESSION, sinceSeq: sinceSeq })
    .then(function (snap) {
      var data = snap.data || {};
      if (data.lastSeq !== undefined && Number(data.lastSeq) >= sinceSeq) sinceSeq = Number(data.lastSeq) + 1;
      el('net').textContent = data.code ? String(data.code) : '';
      if (typeof data.timeZone === 'string' && data.timeZone.length > 0) auditZone = data.timeZone;
      renderStatus(data);
      var events = Array.isArray(data.events) ? data.events : [];
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (ev.visibility === 'internal') continue;
        // Input events echo the command we sent; they are not part of the PTY
        // output stream, so they must not consume renderer state.
        if (ev.type === 'input') append('$ ' + String(ev.data == null ? '' : ev.data), 'in');
        else if (ev.type === 'output') termRender(ev.data);
        else if (ev.type === 'state') append('[state] ' + String(ev.prev || '?') + ' -> ' + String(ev.state || '?'), 'meta');
        else if (ev.type === 'target') append('[target] ' + String(ev.target || '') + (ev.hostname ? ' (' + ev.hostname + ')' : ''), 'meta');
        else if (ev.type === 'error') append('[error] ' + String(ev.message || ''), 'err');
      }
    })
    .catch(function () { el('net').textContent = '连接控制台失败'; })
    .then(function () { setTimeout(pump, 50); });
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
    // No optimistic echo of the command: SessionManager records it through the
    // observer, so appending here showed every manual command twice.
    if (data.ok !== true) append('执行失败：' + String(data.message || data.code || res.status), 'err');
  });
}

/**
 * Asset picker: search, group filter, refresh and one-click enter.
 *
 * The bridge route already accepted filter/group/refresh and returned the group
 * names; the pane never used any of it, so a 100+ row bastion inventory stayed
 * one undifferentiated table with no way to act on a row.
 */
function loadAssets(overrides) {
  var opts = overrides || {};
  var note = el('assetNote');
  var list = el('assetList');
  note.textContent = '加载中…';
  var payload = { sessionId: SESSION };
  var query = opts.filter !== undefined ? opts.filter : el('assetQuery').value.trim();
  if (query.length > 0) payload.filter = query;
  var group = opts.group !== undefined ? opts.group : el('assetGroup').value;
  if (group.length > 0) payload.group = group;
  if (opts.refresh === true) payload.refresh = true;
  api('/api/jumpserver.assets', payload).then(function (res) {
    var data = res.data || {};
    fillGroups(data.groups, data.group);
    if (!Array.isArray(data.rows)) {
      list.innerHTML = '<div class="muted">资产列表需要在堡垒机菜单态获取：' + esc(data.message || data.code || '') + '</div>';
      note.textContent = '不可用';
      return;
    }
    var rows = data.rows;
    note.textContent = '共 ' + String(data.count || rows.length)
      + (data.reportedTotal ? ' / ' + String(data.reportedTotal) : '')
      + ' 台（健康度 ' + String(data.health || '?') + '）';
    if (rows.length === 0) {
      list.innerHTML = '<div class="muted">没有匹配的资产</div>';
      return;
    }
    var body = '<table><thead><tr><th>名称</th><th>IP</th><th>系统</th><th>节点</th><th></th></tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      body += '<tr><td>' + esc(row.name) + '</td><td>' + esc(row.ip) + '</td><td>' + esc(row.platform)
        + '</td><td>' + esc(row.node) + '</td><td><button class="act" data-enter="'
        + esc(row.ip || row.name) + '">进入</button></td></tr>';
    }
    list.innerHTML = body + '</tbody></table>';
    var buttons = list.querySelectorAll('[data-enter]');
    for (var k = 0; k < buttons.length; k++) {
      buttons[k].onclick = function () { enterAsset(this.dataset.enter); };
    }
  }).catch(function () { note.textContent = '加载失败'; });
}

/** Populate the group picker once, keeping the current selection. */
function fillGroups(groups, selected) {
  var box = el('assetGroup');
  if (box.dataset.filled === '1') return;
  if (!Array.isArray(groups)) return;
  var html = '<option value="">全部资产组</option>';
  for (var i = 0; i < groups.length; i++) {
    html += '<option value="' + esc(groups[i]) + '"' + (groups[i] === selected ? ' selected' : '') + '>' + esc(groups[i]) + '</option>';
  }
  box.innerHTML = html;
  box.dataset.filled = '1';
}

/** Enter an asset from the menu, sharing the manual path and its confirm gate. */
function enterAsset(target) {
  if (typeof target !== 'string' || target.length === 0) return;
  el('assetNote').textContent = '正在进入 ' + target + '…';
  api('/api/jumpserver.manual', { sessionId: SESSION, command: target }).then(function (res) {
    var data = res.data || {};
    if (data.code === 'MANUAL_CONFIRM_REQUIRED') {
      renderConfirm({ command: target, risk: data.risk, confirmToken: data.confirmToken });
      el('assetNote').textContent = '需要在终端确认';
      return;
    }
    el('assetNote').textContent = data.ok === true ? '已请求进入 ' + target : ('进入失败：' + String(data.message || data.code || res.status));
  }).catch(function () { el('assetNote').textContent = '进入失败'; });
}

/** Running streaming jobs for this conversation; drives the interrupt button. */
var runningJobs = 0;

/**
 * Enable "interrupt" only when there is something to interrupt.
 *
 * It used to key off granted alone, so it sat red and clickable while the
 * session was merely parked at the bastion menu. The label follows too: with
 * nothing running the control is simply disabled, not an invitation.
 */
function renderInterrupt(state) {
  var running = state === 'COMMAND_RUNNING' || runningJobs > 0;
  var granted = el('grant').textContent === '已授权';
  var off = !granted || !running;
  el('interrupt').disabled = off;
  el('interrupt2').disabled = off;
  el('interrupt2').textContent = running ? '中断运行' : '中断';
}

function loadJobs() {
  api('/api/jumpserver.jobs', { sessionId: SESSION }).then(function (res) {
    var data = res.data || {};
    var jobs = Array.isArray(data.jobs) ? data.jobs : [];
    // Track running jobs here: the interrupt button is enabled by TASK state,
    // not merely by "granted" - a red interrupt button with nothing to stop
    // invites the operator to press it for no reason.
    runningJobs = 0;
    for (var n = 0; n < jobs.length; n++) if (jobs[n].state === 'RUNNING') runningJobs++;
    el('jobsNote').textContent = jobs.length === 0 ? '本对话没有流式任务' : String(jobs.length) + ' 个任务';
    renderInterrupt();
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

/** Effective zone reported by the Host; the page never guesses one. */
var auditZone = 'UTC';

function fmtTime(value) {
  var d = new Date(String(value || ''));
  if (isNaN(d.getTime())) return String(value || '');
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: auditZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  } catch (e) {
    // An unusable zone must still show the record, never blank it out.
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
}

function fmtFull(value) {
  var d = new Date(String(value || ''));
  if (isNaN(d.getTime())) return String(value || '');
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: auditZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(d);
  } catch (e) {
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }
}

/**
 * Download the audit trail as CSV or JSON.
 *
 * The serialisation is done by the Host (one tested implementation shared with
 * the settings surface) rather than re-implemented here, so the two can never
 * disagree about what an export contains.
 */
function exportAudit(format) {
  el('auditNote').textContent = '正在导出…';
  api('/api/jumpserver.auditExport', { sessionId: SESSION, format: format }).then(function (res) {
    var data = res.data || {};
    if (data.ok !== true || typeof data.content !== 'string') {
      el('auditNote').textContent = '导出失败：' + String(data.message || data.code || res.status);
      return;
    }
    var type = format === 'csv' ? 'text/csv' : 'application/json';
    var blob = new Blob([data.content], { type: type + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'jumpserver-audit-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.' + format;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    el('auditNote').textContent = '已导出 ' + String(data.count || 0) + ' 条（' + format.toUpperCase() + '）';
  }).catch(function () { el('auditNote').textContent = '导出失败'; });
}

function loadAudit() {
  api('/api/jumpserver.audit', { sessionId: SESSION }).then(function (res) {
    var data = res.data || {};
    var rows = Array.isArray(data.records) ? data.records.slice().reverse() : [];
    el('auditNote').textContent = rows.length === 0 ? '本对话尚无审计记录' : '最近 ' + String(rows.length) + ' 条（存储 UTC，显示 ' + auditZone + '）';
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
  el('clear').onclick = function () {
    el('term').textContent = '';
    // Fresh renderer too: a half-written line from before the clear must not
    // reappear when its tail arrives.
    terminal = makeRenderer();
  };
  el('follow').onclick = function () { setFollow(!following); };
  el('term').addEventListener('scroll', function () {
    var t = el('term');
    if (following && t.scrollTop + t.clientHeight < t.scrollHeight - 24) setFollow(false);
  });
  setFollow(true);
  el('jobsRefresh').onclick = loadJobs;
  el('auditRefresh').onclick = loadAudit;
  el('assetRefresh').onclick = function () { loadAssets({ refresh: true }); };
  el('assetGroup').onchange = function () { loadAssets({ group: this.value }); };
  // Debounce: the search box posts on every keystroke otherwise, and each call
  // drives the bastion PTY.
  var assetTimer = null;
  el('assetQuery').oninput = function () {
    var value = this.value;
    if (assetTimer !== null) clearTimeout(assetTimer);
    assetTimer = setTimeout(function () { loadAssets({ filter: value.trim() }); }, 300);
  };
  el('auditCsv').onclick = function () { exportAudit('csv'); };
  el('auditJson').onclick = function () { exportAudit('json'); };
  var interrupt = function () {
    api('/api/jumpserver.interrupt', { sessionId: SESSION }).then(function (res) {
      var data = res.data || {};
      el('jobsNote').textContent = String(data.message || (data.ok ? '中断信号已发送' : '没有可中断的任务'));
      append('[interrupt] ' + String(data.message || data.code || ''), 'meta');
      if (tab === 'jobs') loadJobs();
    });
  };
  el('interrupt').onclick = interrupt;
  el('interrupt2').onclick = interrupt;
  setTab('term');
  // One chained long-poll for the terminal. The other tabs keep their own slow
  // refresh, so switching away never leaves the terminal loop running twice.
  pump();
  setInterval(function () {
    if (tab === 'jobs') loadJobs();
    else if (tab === 'audit') loadAudit();
  }, 5000);
})();
</script>
</body>
</html>`;

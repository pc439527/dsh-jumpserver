// JumpServer MCP 审计日志实时查看器
// 用法: node audit-viewer.mjs [audit.jsonl 路径] [端口]
import fs from 'node:fs';
import http from 'node:http';

const file = process.argv[2] || 'C:/Users/114976/WorkBuddy/jumpserver-mcp/data/audit.jsonl';
const port = Number(process.argv[3] || 8765);

function readEntries() {
  try {
    const text = fs.readFileSync(file, 'utf8');
    return text.split('\n').filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<title>JumpServer MCP 审计终端</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#141414;color:#ddd;font:13px/1.6 "JetBrains Mono","Cascadia Code",Consolas,monospace}
header{position:sticky;top:0;background:#1b1b1b;border-bottom:1px solid #2a2a2a;padding:10px 16px;display:flex;gap:16px;align-items:center;z-index:1}
header h1{font-size:14px;margin:0;font-weight:500;color:#fff}
.dot{width:8px;height:8px;border-radius:50%;background:#1d9e75;animation:pulse 2s infinite}
@keyframes pulse{50%{opacity:.4}}
#stat{color:#888;font-size:12px}
#filter{background:#222;border:1px solid #333;color:#ddd;padding:4px 10px;border-radius:6px;width:220px;outline:none}
table{width:100%;border-collapse:collapse}
th{position:sticky;top:53px;background:#1b1b1b;text-align:left;padding:8px 12px;color:#888;font-weight:400;font-size:12px;border-bottom:1px solid #2a2a2a}
td{padding:6px 12px;border-bottom:1px solid #222;vertical-align:top}
tr:hover td{background:#1d1d1d}
.time{color:#888;white-space:nowrap}
.op{color:#7fb3e8;white-space:nowrap}
.tgt{color:#c9a86a;white-space:nowrap;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.cmd{color:#a8d8a8;word-break:break-all}
tr.new td{animation:flash 1.2s}
@keyframes flash{from{background:#2a3324}}
#empty{padding:40px;text-align:center;color:#666}
</style></head><body>
<header>
  <div class="dot"></div><h1>JumpServer MCP 审计终端</h1>
  <span id="stat">loading…</span>
  <input id="filter" placeholder="过滤：命令 / 资产 / 操作类型">
</header>
<table><thead><tr><th style="width:170px">时间</th><th style="width:130px">操作</th><th style="width:220px">目标</th><th>命令</th></tr></thead>
<tbody id="rows"></tbody></table>
<div id="empty">暂无审计记录</div>
<script>
let lastCount = -1;
const rowsEl = document.getElementById('rows');
const statEl = document.getElementById('stat');
const emptyEl = document.getElementById('empty');
const filterEl = document.getElementById('filter');
let entries = [];
function esc(s){return String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function render(){
  const q = filterEl.value.toLowerCase();
  const list = q ? entries.filter(e => JSON.stringify(e).toLowerCase().includes(q)) : entries;
  rowsEl.innerHTML = list.slice().reverse().map((e,i) => {
    const isNew = i < entries.length - Math.max(lastCount,0);
    const tgt = e.target || e.hostname || '-';
    const cmd = e.redactedCommand || e.command || '-';
    return '<tr class="'+(isNew?'new':'')+'">'
      + '<td class="time">'+esc((e.timestamp||'').replace('T',' ').slice(0,19))+'</td>'
      + '<td class="op">'+esc(e.operation)+'</td>'
      + '<td class="tgt" title="'+esc(tgt)+'">'+esc(tgt)+'</td>'
      + '<td class="cmd">'+esc(cmd)+'</td></tr>';
  }).join('');
  emptyEl.style.display = list.length ? 'none' : 'block';
  statEl.textContent = '共 '+entries.length+' 条'+(q?' / 匹配 '+list.length:'')+' · '+file.split('/').pop();
  lastCount = entries.length;
}
async function poll(){
  try{
    const r = await fetch('/api/entries');
    const j = await r.json();
    if (j.length !== entries.length){ entries = j; render(); }
    else { entries = j; }
  }catch{}
}
setInterval(poll, 1000);
poll();
filterEl.addEventListener('input', render);
</script></body></html>`;

http.createServer((req, res) => {
  if (req.url === '/api/entries') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readEntries()));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}).listen(port, '127.0.0.1', () => console.log('audit viewer: http://127.0.0.1:' + port));

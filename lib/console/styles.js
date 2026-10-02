/**
 * Console stylesheet, kept apart from the page so a colour change is not a
 * diff buried inside a 600-line template literal.
 *
 * String.raw for the same reason the page needs it: a plain template literal
 * would eat escape sequences in CSS content values.
 */
export const CONSOLE_STYLES = String.raw `<style>
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
</style>`;

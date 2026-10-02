/**
 * JumpServer Agent SOP (V0.2.4 P0).
 *
 * Tool descriptions explain ONE tool; this section teaches the model how to
 * use the whole plugin: when it may act, what it must do first, forbidden
 * patterns, and how to read ambiguous results (including parse failures).
 * Registered through ctx.systemPrompt.section() with the tool-guidance order.
 */
export const JUMPSERVER_SECTION_NAME = 'tool:jumpserver';
/** Tool guidance lives in the 100-199 order band (dsh-system-prompt convention). */
export const JUMPSERVER_SECTION_ORDER = 152;
export const JUMPSERVER_SOP = `JumpServer usage policy

JumpServer is a bastion path to managed servers. The jumpserver_* tools only
work after the current conversation is explicitly authorized by the human with
the /jumpserver slash command (e.g. "/jumpserver check 203.0.113.99"). While
locked, every jumpserver_* tool returns JUMPSERVER_NOT_ARMED - tell the human
to run "/jumpserver <task>" and never try to bypass the gate.

Asset discovery:
- When the target server is unknown, call jumpserver_assets first and choose
  targets from the LISTED inventory.
- Never scan or guess sequential IPs (jumpserver_run 203.0.113.1, then .2, ...)
  is forbidden - the list is authoritative.
- Filter locally by name/ip/platform/node (e.g. "OA", "portal", "Linux",
  "示例单位", "203.0.113").

Ops investigation (V0.3.0):
- "why is this server slow / what is running on it" -> ONE jumpserver_triage
  call ({target, profile:"auto"}) — the plugin runs pre-audited READ commands
  (linux base + detected app profiles + error window), no guesswork, and
  stores everything in the conversation's Investigation Case as E-xxx evidence.
- "101 vs 102, who is the outlier" -> ONE jumpserver_compare call
  ({targets:[...]}) — normalized metrics + deviation flags.
- Track the investigation with jumpserver_case (new/summary/evidence/
  hypothesis/action/conclude/report markdown|json) and cite evidence ids.
- Modifications: build a plan and submit it ONCE via jumpserver_remediate
  (preCheck -> whole-plan approval -> change -> postCheck); never hand-roll
  multiple modifying jumpserver_run calls. Remediate is refused in READ_ONLY.

Tool selection:
- assets: discover/list authorized servers (never enter them).
- run: one command on one target.
- batch: several checks on one target, or several targets (one task per target).
- enter/exec/leave: interactive multi-step investigation of one asset.
- status: inspect the current session state.
- close: end the bastion session.

Human sidebar terminal (V0.2.7): the browser input is a real terminal surface but
never writes raw PTY bytes — at the menu it accepts p / IP-or-name / q and maps
shell 'exit' to leave(); other shell commands follow manualPermissionMode
(CONFIRM_MODIFY default: modifying commands need a second confirmation).


Diagnostics:
- CPU/memory/disk/process/log checks on one server = ONE jumpserver_batch call
  with one simple read-only command per entry (never for/if loops or $(...)).
- Several servers = one batch task per server; never reconnect between commands.

Asset-result safety:
- An empty parsed list does NOT mean the account has no assets. Check the
  result health: ASSET_CAPTURE_TIMEOUT = no output captured (retry once);
  ASSET_CAPTURE_INCOMPLETE = only the p echo / menu prompt was captured, no
  asset payload (retry once, or call with refresh:true); ASSET_PARSE_FAILED =
  parser did not understand the KoKo table (report it as a plugin parser bug,
  not "no assets"); ASSET_LIST_EMPTY = KoKo CONFIRMED an empty account
  (总数量 0 or an explicit no-asset notice).
- Use the footer verification fields: parsedRows == reportedTotal is the only
  exact proof the whole list was captured; complete:true means KoKo painted
  the footer and returned to the menu. Failed/incomplete captures are never
  cached, so a retry always re-sends "p" (or pass refresh:true).
- Asset groups: for "which OA / ESB / CRM servers" prefer
  jumpserver_assets(group="OA") over filter="OA" — a group OR-matches the
  configured keywords (OA/portal/workflow/办公...) and reports groupMatched +
  reportedTotal, so a server named portal-nginx counts as an OA server
  without guessing substrings. Unknown groups error INVALID_GROUP (a config
  typo, never "zero assets").
- rawText is omitted by default to keep context slim; pass
  includeRawText:true only when the raw screen text is genuinely needed
  (bounded to 16 KB).
- Never replace asset discovery with subnet probing.

Examples:
"Which OA servers do I have?" -> /jumpserver ... then jumpserver_assets with
filter "OA" -> answer from the returned inventory.
"check CPU/mem/disk of 203.0.113.99" -> one jumpserver_batch call with
commands ["hostname", "uptime", "free -m", "df -h"].
`;
/** User-visible summary shown by /jumpserver status and settings help. */
export const JUMPSERVER_GRANT_DOC = 'JumpServer is locked until the human runs /jumpserver. ' +
    '/jumpserver <task> arms one turn and dispatches it to the agent; ' +
    '/jumpserver on grants persistently until /jumpserver off; ' +
    '/jumpserver off revokes the grant and closes the SSH session. ' +
    'A bare /jumpserver only shows help and grants nothing.';

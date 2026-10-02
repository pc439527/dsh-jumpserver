window.__ModuleLoader__.load({
	id: "dsh-jumpserver",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/impl.ts
var impl_exports = {};
__export(impl_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(impl_exports);

// src/client/locales.ts
var NS = "jumpserver";
var zh = {
  cardTitle: "JumpServer",
  cardDescription: "\u5821\u5792\u673A\uFF08JumpServer/KoKo\uFF09\u8FDE\u63A5\u3001\u5B9E\u65F6\u7EC8\u7AEF\u3001\u8D44\u4EA7\u53D1\u73B0\u4E0E\u6279\u91CF\u547D\u4EE4\u6267\u884C\u3002",
  enabled: "\u542F\u7528 JumpServer",
  enabledHint: "\u5173\u95ED\u540E\u6240\u6709 jumpserver_* \u5DE5\u5177\u8FD4\u56DE DISABLED\uFF0C\u7EC8\u7AEF\u663E\u793A\u672A\u542F\u7528\u3002",
  host: "\u670D\u52A1\u5668",
  hostHint: "JumpServer \u5730\u5740\uFF08\u4F20\u8F93\u7F51\u5173\uFF09\uFF0C\u5982 203.0.113.10",
  port: "SSH \u7AEF\u53E3",
  portHint: "\u9ED8\u8BA4 2222",
  username: "\u7528\u6237\u540D",
  usernameHint: "JumpServer \u767B\u5F55\u7528\u6237\u540D",
  password: "\u5BC6\u7801",
  passwordHint: "\u53EA\u5199\u5B57\u6BB5\uFF1A\u4FDD\u5B58\u540E\u65E0\u6CD5\u4ECE\u6D4F\u89C8\u5668\u8BFB\u56DE\uFF0C\u4E5F\u4E0D\u4F1A\u8FDB\u5165\u65E5\u5FD7\u3001\u5DE5\u5177\u7ED3\u679C\u6216\u6A21\u578B\u4E0A\u4E0B\u6587\u3002",
  passwordSaved: "\u5DF2\u4FDD\u5B58",
  passwordUnset: "\u672A\u914D\u7F6E",
  passwordEnv: "\u5BC6\u7801\u73AF\u5883\u53D8\u91CF",
  passwordEnvHint: "\u4FDD\u5B58\u5BC6\u7801\u7684\u73AF\u5883\u53D8\u91CF\u540D\uFF08credential-ref\uFF0C\u9ED8\u8BA4 JUMPSERVER_PASSWORD\uFF09",
  connectTimeout: "\u8FDE\u63A5\u8D85\u65F6\uFF08\u79D2\uFF09",
  commandTimeout: "\u547D\u4EE4\u8D85\u65F6\uFF08\u79D2\uFF09",
  idleTimeout: "\u7A7A\u95F2\u65AD\u5F00\uFF08\u5206\u949F\uFF09",
  permissionMode: "Agent \u6743\u9650\u6A21\u5F0F",
  permissionModeHint: "\u4EC5\u7EA6\u675F Agent \u81EA\u52A8\u5DE5\u5177\uFF1AREAD_ONLY \u4EC5\u67E5\u8BE2\uFF1BAUTO \u4FEE\u6539\u9700\u5BA1\u6279\uFF1BFULL_ACCESS \u666E\u901A\u4FEE\u6539\u76F4\u63A5\u6267\u884C\u3001\u9AD8\u5371\u4ECD\u5BA1\u6279\u3002\u53F3\u4FA7\u7EC8\u7AEF\u7684\u4EBA\u5DE5\u8F93\u5165\u5C5E\u4E8E\u7528\u6237\u660E\u786E\u64CD\u4F5C\uFF0C\u4E0D\u7ECF\u8FC7 Agent \u6743\u9650\u95E8\uFF0C\u4F46\u4ECD\u53D7\u4F1A\u8BDD\u72B6\u6001\u7EA6\u675F\u5E76\u8BB0\u5F55\u5BA1\u8BA1\u3002",
  autoReconnect: "\u81EA\u52A8\u91CD\u8FDE",
  autoReconnectHint: "\u7A7A\u95F2\u65AD\u7EBF\u81EA\u52A8\u91CD\u8FDE\uFF08\u6700\u591A 2 \u6B21\uFF09",
  enableAudit: "\u547D\u4EE4\u5BA1\u8BA1",
  enableAuditHint: "\u8BB0\u5F55 Agent \u4E0E\u4EBA\u5DE5\u547D\u4EE4\u6267\u884C\u5BA1\u8BA1\uFF08\u4E0D\u542B\u4EFB\u4F55\u5BC6\u7801\uFF09",
  autoOpenTerminal: "\u81EA\u52A8\u6253\u5F00\u7EC8\u7AEF",
  autoOpenTerminalHint: "\u4EC5\u5728\u4F1A\u8BDD\u83B7\u5F97 /jumpserver \u6388\u6743\u540E\u81EA\u52A8\u6253\u5F00\u4FA7\u680F\u7EC8\u7AEF\u6807\u7B7E\u9875\uFF1B\u672A\u6388\u6743\u4E0D\u81EA\u52A8\u6253\u5F00",
  terminalScrollback: "\u7EC8\u7AEF\u4FDD\u7559\u884C\u6570",
  terminalScrollbackHint: "\u7EC8\u7AEF\u7684\u6700\u5927\u6EDA\u52A8\u884C\u6570\uFF0C\u9632\u6B62\u65E0\u9650\u5360\u7528\u5185\u5B58",
  overridden: "\u5DF2\u8986\u76D6",
  reset: "\u91CD\u7F6E",
  save: "\u4FDD\u5B58",
  saving: "\u4FDD\u5B58\u4E2D\u2026",
  discard: "\u653E\u5F03\u4FEE\u6539",
  unsaved: "\u672A\u4FDD\u5B58",
  saveFailed: "\u8BBE\u7F6E\u672A\u88AB\u63A5\u53D7\uFF0C\u5DF2\u4FDD\u7559\u8349\u7A3F\u4F9B\u4FEE\u6B63\u3002",
  testConnection: "\u6D4B\u8BD5\u8FDE\u63A5",
  testing: "\u6B63\u5728\u6D4B\u8BD5\u2026",
  testOk: "\u2713 JumpServer \u8FDE\u63A5\u6210\u529F",
  testFail: "\u2717 \u8FDE\u63A5\u5931\u8D25",
  readOnlyStorage: "\u6B64\u90E8\u7F72\u7684\u8BBE\u7F6E\u5B58\u50A8\u4E3A\u53EA\u8BFB\uFF0C\u65E0\u6CD5\u4FDD\u5B58\u3002",
  tabTitle: "JumpServer",
  statusConnected: "\u5DF2\u8FDE\u63A5",
  statusDisconnected: "\u672A\u8FDE\u63A5",
  statusConnecting: "\u6B63\u5728\u8FDE\u63A5",
  statusMenu: "JumpServer \u83DC\u5355",
  statusEntering: "\u6B63\u5728\u8FDB\u5165\u670D\u52A1\u5668",
  statusShell: "\u670D\u52A1\u5668 Shell",
  statusRunning: "\u6B63\u5728\u6267\u884C\u547D\u4EE4",
  statusUnknown: "\u5F02\u5E38",
  statusDisabled: "\u672A\u542F\u7528",
  gatewayLabel: "Gateway",
  targetLabel: "Target",
  hostnameLabel: "Hostname",
  userLabel: "User",
  modeLabel: "Agent \u6A21\u5F0F",
  follow: "\u5B9E\u65F6\u8DDF\u968F",
  following: "\u8DDF\u968F\u4E2D",
  clear: "\u6E05\u5C4F",
  followTooltip: "\u8DDF\u968F\u6700\u65B0\u8F93\u51FA",
  clearTooltip: "\u6E05\u7A7A\u5F53\u524D\u663E\u793A",
  readOnlyHint: "Agent \u8F93\u51FA\u4E0E\u670D\u52A1\u5668\u8F93\u51FA\u5B9E\u65F6\u540C\u6B65\u3002",
  manualPlaceholder: "\u8F93\u5165\u547D\u4EE4\u5E76\u56DE\u8F66\uFF08\u4EBA\u5DE5\u64CD\u4F5C\uFF09",
  manualUnavailable: "\u8FDB\u5165\u670D\u52A1\u5668\u540E\u53EF\u4EBA\u5DE5\u8F93\u5165\u547D\u4EE4",
  manualSend: "\u6267\u884C\u4EBA\u5DE5\u547D\u4EE4",
  manualSending: "\u6267\u884C\u4E2D\u2026",
  manualFailed: "\u4EBA\u5DE5\u547D\u4EE4\u6267\u884C\u5931\u8D25",
  manualHint: "Agent \u6743\u9650\u6A21\u5F0F\u4EC5\u7EA6\u675F\u81EA\u52A8\u5DE5\u5177\uFF1B\u4EBA\u5DE5\u8F93\u5165\u4E3A\u7528\u6237\u660E\u786E\u64CD\u4F5C\u5E76\u5199\u5165\u5BA1\u8BA1\u3002",
  disconnectNote: "Disconnected",
  emptyTerminal: "\u7B49\u5F85\u8FDE\u63A5\u2026",
  modeReadOnly: "\u53EA\u8BFB",
  modeAuto: "\u81EA\u52A8",
  modeFull: "\u5B8C\u5168\u5F00\u653E",
  permissionReadOnly: "\u53EA\u8BFB",
  permissionAuto: "\u81EA\u52A8",
  permissionFull: "\u5B8C\u5168\u5F00\u653E",
  grantLocked: "\u672A\u6388\u6743",
  grantArmed: "\u5DF2\u6388\u6743",
  grantPersistent: "\u6301\u7EED\u6388\u6743",
  grantTurn: "\u672C\u8F6E\u6388\u6743",
  grantTooltip: "JumpServer \u4F1A\u8BDD\u6388\u6743\uFF1A\u7531 /jumpserver \u5F00\u542F\uFF0C/jumpserver off \u6216\u672C\u8F6E\u7ED3\u675F\u81EA\u52A8\u5173\u95ED"
};
var en = {
  cardTitle: "JumpServer",
  cardDescription: "Bastion (JumpServer/KoKo) connection, live terminal, asset discovery and batch command execution.",
  enabled: "Enable JumpServer",
  enabledHint: "When off every jumpserver_* tool returns DISABLED and the terminal shows disabled.",
  host: "Server",
  hostHint: "JumpServer address (transport gateway), e.g. 203.0.113.10",
  port: "SSH port",
  portHint: "Default 2222",
  username: "Username",
  usernameHint: "JumpServer login username",
  password: "Password",
  passwordHint: "Write-only: after saving it cannot be read back from the browser and never enters logs, tool results or model context.",
  passwordSaved: "Saved",
  passwordUnset: "Not set",
  passwordEnv: "Password env var",
  passwordEnvHint: "Credential-ref env var holding the password (default JUMPSERVER_PASSWORD)",
  connectTimeout: "Connect timeout (s)",
  commandTimeout: "Command timeout (s)",
  idleTimeout: "Idle close (min)",
  permissionMode: "Agent permission mode",
  permissionModeHint: "Gates Agent tools only. READ_ONLY permits queries; AUTO asks approval for changes; FULL_ACCESS runs ordinary changes while dangerous actions still ask. Commands typed manually in the sidebar are explicit user actions, bypass the Agent gate, remain state-safe, and are audited.",
  autoReconnect: "Auto reconnect",
  autoReconnectHint: "Reconnect after idle drops (up to 2 times)",
  enableAudit: "Command audit",
  enableAuditHint: "Persist Agent and manual command audit records (never credentials)",
  autoOpenTerminal: "Auto-open terminal",
  autoOpenTerminalHint: "Auto-open the JumpServer sidebar terminal tab only after this conversation is granted via /jumpserver",
  terminalScrollback: "Terminal scrollback",
  terminalScrollbackHint: "Maximum scroll lines retained by the terminal",
  overridden: "Overridden",
  reset: "Reset",
  save: "Save",
  saving: "Saving\u2026",
  discard: "Discard changes",
  unsaved: "Unsaved",
  saveFailed: "The deployment did not accept these values; drafts were kept.",
  testConnection: "Test connection",
  testing: "Testing\u2026",
  testOk: "\u2713 JumpServer connected",
  testFail: "\u2717 Connection failed",
  readOnlyStorage: "This deployment stores settings read-only.",
  tabTitle: "JumpServer",
  statusConnected: "Connected",
  statusDisconnected: "Disconnected",
  statusConnecting: "Connecting",
  statusMenu: "JumpServer menu",
  statusEntering: "Entering asset",
  statusShell: "Asset shell",
  statusRunning: "Running command",
  statusUnknown: "Unknown",
  statusDisabled: "Disabled",
  gatewayLabel: "Gateway",
  targetLabel: "Target",
  hostnameLabel: "Hostname",
  userLabel: "User",
  modeLabel: "Agent mode",
  follow: "Follow",
  following: "Following",
  clear: "Clear",
  followTooltip: "Follow latest output",
  clearTooltip: "Clear current view",
  readOnlyHint: "Agent writes and server output appear live.",
  manualPlaceholder: "Type a command and press Enter (manual)",
  manualUnavailable: "Enter an asset to type manual commands",
  manualSend: "Run manual command",
  manualSending: "Running\u2026",
  manualFailed: "Manual command failed",
  manualHint: "Agent mode gates autonomous tools only; manual input is an explicit user action and is audited.",
  disconnectNote: "Disconnected",
  emptyTerminal: "Waiting for connection\u2026",
  modeReadOnly: "Read-only",
  modeAuto: "Auto",
  modeFull: "Full access",
  permissionReadOnly: "Read-only",
  permissionAuto: "Auto",
  permissionFull: "Full access",
  grantLocked: "Not granted",
  grantArmed: "Granted",
  grantPersistent: "Persistent",
  grantTurn: "Turn-scoped",
  grantTooltip: "JumpServer session grant: opened by /jumpserver, auto-closed by /jumpserver off or when this turn settles"
};

// src/client/styles.ts
var TERMINAL_CSS = [
  ".js-term-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#2d333b);background:var(--dsw-alias-bg-layer-3,#161b22);border-radius:12px;margin-bottom:10px}",
  ".js-term-cardHeader{appearance:none;width:100%;display:flex;align-items:center;gap:12px;background:transparent;border:0;padding:14px 16px;cursor:pointer;color:inherit;font:inherit;text-align:left;border-radius:12px}",
  ".js-term-cardHeader:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(177,186,196,.08))}",
  ".js-term-cardHeadText{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}",
  ".js-term-cardName{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,#e6edf3)}",
  ".js-term-cardDesc{font-size:13px;color:var(--dsw-alias-label-tertiary,#8b949e)}",
  ".js-term-dirty{background:var(--dsw-alias-state-business-primary,rgba(83,155,245,.18))}",
  ".js-term-chevron{color:var(--dsw-alias-label-tertiary,#8b949e);flex:none;font-size:10px}",
  ".js-term-cardBody{border-top:1px solid var(--dsw-alias-border-l2,#2d333b);margin:0 16px;padding:4px 0 14px}",
  ".js-term-cardFooter{border-top:1px solid var(--dsw-alias-border-l2,#2d333b);display:flex;justify-content:flex-end;align-items:center;gap:8px;padding-top:12px;margin-top:6px}",
  ".js-term-save{background:var(--dsw-alias-label-primary,#e6edf3);color:var(--dsw-alias-bg-layer-3,#161b22)}",
  ".js-term-save:disabled{opacity:.4}",
  ".js-term-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;align-self:flex-start;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#2d333b);background:var(--dsw-alias-bg-module-platform,#161b22);color:var(--dsw-alias-label-primary,#e6edf3);font-size:13px;cursor:pointer;white-space:nowrap}",
  ".js-term-btn:hover{background:rgba(177,186,196,.10)}",
  ".js-term-btn:disabled{opacity:.4;cursor:default}",
  ".js-term-btnPrimary{background:var(--dsw-alias-label-primary,#e6edf3);color:#161b22;font-weight:600}",
  ".js-term-btnDanger{background:rgba(248,81,73,.14);border-color:#f85149;color:#f85149}",
  ".js-term-btnGhost{background:transparent}",
  ".js-term-tabs{display:flex;gap:2px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#2d333b)}",
  ".js-term-tab{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#8b949e);font-size:13px;padding:4px 12px;border-radius:8px 8px 0 0;cursor:pointer}",
  ".js-term-tabActive{color:var(--dsw-alias-label-primary,#e6edf3);background:rgba(177,186,196,.08);font-weight:600}",
  ".js-term-window{position:relative;width:100%}",
  ".js-term-assets{flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 12px;gap:8px;overflow-y:auto}",
  ".js-term-searchRow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
  ".js-term-search{flex:1;min-width:0;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#2d333b);background:var(--dsw-alias-bg-module-platform,#161b22);color:var(--dsw-alias-label-primary,#e6edf3);font-size:13px}",
  ".js-term-groups,.js-term-nodeGroups{display:flex;gap:6px;flex-wrap:wrap;align-items:center}",
  ".js-term-nodeGroups{padding-top:2px}",
  ".js-term-groupLabel{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);margin-right:2px}",
  ".js-term-groupChip{cursor:pointer}",
  ".js-term-chipActive{background:var(--dsw-alias-state-business-primary,rgba(83,155,245,.18));border-color:rgba(83,155,245,.5);color:var(--dsw-alias-label-primary,#e6edf3)}",
  ".js-term-assetList{flex:1;min-height:0;overflow-y:auto;position:relative}",
  ".js-term-assetItem{appearance:none;display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:5px 9px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-primary,#e6edf3);cursor:pointer;font-size:13px;box-sizing:border-box}",
  ".js-term-assetItem:hover{background:rgba(177,186,196,.08);border-color:var(--dsw-alias-border-l2,#2d333b)}",
  ".js-term-assetIdentity{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}",
  ".js-term-assetTop,.js-term-assetBottom{display:flex;align-items:center;gap:8px;min-width:0}",
  ".js-term-assetIp{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-accent,#58a6ff);min-width:0;white-space:nowrap}",
  ".js-term-assetPlatform{margin-left:auto;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px;white-space:nowrap}",
  ".js-term-assetName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}",
  ".js-term-assetNode{max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:11px}",
  ".js-term-assetMeta{color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px}",
  ".js-term-assetGo{color:var(--dsw-alias-label-tertiary,#8b949e);flex:none;font-size:12px}",
  ".js-term-audit{flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 12px;gap:8px;overflow-y:auto}",
  ".js-term-auditFilter{display:inline-flex;align-items:center;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#8b949e);cursor:pointer}",
  ".js-term-auditSummary{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:2px 0}",
  ".js-term-auditSummaryChip{appearance:none;font:inherit;font-size:11px;line-height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#2d333b);color:var(--dsw-alias-label-secondary,#8b949e);background:var(--dsw-alias-bg-module-platform,#161b22);cursor:pointer}",
  ".js-term-auditSummaryChip:hover{border-color:var(--dsw-alias-label-dimmed,#6e7681);color:var(--dsw-alias-label-primary,#e6edf3)}",
  ".js-term-auditSummaryChipActive{border-color:rgba(83,155,245,.6);background:rgba(83,155,245,.13);color:var(--dsw-alias-label-primary,#e6edf3)}",
  ".js-term-auditTimezone{cursor:default;opacity:.8}",
  ".js-term-auditList{display:flex;flex-direction:column;gap:5px;overflow-y:auto}",
  ".js-term-auditRow{display:grid;grid-template-columns:68px 96px 84px 116px minmax(120px,1fr) auto;gap:8px;align-items:center;font-size:12px;color:var(--dsw-alias-label-secondary,#8b949e);padding:7px 8px;border:1px solid transparent;border-radius:8px;cursor:pointer}",
  ".js-term-auditRow:hover{background:rgba(177,186,196,.06);border-color:var(--dsw-alias-border-l2,#2d333b)}",
  ".js-term-auditCmd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#e6edf3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
  ".js-term-auditMeta{color:var(--dsw-alias-label-tertiary,#8b949e);font-variant-numeric:tabular-nums;white-space:nowrap}",
  ".js-term-auditTime{font-variant-numeric:tabular-nums;white-space:nowrap}",
  ".js-term-auditWho,.js-term-auditTarget{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".js-term-auditRisk,.js-term-auditEventBadge{justify-self:start;font-size:11px;font-weight:650;line-height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#2d333b);white-space:nowrap}",
  ".js-term-auditEventBadge{color:#8b949e;background:rgba(139,148,158,.08)}",
  ".js-term-auditRisk[data-risk=READ]{color:#3fb950;border-color:rgba(63,185,80,.45);background:rgba(63,185,80,.09)}",
  ".js-term-auditRisk[data-risk=PRIVILEGED_READ]{color:#58a6ff;border-color:rgba(88,166,255,.45);background:rgba(88,166,255,.09)}",
  ".js-term-auditRisk[data-risk=UNKNOWN]{color:#d29922;border-color:rgba(210,153,34,.5);background:rgba(210,153,34,.10)}",
  ".js-term-auditRisk[data-risk=MODIFY]{color:#f0883e;border-color:rgba(240,136,62,.5);background:rgba(240,136,62,.10)}",
  ".js-term-auditRisk[data-risk=DANGEROUS]{color:#f85149;border-color:rgba(248,81,73,.55);background:rgba(248,81,73,.11)}",
  ".js-term-auditDetail{grid-column:1/-1;min-width:0;padding:10px 12px;border-radius:7px;border-left:3px solid var(--dsw-alias-border-l2,#2d333b);background:var(--dsw-alias-bg-layer-0,#010409);white-space:normal;overflow-wrap:anywhere;line-height:1.65;color:var(--dsw-alias-label-secondary,#8b949e)}",
  ".js-term-auditDetail > div + div{margin-top:3px}",
  ".js-term-auditExport{height:26px;padding:0 8px;font-size:11px}",
  // V0.5.9: a refusal is the policy working, never a red failure.
  ".js-term-auditRefusal{justify-self:start;font-size:11px;font-weight:650;line-height:18px;padding:0 7px;border-radius:999px;border:1px solid rgba(88,166,255,.45);background:rgba(88,166,255,.10);color:#58a6ff;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}",
  // V0.4.0: streaming jobs of this conversation (任务 tab).
  ".js-term-jobs{flex:1;min-height:0;display:flex;flex-direction:column;padding:8px 12px;gap:8px;overflow-y:auto}",
  ".js-term-jobList{display:flex;flex-direction:column;gap:6px;overflow-y:auto}",
  ".js-term-jobRow{display:grid;grid-template-columns:76px minmax(120px,180px) minmax(120px,1fr) 96px auto;gap:8px;align-items:center;font-size:12px;padding:7px 8px;border:1px solid var(--dsw-alias-border-l2,#2d333b);border-radius:8px;color:var(--dsw-alias-label-secondary,#8b949e)}",
  ".js-term-jobState{justify-self:start;font-size:11px;font-weight:650;line-height:18px;padding:0 7px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#2d333b);white-space:nowrap}",
  ".js-term-jobState[data-state=RUNNING]{color:#58a6ff;border-color:rgba(88,166,255,.45);background:rgba(88,166,255,.09)}",
  ".js-term-jobState[data-state=STOPPED]{color:#3fb950;border-color:rgba(63,185,80,.45);background:rgba(63,185,80,.09)}",
  ".js-term-jobState[data-state=LOST]{color:#f85149;border-color:rgba(248,81,73,.55);background:rgba(248,81,73,.11)}",
  ".js-term-jobState[data-state=STOPPING],.js-term-jobState[data-state=VERIFYING]{color:#d29922;border-color:rgba(210,153,34,.5);background:rgba(210,153,34,.10)}",
  ".js-term-jobTarget,.js-term-jobCmd{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".js-term-jobCmd{color:var(--dsw-alias-label-primary,#e6edf3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
  ".js-term-jobMeta{color:var(--dsw-alias-label-tertiary,#8b949e);white-space:nowrap;font-variant-numeric:tabular-nums}",
  ".js-term-infoPop{position:absolute;right:12px;top:40px;z-index:20;background:var(--dsw-alias-bg-layer-3,#040d18);border:1px solid var(--dsw-alias-border-l2,#2d333b);border-radius:8px;padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-secondary,#8b949e);line-height:1.7}",
  ".js-term-confirm{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2,#2d333b);background:rgba(210,153,34,.08)}",
  ".js-term-confirmText{flex:1;min-width:0;font-size:12px;color:#d29922}",
  ".js-term-confirmCmd{flex-basis:100%;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:var(--dsw-alias-label-primary,#e6edf3);word-break:break-all}",
  ".js-term-confirmHint{flex-basis:100%;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e)}",
  ".js-term-confirmActions{display:flex;gap:8px}",
  ".js-term-newOutput{position:absolute;left:50%;bottom:10px;transform:translateX(-50%);z-index:10;border-radius:14px;padding:4px 12px;font-size:12px;cursor:pointer;border:1px solid rgba(83,155,245,.5);background:rgba(9,25,50,.92);color:#58a6ff}",
  ".js-term-assetWindow{position:relative}",
  ".js-term-classifyResult{margin-top:4px;padding:6px 10px;border-radius:8px;font-size:12px;white-space:pre-wrap;word-break:break-all}",
  ".js-term-cardSection{margin-top:14px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#2d333b)}",
  ".js-term-cardSectionTitle{font-size:12px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8b949e);margin:0 0 8px;letter-spacing:.04em}",
  ".js-term-radio{display:flex;gap:8px;flex-direction:column}",
  ".js-term-radioCard{appearance:none;display:flex;align-items:flex-start;gap:8px;padding:9px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#2d333b);background:var(--dsw-alias-bg-module-platform,#161b22);color:var(--dsw-alias-label-primary,#e6edf3);font-size:13px;cursor:pointer;text-align:left;width:100%}",
  ".js-term-radioCard[data-on]{border-color:rgba(83,155,245,.5);background:rgba(83,155,245,.10)}",
  ".js-term-radioTitle{display:flex;flex-direction:column;gap:2px}",
  ".js-term-radioHint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e)}",
  ".js-term-fieldErrors{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#f85149}",
  ".js-term-pane{position:relative;flex:1;width:100%;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#0d1117);color:var(--dsw-alias-label-primary,#e6edf3);font-family:var(--dsw-font-family,system-ui,sans-serif);overflow:hidden}",
  ".js-term-header{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#2d333b);flex:none;min-height:32px}",
  ".js-term-dot{width:9px;height:9px;border-radius:50%;flex:none;background:var(--dsw-alias-label-dimmed,#6e7681)}",
  ".js-term-dot[data-state=connected]{background:#3fb950;box-shadow:0 0 6px rgba(63,185,80,.8)}",
  ".js-term-dot[data-state=busy]{background:#d29922;box-shadow:0 0 6px rgba(210,153,34,.8)}",
  ".js-term-dot[data-state=error]{background:#f85149}",
  ".js-term-chips{display:flex;gap:6px;flex-wrap:wrap;flex:1;min-width:0}",
  ".js-term-version{font-variant-numeric:tabular-nums}",
  ".js-term-warn{background:rgba(242,113,28,.12);border-color:#d29922;color:#d29922}",
  ".js-term-warn b{color:#d29922}",
  ".js-term-chip{font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#161b22);color:var(--dsw-alias-label-secondary,#8b949e);white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#2d333b)}",
  ".js-term-chip b{color:var(--dsw-alias-label-primary,#e6edf3);font-weight:500}",
  ".js-term-body{flex:1;min-height:0;overflow:auto;padding:8px 0;background:var(--dsw-alias-bg-layer-0,#010409);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55}",
  ".js-term-output{white-space:pre;padding:0 14px;line-height:20px;height:20px}",
  ".js-term-meta{white-space:pre;padding:0 14px;font-size:11px;line-height:20px;height:20px;color:var(--dsw-alias-label-tertiary,#8b949e)}",
  ".js-term-meta[data-kind=state]{color:#58a6ff}",
  ".js-term-meta[data-kind=target]{color:#3fb950}",
  ".js-term-meta[data-kind=error]{color:#f85149}",
  ".js-term-input{white-space:pre;padding:0 14px;line-height:20px;height:20px;color:#c9d1d9}",
  ".js-term-input .js-term-prompt{color:#58a6ff;font-weight:600;margin-right:6px}",
  ".js-term-fg-1{color:#f85149}",
  ".js-term-fg-2{color:#3fb950}",
  ".js-term-fg-3{color:#d29922}",
  ".js-term-fg-4{color:#58a6ff}",
  ".js-term-fg-5{color:#bc8cff}",
  ".js-term-fg-6{color:#39c5cf}",
  ".js-term-fg-7{color:#e6edf3}",
  ".js-term-fg-8{color:#8b949e}",
  ".js-term-fg-9{color:#ffa198}",
  ".js-term-fg-10{color:#56d364}",
  ".js-term-fg-11{color:#e3b341}",
  ".js-term-fg-12{color:#79c0ff}",
  ".js-term-fg-13{color:#d2a8ff}",
  ".js-term-fg-14{color:#56d4dd}",
  ".js-term-fg-15{color:#f0f6fc}",
  ".js-term-bold{font-weight:700}",
  ".js-term-dim{opacity:.65}",
  ".js-term-empty{padding:20px 14px;color:var(--dsw-alias-label-tertiary,#8b949e);font-size:12px}",
  ".js-term-manual{flex:none;display:flex;align-items:center;gap:7px;padding:7px 10px 7px 12px;border-top:1px solid var(--dsw-alias-border-l2,#2d333b);background:var(--dsw-alias-bg-layer-1,#0d1117)}",
  ".js-term-manualPrompt{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-weight:700;color:#58a6ff;flex:none}",
  ".js-term-manualInput{flex:1!important;min-width:0!important;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important;background:var(--dsw-alias-bg-layer-0,#010409)!important}",
  ".js-term-manualInput:disabled{opacity:.55;cursor:not-allowed}",
  ".js-term-manualError{flex:none;padding:3px 12px 6px;border-top:1px solid var(--dsw-alias-border-l2,#2d333b);font-size:11px;color:#f85149;background:var(--dsw-alias-bg-layer-1,#0d1117)}",
  ".js-term-footer{flex:none;border-top:1px solid var(--dsw-alias-border-l2,#2d333b);padding:4px 10px 4px 14px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:34px}",
  ".js-term-footerMeta{display:flex;align-items:center;gap:8px;min-width:0}",
  ".js-term-status{font-weight:600;color:var(--dsw-alias-label-secondary,#8b949e);flex:none}",
  ".js-term-status[data-tone=connected]{color:#3fb950}",
  ".js-term-status[data-tone=busy]{color:#d29922}",
  ".js-term-status[data-tone=error]{color:#f85149}",
  ".js-term-hint{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".js-term-actions{display:flex;gap:6px;align-items:center;flex:none}",
  ".js-term-iconBtn{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid var(--dsw-alias-border-l2,#2d333b);background:transparent;color:var(--dsw-alias-label-secondary,#8b949e);border-radius:8px;cursor:pointer;padding:0;flex:none}",
  ".js-term-iconBtn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-label-dimmed,#6e7681)}",
  ".js-term-iconBtn[data-active=true]{color:var(--dsw-alias-label-primary,#e6edf3);border-color:var(--dsw-alias-brand-primary,#539bf5)}",
  ".js-term-iconBtn:disabled{opacity:.4;cursor:not-allowed}",
  ".js-term-sendBtn{color:var(--dsw-alias-brand-primary,#539bf5)}",
  ".js-term-pane input,.js-term-pane select,.js-term-cards input,.js-term-cards select{border:1px solid var(--dsw-alias-border-l2,#2d333b);background:var(--dsw-alias-bg-layer-3,#161b22);color:var(--dsw-alias-label-primary,#e6edf3);border-radius:8px;padding:5px 10px;font:inherit;font-size:13px;line-height:20px;min-width:0}",
  ".js-term-pane input:focus-visible,.js-term-pane select:focus-visible,.js-term-cards input:focus-visible,.js-term-cards select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#539bf5);outline-offset:0}",
  ".js-term-cards{display:flex;flex-direction:column;gap:10px;padding-top:4px}",
  ".js-term-cardField{display:flex;flex-direction:column;gap:5px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l2,#2d333b)}",
  ".js-term-cardField:first-child{border-top:none}",
  ".js-term-cardHead{display:flex;align-items:center;gap:8px}",
  ".js-term-cardLabel{flex:1;min-width:0;font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary,#e6edf3)}",
  ".js-term-cardHint{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b949e);margin:0}",
  ".js-term-switch{position:relative;width:34px;height:18px;flex:none;cursor:pointer}",
  ".js-term-switch input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}",
  ".js-term-switch .js-term-track{position:absolute;inset:0;border-radius:999px;background:var(--dsw-alias-border-l2,#2d333b);transition:background .15s}",
  ".js-term-switch input:checked + .js-term-track{background:var(--dsw-alias-brand-primary,#539bf5)}",
  ".js-term-switch .js-term-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s}",
  ".js-term-switch input:checked + .js-term-track + .js-term-thumb{transform:translateX(16px)}",
  ".js-term-select{min-width:0;flex:1}",
  ".js-term-cardRow{display:flex;gap:10px}",
  ".js-term-cardRow > div{flex:1;min-width:0}",
  ".js-term-badge{font-size:11px;line-height:17px;padding:1px 8px;border-radius:999px;background:var(--dsw-alias-bg-module-platform,#161b22);color:var(--dsw-alias-label-secondary,#8b949e);white-space:nowrap}",
  ".js-term-badge[data-on=true]{color:var(--dsw-alias-label-primary,#e6edf3)}",
  ".js-term-testResult{margin-top:8px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#8b949e);white-space:pre-wrap}",
  ".js-term-testOk{color:#3fb950}",
  ".js-term-testErr{color:#f85149}"
].join("");
var TAG = "dsh-jumpserver/terminal.css";
function injectStyles() {
  const globalDoc = globalThis.document;
  if (globalDoc === void 0) return;
  const selector = 'style[data-plugin-css="' + TAG + '"]';
  const existing = globalDoc.querySelector(selector);
  if (existing !== null) {
    if (existing.textContent !== TERMINAL_CSS) existing.textContent = TERMINAL_CSS;
    return;
  }
  const tag = globalDoc.createElement("style");
  tag.dataset.plugin = "dsh-jumpserver";
  tag.dataset.pluginCss = TAG;
  tag.textContent = TERMINAL_CSS;
  globalDoc.head.appendChild(tag);
}

// src/client/api.ts
var HOST_BASE = () => {
  const location = globalThis.location;
  const origin = location?.origin;
  return origin !== void 0 && origin !== "null" ? origin : "http://dsh.internal";
};
async function postJson(path, body, options = {}) {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 2e4;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const upstream = options.signal;
  const abortFromUpstream = () => controller.abort();
  if (upstream?.aborted === true) controller.abort();
  else upstream?.addEventListener("abort", abortFromUpstream, { once: true });
  try {
    const response = await fetch(HOST_BASE() + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
    const payload = await response.json().catch(() => void 0);
    if (!response.ok) {
      if (options.acceptErrorBody === true && payload !== void 0) return payload;
      throw new Error("HTTP " + response.status + " from " + path);
    }
    if (payload === void 0) throw new Error("invalid JSON response from " + path);
    return payload;
  } finally {
    clearTimeout(timer);
    upstream?.removeEventListener("abort", abortFromUpstream);
  }
}
function fetchStatus(sessionId, signal) {
  return postJson("/api/jumpserver.status", { sessionId }, { signal });
}
function fetchTestConnection(draft) {
  return postJson("/api/jumpserver.test", draft ?? {}, { timeoutMs: 3e4 });
}
function fetchClassify(command, signal) {
  return postJson("/api/jumpserver.classify", { command }, { signal, timeoutMs: 1e4 });
}

// src/client/settings-card.ts
var React = __toESM(require("react"), 1);
var h = React.createElement;
var DEFAULT_PASSWORD_ENV = "JUMPSERVER_PASSWORD";
var LF = String.fromCharCode(10);
var PERMISSION_OPTIONS = [
  { value: "READ_ONLY", key: "permissionReadOnly", hint: "\u4EC5\u5141\u8BB8\u8BCA\u65AD\u547D\u4EE4\uFF08\u9ED8\u8BA4\uFF09" },
  { value: "AUTO", key: "permissionAuto", hint: "\u4FEE\u6539\u547D\u4EE4\u6267\u884C\u524D\u8BE2\u95EE" },
  { value: "FULL_ACCESS", key: "permissionFull", hint: "\u666E\u901A\u4FEE\u6539\u81EA\u52A8\u6267\u884C\uFF0C\u9AD8\u5371\u4ECD\u786E\u8BA4" }
];
var MANUAL_OPTIONS = [
  { value: "CONFIRM_MODIFY", label: "\u4FEE\u6539\u547D\u4EE4\u4E8C\u6B21\u786E\u8BA4", hint: "\u53EA\u8BFB\u653E\u884C\uFF0C\u4FEE\u6539\u547D\u4EE4\u9700\u4E8C\u6B21\u786E\u8BA4\uFF08\u9ED8\u8BA4\uFF09" },
  { value: "FOLLOW_AGENT", label: "\u8DDF\u968F Agent \u6743\u9650", hint: "\u53EA\u8BFB\u6A21\u5F0F\u62E6\u4FEE\u6539\uFF1B\u81EA\u52A8\u6A21\u5F0F\u4FEE\u6539\u9700\u786E\u8BA4\uFF1B\u5B8C\u5168\u5F00\u653E\u4EC5\u9AD8\u5371\u786E\u8BA4\uFF08V0.3.1\uFF09" },
  { value: "FULL_ACCESS", label: "\u5B8C\u5168\u5F00\u653E", hint: "\u4EBA\u5DE5\u8F93\u5165\u4E0D\u8BBE\u9650\uFF08\u4ECD\u5BA1\u8BA1\uFF0CV0.2.7 \u524D\u65E7\u884C\u4E3A\uFF09" }
];
function sectionTitle(text) {
  return h("p", { className: "js-term-cardSectionTitle" }, text);
}
function radioCards(name, options, selected, disabled, onPick, t) {
  return h(
    "div",
    { className: "js-term-radio", key: name },
    options.map((option) => {
      const label = option.label ?? t[option.key ?? ""] ?? option.value;
      return h(
        "label",
        { className: "js-term-radioCard", key: option.value, "data-on": selected === option.value || void 0 },
        h("input", {
          type: "radio",
          name,
          value: option.value,
          checked: selected === option.value,
          disabled,
          onChange: () => onPick(option.value)
        }),
        h(
          "span",
          { className: "js-term-radioTitle" },
          h("span", null, label),
          h("span", { className: "js-term-radioHint" }, option.hint)
        )
      );
    })
  );
}
function JumpServerSettingsCard({ t, scope, api }) {
  const subscribed = React.useSyncExternalStore(
    React.useCallback((cb) => scope.subscribe(cb), [scope]),
    React.useCallback(() => scope.getSnapshot(), [scope])
  );
  const available = subscribed?.status === "ready";
  const writable = subscribed?.writable === true;
  const resolved = subscribed?.value ?? {};
  const user = subscribed?.user ?? {};
  const [open, setOpen] = React.useState(false);
  const [drafts, setDrafts] = React.useState({});
  const [bools, setBools] = React.useState({});
  const [saving, setSaving] = React.useState(false);
  const [fieldErrors, setFieldErrors] = React.useState([]);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState(null);
  const [classifyCmd, setClassifyCmd] = React.useState("");
  const [classifyBusy, setClassifyBusy] = React.useState(false);
  const [classifyResult, setClassifyResult] = React.useState(null);
  const [passwordConfigured, setPasswordConfigured] = React.useState(null);
  const [passwordWritable, setPasswordWritable] = React.useState(true);
  const passwordRef = String(drafts["passwordEnv"] ?? resolved["passwordEnv"] ?? DEFAULT_PASSWORD_ENV);
  React.useEffect(() => {
    let cancelled = false;
    api.credentials.describe({ refs: [passwordRef] }).then((response) => {
      if (cancelled) return;
      const view = response.result?.value?.credentials?.[passwordRef];
      setPasswordConfigured(view?.configured ?? false);
      setPasswordWritable(view?.writable ?? true);
    }).catch(() => {
      if (!cancelled) setPasswordConfigured(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api, passwordRef]);
  if (!available) return null;
  const field = (name) => {
    if (name in drafts) return drafts[name];
    const current = resolved[name];
    return current === void 0 ? "" : String(current);
  };
  const boolValue = (name) => name in bools ? bools[name] : resolved[name] === true || resolved[name] === "true" || resolved[name] === 1;
  const overridden = (name) => Object.prototype.hasOwnProperty.call(user, name);
  const edit = (name, text) => {
    setDrafts((prev) => ({ ...prev, [name]: text }));
    setFieldErrors([]);
  };
  const toggle = (name) => {
    setBools((prev) => ({ ...prev, [name]: !boolValue(name) }));
    setFieldErrors([]);
  };
  const resetField = (name) => {
    const clearDraft = () => {
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      setBools((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    };
    if (overridden(name)) void scope.unset(name).then(clearDraft);
    else clearDraft();
    setFieldErrors([]);
  };
  const dirty = Object.keys(drafts).length > 0 || Object.keys(bools).length > 0;
  const numberOrNull = (text) => {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  };
  const parseAssetGroups = (text) => {
    const trimmed = text.trim();
    if (trimmed === "") return { ok: true, value: {} };
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: 'assetGroups \u5FC5\u987B\u662F\u5BF9\u8C61\uFF1A{ "OA": { "keywords": ["OA","portal"] } }' };
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        const def = v;
        if (!Array.isArray(def?.keywords) || !def.keywords.every((x) => typeof x === "string")) {
          return { ok: false, error: "assetGroups \u7684 " + k + " \u7F3A\u5C11 keywords \u5B57\u7B26\u4E32\u6570\u7EC4" };
        }
        out[k] = { keywords: def.keywords.map((x) => String(x)) };
      }
      return { ok: true, value: out };
    } catch (error) {
      return { ok: false, error: "assetGroups JSON \u89E3\u6790\u5931\u8D25: " + (error instanceof Error ? error.message : String(error)) };
    }
  };
  const save = async () => {
    if (saving || !writable) return;
    setSaving(true);
    setFieldErrors([]);
    const errors = [];
    for (const name of ["port", "connectTimeout", "commandTimeout", "idleTimeout", "terminalScrollback", "assetCacheTtlSeconds"]) {
      if (!(name in drafts)) continue;
      const n = numberOrNull(drafts[name] ?? "");
      if (n === null) errors.push(name + ": \u5FC5\u987B\u662F\u6570\u5B57");
    }
    if ("host" in drafts && drafts["host"].trim().length === 0) errors.push("host: \u4E0D\u80FD\u4E3A\u7A7A");
    if ("username" in drafts && drafts["username"].trim().length === 0) errors.push("username: \u4E0D\u80FD\u4E3A\u7A7A");
    if ("assetGroups" in drafts) {
      const parsed = parseAssetGroups(drafts["assetGroups"] ?? "");
      if (!parsed.ok) errors.push(parsed.error);
    }
    if (errors.length > 0) {
      setFieldErrors(errors);
      setSaving(false);
      return;
    }
    let landed = true;
    const snapshots = {};
    const snapshotField = (name) => {
      if (snapshots[name] !== void 0) return;
      const current = resolved[name];
      snapshots[name] = current === void 0 ? { kind: "unset" } : { kind: "set", value: current };
    };
    const written = [];
    const mark = (name, ok) => {
      if (ok) written.push(name);
      landed = landed && ok;
    };
    const password = drafts["password"] ?? "";
    const refChanging = "passwordEnv" in drafts && (drafts["passwordEnv"] ?? "").trim() !== String(resolved["passwordEnv"] ?? "");
    const writePassword = async () => {
      try {
        await api.credentials.set({ ref: passwordRef, value: password });
        written.push("password");
        return true;
      } catch {
        return false;
      }
    };
    const textFields = [
      ["host", "string"],
      ["port", "number"],
      ["username", "string"],
      ["passwordEnv", "string"],
      ["connectTimeout", "number"],
      ["commandTimeout", "number"],
      ["idleTimeout", "number"],
      ["terminalScrollback", "number"],
      ["assetCacheTtlSeconds", "number"]
    ];
    const commitSettings = async () => {
      for (const [name, kind] of textFields) {
        if (!(name in drafts)) continue;
        snapshotField(name);
        const text = (drafts[name] ?? "").trim();
        if (text === "") {
          if (overridden(name)) {
            const ok2 = await scope.unset(name);
            mark(name, ok2);
            if (!ok2) errors.push(name + ": \u91CD\u7F6E\u5931\u8D25");
          }
          continue;
        }
        const ok = kind === "number" ? await scope.set(name, numberOrNull(text)) : await scope.set(name, text);
        mark(name, ok);
        if (!ok) errors.push(name + ": \u4FDD\u5B58\u5931\u8D25");
      }
      if ("assetGroups" in drafts) {
        snapshotField("assetGroups");
        const parsed = parseAssetGroups(drafts["assetGroups"] ?? "");
        if (parsed.ok) {
          const ok = await scope.set("assetGroups", parsed.value);
          mark("assetGroups", ok);
          if (!ok) errors.push("assetGroups: \u4FDD\u5B58\u5931\u8D25");
        }
      }
      if ("profiles" in drafts || "riskJudge" in drafts || "activeProfileId" in drafts) {
        for (const [name, expect] of [["profiles", "array"], ["riskJudge", "object"]]) {
          if (!(name in drafts)) continue;
          snapshotField(name);
          const text = (drafts[name] ?? "").trim();
          if (text === "") {
            if (overridden(name)) {
              const ok2 = await scope.unset(name);
              mark(name, ok2);
              if (!ok2) errors.push(name + ": \u91CD\u7F6E\u5931\u8D25");
            }
            continue;
          }
          const parsed = parseJsonValue(text, expect);
          if (!parsed.ok) {
            errors.push(name + ": " + parsed.error);
            continue;
          }
          const ok = await scope.set(name, parsed.value);
          mark(name, ok);
          if (!ok) errors.push(name + ": \u4FDD\u5B58\u5931\u8D25");
        }
        if ("activeProfileId" in drafts) {
          snapshotField("activeProfileId");
          const id = (drafts["activeProfileId"] ?? "").trim();
          const ok = id === "" ? await scope.unset("activeProfileId") : await scope.set("activeProfileId", id);
          mark("activeProfileId", ok);
          if (!ok) errors.push("activeProfileId: \u4FDD\u5B58\u5931\u8D25");
        }
      }
      for (const name of ["enabled", "autoReconnect", "enableAudit", "autoOpenTerminal"]) {
        if (!(name in bools)) continue;
        snapshotField(name);
        const ok = await scope.set(name, bools[name]);
        mark(name, ok);
        if (!ok) errors.push(name + ": \u4FDD\u5B58\u5931\u8D25");
      }
      for (const name of ["permissionMode", "manualPermissionMode"]) {
        if (!(name in drafts)) continue;
        snapshotField(name);
        const ok = await scope.set(name, drafts[name]);
        mark(name, ok);
        if (!ok) errors.push(name + ": \u4FDD\u5B58\u5931\u8D25");
      }
    };
    if (refChanging && password !== "") {
      await commitSettings();
      if (landed) {
        if (!await writePassword()) {
          errors.push("password: \u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u5BC6\u7801\u5199\u5165\u65B0\u5F15\u7528 " + passwordRef + " \u5931\u8D25 \u2014 \u8BF7\u91CD\u65B0\u8F93\u5165\u5BC6\u7801\u540E\u518D\u6B21\u4FDD\u5B58");
        }
      }
    } else {
      if (password !== "") {
        if (!await writePassword()) landed = false;
      }
      await commitSettings();
    }
    if (!landed) {
      const rollbackFailed = [];
      for (const name of [...written].reverse()) {
        const before = snapshots[name];
        if (before === void 0) continue;
        const ok = before.kind === "unset" ? await scope.unset(name) : await scope.set(name, before.value);
        if (!ok) rollbackFailed.push(name);
      }
      if (rollbackFailed.length > 0) errors.push("\u56DE\u6EDA\u672A\u5B8C\u5168\u6210\u529F: " + rollbackFailed.join(", "));
      setFieldErrors(errors);
      setSaving(false);
      return;
    }
    setDrafts({});
    setBools({});
    setFieldErrors(errors);
    setSaving(false);
  };
  const discard = () => {
    setDrafts({});
    setBools({});
    setFieldErrors([]);
    setTestResult(null);
  };
  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const draft = {};
      if ("host" in drafts) draft.host = drafts["host"].trim();
      if ("port" in drafts) draft.port = Number(drafts["port"]);
      if ("username" in drafts) draft.username = drafts["username"].trim();
      if ("password" in drafts && drafts["password"].length > 0) draft.password = drafts["password"];
      if ("passwordEnv" in drafts && drafts["passwordEnv"].trim().length > 0) draft.passwordEnv = drafts["passwordEnv"].trim();
      setTestResult(await fetchTestConnection(draft));
    } catch (error) {
      setTestResult({ ok: false, code: "BRIDGE_ERROR", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };
  const runClassify = async () => {
    const cmd = classifyCmd.trim();
    if (cmd.length === 0) return;
    setClassifyBusy(true);
    setClassifyResult(null);
    try {
      setClassifyResult(await fetchClassify(cmd));
    } catch (error) {
      setClassifyResult({ ok: false, code: "BRIDGE_ERROR", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setClassifyBusy(false);
    }
  };
  const blocked = !dirty || saving;
  const input = (name, label, hint, numeric = false) => h(
    "div",
    { className: "js-term-cardField", key: name },
    h(
      "div",
      { className: "js-term-cardHead" },
      h("label", { className: "js-term-cardLabel", htmlFor: "js-card-" + name }, label),
      overridden(name) ? h("span", { className: "js-term-badge" }, t.overridden) : null,
      overridden(name) ? h("button", { type: "button", className: "js-term-btn", onClick: () => resetField(name) }, t.reset) : null
    ),
    h("input", {
      id: "js-card-" + name,
      type: "text",
      inputMode: numeric ? "numeric" : void 0,
      value: field(name),
      disabled: !writable,
      onChange: (event) => edit(name, event.target.value)
    }),
    hint.length > 0 ? h("p", { className: "js-term-cardHint" }, hint) : null
  );
  const switchField = (name, label, hint) => h(
    "div",
    { className: "js-term-cardField", key: name },
    h(
      "div",
      { className: "js-term-cardHead" },
      h("label", { className: "js-term-cardLabel", htmlFor: "js-card-" + name }, label),
      h(
        "label",
        { className: "js-term-switch" },
        h("input", { id: "js-card-" + name, type: "checkbox", checked: boolValue(name), disabled: !writable, onChange: () => toggle(name) }),
        h("span", { className: "js-term-track" }),
        h("span", { className: "js-term-thumb" })
      )
    ),
    h("p", { className: "js-term-cardHint" }, hint)
  );
  const groupedField = (name, label, hint) => h(
    "div",
    { className: "js-term-cardRow" },
    input(name, label, hint, false)
  );
  const jsonText = (name) => {
    if (name in drafts) return drafts[name];
    const current = resolved[name];
    if (current === void 0 || current === null) return "";
    try {
      return JSON.stringify(current, null, 2);
    } catch {
      return "";
    }
  };
  const parseJsonValue = (text, expect) => {
    try {
      const value = JSON.parse(text);
      if (expect === "array" && !Array.isArray(value)) return { ok: false, error: "\u5E94\u4E3A JSON \u6570\u7EC4" };
      if (expect === "object" && (value === null || typeof value !== "object" || Array.isArray(value))) {
        return { ok: false, error: "\u5E94\u4E3A JSON \u5BF9\u8C61" };
      }
      return { ok: true, value };
    } catch (error) {
      return { ok: false, error: "JSON \u89E3\u6790\u5931\u8D25\uFF1A" + (error instanceof Error ? error.message : String(error)) };
    }
  };
  const profileIds = () => {
    const raw = jsonText("profiles");
    if (raw.trim().length === 0) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((entry) => entry !== null && typeof entry === "object" ? String(entry["id"] ?? "") : "").filter((id) => id.length > 0);
    } catch {
      return [];
    }
  };
  const addProfile = () => {
    let list = [];
    try {
      const parsed = JSON.parse(jsonText("profiles"));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
    const used = new Set(list.map((entry) => String(entry?.["id"] ?? "")));
    let index = list.length + 1;
    while (used.has("account" + String(index))) index += 1;
    list.push({ id: "account" + String(index), label: "", host: "", port: 2222, username: "", passwordEnv: "" });
    edit("profiles", JSON.stringify(list, null, 2));
  };
  const removeProfile = (id) => {
    let list = [];
    try {
      const parsed = JSON.parse(jsonText("profiles"));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      return;
    }
    edit("profiles", JSON.stringify(list.filter((entry) => String(entry?.["id"] ?? "") !== id), null, 2));
    if (drafts["activeProfileId"] === id) edit("activeProfileId", "");
  };
  const fillRiskJudge = () => {
    edit("riskJudge", JSON.stringify({
      enabled: false,
      endpoint: "https://api.typesafe.ai/v1/systemone",
      apiKeyEnv: "TYPESAFE_API_KEY",
      apiKeyFile: "",
      model: "jev-latest",
      timeoutMs: 1500,
      cacheTtlSeconds: 3600,
      redactNetwork: true,
      autoAllow: { enabled: false, minReadOnly: 0.9, minConfidence: 0.7, maxRiskScore: 1, minSafeProbability: 0.85 }
    }, null, 2));
  };
  return h(
    "li",
    { className: "js-term-card" },
    h(
      "button",
      { type: "button", className: "js-term-cardHeader", "aria-expanded": open, onClick: () => setOpen(!open) },
      h(
        "span",
        { className: "js-term-cardHeadText" },
        h("span", { className: "js-term-cardName" }, t.cardTitle),
        h("span", { className: "js-term-cardDesc" }, t.cardDescription)
      ),
      dirty ? h("span", { className: "js-term-badge js-term-dirty" }, t.unsaved) : null,
      h("span", { className: "js-term-chevron", "data-open": open || void 0 }, open ? "\u25B2" : "\u25BC")
    ),
    open ? h(
      "div",
      { className: "js-term-cardBody" },
      !writable ? h("p", { className: "js-term-cardHint" }, t.readOnlyStorage) : null,
      sectionTitle("\u8FDE\u63A5"),
      switchField("enabled", t.enabled, t.enabledHint),
      h("div", { className: "js-term-cardRow" }, input("host", t.host, t.hostHint), input("port", t.port, t.portHint, true)),
      input("username", t.username, t.usernameHint),
      h(
        "div",
        { className: "js-term-cardField", key: "password" },
        h(
          "div",
          { className: "js-term-cardHead" },
          h("label", { className: "js-term-cardLabel", htmlFor: "js-card-password" }, t.password),
          h("span", { className: "js-term-badge", "data-on": passwordConfigured === true || void 0 }, passwordConfigured === true ? t.passwordSaved : t.passwordUnset)
        ),
        h("input", {
          id: "js-card-password",
          type: "password",
          autoComplete: "off",
          value: drafts["password"] ?? "",
          placeholder: passwordConfigured === true ? "\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF\u25CF" : "",
          disabled: !writable || passwordWritable === false,
          onChange: (event) => edit("password", event.target.value)
        }),
        h("p", { className: "js-term-cardHint" }, t.passwordHint)
      ),
      input("passwordEnv", t.passwordEnv, t.passwordEnvHint),
      h(
        "div",
        { className: "js-term-cardField", key: "test" },
        h(
          "button",
          { type: "button", className: "js-term-btn" + (dirty ? " js-term-btnPrimary" : ""), disabled: testing, onClick: () => void runTest() },
          (testing ? t.testing : t.testConnection) + (dirty ? "\uFF08\u7528\u672A\u4FDD\u5B58\u914D\u7F6E\uFF09" : "")
        ),
        testResult !== null ? h(
          "p",
          { className: "js-term-testResult " + (testResult.ok ? "js-term-testOk" : "js-term-testErr"), role: "status" },
          (testResult.ok ? t.testOk : t.testFail) + (testResult.message ? LF + testResult.message : "") + (testResult.gateway ? LF + testResult.gateway : "") + (testResult.latencyMs !== void 0 ? LF + "latency: " + testResult.latencyMs + " ms" : "") + (testResult.draft === true ? LF + "(\u4F7F\u7528\u672A\u4FDD\u5B58\u914D\u7F6E\u6D4B\u8BD5)" : "")
        ) : null
      ),
      sectionTitle("\u6743\u9650\u4E0E\u5B89\u5168"),
      h(
        "div",
        { className: "js-term-cardField", key: "permissionMode" },
        h("div", { className: "js-term-cardHead" }, h("label", { className: "js-term-cardLabel" }, t.permissionMode), overridden("permissionMode") ? h("span", { className: "js-term-badge" }, t.overridden) : null),
        radioCards("permissionMode", PERMISSION_OPTIONS, "permissionMode" in drafts ? drafts["permissionMode"] : String(resolved["permissionMode"] ?? "READ_ONLY"), !writable, (v) => edit("permissionMode", v), t),
        h("p", { className: "js-term-cardHint" }, t.permissionModeHint)
      ),
      h(
        "div",
        { className: "js-term-cardField", key: "manualPermissionMode" },
        h("div", { className: "js-term-cardHead" }, h("label", { className: "js-term-cardLabel" }, "\u4EBA\u5DE5\u7EC8\u7AEF\u8F93\u5165"), overridden("manualPermissionMode") ? h("span", { className: "js-term-badge" }, t.overridden) : null),
        radioCards("manualPermissionMode", MANUAL_OPTIONS, "manualPermissionMode" in drafts ? drafts["manualPermissionMode"] : String(resolved["manualPermissionMode"] ?? "CONFIRM_MODIFY"), !writable, (v) => edit("manualPermissionMode", v), t),
        h("p", { className: "js-term-cardHint" }, "V0.2.7\uFF1A\u6D4F\u89C8\u5668\u4EBA\u5DE5\u7EC8\u7AEF\u7684\u72EC\u7ACB\u6743\u9650\u7B56\u7565\uFF08Agent \u4ECD\u8D70\u5DE6\u4FA7\u6743\u9650\u77E9\u9635\uFF09")
      ),
      switchField("enableAudit", t.enableAudit, t.enableAuditHint),
      sectionTitle("\u4F1A\u8BDD"),
      h("div", { className: "js-term-cardRow" }, input("connectTimeout", t.connectTimeout, "", true), input("commandTimeout", t.commandTimeout, "", true)),
      h("div", { className: "js-term-cardRow" }, input("idleTimeout", t.idleTimeout, "", true), input("assetCacheTtlSeconds", "\u8D44\u4EA7\u7F13\u5B58", "\u8D44\u4EA7\u5217\u8868 p \u6293\u53D6\u7F13\u5B58\u79D2\u6570\uFF08\u9ED8\u8BA4 300\uFF09", true)),
      switchField("autoReconnect", t.autoReconnect, t.autoReconnectHint),
      sectionTitle("\u7EC8\u7AEF"),
      switchField("autoOpenTerminal", t.autoOpenTerminal, t.autoOpenTerminalHint),
      input("terminalScrollback", t.terminalScrollback, t.terminalScrollbackHint, true),
      sectionTitle("\u547D\u4EE4\u98CE\u9669\u68C0\u67E5\uFF08V0.3.1\uFF09"),
      h(
        "div",
        { className: "js-term-cardField", key: "classify" },
        h(
          "div",
          { className: "js-term-cardRow" },
          h("input", {
            type: "text",
            value: classifyCmd,
            placeholder: "\u4F8B\u5982: sed -n '1,20p' /etc/hosts",
            spellCheck: false,
            onChange: (event) => {
              setClassifyCmd(event.target.value);
              setClassifyResult(null);
            },
            onKeyDown: (event) => {
              if (event.key === "Enter") void runClassify();
            }
          }),
          h("button", { type: "button", className: "js-term-btn js-term-btnPrimary", disabled: classifyBusy || classifyCmd.trim().length === 0, onClick: () => void runClassify() }, classifyBusy ? "\u68C0\u67E5\u4E2D\u2026" : "\u68C0\u67E5")
        ),
        h("p", { className: "js-term-cardHint" }, "\u7EAF\u672C\u5730\u5206\u7C7B\uFF08\u4E0D\u8FDE\u63A5\u3001\u4E0D\u6267\u884C\u4EFB\u4F55\u670D\u52A1\u5668\u547D\u4EE4\uFF09\uFF1A\u786E\u8BA4\u53EA\u8BFB / \u7279\u6743\u53EA\u8BFB / \u65E0\u6CD5\u786E\u8BA4 / \u4FEE\u6539 / \u9AD8\u5371\u3002"),
        classifyResult !== null ? h(
          "div",
          { className: "js-term-classifyResult " + (classifyResult.ok !== false ? "js-term-testOk" : "js-term-testErr"), role: "status" },
          classifyResult.ok !== false ? [
            "\u98CE\u9669: " + String(classifyResult.risk ?? "?"),
            "\u89C4\u5219: " + String(classifyResult.ruleId ?? "\u2014"),
            "\u539F\u56E0: " + String(classifyResult.reason ?? "\u2014"),
            "\u7F6E\u4FE1\u5EA6: " + String(classifyResult.confidence ?? "\u2014") + " \xB7 \u5206\u7C7B\u5668 v" + String(classifyResult.classifierVersion ?? "?")
          ].join(LF) : String(classifyResult.message ?? classifyResult.code ?? "\u68C0\u67E5\u5931\u8D25")
        ) : null
      ),
      h(
        "div",
        { className: "js-term-cardField", key: "assetGroups" },
        h(
          "div",
          { className: "js-term-cardHead" },
          h("label", { className: "js-term-cardLabel", htmlFor: "js-card-assetGroups" }, "\u8D44\u4EA7\u5206\u7EC4\uFF08assetGroups\uFF09"),
          overridden("assetGroups") ? h("span", { className: "js-term-badge" }, t.overridden) : null
        ),
        h("textarea", {
          id: "js-card-assetGroups",
          rows: 4,
          spellCheck: false,
          value: field("assetGroups"),
          disabled: !writable,
          placeholder: '{ "OA": { "keywords": ["OA","portal","workflow","\u529E\u516C"] }, "ESB": { "keywords": ["ESB","\u63A5\u53E3"] } }',
          onChange: (event) => edit("assetGroups", event.target.value)
        }),
        h("p", { className: "js-term-cardHint" }, '\u7EC4\u540D -> \u5173\u952E\u8BCD JSON\uFF1Bjumpserver_assets(group="OA") \u4E0E\u8D44\u4EA7\u9009\u62E9\u5668\u6309\u5173\u952E\u8BCD OR \u5339\u914D')
      ),
      h(
        "div",
        { className: "js-term-cardField", key: "profiles" },
        h(
          "div",
          { className: "js-term-cardHead" },
          h("label", { className: "js-term-cardLabel" }, t.profiles ?? "\u591A\u8D26\u53F7\uFF08profiles\uFF09"),
          overridden("profiles") ? h("span", { className: "js-term-badge" }, t.overridden) : null,
          h("button", { type: "button", className: "js-term-btn", disabled: !writable, onClick: addProfile }, "+ \u6DFB\u52A0\u8D26\u53F7")
        ),
        h("textarea", {
          id: "js-card-profiles",
          rows: 6,
          spellCheck: false,
          value: jsonText("profiles"),
          disabled: !writable,
          placeholder: '[ { "id": "main", "label": "\u4E3B\u8D26\u53F7", "host": "203.0.113.10", "port": 2222, "username": "ops", "passwordEnv": "JS_OPS_PASSWORD" } ]',
          onChange: (event) => edit("profiles", event.target.value)
        }),
        h(
          "div",
          { className: "js-term-cardRow" },
          h(
            "div",
            { className: "js-term-cardField", key: "activeProfileId" },
            h("div", { className: "js-term-cardHead" }, h("label", { className: "js-term-cardLabel", htmlFor: "js-card-activeProfileId" }, t.activeProfile ?? "\u4E3B\u8D26\u53F7\uFF08activeProfileId\uFF09")),
            h(
              "select",
              {
                id: "js-card-activeProfileId",
                value: field("activeProfileId"),
                disabled: !writable,
                onChange: (event) => edit("activeProfileId", event.target.value)
              },
              h("option", { value: "" }, "\uFF08\u4E0D\u4F7F\u7528\u591A\u8D26\u53F7\uFF0C\u7528\u4E0A\u9762\u7684 host/username\uFF09"),
              ...profileIds().map((id) => h("option", { key: id, value: id }, id))
            ),
            h(
              "div",
              { className: "js-term-cardHead" },
              h("button", {
                type: "button",
                className: "js-term-btn",
                disabled: !writable || field("activeProfileId").length === 0,
                onClick: () => removeProfile(field("activeProfileId"))
              }, "\u5220\u9664\u8BE5\u8D26\u53F7")
            ),
            h("p", { className: "js-term-cardHint" }, "\u9009\u4E2D\u7684\u8D26\u53F7\u4F18\u5148\u4E8E\u4E0A\u9762\u7684 host/username\uFF1B\u5BC6\u7801\u6309\u8BE5\u8D26\u53F7\u7684 passwordEnv \u4ECE\u73AF\u5883\u53D8\u91CF\u8BFB\u53D6")
          )
        )
      ),
      h(
        "div",
        { className: "js-term-cardField", key: "riskJudge" },
        h(
          "div",
          { className: "js-term-cardHead" },
          h("label", { className: "js-term-cardLabel" }, t.riskJudge ?? "Jev \u88C1\u51B3\uFF08riskJudge\uFF09"),
          overridden("riskJudge") ? h("span", { className: "js-term-badge" }, t.overridden) : null,
          h("button", { type: "button", className: "js-term-btn", disabled: !writable, onClick: fillRiskJudge }, "\u586B\u5165\u9ED8\u8BA4\u6A21\u677F")
        ),
        h("textarea", {
          id: "js-card-riskJudge",
          rows: 6,
          spellCheck: false,
          value: jsonText("riskJudge"),
          disabled: !writable,
          placeholder: '{ "enabled": false, "endpoint": "https://api.typesafe.ai/v1/systemone", "apiKeyEnv": "TYPESAFE_API_KEY", "model": "jev-latest", "timeoutMs": 1500 }',
          onChange: (event) => edit("riskJudge", event.target.value)
        }),
        h("p", { className: "js-term-cardHint" }, "TypeSafe System One\uFF08Jev\uFF09\u5BF9 UNKNOWN \u7EA7\u547D\u4EE4\u7ED9\u51FA\u88C1\u51B3\uFF1Benabled=false \u65F6\u5B8C\u5168\u4E0D\u5916\u53D1\u8BF7\u6C42\u3002API Key \u53EA\u653E\u73AF\u5883\u53D8\u91CF\u540D\u6216\u6587\u4EF6\u8DEF\u5F84\uFF0C\u4E0D\u5199\u8FDB\u914D\u7F6E")
      ),
      h(
        "div",
        { className: "js-term-cardFooter" },
        fieldErrors.length > 0 ? h("div", { className: "js-term-fieldErrors", role: "status" }, fieldErrors.map((e, i) => h("span", { key: i }, e))) : null,
        h("button", { type: "button", className: "js-term-btn", onClick: discard }, t.discard),
        h("button", { type: "button", className: "js-term-btn js-term-save", disabled: blocked || !writable, onClick: () => void save() }, saving ? t.saving : t.save)
      )
    ) : null
  );
}

// src/client/impl.ts
var inject = ["slots", "locale", "remote", "remote.credentials", "configForms"];
function tMap(bind) {
  return new Proxy({}, {
    get: (_target, key) => (typeof key === "string" ? bind(key) : void 0) ?? ""
  });
}
function scopeFace(form) {
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener) => form.subscribe(listener),
    set: async (field, value) => {
      await form.set(field, value);
      return true;
    },
    unset: async (field) => {
      await form.unset(field);
      return true;
    }
  };
}
function credentialsFace(ctx) {
  return {
    credentials: {
      describe: async ({ refs }) => {
        const response = await ctx.remote.credentials.describe(refs);
        return { result: { ok: response.ok, value: { credentials: response.value ?? {} } } };
      },
      set: async ({ ref, value }) => ctx.remote.credentials.set(ref, value)
    }
  };
}
function diag(event, detail) {
  try {
    void fetch("/api/jumpserver.diag", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, detail })
    }).catch(() => void 0);
  } catch {
  }
}
async function consoleAlreadyOpen(sessionId) {
  try {
    const response = await fetch("/api/jumpserver.consoleAlive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId })
    });
    if (!response.ok) return false;
    const value = await response.json();
    return value.active === true;
  } catch {
    return false;
  }
}
function apply(ctx) {
  injectStyles();
  diag("apply:enter", { inject: ["slots", "locale", "remote", "remote.credentials", "configForms"] });
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "jumpserver: browser dictionaries");
  const form = ctx.configForms.get(NS);
  const scope = scopeFace(form);
  const api = credentialsFace(ctx);
  diag("form:bound", { snapshot: form.getSnapshot()?.status ?? "none" });
  ctx.effect(() => ctx.configForms.whileServed([NS], (served) => {
    diag("whileServed:fired", { served: Array.from(served ?? []) });
    return ctx.slots.inject("settings.section", () => ctx.slots.register({
      name: "settings.section",
      id: NS,
      order: 30,
      label: () => t("tabTitle"),
      locale: NS,
      inject: () => ({ t: tMap(t), scope, api })
    }, JumpServerSettingsCard));
  }), "jumpserver: native settings page");
  ctx.inject(["sidebarRight", "sidebarRightTabs", "uiSession"], (side) => {
    const current = side.uiSession.adapter.current;
    let disposed = false;
    let inFlight = false;
    const grantSeen = /* @__PURE__ */ new Map();
    const maybeOpen = () => {
      const sessionId = current.getSnapshot().key;
      if (typeof sessionId !== "string" || sessionId.length === 0 || inFlight) return;
      if ((scope.getSnapshot().value ?? {})["autoOpenTerminal"] !== true) return;
      if (side.sidebarRightTabs.get("browser") === void 0) return;
      inFlight = true;
      void Promise.all([fetchStatus(sessionId, void 0), consoleAlreadyOpen(sessionId)]).then(([status, alreadyOpen]) => {
        if (disposed) return;
        const granted = status?.granted === true;
        const wasGranted = grantSeen.get(sessionId) ?? false;
        grantSeen.set(sessionId, granted);
        if (!granted || wasGranted) return;
        if (alreadyOpen) return;
        if (typeof status.consoleUrl !== "string") return;
        const separator = status.consoleUrl.includes("#") ? "&" : "#";
        side.sidebarRight.openTab("browser", {
          revealIfOpened: true,
          params: { url: status.consoleUrl + separator + "session=" + encodeURIComponent(sessionId) }
        });
      }).catch(() => void 0).finally(() => {
        inFlight = false;
      });
    };
    maybeOpen();
    const offCurrent = current.subscribe(maybeOpen);
    const offSettings = scope.subscribe(maybeOpen);
    const poll = setInterval(maybeOpen, 2500);
    return () => {
      disposed = true;
      offCurrent();
      offSettings();
      clearInterval(poll);
    };
  });
}

		return module.exports;
	}
});

/**
 * Permission gate — DSH-native approval + the WorkBuddy v0.5.x safety layers.
 *
 * DSH keeps its own boundaries that the MCP port does not have:
 *  - `ctx.get('approval')` is the human approval service (no confirm:true
 *    retry handshake), and a rejected/cancelled/unavailable approval aborts the
 *    command;
 *  - the conversation-scoped Session Grant is checked by the callers, before
 *    this module runs.
 *
 * Ported on top of that, unchanged in behaviour:
 *  - V0.5.7 advisory semantic second opinion for UNKNOWN commands;
 *  - V0.5.8 opt-in, fail-closed auto-allow (the ONE path a verdict may change
 *    an outcome);
 *  - V0.5.9 every refusal is audited exactly once: BLOCKED when the rules said
 *    no, DENIED when no human approval was granted.
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval';
import type { CommandRisk, PermissionMode, RiskJudgeConfig } from '../config/types.js';
import type { SessionManager } from '../jumpserver/session-manager.js';
import { type Classification } from './permission.js';
import { type RiskJudgeVerdict } from './risk-judge.js';
export interface GateServices {
    getConfig: () => {
        permissionMode: PermissionMode;
        privilegedReadInReadOnly?: boolean;
        riskJudge?: RiskJudgeConfig;
    };
    manager: SessionManager;
    approval?: ApprovalService;
    /**
     * Resolve a secret by its credential reference. The settings card writes the
     * JumpServer password AND the Jev API key into the DSH credential domain, so
     * the judge must read through the same seam rather than process.env.
     */
    resolveCredential?: (ref: string) => Promise<string | undefined>;
}
export interface GatedCommand {
    risk: CommandRisk;
    /** Full classification (ruleId/reason/confidence) — audit + approval copy. */
    classification: Classification;
    /** True when this gated command required a human approval (for the audit). */
    approvalRequired: boolean;
    /** Runs right after navigation (run/batch): verify target, then ask. */
    beforeExec?: () => Promise<void>;
    /** V0.5.8: the judge's opinion, when the classifier could not rule. */
    judge?: RiskJudgeVerdict;
    /** V0.5.8: true when that opinion let this command skip the human prompt. */
    judgeAutoAllowed?: boolean;
    /** V0.5.8: one-line record of the judge decision (audit + tool result). */
    judgeNote?: string;
}
/**
 * V0.5.8: one line reporting the commands that ran WITHOUT a human prompt
 * because the judge allowed them. Undefined when nothing was auto-allowed, so
 * an unremarkable call renders exactly as before.
 */
export declare function judgeAutoAllowNote(gated: GatedCommand[]): string | undefined;
/** Gate for jumpserver_exec: session is already in ASSET_SHELL. */
export declare function gateCommand(services: GateServices, exec: ToolRunContext, command: string): Promise<GatedCommand>;
/**
 * Gate for jumpserver_run: navigation happens inside manager.run, so target
 * verification + approval are deferred until the requested asset is entered.
 */
export declare function gateCommandForNavigation(services: GateServices, exec: ToolRunContext, command: string): Promise<GatedCommand>;
/**
 * Batch gate for one target. Confirmed READs are never included in an
 * approval. When 2-10 approval-required commands are short enough to display
 * completely, they share ONE target-verified approval prompt; otherwise each
 * command falls back to its own prompt. DANGEROUS items remain visible in that
 * explicit batch approval and are never silently allowed.
 */
export declare function gateCommandsForNavigation(services: GateServices, exec: ToolRunContext, commands: string[]): Promise<GatedCommand[]>;

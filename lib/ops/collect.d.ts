/**
 * V0.3.0 Ops Investigation: collection engine + light metric parse.
 *
 * runProfileSweep drives ONE target-affinity batch turn per phase through the
 * conversation's SessionManager (enter->probe->commands in a single mutex
 * turn), so a triage on 'auto' reuses the already-entered asset for phase 2.
 *
 * V0.3.1: profiles no longer hard-code risk='READ'. Every profile command is
 * re-classified by the SAME classifier as agent commands; a command that the
 * classifier does not confirm as READ aborts the sweep with
 * PROFILE_RISK_MISMATCH (never silently executes under a declared risk).
 */
import type { SessionManager } from '../jumpserver/session-manager.js';
export interface TrustedReadCommand {
    command: string;
    risk: string;
    actor: 'SYSTEM_PROFILE';
    classification: {
        risk: string;
        reason?: string;
        ruleId?: string;
        confidence?: string;
        classifierVersion?: number;
        normalizedCommand?: string;
    };
}
/**
 * V0.3.1 P0: one trusted-read entry. The classifier — not the profile author —
 * decides the risk; anything the classifier does not confirm as READ aborts
 * with PROFILE_RISK_MISMATCH instead of executing.
 */
export declare function trustedRead(command: string): TrustedReadCommand;
export interface CollectedCommand {
    command: string;
    category: string;
    label: string | null;
    exitCode: number | null;
    output: string;
    truncated: boolean;
    error: {
        code: string;
        message: string;
    } | null;
}
export interface SweepResult {
    commands: CollectedCommand[];
    /** App profiles detected from the phase-1 detection sweep ('auto' mode). */
    detected: string[];
    /** Profile ids actually collected (linux + detected/explicit). */
    profilesUsed: string[];
    /** Verified hostname from the navigation probe. */
    hostname: string | null;
    error: {
        code: string;
        message: string;
    } | null;
}
export interface SweepOptions {
    /** 'auto' (default) detects apps then loads their profiles; a named profile forces it. */
    profile?: string;
    since?: string;
    signal?: AbortSignal;
}
export declare function runProfileSweep(manager: SessionManager, target: string, options?: SweepOptions): Promise<SweepResult>;
export declare function parseUptime(text: string): {
    load1: number | null;
    load5: number | null;
    load15: number | null;
};
export declare function parseFreeMem(text: string): {
    totalMb: number | null;
    usedPct: number | null;
};
export declare function parseDfRoot(text: string): number | null;
/** Derive red-flag findings from collected commands (root-cause hypotheses seed). */
export declare function deriveFindings(commands: CollectedCommand[]): string[];

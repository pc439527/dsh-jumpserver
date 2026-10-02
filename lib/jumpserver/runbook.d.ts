import type { SessionManager } from './session-manager.js';
import type { RunbookDef, RunbookExpect } from '../config/types.js';
/** A runbook may not walk the whole estate in one call. */
export declare const MAX_RUNBOOK_TARGETS = 20;
export interface RunbookStepPlan {
    id: string;
    title: string | null;
    kind: 'profile' | 'command';
    /** For profile steps: the profile name; for command steps: the command. */
    source: string;
    /** Resolved read-only commands this step contributes. */
    commands: string[];
    /** V0.4.3: probe ids parallel to `commands` (profile steps only). */
    probes: string[];
    /** Why the step is skipped (null when runnable). */
    skipped: {
        reason: string;
        risk: string;
        ruleId: string;
    } | null;
    timeoutMs: number | null;
    /** V0.4.2: assertions this step carries (null when it asserts nothing). */
    expect: RunbookExpect | null;
}
export interface RunbookPlan {
    name: string;
    title: string | null;
    steps: RunbookStepPlan[];
    runnable: number;
    skipped: number;
    /** V0.4.2: how many runnable steps carry at least one assertion. */
    asserted: number;
}
/**
 * V0.4.3: ONE logical runbook step, as it appears in the result.
 *
 * Before V0.4.3 a profile step expanded into one result row per probe, so a
 * 10-probe profile produced 10 identically-named rows and — worse — the
 * step's `expect` was re-evaluated against every unrelated probe output.
 * Now a step is reported exactly once; the per-probe detail survives in
 * `commands[]` / `probes[]` for anyone who needs it.
 */
export interface RunbookStepResult {
    id: string;
    title: string | null;
    /** V0.4.3: which kind of step produced this row. */
    kind: 'profile' | 'command';
    source: string;
    /**
     * V0.4.3: the output the assertion was actually evaluated against.
     *  - command step / expect.probe set -> that single probe's output
     *  - profile step without expect.probe -> all probe outputs joined by '\n'
     */
    output: string;
    /** Aggregate exit code: 0 only when every contributing command exited 0. */
    exitCode: number | null;
    truncated: boolean;
    durationMs: number;
    error: {
        code: string;
        message: string;
    } | null;
    /**
     * V0.4.4: the error from the probes the assertion was actually judged
     * against (i.e. `expect.probe` if set, else the whole profile). Distinct
     * from `error` (which reports the worst probe in the entire profile) so
     * a healthy target with an unrelated probe failure is not falsely FAILed.
     */
    assertionError: {
        code: string;
        message: string;
    } | null;
    /** V0.4.3: per-command detail (one entry per probe for profile steps). */
    commands: Array<{
        /** V0.4.3: probe id inside the profile (null for command steps). */
        probe: string | null;
        command: string;
        exitCode: number | null;
        output: string;
        truncated: boolean;
        durationMs: number;
        error: {
            code: string;
            message: string;
        } | null;
    }>;
    /** V0.4.3: probe ids this step ran (profile steps; empty for command steps). */
    probes: string[];
    /** V0.4.2: assertion outcome for this step (null when the step asserts nothing). */
    check: RunbookCheck | null;
}
export interface RunbookTargetResult {
    target: string;
    hostname: string | null;
    error: {
        code: string;
        message: string;
    } | null;
    /** V0.4.2: overall verdict for this target (null when no step asserted). */
    verdict: RunbookVerdict | null;
    steps: RunbookStepResult[];
}
/** V0.4.2: 'pass' = every assertion held; 'fail' = at least one broke. */
export type RunbookVerdict = 'pass' | 'fail';
export interface RunbookCheck {
    verdict: RunbookVerdict;
    /** One line per failed assertion, already human-readable. */
    failures: string[];
}
/**
 * V0.4.2: evaluate a step's captured output against its `expect` block.
 * Pure and side-effect free so it can be unit-tested without a bastion.
 * Returns null when the step carries no assertions (nothing to judge).
 */
export declare function evaluateExpect(expect: RunbookExpect | undefined, outcome: {
    output: string;
    exitCode: number | null;
    /**
     * V0.4.4: error from the probe(s) the assertion was scoped to
     * (`expect.probe` if set, else the whole profile). Distinct from the
     * step-level `error` so an unrelated probe failure does not FAIL the
     * assertion. Backward-compatible: callers passing the old `error`
     * key still work because the field is just unused.
     */
    assertionError?: {
        code: string;
        message: string;
    } | null;
    /** @deprecated V0.4.4 prefer `assertionError`. Still honored if set. */
    error?: {
        code: string;
        message: string;
    } | null;
}): RunbookCheck | null;
export interface RunbookResult {
    runbook: string;
    title: string | null;
    plan: RunbookPlan;
    targets: number;
    reachable: number;
    results: RunbookTargetResult[];
    durationMs: number;
    warnings: string[];
    /** V0.4.2: assertion roll-up (null when no step asserted anything). */
    verdict: RunbookVerdict | null;
    passed: number;
    failed: number;
}
export interface RunbookOptions {
    targets: string[];
    signal?: AbortSignal;
    toolCallId?: string;
    batchId?: string;
    concurrency?: number;
    /** V0.5.2: called as each target settles, for MCP progress reporting. */
    onTarget?: (done: number, total: number, target: string) => void;
    /** V0.5.3: 0-based accountIndex per target for the KoKo `ID>` prompt. */
    accountByTarget?: Record<string, number>;
}
/**
 * Resolve a runbook definition into a concrete step plan. Pure: no bastion
 * access, no execution — so it is directly unit-testable and can be previewed.
 */
export declare function planRunbook(name: string, def: RunbookDef): RunbookPlan;
/** Resolve the runbook by name from the configured map; unknown name errors loudly. */
export declare function resolveRunbook(runbooks: Record<string, RunbookDef> | undefined, name: string): RunbookDef;
/**
 * Execute a runbook against every target. Commands are flattened in step
 * order per target and executed through the target-affinity batch path, so a
 * target is entered once and its results map back to the originating step.
 */
export declare function runRunbook(manager: SessionManager, getConfig: () => {
    allowedTargets?: string[];
    deniedTargets?: string[];
}, name: string, def: RunbookDef, options: RunbookOptions): Promise<RunbookResult>;

import { type JumpServerConfig, type PermissionMode } from '../config/types.js';
import type { TerminalObserver } from './terminal-observer.js';
import { AbortRequestedError, JumpServerError } from './errors.js';
import { type AssetEntry, type AssetHealth } from './asset-list.js';
import { type ExecOutcome, type SessionRuntimeConfig, type SessionStatus } from './session.js';
export interface AuditRecord {
    timestamp: string;
    operation: string;
    gateway: string;
    target: string | null;
    hostname: string | null;
    /** Persisted compatibility field; always redacted, never the raw execution command. */
    command: string | null;
    redactedCommand?: string;
    normalizedRedactedCommand?: string;
    /** V0.3.1: who ran the command — AGENT (tool path), HUMAN (sidebar input) or SYSTEM_PROFILE (ops sweep). */
    actor: 'AGENT' | 'HUMAN' | 'SYSTEM_PROFILE';
    /** Risk class (READ/PRIVILEGED_READ/UNKNOWN/MODIFY/DANGEROUS). */
    risk: string;
    /** V0.3.1: why the classifier chose this risk (audit must explain itself). */
    riskReason?: string;
    /** V0.3.1: matched semantic rule id (systemctl.status / unknown.command / ...). */
    riskRuleId?: string;
    riskConfidence?: string;
    classifierVersion?: number;
    /** V0.3.1: whitespace-normalized command. */
    normalizedCommand?: string;
    /** V0.3.1: whether a human approval was required for this command. */
    approvalRequired: boolean;
    /** V0.3.1: 'none' | 'approved' | 'denied' — the gate outcome. */
    approvalResult: string;
    /**
     * V0.5.8: one line recording what the semantic judge (Jev) said about a
     * command the rule classifier could not rule on, prefixed AUTO_ALLOWED when
     * that opinion let the command run without a human round-trip. Absent for
     * every command the classifier decided on its own.
     */
    riskJudge?: string;
    /**
     * V0.5.9: why a refused command was refused. Present on `BLOCKED` records
     * (the rules refused it) and `DENIED` records (nobody approved it). Without
     * it the trail says something was stopped but not why.
     */
    refusalReason?: string;
    /** V0.4.0: MCP request id that produced this record (AI task correlation). */
    toolCallId?: string;
    /** V0.4.0: one id per jumpserver_batch / inspect / topology call. */
    batchId?: string;
    /** V0.4.0: long-running job id (jumpserver_job_start). */
    taskId?: string;
    /** V0.4.0: index of this command inside its batch (audit ordering). */
    batchIndex?: number;
    /** V0.4.0: monotonic per-process write sequence (stable ordering in the JSONL). */
    sequence?: number;
    permissionMode: PermissionMode;
    result: string;
    exitCode: number | null;
    durationMs: number | null;
}
/** status()/connect()/enter()/leave()/close() return this extended shape. */
export type ManagerStatus = SessionStatus & {
    configured: boolean;
    permissionMode: PermissionMode;
};
export interface SessionManagerOptions {
    getConfig: () => JumpServerConfig;
    resolvePassword: () => Promise<string | undefined>;
    onAudit?: (record: AuditRecord) => void | Promise<void>;
    onLog?: (message: string) => void;
    /** DSH-fiber timer injection (ctx.timeout); falls back to global setTimeout. */
    scheduleTimeout?: (fn: () => void, delayMs: number) => () => void;
    /** Test seam: replaces the real ssh2 transport (forwarded to the session). */
    wireFactory?: import('./session.js').WireFactory;
    /** V0.2: live terminal mirror sink; every PTY input/output/state/target event lands here. */
    observer?: TerminalObserver;
    /**
     * V0.4.3: process-wide gate on simultaneous target batches. `maxSessions`
     * was configured but never enforced; wiring this Semaphore makes it real —
     * with batchConcurrency>1 at most `maxSessions` targets are entered at once.
     */
    sessionGate?: {
        acquire: () => Promise<() => void>;
    };
}
export interface ExecRequest {
    command: string;
    timeoutMs?: number;
    risk: string;
    /** V0.3.1: audit actor — defaults to AGENT for the tool path. */
    actor?: 'AGENT' | 'HUMAN' | 'SYSTEM_PROFILE';
    /** V0.3.1: full classification (rule/reason/confidence) so the audit is self-explanatory. */
    classification?: {
        risk: string;
        reason?: string;
        ruleId?: string;
        confidence?: string;
        classifierVersion?: number;
        normalizedCommand?: string;
    };
    /** V0.3.1: approval outcomes from the gate. */
    approvalRequired?: boolean;
    approvalResult?: string;
    /** V0.5.8: audit line for the judge decision behind this command, when there was one. */
    riskJudge?: string;
    /** V0.4.0: MCP request id (audit correlation). */
    toolCallId?: string;
    /** V0.4.0: batch/inspect run id (audit correlation). */
    batchId?: string;
    signal?: AbortSignal;
}
export interface RunRequest {
    target: string;
    command: string;
    timeoutMs?: number;
    risk: string;
    signal?: AbortSignal;
    /** V0.3.1: audit actor (default AGENT). */
    actor?: 'AGENT' | 'HUMAN' | 'SYSTEM_PROFILE';
    /** V0.3.1: full classification for the audit. */
    classification?: {
        risk: string;
        reason?: string;
        ruleId?: string;
        confidence?: string;
        classifierVersion?: number;
        normalizedCommand?: string;
    };
    approvalRequired?: boolean;
    approvalResult?: string;
    /** V0.5.8: audit line for the judge decision behind this command, when there was one. */
    riskJudge?: string;
    /** V0.4.0: MCP request id (audit correlation). */
    toolCallId?: string;
    /** V0.4.0: batch/inspect run id (audit correlation). */
    batchId?: string;
    /** V0.5.3: 0-based accountIndex to select a user on KoKo's `ID>` prompt.
     *  Required only when the target has more than one bastion user. */
    accountIndex?: number;
    /** Runs right after navigation (target verified) and immediately before exec. */
    beforeExec?: () => Promise<void>;
}
/** One command inside a target-affinity batch turn. */
export interface BatchCommandRequest {
    command: string;
    timeoutMs?: number;
    risk: string;
    /** V0.3.1: audit actor for this batch command (SYSTEM_PROFILE for ops sweeps). */
    actor?: 'AGENT' | 'HUMAN' | 'SYSTEM_PROFILE';
    /** V0.3.1: full classification for the audit. */
    classification?: {
        risk: string;
        reason?: string;
        ruleId?: string;
        confidence?: string;
        classifierVersion?: number;
        normalizedCommand?: string;
    };
    approvalRequired?: boolean;
    approvalResult?: string;
    /** V0.5.8: audit line for the judge decision behind this command, when there was one. */
    riskJudge?: string;
    /** V0.4.0: MCP request id (audit correlation). */
    toolCallId?: string;
    /** V0.4.0: batch/inspect run id (audit correlation). */
    batchId?: string;
    /** V0.4.0: index of this command inside its batch (audit ordering). */
    batchIndex?: number;
    /** Runs right after the target is verified and immediately before this command's exec. */
    beforeExec?: () => Promise<void>;
}
/** All commands for one target: the manager enters the target ONCE and runs every command before leaving. */
export interface TargetBatchRequest {
    target: string;
    commands: BatchCommandRequest[];
    signal?: AbortSignal;
    /** V0.4.0: MCP request id (audit correlation). */
    toolCallId?: string;
    /** V0.4.0: one id for the whole batch run (inspect/topology/batch). */
    batchId?: string;
    /** V0.5.3: 0-based accountIndex for the target's `ID>` prompt (when multiple users). */
    accountIndex?: number;
}
/**
 * V0.5.12: the nested failure shape produced by errorDetail(). The interfaces
 * below used to declare `{ code, message }` only, so even though errorDetail()
 * attached `detail` at runtime, the renderers were typed out of seeing it —
 * the compiler blessed a projection that silently dropped every diagnostic.
 */
export interface NestedFailure {
    code: string;
    message: string;
    /** Structured diagnostic: parsed account list, detector tail, host-key reason. */
    detail?: string;
}
export interface BatchCommandResult {
    command: string;
    executionState: string;
    /**
     * V0.4.3: what happened to the COMMAND (SUCCESS/EXIT_NONZERO/TIMEOUT/...).
     * executionState only says whether the transport exchange completed.
     */
    commandStatus: string;
    exitCode: number | null;
    output: string;
    truncated: boolean;
    durationMs: number;
    error: NestedFailure | null;
}
export interface TargetBatchResult {
    target: string;
    hostname: string | null;
    /** Navigation-level failure (enter/menu problems): commands stay empty. */
    error: NestedFailure | null;
    commands: BatchCommandResult[];
}
export declare function toRuntimeConfig(cfg: JumpServerConfig, password: string, wireFactory?: import('./session.js').WireFactory): SessionRuntimeConfig;
export declare class SessionManager {
    private readonly options;
    private session;
    private mutex;
    private reconnectAttempts;
    private reconnectTimer;
    private disposed;
    private lastError;
    /** V0.2.4 P1: one 'p' capture is reused locally for later filtered queries. */
    private assetCache;
    /** V0.2.5: a connection dropped during a pending op; reconnect once the turn settles. */
    private reconnectPending;
    /**
     * V0.4.0: id of the streaming job currently owning the PTY (tail -f …).
     * While set, no other command may use the shell — mixing commands into a
     * streaming job's output would corrupt both.
     */
    private activeJob;
    /**
     * V0.4.4: job that has been asked to stop but has not finished verifying
     * the shell yet. The PTY is still in the middle of recovering (Ctrl+C
     * sent + probe in flight) and MUST NOT be touched by another command.
     * `activeJob` stays set for the duration so the existing "another job
     * owns this shell" guard still fires; once verifyShell resolves we
     * release BOTH fields together. This kills the V0.4.3 race where the
     * manager cleared activeJob BEFORE the probe was even scheduled.
     */
    private stoppingJob;
    constructor(options: SessionManagerOptions);
    /**
     * Run one mutex turn, then flush any reconnect that was deferred while the
     * turn held the queue (V0.2.5): a wire drop mid-operation used to lose the
     * reconnect entirely because onSessionLost returned early on hasPendingOp.
     */
    private queue;
    private flushPendingReconnect;
    status(): ManagerStatus;
    /** True while a streaming job owns the PTY (see activeJob). */
    hasActiveJob(): boolean;
    /**
     * V0.4.5: which job currently owns this session's PTY, or null. The JobStore
     * pump uses this as the authority for "does this job still own a shell?",
     * instead of inferring ownership from the DISCONNECTED state — a reconnect
     * that completed within one pump interval used to leave a dead job RUNNING.
     */
    activeJobId(): string | null;
    /** Fail fast when a streaming job owns the shell instead of corrupting its output. */
    private assertNoActiveJob;
    /**
     * V0.4.5: drop PTY ownership. Called whenever the transport underneath the
     * session disappears — close(), dispose(), transport loss, or a reconnect
     * that replaces the session object. Without this a streaming job kept a
     * ghost claim on a shell that no longer exists, so after a reconnect every
     * exec / job_start answered SESSION_BUSY forever, and the JobStore (which
     * only looked at DISCONNECTED) could keep reporting a lost job as RUNNING.
     */
    private releasePtyOwnership;
    /** Public connect: serialized through the session queue. */
    connect(signal?: AbortSignal): Promise<ManagerStatus>;
    /**
     * V0.4.0 P0: out-of-band interrupt — Ctrl+C reaches the remote shell even
     * while a command/batch is in flight (the queue is deliberately bypassed;
     * queueing would only deliver the interrupt after the running op finished).
     */
    interrupt(): Promise<{
        sent: boolean;
        verified: boolean;
        state: string;
        target: string | null;
    }>;
    /**
     * Connect WITHOUT re-acquiring the queue. Only call this while the caller
     * already holds the mutex (e.g. inside run()); calling public connect()
     * from such a context would deadlock on the same lock.
     */
    private connectLocked;
    enter(target: string, accountIndex?: number, signal?: AbortSignal): Promise<ManagerStatus>;
    exec(request: ExecRequest): Promise<{
        status: ManagerStatus;
        outcome: ExecOutcome;
    }>;
    /** High-level run: connect -> (leave) -> enter -> exec, all in ONE queue slot. */
    run(request: RunRequest): Promise<{
        status: ManagerStatus;
        outcome: ExecOutcome;
        target: string | null;
        hostname: string | null;
    }>;
    /** Shared navigation: menu -> enter(target) -> verified status. */
    private navigateToTarget;
    /**
     * V0.4.0: start a streaming job (tail -f / journalctl -f / top / ping / tcpdump).
     * Navigation happens inside the queue; the command is then written RAW (no
     * completion marker) and its output is harvested from the observer stream by
     * the job store. The job owns the PTY until it is stopped.
     */
    startJob(request: {
        jobId: string;
        target: string;
        command: string;
        signal?: AbortSignal;
        toolCallId?: string;
        /** V0.5.3: 0-based accountIndex to select a user on KoKo's `ID>` prompt
         *  when the target has multiple authorised bastion users. */
        accountIndex?: number;
        /** V0.4.3: real classification — the audit must NOT hardcode READ. */
        classification?: {
            risk: string;
            reason?: string;
            ruleId?: string;
            confidence?: string;
            classifierVersion?: number;
            normalizedCommand?: string;
        };
        /** V0.4.3: approval outcome recorded in the audit. */
        approvalRequired?: boolean;
        /** V0.4.3: ignored when beforeExec is supplied — the manager derives the
         *  outcome from the gate run, not from a caller-provided string. */
        approvalResult?: string;
        /** V0.5.8: audit line for the judge decision behind this job's command. */
        riskJudge?: string;
        /**
         * V0.4.4: deferred permission gate. Runs after navigation, BEFORE the
         * remote writeLine. Throwing COMMAND_APPROVAL_REQUIRED aborts the start
         * with a `denied` audit and the PTY is left untouched.
         */
        beforeExec?: () => Promise<void>;
    }): Promise<{
        target: string | null;
        hostname: string | null;
        state: string;
        startSeq: number;
    }>;
    /**
     * V0.4.0: stop a streaming job — Ctrl+C (out-of-band) and release the PTY.
     * V0.4.3: after the interrupt, PROVE the shell came back. Reporting
     * `state: 'ASSET_SHELL'` without probing let a wedged PTY masquerade as a
     * usable session, so the next command typed into a dead shell.
     * V0.4.4: stopJob now uses session.interruptAndVerify() so exactly one
     * Ctrl+C is sent; activeJob is released only AFTER the probe resolves,
     * which closes the V0.4.3 race where another exec/startJob could land
     * while the shell was still mid-recovery.
     */
    stopJob(jobId: string): Promise<{
        sent: boolean;
        verified: boolean;
        state: string;
    }>;
    /**
     * Target-affinity batch: navigate to ONE target, run EVERY command in its
     * task, then return. All commands of one target execute inside a single
     * mutex turn, so a multi-target batch can never bounce between assets.
     * Navigation problems are captured per target (error + empty commands)
     * instead of aborting the whole batch; per-command failures are captured
     * per command so one bad command cannot mask its neighbours' results.
     */
    runTargetBatch(request: TargetBatchRequest): Promise<TargetBatchResult>;
    private runTargetBatchGated;
    /**
     * V0.5.5: `detail` is now part of the projection. It used to be dropped
     * here, so every multi-target tool (batch / runbook / inspect / compare /
     * baseline) reported a bare `code: message` — the KoKo banner, the parsed
     * account list and the retryAfterMs hint were all lost between the session
     * and the model, which is precisely where the retry loop was fed.
     */
    private errorDetail;
    leave(signal?: AbortSignal): Promise<ManagerStatus>;
    /**
     * V0.2.3 P1 / V0.2.4: list the authorized assets (KoKo menu command 'p')
     * and filter locally. Read-only — the session stays at the JumpServer menu
     * (or, when the list turned out interactive, is collapsed to UNKNOWN so the
     * next op reconnects instead of typing into a pager). Never enters an asset.
     *
     * V0.2.4 caching: the raw (unfiltered) capture is cached per conversation
     * for assetCacheTtlSeconds, so repeated / filtered queries re-filter the
     * same capture instead of re-sending 'p' to KoKo. The cache is dropped when
     * the connection is re-established or the session is closed.
     */
    listAssets(filter?: string, signal?: AbortSignal, refresh?: boolean, group?: string): Promise<{
        assets: AssetEntry[];
        count: number;
        filter: string | null;
        group: string | null;
        groupMatched: number;
        truncated: boolean;
        paged: boolean;
        rawText: string;
        rawRows: number;
        parsedRows: number;
        page: number | null;
        pageSize: number | null;
        totalPages: number | null;
        reportedTotal: number | null;
        complete: boolean;
        health: AssetHealth;
    }>;
    close(): Promise<ManagerStatus>;
    /** Called by the plugin's ctx.interval: close when idle past the threshold. */
    tickIdle(): void;
    dispose(): void;
    get lastErrorMessage(): string | null;
    private requireLiveSession;
    /**
     * Ensure a live session WHILE ALREADY HOLDING the queue. Never re-enters
     * the mutex (that would deadlock with the outer run() turn).
     */
    private ensureConnectedLocked;
    private onSessionLost;
    private scheduleReconnect;
    private cancelReconnect;
    /**
     * V0.5.9: record a command that was REFUSED — either by the rule gate itself
     * (`COMMAND_BLOCKED`) or because nobody approved it (`DENIED`).
     *
     * Why this exists: before V0.5.9 the audit trail only contained commands that
     * actually ran, so "who tried to run what, and was stopped" was invisible —
     * a compliance blind spot, not a cosmetic one.
     *
     * Best-effort by construction: audit() swallows sink failures, so a broken
     * audit sink can never turn a refusal into an execution.
     */
    recordDenied(input: {
        operation: string;
        command: string | null;
        risk: string;
        classification?: {
            risk: string;
            reason?: string;
            ruleId?: string;
            confidence?: string;
            classifierVersion?: number;
            normalizedCommand?: string;
        };
        /** Why it was refused — the gate's own reason, not the classifier's. */
        reason: string;
        /** 'blocked' = the rules refused it outright; 'denied' = no human approval. */
        kind: 'blocked' | 'denied';
        /** Who acted: the agent, or a person typing in the console. Default AGENT. */
        actor?: 'AGENT' | 'HUMAN' | 'SYSTEM_PROFILE';
        target?: string | null;
        hostname?: string | null;
        riskJudge?: string;
        toolCallId?: string;
        batchId?: string;
        batchIndex?: number;
    }): Promise<void>;
    private audit;
}
export { AbortRequestedError, JumpServerError };

import type { SessionRegistry } from '../jumpserver/session-registry.js';
export type JobState = 'RUNNING' | 'STOPPING' | 'VERIFYING' | 'STOPPED' | 'LOST';
export interface JobRecord {
    id: string;
    sessionId: string;
    target: string;
    hostname: string | null;
    command: string;
    state: JobState;
    startedAt: number;
    stoppedAt: number | null;
    maxDurationMs: number;
    bytes: number;
    truncated: boolean;
    error: string | null;
    /** TerminalObserver event seq of the last event harvested by pump(). */
    lastSeq: number;
    /**
     * V0.4.5 cursor space: absolute number of output characters this job has
     * ever produced. `output` only ever holds the tail, so the absolute cursor
     * of `output[0]` is `producedChars - output.length`.
     */
    producedChars: number;
    /** V0.4.5: absolute cursor delivered by the last implicit read(). */
    readCursor: number;
    output: string;
}
/** What a cursor read returns: the window plus the cursor to pass next time. */
export interface JobReadView extends JobRecord {
    /** Pass as `sinceSeq` on the next read; equals the absolute end cursor. */
    nextSeq: number;
    /** Chars the caller asked for that had already been evicted from the buffer. */
    droppedChars: number;
    /** True when the returned window does not reach the end of the buffer. */
    partial: boolean;
    /** 'cursor' (incremental window) | 'full' (whole remaining buffer). */
    mode: 'cursor' | 'full';
}
/** Hard caps: one conversation must not be able to flood memory or the PTY. */
export declare const MAX_JOBS = 8;
export declare const MAX_JOB_DURATION_MS: number;
export declare const DEFAULT_JOB_DURATION_MS: number;
export interface JobStartOptions {
    sessionId: string;
    target: string;
    command: string;
    maxDurationMs?: number;
    signal?: AbortSignal;
    toolCallId?: string;
    /** V0.5.3: 0-based accountIndex for the target's KoKo `ID>` prompt. */
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
    approvalResult?: string;
    /** V0.5.8: audit line for the judge decision behind this job's command. */
    riskJudge?: string;
    /**
     * V0.4.4: deferred permission gate. The SessionManager runs this INSIDE its
     * queue, AFTER the target is navigated but BEFORE the command is written to
     * the PTY. When this throws COMMAND_APPROVAL_REQUIRED, the manager writes
     * a `denied` audit and refuses to claim the PTY.
     */
    beforeExec?: () => Promise<void>;
}
export interface JobReadOptions {
    /** Conversation the caller is on — a job of another scope is invisible. */
    sessionId?: string;
    maxChars?: number;
    /** Explicit absolute cursor (from a previous `nextSeq`). */
    sinceSeq?: number | null;
    full?: boolean;
}
export declare class JobStore {
    private readonly registry;
    private readonly jobs;
    /**
     * V0.4.5: one in-flight stop per job. A second stop() for the same id
     * awaits the FIRST promise instead of re-deciding the outcome — the V0.4.4
     * race let caller B observe state VERIFYING, skip the probe branch and
     * stamp STOPPED while caller A's probe later failed with LOST.
     */
    private readonly stopInflight;
    private timer;
    constructor(registry: SessionRegistry);
    start(options: JobStartOptions): Promise<JobRecord>;
    /** Harvest new observer output for every running job; auto-stop on timeout. */
    pump(): void;
    private finish;
    /** One job, only when it belongs to the caller's conversation. */
    get(id: string, sessionId?: string): JobRecord | null;
    /** The RUNNING job that currently owns this conversation's PTY, if any. */
    activeJobFor(sessionId: string): JobRecord | null;
    /**
     * Stop a job: Ctrl+C on the PTY (out-of-band), then PROVE the shell came
     * back. V0.4.3: the state walks RUNNING -> STOPPING -> VERIFYING ->
     * STOPPED/LOST so a wedged PTY is reported as LOST instead of being
     * silently presented as a healthy stopped job.
     * V0.4.4: accepts an optional `reason` (e.g. "maxDuration reached") so
     * the auto-stop pump records WHY the job ended without racing finish().
     * V0.4.5: concurrent-safe — the second caller awaits the first caller's
     * promise and never re-decides; `sessionId` refuses a cross-conversation id.
     */
    stop(id: string, reason?: string | null, sessionId?: string): Promise<JobRecord>;
    private stopInternal;
    /** Interrupt (Ctrl+C) every running job — console 中断 button / MCP abort. */
    stopAll(sessionId?: string): Promise<number>;
    /**
     * V0.4.5: cursor read. `full` returns the whole remaining buffer once;
     * otherwise the window starts at `sinceSeq` (or the cursor of the previous
     * implicit read) and the response carries `nextSeq` for the next call.
     * V0.4.4 returned the tail of the buffer on every call, so a model polling
     * in a loop re-consumed the same old log lines and re-judged them.
     */
    read(id: string, options?: JobReadOptions): JobReadView | null;
    /** Jobs of one conversation, or every job when no scope is given (console). */
    list(sessionId?: string): JobRecord[];
    /** Never hand the whole (possibly 256KB) buffer to a list view. */
    private view;
    private prune;
    private ensureTimer;
    private stopTimer;
    dispose(): void;
}

/**
 * V0.4.5: ONE entry point for "stop whatever is running on this session's PTY".
 *
 * V0.4.4 had TWO owners racing for the same foreground job:
 *
 *   jumpserver_interrupt / console 中断
 *       manager.interrupt()          // Ctrl+C #1 + verify
 *       jobs.stopAll()               // JobStore.stop -> stopJob -> Ctrl+C #2
 *
 * JobStore.stop() itself was already correct (one ^C via
 * SessionManager.stopJob -> interruptAndVerify), but running it AFTER
 * manager.interrupt() interrupted the same job twice. The rule is simple:
 * a session with a streaming job has exactly ONE owner (the JobStore), so the
 * interrupt must be delegated to it; only a session with no streaming job may
 * send the raw out-of-band Ctrl+C.
 *
 * The MCP tool and the embedded console both call this function, so the two
 * entry points can never drift apart again.
 */
import type { JobStore } from './job-store.js';
import type { SessionManager } from '../jumpserver/session-manager.js';
export interface InterruptOutcome {
    /** How the stop was performed: a streaming job, a bare shell, or nothing. */
    mode: 'job' | 'shell' | 'none';
    sent: boolean;
    verified: boolean;
    state: string;
    target: string | null;
    jobId: string | null;
    jobState: string | null;
    /** Number of streaming jobs that were stopped (0 for the shell path). */
    jobsStopped: number;
    message: string;
}
export declare function interruptSession(jobs: JobStore | null | undefined, manager: SessionManager, sessionId: string, reason?: string): Promise<InterruptOutcome>;

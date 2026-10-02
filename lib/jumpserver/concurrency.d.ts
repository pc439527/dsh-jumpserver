export interface MapOptions<T = unknown> {
    /** 1..ceiling; values < 1 are treated as 1. */
    concurrency: number;
    signal?: AbortSignal;
    /**
     * V0.5.2: fired once per item, AFTER it settles, with a running count.
     *
     * Exists so a long survey can report progress (MCP notifications/progress)
     * without every caller re-implementing the bookkeeping. It is strictly
     * observational: a throwing callback is swallowed, so a broken progress
     * reporter can never fail the work it is reporting on.
     */
    onSettled?: (done: number, total: number, item: T) => void;
}
/**
 * Map `items` through `worker` with bounded concurrency, preserving input
 * order. `worker` is expected to resolve to a per-item value (including a
 * per-item error value) — a thrown error rejects the whole call, so callers
 * that want per-item isolation must catch inside the worker.
 */
export declare function mapWithConcurrency<T, R>(items: readonly T[], worker: (item: T, index: number) => Promise<R>, options: MapOptions<T>): Promise<R[]>;
/**
 * V0.4.1 session-pool gate: at most `size` concurrent holders. Used to cap
 * simultaneous bastion sessions independent of how many batches run.
 */
export declare class Semaphore {
    private available;
    private readonly waiters;
    constructor(size: number);
    get capacity(): number;
    acquire(): Promise<() => void>;
    private releaser;
}

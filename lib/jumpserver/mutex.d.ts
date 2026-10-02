/** Single-session serial queue: connect/enter/exec/leave all run one at a time. */
export declare class SessionMutex {
    private tail;
    /**
     * Enqueue fn behind every previous operation. If signal aborts while
     * WAITING for the queue, the queued call is dropped (never executed).
     */
    run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

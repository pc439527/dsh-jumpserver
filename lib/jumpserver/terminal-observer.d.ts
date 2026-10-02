import { SessionState } from './state-machine.js';
export type TerminalEventType = 'input' | 'output' | 'state' | 'target' | 'error';
export type TerminalVisibility = 'terminal' | 'internal';
export interface TerminalEventBase {
    seq: number;
    timestamp: number;
}
export interface TerminalInputEvent extends TerminalEventBase {
    type: 'input';
    /** Redacted form of what the connector wrote to the PTY. */
    data: string;
    visibility?: TerminalVisibility;
}
export interface TerminalOutputEvent extends TerminalEventBase {
    type: 'output';
    /** Redacted PTY chunk (ANSI retained; UTF-8 decoded). */
    data: string;
    visibility?: TerminalVisibility;
}
export interface TerminalStateEvent extends TerminalEventBase {
    type: 'state';
    state: SessionState;
    prev: SessionState | null;
}
export interface TerminalTargetEvent extends TerminalEventBase {
    type: 'target';
    target: string;
    hostname: string | null;
    user: string | null;
    pwd: string | null;
}
export interface TerminalErrorEvent extends TerminalEventBase {
    type: 'error';
    message: string;
}
export type TerminalEvent = TerminalInputEvent | TerminalOutputEvent | TerminalStateEvent | TerminalTargetEvent | TerminalErrorEvent;
export type TerminalNewEvent = {
    type: 'input';
    data: string;
    visibility?: TerminalVisibility;
} | {
    type: 'output';
    data: string;
    visibility?: TerminalVisibility;
} | {
    type: 'state';
    state: SessionState;
    prev: SessionState | null;
} | {
    type: 'target';
    target: string;
    hostname: string | null;
    user: string | null;
    pwd: string | null;
} | {
    type: 'error';
    message: string;
};
/** Bounded ring buffer of terminal events with monotonic seq. */
export declare class TerminalRingBuffer {
    private readonly maxOutputBytes;
    private events;
    private cursor;
    private outputBytes;
    private maxEvents;
    constructor(maxEvents?: number, maxOutputBytes?: number);
    /** Re-budget on live settings change; trims oldest events when smaller. */
    setScrollbackRows(rows: number): void;
    /** Append one event; drops oldest events to respect the caps. */
    push(event: TerminalNewEvent): TerminalEvent;
    snapshotSince(sinceSeq: number): TerminalEvent[];
    snapshot(): TerminalEvent[];
    get cursorSeq(): number;
    get size(): number;
    get oldestSeq(): number;
    clear(): void;
}
/** Emitting facade the session manager hands the bridge. */
export declare class TerminalObserver {
    private scrollbackRows;
    private buffer;
    private internalCaptureDepth;
    constructor(scrollbackRows?: number);
    /**
     * Mark subsequently recorded PTY input/output as Host-internal while a
     * structured operation consumes the same stream. Nested callers are safe.
     * The returned disposer is idempotent and must be used in finally blocks.
     */
    beginInternalCapture(): () => void;
    private get visibility();
    /**
     * Resolvers waiting for new terminal events.
     *
     * The console long-polls for output, and the server used to satisfy that by
     * re-reading the cursor every 150ms. That woke the timer even for a console
     * that was simply sitting there, multiplied by every request the page had
     * overlapping. Waking the exact waiters on push removes that timer traffic
     * entirely: an idle console now costs one pending promise and no polling.
     */
    private waiters;
    private pushEvent;
    /**
     * Resolve once the cursor passes `sinceSeq`, or when the abort signal fires.
     *
     * Returns true when new events are (or already were) available, so the caller
     * can decide between draining immediately and waiting.
     */
    waitForChange(sinceSeq: number, signal: AbortSignal, timeoutMs: number): Promise<boolean>;
    recordInput(data: string): void;
    recordOutput(data: string): void;
    recordState(state: SessionState, prev: SessionState | null): void;
    recordTarget(target: string, hostname: string | null, user: string | null, pwd: string | null): void;
    recordError(message: string): void;
    snapshotSince(sinceSeq: number): TerminalEvent[];
    snapshot(): TerminalEvent[];
    get cursorSeq(): number;
    get oldestSeq(): number;
    clear(): void;
    get scrollback(): number;
    setScrollbackRows(rows: number): void;
}
export interface TerminalSnapshotMeta {
    lastSeq: number;
    state: string;
    connected: boolean;
    gateway: string;
    target: string | null;
    hostname: string | null;
    user: string | null;
    permissionMode: string;
    enabled: boolean;
    configured: boolean;
}

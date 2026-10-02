/**
 * TerminalObserver: capture everything the JumpServer PTY session shows as a
 * monotonic seq-ordered event stream backed by a bounded ring buffer.
 *
 * SECURITY: browser-visible input/output is redacted BEFORE it enters this
 * buffer. The real PTY still receives the original command; the observer is a
 * display/audit surface and must never retain command-line credentials.
 *
 * Some Host operations (notably KoKo `p` asset discovery) must still consume
 * the exact PTY bytes for parsing while keeping that implementation detail out
 * of the human terminal. Those events are retained with visibility=internal;
 * the browser bridge omits them while Host-side parsers can still read them.
 */
import { MAX_TERMINAL_BYTES } from '../config/types.js';
import { redactCommandSecrets } from '../security/command-redaction.js';
/** Bounded ring buffer of terminal events with monotonic seq. */
export class TerminalRingBuffer {
    maxOutputBytes;
    events = [];
    cursor = 0;
    outputBytes = 0;
    maxEvents;
    constructor(maxEvents = 20000, maxOutputBytes = MAX_TERMINAL_BYTES) {
        this.maxOutputBytes = maxOutputBytes;
        this.maxEvents = maxEvents;
    }
    /** Re-budget on live settings change; trims oldest events when smaller. */
    setScrollbackRows(rows) {
        const next = Math.max(1000, Math.min(200000, Math.round(rows) * 4));
        if (next === this.maxEvents)
            return;
        this.maxEvents = next;
        while (this.events.length > this.maxEvents) {
            const head = this.events[0];
            if (head.type === 'output')
                this.outputBytes -= Buffer.byteLength(head.data, 'utf8');
            this.events.shift();
        }
    }
    /** Append one event; drops oldest events to respect the caps. */
    push(event) {
        const seq = ++this.cursor;
        const full = { ...event, seq, timestamp: Date.now() };
        this.events.push(full);
        if (event.type === 'output') {
            this.outputBytes += Buffer.byteLength(event.data, 'utf8');
        }
        while (this.outputBytes > this.maxOutputBytes && this.events.length > 0) {
            const head = this.events[0];
            if (head.type === 'output')
                this.outputBytes -= Buffer.byteLength(head.data, 'utf8');
            this.events.shift();
        }
        while (this.events.length > this.maxEvents) {
            const head = this.events[0];
            if (head.type === 'output')
                this.outputBytes -= Buffer.byteLength(head.data, 'utf8');
            this.events.shift();
        }
        return full;
    }
    snapshotSince(sinceSeq) {
        if (sinceSeq < 0)
            sinceSeq = 0;
        if (this.events.length === 0 || sinceSeq >= this.cursor)
            return [];
        return this.events.filter((e) => e.seq > sinceSeq);
    }
    snapshot() {
        return [...this.events];
    }
    get cursorSeq() {
        return this.cursor;
    }
    get size() {
        return this.events.length;
    }
    get oldestSeq() {
        return this.events.length > 0 ? this.events[0].seq : 0;
    }
    clear() {
        this.events = [];
        this.outputBytes = 0;
    }
}
/** Emitting facade the session manager hands the bridge. */
export class TerminalObserver {
    scrollbackRows;
    buffer = new TerminalRingBuffer();
    internalCaptureDepth = 0;
    constructor(scrollbackRows = 5000) {
        this.scrollbackRows = scrollbackRows;
    }
    /**
     * Mark subsequently recorded PTY input/output as Host-internal while a
     * structured operation consumes the same stream. Nested callers are safe.
     * The returned disposer is idempotent and must be used in finally blocks.
     */
    beginInternalCapture() {
        this.internalCaptureDepth += 1;
        let ended = false;
        return () => {
            if (ended)
                return;
            ended = true;
            this.internalCaptureDepth = Math.max(0, this.internalCaptureDepth - 1);
        };
    }
    get visibility() {
        return this.internalCaptureDepth > 0 ? 'internal' : 'terminal';
    }
    /**
     * Resolvers waiting for new terminal events.
     *
     * The console long-polls for output, and the server used to satisfy that by
     * re-reading the cursor every 150ms. That woke the timer even for a console
     * that was simply sitting there, multiplied by every request the page had
     * overlapping. Waking the exact waiters on push removes that timer traffic
     * entirely: an idle console now costs one pending promise and no polling.
     */
    waiters = new Set();
    pushEvent(event) {
        this.buffer.push(event);
        // Copy first: a resolver may call waitForChange again synchronously.
        const waiting = [...this.waiters];
        this.waiters.clear();
        for (const resolve of waiting)
            resolve(true);
    }
    /**
     * Resolve once the cursor passes `sinceSeq`, or when the abort signal fires.
     *
     * Returns true when new events are (or already were) available, so the caller
     * can decide between draining immediately and waiting.
     */
    waitForChange(sinceSeq, signal, timeoutMs) {
        if (this.buffer.cursorSeq > sinceSeq)
            return Promise.resolve(true);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled)
                    return;
                settled = true;
                this.waiters.delete(finish);
                signal.removeEventListener('abort', onAbort);
                clearTimeout(timer);
                resolve(value);
            };
            const onAbort = () => finish(false);
            const timer = setTimeout(() => finish(false), Math.max(1, timeoutMs));
            signal.addEventListener('abort', onAbort, { once: true });
            this.waiters.add(finish);
            // The cursor may have moved between the check above and this line.
            if (this.buffer.cursorSeq > sinceSeq)
                finish(true);
        });
    }
    recordInput(data) {
        const safe = redactCommandSecrets(data);
        this.pushEvent({ type: 'input', data: safe, visibility: this.visibility });
    }
    recordOutput(data) {
        if (data.length === 0)
            return;
        // PTYs normally echo the command. Redacting raw output as well prevents a
        // secret from reappearing through that echo or through diagnostic logs.
        const safe = redactCommandSecrets(data);
        this.pushEvent({ type: 'output', data: safe, visibility: this.visibility });
    }
    recordState(state, prev) {
        this.pushEvent({ type: 'state', state, prev });
    }
    recordTarget(target, hostname, user, pwd) {
        this.pushEvent({ type: 'target', target, hostname, user, pwd });
    }
    recordError(message) {
        this.pushEvent({ type: 'error', message: redactCommandSecrets(message) });
    }
    snapshotSince(sinceSeq) {
        return this.buffer.snapshotSince(sinceSeq);
    }
    snapshot() {
        return this.buffer.snapshot();
    }
    get cursorSeq() {
        return this.buffer.cursorSeq;
    }
    get oldestSeq() {
        return this.buffer.oldestSeq;
    }
    clear() {
        this.buffer.clear();
    }
    get scrollback() {
        return this.scrollbackRows;
    }
    setScrollbackRows(rows) {
        const effective = Math.max(200, rows);
        this.scrollbackRows = effective;
        this.buffer.setScrollbackRows(effective);
    }
}

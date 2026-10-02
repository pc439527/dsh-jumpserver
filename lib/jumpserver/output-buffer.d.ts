/** Normalize CRLF/CR to LF. */
export declare function normalizeNewlines(text: string): string;
/** Strip ANSI escapes then normalize newlines. */
export declare function cleanAnsi(text: string): string;
/** Bounded line-buffer for one operation's captured stdout (1 MiB cap). */
export declare class OutputBuffer {
    private readonly limit;
    private chunks;
    private total;
    truncated: boolean;
    constructor(limit: number);
    push(chunk: string): void;
    peek(): string;
    take(): {
        text: string;
        truncated: boolean;
    };
    clear(): void;
    get size(): number;
}
/**
 * Waits for a marker pattern across arbitrarily fragmented data chunks.
 * Matching is incremental on a bounded tail; once matched it stays matched
 * until reset. Feed the SAME chunks through buffer.push() to capture output.
 */
export declare class MarkerWatcher {
    private readonly marker;
    private tail;
    private done;
    readonly buffer: OutputBuffer;
    constructor(marker: string, limit: number);
    /** Feed one raw chunk; returns true on the tick the marker becomes visible. */
    push(chunk: string): boolean;
    matched(): boolean;
    reset(): void;
}
/** Remove every line that contains needle (our own markers) from text. */
export declare function stripMarkerLines(text: string, needle: string): string;

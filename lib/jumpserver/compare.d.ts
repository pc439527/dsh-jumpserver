import type { SessionManager } from './session-manager.js';
export declare const MAX_COMPARE_TARGETS = 20;
export interface CompareOptions {
    targets: string[];
    /** Exactly one of command / profile must be provided. */
    command?: string;
    profile?: string;
    /** Drop blank lines before diffing (default true). */
    ignoreBlank?: boolean;
    /** Ignore whitespace-only differences inside a line (default true). */
    normalizeWhitespace?: boolean;
    /** Line prefixes to strip before diffing (e.g. hostname noise). */
    stripPrefixes?: string[];
    signal?: AbortSignal;
    toolCallId?: string;
    batchId?: string;
    concurrency?: number;
    /** V0.5.2: called as each target settles, for MCP progress reporting. */
    onTarget?: (done: number, total: number, target: string) => void;
    /** V0.5.3: 0-based accountIndex per target for the KoKo `ID>` prompt. */
    accountByTarget?: Record<string, number>;
}
export interface CompareTarget {
    target: string;
    hostname: string | null;
    ok: boolean;
    exitCode: number | null;
    error: {
        code: string;
        message: string;
    } | null;
    durationMs: number;
    /** Normalized lines actually compared (post filtering). */
    lines: string[];
    truncated: boolean;
}
export interface CompareGroup {
    /** The exact set of lines shared by every OK target. */
    signature: string[];
    /** Per-target deviation from the majority signature. */
    outliers: Array<{
        target: string;
        missing: string[];
        extra: string[];
    }>;
}
export interface CompareResult {
    mode: 'command' | 'profile';
    source: string;
    /** Extra commands when mode === profile. */
    commands: string[];
    targets: number;
    succeeded: number;
    failed: number;
    /** How many DISTINCT line-sets were observed (1 == all identical). */
    distinct: number;
    groups: CompareGroup[];
    results: CompareTarget[];
    durationMs: number;
    warnings: string[];
}
/** Normalize one output block into comparable lines. */
export declare function normalizeLines(text: string, options?: {
    ignoreBlank?: boolean;
    normalizeWhitespace?: boolean;
    stripPrefixes?: string[];
}): string[];
/**
 * Group targets by their exact (order-insensitive) MULTISET of lines and pick
 * the majority set as the signature.
 *
 * V0.4.3: this used to key on the unique line set, so a target with 12
 * duplicate warnings and one with a single warning were declared IDENTICAL —
 * the exact difference an ops comparison exists to surface. The key is now a
 * count-aware multiset (line × occurrences, sorted), and a target whose line
 * counts differ is reported as an outlier.
 */
export declare function groupBySignature(targets: CompareTarget[]): {
    distinct: number;
    groups: CompareGroup[];
};
export declare function compareTargets(manager: SessionManager, getConfig: () => {
    allowedTargets?: string[];
    deniedTargets?: string[];
}, options: CompareOptions): Promise<CompareResult>;

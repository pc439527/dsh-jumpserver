import type { CommandRisk } from '../config/types.js';
/**
 * V0.3.1 command classifier (version 2).
 *
 * Risk model (single fact source for gating, approval copy and audit):
 *   READ             - CONFIRMED read-only (a semantic rule matched)
 *   PRIVILEGED_READ  - CONFIRMED read-only, needs sudo/root (sudo cat ...)
 *   UNKNOWN          - the classifier has NO semantic rule; the command is
 *                      NOT claimed to modify anything ("无法确认只读", not
 *                      "检测到修改")
 *   MODIFY           - CONFIRMED state change (mutating verb / write redirect)
 *   DANGEROUS        - host-destructive / irreversible
 *
 * Pipeline (per command):
 *   1. whole-command DANGEROUS phrases            -> DANGEROUS
 *   2. opaque shell syntax ($(..), \`..\`, bash -c, python -c ...) -> UNKNOWN
 *      (not analyzable => never claimed read-only, never claimed modifying)
 *   3. whole-command CONFIRMED mutation (mutating verbs, in-place sed,
 *      write redirection, verb-scoped service/package rules) -> MODIFY
 *   4. per-segment semantic classification        -> READ / PRIVILEGED_READ /
 *                                                    UNKNOWN (worst wins)
 * Wrapping (env/timeout/nice, any depth) and sudo NEVER downgrade the inner
 * command's risk: the inner command goes through the SAME full pipeline.
 */
export declare const CLASSIFIER_VERSION = 3;
export type Confidence = 'HIGH' | 'LOW';
export interface Classification {
    risk: CommandRisk;
    /** Human-readable why (also lands in the audit and approval copy). */
    reason: string;
    /** Semantic rule id, e.g. 'systemctl.status' / 'docker.compose.up' / 'unknown.command'. */
    ruleId: string;
    confidence: Confidence;
    /** The exact command as classified. */
    command: string;
    /** Whitespace-collapsed command (audit/normalization). */
    normalizedCommand: string;
    classifierVersion: number;
}
/**
 * Read-only FD redirections must NOT be classified as file writes.
 * Allowed (return null): 2>&1, 1>&2, 2>/dev/null, 2>>/dev/null, >/dev/null.
 * Still MODIFY (return the target): "> file", ">> app.log", ">&file", "command >".
 * Quoted regions are masked first, so 'echo "> x"' stays data.
 */
export declare function hasFileWriteRedirection(command: string): string | null;
export declare function canonicalExecutable(token: string): string | undefined;
/** Split on ; && || | at quote/escape boundaries (quoted pipes stay intact). */
export declare function splitSegments(command: string): string[];
/** Main entry: full pipeline over the whole command. */
export declare function classifyCommand(command: string): Classification;
/**
 * Strict READ_ONLY gate: only plain READ passes; PRIVILEGED_READ / UNKNOWN /
 * MODIFY / DANGEROUS are blocked. (The permission matrix additionally decides
 * whether PRIVILEGED_READ may run in READ_ONLY via privilegedReadInReadOnly.)
 */
export declare function isReadOnlyAllowed(command: string): {
    allowed: boolean;
    reason?: string;
};
/**
 * Backward-compatible one-segment classifier (wrapper recursion + sudo aware).
 * Returns the classic risk letters; UNKNOWN is returned for unrecognized
 * segments.
 */
export declare function readClassifySegment(segment: string): CommandRisk;

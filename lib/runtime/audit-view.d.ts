/**
 * Audit row presentation helpers shared by the DSH Desktop settings surfaces and
 * the loopback console. Pure functions only: no React, no DOM, no transport, so
 * the refusal/failure semantics stay testable without a browser.
 */
/**
 * Storage is always UTC; only display follows the configured zone.
 *
 * This module hardcoded Asia/Shanghai, so every surface showed UTC+8 regardless
 * of the operator's setting. The zone is a parameter now, and runtime/time.ts is
 * the single source for resolving it.
 */
export declare function formatAuditTime(value: unknown, timeZone: string): string;
export declare function auditEventType(record: Record<string, unknown>): string;
export declare function auditEventLabel(record: Record<string, unknown>): string;
/** A refusal is the policy working, not a crash — never render it red. */
export declare function auditRefused(record: Record<string, unknown>): boolean;
/** Why a refused command was refused (the gate's own reason). */
export declare function auditRefusalLabel(record: Record<string, unknown>): string;
export declare function auditFailed(record: Record<string, unknown>): boolean;

import type { CommandRisk, PermissionMode } from '../config/types.js';
import { type Classification } from './command-classifier.js';
export type GateDecision = {
    kind: 'allow';
} | {
    kind: 'deny';
    code: 'COMMAND_BLOCKED' | 'COMMAND_APPROVAL_REQUIRED';
    reason: string;
};
/**
 * Authoritative classifier used by permission gates.
 *
 * Order is deliberate: a database CLI with a verified non-interactive query
 * form (mysql `-e`, HANA `hdbsql` positional) is classified BEFORE the generic
 * shell classifier, which would otherwise report every one of them as UNKNOWN.
 * Unknown or ambiguous SQL remains fail-closed.
 */
export declare function classifyCommand(command: string): Classification;
export declare function isReadOnlyAllowed(command: string): {
    allowed: boolean;
    reason?: string;
};
/**
 * V0.3.1 permission matrix (single fact source for Agent tools AND the manual
 * FOLLOW_AGENT policy):
 *
 *   risk             | READ_ONLY          | AUTO                | FULL_ACCESS
 *   -----------------|--------------------|---------------------|---------------
 *   READ             | allow              | allow               | allow
 *   PRIVILEGED_READ  | allow if configured| allow               | allow
 *   UNKNOWN          | deny (block)       | approval            | approval
 *   MODIFY           | deny (block)       | approval            | allow
 *   DANGEROUS        | deny (block)       | approval            | approval
 *
 * UNKNOWN is NEVER presented as MODIFY: it is blocked/approval-gated with the
 * honest copy "read-only cannot be confirmed".
 */
export declare function gateDecision(risk: CommandRisk, mode: PermissionMode, options?: {
    privilegedReadInReadOnly?: boolean;
}): GateDecision;
export type { Classification };
export interface TargetVerification {
    state: string;
    currentTarget: string | null;
    currentHostname: string | null;
}
/**
 * Mandatory safety rule (requirement 21): before any MODIFY/DANGEROUS/UNKNOWN
 * command reaches the wire, the current target must be verified. Unverified
 * target = refuse, no approval prompt.
 */
export declare function requireTargetVerified(verification: TargetVerification): void;

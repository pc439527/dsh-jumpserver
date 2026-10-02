import { classifyCommand as classifyBaseCommand } from './command-classifier.js';
import { classifyHanaCli, classifyMysqlCli } from './sql-command-classifier.js';
import { JumpServerError } from '../jumpserver/errors.js';
/**
 * Authoritative classifier used by permission gates.
 *
 * Order is deliberate: a database CLI with a verified non-interactive query
 * form (mysql `-e`, HANA `hdbsql` positional) is classified BEFORE the generic
 * shell classifier, which would otherwise report every one of them as UNKNOWN.
 * Unknown or ambiguous SQL remains fail-closed.
 */
export function classifyCommand(command) {
    return classifyMysqlCli(command) ?? classifyHanaCli(command) ?? classifyBaseCommand(command);
}
export function isReadOnlyAllowed(command) {
    const classification = classifyCommand(command);
    if (classification.risk === 'READ')
        return { allowed: true };
    return { allowed: false, reason: classification.reason || 'not a confirmed read-only command' };
}
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
export function gateDecision(risk, mode, options = {}) {
    switch (mode) {
        case 'READ_ONLY':
            if (risk === 'READ')
                return { kind: 'allow' };
            if (risk === 'PRIVILEGED_READ' && options.privilegedReadInReadOnly === true)
                return { kind: 'allow' };
            return { kind: 'deny', code: 'COMMAND_BLOCKED', reason: 'blocked by READ_ONLY permission mode' };
        case 'AUTO':
            if (risk === 'READ' || risk === 'PRIVILEGED_READ')
                return { kind: 'allow' };
            return { kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED', reason: 'approval required in AUTO mode' };
        case 'FULL_ACCESS':
            if (risk === 'UNKNOWN' || risk === 'DANGEROUS') {
                return { kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED', reason: 'approval required even in FULL_ACCESS' };
            }
            return { kind: 'allow' };
    }
}
/**
 * Mandatory safety rule (requirement 21): before any MODIFY/DANGEROUS/UNKNOWN
 * command reaches the wire, the current target must be verified. Unverified
 * target = refuse, no approval prompt.
 */
export function requireTargetVerified(verification) {
    if (verification.state !== 'ASSET_SHELL' || verification.currentTarget === null || verification.currentHostname === null) {
        throw new JumpServerError('TARGET_VERIFICATION_FAILED', 'Target verification failed. Remote modification was not executed.');
    }
}

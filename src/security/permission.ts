import type { CommandRisk, PermissionMode } from '../config/types.js'
import { classifyCommand, isReadOnlyAllowed, type Classification } from './command-classifier.js'
import { JumpServerError } from '../jumpserver/errors.js'

export type GateDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; code: 'COMMAND_BLOCKED' | 'COMMAND_APPROVAL_REQUIRED'; reason: string }

/** Permission matrix (V0.1). */
export function gateDecision(risk: CommandRisk, mode: PermissionMode): GateDecision {
  switch (mode) {
    case 'READ_ONLY':
      return risk === 'READ'
        ? { kind: 'allow' }
        : { kind: 'deny', code: 'COMMAND_BLOCKED', reason: 'blocked by READ_ONLY permission mode' }
    case 'AUTO':
      return risk === 'READ' || risk === 'LOW'
        ? { kind: 'allow' }
        : { kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED', reason: 'approval required in AUTO mode' }
    case 'FULL_ACCESS':
      return risk === 'DANGEROUS'
        ? { kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED', reason: 'approval required even in FULL_ACCESS' }
        : { kind: 'allow' }
  }
}

export { classifyCommand, isReadOnlyAllowed }
export type { Classification }

export interface TargetVerification {
  state: string
  currentTarget: string | null
  currentHostname: string | null
}

/**
 * Mandatory safety rule (requirement 21): before any MODIFY/DANGEROUS command
 * reaches the wire, the current target must be verified. Unverified target =
 * refuse, no approval prompt.
 */
export function requireTargetVerified(verification: TargetVerification): void {
  if (verification.state !== 'ASSET_SHELL' || verification.currentTarget === null || verification.currentHostname === null) {
    throw new JumpServerError(
      'TARGET_VERIFICATION_FAILED',
      'Target verification failed. Remote modification was not executed.',
    )
  }
}

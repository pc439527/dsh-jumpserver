/**
 * V0.2.7: manual sidebar terminal input policy + state-aware menu parsing.
 *
 * The browser human terminal does not write raw PTY bytes: it routes typed
 * input through these deciders, and the Host bridge executes the resulting
 * SessionManager action. At the JumpServer menu only menu verbs are legal
 * (p / IP-or-name / q); inside an asset shell 'exit' maps to leave() and
 * every other command is gated by manualPermissionMode.
 */
import { classifyCommand, type Classification } from './command-classifier.js'
import { gateDecision } from './permission.js'
import type { ManualPolicy, PermissionMode } from '../config/types.js'

export type ManualGate =
  | { kind: 'allow' }
  | { kind: 'confirm'; risk: string }
  | { kind: 'block'; reason: string }

/**
 * Decision for one manual shell command under the configured manual policy.
 * confirmed=true means the user already acknowledged a modify prompt for this
 * exact call (ephemeral, per request — never cached/armed).
 */
export function manualGate(
  risk: string,
  policy: ManualPolicy,
  agentMode: PermissionMode,
  confirmed: boolean,
): ManualGate {
  switch (policy) {
    case 'FULL_ACCESS':
      return { kind: 'allow' }
    case 'FOLLOW_AGENT': {
      const decision = gateDecision(risk as 'READ' | 'LOW' | 'MODIFY' | 'DANGEROUS', agentMode)
      if (decision.kind === 'allow') return { kind: 'allow' }
      // V0.3.1: an APPROVAL-REQUIRED decision becomes the same human confirm
      // dialog CONFIRM_MODIFY uses (the Agent tool path prompts the model via
      // the approval channel; the human path prompts the user here). Only a
      // hard READ_ONLY block stays final.
      if (decision.code === 'COMMAND_APPROVAL_REQUIRED') {
        if (!confirmed) return { kind: 'confirm', risk }
        return { kind: 'allow' }
      }
      return { kind: 'block', reason: 'blocked by manual FOLLOW_AGENT (' + agentMode + '): ' + decision.reason }
    }
    case 'CONFIRM_MODIFY':
    default:
      if (risk === 'READ' || risk === 'LOW') return { kind: 'allow' }
      if (!confirmed) return { kind: 'confirm', risk }
      return { kind: 'allow' }
  }
}

export type MenuManualKind = 'p' | 'q' | 'enter' | null

/** Interpret a typed line while the session is at the JumpServer menu. */
export function menuManualKind(command: string): MenuManualKind {
  const trimmed = command.trim()
  if (trimmed.length === 0) return null
  if (trimmed.toLowerCase() === 'p') return 'p'
  if (trimmed.toLowerCase() === 'q' || trimmed.toLowerCase() === 'quit' || trimmed === '退出') return 'q'
  if (/^[a-zA-Z0-9_.:/-]+$/.test(trimmed) && !/^-/.test(trimmed)) return 'enter'
  return null
}

/** Classify a manual shell command (exported so the bridge can audit the risk). */
export function classifyManual(command: string): Classification {
  return classifyCommand(command)
}

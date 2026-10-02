/**
 * V0.2.7: manual sidebar terminal input policy + state-aware menu parsing.
 *
 * The browser human terminal does not write raw PTY bytes: it routes typed
 * input through these deciders, and the Host bridge executes the resulting
 * SessionManager action. At the JumpServer menu only menu verbs are legal
 * (p / IP-or-name / q); inside an asset shell 'exit' maps to leave() and
 * every other command is gated by manualPermissionMode.
 *
 * V0.3.1: risk classes are READ / PRIVILEGED_READ / UNKNOWN / MODIFY /
 * DANGEROUS. CONFIRM_MODIFY lets confirmed reads pass; UNKNOWN is NOT a read
 * and asks the user with honest copy (never "该命令会修改服务器").
 */
import { type Classification } from './permission.js';
import type { ManualPolicy, PermissionMode } from '../config/types.js';
export type ManualGate = {
    kind: 'allow';
} | {
    kind: 'confirm';
    risk: string;
} | {
    kind: 'block';
    reason: string;
};
/**
 * Decision for one manual shell command under the configured manual policy.
 * confirmed=true means the user already acknowledged a modify prompt for this
 * exact call (ephemeral, per request — never cached/armed).
 */
export declare function manualGate(risk: string, policy: ManualPolicy, agentMode: PermissionMode, confirmed: boolean, options?: {
    privilegedReadInReadOnly?: boolean;
}): ManualGate;
export type MenuManualKind = 'p' | 'q' | 'enter' | null;
/** Interpret a typed line while the session is at the JumpServer menu. */
export declare function menuManualKind(command: string): MenuManualKind;
/** Classify a manual shell command (exported so the bridge can audit the risk). */
export declare function classifyManual(command: string): Classification;

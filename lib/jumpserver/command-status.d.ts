/**
 * V0.4.5: ONE mapping from `commandStatus` to a structured error.
 *
 * `commandStatus` is produced by the session layer (session.ts ExecOutcome) and
 * travels through exec / batch / runbook / compare / inspect. Before V0.4.5
 * every consumer invented its own error:
 *
 *   exec    -> COMMAND_EXIT_NONZERO / COMMAND_TIMEOUT / CONNECTION_LOST
 *   compare -> COMMAND_EXIT_NONZERO for EVERYTHING (TIMEOUT, CONNECTION_LOST,
 *              UNKNOWN all masqueraded as a non-zero exit), so a caller that
 *              switched on the code could not tell a wedged shell from a
 *              missing binary.
 *
 * Having one function means a status can never be decoded two different ways.
 */
/** Every commandStatus value the session layer may emit. */
export type CommandStatus = 'SUCCESS' | 'EXIT_NONZERO' | 'TIMEOUT' | 'INTERRUPTED' | 'CONNECTION_LOST' | 'UNKNOWN';
export interface CommandFailure {
    code: string;
    message: string;
}
/** True when the status means "the command did not succeed". */
export declare function isCommandFailure(commandStatus: string): boolean;
/**
 * Decode a commandStatus into a structured error, or null for SUCCESS.
 * Never throws for an unknown status — a future status string degrades to
 * COMMAND_STATUS_UNKNOWN instead of being silently reported as a success.
 */
export declare function commandStatusToError(commandStatus: string, detail?: {
    exitCode?: number | null;
    executionState?: string | null;
}): CommandFailure | null;

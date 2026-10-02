/**
 * Structured error codes for the JumpServer connector (V0.1).
 * DSH-independent: the tool layer maps these onto HarnessError codes.
 */
export declare const JUMP_ERROR_CODES: readonly ["NOT_CONFIGURED", "DISABLED", "AUTH_FAILED", "CONNECTION_TIMEOUT", "CONNECTION_LOST", "NOT_AT_MENU", "MENU_NOT_DETECTED", "ASSET_ENTER_TIMEOUT", "ASSET_NOT_FOUND", "ASSET_VERIFY_FAILED", "NOT_IN_ASSET", "COMMAND_TIMEOUT", "COMMAND_BLOCKED", "COMMAND_APPROVAL_REQUIRED", "COMMAND_STATE_UNKNOWN", "LEAVE_TIMEOUT", "MENU_RETURN_FAILED", "SESSION_BUSY", "UNKNOWN_STATE", "TARGET_VERIFICATION_FAILED", "INVALID_GROUP", "TARGET_DENIED", "NOTHING_TO_INTERRUPT", "TOO_MANY_TARGETS", "PROFILE_RISK_MISMATCH", "UNKNOWN_RUNBOOK", "RUNBOOK_NO_READ_STEPS", "UNKNOWN_BASELINE", "BASELINE_MISMATCH", "INVALID_ARGUMENT", "HOST_KEY_MISMATCH", "ACCOUNT_SELECTION_REQUIRED", "ASSET_UNREACHABLE", "ACCOUNT_SELECTION_EXPIRED"];
export type JumpServerErrorCode = (typeof JUMP_ERROR_CODES)[number];
export declare class JumpServerError extends Error {
    readonly code: JumpServerErrorCode;
    readonly detail?: string;
    constructor(code: JumpServerErrorCode, message?: string, detail?: string);
}
export declare function isJumpServerError(e: unknown): e is JumpServerError;
/** Caller/transport cancellation surfaced inside session loops; the tool layer maps it to TOOL_ABORTED. */
export declare class AbortRequestedError extends Error {
    constructor();
}
/**
 * V0.5.5: the STOP wording for ASSET_UNREACHABLE. It lives here (not in the
 * runtime layer) because every renderer needs it — the single-result
 * projection in tools-common AND the hand-written multi-target renderers in
 * inspector / runbook / compare. Without one shared string the batch tools
 * silently lose the sentence that stops the retry loop.
 *
 * Measured on a real conversation: after one `网络不通（连接超时）` banner the
 * model ran eight more enter/connect cycles (2m53s) because nothing in the
 * result said "this will not get better by retrying". Every retry also costs
 * the bastion's own dial timeout (~15 s) before it can even fail again.
 */
export declare const UNREACHABLE_STOP_LINE: string;
/**
 * V0.5.9: the one-line reason written to the audit when a command was stopped
 * because approval was not granted. Shared so the gate (exec path) and the
 * manager (run / batch / job paths) record the SAME wording — an audit where
 * the reason depends on which path refused is worse than no reason at all.
 */
export declare const APPROVAL_DENIED_REASON = "\u672A\u83B7\u4EBA\u5DE5\u6279\u51C6\uFF08confirm \u672A\u63D0\u4F9B\u6216\u672A\u540C\u610F\uFF09";
/** Lines for a nested `{code,message,detail?}` failure (SessionManager.errorDetail shape). */
export declare function renderFailureLines(error: {
    code: string;
    message: string;
    detail?: string;
} | null, indent?: string): string[];
export declare function errorCodeOf(e: unknown): string;

/** Session state machine (V0.1). Illegal transitions collapse to UNKNOWN - never guess. */
export declare enum SessionState {
    DISCONNECTED = "DISCONNECTED",
    CONNECTING = "CONNECTING",
    JUMPSERVER_MENU = "JUMPSERVER_MENU",
    ENTERING_ASSET = "ENTERING_ASSET",
    ASSET_SHELL = "ASSET_SHELL",
    COMMAND_RUNNING = "COMMAND_RUNNING",
    UNKNOWN = "UNKNOWN",
    ERROR = "ERROR"
}
/** Legal transitions. Use nextState() so an illegal move becomes UNKNOWN. */
export declare const LEGAL_TRANSITIONS: Record<SessionState, ReadonlySet<SessionState>>;
export declare function canTransition(from: SessionState, to: SessionState): boolean;
/**
 * Resolve the target state for a requested move: the requested state when
 * legal; otherwise UNKNOWN (never the requested state).
 */
export declare function nextState(from: SessionState, to: SessionState): SessionState;

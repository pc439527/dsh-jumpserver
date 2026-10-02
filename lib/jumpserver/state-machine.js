/** Session state machine (V0.1). Illegal transitions collapse to UNKNOWN - never guess. */
export var SessionState;
(function (SessionState) {
    SessionState["DISCONNECTED"] = "DISCONNECTED";
    SessionState["CONNECTING"] = "CONNECTING";
    SessionState["JUMPSERVER_MENU"] = "JUMPSERVER_MENU";
    SessionState["ENTERING_ASSET"] = "ENTERING_ASSET";
    SessionState["ASSET_SHELL"] = "ASSET_SHELL";
    SessionState["COMMAND_RUNNING"] = "COMMAND_RUNNING";
    SessionState["UNKNOWN"] = "UNKNOWN";
    SessionState["ERROR"] = "ERROR";
})(SessionState || (SessionState = {}));
/** Legal transitions. Use nextState() so an illegal move becomes UNKNOWN. */
export const LEGAL_TRANSITIONS = {
    [SessionState.DISCONNECTED]: new Set([SessionState.CONNECTING]),
    [SessionState.CONNECTING]: new Set([SessionState.JUMPSERVER_MENU, SessionState.ERROR]),
    [SessionState.JUMPSERVER_MENU]: new Set([SessionState.ENTERING_ASSET, SessionState.DISCONNECTED]),
    // V0.5.5: ENTERING_ASSET is not a one-way door. KoKo bounces back to its own
    // menu prompt when it cannot dial the asset (`... error: 网络不通（连接超时）`
    // followed by `[Host]> `), and the transport can also die mid-dial. Both are
    // real screens/states, not illegal moves: without them a single unreachable
    // asset collapsed the session to UNKNOWN and forced a full reconnect before
    // the model could look at any other asset.
    [SessionState.ENTERING_ASSET]: new Set([
        SessionState.ASSET_SHELL,
        SessionState.JUMPSERVER_MENU,
        SessionState.DISCONNECTED,
        SessionState.UNKNOWN,
        SessionState.ERROR,
    ]),
    [SessionState.ASSET_SHELL]: new Set([
        SessionState.COMMAND_RUNNING,
        SessionState.JUMPSERVER_MENU,
        SessionState.UNKNOWN,
        SessionState.DISCONNECTED,
    ]),
    [SessionState.COMMAND_RUNNING]: new Set([SessionState.ASSET_SHELL, SessionState.UNKNOWN, SessionState.DISCONNECTED]),
    [SessionState.UNKNOWN]: new Set([SessionState.DISCONNECTED, SessionState.CONNECTING]),
    [SessionState.ERROR]: new Set([SessionState.DISCONNECTED]),
};
export function canTransition(from, to) {
    return LEGAL_TRANSITIONS[from]?.has(to) ?? false;
}
/**
 * Resolve the target state for a requested move: the requested state when
 * legal; otherwise UNKNOWN (never the requested state).
 */
export function nextState(from, to) {
    if (canTransition(from, to))
        return to;
    return SessionState.UNKNOWN;
}

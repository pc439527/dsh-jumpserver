/** Tool-level code returned while the conversation grant is locked. */
export const JUMPSERVER_NOT_ARMED = 'JUMPSERVER_NOT_ARMED';
export const NOT_ARMED_MESSAGE = 'JumpServer is locked for this conversation. Run the /jumpserver slash command ' +
    '(e.g. "/jumpserver check CPU/memory/disk of 203.0.113.99") to authorize one ' +
    'JumpServer task for this turn.';
/** Fallback hard cap for turn-scoped grants (the turn-settle relock is primary). */
export const DEFAULT_TURN_GRANT_TTL_MS = 30 * 60 * 1000;
export class SessionGrant {
    clock;
    grants = new Map();
    constructor(clock = Date.now) {
        this.clock = clock;
    }
    /**
     * Arm the grant for one conversation. `ttlMs` overrides the mode default;
     * 'turn' grants always carry a hard safety cap.
     */
    arm(sessionId, mode, ttlMs) {
        const now = this.clock();
        const expiresAt = ttlMs !== undefined
            ? now + ttlMs
            : mode === 'turn'
                ? now + DEFAULT_TURN_GRANT_TTL_MS
                : undefined;
        const state = { mode, armedAt: now, expiresAt };
        this.grants.set(sessionId, state);
        return state;
    }
    isGranted(sessionId) {
        const state = this.grants.get(sessionId);
        if (state === undefined)
            return false;
        const now = this.clock();
        if (state.expiresAt !== undefined && now >= state.expiresAt) {
            this.grants.delete(sessionId);
            return false;
        }
        return true;
    }
    modeOf(sessionId) {
        if (!this.isGranted(sessionId))
            return null;
        return this.grants.get(sessionId).mode;
    }
    revoke(sessionId) {
        this.grants.delete(sessionId);
    }
    revokeAll() {
        this.grants.clear();
    }
    sessionIds() {
        return [...this.grants.keys()].filter((id) => this.isGranted(id));
    }
}

/**
 * JumpServer Session Grant (V0.2.4 P0): the FIRST permission boundary.
 *
 * The plugin distinguishes two independent security controls:
 *
 *   1. Session Grant  — is THIS conversation explicitly authorized by the
 *      user (through the /jumpserver slash command) to use jumpserver_* at
 *      all? Tools refuse with JUMPSERVER_NOT_ARMED while locked.
 *   2. Agent Permission Mode — READ_ONLY / AUTO / FULL_ACCESS gating of the
 *      individual command risk (existing security/permission-gate.ts).
 *
 * LOCKED (default) -> /jumpserver <task> -> ARMED_FOR_TURN -> turn settles
 * -> LOCKED. Bare /jumpserver arms a persistent grant revoked by
 * /jumpserver off, by session teardown, or by plugin dispose. The grant is
 * keyed by the same conversation id the tools use (agent.session.header.id),
 * so a grant in one conversation never unlocks another.
 */
export type GrantMode = 'persistent' | 'turn';
export interface GrantState {
    readonly mode: GrantMode;
    readonly armedAt: number;
    /** Safety cap (ms since epoch); undefined = no expiry (revoked explicitly). */
    readonly expiresAt?: number;
}
/** Tool-level code returned while the conversation grant is locked. */
export declare const JUMPSERVER_NOT_ARMED = "JUMPSERVER_NOT_ARMED";
export declare const NOT_ARMED_MESSAGE: string;
/** Fallback hard cap for turn-scoped grants (the turn-settle relock is primary). */
export declare const DEFAULT_TURN_GRANT_TTL_MS: number;
export declare class SessionGrant {
    private readonly clock;
    private readonly grants;
    constructor(clock?: () => number);
    /**
     * Arm the grant for one conversation. `ttlMs` overrides the mode default;
     * 'turn' grants always carry a hard safety cap.
     */
    arm(sessionId: string, mode: GrantMode, ttlMs?: number): GrantState;
    isGranted(sessionId: string): boolean;
    modeOf(sessionId: string): GrantMode | null;
    revoke(sessionId: string): void;
    revokeAll(): void;
    sessionIds(): string[];
}

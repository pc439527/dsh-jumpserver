/**
 * SessionRegistry: the one-JumpServer-per-conversation table.
 *
 * Every bundle is keyed by the authoritative DSH conversation id
 * (`exec.agent.session.header.id` on the Host face, `scope.sessionId` on the
 * browser face):
 *
 *   - conversation A -> JumpServerSession A (asset 113.99)
 *   - conversation B -> JumpServerSession B (asset 79.100)
 *   - conversation C -> no session yet
 *
 * Bundles are lazily created, never shared across ids, and detached once
 * their manager is fully idle-disconnected for longer than the grace window.
 */
import type { SessionManager } from './session-manager.js';
import type { TerminalObserver } from './terminal-observer.js';
export interface SessionBundle {
    /** Conversation-dedicated manager (PTY/mutex/reconnect/currentTarget). */
    readonly manager: SessionManager;
    /** Conversation-dedicated terminal mirror stream. */
    readonly observer: TerminalObserver;
    /** Last meaningful use, for abandoned-bundle cleanup. */
    lastUsedAt: number;
}
export interface SessionRegistryOptions {
    create: (sessionId: string) => SessionBundle;
    now?: () => number;
    detachGraceMs?: number;
    /** V0.3.1 P2: called when a conversation bundle is detached — the owner
     *  cleans every session-attached structure (recent audits, cases, grants,
     *  confirmation tokens) so long-running hosts do not leak Maps. */
    onDetach?: (sessionId: string) => void;
}
export declare class SessionRegistry {
    private readonly options;
    private readonly bundles;
    private readonly detachGraceMs;
    constructor(options: SessionRegistryOptions);
    get(sessionId: string): SessionBundle | undefined;
    has(sessionId: string): boolean;
    getOrCreate(sessionId: string): SessionBundle;
    snapshot(): ReadonlyMap<string, SessionBundle>;
    get size(): number;
    applyScrollback(rows: number): void;
    tickIdle(): void;
    dispose(): void;
}

/**
 * Browser bridge for the JumpServer sidebar tab.
 *
 * All conversation-sensitive routes carry sessionId and only touch that
 * conversation's SessionRegistry bundle:
 *   POST /api/jumpserver.status   -> state snapshot
 *   POST /api/jumpserver.snapshot -> TerminalObserver long-poll
 *   POST /api/jumpserver.manual   -> explicit HUMAN command in ASSET_SHELL
 *   POST /api/jumpserver.test     -> throwaway gateway connection test
 *
 * Manual input does not go through the Agent permission gate because the user
 * typed it explicitly. It does NOT write raw PTY bytes either: the Host routes
 * it through SessionManager.exec so mutex/state/marker completion/audit remain
 * authoritative and the UI cannot silently desynchronize the connector.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { type JumpServerConfig } from '../config/types.js';
import { SessionState } from '../jumpserver/state-machine.js';
import type { TerminalObserver } from '../jumpserver/terminal-observer.js';
export interface BridgeServices {
    getConfig: () => JumpServerConfig;
    /** V0.3.1: optional credential-ref (env name) override for draft testing. */
    resolvePassword: (env?: string) => Promise<string | undefined>;
    statusFor: (sessionId: string | undefined) => {
        state: SessionState;
        gateway: string;
        target: string | null;
        hostname: string | null;
        user: string | null;
        connected: boolean;
        configured: boolean;
        permissionMode: string;
        granted: boolean;
        /** V0.5.11: where the live identity came from (never a value). */
        connectionSource?: {
            source: string;
            profileId?: string;
            profileLabel?: string;
        };
    };
    /** Whether the conversation currently holds a JumpServer Session Grant. */
    grantedFor: (sessionId: string | undefined) => boolean;
    /** Stable token-free loopback console URL. */
    consoleUrlFor?: (sessionId: string | undefined) => string | undefined;
    /** Explicitly end SSH and revoke this conversation grant. */
    terminateFor?: (sessionId: string) => Promise<unknown>;
    observerFor: (sessionId: string | undefined) => TerminalObserver | null;
    /** Recent audited commands of one conversation (ring, last 200). */
    auditFor: (sessionId: string | undefined) => Array<Record<string, unknown>>;
    /** Configured asset group names (for the picker chips). */
    assetGroupNames: () => string[];
    /** Asset picker data (listAssets with filter/group/refresh). */
    assetList: (sessionId: string, opts: {
        filter?: string;
        group?: string;
        refresh?: boolean;
    }) => Promise<{
        assets: Array<{
            name: string;
            ip: string | null;
            platform: string | null;
            node: string | null;
        }>;
        count: number;
        reportedTotal: number | null;
        complete: boolean;
        health: string;
        filter: string | null;
        group: string | null;
        groupMatched: number;
    } | null>;
    /**
     * Execute an explicit user-entered command in one existing conversation.
     * The route enforces a live conversation grant before reaching this service.
     */
    manualExec: (sessionId: string, command: string, signal?: AbortSignal, confirmed?: boolean, confirmToken?: string) => Promise<Record<string, unknown>>;
    /**
     * Browser-half activation telemetry. The renderer cannot write files, so
     * "why is my settings card missing" is otherwise unanswerable from the Host:
     * the client posts short events here and the Host appends them to
     * <dsh home>/jumpserver/client-trace.jsonl.
     */
    diagFor?: (event: string, detail?: Record<string, unknown>) => void;
    /**
     * True when a console page for this session pinged recently. Lets the client
     * decide whether to open another console tab without stacking duplicates: the
     * browser tab type is multiple, so the right column cannot dedupe it itself.
     */
    consoleActiveFor?: (sessionId: string) => boolean;
    /** Record that a console page for this session is on screen (memory only). */
    noteConsoleAlive?: (sessionId: string) => void;
    /** Record a refusal made by a person in the console (memory + audit sink). */
    recordManualRefusal?: (input: {
        sessionId: string;
        command: string;
        risk: string;
        classification: {
            risk: string;
            reason?: string;
            ruleId?: string;
            confidence?: string;
            classifierVersion?: number;
            normalizedCommand?: string;
        };
        reason: string;
    }) => Promise<void>;
    /** V0.4.0: streaming jobs of one conversation (never another's). */
    jobsFor?: (sessionId: string) => Promise<Array<Record<string, unknown>>>;
    /** V0.4.5: idempotent job stop (one Ctrl+C, shared verdict). */
    jobStopFor?: (sessionId: string, jobId: string) => Promise<Record<string, unknown>>;
    /**
     * V0.4.5: the ONE interrupt entry point. A streaming job is stopped through
     * the JobStore; a bare shell gets the out-of-band Ctrl+C. Also used by the
     * sidebar's 中断 button, so the two paths can never drift.
     */
    interruptFor?: (sessionId: string) => Promise<Record<string, unknown>>;
}
export declare function registerBridgeRoutes(webServer: {
    register(route: {
        kind: 'exact';
        path: string;
        handler: (req: IncomingMessage, res: ServerResponse) => void;
    }): () => void;
}, services: BridgeServices): () => void;
export declare function draftPasswordSource(draft: {
    password?: unknown;
    passwordEnv?: unknown;
}, cfg: JumpServerConfig): {
    env: string | null;
};
export declare function runConnectionTest(services: BridgeServices, draft?: {
    host?: unknown;
    port?: unknown;
    username?: unknown;
    password?: unknown;
    passwordEnv?: unknown;
}): Promise<Record<string, unknown>>;

import type { Context } from '@deepseek-ai/cordis';
import { type JumpServerConfig } from '../config/types.js';
import type { SessionRegistry } from '../jumpserver/session-registry.js';
import { type SessionGrant } from '../security/grant.js';
/** Canonical output schema for jumpserver_assets (V0.2.3 P1, V0.2.4: health + platform/node). */
export declare const ASSETS_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ok: {
            readonly type: "boolean";
            readonly required: true;
        };
        /** Desktop 0.2.x: stable token-free loopback console URL. */
        readonly consoleUrl: {
            readonly type: "string";
        };
        readonly code: {
            readonly type: "string";
        };
        readonly message: {
            readonly type: "string";
        };
        readonly count: {
            readonly type: "integer";
        };
        readonly filter: {
            readonly type: "string";
        };
        readonly assets: {
            readonly type: "array";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly index: {
                        readonly type: "integer";
                    };
                    readonly name: {
                        readonly type: "string";
                    };
                    readonly ip: {
                        readonly type: "string";
                    };
                    readonly platform: {
                        readonly type: "string";
                    };
                    readonly node: {
                        readonly type: "string";
                    };
                    readonly comment: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly truncated: {
            readonly type: "boolean";
        };
        readonly paged: {
            readonly type: "boolean";
        };
        readonly health: {
            readonly type: "string";
        };
        readonly rawRows: {
            readonly type: "integer";
        };
        readonly parsedRows: {
            readonly type: "integer";
        };
        readonly page: {
            readonly type: "integer";
        };
        readonly pageSize: {
            readonly type: "integer";
        };
        readonly totalPages: {
            readonly type: "integer";
        };
        readonly reportedTotal: {
            readonly type: "integer";
        };
        readonly complete: {
            readonly type: "boolean";
        };
        readonly group: {
            readonly type: "string";
        };
        readonly groupMatched: {
            readonly type: "integer";
        };
        readonly rawText: {
            readonly type: "string";
        };
    };
};
/** Canonical output schema for jumpserver_audit. */
export declare const AUDIT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ok: {
            readonly type: "boolean";
            readonly required: true;
        };
        /** Desktop 0.2.x: stable token-free loopback console URL. */
        readonly consoleUrl: {
            readonly type: "string";
        };
        readonly code: {
            readonly type: "string";
        };
        readonly message: {
            readonly type: "string";
        };
        readonly detail: {
            readonly type: "string";
        };
        /** How many entries matched (before the limit was applied). */
        readonly entries: {
            readonly type: "integer";
        };
        /** How many were actually returned. */
        readonly showing: {
            readonly type: "integer";
        };
        readonly timeZone: {
            readonly type: "string";
        };
        readonly filtered: {
            readonly type: "boolean";
        };
        readonly refusalCount: {
            readonly type: "integer";
        };
        readonly output: {
            readonly type: "string";
        };
    };
};
/**
 * Register the jumpserver_* tools and return their disposers. V0.2.3 P0:
 * every tool routes through the conversation-scoped SessionRegistry using
 * exec.agent.session.id, so 对话 A and 对话 B never share a PTY/mutex/
 * terminal stream. V0.2.3 P1 adds jumpserver_assets (KoKo 'p' -> local filter).
 */
export declare function registerJumpServerTools(ctx: Context, registry: SessionRegistry, getConfig: () => JumpServerConfig, grants: SessionGrant, terminateConversation?: (sessionId: string) => Promise<unknown>, auditFor?: (sessionId: string) => Array<Record<string, unknown>>, consoleUrlFor?: (sessionId: string) => string | undefined, resolveCredential?: (ref: string) => Promise<string | undefined>): Array<() => void>;

import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { ExecOutcome, SessionStatus } from '../jumpserver/session.js';
import type { TargetBatchResult } from '../jumpserver/session-manager.js';
import type { SessionBundle } from '../jumpserver/session-registry.js';
import type { AssetEntry } from '../jumpserver/asset-list.js';
/** Shared canonical output schema for every jumpserver_* tool. */
export declare const RESULT_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ok: {
            readonly type: "boolean";
            readonly required: true;
        };
        readonly code: {
            readonly type: "string";
        };
        readonly message: {
            readonly type: "string";
        };
        /** V0.5.3.2: structured diagnostic (parsed account list, detector tail, host-key reason). */
        readonly detail: {
            readonly type: "string";
        };
        /** V0.4.3: what happened to the COMMAND, independent of the exchange state. */
        readonly commandStatus: {
            readonly type: "string";
        };
        /** V0.5.8: the semantic judge's verdict when it decided (or tried to decide). */
        readonly riskJudge: {
            readonly type: "string";
        };
        /** Why an exit-0 command produced no output (dropped over-long PTY line). */
        readonly outputNote: {
            readonly type: "string";
        };
        /** V0.5.2: deferred connection completeness (CONFIG_INCOMPLETE reporting). */
        readonly connectionComplete: {
            readonly type: "boolean";
        };
        readonly connectionMissing: {
            readonly type: "array";
            readonly items: {
                readonly type: "string";
            };
        };
        /** V0.5.11: where the live credential/host came from — never the value itself. */
        readonly credentialSource: {
            readonly type: "string";
        };
        readonly credentialSourceDetail: {
            readonly type: "string";
        };
        readonly hostSource: {
            readonly type: "string";
        };
        readonly usernameSource: {
            readonly type: "string";
        };
        readonly connected: {
            readonly type: "boolean";
        };
        readonly configured: {
            readonly type: "boolean";
        };
        readonly gateway: {
            readonly type: "string";
        };
        readonly state: {
            readonly type: "string";
        };
        readonly target: {
            readonly type: "string";
        };
        readonly hostname: {
            readonly type: "string";
        };
        readonly user: {
            readonly type: "string";
        };
        readonly pwd: {
            readonly type: "string";
        };
        readonly permissionMode: {
            readonly type: "string";
        };
        readonly exitCode: {
            readonly type: "integer";
        };
        readonly completed: {
            readonly type: "boolean";
        };
        readonly executionState: {
            readonly type: "string";
        };
        readonly output: {
            readonly type: "string";
        };
        readonly truncated: {
            readonly type: "boolean";
        };
        readonly durationMs: {
            readonly type: "number";
        };
        readonly reconnectCount: {
            readonly type: "number";
        };
        readonly pluginVersion: {
            readonly type: "string";
        };
        readonly hostBuild: {
            readonly type: "string";
        };
        readonly protocolVersion: {
            readonly type: "integer";
        };
        /** V0.4.1: loopback console URL for this conversation (token embedded). */
        readonly consoleUrl: {
            readonly type: "string";
        };
    };
};
export type ResultValue = Record<string, unknown> & {
    ok: boolean;
};
/** Convert arbitrary runtime values into lossless JSON before tool completion. */
export declare function sanitizeToolOutput(value: unknown, seen?: WeakSet<object>): unknown;
export declare function toLosslessJsonValue<T>(value: T): T;
/**
 * Resolve the authoritative DSH conversation id for one tool call.
 * DSH stores the SessionId on `agent.session.header.id`. V0.2.3 accidentally
 * read `agent.session.id` and then fell back to `agent.id`, which may identify
 * the composed agent rather than the conversation and therefore made multiple
 * conversations reuse one JumpServer bundle.
 *
 * Calls without an authoritative conversation id fail closed. A shared
 * anonymous fallback can merge unrelated tool calls into one PTY/session.
 */
export declare function sessionIdOf(exec: ToolRunContext): string;
/** The per-conversation bundle for one tool call (never shared across ids). */
export declare function bundleFor(exec: ToolRunContext, registry: {
    getOrCreate(sessionId: string): SessionBundle;
}): SessionBundle;
export declare function statusToValue(status: SessionStatus & {
    configured: boolean;
    permissionMode: string;
}): ResultValue;
/**
 * Why an exit-0 command can still come back with no output.
 *
 * A PTY's canonical line discipline caps one line at roughly 4KB, so a large
 * single-line response (a minified JSON API payload, a base64 blob) is silently
 * discarded by the far end while the command itself exits 0. That looks
 * identical to "the command succeeded and printed nothing", which is exactly
 * the wrong conclusion. The bastion cannot be changed from here, so the result
 * says so instead.
 *
 * @returns a note for the caller to attach, or undefined when output is present.
 */
export declare function emptyOutputNote(command: string, output: string, exitCode: number | null): string | undefined;
export declare function execOutcomeToValue(status: SessionStatus & {
    configured: boolean;
    permissionMode: string;
}, outcome: ExecOutcome): ResultValue;
export declare function setConsoleUrlResolver(resolver: (sessionId: string) => string | undefined): void;
export declare function guardValue(exec: ToolRunContext, fn: () => Promise<ResultValue>): Promise<ResultValue>;
export declare function renderResult(_args: Record<string, unknown>, value: ResultValue): Array<{
    type: 'text';
    text: string;
}>;
/** Compact readable projection of a multi-target batch. */
export declare function renderBatchResult(tasks: TargetBatchResult[]): ResultValue;
/**
 * V0.5.3: per-target KoKo account id, e.g. {"192.168.79.10": 1}. Unknown or
 * non-integer entries are dropped rather than guessed.
 */
export declare function accountMap(raw: unknown): Record<string, number> | undefined;
/** Canonical structured value for jumpserver_assets (V0.2.5: footer verify fields; V0.2.6: group + gated rawText). */
export declare function assetsToValue(result: {
    assets: AssetEntry[];
    count: number;
    filter: string | null;
    group: string | null;
    groupMatched: number;
    truncated: boolean;
    paged: boolean;
    rawText: string;
    rawRows: number;
    parsedRows: number;
    page: number | null;
    pageSize: number | null;
    totalPages: number | null;
    reportedTotal: number | null;
    complete: boolean;
    health: string;
}, options?: {
    includeRawText?: boolean;
}): ResultValue;
/** Text projection for the assets result: one compact line per row + notes. */
export declare function renderAssetsResult(_args: Record<string, unknown>, value: ResultValue): Array<{
    type: 'text';
    text: string;
}>;

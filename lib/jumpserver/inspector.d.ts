import { type HostInventory } from './host-parse.js';
import type { SessionManager } from './session-manager.js';
/** One inspect call must not be able to walk the whole estate. */
export declare const MAX_INSPECT_TARGETS = 20;
export interface InspectOptions {
    targets: string[];
    profile?: string | string[];
    signal?: AbortSignal;
    toolCallId?: string;
    batchId?: string;
    /** V0.4.1: how many targets to survey at once (default 1 = sequential). */
    concurrency?: number;
    /** V0.5.2: called as each target settles, for MCP progress reporting. */
    onTarget?: (done: number, total: number, target: string) => void;
    /** V0.5.3: 0-based accountIndex per target for the KoKo `ID>` prompt. */
    accountByTarget?: Record<string, number>;
}
export interface SkippedProbe {
    command: string;
    risk: string;
    ruleId: string;
    reason: string;
}
export interface InspectResult {
    inventories: HostInventory[];
    profiles: string[];
    unknownProfiles: string[];
    skippedProbes: SkippedProbe[];
    targets: number;
    reachable: number;
    durationMs: number;
    warnings: string[];
}
export declare function inspectTargets(manager: SessionManager, getConfig: () => {
    allowedTargets?: string[];
    deniedTargets?: string[];
}, options: InspectOptions): Promise<InspectResult>;

/**
 * Last-known topology / inspect result, shared with the embedded console so
 * the 拓扑 tab can render what the model just collected (the console itself
 * never talks to the bastion).
 */
export interface StoredTopology {
    updatedAt: number;
    group: string | null;
    profiles: string[];
    targets: string[];
    nodes: unknown[];
    edges: unknown[];
    warnings: string[];
    durationMs: number;
}
export declare class TopologyStore {
    private current;
    set(value: StoredTopology): void;
    get(): StoredTopology | null;
}

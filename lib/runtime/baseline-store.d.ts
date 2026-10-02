export interface BaselineHost {
    target: string;
    hostname: string | null;
    reachable: boolean;
    error: string | null;
    os: string | null;
    kernel: string | null;
    cores: number | null;
    memoryTotalMb: number | null;
    memoryUsedPct: number | null;
    load: number[] | null;
    disks: Array<{
        mount: string;
        usePct: number | null;
    }>;
    listening: Array<{
        port: number;
        process: string | null;
    }>;
    services: string[];
    roles: string[];
}
export interface Baseline {
    name: string;
    createdAt: string;
    profile: string;
    targets: string[];
    hosts: BaselineHost[];
}
/** Safe baseline name: a filename component, no traversal, no separators. */
export declare function isValidBaselineName(name: string): boolean;
export declare class BaselineStore {
    private readonly dir;
    constructor(dir: string);
    private pathFor;
    save(baseline: Baseline): string;
    load(name: string): Baseline;
    /** Saved baseline names, sorted. */
    list(): string[];
}
export interface DriftField {
    field: string;
    before: string;
    after: string;
}
export interface HostDrift {
    target: string;
    status: 'changed' | 'unchanged' | 'added' | 'removed' | 'unreachable';
    changes: DriftField[];
}
export interface DriftResult {
    baseline: string;
    createdAt: string;
    comparedAt: string;
    hosts: HostDrift[];
    changed: number;
    unchanged: number;
    unreachable: number;
}
/** Compare two baseline host snapshots; only REAL differences are reported. */
export declare function diffHost(before: BaselineHost, after: BaselineHost): HostDrift;
/** Compare a whole baseline against a fresh set of host snapshots. */
export declare function diffBaseline(baseline: Baseline, current: BaselineHost[], comparedAt: string): DriftResult;

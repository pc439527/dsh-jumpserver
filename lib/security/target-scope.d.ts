export interface TargetScopeConfig {
    allowedTargets?: string[];
    deniedTargets?: string[];
}
/** Throws TARGET_DENIED when the target is outside the configured scope. */
export declare function requireTargetAllowed(cfg: TargetScopeConfig, target: string | null | undefined): void;

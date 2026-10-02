/**
 * Inspect profiles (V0.4.0): FIXED, reviewed, read-only probe sets.
 *
 * The model must not invent shell for a survey — it picks a profile and the
 * connector runs exactly these commands. Every command is verified READ by
 * tests/security/command-classifier.test.mjs + the profile-safety test, so a
 * survey is safe even in READ_ONLY mode (probes that regress to a non-READ
 * classification are skipped, never silently executed).
 */
export declare const INSPECT_PROFILES: readonly ["basic", "network", "process", "service", "web", "java", "database", "container", "full"];
export type InspectProfile = (typeof INSPECT_PROFILES)[number];
export interface ProbeStep {
    /** Parser key: the inspector maps each command's output onto this id. */
    id: string;
    command: string;
}
export declare const PROFILE_STEPS: Record<Exclude<InspectProfile, 'full'>, ProbeStep[]>;
export declare const DEFAULT_PROFILE: InspectProfile;
export declare function isInspectProfile(value: string): value is InspectProfile;
/** Merge profiles, de-duplicating by probe id (first occurrence wins). */
export declare function resolveProfile(names: string | string[] | undefined): {
    steps: ProbeStep[];
    used: InspectProfile[];
    unknown: string[];
};

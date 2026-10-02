/**
 * V0.3.0 Ops Investigation: read-only diagnostic profiles.
 *
 * Every command in every profile MUST classify as READ (the permission gate
 * applies to them exactly like any agent command, so a READ_ONLY deployment
 * must never trigger approval prompts for a triage sweep). A dedicated test
 * (ops-profiles.test.ts) asserts this for the whole table, so adding a
 * command that the classifier would block is a test failure, not a runtime
 * surprise. The 'since' placeholder keeps error-window commands bounded.
 */
export interface ProfileCommand {
    command: string;
    category: 'identity' | 'cpu-mem' | 'disk' | 'process' | 'service' | 'network' | 'errors' | 'app' | 'detect';
    label?: string;
}
export interface DiagnosticProfile {
    id: string;
    label: string;
    commands: ProfileCommand[];
}
/** Sanitized journalctl/dmesg window (default 30m). */
export declare function sanitizeSince(raw: string | undefined): string;
/** Linux base sweep — identity, resources, disk, processes, services, network. */
export declare const LINUX_BASE: DiagnosticProfile;
/** App-detection sweep: process names + units + listeners (parsed for markers). */
export declare const DETECT_PROFILE: {
    commands: ProfileCommand[];
};
/** Error-window commands shared by base and app profiles. */
export declare function errorCommands(since: string): ProfileCommand[];
export declare const APP_PROFILES: DiagnosticProfile[];
/** Collapse a profile into executable commands, resolving the since window. */
export declare function profileCommands(profile: DiagnosticProfile, since: string): ProfileCommand[];
/** Base sweep + error window => the always-run command list. */
export declare function linuxCommands(since: string): ProfileCommand[];
/** Which app profiles are present, judged from the detection sweep output. */
export declare function detectAppIds(detectionText: string): string[];
export declare function resolveProfile(id: string): DiagnosticProfile | undefined;
/** Every executable command across all profiles (for the READ-classification test). */
export declare function allProfileCommands(): string[];

/** Plugin semantic version — MUST match package.json + package-lock.json (enforced by tests/version-consistency.test.ts). */
export declare const PLUGIN_VERSION = "0.4.0";
/**
 * Event-stream / bridge protocol version. Bump whenever the browser<->host
 * snapshot shape or the observer event vocabulary changes incompatibly.
 */
export declare const PROTOCOL_VERSION = 4;
/**
 * Short git commit the running Host was built from. Read from
 * lib/build-meta.json (written by scripts/build-version.mjs at build time);
 * 'dev' when running from src (tests) or a packaged copy without the meta.
 */
export declare function hostBuild(): string;
export interface RuntimeVersion {
    pluginVersion: string;
    hostBuild: string;
    protocolVersion: number;
}
/** The Host identity every status surface should include. */
export declare function runtimeVersion(): RuntimeVersion;

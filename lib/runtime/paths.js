/**
 * DSH-native locations for the plugin's own state.
 *
 * Deliberately dependency-free: the first DSH version of this imported
 * `@deepseek-ai/dsh-home-paths`. A HOST-PROVIDED package may not be exposed to
 * a profile plugin's module scope, and a top-level import that cannot resolve
 * kills the whole Host half (no tools, no console) before apply() ever runs —
 * so the harness home is resolved from the environment instead.
 *
 * Resolution: $DSH_HOME (exported by the harness) -> ~/.dsh.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
/** The harness home directory. */
export function harnessHome() {
    const fromEnv = process.env['DSH_HOME'];
    if (typeof fromEnv === 'string' && fromEnv.trim().length > 0)
        return fromEnv.trim();
    return join(homedir(), '.dsh');
}
/** Root of jump server plugin state: <dsh home>/jumpserver */
export function jumpHomeRoot() {
    return join(harnessHome(), 'jumpserver');
}
/** TOFU / pinned SSH host-key store (default when knownHostsPath is unset). */
export function jumpHomeKnownHosts() {
    return join(jumpHomeRoot(), 'known_hosts.json');
}
/** Console discovery file with the public loopback URL only. */
export function jumpHomeConsole() {
    return join(jumpHomeRoot(), 'console.json');
}
/** Boot marker: proves the Host half activated, even if the console later fails. */
export function jumpHomeBootMarker() {
    return join(jumpHomeRoot(), 'boot.json');
}
/** Browser-half activation trace (JSON lines). */
export function jumpHomeClientTrace() {
    return join(jumpHomeRoot(), 'client-trace.jsonl');
}
/** Directory holding named baselines (<name>.json). */
export function jumpHomeBaselines() {
    return join(jumpHomeRoot(), 'baselines');
}

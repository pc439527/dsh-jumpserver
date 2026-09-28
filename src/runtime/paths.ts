/**
 * DSH-native locations for the plugin's own state.
 *
 * Deliberately dependency-free: the WorkBuddy port stored this under its own
 * data/ directory, and the first DSH version of it imported
 * `@deepseek-ai/dsh-home-paths`. A HOST-PROVIDED package may not be exposed to
 * a profile plugin's module scope, and a top-level import that cannot resolve
 * kills the whole Host half (no tools, no console) before apply() ever runs —
 * so the harness home is resolved from the environment instead.
 *
 * Resolution: $DSH_HOME (exported by the harness) -> ~/.dsh.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The harness home directory. */
export function harnessHome(): string {
  const fromEnv = process.env['DSH_HOME']
  if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/** Root of jump server plugin state: <dsh home>/jumpserver */
export function jumpHomeRoot(): string {
  return join(harnessHome(), 'jumpserver')
}

/** TOFU / pinned SSH host-key store (default when knownHostsPath is unset). */
export function jumpHomeKnownHosts(): string {
  return join(jumpHomeRoot(), 'known_hosts.json')
}

/** Directory holding named baselines (<name>.json). */
export function jumpHomeBaselines(): string {
  return join(jumpHomeRoot(), 'baselines')
}

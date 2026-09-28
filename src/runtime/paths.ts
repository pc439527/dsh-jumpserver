/**
 * DSH-native locations for the plugin's own state.
 *
 * The WorkBuddy port stored these under its own data/ directory; DSH is a
 * plugin, so everything lives under the harness home instead of the process
 * working directory (which is the profile directory and must stay clean).
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Root of jump server plugin state: <dsh home>/jumpserver */
export function jumpHomeRoot(): string {
  return dshHomePath('jumpserver')
}

/** TOFU / pinned SSH host-key store (default when knownHostsPath is unset). */
export function jumpHomeKnownHosts(): string {
  return dshHomePath('jumpserver', 'known_hosts.json')
}

/** Directory holding named baselines (<name>.json). */
export function jumpHomeBaselines(): string {
  return dshHomePath('jumpserver', 'baselines')
}

/**
 * Host-side runtime version info (V0.2.6 P0 version handshake).
 *
 * The plugin Host and the browser Client are built and deployed separately
 * (the sidebar bundle ships via dsh-client-modules; tool registration happens
 * in the dsh web Host process). Mixing an old Host with a new Client — or the
 * reverse — is exactly the "GitHub said it changed but the UI still behaves
 * old" trap. Every status payload carries the Host identity (pluginVersion /
 * hostBuild / protocolVersion) and the Client bundles its own identity
 * (clientVersion / clientBuild, see src/client/version.ts) so the sidebar can
 * show a restart warning the moment they diverge.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Plugin semantic version — MUST match package.json + package-lock.json (enforced by tests/version-consistency.test.ts). */
export const PLUGIN_VERSION = '0.3.2'

/**
 * Event-stream / bridge protocol version. Bump whenever the browser<->host
 * snapshot shape or the observer event vocabulary changes incompatibly.
 */
export const PROTOCOL_VERSION = 3

let cachedHostBuild: string | null = null

/**
 * Short git commit the running Host was built from. Read from
 * lib/build-meta.json (written by scripts/build-version.mjs at build time);
 * 'dev' when running from src (tests) or a packaged copy without the meta.
 */
export function hostBuild(): string {
  if (cachedHostBuild !== null) return cachedHostBuild
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    const metaPath = join(here, 'build-meta.json')
    if (existsSync(metaPath)) {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as { hostBuild?: unknown }
      if (typeof meta.hostBuild === 'string' && meta.hostBuild.length > 0) cachedHostBuild = meta.hostBuild
    }
  } catch {
    /* non-fatal: fall through to 'dev' */
  }
  cachedHostBuild ??= 'dev'
  return cachedHostBuild
}

export interface RuntimeVersion {
  pluginVersion: string
  hostBuild: string
  protocolVersion: number
}

/** The Host identity every status surface should include. */
export function runtimeVersion(): RuntimeVersion {
  return { pluginVersion: PLUGIN_VERSION, hostBuild: hostBuild(), protocolVersion: PROTOCOL_VERSION }
}

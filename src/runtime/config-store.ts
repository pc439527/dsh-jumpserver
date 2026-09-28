/**
 * Editable configuration overlay.
 *
 * DSH's browser settings seam (`connection.api.settings`) is not reachable from
 * this plugin's client context (the activation trace reports settingsApi:false),
 * so the plugin owns a small, explicit overlay file:
 *
 *   ~/.dsh/jumpserver/config.json   { "<field>": <value>, ... }
 *
 * Effective config = composition/settings config <- this file. It is what the
 * Settings → Plugins → JumpServer card reads and writes, and it works on every
 * DSH build because nothing in the read/write path depends on a host service.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { jumpHomeConfig } from './paths.js'

/** Fields a user may edit through the settings card. */
export const EDITABLE_FIELDS: readonly string[] = [
  'enabled',
  'host',
  'port',
  'username',
  'passwordEnv',
  'permissionMode',
  'privilegedReadInReadOnly',
  'manualPermissionMode',
  'timeZone',
  'allowedTargets',
  'deniedTargets',
  'batchConcurrency',
  'maxSessions',
  'assetCacheTtlSeconds',
  'assetGroups',
  'runbooks',
  'profiles',
  'activeProfileId',
  'riskJudge',
  'autoOpenTerminal',
  'terminalScrollback',
  'autoReconnect',
  'enableAudit',
  'consoleEnabled',
  'consolePort',
  'hostFingerprint',
  'knownHostsPath',
]

export type ConfigOverlay = Record<string, unknown>

/** Read the overlay; a corrupt file degrades to "no overrides", never a throw. */
export function readOverlay(path = jumpHomeConfig()): ConfigOverlay {
  try {
    if (!existsSync(path)) return {}
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ConfigOverlay) : {}
  } catch {
    return {}
  }
}

/** Merge a patch into the overlay and persist it. Returns the new overlay. */
export function writeOverlayPatch(patch: ConfigOverlay, path = jumpHomeConfig()): ConfigOverlay {
  const next = { ...readOverlay(path) }
  for (const [key, value] of Object.entries(patch)) {
    if (!EDITABLE_FIELDS.includes(key)) continue
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
  } catch {
    /* a read-only home must not turn a settings save into a crash */
  }
  return next
}

/** Reset one field back to its composed value. */
export function clearOverlayField(field: string, path = jumpHomeConfig()): ConfigOverlay {
  return writeOverlayPatch({ [field]: null }, path)
}

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PLUGIN_VERSION } from '../src/version.js'

/**
 * V0.3.1 P0: the plugin version must be consistent across every surface that
 * ships it. Commit f4f55b0 regressed to 0.2.7 in package.json/src/version.ts
 * while package-lock.json still said 0.3.0 — this test makes that class of
 * mistake (and any package.json <-> package-lock.json drift) fail CI.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Record<string, unknown>
}

describe('V0.3.1 version consistency', () => {
  it('package.json version matches PLUGIN_VERSION', () => {
    const pkg = readJson('package.json')
    expect(pkg.version).toBe(PLUGIN_VERSION)
  })

  it('package-lock.json root version matches package.json', () => {
    const pkg = readJson('package.json')
    const lock = readJson('package-lock.json')
    expect(lock.version).toBe(pkg.version)
  })

  it('package-lock.json packages[""].version matches package.json', () => {
    const pkg = readJson('package.json')
    const lock = readJson('package-lock.json')
    const rootEntry = (lock['packages'] as Record<string, { version?: string }>)['']
    expect(rootEntry?.version ?? undefined).toBe(pkg.version)
  })

  it('package-lock "version" field is never stale: all top-level occurrences agree', () => {
    const pkg = readJson('package.json')
    const lock = readJson('package-lock.json')
    const seen = new Set<string>([String(lock.version), String((lock['packages'] as Record<string, { version?: string }>)['']?.version)])
    for (const v of seen) expect(v).toBe(String(pkg.version))
  })
})

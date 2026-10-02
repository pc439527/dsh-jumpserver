#!/usr/bin/env node
/**
 * V0.2.6 P0 version handshake: materialize lib/build-meta.json with the
 * package version and the short git commit the build came from. build-client.mjs
 * reads this file for its esbuild defines; the Host's src/version.ts reads it
 * at runtime (fallback 'dev' when absent, e.g. running from src in tests).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

// JS_HOST_BUILD pins the identity so a rebuild can be compared byte-for-byte
// against the committed lib/ — that is what scripts/check-lib-fresh.mjs does.
// Without it the build records the commit it was cut from.
let hostBuild = 'dev'
const pinned = process.env.JS_HOST_BUILD
if (typeof pinned === 'string' && pinned.length > 0) {
  hostBuild = pinned
} else {
  try {
    const short = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
    if (short.length > 0) hostBuild = short
  } catch {
    /* not a git checkout: keep 'dev' */
  }
}

// No timestamp on purpose. lib/ is committed, and CI diffs a rebuild against
// it, so every field here must be reproducible — a generatedAt would make every
// rebuild differ and bury real drift. Nothing reads it anyway: src/version.ts
// takes hostBuild, build-client.mjs takes version + hostBuild.
const meta = {
  version: typeof pkg.version === 'string' ? pkg.version : 'dev',
  hostBuild,
}
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'build-meta.json'), JSON.stringify(meta, null, 2) + '\n')
console.log('build-meta written:', JSON.stringify(meta))

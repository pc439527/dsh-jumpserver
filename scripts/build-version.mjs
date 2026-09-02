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

let hostBuild = 'dev'
try {
  const short = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  if (short.length > 0) hostBuild = short
} catch {
  /* not a git checkout: keep 'dev' */
}

const meta = {
  version: typeof pkg.version === 'string' ? pkg.version : 'dev',
  hostBuild,
  generatedAt: new Date().toISOString(),
}
mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib', 'build-meta.json'), JSON.stringify(meta, null, 2) + '\n')
console.log('build-meta written:', JSON.stringify(meta))

#!/usr/bin/env node
/**
 * Sync the freshly built package into the web profile deployment copy under
 * `$HOME/.dsh/profiles/web/node_modules/dsh-jumpserver` (override with
 * JS_PROFILE_PKG). Rebuilt artifacts must be copied there before restarting
 * dsh web when the plugin is installed from a local file source.
 */
import { cpSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const profilePkg = process.env.JS_PROFILE_PKG ?? join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-jumpserver')

if (!statSync(profilePkg).isDirectory()) {
  console.error('profile package missing:', profilePkg)
  process.exit(1)
}

for (const name of ['lib', 'package.json', 'README.md']) {
  const target = join(profilePkg, name)
  if (fsExists(target)) rmSync(target, { recursive: true, force: true })
  const source = join(root, name)
  if (!fsExists(source)) continue
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
}
console.log('synced lib/, package.json, README.md ->', profilePkg)

function fsExists(p) {
  try {
    statSync(p)
    return true
  } catch {
    return false
  }
}

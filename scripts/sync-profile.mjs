#!/usr/bin/env node
/**
 * Sync the freshly built package into the profile's deployment copy.
 *
 * Target resolution (highest first):
 *   1. JS_PROFILE_PKG  — explicit package directory;
 *   2. $DSH_PROFILE_DIR/node_modules/dsh-jumpserver — the profile DSH is
 *      actually running (exported by the harness, so it is always the truth);
 *   3. ~/.dsh/profiles/web/node_modules/dsh-jumpserver — the historical default.
 *
 * A missing target is a HINT, not a crash: the plugin may not be installed in
 * that profile yet, and the operator needs the install command, not a stack.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function resolveTarget() {
  if (process.env.JS_PROFILE_PKG) return { target: process.env.JS_PROFILE_PKG, why: 'JS_PROFILE_PKG' }
  const profileDir = process.env.DSH_PROFILE_DIR
  if (profileDir && profileDir.length > 0) {
    return { target: join(profileDir, 'node_modules', 'dsh-jumpserver'), why: 'DSH_PROFILE_DIR=' + profileDir }
  }
  return { target: join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-jumpserver'), why: 'default web profile' }
}

const { target: profilePkg, why } = resolveTarget()
if (!existsSync(profilePkg) || !statSync(profilePkg).isDirectory()) {
  // A local file: dependency whose copy pnpm has not materialised (or an
  // install the operator deleted) is recoverable: create the directory and
  // lay down exactly what the package ships. Anything else is a real miss.
  const parent = dirname(profilePkg)
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    console.error('profile package not found: ' + profilePkg)
    console.error('  resolved from: ' + why)
    console.error('  install it first, then re-run npm run sync:')
    console.error('    dsh plugin --profile <profile> add "file:' + root + '"')
    console.error('  or point JS_PROFILE_PKG at an existing install directory.')
    process.exit(1)
  }
  mkdirSync(profilePkg, { recursive: true })
  console.log('created missing install copy:', profilePkg)
}

for (const name of ['lib', 'package.json', 'cordis.patch.yml', 'README.md']) {
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

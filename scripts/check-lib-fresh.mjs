#!/usr/bin/env node
/**
 * Guard the committed lib/: a fresh build of src/ must reproduce it byte for byte.
 *
 * lib/ is committed on purpose — it is what makes
 *   dsh plugin --profile desktop add github:pc439527/dsh-jumpserver
 * work on a machine with no toolchain. The cost of that choice is that a source
 * edit can silently land without its build output, leaving the published plugin
 * a version behind. This script closes that hole.
 *
 * How it stays deterministic: lib/build-meta.json embeds hostBuild, and
 * build-client.mjs inlines that same value into lib/client.js, so a plain
 * rebuild always differs from the commit it was cut from (the artifact has to
 * be built BEFORE the commit that carries it). We therefore read the committed
 * hostBuild, rebuild with JS_HOST_BUILD pinned to it, and diff. Same inputs,
 * same pinned identity -> identical bytes; any real source drift shows up.
 *
 * Usage: npm run check:lib
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const lib = join(root, 'lib')
const metaPath = join(lib, 'build-meta.json')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error('check:lib — ' + message)
  process.exit(1)
}

// Compared against the INDEX, not HEAD: freshly built output that is staged
// but not yet committed is the normal state of this workflow, and status
// --porcelain would flag it as dirty. What we actually care about is "does the
// worktree hold something other than what is about to be committed".
// It also keeps the restore in finally safe — that only discards worktree
// deviations the caller had before invoking us.
const preexisting = git(['diff', '--name-only', '--', 'lib'])
if (preexisting) {
  fail('lib/ has uncommitted worktree changes; commit or discard them first.\n' + preexisting)
}

let tracked = false
try {
  git(['ls-files', '--error-unmatch', '--', 'lib/build-meta.json'])
  tracked = true
} catch {
  tracked = false
}

if (!tracked || !existsSync(metaPath)) {
  fail(
    'lib/ is not committed. This repo ships prebuilt output so GitHub installs\n' +
    'work without a local toolchain — run `npm run build` and commit lib/.',
  )
}

let committedHostBuild = 'dev'
try {
  committedHostBuild = String(JSON.parse(readFileSync(metaPath, 'utf8')).hostBuild ?? 'dev')
} catch {
  /* unreadable meta: fall back to 'dev', the rebuild diff still tells the truth */
}

let stale = false
try {
  execFileSync(npm, ['run', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, JS_HOST_BUILD: committedHostBuild },
  })

  const dirty = git(['diff', '--name-only', '--', 'lib'])
  if (dirty) {
    stale = true
    console.error('')
    console.error('check:lib — lib/ is STALE. src/ changed without a matching rebuild:')
    for (const line of dirty.split('\n')) console.error('  ' + line)
    console.error('')
    console.error('  Fix: `npm run build`   (then commit lib/ together with src/)')
    console.error('')
  }
} finally {
  // The probe must never leave the worktree dirty.
  git(['checkout', '--', 'lib'])
}

if (!stale) console.log('check:lib — lib/ matches a fresh build of src/ (hostBuild ' + committedHostBuild + ')')
process.exit(stale ? 1 : 0)

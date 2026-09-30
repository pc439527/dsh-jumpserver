#!/usr/bin/env node
/**
 * Post-restart acceptance check for the Phase 2 fixes.
 *
 * Every fix in this phase was verified in unit tests against real code paths,
 * but four of them only mean anything in a RUNNING host. This script proves the
 * deployed artifacts actually carry them, so a restart can be validated without
 * guessing from symptoms.
 *
 * Usage: node scripts/phase2-verify.mjs   (JS_PROFILE_PKG / DSH_PROFILE_DIR respected)
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function resolveProfile() {
  if (process.env.JS_PROFILE_PKG) return process.env.JS_PROFILE_PKG
  if (process.env.DSH_PROFILE_DIR) return join(process.env.DSH_PROFILE_DIR, 'node_modules', 'dsh-jumpserver')
  for (const profile of ['desktop', 'web']) {
    const candidate = join(homedir(), '.dsh', 'profiles', profile, 'node_modules', 'dsh-jumpserver')
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const target = resolveProfile()
if (target === undefined || !existsSync(target)) {
  console.error('PHASE2_VERIFY_FAIL: deployed profile not found; run npm run sync first')
  process.exit(1)
}

const lib = join(target, 'lib')
const read = (rel) => {
  const path = join(lib, rel)
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

let meta = {}
try {
  meta = JSON.parse(readFileSync(join(lib, 'build-meta.json'), 'utf8'))
} catch { /* absent is reported below */ }

const CHECKS = [
  {
    id: 'console-terminal-semantics',
    why: 'BS erases and a lone CR overwrites, so the bastion progress bar is not garbage',
    run: () => {
      const page = read('runtime/console-page.js')
      return page.includes('slice(0, -1)') && page.includes('line = ' + String.fromCharCode(39) + String.fromCharCode(39))
    },
  },
  {
    id: 'console-follow-toggle',
    why: 'the terminal pane has an explicit follow switch next to clear',
    run: () => read('runtime/console-page.js').includes('id="follow"'),
  },
  {
    id: 'settings-section-slot',
    why: 'the settings card belongs on the Settings page, not the Plugins page',
    run: () => read('client.js').includes('settings.section'),
  },
  {
    id: 'refusal-audit-deferred-run',
    why: 'a rejected jumpserver_run still leaves an audit record',
    run: () => {
      const gate = read('security/permission-gate.js')
      return gate.includes('AUDIT_WRITE_FAILED') && gate.includes('operation: ' + String.fromCharCode(39) + 'run' + String.fromCharCode(39))
    },
  },
  {
    id: 'probe-echo-stripped',
    why: 'inventory reports real values instead of the command text',
    run: () => read('jumpserver/host-parse.js').includes('stripCommandEcho'),
  },
  {
    id: 'judge-credential-seam',
    why: 'the Jev API key is read from the DSH credential domain, not process.env alone',
    run: () => read('security/risk-judge.js').includes('resolveCredential'),
  },
  {
    id: 'empty-output-note',
    why: 'an exit-0 command with no output says why instead of looking successful',
    run: () => read('tools/common.js').includes('emptyOutputNote'),
  },
  {
    id: 'no-stale-bundle',
    why: 'the deleted config-store module is not shipped',
    run: () => !existsSync(join(lib, 'runtime', 'config-store.js')),
  },
]

let failed = 0
for (const check of CHECKS) {
  let ok = false
  try {
    ok = check.run() === true
  } catch {
    ok = false
  }
  if (!ok) failed += 1
  console.log((ok ? 'PASS  ' : 'FAIL  ') + check.id + '  - ' + check.why)
}

console.log('')
console.log('deployed profile : ' + target)
console.log('build hostBuild  : ' + (meta.hostBuild ?? 'unknown') + (meta.generatedAt ? '  built ' + meta.generatedAt : ''))
console.log('checks           : ' + (CHECKS.length - failed) + '/' + CHECKS.length + ' passed')

if (failed > 0) {
  console.error('PHASE2_VERIFY_FAIL: ' + failed + ' check(s) failed - the deployed copy does not carry the fixes')
  process.exit(1)
}
console.log('PHASE2_VERIFY_PASS')
console.log('Now restart DSH and confirm jumpserver_status reports hostBuild ' + (meta.hostBuild ?? 'this build') + '.')

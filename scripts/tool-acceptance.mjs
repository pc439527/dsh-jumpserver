#!/usr/bin/env node
// Tool-layer acceptance (Test 1-6 + output contract) against the REAL bastion.
// Loads the INSTALLED (fixed) plugin, registers tools, drives them via their
// real execute() path, and validates EVERY output with the harness JSON-schema
// validator — the exact check that failed before the dropNulls fix.
import { readFileSync } from 'node:fs'
import { valueSchemaSpecToJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { RESULT_SCHEMA } from '../lib/tools/common.js'

import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const pluginUrl = process.env.JS_PLUGIN_URL ?? pathToFileURL(join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-jumpserver', 'lib', 'index.js')).href
const mod = await import(pluginUrl)

// Resolve the password from .credentials.yaml (never printed).
const raw = readFileSync(process.env.USERPROFILE + '\\.dsh\\.credentials.yaml', 'utf8')
const refsBlock = raw.split(/\n\s*records:|\n\s*version:/)[0]
const password = /\bJUMPSERVER_PASSWORD\s*:\s*['"]([^'"]+)['"]/.exec(refsBlock)?.[1] ?? ''
if (password.length === 0) { console.error('missing JUMPSERVER_PASSWORD'); process.exit(2) }

const registered = []
const disposers = []
let approvalAsked = 0
const ctx = {
  injected: new Set(),
  has(name) { return this.injected.has(name) },
  inject(services, cb) { if (services.every((s) => this.has(s))) cb(this) },
  get(name) {
    switch (name) {
      case 'approval': return {
        request: async () => { approvalAsked++; return 'allowed-once' },
      }
      case 'credentials': return {
        resolve: async () => ({ value: password }),
      }
      case 'storageDomain': return undefined
      default: return undefined
    }
  },
  logger: { debug: () => {}, warn: () => {} },
  effect(fn, label) {
    const disposer = fn()
    if (disposer !== undefined && typeof disposer.then === 'function') {
      disposer.then((d) => { if (typeof d === 'function') disposers.push(d) }).catch(() => {})
    } else if (typeof disposer === 'function') disposers.push(disposer)
    return () => {}
  },
  timer: {
    timeout() { return () => {} },
    interval() { return () => {} },
  },
  tools: {
    register(def) { registered.push(def); return () => {} },
  },
}

mod.apply(ctx, { host: process.env.JS_HOST ?? '203.0.113.10', port: 2222, username: process.env.JS_USER ?? 'ops-user', passwordEnv: 'JUMPSERVER_PASSWORD', permissionMode: 'READ_ONLY', connectTimeout: 20, commandTimeout: 60 })
await new Promise((r) => setTimeout(r, 100))

const byName = Object.fromEntries(registered.map((d) => [d.name, d]))
const schema = valueSchemaSpecToJsonSchema(RESULT_SCHEMA)

let failures = 0
function check(name, value) {
  const violations = validateJsonSchemaValue(schema, value, 'value')
  const ok = violations.length === 0
  if (!ok) { failures++; console.log('SCHEMA-FAIL', name, violations.join('; ')) }
  return ok
}
function step(name, value) {
  const ok = check(name, value)
  console.log('* ' + name + ' -> ' + (ok ? 'schema-ok' : 'SCHEMA-FAIL') + ' ' + JSON.stringify(value).slice(0, 300))
  return value
}

async function runTool(name, args) {
  const def = byName[name]
  const exec = { agent: { id: 'acc' }, name, callId: 'acc-' + Date.now(), signal: { aborted: false } }
  return def.execute(args, exec)
}

try {
  // Test 1: status (disconnected) — must validate (target/hostname omitted)
  step('status(disconnected)', await runTool('jumpserver_status', {}))

  // Test 1b: connect -> JUMPSERVER_MENU
  step('connect', await runTool('jumpserver_connect', {}))

  // Test 2+3: enter 101 + diagnostics
  step('enter 101', await runTool('jumpserver_enter', { target: '203.0.113.101' }))
  const diag = await runTool('jumpserver_exec', { command: 'hostname; uptime; df -h | tail -3' })
  step('exec diagnostics', diag)
  if (diag.completed !== true || diag.exitCode !== 0) failures++

  // Test 6: READ_ONLY blocks systemctl restart (COMMAND_BLOCKED, no approval asked)
  const beforeAsk = approvalAsked
  const blocked = await runTool('jumpserver_exec', { command: 'systemctl restart resin' })
  step('exec systemctl restart (READ_ONLY)', blocked)
  if (blocked.code !== 'COMMAND_BLOCKED') failures++
  if (approvalAsked !== beforeAsk) { failures++; console.log('FAIL: READ_ONLY must not ask approval') }

  // Test 5: run on 102 (auto navigation) with a READ command
  const run102 = await runTool('jumpserver_run', { target: '203.0.113.102', command: 'hostname; uptime' })
  step('run 102', run102)
  if (run102.completed !== true || run102.exitCode !== 0) failures++

  // leave + close
  step('leave', await runTool('jumpserver_leave', {}))
  step('close', await runTool('jumpserver_close', {}))

  console.log(failures === 0 ? 'TOOL_ACCEPT_PASS' : 'TOOL_ACCEPT_FAIL ' + failures)
} catch (error) {
  console.log('TOOL_ACCEPT_ERROR ' + String(error && error.message ? error.message : error))
  failures++
}
for (const d of disposers) { try { await d() } catch {} }
process.exit(failures === 0 ? 0 : 1)

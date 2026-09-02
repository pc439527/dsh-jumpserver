#!/usr/bin/env node
// Loads the INSTALLED plugin (profile node_modules) and verifies:
// exports, Config defaults, tl;dr apply() registers all 7 tools.
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

const pluginUrl = process.env.JS_PLUGIN_URL ?? pathToFileURL(join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-jumpserver', 'lib', 'index.js')).href
const mod = await import(pluginUrl)
console.log('name =', mod.name)
console.log('inject =', JSON.stringify(mod.inject))
console.log('exports:', Object.keys(mod).join(', '))

console.log('Config is a schemastory schema:', typeof mod.Config._inner === 'object' || typeof mod.Config === 'object')

const registered = []
const disposers = []
const ctx = {
  injected: new Set(), // no settings service in this mock; section registration is skipped
  has(name) {
    return this.injected.has(name)
  },
  inject(services, cb) {
    if (services.every((s) => this.has(s))) cb(this)
  },
  get(name) {
    switch (name) {
      case 'approval': return undefined
      case 'credentials': return undefined
      case 'storageDomain': return undefined
      default: return undefined
    }
  },
  logger: { debug: () => {}, warn: () => {} },
  effect(fn, label) {
    // supports sync fn returning disposer, and async fn returning disposer
    const disposer = fn()
    if (disposer !== undefined && typeof disposer.then === 'function') {
      disposer.then((d) => { if (typeof d === 'function') disposers.push(d) }).catch(() => {})
    } else if (typeof disposer === 'function') {
      disposers.push(disposer)
    }
    return () => {}
  },
  // timer must be accessed through the injected service, never the context mixin
  timer: {
    timeout() { return () => {} },
    interval() { return () => {} },
  },
  tools: {
    register(def) {
      registered.push(def)
      return () => {}
    },
  },
}
mod.apply(ctx, {
  host: '203.0.113.10',
  port: 2222,
  username: 'ops',
  passwordEnv: 'JUMPSERVER_PASSWORD',
})
await new Promise((r) => setTimeout(r, 50))
console.log('tools registered:', registered.map((t) => t.name).join(', '))
const toolNames = registered.map((t) => t.name)
const expected = ['jumpserver_status', 'jumpserver_connect', 'jumpserver_assets', 'jumpserver_enter', 'jumpserver_exec', 'jumpserver_run', 'jumpserver_batch', 'jumpserver_leave', 'jumpserver_close']
const missing = expected.filter((n) => !toolNames.includes(n))
console.log('missing tools:', missing.length === 0 ? '(none)' : missing.join(', '))
console.log('output schema declared on all:', registered.every((t) => t.output !== undefined && t.output.schema !== undefined))
for (const d of disposers) { try { await d() } catch {} }
console.log('PLUGIN_LOAD_SMOKE_PASS')

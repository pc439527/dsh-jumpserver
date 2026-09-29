#!/usr/bin/env node
/**
 * Client-bundle smoke (Desktop 0.2.x contract): materialize lib/client.js
 * exactly like the browser module loader (factory(require) -> exports) and run
 * apply() against a stub native Desktop ctx. Catches bundle syntax/runtime
 * errors, bad require names, and gross wiring mistakes without a browser.
 *
 * Asserts the native surfaces only:
 *  - inject is exactly ['slots'] (an unsatisfied inject aborts the client boot)
 *  - the settings card registers through configForms.whileServed -> plugins.item
 *  - the console opens as a native sidebarRight 'browser' tab, once granted
 *    and with the conversation id carried in the URL fragment
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const registry = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      if (typeof registration?.id !== 'string' || typeof registration?.factory !== 'function') {
        throw new Error('malformed load registration')
      }
      registry.set(registration.id, registration.factory)
    },
  },
}
globalThis.document = undefined
new Function('window', readFileSync(join(root, 'lib', 'client.js'), 'utf8') + '\nreturn true')(globalThis.window)

const factory = registry.get('dsh-jumpserver')
if (factory === undefined) throw new Error('BUNDLE_SMOKE_FAIL: plugin factory missing')

const require = createRequire(import.meta.url)
const plugin = factory((specifier) => {
  if (specifier === 'react' || specifier.startsWith('react/')) return require(specifier)
  throw new Error('BUNDLE_SMOKE_FAIL: unexpected require(' + specifier + ')')
})
if (JSON.stringify(plugin.inject) !== '["slots"]') {
  throw new Error('BUNDLE_SMOKE_FAIL: inject must be ["slots"], got ' + JSON.stringify(plugin.inject))
}

globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ ok: true, granted: true, consoleUrl: 'http://127.0.0.1:8765/' }),
})

const registrations = []
const opens = []
const cleanups = []
const form = {
  getSnapshot: () => ({ status: 'ready', writable: true, value: { autoOpenTerminal: true }, base: {}, user: {}, revision: 1 }),
  subscribe: () => () => undefined,
  set: async () => undefined,
  unset: async () => undefined,
}
const ctx = {
  effect(fn) {
    const result = fn()
    if (typeof result === 'function') cleanups.push(result)
    return result
  },
  locale: { bind: () => (key) => key, register: () => undefined },
  configForms: { get: () => form, whileServed: (_ids, fn) => fn(new Set(['jumpserver'])) },
  remote: { credentials: { describe: async () => ({ ok: true, value: {} }), set: async () => ({ ok: true }) } },
  sidebarRightTabs: { get: (kind) => (kind === 'browser' ? {} : undefined) },
  sidebarRight: { openTab: (kind, options) => opens.push({ kind, options }) },
  uiSession: { adapter: { current: { getSnapshot: () => ({ key: 'session-1' }), subscribe: () => () => undefined } } },
  slots: {
    inject(name, cb) {
      registrations.push(name)
      return cb()
    },
    register(options) {
      registrations.push(options.id)
      return () => undefined
    },
  },
}

plugin.apply(ctx)
await new Promise((resolve) => setTimeout(resolve, 100))
for (const cleanup of cleanups) {
  try {
    cleanup()
  } catch {
    /* already disposed */
  }
}

if (!registrations.includes('plugins.item')) {
  throw new Error('BUNDLE_SMOKE_FAIL: native settings slot missing')
}
if (opens.length !== 1 || opens[0].kind !== 'browser' || opens[0].options.params.url !== 'http://127.0.0.1:8765/#session=session-1') {
  throw new Error('BUNDLE_SMOKE_FAIL: native browser tab mismatch ' + JSON.stringify(opens))
}

console.log('BUNDLE_SMOKE_PASS')

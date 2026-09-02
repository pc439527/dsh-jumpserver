#!/usr/bin/env node
/**
 * Client-bundle smoke (V0.2.2 contract): materialize lib/client.js exactly
 * like the browser module loader (factory(require) -> exports) and run
 * apply() against a stub browser ctx. Catches bundle syntax/runtime errors,
 * bad require names, and gross wiring mistakes without a browser.
 *
 * V0.2.2 assertions:
 *  - settings.plugin.item       present  (settings card)
 *  - conversation.session.header.utilities ABSENT  (legacy >_ JumpServer entry removed)
 *  - shell.overlay              ABSENT  (self-drawn drawer removed)
 *  - the terminal is registered through ctx.betterSidebar.registerTab with
 *    id 'dsh-jumpserver:terminal', order 45, single:true + a component
 *  - autoOpenTerminal is grant-gated (V0.2.4): apply() NEVER opens the tab
 *    from a bare session. It polls the bridge status and only calls
 *    openTab({type: TAB_ID}, {sessionId}) once the bridge reports
 *    granted:true (the conversation has run /jumpserver). The fetch stub
 *    below returns granted:true so exactly one targeted open fires.
 *  - CROSS-PLUGIN CONTEXT BOUNDARY (the V0.2.1 P0): descriptor.component is
 *    rendered with a SIDEBAR ctx that exposes NO JumpServer services (a
 *    poisoned Proxy throwing on any property access) — the tab must still
 *    mount, because everything it needs is closed over by apply(). This
 *    proves the fix for "cannot get property settingsScope without inject".
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const registry = new Map()
globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      if (typeof registration?.id !== 'string' || typeof registration?.factory !== 'function') {
        throw new Error('malformed load registration')
      }
      if (registry.has(registration.id)) throw new Error('duplicate factory: ' + registration.id)
      registry.set(registration.id, registration.factory)
    },
  },
}
globalThis.document = undefined

const evaluate = new Function('window', bundle + '\nreturn true')
evaluate(globalThis.window)

if (!registry.has('dsh-jumpserver')) {
  console.error('BUNDLE_SMOKE_FAIL: factory "dsh-jumpserver" was not registered')
  process.exit(1)
}

// V0.2.4: the auto-open path reads the bridge status. Stub fetch so the
// status POST resolves with granted:true (the conversation was /jumpserver'd).
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    ok: true,
    granted: true,
    state: 'DISCONNECTED',
    connected: false,
    configured: true,
    enabled: true,
    permissionMode: 'READ_ONLY',
    lastSeq: 0,
  }),
})

const nodeRequire = createRequire(import.meta.url)
const materialized = registry.get('dsh-jumpserver')((spec) => {
  if (spec === 'react' || spec.startsWith('react/')) return nodeRequire(spec)
  throw new Error('BUNDLE_SMOKE_FAIL: unexpected require(' + spec + ') — the bundle should only depend on react')
})

if (typeof materialized?.apply !== 'function') {
  console.error('BUNDLE_SMOKE_FAIL: exports.apply is not a function', Object.keys(materialized ?? {}))
  process.exit(1)
}
if (!Array.isArray(materialized.inject) || !materialized.inject.includes('slots') || !materialized.inject.includes('betterSidebar')) {
  console.error('BUNDLE_SMOKE_FAIL: exports.inject must include slots + betterSidebar')
  process.exit(1)
}

const registrations = []
const tabDescriptors = []
const openCalls = []
const listeners = new Set()
let snapshot = { sessionId: 'session-1', state: undefined, prefs: {} }
const betterSidebar = {
  registerTab(descriptor) {
    tabDescriptors.push(descriptor)
    return () => {
      const at = tabDescriptors.indexOf(descriptor)
      if (at !== -1) tabDescriptors.splice(at, 1)
    }
  },
  openTab(seed, scope) {
    openCalls.push({ seed, scope })
  },
  closeTab() {}, updateTab() {}, activateTab() {}, openFile() {},
  subscribe() { return () => undefined },
  subscribeState(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
  getTabs: () => tabDescriptors,
  getFileViewers: () => [],
  getTab: () => undefined,
  isTabEnabled: () => true,
  isViewerEnabled: () => true,
  matchFileViewer: () => undefined,
  getSnapshot: () => snapshot,
  version: '0.17.1',
  features: ['targetedOpen', 'stateSubscription', 'badge', 'tabLifecycle', 'updateTab', 'openFile', 'tabMeta', 'pluginSettings'],
}
const effectCleanups = []
const ctx = {
  effect: (fn) => {
    const result = fn()
    const cleanup = () => {
      if (typeof result === 'function') result()
    }
    effectCleanups.push(cleanup)
    return cleanup
  },
  get: (name) => {
    if (name === 'connection') return { api: { credentials: { describe: async () => ({ result: { ok: true, value: { credentials: {} } } }), set: async () => ({}) } } }
    return undefined
  },
  locale: {
    bind: () => (key) => ({ tabTitle: 'JumpServer', follow: 'Follow', following: 'Following', clear: 'Clear', emptyTerminal: 'Waiting for connection…', readOnlyHint: 'read-only mirror' }[key] ?? key),
    register: () => undefined,
  },
  settingsScope: {
    bind: () => ({
      getSnapshot: () => ({ status: 'ready', writable: true, value: { autoOpenTerminal: true, terminalScrollback: 300 }, base: {}, user: {}, revision: 1 }),
      subscribe: () => () => undefined,
      set: async () => true,
      unset: async () => true,
    }),
  },
  betterSidebar,
  slots: {
    inject(name, callback) {
      registrations.push({ kind: 'inject', name })
      registrations.push({ kind: 'register', name, options: callback?.() })
      return () => undefined
    },
    register(options) {
      registrations.push({ kind: 'registerDirect', options })
      return () => undefined
    },
  },
}

let applyCleanup = () => undefined
try {
  const cleanup = materialized.apply(ctx)
  if (typeof cleanup === 'function') applyCleanup = () => { try { cleanup() } catch { /* already done */ } }
  // V0.2.4: no open may fire until the grant status arrives.
  if (openCalls.length !== 0) {
    console.error('BUNDLE_SMOKE_FAIL: auto-open must NOT fire before the grant status resolves')
    console.error('got:', JSON.stringify(openCalls))
    process.exit(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 50))
  applyCleanup()
} catch (error) {
  console.error('BUNDLE_SMOKE_FAIL: apply() threw:', error)
  process.exit(1)
}

const injected = registrations.filter((r) => r.kind === 'inject').map((r) => r.name)

// 1) settings card present.
if (!injected.includes('settings.plugin.item')) {
  console.error('BUNDLE_SMOKE_FAIL: settings.plugin.item must be declared')
  process.exit(1)
}
// 2) legacy entries ABSENT (V0.2.2: no >_ JumpServer button, no drawer).
for (const gone of ['conversation.session.header.utilities', 'shell.overlay']) {
  if (injected.includes(gone)) {
    console.error('BUNDLE_SMOKE_FAIL: legacy slot must NOT be declared: ' + gone)
    process.exit(1)
  }
}
// 3) one JumpServer tab registered.
if (tabDescriptors.length !== 1) {
  console.error('BUNDLE_SMOKE_FAIL: expected exactly one betterSidebar.registerTab, got ' + tabDescriptors.length)
  process.exit(1)
}
const descriptor = tabDescriptors[0]
if (descriptor.id !== 'dsh-jumpserver:terminal' || descriptor.order !== 45 || descriptor.single !== true || typeof descriptor.component !== 'function') {
  console.error('BUNDLE_SMOKE_FAIL: tab descriptor mismatch (id/order/single/component)')
  process.exit(1)
}
if (typeof descriptor.title !== 'function' || descriptor.title() !== 'JumpServer') {
  console.error('BUNDLE_SMOKE_FAIL: tab title must resolve to "JumpServer"')
  process.exit(1)
}

// 4) grant-gated auto-open (V0.2.4): after the bridge reports granted:true,
//    exactly one targeted openTab fired for the active session.
if (openCalls.length !== 1 || openCalls[0].seed?.type !== 'dsh-jumpserver:terminal' || openCalls[0].scope?.sessionId !== 'session-1') {
  console.error('BUNDLE_SMOKE_FAIL: auto-open must target openTab({type: TAB_ID}, {sessionId})')
  console.error('got:', JSON.stringify(openCalls))
  process.exit(1)
}

// 5) CROSS-PLUGIN CONTEXT BOUNDARY: render descriptor.component with a
//    better-sidebar ctx that exposes NOTHING (poisoned Proxy). The V0.2.2
//    component must mount because apply() closed over t/settingsScope —
//    reading props.ctx would throw here and fail the smoke.
const poisonedCtx = new Proxy({}, {
  get(_target, key) {
    throw new Error('BUNDLE_SMOKE_FAIL: tab component read props.ctx.' + String(key) + ' — the sidebar ctx must stay a black box')
  },
})
let rendered = ''
try {
  rendered = renderToStaticMarkup(
    createElement(descriptor.component, {
      ctx: poisonedCtx,
      store: {},
      scope: { sessionId: 'session-1' },
      tab: { id: 'dsh-jumpserver:terminal', type: 'dsh-jumpserver:terminal', title: 'JumpServer' },
      visible: true,
    }),
  )
} catch (error) {
  console.error('BUNDLE_SMOKE_FAIL: tab render (poisoned sidebar ctx):', error)
  process.exit(1)
}
if (!rendered.includes('js-term-pane')) {
  console.error('BUNDLE_SMOKE_FAIL: rendered tab content must contain the terminal pane')
  process.exit(1)
}
// The pane owns no tab chrome: no duplicate title element, no close button.
if (rendered.includes('js-term-headerTitle')) {
  console.error('BUNDLE_SMOKE_FAIL: duplicate title inside the tab content must be gone')
  process.exit(1)
}
if (/clear|Clear|清屏/.test(rendered) === false) {
  console.error('BUNDLE_SMOKE_FAIL: toolbar should still expose follow/clear actions')
  process.exit(1)
}

for (const cleanup of effectCleanups) {
  try {
    cleanup()
  } catch {
    /* already disposed */
  }
}

console.log('BUNDLE_SMOKE_PASS')
console.log('inject       =', JSON.stringify(materialized.inject))
console.log('slots        =', injected.join(', '))
console.log('legacy gone  = conversation.session.header.utilities, shell.overlay')
console.log('sidebar tab  =', descriptor.id, '(order ' + descriptor.order + ', single ' + descriptor.single + ')')
console.log('auto-open    ->', 'grant-gated; opened after granted:true for', openCalls[0].scope.sessionId)
console.log('ctx boundary = poisoned sidebar ctx render OK (no ctx.* reads)')

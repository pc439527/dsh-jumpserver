/** Native DSH Desktop 0.2.x browser integration. */
import * as React from 'react'
import { NS, en, zh } from './locales.js'
import { injectStyles } from './styles.js'
import { fetchStatus } from './api.js'
import { JumpServerSettingsCard, type SettingsCardProps } from './settings-card.js'
import type { BrowserCtx, NativeConfigForm } from './context.js'

// Only the guaranteed core service is injected. Native Desktop services are
// resolved from the live Context after activation so an older composition cannot
// stall the whole client boot.
export const inject = ['slots']

/** locale bind() -> plain object snapshot (re-read at every render, never stale). */
function tMap(bind: (key: string) => string): Record<string, string> {
  return new Proxy({} as Record<string, string>, {
    get: (_target, key) => (typeof key === 'string' ? bind(key) : undefined) as string | undefined ?? '',
  })
}

/** Adapt a native config form to the scope face the settings card renders from. */
function scopeFace(form: NativeConfigForm): SettingsCardProps['scope'] {
  return {
    getSnapshot: () => form.getSnapshot(),
    subscribe: (listener) => form.subscribe(listener),
    set: async (field, value) => {
      await form.set(field, value)
      return true
    },
    unset: async (field) => {
      await form.unset(field)
      return true
    },
  }
}

/** Secrets never transit a settings form; they go to the DSH credential store. */
function credentialsFace(ctx: BrowserCtx): SettingsCardProps['api'] {
  return {
    credentials: {
      describe: async ({ refs }) => {
        const response = await ctx.remote.credentials.describe(refs)
        return { result: { ok: response.ok, value: { credentials: response.value ?? {} } } }
      },
      set: async ({ ref, value }) => ctx.remote.credentials.set(ref, value),
    },
  }
}

/** Conversations that already auto-opened the tab (per page load). */
const autoOpenedFor = new Set<string>()

export function apply(ctx: BrowserCtx): void {
  injectStyles()
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'jumpserver: browser dictionaries')

  const form = ctx.configForms.get(NS)
  const scope = scopeFace(form)
  const api = credentialsFace(ctx)

  ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('plugins.item', () => ctx.slots.register({
    name: 'plugins.item',
    id: NS,
    order: 100,
    label: () => t('tabTitle'),
    locale: NS,
    inject: () => ({ t: tMap(t), scope, api }),
  }, JumpServerSettingsCard))), 'jumpserver: native settings page')

  ctx.effect(() => {
    const current = ctx.uiSession.adapter.current
    let disposed = false
    let inFlight = false

    // The console is only reachable after /jumpserver granted this conversation,
    // so the open stays gated on the Host-reported grant, never on a timer alone.
    const maybeOpen = (): void => {
      const sessionId = current.getSnapshot().key
      if (typeof sessionId !== 'string' || sessionId.length === 0 || autoOpenedFor.has(sessionId) || inFlight) return
      if ((scope.getSnapshot().value ?? {})['autoOpenTerminal'] !== true) return
      if (ctx.sidebarRightTabs.get('browser') === undefined) return
      inFlight = true
      void fetchStatus(sessionId, undefined)
        .then((status) => {
          if (disposed || status?.granted !== true || typeof status.consoleUrl !== 'string') return
          autoOpenedFor.add(sessionId)
          // The conversation id travels in the fragment: it never reaches the Host,
          // so it cannot leak into access logs or the discovery file.
          const separator = status.consoleUrl.includes('#') ? '&' : '#'
          ctx.sidebarRight.openTab('browser', { params: { url: status.consoleUrl + separator + 'session=' + encodeURIComponent(sessionId) } })
        })
        .catch(() => undefined)
        .finally(() => { inFlight = false })
    }

    maybeOpen()
    const offCurrent = current.subscribe(maybeOpen)
    const offSettings = scope.subscribe(maybeOpen)
    const poll = setInterval(maybeOpen, 2500)
    return () => {
      disposed = true
      offCurrent()
      offSettings()
      clearInterval(poll)
    }
  }, 'jumpserver: open native browser tab after conversation grant')
}

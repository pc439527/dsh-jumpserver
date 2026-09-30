/** Native DSH Desktop 0.2.x browser integration. */
import * as React from 'react'
import { NS, en, zh } from './locales.js'
import { injectStyles } from './styles.js'
import { fetchStatus } from './api.js'
import { JumpServerSettingsCard, type SettingsCardProps } from './settings-card.js'
import type { BrowserCtx, NativeConfigForm } from './context.js'

/**
 * Cordis refuses an undeclared service property access ("cannot get property
 * 'locale' without inject"), so every service apply() touches directly must be
 * declared here. This mirrors the official web-search settings plugin.
 *
 * The right-column services are deliberately NOT listed: they are resolved
 * through ctx.inject() below, so a composition without the sidebar degrades
 * instead of stalling the whole client entry on a pending dependency.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.credentials', 'configForms']

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

/**
 * Fire-and-forget activation trace -> <dsh home>/jumpserver/client-trace.jsonl.
 * The settings page mounts only when the Host actually serves this namespace,
 * which is invisible from the browser, so every mount gate is traced.
 */
function diag(event: string, detail?: Record<string, unknown>): void {
  try {
    void fetch('/api/jumpserver.diag', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event, detail }),
    }).catch(() => undefined)
  } catch {
    /* telemetry must never break the page */
  }
}

/**
 * Ask the Host whether a console page for this session is currently open.
 *
 * The right column cannot dedupe for us - the browser tab type is registered as
 * `multiple`, so every openTab makes a new tab. A module Set reset on every
 * reload (which stacked duplicates) and a sessionStorage record (which kept
 "opening" permanently recorded and so refused to open again after the
 * operator closed the tab) are both wrong. Live presence is the only signal that
 * answers both questions correctly.
 */
async function consoleAlreadyOpen(sessionId: string): Promise<boolean> {
  try {
    const response = await fetch('/api/jumpserver.consoleAlive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (!response.ok) return false
    const value = await response.json() as { active?: unknown }
    return value.active === true
  } catch {
    // Never block the console on a failed probe.
    return false
  }
}


export function apply(ctx: BrowserCtx): void {
  injectStyles()
  diag('apply:enter', { inject: ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'] })
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'jumpserver: browser dictionaries')

  const form = ctx.configForms.get(NS)
  const scope = scopeFace(form)
  const api = credentialsFace(ctx)
  diag('form:bound', { snapshot: form.getSnapshot()?.status ?? 'none' })

  // `settings.section` is the Settings page's own section slot - the one that
  // renders entries like "OpenCode Go" in the left navigation. `plugins.item`
  // would instead drop the card onto the separate Plugins page.
  ctx.effect(() => ctx.configForms.whileServed([NS], (served: Set<string>) => {
    diag('whileServed:fired', { served: Array.from(served ?? []) })
    return ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: NS,
      order: 30,
      label: () => t('tabTitle'),
      locale: NS,
      inject: () => ({ t: tMap(t), scope, api }),
    }, JumpServerSettingsCard))
  }), 'jumpserver: native settings page')

  // The right column is optional: without it the Host tools and the loopback
  // console still work, so this must never gate the settings page above.
  ctx.inject(['sidebarRight', 'sidebarRightTabs', 'uiSession'], (side) => {
    const current = side.uiSession.adapter.current
    let disposed = false
    let inFlight = false

    // The console is only reachable after /jumpserver granted this conversation,
    // so the open stays gated on the Host-reported grant, never on a timer alone.
    const maybeOpen = (): void => {
      const sessionId = current.getSnapshot().key
      if (typeof sessionId !== 'string' || sessionId.length === 0 || inFlight) return
      if ((scope.getSnapshot().value ?? {})['autoOpenTerminal'] !== true) return
      if (side.sidebarRightTabs.get('browser') === undefined) return
      inFlight = true
      void Promise.all([fetchStatus(sessionId, undefined), consoleAlreadyOpen(sessionId)])
        .then(([status, alreadyOpen]) => {
          // Live presence: a console is already showing this conversation, so do
          // not stack another tab beside it. Once it is closed the heartbeat
          // stops and the next tick opens a fresh one.
          if (alreadyOpen) return
          if (disposed || status?.granted !== true || typeof status.consoleUrl !== 'string') return
          // The conversation id travels in the fragment: it never reaches the Host,
          // so it cannot leak into access logs or the discovery file.
          const separator = status.consoleUrl.includes('#') ? '&' : '#'
          // revealIfOpened keeps a repeat open on the existing tab instead of
          // stacking another one beside it.
          side.sidebarRight.openTab('browser', {
            revealIfOpened: true,
            params: { url: status.consoleUrl + separator + 'session=' + encodeURIComponent(sessionId) },
          })
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
  })
}

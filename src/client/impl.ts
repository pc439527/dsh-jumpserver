/**
 * Browser half of dsh-jumpserver: settings card plus the terminal registered
 * as a dsh-better-sidebar tab. Pure thin client — transport/state/secrets stay
 * on the Host; the tab consumes redacted session-scoped bridge snapshots.
 */
import * as React from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar/src/client/service'
import { NS, en, zh } from './locales.js'
import { injectStyles } from './styles.js'
import { fetchStatus } from './api.js'
import { JumpServerSettingsCard } from './settings-card.js'
import { JumpServerSidebarTab, TAB_ID, TAB_ORDER, terminalIcon, type JumpServerSettingsScope } from './terminal-tab.js'
import type { BetterSidebarService, BrowserCtx } from './context.js'

/**
 * Services the loader must have up before this browser half activates.
 *
 * V0.4.0: `betterSidebar` is deliberately NOT in this list. It is a separate
 * plugin, and requiring it meant a DSH install without dsh-better-sidebar (for
 * example the desktop app) activated NOTHING — not even the settings card. A
 * missing sidebar now only skips the terminal tab; the loopback console
 * reported by jumpserver_status covers the terminal use case.
 */
export const inject = ['slots', 'locale', 'settingsScope', 'connection']

/** locale bind() -> plain object snapshot (re-read at every render, never stale). */
function tMap(bind: (key: string) => string): Record<string, string> {
  return new Proxy({} as Record<string, string>, {
    get: (_target, key) => (typeof key === 'string' ? bind(key) : undefined) as string | undefined ?? '',
  })
}

/** Sessions that already auto-opened the tab (per page load; a reload resets). */
const autoOpenedFor = new Set<string>()

export function apply(ctx: BrowserCtx): void {
  injectStyles()
  const locale = ctx.locale
  const t = locale.bind(NS)
  ctx.effect(() => locale.register(NS, { zh, en }), 'jumpserver: browser dictionaries')

  const scope = ctx.settingsScope.bind({ namespace: NS })
  const scopeApi = scope as unknown as JumpServerSettingsScope
  const connection = ctx.get('connection') as { api?: unknown }
  const api = (connection?.api ?? {}) as {
    credentials: {
      describe(args: { refs: string[] }): Promise<{ result: { ok: boolean; value?: { credentials?: Record<string, { configured?: boolean; writable?: boolean }> } } }>
      set(args: { ref: string; value: string }): Promise<unknown>
    }
  }

  const resolved = (): Record<string, unknown> => (scopeApi.getSnapshot().value ?? {}) as Record<string, unknown>
  const getAutoOpen = (): boolean => resolved()['autoOpenTerminal'] === true

  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register({
      name: 'settings.plugin.item',
      key: NS,
      locale: NS,
      inject: () => ({ t: tMap(t), scope, api }),
    }, JumpServerSettingsCard),
  )

  // Everything below is the optional better-sidebar integration.
  const sidebar = ctx.betterSidebar ?? (ctx.get('betterSidebar') as BetterSidebarService | undefined)
  if (sidebar === undefined) {
    ctx.effect(() => () => undefined, 'jumpserver: no dsh-better-sidebar — terminal tab skipped (use the loopback console)')
    return
  }

  // The React key is deliberately the Better Sidebar conversation id. A tab
  // descriptor is global, so without this key React may reuse one component
  // instance when the active conversation changes, carrying its old terminal
  // buffer/cursor/status into the new conversation. Remounting makes the
  // browser lifecycle match the Host's one-bundle-per-conversation lifecycle.
  ctx.effect(() => {
    const dispose = sidebar.registerTab({
      id: TAB_ID,
      title: () => t('tabTitle'),
      icon: (size: number) => terminalIcon(size),
      order: TAB_ORDER,
      single: true,
      component: (props: TabComponentProps) =>
        React.createElement(JumpServerSidebarTab, {
          key: props.scope.sessionId,
          ...props,
          t,
          settingsScope: scopeApi,
        }),
    })
    return dispose
  }, 'jumpserver: register terminal tab in dsh-better-sidebar')

  // Auto-open is session-targeted AND grant-gated (V0.2.4): the terminal tab
  // only auto-opens after this conversation has been explicitly authorized via
  // /jumpserver. Opening the terminal itself must not imply JumpServer use —
  // the grant is what unlocks the tools, and the tab is only a mirror.
  ctx.effect(() => {
    const sessionIdOf = (): string | undefined => (sidebar.getSnapshot() as { sessionId?: string })?.sessionId
    const maybeOpen = (sessionId: string): void => {
      if (autoOpenedFor.has(sessionId)) return
      if (getAutoOpen() !== true) return
      void fetchStatus(sessionId, undefined)
        .then((data) => {
          if (autoOpenedFor.has(sessionId)) return
          if (data?.granted === true) {
            autoOpenedFor.add(sessionId)
            sidebar.openTab({ type: TAB_ID }, { sessionId })
          }
        })
        .catch(() => undefined)
    }
    const notify = (): void => {
      const sessionId = sessionIdOf()
      if (sessionId !== undefined) maybeOpen(sessionId)
    }
    notify()
    const unsubscribe = sidebar.subscribeState(notify)
    const poll = setInterval(notify, 2500)
    return () => {
      unsubscribe()
      clearInterval(poll)
    }
  }, 'jumpserver: auto-open terminal tab per active session after /jumpserver grant')
}

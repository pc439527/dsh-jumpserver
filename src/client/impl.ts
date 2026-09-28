/**
 * Browser half of dsh-jumpserver: settings card plus (optionally) the terminal
 * registered as a dsh-better-sidebar tab. Pure thin client — transport/state/
 * secrets stay on the Host; the tab consumes redacted session-scoped bridge
 * snapshots.
 *
 * V0.4.1 ACTIVATION CONTRACT (learned the hard way): an entry that stays
 * `pending` on an unsatisfied service ABORTS the whole web boot ("web boot: 1
 * entry did not activate"). `inject` may therefore list ONLY services the
 * shell is guaranteed to provide. Everything else — the sidebar registry, the
 * locale service, the settings seam — is resolved through `ctx.get(...)` and
 * degrades gracefully:
 *
 *   inject = ['slots']          // the only seat a settings card needs
 *   betterSidebar  -> optional  (dsh-better-sidebar; the console replaces it)
 *   locale         -> optional  (fallback copy when absent)
 *   connection.api.settings/credentials -> optional (card degrades to read-only)
 */
import * as React from 'react'
import type { TabComponentProps } from 'dsh-better-sidebar/src/client/service'
import { NS, en, zh } from './locales.js'
import { injectStyles } from './styles.js'
import { fetchStatus } from './api.js'
import { JumpServerSettingsCard } from './settings-card.js'
import { JumpServerSidebarTab, TAB_ID, TAB_ORDER, terminalIcon, type JumpServerSettingsScope } from './terminal-tab.js'
import { NamespaceSettingsScope, type SettingsApiFace } from './settings-adapter.js'
import type { BetterSidebarService, BrowserCtx } from './context.js'

/**
 * The ONLY injected service. `slots` is provided by the client runtime itself
 * (@deepseek-ai/dsh-client-runtime) and is what the settings card registers
 * into; every other service this plugin uses is optional and read with
 * `ctx.get`, so a composition without it can never stall the boot.
 */
export const inject = ['slots']

/** locale bind() -> plain object snapshot (re-read at every render, never stale). */
function tMap(bind: (key: string) => string): Record<string, string> {
  return new Proxy({} as Record<string, string>, {
    get: (_target, key) => (typeof key === 'string' ? bind(key) : undefined) as string | undefined ?? '',
  })
}

interface CredentialsApi {
  credentials: {
    describe(args: { refs: string[] }): Promise<{ result: { ok: boolean; value?: { credentials?: Record<string, { configured?: boolean; writable?: boolean }> } } }>
    set(args: { ref: string; value: string }): Promise<unknown>
  }
}

/** Sessions that already auto-opened the tab (per page load; a reload resets). */
const autoOpenedFor = new Set<string>()

export function apply(ctx: BrowserCtx): void {
  injectStyles()

  // ---- optional: i18n -----------------------------------------------------
  const locale = ctx.get('locale') as BrowserCtx['locale'] | undefined
  const t: (key: string) => string = locale !== undefined
    ? locale.bind(NS)
    : (key: string) => ({ tabTitle: 'JumpServer' }[key] ?? key)
  if (locale !== undefined) ctx.effect(() => locale.register(NS, { zh, en }), 'jumpserver: browser dictionaries')

  // ---- optional: settings + credentials over the connection seam ----------
  const connection = ctx.get('connection') as { api?: unknown } | undefined
  const connectionApi = (connection?.api ?? undefined) as (SettingsApiFace & Partial<CredentialsApi>) | undefined
  let scope: JumpServerSettingsScope | undefined
  if (connectionApi !== undefined && typeof connectionApi.settings?.describe === 'function') {
    scope = new NamespaceSettingsScope(connectionApi as SettingsApiFace, NS)
  }

  if (scope !== undefined) {
    const api = { credentials: connectionApi?.credentials } as unknown
    ctx.slots.inject('settings.plugin.item', () =>
      ctx.slots.register({
        name: 'settings.plugin.item',
        key: NS,
        locale: NS,
        inject: () => ({ t: tMap(t), scope, api }),
      }, JumpServerSettingsCard),
    )
  }

  // ---- optional: better-sidebar terminal tab ------------------------------
  const sidebar = ctx.get('betterSidebar') as BetterSidebarService | undefined
  if (sidebar === undefined) {
    // No sidebar plugin installed (a plain desktop install): nothing else to
    // register here. The Host's loopback console is the terminal for this
    // install, and jumpserver_status hands out its URL.
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
          settingsScope: scope as JumpServerSettingsScope,
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
      if (scope === undefined) return
      if ((scope.getSnapshot().value ?? {})['autoOpenTerminal'] !== true) return
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
    // Settings arrive asynchronously over the connection, so "autoOpenTerminal
    // just became true" must re-run the decision immediately instead of waiting
    // for the next poll tick.
    const settingsScope = scope
    const unsubscribeScope = settingsScope === undefined ? () => undefined : settingsScope.subscribe(() => notify())
    const poll = setInterval(notify, 2500)
    return () => {
      unsubscribe()
      unsubscribeScope()
      clearInterval(poll)
    }
  }, 'jumpserver: auto-open terminal tab per active session after /jumpserver grant')
}

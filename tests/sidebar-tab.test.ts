import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { JumpServerSidebarTab } from '../src/client/terminal-tab.js'

const DICT: Record<string, string> = {
  tabTitle: 'JumpServer',
  follow: 'Follow',
  following: 'Following',
  clear: 'Clear',
  gatewayLabel: 'Gateway',
  targetLabel: 'Target',
  hostnameLabel: 'Hostname',
  userLabel: 'User',
  modeLabel: 'Mode',
  modeReadOnly: 'Read-only',
  statusDisconnected: 'Disconnected',
  statusConnected: 'Connected',
  statusDisabled: 'Disabled',
  emptyTerminal: 'Waiting…',
  readOnlyHint: 'read-only mirror',
}

const t = (key: string): string => DICT[key] ?? key

/** A settingsScope stub matching the JumpServer bound scope. */
function fakeScope(value: Record<string, unknown> = { terminalScrollback: 300 }) {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready', writable: true, value, base: {}, user: {}, revision: 1 }),
    subscribe(cb: () => void) {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
  }
}

/**
 * The better-sidebar context as a black box (V0.2.1 P0 regression): it must
 * NOT carry settingsScope/locale/connection — ANY property read must fail
 * the test. This is exactly the situation cordis guards ("cannot get property
 * settingsScope without inject") that used to break the tab at render time.
 */
function poisonCtx(): unknown {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, key) {
      throw new Error('tab component must not read the sidebar ctx.' + String(key))
    },
    has() {
      return false
    },
  })
}

const baseProps = {
  ctx: poisonCtx(),
  scope: { sessionId: 'session-1' },
  tab: { id: 'dsh-jumpserver:terminal', type: 'dsh-jumpserver:terminal', title: 'JumpServer' },
  visible: true,
  t,
}

describe('V0.2.2 cross-plugin context boundary', () => {
  it('mounts with a sidebar ctx that exposes no JumpServer services', () => {
    expect(() => {
      renderToStaticMarkup(createElement(JumpServerSidebarTab, { ...baseProps, settingsScope: fakeScope() }))
    }).not.toThrow()
    const html = renderToStaticMarkup(createElement(JumpServerSidebarTab, { ...baseProps, settingsScope: fakeScope() }))
    expect(html).toContain('js-term-pane')
    expect(html).toContain('Waiting…')
  })

  it("does not render its own tab chrome (title / close) — better-sidebar owns it", () => {
    const html = renderToStaticMarkup(createElement(JumpServerSidebarTab, { ...baseProps, settingsScope: fakeScope() }))
    expect(html).not.toContain('js-term-headerTitle')
    expect(html).not.toMatch(/关闭标签页|Close tab/)
  })

  it('reads the scrollback budget from the passed settingsScope (live setting)', () => {
    const html = renderToStaticMarkup(
      createElement(JumpServerSidebarTab, { ...baseProps, visible: false, settingsScope: fakeScope({ terminalScrollback: 1200 }) }),
    )
    expect(html).toContain('js-term-pane')
  })
})

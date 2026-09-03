import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { JumpServerSidebarTab } from '../src/client/terminal-tab.js'

const scope = { getSnapshot: () => ({ status: 'ready', writable: true, value: { terminalScrollback: 5000 }, base: {}, user: {}, revision: 1 }), subscribe: () => () => {} }
const props = { ctx: {}, scope: { sessionId: 'browser-regression' }, tab: { id: 'dsh-jumpserver:terminal', type: 'dsh-jumpserver:terminal', title: 'JumpServer' }, visible: true, settingsScope: scope, t: (key: string) => key }

describe('minimal browser interaction regressions', () => {
  it('renders an explicit end-and-lock control without owning tab-close chrome', () => {
    const html = renderToStaticMarkup(createElement(JumpServerSidebarTab, props as never))
    expect(html).toContain('结束并锁定')
    expect(html).toContain('关闭 SSH 并撤销本对话授权')
    expect(html).not.toMatch(/关闭标签页|Close tab/)
  })

  it('stays mountable while temporarily hidden (tab switching must not terminate)', () => {
    const html = renderToStaticMarkup(createElement(JumpServerSidebarTab, { ...props, visible: false } as never))
    expect(html).toContain('js-term-pane')
    expect(html).toContain('结束并锁定')
  })
})

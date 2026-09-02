import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sessionIdOf } from '../src/tools/common.js'
import { applySnapshot, createTerminalBuffer } from '../src/client/terminal-view.js'
import { JumpServerSidebarTab } from '../src/client/terminal-tab.js'

describe('V0.2.3 hotfix regressions', () => {
  it('keys JumpServer ownership by agent.session.header.id, never shared agent.id', () => {
    const signal = new AbortController().signal
    const a = {
      agent: { id: 'shared-agent-preset', session: { header: { id: 'conversation-A' } } },
      signal,
    } as unknown as Parameters<typeof sessionIdOf>[0]
    const b = {
      agent: { id: 'shared-agent-preset', session: { header: { id: 'conversation-B' } } },
      signal,
    } as unknown as Parameters<typeof sessionIdOf>[0]

    expect(sessionIdOf(a)).toBe('conversation-A')
    expect(sessionIdOf(b)).toBe('conversation-B')
    expect(sessionIdOf(a)).not.toBe(sessionIdOf(b))
  })

  it('sanitizes the real KoKo connect/probe noise seen in production', () => {
    const ESC = '\x1b'
    const BEL = '\x07'
    const BS = '\b'
    const buffer = createTerminalBuffer(500)
    const raw = [
      '开始连接到 root(root)@203.0.113.99  0.0' + BS + BS + BS + '0.1' + BS + BS + BS + '7.1\r\n',
      ESC + ']2;ssh://root@203.0.113.99' + BEL + 'Last login: Tue Sep  1 11:03:37 2026 from 203.0.113.10\r\n',
      "> '\r\n",
      ESC + ']0;root@web-nginx-01:~' + BEL + "[root@web-nginx-01 ~]# printf 'H=%s\\n' \"$(hostname 2>/dev/null || echo ?)\"\r\n",
      'H=web-nginx-01\r\n',
      ESC + ']0;root@web-nginx-01:~' + BEL + "[root@web-nginx-01 ~]# printf 'U=%s\\n' \"$(whoami 2>/dev/null || echo ?)\"\r\n",
      'U=root\r\n',
      ESC + ']0;root@web-nginx-01:~' + BEL + "[root@web-nginx-01 ~]# printf 'P=%s\\n' \"$(pwd 2>/dev/null || echo ?)\"\r\n",
      'P=/root\r\n',
    ].join('')

    applySnapshot(buffer, {
      lastSeq: 1,
      events: [{ seq: 1, timestamp: 1, type: 'output', data: raw }],
    }, 0)

    const text = buffer.rows
      .filter((row) => row.kind === 'output')
      .map((row) => row.kind === 'output' ? row.segments.map((s) => s.text).join('') : '')
      .join('\n')

    expect(text).toContain('7.1')
    expect(text).toContain('Last login:')
    expect(text).not.toContain('0.0')
    expect(text).not.toContain(ESC)
    expect(text).not.toContain(BS)
    expect(text).not.toContain("printf 'H=%s")
    expect(text).not.toContain("printf 'U=%s")
    expect(text).not.toContain("printf 'P=%s")
    expect(text).not.toMatch(/^[HUP]=/m)
    expect(text).not.toContain("> '")
  })

  it('renders the manual command bar while leaving Better Sidebar chrome untouched', () => {
    const settingsScope = {
      getSnapshot: () => ({ status: 'ready', writable: true, value: { terminalScrollback: 500 }, base: {}, user: {}, revision: 1 }),
      subscribe: () => () => undefined,
    }
    const html = renderToStaticMarkup(createElement(JumpServerSidebarTab, {
      ctx: {},
      scope: { sessionId: 'conversation-A' },
      tab: { id: 'dsh-jumpserver:terminal', type: 'dsh-jumpserver:terminal', title: 'JumpServer' },
      visible: false,
      t: (key: string) => key,
      settingsScope,
    }))

    expect(html).toContain('js-term-manual')
    expect(html).toContain('manualUnavailable')
    expect(html).toContain('js-term-actions')
    expect(html).not.toContain('js-term-headerBtn')
  })
})

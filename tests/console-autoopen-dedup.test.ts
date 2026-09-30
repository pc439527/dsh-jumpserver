import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, '..', 'src', 'client', 'impl.ts'), 'utf8')
const page = readFileSync(join(here, '..', 'src', 'runtime', 'console-page.ts'), 'utf8')

/**
 * Auto-open is an EDGE, not an invariant.
 *
 * Three earlier designs failed in three different ways:
 *   - a module Set, reset on every reload, stacked a tab per visit (observed 3);
 *   - a sessionStorage record outlived the tab being closed, so nothing ever
 *     opened again;
 *   - presence plus a 60s cooldown merely DELAYED re-creating a console the
 *     operator had deliberately closed.
 *
 * The contract now: open once when the conversation becomes granted, then leave
 * it alone. Presence only prevents stacking beside a live one.
 */
describe('console auto-open', () => {
  it('opens on the granted transition, not on every observation', () => {
    expect(client).toContain('grantSeen')
    expect(client).toMatch(/if \(!granted \|\| wasGranted\) return/)
  })

  it('no longer re-creates a console that was closed', () => {
    expect(client).not.toContain('OPEN_COOLDOWN_MS')
    expect(client).not.toContain('openedAt')
  })

  it('keeps only one tab when one is already on screen', () => {
    expect(client).toContain('consoleAlreadyOpen')
    expect(client).toContain('/api/jumpserver.consoleAlive')
  })
})

describe('console presence heartbeat', () => {
  it('beats to the presence endpoint, never to the trace log', () => {
    // A /diag heartbeat appended a trace line every few seconds, forever, for
    // every console that was merely open.
    expect(page).toContain('/api/jumpserver.consoleAlive')
    expect(page).toContain('heartbeat: true')
    expect(page).toContain('setInterval(heartbeat')
    expect(page).not.toContain('console:alive')
  })
})

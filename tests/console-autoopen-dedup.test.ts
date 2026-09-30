import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const client = readFileSync(join(here, '..', 'src', 'client', 'impl.ts'), 'utf8')
const page = readFileSync(join(here, '..', 'src', 'runtime', 'console-page.ts'), 'utf8')

/**
 * The right column registers the browser tab type as multiple, so every openTab
 * creates a NEW tab and the right column cannot dedupe for us. Two earlier
 * attempts were both wrong:
 *
 *   - a module Set, reset on every reload, stacked a tab per visit (observed 3);
 *   - a sessionStorage record, which stayed written after the operator CLOSED
 *     the tab, so the console stopped opening at all.
 *
 * Presence is the only signal that answers both questions, so the console page
 * must heartbeat and the client must consult the Host before opening.
 */
describe('console auto-open dedup', () => {
  it('asks the Host whether a console is already open', () => {
    expect(client).toContain('/api/jumpserver.consoleAlive')
    expect(client).toContain('consoleAlreadyOpen')
  })

  it('no longer relies on state that survives a close', () => {
    // Match real calls, not the prose explaining why they were removed.
    expect(client).not.toMatch(/sessionStorage[.]getItem/)
    expect(client).not.toMatch(/autoOpenedFor[.]/)
  })

  it('has the console page heartbeat its presence', () => {
    expect(page).toContain('console:alive')
    expect(page).toContain('setInterval(heartbeat')
  })
})

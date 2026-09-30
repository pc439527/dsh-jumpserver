import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'src', 'client', 'impl.ts'), 'utf8')

/**
 * The auto-open guard must survive a page reload.
 *
 * It was a module-level Set, which resets on every reload, so each visit to the
 * settings page stacked another identical JumpServer console tab in the right
 * column (observed: three side by side). sessionStorage outlives a reload.
 */
describe('console auto-open guard', () => {
  it('persists opened sessions instead of keeping them in module state', () => {
    expect(source).toContain('sessionStorage')
    expect(source).not.toContain('autoOpenedFor')
  })

  it('asks the right column to reveal an existing tab rather than stacking', () => {
    expect(source).toContain('revealIfOpened')
  })
})

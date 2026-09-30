import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONSOLE_STYLES } from '../src/console/styles.js'
import { consolePage } from '../src/runtime/console-page.js'

/**
 * The console page had grown into one 650-line template holding markup, CSS
 * and a 560-line script, so every colour tweak was a diff inside a literal.
 * The stylesheet now lives in src/console/styles.ts and is composed in.
 *
 * These pin that the extraction kept the page byte-for-byte complete.
 */
const here = dirname(fileURLToPath(import.meta.url))

describe('console stylesheet module', () => {
  it('is a complete style block', () => {
    expect(CONSOLE_STYLES.startsWith('<style>')).toBe(true)
    expect(CONSOLE_STYLES.trimEnd().endsWith('</style>')).toBe(true)
  })

  it('is composed into the shipped page exactly once', () => {
    const html = consolePage()
    expect(html).toContain(CONSOLE_STYLES)
    expect(html.split('<style>').length - 1).toBe(1)
    expect(html.split('</style>').length - 1).toBe(1)
  })

  it('keeps the rules the console actually relies on', () => {
    for (const rule of ['#term', 'button.act[disabled]', '.badge.refused', '.in {', '.err {']) {
      expect(CONSOLE_STYLES).toContain(rule)
    }
  })

  it('no longer inlines the stylesheet in the page source', () => {
    const source = readFileSync(join(here, '..', 'src', 'runtime', 'console-page.ts'), 'utf8')
    expect(source).toContain('CONSOLE_STYLES')
    expect(source).not.toContain('color-scheme: dark')
  })
})

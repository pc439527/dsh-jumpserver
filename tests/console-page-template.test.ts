import { describe, expect, it } from 'vitest'
import { consolePage } from '../src/runtime/console-page.js'

/**
 * The console page is shipped as a String.raw template literal.
 *
 * A backtick ANYWHERE inside it - including inside a comment or a CSS value -
 * terminates the template early and the page stops parsing. This was hit four
 * times while editing, each time as a confusing syntax error pointing at an
 * unrelated line. The guard is cheap and the failure it prevents is not.
 */
const BACKTICK = String.fromCharCode(96)

describe('console page template safety', () => {
  it('renders a complete document', () => {
    const html = consolePage()
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html.trimEnd().endsWith('</html>')).toBe(true)
  })

  it('ships no stray backtick that would truncate it', () => {
    const source = consolePage()
    for (let i = 0; i < source.length; i++) {
      if (source.charAt(i) !== BACKTICK) continue;
      const where = source.slice(Math.max(0, i - 60), i + 60).replace(/\s+/g, ' ')
      throw new Error('backtick at ' + String(i) + ' in: ' + where)
    }
    expect(source.includes(BACKTICK)).toBe(false)
  })

  it('parses its inline script as real JavaScript', () => {
    const src = /<script[^>]*>([\s\S]*?)<\/script>/.exec(consolePage())![1]!
    // Throws on a syntax error, which is exactly the failure mode above.
    expect(() => new Function(src)).not.toThrow()
  })
})

import { describe, expect, it } from 'vitest'
import { consolePage } from '../src/runtime/console-page.js'

/**
 * The console page is one inline <script>. If that script does not PARSE, the
 * browser renders the static HTML and silently wires nothing: no tab
 * switching, no buttons, no polling - the console looks alive but is dead.
 * That exact failure shipped once: the page lived in a plain template literal,
 * which processed `\\)` into `\)` and left a regex group unterminated.
 *
 * So this parses the emitted script the way the browser would, rather than
 * asserting on substrings that would still pass with broken JavaScript.
 */
function scriptOf(html: string): string {
  const match = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (match === null) throw new Error('console page has no inline script')
  return match[1]!
}

describe('console page script', () => {
  it('parses as JavaScript', () => {
    const source = scriptOf(consolePage())
    expect(() => new Function(source)).not.toThrow()
  })

  it('reads the conversation from the fragment, never from a token', () => {
    const source = scriptOf(consolePage())
    expect(source).toContain('location.hash')
    expect(source).not.toContain('x-console-token')
    expect(source).not.toContain('__TOKEN__')
  })

  it('wires the interactive controls the page ships', () => {
    const html = consolePage()
    const source = scriptOf(html)
    // Tab buttons live in the markup; their handlers live in the script.
    expect((html.match(/data-tab=/g) ?? []).length).toBe(4)
    for (const hook of ['addEventListener', 'onclick', 'setInterval']) {
      expect(source).toContain(hook)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { consolePage } from '../src/runtime/console-page.js'
import { createLineFramer, feedLines } from '../src/client/ansi.js'

/**
 * The console page and the sidebar terminal must agree on what a PTY byte
 * stream LOOKS like. They are separate compilation units — the page is a string
 * served to the browser and cannot import anything — so the only thing keeping
 * them honest is this comparison.
 *
 * The console once mapped a lone CR to a newline and ignored BS entirely, which
 * rendered the bastion's connection progress as '???0.5 ... ???3.9'. This test
 * fails on that code and passes only when both sides fold redraws identically.
 */
function scriptOf(html: string): string {
  const match = /<script[^>]*>([\s\S]*?)<\/script>/.exec(html)
  if (match === null) throw new Error('console page has no inline script')
  return match[1]!
}

/** Pull the shipped `strip` out of the page and run it, testing real code. */
function pageStrip(): (input: string) => string {
  const source = scriptOf(consolePage())
  const start = source.indexOf('function strip(s) {')
  if (start === -1) throw new Error('console page no longer defines strip()')
  let depth = 0
  let i = source.indexOf('{', start)
  for (let j = i; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') {
      depth--
      if (depth === 0) {
        const fn = source.slice(start, j + 1)
        return new Function('return (' + fn + ')')() as (input: string) => string
      }
    }
  }
  throw new Error('unterminated strip() in the console page')
}

/** The reference rendering: what the sidebar terminal shows. */
function reference(text: string): string {
  const state = createLineFramer();
  const rows = feedLines(state, text).map((segments) => segments.map((s) => s.text).join(''))
  // A live terminal also shows the not-yet-completed line, so the reference
  // must include the framer's pending line or the comparison would be unfair.
  const pending = state.line.map((s) => s.text).join('')
  if (pending.length > 0) rows.push(pending)
  return rows.join('\n')
}

const CORPUS: Array<[string, string]> = [
  ['plain', 'hello world'],
  ['backspace progress', '\b\b\b2.9'],
  ['partial backspace', 'abc\bz'],
  ['backspace past line start', '\b\bstart'],
  ['lone CR overwrite', '50%\r100%'],
  ['CRLF', 'one\r\ntwo'],
  ['LF only', 'one\ntwo'],
  ['CR then BS then text', 'abcd\r\b\bXY'],
  ['CSI colour', '\u001b[31mred\u001b[0m plain'],
  ['OSC title', '\u001b]0;root@ubtsvr:~\u0007prompt# '],
  ['BEL dropped', 'ding\u0007dong'],
  ['tab kept', 'a\tb'],
  ['NUL dropped', 'a\u0000b'],
  ['mixed redraw', '\b\b\b0.5\b\b\b0.6\r  done\nnext'],
  ['trailing newline', 'done\n'],
  ['empty', ''],
]

describe('console page strip() matches the terminal line framer', () => {
  it('ships a strip() implementation', () => {
    expect(typeof pageStrip()).toBe('function')
  })

  for (const [name, input] of CORPUS) {
    it('folds ' + name + ' the same way as src/client/ansi.ts', () => {
      const actual = pageStrip()(input)
      const expected = reference(input)
      expect(actual).toBe(expected)
    })
  }

  it('erases backspaces instead of emitting stray characters', () => {
    const out = pageStrip()('\b\b\b2.9')
    expect(out).toBe('2.9')
    expect(out).not.toContain('\b')
    expect(out).not.toContain('?')
  })

  it('treats a lone CR as an overwrite, not a line break', () => {
    expect(pageStrip()('50%\r100%')).toBe('100%')
    expect(pageStrip()('50%\r100%')).not.toContain('\n')
  })
})

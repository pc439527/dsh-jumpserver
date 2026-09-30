import { describe, expect, it } from 'vitest'
import { consolePage } from '../src/runtime/console-page.js'

/**
 * Pull a top-level function declaration out of the shipped console page.
 *
 * The page is a string the browser evaluates, so the only way to test what
 * actually ships is to extract and run it, as the browser would.
 */
function fromPage(name: string): unknown {
  const src = /<script[^>]*>([\s\S]*?)<\/script>/.exec(consolePage())![1]!
  const start = src.indexOf('function ' + name + '(')
  if (start === -1) throw new Error('console page no longer defines ' + name + '()')
  let depth = 0
  let end = -1
  for (let k = src.indexOf('{', start); k < src.length; k++) {
    if (src[k] === '{') depth++
    else if (src[k] === '}') { depth--; if (depth === 0) { end = k; break } }
  }
  return new Function('return (' + src.slice(start, end + 1) + ')')()
}

interface Renderer {
  render(chunk: string): string
  renderTake(chunk: string): { out: string; pending: string }
}

function newRenderer(): Renderer {
  const make = fromPage('makeRenderer') as () => Renderer
  return make()
}

/**
 * Everything the operator would see for a whole stream.
 *
 * The renderer keeps state, so the visible text is every COMPLETED line plus the
 * one line still being written - not the sum of each chunk's pending text, which
 * would count an unfinished line once per chunk.
 */
function visible(chunks: string[]): string {
  const r = newRenderer()
  let done = ''
  let pending = ''
  for (const c of chunks) {
    const step = r.renderTake(c)
    done += step.out
    pending = step.pending
  }
  return done + pending
}

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const BS = String.fromCharCode(8)

const CORPUS: Array<[string, string]> = [
  ['plain', 'hello world'],
  ['progress overwrite', '50%\r100%'],
  ['backspace progress', BS + BS + BS + '2.9'],
  ['partial backspace', 'abc' + BS + 'z'],
  ['csi colour', ESC + '[31mred' + ESC + '[0m plain'],
  ['osc title', ESC + ']0;root@host:~' + BEL + 'root@host:~# '],
  ['cr then backspaces', 'abcd\r' + BS + BS + 'XY'],
  ['crlf line', 'line1\r\nline2'],
  ['csi erase', ESC + '[2J' + ESC + '[Hcleared'],
  ['trailing backspace', 'trailing ' + BS],
  ['bel dropped', 'ding' + BEL + 'dong'],
  ['mixed redraw', BS + BS + BS + '0.5' + BS + BS + BS + '0.6\r  done\nnext'],
];

describe('console terminal renderer', () => {
  it('ships a stateful renderer', () => {
    expect(typeof newRenderer().renderTake).toBe('function')
  })

  for (const [name, sample] of CORPUS) {
    it('renders ' + name + ' identically for EVERY chunk split', () => {
      const whole = visible([sample])
      for (let cut = 0; cut <= sample.length; cut++) {
        const split = visible([sample.slice(0, cut), sample.slice(cut)])
        expect(split).toBe(whole)
      }
    })
  }

  it('treats a lone CR as an overwrite, not a line break', () => {
    const out = visible(['50%\r100%'])
    expect(out).toBe('100%')
    expect(out).not.toContain('\n')
  })

  it('erases backspaces instead of emitting stray characters', () => {
    const out = visible([BS + BS + BS + '2.9'])
    expect(out).toBe('2.9')
    expect(out).not.toContain('?')
    expect(out).not.toContain(BS)
  })

  it('does not leak a half escape sequence as text', () => {
    const out = visible([ESC + '[31', 'mred'])
    expect(out).toBe('red')
    expect(out).not.toContain('[31')
  })
});

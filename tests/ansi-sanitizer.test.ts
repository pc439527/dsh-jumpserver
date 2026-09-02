import { describe, expect, it } from 'vitest'
import { createLineFramer, feedLines, parseAnsi, stripAnsi, type LineFramerState } from '../src/client/ansi.js'

function render(rows: Array<Array<{ text: string; cls: string | null }>>): string[] {
  return rows.map((r) => r.map((s) => s.text).join(''))
}

/** Feed several chunks through one framer and return the completed lines. */
function feed(framer: LineFramerState, ...chunks: string[]): string[] {
  const lines: string[] = []
  for (const chunk of chunks) lines.push(...render(feedLines(framer, chunk)))
  return lines
}

const ESC = '\x1b'

describe('V0.2.3 ANSI/VT100 sanitizer', () => {
  it('consumes cursor-home + clear-screen + erase-line CSI (the KoKo "乱码")', () => {
    const framer = createLineFramer()
    const lines = feed(framer, ESC + '[H' + ESC + '[2J' + 'Hello' + ESC + '[K' + '\n')
    expect(lines).toEqual(['Hello'])
  })

  it('consumes cursor show/hide private-mode CSI', () => {
    const framer = createLineFramer()
    const lines = feed(framer, ESC + '[?25l' + 'hidden' + ESC + '[?25h' + '\n')
    expect(lines).toEqual(['hidden'])
  })

  it('consumes cursor-move CSI with arguments', () => {
    const framer = createLineFramer()
    const lines = feed(framer, 'one' + ESC + '[1A' + ESC + '[2C' + ESC + '[3;4H' + 'two\n')
    expect(lines).toEqual(['onetwo'])
  })

  it('keeps SGR colors as CSS classes', () => {
    const framer = createLineFramer()
    const rows = feedLines(framer, ESC + '[32mgreen' + ESC + '[0m' + 'plain\n')
    expect(rows[0]!.map((s) => s.text).join('')).toBe('greenplain')
    expect(rows[0]![0]).toMatchObject({ text: 'green', cls: 'js-term-fg-2' })
    expect(rows[0]![1]).toMatchObject({ text: 'plain', cls: null })
  })

  it('consumes OSC title sequences', () => {
    const framer = createLineFramer()
    const lines = feed(framer, ESC + ']0;ksh title' + '\x07' + 'body\n')
    expect(lines).toEqual(['body'])
  })

  it('folds lone-CR progress redraws into ONE final line', () => {
    const framer = createLineFramer()
    const lines = feed(framer, 'Connecting 10%\rConnecting 50%\rConnecting 90%\n')
    expect(lines).toEqual(['Connecting 90%'])
  })

  it('treats CRLF as one line break', () => {
    const framer = createLineFramer()
    const lines = feed(framer, 'a\r\nb\r\n')
    expect(lines).toEqual(['a', 'b'])
  })

  it('carries an escape split across chunks', () => {
    const framer = createLineFramer()
    expect(feed(framer, 'text' + ESC + '[')).toEqual([])
    expect(framer.esc.length).toBeGreaterThan(0)
    const lines = feed(framer, '2J' + 'rest\n')
    expect(lines).toEqual(['textrest'])
  })

  it('backspace deletes the previous character', () => {
    const framer = createLineFramer()
    const lines = feed(framer, 'abc\bX\n')
    expect(lines).toEqual(['abX'])
  })

  it('drops other control bytes (NUL/BEL) without rendering', () => {
    const framer = createLineFramer()
    const lines = feed(framer, 'a\x00b\x07c\n')
    expect(lines).toEqual(['abc'])
  })

  it('parseAnsi consumes non-SGR CSI in a single line', () => {
    const segments = parseAnsi(ESC + '[H' + ESC + '[2J' + 'ok')
    expect(segments.map((s) => s.text).join('')).toBe('ok')
  })

  it('stripAnsi removes every escape family', () => {
    expect(stripAnsi(ESC + '[32m green ' + ESC + '[0m' + ESC + '[?25l' + ESC + ']0;t\x07' + 'x')).toBe(' green x')
  })
})

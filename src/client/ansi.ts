/**
 * V0.2.3 ANSI/VT100 sanitizer for the terminal mirror (P1).
 *
 * The old renderer only recognized SGR color escapes (ESC [ ... m); every
 * other control sequence KoKo emits — ESC[H cursor-home, ESC[2J clear-screen,
 * ESC[K erase-line, ESC[?25h/l cursor show/hide, cursor moves, OSC title
 * (ESC ] 0; ... BEL), CR-overwriting progress banners — leaked into the HTML
 * as literal garbage. This module is a small VT100 sanitizer sitting between
 * the raw PTY chunk stream and the rendered rows:
 *
 *   - SGR colors -> kept, mapped to CSS classes (js-term-fg-N / bold / dim)
 *   - CSI cursor / erase / mode control -> consumed, never rendered
 *   - OSC (title etc.) -> consumed
 *   - ESC in non-SGR families (charset, single-char) -> consumed
 *   - CRLF -> line break; lone CR -> return-to-column-0 REDRAW (the current
 *     line is overwritten, exactly how progress bars repaint in place)
 *   - BS -> delete the last character (cursor-backspace)
 *   - an escape split ACROSS chunks (chunk ends with ESC + '[' and the next
 *     chunk completes it) is carried in the framer state, so streams never
 *     paint partial escapes.
 */
export interface AnsiSegment {
  text: string
  cls: string | null
}

function isCsiByte(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code >= 0x20 && code <= 0x3f
}

function isFinalByte(ch: string): boolean {
  const code = ch.charCodeAt(0)
  return code >= 0x40 && code <= 0x7e
}

/** Map one SGR parameter run onto CSS classes ('' = reset/default). */
function sgrClasses(params: string): string {
  if (params === '' || params === '0') return ''
  const codes = params.split(';').map((c) => Number(c))
  const classes: string[] = []
  let fg = -1
  let bold = false
  let dim = false
  let i = 0
  while (i < codes.length) {
    const code = codes[i]!
    if (code === 0) {
      fg = -1
      bold = false
      dim = false
    } else if (code === 1) {
      bold = true
    } else if (code === 2) {
      dim = true
    } else if (code >= 30 && code <= 37) {
      fg = code - 30
    } else if (code >= 90 && code <= 97) {
      fg = code - 90 + 8
    } else if (code === 38 && codes[i + 1] === 5) {
      fg = codes[i + 2] ?? -1
      i += 2
    } else if (code === 38 && codes[i + 1] === 2) {
      // 24-bit color: skip the three component params
      i += 3
    }
    i++
  }
  if (fg >= 0 && fg < 16) classes.push('js-term-fg-' + fg)
  if (bold) classes.push('js-term-bold')
  if (dim) classes.push('js-term-dim')
  return classes.join(' ')
}

/**
 * Consume ONE escape sequence starting at text[i] (text[i] is ESC).
 * Returns { consumed, cls?, partial? }:
 *   - consumed: chars to skip (the whole escape)
 *   - cls: SGR replacement classes when the escape was an SGR sequence
 *   - partial: non-empty when the escape is UNFINISHED at the end of the
 *     chunk - the caller must carry it into the next chunk.
 */
function consumeEscape(text: string, i: number): { consumed: number; cls?: string; partial: string } {
  const n = text.length
  if (i + 1 >= n) return { consumed: 0, partial: text.slice(i) }
  const c2 = text[i + 1]!
  if (c2 === '[') {
    // CSI: ESC [ params(0x30-0x3f) intermediates(0x20-0x2f) final(0x40-0x7e)
    let j = i + 2
    while (j < n && isCsiByte(text[j]!)) j++
    if (j >= n) return { consumed: 0, partial: text.slice(i) }
    if (!isFinalByte(text[j]!)) {
      // Malformed run: drop just the ESC and let the caller continue.
      return { consumed: 1, partial: '' }
    }
    const params = text.slice(i + 2, j)
    const final = text[j]!
    const consumed = j - i + 1
    if (final === 'm' && /^[0-9;]*$/.test(params)) {
      return { consumed, cls: sgrClasses(params), partial: '' }
    }
    return { consumed, partial: '' }
  }
  if (c2 === ']') {
    // OSC: ESC ] ... BEL or ST (ESC backslash)
    let j = i + 2
    while (j < n) {
      const ch = text[j]!
      if (ch === '\x07') return { consumed: j - i + 1, partial: '' }
      if (ch === '\x1b' && text[j + 1] === '\\') return { consumed: j - i + 2, partial: '' }
      if (ch === '\x1b') break // stray ESC inside: treat as malformed, re-process it
      j++
    }
    return { consumed: 0, partial: text.slice(i) }
  }
  if (c2 === ')' || c2 === '(') {
    // Charset designation: ESC ( X
    if (i + 3 > n) return { consumed: 0, partial: text.slice(i) }
    return { consumed: 3, partial: '' }
  }
  if (c2 === '#') {
    // DECALN: ESC # 8
    if (i + 3 > n) return { consumed: 0, partial: text.slice(i) }
    return { consumed: 3, partial: '' }
  }
  if (isFinalByte(c2)) {
    // Single-char escapes (ESC 7 DECSC, ESC M RI, ESC D, ESC =, ESC \\ ST...)
    return { consumed: 2, partial: '' }
  }
  // Unknown introducer: drop the lone ESC.
  return { consumed: 1, partial: '' }
}

/** Hard guard against an unterminated single line eating unbounded memory. */
const MAX_PENDING_LINE_CHARS = 256 * 1024

/**
 * Stateful line framer: turns a raw PTY chunk stream into completed logical
 * lines (AnsiSegment[] each), folding CR redraws, backspaces, all control
 * sequences, and escapes split across chunk boundaries.
 */
export interface LineFramerState {
  /** Unfinished escape prefix carried to the next chunk (e.g. ESC + '['). */
  esc: string
  /** The current logical line (accepts CR / backspace rewrites). */
  line: AnsiSegment[]
  /** Current SGR class for the line tail ('' = default). */
  cls: string
  /** Total chars in the line (for the pathological-line guard). */
  chars: number
}

export function createLineFramer(): LineFramerState {
  return { esc: '', line: [], cls: '', chars: 0 }
}

function appendChar(state: LineFramerState, ch: string): void {
  const line = state.line
  const cls = state.cls
  const last = line[line.length - 1]
  // Segments coalesce by their ACTUAL style: the default class is tracked as
  // '' internally but stored as null on segments, so compare normalized.
  if (last !== undefined && (last.cls ?? '') === cls) {
    last.text += ch
  } else {
    line.push({ text: ch, cls: cls === '' ? null : cls })
  }
  state.chars += 1
}

function eraseChar(state: LineFramerState): void {
  const line = state.line
  const last = line[line.length - 1]
  if (last === undefined) return
  if (last.text.length > 1) {
    last.text = last.text.slice(0, -1)
  } else {
    line.pop()
  }
  state.chars = Math.max(0, state.chars - 1)
}

function flushLine(state: LineFramerState): AnsiSegment[] {
  const line = state.line
  state.line = []
  state.cls = ''
  state.chars = 0
  return line
}

/** Feed one raw chunk; returns the completed logical lines (empty when none). */
export function feedLines(state: LineFramerState, chunk: string): AnsiSegment[][] {
  const rows: AnsiSegment[][] = []
  if (chunk.length === 0 && state.esc.length === 0) return rows
  const text = state.esc + chunk
  state.esc = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    const code = c.charCodeAt(0)
    if (c === '\x1b') {
      const { consumed, cls, partial } = consumeEscape(text, i)
      if (partial.length > 0) {
        state.esc = partial
        return rows
      }
      if (cls !== undefined) state.cls = cls
      i += consumed
      continue
    }
    if (c === '\n') {
      if (state.chars > 0) rows.push(flushLine(state))
      i += 1
      continue
    }
    if (c === '\r') {
      if (text[i + 1] === '\n') {
        if (state.chars > 0) rows.push(flushLine(state))
        i += 2
        continue
      }
      // Lone CR = cursor to column 0 and overwrite: the redrawn content
      // replaces the whole logical line (progress-bar semantics).
      state.line = []
      state.cls = ''
      state.chars = 0
      i += 1
      continue
    }
    if (c === '\b') {
      eraseChar(state)
      i += 1
      continue
    }
    if (c === '\t' || code >= 0x20) {
      appendChar(state, c)
      if (state.chars >= MAX_PENDING_LINE_CHARS) rows.push(flushLine(state))
      i += 1
      continue
    }
    // Other control bytes (NUL, BEL, unit separators...) never render.
    i += 1
  }
  return rows
}

/**
 * Parse one (already single-line) text chunk with ANSI escapes into styled
 * segments. Convenience wrapper over the framer; escapes and CR/BS variants
 * are folded exactly as in the streaming path.
 */
export function parseAnsi(text: string): AnsiSegment[] {
  if (text.length === 0) return []
  if (text.indexOf('\x1b') === -1 && text.indexOf('\r') === -1 && text.indexOf('\b') === -1) {
    return [{ text, cls: null }]
  }
  const state = createLineFramer()
  const rows = feedLines(state, text)
  const segments: AnsiSegment[] = []
  for (const row of rows) segments.push(...row)
  segments.push(...state.line)
  return segments
}

/** Strip all ANSI escapes (kept for fallbacks / plain-text projections). */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][AB0]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
}

/**
 * Legacy split helper (kept for API parity; the mirror pipeline uses
 * createLineFramer/feedLines instead). Splits raw output into rows, merging
 * the tail with a pending row, treating every CR as a row break.
 */
export function splitRows(raw: string, pending: string): { rows: string[]; pending: string } {
  const combined = pending + raw
  const parts = combined.split(/\r\n|\r|\n/)
  if (parts.length === 0) return { rows: [], pending: '' }
  const last = parts[parts.length - 1] ?? ''
  const rows = parts.slice(0, -1)
  return { rows, pending: last }
}

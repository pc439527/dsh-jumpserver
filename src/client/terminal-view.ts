/**
 * Terminal row pipeline: TerminalObserver events -> bounded rendered rows.
 * Raw PTY output first passes the stateful ANSI/VT100 framer; connector-only
 * marker/probe traffic and PTY command echoes are then removed.
 */
import type { SnapshotResponse } from './api.js'
import { createLineFramer, feedLines, stripAnsi, type AnsiSegment, type LineFramerState } from './ansi.js'

export type TerminalRow =
  | { id: number; kind: 'output'; segments: AnsiSegment[] }
  | { id: number; kind: 'input'; text: string }
  | { id: number; kind: 'meta'; kind2: 'state' | 'target' | 'error'; text: string }

/** Internal completion/probe markers must never be visible. */
const CONNECTOR_MARKERS = /__DSH_JS_(?:DONE|PROBE|PROBE_END)_|__dsh_rc/
const PROBE_HELPER_LINE = /(?:^|[#$>]\s+)printf\s+['"]?[HUP]=%s\\n/i
const PROBE_RESULT_LINE = /^\s*[HUP]=/
const PROBE_PS2_ARTIFACT = /^\s*>\s*'?\s*$/
/** Wrapped PTYs can split the internal completion printf before the marker. */
const DONE_HELPER_RC_LINE = /(?:^|[#$>]\s+)__dsh_rc=\$\?\s*$/
const DONE_HELPER_PRINTF_PREFIX = /(?:^|[#$>]\s+)printf\s+['"]?\s*$/
const TRANSIENT_STATES = new Set(['COMMAND_RUNNING', 'ASSET_SHELL'])

function isConnectorNoise(line: string): boolean {
  if (CONNECTOR_MARKERS.test(line)) return true
  if (PROBE_HELPER_LINE.test(line)) return true
  if (PROBE_RESULT_LINE.test(line)) return true
  if (PROBE_PS2_ARTIFACT.test(line)) return true
  if (DONE_HELPER_RC_LINE.test(line)) return true
  if (DONE_HELPER_PRINTF_PREFIX.test(line)) return true
  return false
}

function displayState(state: string): string {
  return state.replace(/_/g, ' ')
}

export interface TerminalBuffer {
  rows: TerminalRow[]
  nextId: number
  cursor: number
  framer: LineFramerState
  scrollback: number
  /** Expected PTY echoes for user/model-visible inputs. */
  echoQueue: string[]
}

export function createTerminalBuffer(scrollback: number): TerminalBuffer {
  return { rows: [], nextId: 1, cursor: 0, framer: createLineFramer(), scrollback: Math.max(200, scrollback), echoQueue: [] }
}

function pushRow(buffer: TerminalBuffer, row: TerminalRow): void {
  buffer.rows.push(row)
  if (buffer.rows.length > buffer.scrollback) {
    buffer.rows.splice(0, buffer.rows.length - buffer.scrollback)
  }
}

export function setScrollback(buffer: TerminalBuffer, rows: number): void {
  buffer.scrollback = Math.max(200, rows)
}

/** Drop the PTY echo of the just-recorded input event. */
function dropEcho(buffer: TerminalBuffer, line: string): boolean {
  const queue = buffer.echoQueue
  if (queue.length === 0 || queue[0]!.length === 0) return false
  const trimmed = line.trim()
  if (trimmed.endsWith(queue[0]!)) {
    queue.shift()
    return true
  }
  buffer.echoQueue = []
  return false
}

function appendOutput(buffer: TerminalBuffer, raw: string): void {
  if (raw.length === 0) return
  const lines = feedLines(buffer.framer, raw)
  for (const segments of lines) {
    if (segments.length === 0) continue
    const text = segments.map((s) => s.text).join('')
    if (text.length === 0) continue
    if (isConnectorNoise(text)) continue
    if (dropEcho(buffer, text)) continue
    pushRow(buffer, { id: buffer.nextId++, kind: 'output', segments })
  }
}

function appendInput(buffer: TerminalBuffer, data: string): void {
  const lines = data.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length === 0) return
  pushRow(buffer, { id: buffer.nextId++, kind: 'input', text: lines[0]! })
  for (const line of lines.slice(1)) {
    pushRow(buffer, { id: buffer.nextId++, kind: 'input', text: line })
  }
}

function appendMeta(buffer: TerminalBuffer, kind2: 'state' | 'target' | 'error', text: string): void {
  pushRow(buffer, { id: buffer.nextId++, kind: 'meta', kind2, text })
}

const STATE_LABELS: Record<string, string> = {
  DISCONNECTED: 'Disconnected',
  CONNECTING: 'Connecting',
  JUMPSERVER_MENU: 'JumpServer menu',
  ENTERING_ASSET: 'Entering asset',
  ASSET_SHELL: 'Asset shell',
  COMMAND_RUNNING: 'Running command',
  UNKNOWN: 'Unknown state',
  ERROR: 'Error',
}

/** Fold one snapshot batch into the buffer. Returns the last applied seq. */
export function applySnapshot(buffer: TerminalBuffer, snapshot: SnapshotResponse, maxSeq: number): number {
  const oldest = snapshot.oldestSeq ?? 0
  if (oldest > maxSeq + 1) {
    pushRow(buffer, { id: buffer.nextId++, kind: 'meta', kind2: 'error', text: '· ⚠ 部分终端输出已超出缓冲区并被丢弃（seq ' + (maxSeq + 1) + '..' + (oldest - 1) + ' 缺失）' })
  }
  for (const event of snapshot.events ?? []) {
    switch (event.type) {
      case 'output':
        appendOutput(buffer, event.data ?? '')
        break
      case 'input': {
        const data = event.data ?? ''
        const first = data.split(/\r?\n/)[0] ?? ''
        if (first.trim().length === 0 || isConnectorNoise(first)) break
        appendInput(buffer, stripAnsi(data))
        buffer.echoQueue = data
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .slice(0, 8)
        break
      }
      case 'state': {
        const state = event.state ?? ''
        // COMMAND_RUNNING -> ASSET_SHELL happens around every command and made
        // the terminal unreadable. Target/state still remain available in the
        // header; only durable/navigation/error state changes are shown here.
        if (TRANSIENT_STATES.has(state)) break
        appendMeta(buffer, 'state', '· ' + (STATE_LABELS[state] ?? state || 'state'))
        break
      }
      case 'target':
        appendMeta(
          buffer,
          'target',
          '· target ' + (event.target ?? '?') + (event.hostname ? ' / ' + event.hostname : '') + (event.user ? ' (' + event.user + ')' : ''),
        )
        break
      case 'error':
        appendMeta(buffer, 'error', '· error: ' + (event.message ?? 'unknown'))
        break
    }
    if (event.seq !== undefined && event.seq > maxSeq) maxSeq = event.seq
  }
  buffer.cursor = Math.max(buffer.cursor, maxSeq, snapshot.lastSeq ?? 0)
  return buffer.cursor
}

/** Drop current browser rows while keeping the stream cursor. */
export function clearBuffer(buffer: TerminalBuffer): void {
  buffer.rows = []
  buffer.nextId = 1
  buffer.framer = createLineFramer()
  buffer.echoQueue = []
}

export { displayState }

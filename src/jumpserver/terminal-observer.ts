/**
 * TerminalObserver V0.2: capture everything the JumpServer PTY session shows —
 * every input the connector writes, every raw output chunk, every state and
 * target change — as a monotonic seq-ordered event stream backed by a bounded
 * ring buffer. The browser half consumes snapshots via `sinceSeq`, so a
 * reconnect rehydrates exactly the events that arrived while it was away.
 *
 * Events are intentionally lossy-safe: output chunks are raw PTY bytes (ANSI
 * included) so the browser mirror is faithful, and caps are enforced on event
 * count AND output byte budget so the buffer cannot grow without bound.
 */
import { MAX_TERMINAL_BYTES } from '../config/types.js'
import { SessionState } from './state-machine.js'

export type TerminalEventType = 'input' | 'output' | 'state' | 'target' | 'error'

export interface TerminalEventBase {
  seq: number
  timestamp: number
}

export interface TerminalInputEvent extends TerminalEventBase {
  type: 'input'
  /** What the connector actually wrote to the PTY (target line, script, exit…). */
  data: string
}

export interface TerminalOutputEvent extends TerminalEventBase {
  type: 'output'
  /** Raw PTY chunk (may contain ANSI escapes; UTF-8 decoded). */
  data: string
}

export interface TerminalStateEvent extends TerminalEventBase {
  type: 'state'
  state: SessionState
  prev: SessionState | null
}

export interface TerminalTargetEvent extends TerminalEventBase {
  type: 'target'
  target: string
  hostname: string | null
  user: string | null
  pwd: string | null
}

export interface TerminalErrorEvent extends TerminalEventBase {
  type: 'error'
  message: string
}

export type TerminalEvent =
  | TerminalInputEvent
  | TerminalOutputEvent
  | TerminalStateEvent
  | TerminalTargetEvent
  | TerminalErrorEvent

/** Event fingerprint without the serialized seq/timestamp (what the observer records). */
export type TerminalNewEvent =
  | { type: 'input'; data: string }
  | { type: 'output'; data: string }
  | { type: 'state'; state: SessionState; prev: SessionState | null }
  | { type: 'target'; target: string; hostname: string | null; user: string | null; pwd: string | null }
  | { type: 'error'; message: string }

/** Bounded ring buffer of terminal events with monotonic seq. */
export class TerminalRingBuffer {
  private events: TerminalEvent[] = []
  private cursor = 0
  private outputBytes = 0
  private maxEvents: number

  constructor(
    maxEvents = 20000,
    private readonly maxOutputBytes = MAX_TERMINAL_BYTES,
  ) {
    this.maxEvents = maxEvents
  }

  /**
   * V0.3.1 P2: re-budget on live settings change — terminalScrollback now sets
   * the HOST retention too, not just the browser row cap. Trims oldest events
   * when the new budget is smaller.
   */
  setScrollbackRows(rows: number): void {
    const next = Math.max(1000, Math.min(200000, Math.round(rows) * 4))
    if (next === this.maxEvents) return
    this.maxEvents = next
    while (this.events.length > this.maxEvents) {
      const head = this.events[0]!
      if (head.type === 'output') this.outputBytes -= head.data.length
      this.events.shift()
    }
  }

  /** Append one event; drops oldest events to respect the caps. */
  push(event: TerminalNewEvent): TerminalEvent {
    const seq = ++this.cursor
    const full = { ...event, seq, timestamp: Date.now() } as TerminalEvent
    this.events.push(full)
    if (event.type === 'output') {
      this.outputBytes += event.data.length
    }
    while (this.outputBytes > this.maxOutputBytes && this.events.length > 0) {
      const head = this.events[0]!
      if (head.type === 'output') this.outputBytes -= head.data.length
      this.events.shift()
    }
    while (this.events.length > this.maxEvents) {
      const head = this.events[0]!
      if (head.type === 'output') this.outputBytes -= head.data.length
      this.events.shift()
    }
    return full
  }

  /** Events with seq strictly greater than sinceSeq ([] when sinceSeq >= cursor). */
  snapshotSince(sinceSeq: number): TerminalEvent[] {
    if (sinceSeq < 0) sinceSeq = 0
    if (this.events.length === 0 || sinceSeq >= this.cursor) return []
    return this.events.filter((e) => e.seq > sinceSeq)
  }

  /** Every retained event (for first open / full rehydration). */
  snapshot(): TerminalEvent[] {
    return [...this.events]
  }

  get cursorSeq(): number {
    return this.cursor
  }

  get size(): number {
    return this.events.length
  }

  /** Oldest retained seq, or 0 while empty. */
  get oldestSeq(): number {
    return this.events.length > 0 ? this.events[0]!.seq : 0
  }

  clear(): void {
    this.events = []
    this.outputBytes = 0
  }
}

/** Emitting facade the session manager hands the bridge. */
export class TerminalObserver {
  private buffer = new TerminalRingBuffer()

  constructor(private scrollbackRows = 5000) {}

  recordInput(data: string): void {
    this.buffer.push({ type: 'input', data })
  }

  recordOutput(data: string): void {
    if (data.length === 0) return
    this.buffer.push({ type: 'output', data })
  }

  recordState(state: SessionState, prev: SessionState | null): void {
    this.buffer.push({ type: 'state', state, prev })
  }

  recordTarget(target: string, hostname: string | null, user: string | null, pwd: string | null): void {
    this.buffer.push({ type: 'target', target, hostname, user, pwd })
  }

  recordError(message: string): void {
    this.buffer.push({ type: 'error', message })
  }

  snapshotSince(sinceSeq: number): TerminalEvent[] {
    return this.buffer.snapshotSince(sinceSeq)
  }

  snapshot(): TerminalEvent[] {
    return this.buffer.snapshot()
  }

  get cursorSeq(): number {
    return this.buffer.cursorSeq
  }

  /** Oldest retained event seq (0 while empty); lets readers detect ring drops. */
  get oldestSeq(): number {
    return this.buffer.oldestSeq
  }

  clear(): void {
    this.buffer.clear()
  }

  /** Mirrors the configured scrollback budget (rows). */
  get scrollback(): number {
    return this.scrollbackRows
  }

  /** V0.3.1 P2: terminalScrollback now controls the ObservER retention too
   *  (event budget = rows*4, floored at 1000) — the host ring shrinks with the
   *  browser cap instead of silently keeping 20k events. */
  setScrollbackRows(rows: number): void {
    const effective = Math.max(200, rows)
    this.scrollbackRows = effective
    this.buffer.setScrollbackRows(effective)
  }
}

/** Human-readable snapshot meta for the bridge. */
export interface TerminalSnapshotMeta {
  lastSeq: number
  state: string
  connected: boolean
  gateway: string
  target: string | null
  hostname: string | null
  user: string | null
  permissionMode: string
  enabled: boolean
  configured: boolean
}


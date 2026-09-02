import { describe, expect, it } from 'vitest'
import { TerminalObserver, TerminalRingBuffer } from '../src/jumpserver/terminal-observer.js'
import { SessionState } from '../src/jumpserver/state-machine.js'

describe('TerminalRingBuffer', () => {
  it('assigns monotonic seq and timestamps', () => {
    const ring = new TerminalRingBuffer()
    const a = ring.push({ type: 'state', state: SessionState.CONNECTING, prev: null })
    const b = ring.push({ type: 'output', data: 'menu\r\n' })
    expect(b.seq).toBe(a.seq + 1)
    expect(a.timestamp).toBeGreaterThan(0)
    expect(b.timestamp).toBeGreaterThanOrEqual(a.timestamp)
  })

  it('snapshotSince returns only later events', () => {
    const ring = new TerminalRingBuffer()
    ring.push({ type: 'output', data: 'a' })
    const second = ring.push({ type: 'output', data: 'b' })
    ring.push({ type: 'output', data: 'c' })
    const later = ring.snapshotSince(second.seq)
    expect(later.map((e) => (e as { data?: string }).data)).toEqual(['c'])
    expect(ring.snapshotSince(second.seq + 5)).toEqual([])
    expect(ring.snapshotSince(-10).length).toBe(3)
  })

  it('drops oldest events beyond the event cap', () => {
    const ring = new TerminalRingBuffer(4, 1_000_000)
    for (let i = 0; i < 10; i++) ring.push({ type: 'output', data: 'x' + i })
    expect(ring.size).toBe(4)
    const snapshot = ring.snapshot()
    expect(snapshot.map((e) => (e as { data?: string }).data)).toEqual(['x6', 'x7', 'x8', 'x9'])
  })

  it('drops oldest output beyond the byte budget', () => {
    const ring = new TerminalRingBuffer(100, 10)
    ring.push({ type: 'output', data: '1234567890' }) // exactly 10 bytes
    ring.push({ type: 'output', data: 'ABCDE' })       // 5 more -> evicts all 10-byte head
    const snapshot = ring.snapshot()
    expect(snapshot.map((e) => (e as { data?: string }).data)).toEqual(['ABCDE'])
  })

  it('clear empties the buffer and keeps cursor', () => {
    const ring = new TerminalRingBuffer()
    ring.push({ type: 'output', data: 'a' })
    const cursor = ring.cursorSeq
    ring.clear()
    expect(ring.size).toBe(0)
    expect(ring.cursorSeq).toBe(cursor)
  })
})

describe('TerminalObserver', () => {
  it('records each event kind and rehydrates snapshots by seq', () => {
    const observer = new TerminalObserver()
    observer.recordState(SessionState.CONNECTING, null)
    observer.recordInput('203.0.113.101')
    observer.recordOutput('[root@web-app-01 ~]# ')
    observer.recordTarget('203.0.113.101', 'web-app-01', 'root', '/root')
    observer.recordState(SessionState.ASSET_SHELL, SessionState.ENTERING_ASSET)
    observer.recordError('probe failed')

    const all = observer.snapshot()
    expect(all.map((e) => e.type)).toEqual(['state', 'input', 'output', 'target', 'state', 'error'])
    const afterInput = observer.snapshotSince(all[1]!.seq)
    expect(afterInput.map((e) => e.type)).toEqual(['output', 'target', 'state', 'error'])
    expect(observer.cursorSeq).toBe(all[all.length - 1]!.seq)
  })
})

describe('observer straight-line check (bridge contract)', () => {
  it('state + input + output sequence matches the terminal example flow', () => {
    const observer = new TerminalObserver()
    observer.recordState(SessionState.JUMPSERVER_MENU, SessionState.CONNECTING)
    observer.recordInput('203.0.113.101')
    observer.recordState(SessionState.ENTERING_ASSET, SessionState.JUMPSERVER_MENU)
    observer.recordState(SessionState.ASSET_SHELL, SessionState.ENTERING_ASSET)
    observer.recordInput('hostname')
    observer.recordOutput('web-app-01\n')
    observer.recordInput('uptime')
    observer.recordOutput('08:41:06 up 132 days\n')
    const events = observer.snapshot()
    expect(events[0]!.type).toBe('state')
    expect(events[1]!.type).toBe('input')
    expect((events[1] as { data: string }).data).toBe('203.0.113.101')
    expect(events[3]!.type).toBe('state')
    expect((events[3] as { state: SessionState }).state).toBe(SessionState.ASSET_SHELL)
  })
})

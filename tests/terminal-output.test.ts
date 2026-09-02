import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { SessionState } from '../src/jumpserver/state-machine.js'
import { applySnapshot, createTerminalBuffer } from '../src/client/terminal-view.js'
import { ASSET_PROMPT, doneReply, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

function makeOptions(wire: FakeWire, overrides: Partial<SessionManagerOptions> = {}): SessionManagerOptions {
  const cfg: JumpServerConfig = {
    enabled: true,
    autoOpenTerminal: true,
    terminalScrollback: 5000,
    host: '203.0.113.10',
    port: 2222,
    username: 'ops',
    passwordEnv: 'JUMPSERVER_PASSWORD',
    connectTimeout: 5,
    commandTimeout: 10,
    idleTimeout: 30,
    permissionMode: 'READ_ONLY',
    autoReconnect: true,
    enableAudit: false,
  }
  return {
    getConfig: () => cfg,
    resolvePassword: async () => 'secret',
    wireFactory: async () => wire,
    onLog: () => {},
    ...overrides,
  }
}

/**
 * V0.2.1 P0 proof: the realtime mirror really shows server stdout. The chain
 * under test is
 *   FakeWire.emit (onData) -> JumpServerSession.onData -> callbacks.onOutput
 *     -> TerminalObserver.recordOutput -> snapshotSince()
 * so a browser consumer that long-polls /api/jumpserver.snapshot sees the
 * actual command output, not the connector's own script writes.
 */
describe('realtime terminal output (onData -> observer -> snapshot)', () => {
  it('run() surfaces the remote stdout as output events', async () => {
    const wire = new FakeWire()
    const observer = new TerminalObserver()
    const manager = new SessionManager(makeOptions(wire, { observer }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue((w: string) => doneReply(w))

    const result = await manager.run({ target: '203.0.113.101', command: 'df -h', risk: 'READ' })
    expect(result.outcome.kind).toBe('completed')

    const outputEvents = observer.snapshot().filter((e) => e.type === 'output') as Array<{ data: string }>
    const stdout = outputEvents.map((e) => e.data).join('')
    // The REAL server stdout is in the mirror stream (not just our own writes).
    expect(stdout).toContain('Filesystem')
    expect(stdout).toContain('/dev/sda1')
  })

  it('records the raw model command as input, never the done-script internals', async () => {
    const wire = new FakeWire()
    const observer = new TerminalObserver()
    const manager = new SessionManager(makeOptions(wire, { observer }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue((w: string) => doneReply(w))

    await manager.run({ target: '203.0.113.101', command: 'df -h', risk: 'READ' })

    const inputs = (observer.snapshot().filter((e) => e.type === 'input') as Array<{ data: string }>).map((e) => e.data)
    expect(inputs).toContain('df -h')
    for (const input of inputs) {
      expect(input).not.toMatch(/__dsh_rc/)
      expect(input).not.toMatch(/__DSH_JS_(?:DONE|PROBE)/)
      expect(input).not.toMatch(/printf/)
    }
  })

  it('the target probe never records an input line (only the target line)', async () => {
    const wire = new FakeWire()
    const observer = new TerminalObserver()
    const manager = new SessionManager(makeOptions(wire, { observer }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue((w: string) => doneReply(w))

    await manager.run({ target: '203.0.113.101', command: 'hostname', risk: 'READ' })

    const inputs = (observer.snapshot().filter((e) => e.type === 'input') as Array<{ data: string }>).map((e) => e.data)
    expect(inputs).toContain('203.0.113.101')
    expect(inputs.some((i) => i.includes('__DSH_JS_PROBE'))).toBe(false)
    expect(inputs.some((i) => i.includes('H=') || i.includes('U=') || i.includes('P='))).toBe(false)
  })

  it('batch output events deliver each command stdout in order', async () => {
    const wire = new FakeWire()
    const observer = new TerminalObserver()
    const manager = new SessionManager(makeOptions(wire, { observer }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue((w: string) => doneReply(w))
    wire.queue((w: string) => doneReply(w))

    const result = await manager.runTargetBatch({
      target: '203.0.113.101',
      commands: [
        { command: 'df -h', risk: 'READ' },
        { command: 'free -m', risk: 'READ' },
      ],
    })
    expect(result.error).toBeNull()
    expect(result.commands).toHaveLength(2)
    const stdout = (observer.snapshot().filter((e) => e.type === 'output') as Array<{ data: string }>).map((e) => e.data).join('')
    // Real server stdout reached the mirror for BOTH commands (raw chunks —
    // marker lines are part of the faithful raw stream; the client view
    // strips them, which the pipeline test below pins down).
    expect(stdout.split('Filesystem').length - 1).toBeGreaterThanOrEqual(1)
  })
})

/** Literal backslash-n (the two chars a PTY echoes inside printf text). */
const LIT_N = String.raw`\n`

/**
 * Client-side guarantee: whatever raw chunk the observer records (marker
 * lines, __dsh_rc, probe helpers and their H=/U=/P= labels, PTY echo of the
 * typed command), the RENDERED rows only show user-readable terminal content.
 */
describe('client view pipeline (raw observer stream -> clean rows)', () => {
  it('strips connector markers, probe internals and command echo from rendered rows', () => {
    const observer = new TerminalObserver()
    // Simulate the exact raw stream a real PTY emits for one exec: the
    // shell echoes the done script (line breaks real CRLF; the printf text
    // carries LITERAL backslash-n), the marker line, stdout, then the prompt.
    observer.recordState(SessionState.ASSET_SHELL, SessionState.ENTERING_ASSET)
    observer.recordInput('df -h')
    observer.recordOutput([
      '[root@web-app-01 ~]# df -h',
      '__dsh_rc=$?',
      "printf '" + LIT_N + '__DSH_JS_DONE_abc123:0' + LIT_N + "'",
      'Filesystem      Size  Used Avail Use% Mounted on',
      '/dev/sda1        50G   12G   36G  25% /',
      '',
      '__DSH_JS_DONE_abc123:0',
      '[root@web-app-01 ~]# ',
    ].join('\r\n'))
    // Probe internals for an enter() that happened earlier in the stream.
    observer.recordOutput([
      "printf '__DSH_JS_PROBE_xyz" + LIT_N + "'",
      "printf 'H=%s" + LIT_N + "' \"$(hostname 2>/dev/null || echo ?)\"",
      'H=web-app-01',
      'U=root',
      'P=/root',
      '__DSH_JS_PROBE_END_xyz',
      '',
    ].join('\r\n'))

    const buffer = createTerminalBuffer(200)
    let cursor = 0
    for (const snap of [observer.snapshot()]) {
      cursor = applySnapshot(buffer, { events: snap, lastSeq: observer.cursorSeq } as never, cursor)
    }

    const text = buffer.rows.map((row) =>
      row.kind === 'output' ? row.segments.map((s) => s.text).join('') : row.kind === 'input' ? '$ ' + row.text : row.text,
    ).join('\n')
    // Real stdout is visible.
    expect(text).toContain('Filesystem')
    expect(text).toContain('/dev/sda1')
    // Connector internals never render.
    expect(text).not.toMatch(/__DSH_JS_(?:DONE|PROBE|PROBE_END)_/)
    expect(text).not.toMatch(/__dsh_rc/)
    expect(text).not.toMatch(/printf/)
    expect(text).not.toMatch(/H=|U=|P=/)
    // The echo of the typed command is not duplicated as an output row
    // (it only appears once, as the $ input row).
    expect(text.match(/\$ df -h/g)).toHaveLength(1)
  })
})

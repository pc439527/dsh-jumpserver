import { describe, expect, it } from 'vitest'
import { JumpServerSession } from '../src/jumpserver/session.js'
import { JumpServerError } from '../src/jumpserver/errors.js'
import { SessionState } from '../src/jumpserver/state-machine.js'
import type { Wire } from '../src/jumpserver/client.js'
import { ASSET_PROMPT, doneReply, FakeWire, KOKO_MENU, probeReply, sessionConfig } from './helpers.js'

describe('JumpServer session (mock wire)', () => {
  it('menu -> enter -> probe -> exec -> completion -> exit -> menu', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)

    await session.connect()
    expect(session.state).toBe(SessionState.JUMPSERVER_MENU)

    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    await session.enter('203.0.113.101')
    expect(session.state).toBe(SessionState.ASSET_SHELL)
    expect(session.currentTarget).toBe('203.0.113.101')
    expect(session.currentHostname).toBe('web-app-01')
    expect(session.currentUser).toBe('root')
    expect(session.currentPwd).toBe('/root')

    wire.queue((w: string) => doneReply(w))
    const outcome = await session.exec('df -h')
    expect(outcome.kind).toBe('completed')
    if (outcome.kind === 'completed') {
      expect(outcome.exitCode).toBe(0)
      expect(outcome.output).toContain('Filesystem')
      expect(outcome.output).not.toContain('__DSH_JS_DONE_')
    }
    expect(session.state).toBe(SessionState.ASSET_SHELL)

    wire.queue((w: string) => (w.startsWith('exit') ? KOKO_MENU : undefined))
    await session.leave()
    expect(session.state).toBe(SessionState.JUMPSERVER_MENU)
    expect(session.currentTarget).toBeNull()

    await session.close()
    expect(session.state).toBe(SessionState.DISCONNECTED)
  })

  it('reports COMMAND timeout and collapses to UNKNOWN when the shell cannot be re-verified', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)
    await session.connect()
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    await session.enter('203.0.113.101')

    // No reply queued for the command -> timeout. The recovery probe also gets
    // no reply, so the shell is NOT verified and the session must NOT be
    // declared ASSET_SHELL again (V0.2.5 P0: timeout != shell still usable).
    const outcome = await session.exec('sleep 100', { timeoutMs: 250 })
    expect(outcome.kind).toBe('timeout')
    expect(outcome.executionState).toBe('UNKNOWN')
    expect(session.state).toBe(SessionState.UNKNOWN)
    // Ctrl+C was sent as part of the recovery
    expect(wire.writes).toContain('\u0003')
  })

  it('re-verifies the shell (Ctrl+C + probe) after a command timeout', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)
    await session.connect()
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    await session.enter('203.0.113.101')

    // The recovery probe IS answered -> the shell is proven usable again.
    // FakeWire consumes ONE queue entry per write: exec script, Ctrl+C, probe.
    wire.queue(() => undefined)
    wire.queue(() => undefined)
    wire.queue((w: string) => probeReply(w))
    const outcome = await session.exec('sleep 100', { timeoutMs: 250 })
    expect(outcome.kind).toBe('timeout')
    expect(outcome.executionState).toBe('TIMEOUT')
    expect(session.state).toBe(SessionState.ASSET_SHELL)
  })

  it('losing the wire mid-command returns UNKNOWN and never re-executes', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)
    await session.connect()
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    await session.enter('203.0.113.101')

    const doneWritesBefore = wire.writes.length
    wire.queue((w: string) => {
      wire.close()
      return undefined
    })
    const outcome = await session.exec('hostname', { timeoutMs: 2000 })
    expect(outcome.kind).toBe('signal-lost')
    expect(session.state).toBe(SessionState.DISCONNECTED)
    // exactly one command write, no automatic re-execution
    expect(wire.writes.length - doneWritesBefore).toBe(1)
  })

  it('fails verification when the probe output is missing, then refuses exec', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)
    await session.connect()
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => 'some unrelated output\n')
    await expect(session.enter('203.0.113.101')).rejects.toBeInstanceOf(JumpServerError)
    expect(session.state).toBe(SessionState.UNKNOWN)
    await expect(session.exec('df -h')).rejects.toBeInstanceOf(JumpServerError)
  })

  it('leave fails loudly when the menu is not confirmed (single exit attempt)', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)
    await session.connect()
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    await session.enter('203.0.113.101')

    wire.queue((w: string) => (w.startsWith('exit') ? ASSET_PROMPT : undefined))
    await expect(session.leave(undefined)).rejects.toMatchObject({ code: 'MENU_RETURN_FAILED' })
    expect(session.state).toBe(SessionState.UNKNOWN)
    expect(wire.writes.filter((w) => w.startsWith('exit')).length).toBe(1)
  })

  it('connect throws MENU_NOT_DETECTED when the menu never appears', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire))
    await expect(session.connect()).rejects.toMatchObject({ code: 'MENU_NOT_DETECTED' })
  })
})

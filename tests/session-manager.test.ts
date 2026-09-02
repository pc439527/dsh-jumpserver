import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import type { JumpServerConfig } from '../src/config/types.js'
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

describe('SessionManager mutex safety', () => {
  it('run() from DISCONNECTED resolves without deadlocking on its own queue', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)

    // The full run() navigation: connect -> menu -> enter -> probe -> exec.
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue((w: string) => doneReply(w))

    const result = await manager.run({
      target: '203.0.113.101',
      command: 'df -h',
      risk: 'READ',
    })
    expect(result.outcome.kind).toBe('completed')
    expect(result.target).toBe('203.0.113.101')
    expect(result.hostname).toBe('web-app-01')
    expect(result.status.state).toBe('ASSET_SHELL')
    await manager.close()
  })

  it('run() auto-recovers when the session fell into UNKNOWN (previously a deadlock)', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => {
      wire.emit(KOKO_MENU)
    }, 20)

    // First run: menu replies, but the probe reply is missing => ASSET_VERIFY_FAILED, state UNKNOWN.
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue(() => 'some unrelated output\n')
    await expect(
      manager.run({ target: '203.0.113.101', command: 'id', risk: 'READ' }),
    ).rejects.toMatchObject({ code: 'ASSET_VERIFY_FAILED' })

    // Second run: reconnects (fresh wire emits a fresh menu) and completes.
    const wire2 = new FakeWire()
    ;(manager as unknown as { options: SessionManagerOptions }).options.wireFactory = async () => wire2
    setTimeout(() => {
      wire2.emit(KOKO_MENU)
    }, 20)
    wire2.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire2.queue((w: string) => probeReply(w))
    wire2.queue((w: string) => doneReply(w))

    const result = await manager.run({ target: '203.0.113.101', command: 'df -h', risk: 'READ' })
    expect(result.outcome.kind).toBe('completed')
    expect(result.hostname).toBe('web-app-01')
    await manager.close()
  })
})

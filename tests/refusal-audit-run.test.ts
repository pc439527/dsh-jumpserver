import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import { gateCommandForNavigation } from '../src/security/permission-gate.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { ASSET_PROMPT, doneReply, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

/**
 * jumpserver_run defers its approval into the returned beforeExec callback,
 * because the asset is only entered later. The DENIED record therefore has
 * to be written THERE — the gate's own catch only covered the synchronous
 * path. Without it, a rejected jumpserver_run left no audit trace at all.
 */
async function connectedManager(sink: Array<Record<string, unknown>>) {
  const wire = new FakeWire()
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
    permissionMode: 'AUTO',
    autoReconnect: true,
    enableAudit: true,
  }
  const options: SessionManagerOptions = {
    getConfig: () => cfg,
    resolvePassword: async () => 'secret',
    wireFactory: async () => wire,
    onAudit: (record) => { sink.push(record as unknown as Record<string, unknown>) },
    onLog: () => {},
  }
  const manager = new SessionManager(options)
  setTimeout(() => wire.emit(KOKO_MENU), 20)
  wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
  wire.queue((w: string) => probeReply(w))
  wire.queue((w: string) => doneReply(w))
  const result = await manager.run({ target: '203.0.113.101', command: 'df -h', risk: 'READ' })
  expect(result.outcome.kind).toBe('completed')
  return manager
}

const EXEC = { agent: {}, name: 'jumpserver_run', callId: 'r1', signal: new AbortController().signal }

describe('jumpserver_run refusal audit (deferred approval)', () => {
  it('records a DENIED run when the deferred approval is rejected', async () => {
    const sink: Array<Record<string, unknown>> = []
    const manager = await connectedManager(sink)
    sink.length = 0
    const services = {
      getConfig: () => ({ permissionMode: 'AUTO' as const }),
      manager,
      approval: { request: async () => 'rejected' } as never,
    }

    // The gate itself resolves; the refusal happens later, in beforeExec.
    const gated = await gateCommandForNavigation(services, EXEC as never, 'rm -rf /nonexistent-probe')
    expect(gated.approvalRequired).toBe(true)
    expect(typeof gated.beforeExec).toBe('function')
    expect(sink.length).toBe(0)

    await expect((gated.beforeExec as () => Promise<void>)()).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    })

    expect(sink.length).toBe(1)
    expect(sink[0]!.result).toBe('DENIED')
    expect(sink[0]!.operation).toBe('run')
    expect(sink[0]!.refusalReason).toBeTruthy()
    await manager.close()
  })

  it('still records a rule BLOCKED run up front', async () => {
    const sink: Array<Record<string, unknown>> = []
    const manager = await connectedManager(sink)
    sink.length = 0
    const services = {
      getConfig: () => ({ permissionMode: 'READ_ONLY' as const }),
      manager,
    }
    const exec = { agent: {}, name: 'jumpserver_run', callId: 'r2', signal: new AbortController().signal }

    await expect(gateCommandForNavigation(services, exec as never, 'systemctl restart resin')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    })
    expect(sink.length).toBe(1)
    expect(sink[0]!.result).toBe('BLOCKED')
    await manager.close()
  })
})

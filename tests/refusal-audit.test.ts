import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import { gateCommand } from '../src/security/permission-gate.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { ASSET_PROMPT, doneReply, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

/**
 * "A refusal always leaves a trace" is a core safety promise (V0.5.9), and it
 * was silently broken: a DENIED command produced NO audit record at all.
 *
 * Two things hid it. `recordRefusal` swallowed every exception, so a failing
 * write looked exactly like a refusal that was never recorded; and the gate
 * tests stubbed a manager WITHOUT `recordDenied`, so the write path was never
 * exercised at all.
 *
 * These drive the REAL SessionManager and the REAL gate, so a regression fails
 * loudly instead of vanishing into a catch block.
 */
async function connectedManager(sink: Array<Record<string, unknown>>, permissionMode: JumpServerConfig['permissionMode']) {
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
    permissionMode,
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

const DENIED_EXEC = { agent: {}, name: 'jumpserver_exec', callId: 'c1', signal: new AbortController().signal }

describe('V0.5.9 refusal audit: a refusal must leave a trace', () => {
  it('records a DENIED command with its refusal reason', async () => {
    const sink: Array<Record<string, unknown>> = []
    const manager = await connectedManager(sink, 'AUTO')
    sink.length = 0
    const services = {
      getConfig: () => ({ permissionMode: 'AUTO' as const }),
      manager,
      approval: { request: async () => 'rejected' } as never,
    }
    await expect(gateCommand(services, DENIED_EXEC as never, 'rm -rf /nonexistent-probe')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    })
    expect(sink.length).toBe(1)
    expect(sink[0]!.result).toBe('DENIED')
    expect(sink[0]!.refusalReason).toBeTruthy()
    expect(sink[0]!.approvalRequired).toBe(true)
    await manager.close()
  })

  it('records a BLOCKED command with its refusal reason', async () => {
    const sink: Array<Record<string, unknown>> = []
    const manager = await connectedManager(sink, 'READ_ONLY')
    sink.length = 0
    const services = {
      getConfig: () => ({ permissionMode: 'READ_ONLY' as const }),
      manager,
      approval: { request: async () => { throw new Error('must not ask') } } as never,
    }
    const exec = { agent: {}, name: 'jumpserver_exec', callId: 'c2', signal: new AbortController().signal }
    await expect(gateCommand(services, exec as never, 'systemctl restart resin')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    })
    expect(sink.length).toBe(1)
    expect(sink[0]!.result).toBe('BLOCKED')
    expect(sink[0]!.refusalReason).toBeTruthy()
    await manager.close()
  })
})

describe('an audit write failure must not vanish', () => {
  it('surfaces AUDIT_WRITE_FAILED while keeping the gate decision', async () => {
    const sink: Array<Record<string, unknown>> = []
    const manager = await connectedManager(sink, 'AUTO')
    const broken = Object.create(manager) as Record<string, unknown>
    broken['recordDenied'] = async () => { throw new Error('sink exploded') }
    const brokenManager = broken as unknown as SessionManager
    const services = {
      getConfig: () => ({ permissionMode: 'AUTO' as const }),
      manager: brokenManager,
      approval: { request: async () => 'rejected' } as never,
    }
    // A broken sink must NOT flip the decision: the command stays refused, and the
    // failure is reported on `detail` (which guardValue copies into the tool result).
    await expect(gateCommand(services, DENIED_EXEC as never, 'rm -rf /nonexistent-probe')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
      message: 'the user rejected this command; it was not executed',
      detail: expect.stringContaining('AUDIT_WRITE_FAILED: '),
    })
    await manager.close()
  })
})

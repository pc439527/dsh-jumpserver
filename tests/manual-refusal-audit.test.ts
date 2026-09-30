import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import type { JumpServerConfig } from '../src/config/types.js'

/**
 * "A refusal always leaves a trace" applies to PEOPLE, not only to the agent.
 *
 * The console's manual paths returned straight to the caller on MANUAL_BLOCKED,
 * CONFIRMATION_EXPIRED and CONFIRMATION_MISMATCH, so a person whose command was
 * refused left no evidence in the audit trail - while the identical refusal from
 * the agent did. The distinction must be visible, not absent.
 */
function managerOn(sink: Array<Record<string, unknown>>) {
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
    wireFactory: async () => { throw new Error('not used') },
    onAudit: (record) => { sink.push(record as unknown as Record<string, unknown>) },
    onLog: () => {},
  }
  return new SessionManager(options)
}

const CLASSIFICATION = { risk: 'DANGEROUS', reason: 'rule refused', ruleId: 'danger.rm' }

describe('HUMAN refusals are audited', () => {
  it('records MANUAL_BLOCKED with the HUMAN actor', async () => {
    const sink: Array<Record<string, unknown>> = []
    const manager = managerOn(sink)
    await manager.recordDenied({
      operation: 'manual',
      command: 'rm -rf /',
      risk: 'DANGEROUS',
      classification: CLASSIFICATION,
      reason: '人工终端策略拒绝执行修改类命令',
      kind: 'blocked',
      actor: 'HUMAN',
    })
    expect(sink.length).toBe(1)
    expect(sink[0]!.actor).toBe('HUMAN')
    expect(sink[0]!.result).toBe('BLOCKED')
    expect(sink[0]!.operation).toBe('manual')
    expect(sink[0]!.refusalReason).toBeTruthy()
    await manager.close()
  })

  it('defaults the actor to AGENT so existing callers are unchanged', async () => {
    const sink: Array<Record<string, unknown>> = []
    const manager = managerOn(sink)
    await manager.recordDenied({
      operation: 'exec',
      command: 'systemctl restart x',
      risk: 'MODIFY',
      reason: 'no human approval',
      kind: 'denied',
    })
    expect(sink[0]!.actor).toBe('AGENT')
    expect(sink[0]!.result).toBe('DENIED')
    await manager.close()
  })
})

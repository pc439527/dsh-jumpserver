import { describe, expect, it } from 'vitest'
import { gateCommandsForNavigation, type GateServices } from '../src/security/permission-gate.js'

function fixture(outcome: 'allowed-once' | 'rejected' = 'allowed-once') {
  const reasons: string[] = []
  const services = {
    getConfig: () => ({ permissionMode: 'AUTO' as const }),
    manager: {
      status: () => ({ state: 'ASSET_SHELL', target: '203.0.113.10', hostname: 'demo-host' }),
    },
    approval: {
      request: async (args: { reason: string }) => {
        reasons.push(args.reason)
        return outcome
      },
    },
  } as unknown as GateServices
  const controller = new AbortController()
  const exec = {
    agent: {},
    name: 'jumpserver_batch',
    callId: 'call-1',
    signal: controller.signal,
  } as any
  return { services, exec, reasons }
}

describe('batch approval grouping', () => {
  it('asks once for several approval-required commands on one target', async () => {
    const { services, exec, reasons } = fixture()
    const gated = await gateCommandsForNavigation(services, exec, [
      'unknown-tool --one',
      'another-unknown-tool --two',
      'hostname',
    ])
    expect(gated.map((g) => g.approvalRequired)).toEqual([true, true, false])
    await gated[0]!.beforeExec!()
    await gated[1]!.beforeExec!()
    expect(reasons).toHaveLength(1)
    expect(reasons[0]).toContain('本批次有 2 条命令需要人工审批')
    expect(reasons[0]).toContain('unknown-tool --one')
    expect(reasons[0]).toContain('another-unknown-tool --two')
  })

  it('does not re-prompt after a rejected grouped approval', async () => {
    const { services, exec, reasons } = fixture('rejected')
    const gated = await gateCommandsForNavigation(services, exec, ['unknown-one', 'unknown-two'])
    await expect(gated[0]!.beforeExec!()).rejects.toThrow()
    await expect(gated[1]!.beforeExec!()).rejects.toThrow()
    expect(reasons).toHaveLength(1)
  })

  it('redacts secrets in grouped approval text', async () => {
    const { services, exec, reasons } = fixture()
    const gated = await gateCommandsForNavigation(services, exec, [
      'unknown-one --token super-secret',
      'unknown-two PASSWORD=hunter2',
    ])
    await gated[0]!.beforeExec!()
    expect(reasons[0]).not.toContain('super-secret')
    expect(reasons[0]).not.toContain('hunter2')
    expect(reasons[0]).toContain('******')
  })
})

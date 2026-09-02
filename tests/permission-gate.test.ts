import { describe, expect, it } from 'vitest'
import { gateCommand, gateCommandForNavigation } from '../src/security/permission-gate.js'
import { SessionState } from '../src/jumpserver/state-machine.js'

/** Minimal ToolRunContext that the gate touches. */
function stubExec(agent = {}): any {
  return {
    agent,
    name: 'jumpserver_exec',
    callId: 'call-1',
    signal: { aborted: false } as AbortSignal,
  }
}

function stubManager(state: string, target: string | null = null, hostname: string | null = null): any {
  return {
    status: () => ({
      state,
      gateway: '203.0.113.10:2222',
      target,
      hostname,
      user: target ? 'root' : null,
      pwd: target ? '/root' : null,
      connectedAt: null,
      lastActivityAt: null,
      reconnectCount: 0,
      configured: true,
      permissionMode: 'READ_ONLY',
    }),
  }
}

function stubApproval(outcome: string): any {
  return {
    request: async (req: any) => outcome,
  } as any
}

describe('Test 6: READ_ONLY blocks modifying commands (systemctl restart)', () => {
  it('gateCommand throws COMMAND_BLOCKED without asking approval', async () => {
    const exec = stubExec()
    const services = {
      getConfig: () => ({ permissionMode: 'READ_ONLY' as const }),
      manager: stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01'),
      approval: ({ request: async () => { throw new Error('must not ask') } }) as any,
    }
    await expect(gateCommand(services, exec, 'systemctl restart resin')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    })
  })

  it('gateCommandForNavigation throws COMMAND_BLOCKED up front', async () => {
    const services = {
      getConfig: () => ({ permissionMode: 'READ_ONLY' as const }),
      manager: stubManager(SessionState.JUMPSERVER_MENU),
    }
    await expect(gateCommandForNavigation(services, stubExec(), 'docker stop resin')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    })
  })

  it('read-only commands pass in READ_ONLY without approval', async () => {
    const services = {
      getConfig: () => ({ permissionMode: 'READ_ONLY' as const }),
      manager: stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01'),
    }
    const gated = await gateCommand(services, stubExec(), 'hostname; uptime; df -h')
    expect(gated.risk).toBe('READ')
    expect(gated.beforeExec).toBeUndefined()
  })
})

describe('Test 7: AUTO asks native approval for modifying commands', () => {
  it('AUTO + systemctl restart -> approval request -> allowed-once proceeds', async () => {
    let asked = 0
    const services = {
      getConfig: () => ({ permissionMode: 'AUTO' as const }),
      manager: stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01'),
      approval: ({
        request: async (req: any) => {
          asked++
          expect(req.agent).toBeDefined()
          expect(req.toolName).toBe('jumpserver_exec')
          expect(req.reason).toContain('systemctl restart resin')
          return 'allowed-once'
        },
      }) as any,
    }
    const gated = await gateCommand(services, stubExec(), 'systemctl restart resin')
    expect(gated.risk).toBe('MODIFY')
    expect(asked).toBe(1)
  })

  it('AUTO + rejected -> COMMAND_BLOCKED', async () => {
    const services = {
      getConfig: () => ({ permissionMode: 'AUTO' as const }),
      manager: stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01'),
      approval: stubApproval('rejected'),
    }
    await expect(gateCommand(services, stubExec(), 'systemctl restart resin')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    })
  })

  it('AUTO + run tool defers approval via beforeExec (after navigation)', async () => {
    const services = {
      getConfig: () => ({ permissionMode: 'AUTO' as const }),
      manager: stubManager(SessionState.JUMPSERVER_MENU),
      approval: stubApproval('allowed-once'),
    }
    const gated = await gateCommandForNavigation(services, stubExec(), 'touch /tmp/x')
    expect(gated.risk).toBe('MODIFY')
    expect(typeof gated.beforeExec).toBe('function')
    // after navigation, the manager reports ASSET_SHELL; beforeExec asks approval
    services.manager = stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01')
    await expect(gated.beforeExec!()).resolves.toBeUndefined()
  })

  it('AUTO + run tool + unverified target -> TARGET_VERIFICATION_FAILED (beforeExec)', async () => {
    const services = {
      getConfig: () => ({ permissionMode: 'AUTO' as const }),
      manager: stubManager(SessionState.JUMPSERVER_MENU),
      approval: stubApproval('allowed-once'),
    }
    const gated = await gateCommandForNavigation(services, stubExec(), 'rm /tmp/x')
    // session never entered the asset -> verification fails inside beforeExec
    await expect(gated.beforeExec!()).rejects.toMatchObject({ code: 'TARGET_VERIFICATION_FAILED' })
  })
})

describe('Test 8: FULL_ACCESS semantics', () => {
  it('FULL_ACCESS allows ordinary modify without approval', async () => {
    const services = {
      getConfig: () => ({ permissionMode: 'FULL_ACCESS' as const }),
      manager: stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01'),
      approval: ({ request: async () => { throw new Error('must not ask') } }) as any,
    }
    const gated = await gateCommand(services, stubExec(), 'touch /tmp/x')
    expect(gated.risk).toBe('MODIFY')
    expect(gated.beforeExec).toBeUndefined()
  })

  it('FULL_ACCESS still asks approval for rm -rf / (DANGEROUS)', async () => {
    let asked = 0
    const services = {
      getConfig: () => ({ permissionMode: 'FULL_ACCESS' as const }),
      manager: stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01'),
      approval: ({
        request: async (req: any) => {
          asked++
          expect(req.reason).toContain('rm -rf /')
          return 'allowed-once'
        },
      }) as any,
    }
    const gated = await gateCommand(services, stubExec(), 'rm -rf /')
    expect(gated.risk).toBe('DANGEROUS')
    expect(asked).toBe(1)
  })

  it('FULL_ACCESS still asks on the run tool for DANGEROUS', async () => {
    const services = {
      getConfig: () => ({ permissionMode: 'FULL_ACCESS' as const }),
      manager: stubManager(SessionState.JUMPSERVER_MENU),
      approval: stubApproval('allowed-once'),
    }
    const gated = await gateCommandForNavigation(services, stubExec(), 'rm -rf /')
    services.manager = stubManager(SessionState.ASSET_SHELL, '203.0.113.101', 'web-app-01')
    await expect(gated.beforeExec!()).resolves.toBeUndefined()
  })
})

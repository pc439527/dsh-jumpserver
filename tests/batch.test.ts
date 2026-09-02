import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
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

/** Queue deterministic replies for a full two-target batch (target affinity). */
function queueTwoTargetBatch(wire: FakeWire): void {
  // connect(): no write, menu arrives asynchronously
  setTimeout(() => wire.emit(KOKO_MENU), 20)
  // enter 101: write target -> ASSET_PROMPT; probe -> probeReply
  wire.queue(ASSET_PROMPT)
  wire.queue(probeReply)
  // exec on 101
  wire.queue(doneReply) // df -h
  wire.queue(doneReply) // free -m
  // leave: write exit -> KOKO_MENU
  wire.queue(KOKO_MENU)
  // enter 102: write target -> ASSET_PROMPT; probe -> probeReply
  wire.queue(ASSET_PROMPT)
  wire.queue(probeReply)
  // exec on 102
  wire.queue(doneReply) // uptime
}

describe('SessionManager.runTargetBatch (V0.2 target affinity)', () => {
  it('runs every command of target A, exits, then enters target B (never bounces)', async () => {
    const wire = new FakeWire()
    const observer = new TerminalObserver()
    const manager = new SessionManager(makeOptions(wire, { observer }))
    queueTwoTargetBatch(wire)

    const first = await manager.runTargetBatch({
      target: '203.0.113.101',
      commands: [
        { command: 'df -h', risk: 'READ' },
        { command: 'free -m', risk: 'READ' },
      ],
    })
    const second = await manager.runTargetBatch({
      target: '203.0.113.102',
      commands: [{ command: 'uptime', risk: 'READ' }],
    })

    expect(first.error).toBeNull()
    expect(first.hostname).toBe('web-app-01')
    expect(first.commands).toHaveLength(2)
    expect(first.commands[0]!.executionState).toBe('COMPLETED')
    expect(first.commands[0]!.exitCode).toBe(0)
    expect(first.commands[0]!.output).toContain('Filesystem')
    expect(first.commands[1]!.executionState).toBe('COMPLETED')

    expect(second.error).toBeNull()
    expect(second.hostname).toBe('web-app-01')
    expect(second.commands).toHaveLength(1)
    expect(second.commands[0]!.exitCode).toBe(0)

    // Target affinity proof: all of 101's command writes happen BEFORE the
    // exit write, and all of 102's writes happen AFTER it.
    const writes = wire.writes.map((w) => w.trim().split('\n')[0] ?? '')
    const idxDf = writes.indexOf('df -h')
    const idxFree = writes.indexOf('free -m')
    const idxExit = writes.indexOf('exit')
    const idxUptime = writes.indexOf('uptime')
    expect(idxDf).toBeGreaterThan(-1)
    expect(idxFree).toBeGreaterThan(idxDf)
    expect(idxExit).toBeGreaterThan(idxFree)
    expect(idxUptime).toBeGreaterThan(idxExit)
    expect(writes.filter((w) => w === 'exit')).toHaveLength(1)

    // Observer received the whole flow (inputs + outputs + states + targets)
    const events = observer.snapshot()
    const inputs = events.filter((e) => e.type === 'input' && (e as { data: string }).data === '203.0.113.102')
    expect(inputs).toHaveLength(1)
    const targets = events.filter((e) => e.type === 'target' && (e as { target: string }).target === '203.0.113.102')
    expect(targets).toHaveLength(1)
    const states = events.filter((e) => e.type === 'state')
    expect(states.length).toBeGreaterThan(4)
  })

  it('captures a navigation error per target without aborting the batch', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    // enter fails: the target write produces a connection-failure banner
    wire.queue('\r\n连接失败\r\nPress any key to continue\r\n')
    const result = await manager.runTargetBatch({
      target: '203.0.113.999',
      commands: [{ command: 'hostname', risk: 'READ' }],
    })
    expect(result.error).not.toBeNull()
    expect(result.error!.code).toBe('ASSET_ENTER_TIMEOUT')
    expect(result.commands).toEqual([])
  })

  it('reports DISABLED when the config switch is off', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire, {
      getConfig: () => ({
        enabled: false,
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
      }),
    }))
    const result = await manager.runTargetBatch({
      target: '203.0.113.101',
      commands: [{ command: 'hostname', risk: 'READ' }],
    })
    expect(result.error).not.toBeNull()
    expect(result.error!.code).toBe('DISABLED')
  })
})

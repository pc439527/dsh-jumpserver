import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { SessionState } from '../src/jumpserver/state-machine.js'
import { parseAssetList } from '../src/jumpserver/asset-list.js'
import { sleep } from '../src/jumpserver/timing.js'
import { ASSET_PROMPT, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

/**
 * V0.2.5 regressions:
 *  1. A wire drop DURING a pending operation still schedules the reconnect
 *     (previously onSessionLost returned early and the reconnect was lost).
 *  2. The asset-list capture completes on the KoKo footer + menu prompt
 *     (reportedTotal / complete) instead of the bare 'p' echo.
 */

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

describe('V0.2.5 #1 pending-op disconnect still reconnects', () => {
  it('defers and then schedules a reconnect after the op turn settles', async () => {
    const wire = new FakeWire()
    let scheduled: (() => void) | null = null
    const manager = new SessionManager(
      makeOptions(wire, {
        scheduleTimeout: (fn) => {
          scheduled = fn
          return () => {
            if (scheduled === fn) scheduled = null
          }
        },
      }),
    )
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    // The exec write kills the wire WHILE the command op owns the queue.
    wire.queue((w: string) => {
      wire.close()
      return undefined
    })

    const result = await manager.run({ target: '203.0.113.101', command: 'df -h', risk: 'READ' })
    expect(result.outcome.kind).toBe('signal-lost')
    // onSessionLost saw hasPendingOp() === true, so the reconnect was deferred
    // and scheduled by queue() right after the op's turn settled.
    expect(scheduled).not.toBeNull()

    // Fire the deferred reconnect against a HEALTHY fresh wire.
    const wire2 = new FakeWire()
    ;(manager as unknown as { options: SessionManagerOptions }).options.wireFactory = async () => wire2
    setTimeout(() => wire2.emit(KOKO_MENU), 20)
    scheduled!()
    const deadline = Date.now() + 4000
    while (manager.status().state !== 'JUMPSERVER_MENU' && Date.now() < deadline) await sleep(10)
    expect(manager.status().state).toBe('JUMPSERVER_MENU')
    await manager.close()
  })
})

describe('V0.2.5 #2 footer-driven asset-list completion', () => {
  const rows =
    '  1      OA-APP-01      203.0.113.101       生产区\r\n' +
    '  2      OA-APP-02      203.0.113.102       生产区\r\n'
  const footer = '页码: 1\r\n每页行数: 2\r\n总页数: 1\r\n总数量: 2\r\nOpt> '

  it('parseAssetList reports reportedTotal + complete from the footer', () => {
    const r = parseAssetList(rows + footer)
    expect(r.health).toBe('ok')
    expect(r.reportedTotal).toBe(2)
    expect(r.complete).toBe(true)
    expect(r.parsedRows).toBe(2)
  })

  it('the p echo alone never produces LIST_EMPTY / ok — only INCOMPLETE', () => {
    expect(parseAssetList('Opt> p\r\nOpt> ').health).toBe('ASSET_CAPTURE_INCOMPLETE')
  })
})

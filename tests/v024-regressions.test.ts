import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../src/config/types.js'
import { parseAssetList, filterAssets } from '../src/jumpserver/asset-list.js'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import { SessionRegistry } from '../src/jumpserver/session-registry.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { SessionState } from '../src/jumpserver/state-machine.js'
import { sleep } from '../src/jumpserver/timing.js'
import { SessionGrant } from '../src/security/grant.js'
import { registerJumpServerTools } from '../src/tools/definitions.js'
import { registerJumpServerCommand } from '../src/commands/grant-command.js'
import type { CommandAgentLike, CommandDefinition } from '../src/commands/service-types.js'
import { TERMINAL_CSS } from '../src/client/styles.js'
import { FakeWire, KOKO_MENU } from './helpers.js'

/**
 * V0.2.4 regressions — the review's P0/P1 items, fixed in code and pinned here:
 *  1. Sidebar TabBar overlay (CSS: never absolute).
 *  2. listAssets race (wait for the first byte, then the quiet timer).
 *  3. KoKo pipe-table parser (the real 171-row format) + parse health.
 *  4. /jumpserver Session Grant gating every jumpserver_* tool.
 *  5. Per-conversation asset cache (one 'p' per conversation).
 *  6. /jumpserver off revokes the grant and closes the session.
 */

/** Real-world KoKo pipe-table rows (from the production capture the review cited). */
const PIPE_TABLE =
  '\r\n' +
  '151 | s113181_BI节点2       | 203.0.113.181 | Linux | 示例单位\r\n' +
  '152 | s113182_BI_olap_mining | 203.0.113.182 | Linux | 示例单位\r\n' +
  '167 | s113099_nginx服务器         | 203.0.113.99  | Linux | 示例单位\r\n' +
  '168 | S113101_OA应用1             | 203.0.113.101 | Linux | 示例单位\r\n' +
  'Opt> '


function baseConfig(overrides: Partial<JumpServerConfig> = {}): JumpServerConfig {
  return {
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
    ...overrides,
  }
}

function makeManagerOptions(wire: FakeWire, overrides: Partial<SessionManagerOptions> = {}): SessionManagerOptions {
  return {
    getConfig: () => baseConfig(),
    resolvePassword: async () => 'secret',
    wireFactory: async () => wire,
    onLog: () => {},
    ...overrides,
  }
}

describe('V0.2.4 #1 sidebar overlay (CSS)', () => {
  it('the pane is relative flex and never absolutely covers Better Sidebar chrome', () => {
    const pane = TERMINAL_CSS.match(/\.js-term-pane\{[^}]*\}/)?.[0] ?? ''
    expect(pane).toContain('position:relative')
    expect(pane).not.toContain('position:absolute')
    expect(pane).not.toContain('inset:0')
    expect(pane).toContain('flex:1')
    expect(pane).toContain('min-height:0')
  })
})

describe('V0.2.4 #3 KoKo pipe-table parser + parse health', () => {
  it('parses the real pipe-table rows into index/name/ip/platform/node', () => {
    const r = parseAssetList(PIPE_TABLE)
    expect(r.rawRows).toBe(4)
    expect(r.parsedRows).toBe(4)
    expect(r.health).toBe('ok')
    const first = r.assets[0]!
    expect(first).toMatchObject({ index: 151, name: 's113181_BI节点2', ip: '203.0.113.181', platform: 'Linux', node: '示例单位' })
    expect(r.assets[2]).toMatchObject({ name: 's113099_nginx服务器', ip: '203.0.113.99' })
  })

  it('filters locally across name/ip/platform/node', () => {
    expect(parseAssetList(PIPE_TABLE, 'oa').assets.map((a) => a.name)).toEqual(['S113101_OA应用1'])
    expect(parseAssetList(PIPE_TABLE, 'linux').assets).toHaveLength(4)
    expect(parseAssetList(PIPE_TABLE, '示例单位').assets).toHaveLength(4)
    expect(parseAssetList(PIPE_TABLE, '113.181').assets.map((a) => a.name)).toEqual(['s113181_BI节点2'])
    expect(parseAssetList(PIPE_TABLE, 'nomatch').assets).toHaveLength(0)
  })

  it('keeps the whitespace layout working (V0.2.3 format)', () => {
    const classic = '  1      OA-APP-01      203.0.113.101       生产区\r\n  2      OA-APP-02      203.0.113.102       生产区\r\nOpt> '
    const r = parseAssetList(classic, '113.102')
    expect(r.health).toBe('ok')
    expect(r.assets).toHaveLength(1)
    expect(r.assets[0]).toMatchObject({ name: 'OA-APP-02', ip: '203.0.113.102', comment: '生产区' })
  })

  it('never reports a parser failure as an empty account', () => {
    // capture produced nothing
    expect(parseAssetList('').health).toBe('ASSET_CAPTURE_TIMEOUT')
    // only the p echo / menu prompt -> INCOMPLETE (was wrongly LIST_EMPTY)
    expect(parseAssetList('\r\nOpt> \r\n').health).toBe('ASSET_CAPTURE_INCOMPLETE')
    expect(parseAssetList('p\r\nOpt> ').health).toBe('ASSET_CAPTURE_INCOMPLETE')
    // numbered rows exist but the parser rejects every one -> parse failure
    const hostile = '  1      ┌───── system table ─────┐\r\n  2      └──────────────────────────┘\r\nOpt> '
    expect(parseAssetList(hostile).health).toBe('ASSET_PARSE_FAILED')
  })

  it('filterAssets applies a term without touching parsing health', () => {
    const r = parseAssetList(PIPE_TABLE)
    expect(filterAssets(r.assets, 'nginx')).toHaveLength(1)
    expect(filterAssets(r.assets, undefined)).toHaveLength(r.assets.length)
  })
})

describe('V0.2.4 #2 listAssets race (first byte then quiet timer)', () => {
  it('captures a delayed p reply instead of breaking on session quietness', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeManagerOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    // The 'p' write gets NO immediate reply; the asset table lands 1100ms
    // later — the OLD break-on-session-quiet logic returned an empty capture
    // before it arrived (the 171-asset race).
    wire.queue(() => undefined)
    const pending = manager.listAssets('OA')
    setTimeout(() => wire.emit(PIPE_TABLE), 1100)
    const result = await pending
    expect(result.assets.length).toBeGreaterThan(0)
    expect(result.health).toBe('ok')
    await manager.close()
  })
})

describe('V0.2.4 #8 per-conversation asset cache', () => {
  it('reuses one p capture for later filtered queries', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeManagerOptions(wire, { getConfig: () => baseConfig({ assetCacheTtlSeconds: 300 }) }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w) => (w.startsWith('p') ? PIPE_TABLE : undefined))
    const first = await manager.listAssets('oa')
    expect(first.assets.length).toBeGreaterThan(0)
    expect(wire.writes.filter((w) => w === 'p\r').length).toBe(1)
    const second = await manager.listAssets('113.99')
    expect(second.assets).toHaveLength(1)
    expect(wire.writes.filter((w) => w === 'p\r').length).toBe(1)
    await manager.close()
  })

  it('drops the cache when the session closes', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeManagerOptions(wire, { getConfig: () => baseConfig({ assetCacheTtlSeconds: 300 }) }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w) => (w.startsWith('p') ? PIPE_TABLE : undefined))
    await manager.listAssets()
    await manager.close()
    expect((manager as unknown as { assetCache: unknown }).assetCache).toBeNull()
  })
})

// ---------- grant gate at the tool layer ----------
function makeRegistryFor(wire: FakeWire): SessionRegistry {
  return new SessionRegistry({
    create: () => {
      const observer = new TerminalObserver(500)
      const manager = new SessionManager({
        getConfig: () => baseConfig(),
        resolvePassword: async () => 'secret',
        observer,
        wireFactory: async () => wire,
        onLog: () => {},
      })
      observer.recordState(SessionState.DISCONNECTED, null)
      return { manager, observer, lastUsedAt: Date.now() }
    },
  })
}

interface CapturedTool {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<Record<string, unknown>>
}

function registerToolsFor(registry: SessionRegistry, grants: SessionGrant, wire: FakeWire): CapturedTool[] {
  const captured: CapturedTool[] = []
  const fakeCtx = {
    tools: {
      register: (def: { name: string; execute: (args: Record<string, unknown>, exec: unknown) => Promise<Record<string, unknown>> }) => {
        captured.push(def)
        return () => undefined
      },
    },
    get: () => undefined,
    logger: { debug() {}, warn() {}, info() {} },
  } as unknown as Context
  registerJumpServerTools(fakeCtx, registry, () => baseConfig(), grants)
  return captured
}

function execFor(sessionId: string): unknown {
  return {
    agent: { session: { header: { id: sessionId } } },
    signal: new AbortController().signal,
  }
}

describe('V0.2.4 #4 session grant gates every jumpserver_* tool', () => {
  it('every tool returns JUMPSERVER_NOT_ARMED while the conversation is locked', async () => {
    const wire = new FakeWire()
    const grants = new SessionGrant()
    const registry = makeRegistryFor(wire)
    const defs = registerToolsFor(registry, grants, wire)
    expect(defs.map((d) => d.name)).toEqual([
      'jumpserver_status',
      'jumpserver_connect',
      'jumpserver_enter',
      'jumpserver_assets',
      'jumpserver_exec',
      'jumpserver_run',
      'jumpserver_batch',
      'jumpserver_leave',
      'jumpserver_close',
    ])
    // enter/exec/run/batch declare required args; the tool wrapper validates
    // them before our gate runs, so pass valid shapes for those.
    const validArgs: Record<string, Record<string, unknown>> = {
      jumpserver_enter: { target: '203.0.113.101' },
      jumpserver_exec: { command: 'free -m' },
      jumpserver_run: { target: '203.0.113.101', command: 'free -m' },
      jumpserver_batch: { tasks: [{ target: '203.0.113.101', commands: ['free -m'] }] },
    }
    for (const def of defs) {
      const value = await def.execute(validArgs[def.name] ?? {}, execFor('conversation-A'))
      expect(value.ok).toBe(false)
      expect(value.code).toBe('JUMPSERVER_NOT_ARMED')
    }
  })

  it('a granted conversation can list assets through the tool with a real wire', async () => {
    const wire = new FakeWire()
    const grants = new SessionGrant()
    const registry = makeRegistryFor(wire)
    const defs = registerToolsFor(registry, grants, wire)
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w) => (w.startsWith('p') ? PIPE_TABLE : undefined))
    grants.arm('conversation-A', 'persistent')
    const assets = defs.find((d) => d.name === 'jumpserver_assets')!
    const value = await assets.execute({ filter: 'oa' }, execFor('conversation-A'))
    expect(value.ok).toBe(true)
    expect(value.health).toBe('ok')
    expect(Array.isArray(value.assets)).toBe(true)
  })

  it('the grant is conversation-scoped: another conversation stays locked', async () => {
    const wire = new FakeWire()
    const grants = new SessionGrant()
    const registry = makeRegistryFor(wire)
    const defs = registerToolsFor(registry, grants, wire)
    grants.arm('conversation-A', 'persistent')
    const status = defs.find((d) => d.name === 'jumpserver_status')!
    const locked = await status.execute({}, execFor('conversation-B'))
    expect(locked.code).toBe('JUMPSERVER_NOT_ARMED')
    grants.revoke('conversation-A')
    expect(grants.isGranted('conversation-A')).toBe(false)
    expect(grants.isGranted('conversation-B')).toBe(false)
  })

  it('turn-scoped grants auto-expire and are pruned from the grant index', () => {
    let now = 1000
    const grants = new SessionGrant(() => now)
    grants.arm('conversation-A', 'turn', 5000)
    expect(grants.isGranted('conversation-A')).toBe(true)
    now += 5001
    expect(grants.isGranted('conversation-A')).toBe(false)
    expect(grants.sessionIds()).toEqual([])
  })
})

// ---------- /jumpserver command ----------
describe('V0.2.4 #4/#9 /jumpserver command semantics', () => {
  function harness() {
    const defs: CommandDefinition[] = []
    const grants = new SessionGrant()
    const registry = new SessionRegistry({
      create: () => {
        const observer = new TerminalObserver(500)
        const manager = new SessionManager({
          getConfig: () => baseConfig(),
          resolvePassword: async () => 'secret',
          observer,
          wireFactory: async () => new FakeWire(),
          onLog: () => {},
        })
        observer.recordState(SessionState.DISCONNECTED, null)
        return { manager, observer, lastUsedAt: Date.now() }
      },
    })
    const fakeCtx = {
      commands: { register: (d: CommandDefinition) => { defs.push(d); return () => undefined } },
      logger: { debug() {}, warn() {}, info() {} },
    } as unknown as Context
    registerJumpServerCommand(fakeCtx, registry, () => baseConfig(), grants)
    const def = defs[0]!
    return { def, grants, registry }
  }

  function agentOf(sessionId: string, listeners: Array<(p: unknown) => void>, onFollowup: (text: string) => void): CommandAgentLike {
    return {
      id: sessionId,
      session: { header: { id: sessionId } },
      status: 'idle',
      ctx: {
        on: (_event: string, listener: (payload: unknown) => void): (() => void) => {
          listeners.push(listener)
          return () => undefined
        },
      },
      followup: (message: { content: Array<{ type: string; text: string }> }) => onFollowup(message.content[0]!.text),
      whenIdle: async () => undefined,
    } as unknown as CommandAgentLike
  }

  function invoke(def: CommandDefinition, agent: CommandAgentLike, rawInput: string) {
    return def.handler({ commandId: 'c1', agent, rawInput, signal: new AbortController().signal })
  }

  it('/jumpserver <task> arms a turn-scoped grant, dispatches the task, and auto-locks on turn settle', async () => {
    const { def, grants } = harness()
    const listeners: Array<(p: unknown) => void> = []
    let followupText: string | null = null
    const agent = agentOf('conversation-C', listeners, (text) => { followupText = text })

    const result = await invoke(def, agent, '看看有哪些 OA 服务器')
    expect(result.kind).toBe('success')
    expect(grants.isGranted('conversation-C')).toBe(true)
    expect(grants.modeOf('conversation-C')).toBe('turn')
    expect(followupText).toBe('看看有哪些 OA 服务器')

    // the followup turn settles -> agent idle -> the grant auto-locks
    for (const listener of listeners) listener({ agent: { id: 'conversation-C' }, status: 'idle' })
    expect(grants.isGranted('conversation-C')).toBe(false)
  })

  it('bare /jumpserver only shows help and grants NOTHING (V0.2.5)', async () => {
    const { def, grants } = harness()
    const agent = agentOf('conversation-C', [], () => undefined)
    const bare = await invoke(def, agent, '')
    expect(bare.kind).toBe('success')
    expect(String((bare as { text?: string }).text)).toContain('用法')
    expect(grants.isGranted('conversation-C')).toBe(false)
  })

  it('/jumpserver on grants persistently until off', async () => {
    const { def, grants } = harness()
    const agent = agentOf('conversation-C', [], () => undefined)
    const on = await invoke(def, agent, 'on')
    expect(on.kind).toBe('success')
    expect(grants.modeOf('conversation-C')).toBe('persistent')
    const status = await invoke(def, agent, 'status')
    expect(String((status as { text?: string }).text)).toContain('ARMED')
    const off = await invoke(def, agent, 'off')
    expect(off.kind).toBe('success')
    expect(grants.isGranted('conversation-C')).toBe(false)
  })

  it('/jumpserver status reports the grant and session state', async () => {
    const { def, grants } = harness()
    const agent = agentOf('conversation-C', [], () => undefined)
    const locked = await invoke(def, agent, 'status')
    expect(locked.kind).toBe('success')
    expect(String((locked as { text?: string }).text)).toContain('LOCKED')
    await invoke(def, agent, 'on')
    const armed = await invoke(def, agent, 'status')
    expect(String((armed as { text?: string }).text)).toContain('ARMED')
  })

  it('/jumpserver off closes a live conversation session (PTY + cache cleanup path)', async () => {
    const { def, grants, registry } = harness()
    const agent = agentOf('conversation-C', [], () => undefined)
    await invoke(def, agent, 'on')
    const bundle = registry.getOrCreate('conversation-C')
    await invoke(def, agent, 'off')
    expect(grants.isGranted('conversation-C')).toBe(false)
    expect(bundle.manager.status().state).toBe(SessionState.DISCONNECTED)
  })
})

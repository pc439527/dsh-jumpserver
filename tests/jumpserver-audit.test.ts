/**
 * jumpserver_audit (V0.5.9): the conversation's own audit trail, in chat.
 * A refusal is only useful if its REASON survives the projection, so these
 * cases pin the why= column, the refusal filter and the grant boundary.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../src/config/types.js'
import type { SessionRegistry } from '../src/jumpserver/session-registry.js'
import { SessionGrant } from '../src/security/grant.js'
import { registerJumpServerTools } from '../src/tools/definitions.js'

function cfg(overrides: Partial<JumpServerConfig> = {}): JumpServerConfig {
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
    enableAudit: true,
    ...overrides,
  }
}

interface ToolDef {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<Record<string, unknown>>
}

function harness(entries: Array<Record<string, unknown>>, overrides: Partial<JumpServerConfig> = {}) {
  const grants = new SessionGrant()
  const defs: ToolDef[] = []
  const fakeCtx = {
    tools: { register: (def: ToolDef) => { defs.push(def); return () => undefined } },
    get: () => undefined,
    logger: { debug() {}, warn() {}, info() {} },
  } as unknown as Context
  // Minimal registry stub: only the audit tool's dependencies are exercised,
  // but jumpserver_status needs a bundle whose manager can report a status.
  const bundle = {
    manager: {
      status: () => ({
        state: 'DISCONNECTED', gateway: '203.0.113.10:2222', target: null, hostname: null, user: null,
        pwd: null, connectedAt: null, lastActivityAt: null, reconnectCount: 0, configured: true, permissionMode: 'READ_ONLY',
      }),
    },
    observer: { recordState() {} },
    lastUsedAt: Date.now(),
  }
  const registry = { getOrCreate: () => bundle, get: () => bundle } as unknown as SessionRegistry
  registerJumpServerTools(
    fakeCtx,
    registry,
    () => cfg(overrides),
    grants,
    undefined,
    () => entries,
    // Desktop 0.2.x: stable token-free loopback console URL.
    () => 'http://127.0.0.1:8766/',
  )
  const def = defs.find((d) => d.name === 'jumpserver_audit')!
  const execFor = (sessionId: string) => ({ agent: { session: { header: { id: sessionId } } }, signal: new AbortController().signal, name: 'jumpserver_audit', callId: 'c1' })
  return { grants, def, execFor, defs }
}

const RUN: Record<string, unknown> = {
  timestamp: '2026-09-28T02:00:00.000Z',
  operation: 'run',
  target: '203.0.113.101',
  hostname: 'web-app-01',
  command: 'df -h',
  redactedCommand: 'df -h',
  actor: 'AGENT',
  risk: 'READ',
  result: 'ok',
  exitCode: 0,
  durationMs: 42,
  toolCallId: 'call-9',
}

const BLOCKED: Record<string, unknown> = {
  timestamp: '2026-09-28T02:01:00.000Z',
  operation: 'run',
  target: '203.0.113.101',
  command: 'rm -rf /var',
  redactedCommand: 'rm -rf /var',
  actor: 'AGENT',
  risk: 'DANGEROUS',
  result: 'BLOCKED',
  refusalReason: '规则 dangerous.rm 拒绝',
  toolCallId: 'call-10',
}

describe('jumpserver_status console handover', () => {
  it('reports the loopback console URL for THIS conversation', async () => {
    const h = harness([], {})
    h.grants.arm('conversation-A', 'persistent')
    const status = h.defs.find((d) => d.name === 'jumpserver_status')!
    const value = await status.execute({}, h.execFor('conversation-A'))
    expect(value.consoleUrl).toBe('http://127.0.0.1:8766/')
  })
})

describe('jumpserver_audit', () => {
  it('is grant-gated like every other jumpserver_* tool', async () => {
    const h = harness([RUN])
    const value = await h.def.execute({}, h.execFor('conversation-A'))
    expect(value.code).toBe('JUMPSERVER_NOT_ARMED')
  })

  it('lists this conversation\'s trail with local time and the refusal reason', async () => {
    const h = harness([RUN, BLOCKED], { timeZone: 'Asia/Shanghai' })
    h.grants.arm('conversation-A', 'persistent')
    const value = await h.def.execute({}, h.execFor('conversation-A'))
    expect(value.ok).toBe(true)
    expect(value.entries).toBe(2)
    expect(value.showing).toBe(2)
    expect(value.timeZone).toBe('Asia/Shanghai')
    expect(value.refusalCount).toBe(1)
    const output = String(value.output)
    // 02:00Z is 10:00 in Asia/Shanghai.
    expect(output).toContain('10:00')
    expect(output).toContain('why=规则 dangerous.rm 拒绝')
    expect(output).toContain('actor=AGENT')
    expect(output).toContain('call=call-9')
  })

  it('filters to refusals and applies the limit to the newest entries', async () => {
    const h = harness([RUN, BLOCKED, RUN], {})
    h.grants.arm('conversation-A', 'persistent')
    const refusals = await h.def.execute({ refusalsOnly: true }, h.execFor('conversation-A'))
    expect(refusals.entries).toBe(1)
    expect(String(refusals.output)).toContain('BLOCKED')
    const limited = await h.def.execute({ limit: 1 }, h.execFor('conversation-A'))
    expect(limited.entries).toBe(3)
    expect(limited.showing).toBe(1)
  })

  it('filters by substring across the whole entry', async () => {
    const h = harness([RUN, BLOCKED], {})
    h.grants.arm('conversation-A', 'persistent')
    const value = await h.def.execute({ filter: 'dangerous' }, h.execFor('conversation-A'))
    expect(value.entries).toBe(1)
    expect(String(value.output)).toContain('rm -rf /var')
    expect(value.filtered).toBe(true)
  })
})

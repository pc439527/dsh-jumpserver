/**
 * V0.5.7/5.8/5.9 safety layers on the DSH permission gate:
 *  - a rule refusal writes exactly one BLOCKED audit record before it throws;
 *  - a refused approval writes exactly one DENIED record (and the command is
 *    never executed);
 *  - the semantic judge is ADVISORY by default: its verdict lands in the
 *    approval copy and changes nothing else;
 *  - with autoAllow enabled and a verdict clearing every threshold, the prompt
 *    is skipped — and exactly there.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { APPROVAL_DENIED_REASON } from '../src/jumpserver/errors.js'
import { gateCommand, gateCommandForNavigation } from '../src/security/permission-gate.js'
import { classifyCommand } from '../src/security/command-classifier.js'
import { resetRiskJudgeCache } from '../src/security/risk-judge.js'
import { DEFAULT_RISK_JUDGE, type JumpServerConfig, type RiskJudgeConfig } from '../src/config/types.js'
import type { SessionManager } from '../src/jumpserver/session-manager.js'
import type { SessionState } from '../src/jumpserver/state-machine.js'

const TARGET = '203.0.113.101'
const UNKNOWN_COMMAND = 'frobnicate --check node14'

function judgeConfig(overrides: Partial<RiskJudgeConfig> = {}): RiskJudgeConfig {
  return { ...DEFAULT_RISK_JUDGE, enabled: true, apiKeyEnv: 'DSH_TEST_JUDGE_KEY', ...overrides }
}

function config(overrides: Partial<JumpServerConfig> = {}): JumpServerConfig {
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
    permissionMode: 'AUTO',
    autoReconnect: true,
    enableAudit: false,
    ...overrides,
  }
}

interface Harness {
  services: Parameters<typeof gateCommand>[0]
  records: Array<Record<string, unknown>>
  approvals: string[]
  exec: Parameters<typeof gateCommand>[1]
}

/** A shell-verified session stub: the gate only needs status() + recordDenied(). */
function harness(cfg: JumpServerConfig, approvalOutcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable' = 'allowed-once'): Harness {
  const records: Array<Record<string, unknown>> = []
  const approvals: string[] = []
  const manager = {
    status: () => ({
      state: 'ASSET_SHELL' as unknown as SessionState,
      gateway: '203.0.113.10:2222',
      target: TARGET,
      hostname: 'web-app-01',
      user: 'root',
      pwd: '/root',
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      reconnectCount: 0,
      configured: true,
      permissionMode: cfg.permissionMode,
    }),
    recordDenied: async (input: Record<string, unknown>) => { records.push(input) },
  } as unknown as SessionManager
  const exec = {
    name: 'jumpserver_exec',
    callId: 'call-1',
    agent: { session: { header: { id: 'conv-1' } } },
    signal: new AbortController().signal,
    arguments: {},
  } as unknown as Parameters<typeof gateCommand>[1]
  return {
    services: {
      getConfig: () => cfg,
      manager,
      approval: {
        request: async (opts: { reason: string }) => { approvals.push(opts.reason); return approvalOutcome },
      },
    } as unknown as Harness['services'],
    records,
    approvals,
    exec,
  }
}

const MODIFY_COMMAND = 'systemctl restart nginx'

describe('V0.5.9 refusal audit', () => {
  it('writes exactly one BLOCKED record when the rules refuse the command', async () => {
    const h = harness(config({ permissionMode: 'READ_ONLY' }))
    await expect(gateCommandForNavigation(h.services, h.exec, MODIFY_COMMAND)).rejects.toThrow(/COMMAND_BLOCKED|blocked/i)
    expect(h.records).toHaveLength(1)
    expect(h.records[0]!.kind).toBe('blocked')
    expect(String(h.records[0]!.reason ?? '').length).toBeGreaterThan(0)
    expect(h.records[0]!.command).toBe(MODIFY_COMMAND)
    expect(h.records[0]!.toolCallId).toBe('call-1')
    expect(h.approvals).toHaveLength(0)
  })

  it('writes exactly one DENIED record when approval is not granted, and never executes', async () => {
    const h = harness(config({ permissionMode: 'AUTO' }), 'rejected')
    await expect(gateCommand(h.services, h.exec, MODIFY_COMMAND)).rejects.toThrow()
    expect(h.records).toHaveLength(1)
    expect(h.records[0]!.kind).toBe('denied')
    expect(h.records[0]!.reason).toBe(APPROVAL_DENIED_REASON)
  })

  it('records nothing for a command that simply runs', async () => {
    const h = harness(config({ permissionMode: 'READ_ONLY' }))
    const gated = await gateCommand(h.services, h.exec, 'df -h')
    expect(gated.approvalRequired).toBe(false)
    expect(h.records).toHaveLength(0)
  })
})

describe('V0.5.7/5.8 semantic judge', () => {
  const originalFetch = globalThis.fetch
  const originalKey = process.env['DSH_TEST_JUDGE_KEY']

  beforeEach(() => {
    resetRiskJudgeCache()
    process.env['DSH_TEST_JUDGE_KEY'] = 'test-key'
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env['DSH_TEST_JUDGE_KEY']
    else process.env['DSH_TEST_JUDGE_KEY'] = originalKey
    resetRiskJudgeCache()
  })

  function mockJudge(overrides: Record<string, unknown> = {}): void {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        answers: {
          read_only: { noul: 0.99, confidence: 0.95 },
          risk_level: { score: 0.1, probabilities: { '0': 0.94, '1': 0.05 }, confidence: 0.9 },
          impact: { choice: 'none', confidence: 0.95 },
          needs_privilege: { noul: 0.02, confidence: 0.95 },
          ...overrides,
        },
      }),
    })) as unknown as typeof fetch
  }

  it('is advisory by default: the verdict reaches the prompt, the outcome does not change', async () => {
    expect(classifyCommand(UNKNOWN_COMMAND).risk).toBe('UNKNOWN')
    mockJudge()
    const h = harness(config({ permissionMode: 'AUTO', riskJudge: judgeConfig() }))
    const gated = await gateCommand(h.services, h.exec, UNKNOWN_COMMAND)
    expect(gated.approvalRequired).toBe(true)
    expect(gated.judgeAutoAllowed).toBeUndefined()
    expect(h.approvals).toHaveLength(1)
    expect(h.approvals[0]).toContain('语义副驾')
    expect(h.approvals[0]).toContain('仅供参考')
    expect(gated.judgeNote).toContain('ADVISORY')
  })

  it('never sends MODIFY / DANGEROUS / READ commands to the judge', async () => {
    let calls = 0
    globalThis.fetch = (async () => { calls += 1; return { ok: true, json: async () => ({}) } }) as unknown as typeof fetch
    const h = harness(config({ permissionMode: 'AUTO', riskJudge: judgeConfig() }))
    await gateCommand(h.services, h.exec, 'df -h')            // READ: allowed, no prompt
    await gateCommandForNavigation(h.services, h.exec, MODIFY_COMMAND).catch(() => undefined)
    expect(calls).toBe(0)
  })

  it('degrades to a plain prompt when the judge fails (non-2xx / timeout / disabled)', async () => {
    globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    const h = harness(config({ permissionMode: 'AUTO', riskJudge: judgeConfig() }))
    const gated = await gateCommand(h.services, h.exec, UNKNOWN_COMMAND)
    expect(gated.approvalRequired).toBe(true)
    expect(h.approvals).toHaveLength(1)
    expect(h.approvals[0]).not.toContain('语义副驾')
  })

  it('auto-allows only when every threshold passes, and skips the prompt exactly there', async () => {
    mockJudge()
    const autoAllow = { ...DEFAULT_RISK_JUDGE.autoAllow, enabled: true }
    const h = harness(config({ permissionMode: 'AUTO', riskJudge: judgeConfig({ autoAllow }) }))
    const gated = await gateCommand(h.services, h.exec, UNKNOWN_COMMAND)
    expect(gated.approvalRequired).toBe(false)
    expect(gated.judgeAutoAllowed).toBe(true)
    expect(h.approvals).toHaveLength(0)
    expect(gated.judgeNote).toContain('AUTO_ALLOWED')
  })

  it('refuses to auto-allow when the distribution is missing', async () => {
    mockJudge({ risk_level: { score: 0.1, confidence: 0.9 } })
    const autoAllow = { ...DEFAULT_RISK_JUDGE.autoAllow, enabled: true }
    const h = harness(config({ permissionMode: 'AUTO', riskJudge: judgeConfig({ autoAllow }) }))
    const gated = await gateCommand(h.services, h.exec, UNKNOWN_COMMAND)
    expect(gated.approvalRequired).toBe(true)
    expect(h.approvals).toHaveLength(1)
    expect(h.approvals[0]).toContain('自动放行未通过')
  })
})

import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../src/config/types.js'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import { SessionRegistry } from '../src/jumpserver/session-registry.js'
import { SessionState } from '../src/jumpserver/state-machine.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { SessionGrant } from '../src/security/grant.js'
import { OpsCaseRegistry } from '../src/ops/evidence.js'
import { registerOpsTools } from '../src/tools/ops.js'
import { DETECT_PROFILE, linuxCommands, profileCommands, resolveProfile } from '../src/ops/profiles.js'
import { ASSET_PROMPT, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

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

function replyWith(text: string, rc = 0): (written: string) => string | undefined {
  return (written: string): string | undefined => {
    const m = /__DSH_JS_DONE_([0-9A-F]+)/.exec(written)
    if (m === null) return undefined
    return '\n' + text + '\n__DSH_JS_DONE_' + m[1] + ':' + rc + '\n' + ASSET_PROMPT
  }
}

interface ToolDef {
  name: string
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<Record<string, unknown>>
}

function makeOpsHarness(wire: FakeWire, cfg: Partial<JumpServerConfig> = {}) {
  const grants = new SessionGrant()
  const cases = new OpsCaseRegistry()
  const registry = new SessionRegistry({
    create: () => {
      const observer = new TerminalObserver(500)
      const manager = new SessionManager({
        getConfig: () => baseConfig(cfg),
        resolvePassword: async () => 'secret',
        observer,
        wireFactory: async () => wire,
        onLog: () => {},
      })
      observer.recordState(SessionState.DISCONNECTED, null)
      return { manager, observer, lastUsedAt: Date.now() }
    },
  })
  const defs: ToolDef[] = []
  const approvalRequests: string[] = []
  const fakeCtx = {
    tools: {
      register: (def: ToolDef) => {
        defs.push(def)
        return () => undefined
      },
    },
    get: (name: string) => {
      if (name === 'approval') {
        return {
          request: async (opts: Record<string, unknown>) => {
            approvalRequests.push(String(opts['reason'] ?? ''))
            return 'allowed-once'
          },
        }
      }
      return undefined
    },
    logger: { debug() {}, warn() {}, info() {} },
  } as unknown as Context
  registerOpsTools(fakeCtx, registry, () => baseConfig(cfg), grants, cases)
  const execFor = (sessionId: string): unknown => ({ agent: { session: { header: { id: sessionId } } }, signal: new AbortController().signal, name: 'jumpserver_x', callId: 'c1' })
  return { defs, grants, cases, registry, approvalRequests, execFor }
}

function toolOf(defs: ToolDef[], name: string): ToolDef {
  const d = defs.find((x) => x.name === name)
  if (d === undefined) throw new Error('tool not registered: ' + name)
  return d
}

describe('V0.3.0 ops tools: grant + registration', () => {
  it('registers triage/compare/case/remediate and every one is grant-gated', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire)
    expect(h.defs.map((d) => d.name)).toEqual(['jumpserver_triage', 'jumpserver_compare', 'jumpserver_case', 'jumpserver_remediate'])
    const validArgs: Record<string, Record<string, unknown>> = {
      jumpserver_triage: { target: '203.0.113.101' },
      jumpserver_compare: { targets: ['203.0.113.101', '203.0.113.102'] },
      jumpserver_case: { action: 'list' },
      jumpserver_remediate: { target: '203.0.113.101', plan: { change: ['echo hi'] } },
    }
    for (const def of h.defs) {
      const value = await def.execute(validArgs[def.name] ?? {}, h.execFor('conversation-A'))
      expect(value.code).toBe('JUMPSERVER_NOT_ARMED')
    }
  })
})

describe('V0.3.0 jumpserver_triage (auto detect -> nginx profile)', () => {
  it('runs the base sweep, detects nginx, loads the nginx profile, records evidence', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire)
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    // navigation: enter A + probe
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    // phase-1: linux base commands + error window + detection commands
    const baseCount = linuxCommands('30m').length
    for (let i = 0; i < baseCount; i++) wire.queue(replyWith('ok\n'))
    // detection sweep: ps comm / units / listeners mention nginx + java
    wire.queue(replyWith('nginx\njava\nsshd\n'))
    wire.queue(replyWith('nginx.service loaded active running\n'))
    wire.queue(replyWith('LISTEN 0.0.0.0:80 users:(("nginx",pid=1,fd=6))\n'))
    // phase-2: nginx + java profiles
    const nginx = resolveProfile('nginx')!
    const java = resolveProfile('java')!
    for (const c of [...profileCommands(nginx, '30m'), ...profileCommands(java, '30m')]) {
      wire.queue(replyWith('profile-output: ' + c.category + '\n'))
    }
    h.grants.arm('conversation-A', 'persistent')
    const value = await toolOf(h.defs, 'jumpserver_triage').execute({ target: '203.0.113.101' }, h.execFor('conversation-A'))
    expect(value.ok).toBe(true)
    expect(value.hostname).toBe('web-app-01')
    expect(value.detected).toEqual(expect.arrayContaining(['nginx', 'java']))
    expect((value.profiles as string[])).toEqual(expect.arrayContaining(['linux', 'nginx', 'java']))
    expect(value.caseId).toBe('CASE-001')
    const evidence = value.evidence as string[]
    expect(evidence.length).toBe(baseCount + DETECT_PROFILE.commands.length + profileCommands(nginx, '30m').length + profileCommands(java, '30m').length)
    const commands = value.commands as Array<Record<string, unknown>>
    expect(commands.length).toBeGreaterThan(30)
    expect((commands[0] as Record<string, unknown>)['command']).toBe('hostname')
    const caseNow = h.cases.current('conversation-A')
    expect(caseNow?.evidence.size).toBe(evidence.length)
  })
})

describe('V0.3.0 jumpserver_compare', () => {
  const memHigh = '             total        used        free      shared  buff/cache   available\nMem:          15952       14820         300          12         832         900\nSwap:         8192         100        8092\n'
  const memLow = '             total        used        free      shared  buff/cache   available\nMem:          15952        3100       10000         12        2000       12500\nSwap:         8192           0        8192\n'
  const dfHigh = 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   45G  3.3G  94% /\n'
  const dfLow = 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   10G   37G  22% /\n'

  it('normalizes metrics per target and flags deviating nodes', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire)
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    // target A
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue(replyWith('node-a\n'))          // hostname
    wire.queue(replyWith(' 10:00:00 up 13 days,  load average: 1.02, 0.98, 0.95\n')) // uptime
    wire.queue(replyWith(memHigh))              // free -m -> 94%
    wire.queue(replyWith(dfHigh))               // df -> 94%
    wire.queue(replyWith('5\n'))               // app process count
    wire.queue(replyWith('37\n'))              // error lines
    // leave A -> enter B
    wire.queue(KOKO_MENU)
    wire.queue((w: string) => (w.startsWith('203.0.113.102') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue(replyWith('node-b\n'))
    wire.queue(replyWith(' 10:00:00 up 13 days,  load average: 1.05, 0.99, 0.96\n'))
    wire.queue(replyWith(memLow))
    wire.queue(replyWith(dfLow))
    wire.queue(replyWith('2\n'))               // app process count (half of A)
    wire.queue(replyWith('0\n'))
    h.grants.arm('conversation-A', 'persistent')
    const value = await toolOf(h.defs, 'jumpserver_compare').execute(
      { targets: ['203.0.113.101', '203.0.113.102'] },
      h.execFor('conversation-A'),
    )
    expect(value.ok).toBe(true)
    const findings = (value.findings as string[]) ?? []
    expect(findings).toEqual(expect.arrayContaining([
      expect.stringContaining('memory 94% on 203.0.113.101'),
      expect.stringContaining('root disk 94% on 203.0.113.101'),
      expect.stringContaining('error lines 37 on 203.0.113.101'),
      expect.stringContaining('app process count 2 on 203.0.113.102'),
    ]))
    const metrics = value.metrics as Record<string, Record<string, number>>
    expect(metrics['memPct']!['203.0.113.101']).toBe(94)
    expect(metrics['procCount']!['203.0.113.102']).toBe(2)
    expect((value.evidence as string[]).length).toBe(12)
    expect(value.caseId).toBe('CASE-001')
  })
})

describe('V0.3.0 jumpserver_case', () => {
  it('new/list/evidence/hypothesis/action/conclude/report round-trip without a session', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire)
    h.grants.arm('conversation-A', 'persistent')
    const tool = toolOf(h.defs, 'jumpserver_case')
    const create = await tool.execute({ action: 'new', title: 'OA 访问缓慢', servers: ['203.0.113.101'], symptoms: '上午变慢' }, h.execFor('conversation-A'))
    expect(create.caseId).toBe('CASE-001')
    await tool.execute({ action: 'hypothesis', hypothesis: '101 负载过高' }, h.execFor('conversation-A'))
    await tool.execute({ action: 'action', actionNote: '对比两节点' }, h.execFor('conversation-A'))
    await tool.execute({ action: 'conclude', conclusion: '101 内存不足是根因' }, h.execFor('conversation-A'))
    const summary = await tool.execute({ action: 'summary' }, h.execFor('conversation-A'))
    expect(summary.caseId).toBe('CASE-001')
    const list = await tool.execute({ action: 'list' }, h.execFor('conversation-A'))
    expect((list.findings as string[])[0]).toContain('CASE-001')
    const mdReport = await tool.execute({ action: 'report', format: 'markdown' }, h.execFor('conversation-A'))
    expect(String(mdReport.message)).toContain('# Ops Report')
    const jsonReport = await tool.execute({ action: 'report', format: 'json' }, h.execFor('conversation-A'))
    expect(JSON.parse(String(jsonReport.message)).caseId).toBe('CASE-001')
  })

  it('evidence action returns the stored excerpt for an E-xxx id', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire)
    h.grants.arm('conversation-A', 'persistent')
    const tool = toolOf(h.defs, 'jumpserver_case')
    await tool.execute({ action: 'new', title: 'case', servers: [] }, h.execFor('conversation-A'))
    h.cases.appendEvidence('conversation-A', { kind: 'triage', target: '203.0.113.101', hostname: 'oa', category: 'identity', command: 'hostname', exitCode: 0, output: 'web-app-01\n' })
    const ev = await tool.execute({ action: 'evidence', evidenceId: 'E-001' }, h.execFor('conversation-A'))
    expect(ev.message).toContain('hostname')
    expect(ev.commands).toBeDefined()
  })
})

describe('V0.3.0 jumpserver_remediate', () => {
  const PLAN = {
    preCheck: ['cat /etc/nginx/nginx.conf | head -n 5', 'nginx -t 2>&1'],
    change: ['systemctl reload nginx'],
    rollback: ['systemctl reload nginx'],
    postCheck: ['nginx -t 2>&1', 'curl -sI http://127.0.0.1/ | head -n 5'],
  }

  it('refused in READ_ONLY mode without touching the wire', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire, { permissionMode: 'READ_ONLY' })
    h.grants.arm('conversation-A', 'persistent')
    const value = await toolOf(h.defs, 'jumpserver_remediate').execute({ target: '203.0.113.101', plan: PLAN }, h.execFor('conversation-A'))
    expect(value.ok).toBe(false)
    expect(value.code).toBe('REMEDIATE_READ_ONLY')
    expect(wire.writes).toHaveLength(0)
  })

  it('AUTO: pre-check -> ONE plan approval -> apply -> post-check with evidence', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire, { permissionMode: 'AUTO' })
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue(replyWith('worker_processes 4;\n'))
    wire.queue(replyWith('syntax is ok\n'))
    wire.queue(replyWith('Reloading nginx: [ OK ]\n'))
    wire.queue(replyWith('syntax is ok\n'))
    wire.queue(replyWith('HTTP/1.1 200 OK\n'))
    h.grants.arm('conversation-A', 'persistent')
    const value = await toolOf(h.defs, 'jumpserver_remediate').execute({ target: '203.0.113.101', plan: PLAN }, h.execFor('conversation-A'))
    expect(value.ok).toBe(true)
    expect(h.approvalRequests).toHaveLength(1)
    expect(h.approvalRequests[0]).toContain('Remediation Plan — target 203.0.113.101')
    expect(h.approvalRequests[0]).toContain('systemctl reload nginx')
    expect((value.evidence as string[]).length).toBe(5)
    const caseNow = h.cases.current('conversation-A')
    expect(caseNow?.actions.length).toBe(1)
  })

  it('a failed change step stops and suggests the rollback', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire, { permissionMode: 'AUTO' })
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('203.0.113.101') ? ASSET_PROMPT : undefined))
    wire.queue((w: string) => probeReply(w))
    wire.queue(replyWith('ok\n'))
    wire.queue(replyWith('syntax is ok\n'))
    wire.queue(replyWith('Reloading nginx failed', 1)) // change step fails
    h.grants.arm('conversation-A', 'persistent')
    const value = await toolOf(h.defs, 'jumpserver_remediate').execute({ target: '203.0.113.101', plan: PLAN }, h.execFor('conversation-A'))
    expect(value.ok).toBe(false)
    expect(value.code).toBe('REMEDIATE_CHANGE_STEP_FAILED')
    expect(value.rollbackSuggested).toEqual(['systemctl reload nginx'])
  })

  it('rejects plans whose preCheck/postCheck are not read-only', async () => {
    const wire = new FakeWire()
    const h = makeOpsHarness(wire, { permissionMode: 'AUTO' })
    h.grants.arm('conversation-A', 'persistent')
    const bad = { preCheck: ['rm -rf /tmp/x'], change: ['echo hi'], rollback: [], postCheck: [] }
    const value = await toolOf(h.defs, 'jumpserver_remediate').execute({ target: '203.0.113.101', plan: bad }, h.execFor('conversation-A'))
    expect(value.ok).toBe(false)
    expect(value.code).toBe('INVALID_PLAN')
  })
})

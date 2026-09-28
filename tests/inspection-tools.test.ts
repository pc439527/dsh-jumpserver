/**
 * Fleet collection tools (jumpserver_inspect / topology / profile_run /
 * baseline_*). These pin that the ported modules are reachable through the DSH
 * tool surface, that every tool stays grant-gated, and that a baseline round
 * trip really reports drift.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../src/config/types.js'
import { SessionManager } from '../src/jumpserver/session-manager.js'
import { SessionRegistry } from '../src/jumpserver/session-registry.js'
import { SessionState } from '../src/jumpserver/state-machine.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { SessionGrant } from '../src/security/grant.js'
import { BaselineStore } from '../src/runtime/baseline-store.js'
import { registerCollectionTools } from '../src/tools/inspection.js'
import { ASSET_PROMPT, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

const TARGET = '203.0.113.101'

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

const MEM = '              total        used        free      shared  buff/cache   available\nMem:          15952        3100       10000          12        2000       12500\nSwap:         8192           0        8192\n'
const DF = 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   12G   36G  25% /\n'

/** Per-probe canned output keyed off the command actually written to the PTY. */
function bodyFor(written: string, listen: string): string {
  if (written.includes('/etc/os-release')) return 'NAME="CentOS Linux"\nVERSION="7 (Core)"\nID="centos"\n'
  if (written.includes('uname -r')) return '3.10.0-1160.el7.x86_64\n'
  if (written.includes('/proc/loadavg')) return '0.52 0.58 0.59 1/234 12345\n'
  if (written.includes('uptime')) return ' 10:00:00 up 3 days,  2 users,  load average: 0.52, 0.58, 0.59\n'
  if (written.includes('nproc')) return '8\n'
  if (written.includes('free -m')) return MEM
  if (written.includes('df -h')) return DF
  if (written.includes('ss -lntp')) return listen
  if (written.includes('ss -tnp')) return 'State Recv-Q Send-Q Local Address:Port Peer Address:Port\nESTAB 0 0 10.0.0.5:22 10.0.0.9:51000\n'
  if (written.includes('/etc/hosts')) return '127.0.0.1 localhost\n10.0.0.5 web-app-01\n'
  if (written.includes('ip -o addr')) return '1: lo    inet 127.0.0.1/8 scope host lo\n'
  if (written.includes('ip route')) return 'default via 10.0.0.1 dev eth0\n'
  if (written.includes('ip neigh')) return '10.0.0.1 dev eth0 lladdr aa:bb:cc:dd:ee:ff REACHABLE\n'
  if (written.includes('systemctl')) return 'nginx.service loaded active running nginx\n'
  if (written.includes('ps -eo')) return 'PID PPID USER %CPU %MEM ELAPSED COMMAND\n101 1 root 0.1 0.4 3-00:00:00 nginx: master process\n'
  if (written.includes('hostname')) return 'web-app-01\n'
  return 'ok\n'
}

interface Harness {
  defs: Array<{ name: string; execute: (a: Record<string, unknown>, e: unknown) => Promise<Record<string, unknown>> }>
  grants: SessionGrant
  execFor: (sessionId: string) => unknown
  dir: string
  cleanup: () => void
}

function makeHarness(wire: FakeWire, opts: { target?: string; listen?: string; dir?: string } = {}): Harness {
  const target = opts.target ?? TARGET
  const listen = opts.listen ?? 'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\nLISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=101,fd=6))\nLISTEN 0 128 [::]:22 [::]:* users:(("sshd",pid=90,fd=3))\n'
  const grants = new SessionGrant()
  const registry = new SessionRegistry({
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
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'dsh-js-baseline-'))
  const baselines = new BaselineStore(dir)
  const defs: Harness['defs'] = []
  const fakeCtx = {
    tools: { register: (def: Harness['defs'][number]) => { defs.push(def); return () => undefined } },
    get: () => undefined,
    logger: { debug() {}, warn() {}, info() {} },
  } as unknown as Context
  registerCollectionTools(fakeCtx, registry, () => baseConfig(), grants, baselines)

  // One catch-all reply per PTY write: navigation prompt, connector probe, or
  // the per-probe body matched on the command that was actually written.
  for (let i = 0; i < 80; i += 1) {
    wire.queue((w: string) => {
      if (w.startsWith(target)) return ASSET_PROMPT
      const probe = probeReply(w)
      if (probe !== undefined) return probe
      const m = /__DSH_JS_DONE_([0-9A-F]+)/.exec(w)
      if (m === null) return undefined
      return '\n' + bodyFor(w, listen) + '\n__DSH_JS_DONE_' + m[1] + ':0\n' + ASSET_PROMPT
    })
  }
  return {
    defs,
    grants,
    execFor: (sessionId: string) => ({ agent: { session: { header: { id: sessionId } } }, signal: new AbortController().signal, name: 'jumpserver_x', callId: 'c1' }),
    dir,
      cleanup: () => { if (opts.dir === undefined) rmSync(dir, { recursive: true, force: true }) },
  }
}

function toolOf(h: Harness, name: string) {
  const def = h.defs.find((d) => d.name === name)
  if (def === undefined) throw new Error('tool not registered: ' + name)
  return def
}

describe('fleet collection tools: registration + grant boundary', () => {
  it('registers the five collection tools and every one is grant-gated', async () => {
    const wire = new FakeWire()
    const h = makeHarness(wire)
    expect(h.defs.map((d) => d.name)).toEqual([
      'jumpserver_inspect',
      'jumpserver_topology',
      'jumpserver_profile_run',
      'jumpserver_baseline_capture',
      'jumpserver_baseline_compare',
    ])
    const args: Record<string, Record<string, unknown>> = {
      jumpserver_inspect: { targets: [TARGET] },
      jumpserver_topology: { targets: [TARGET] },
      jumpserver_profile_run: { name: 'nope', targets: [TARGET] },
      jumpserver_baseline_capture: { name: 'b', targets: [TARGET] },
      jumpserver_baseline_compare: { name: 'b' },
    }
    for (const def of h.defs) {
      const value = await def.execute(args[def.name] ?? {}, h.execFor('conversation-A'))
      expect(value.code).toBe('JUMPSERVER_NOT_ARMED')
    }
    h.cleanup()
  })
})

describe('jumpserver_inspect', () => {
  it('returns a structured host inventory and a readable summary', async () => {
    const wire = new FakeWire()
    const h = makeHarness(wire)
    setTimeout(() => wire.emit(KOKO_MENU), 10)
    h.grants.arm('conversation-A', 'persistent')
    const value = await toolOf(h, 'jumpserver_inspect').execute({ targets: [TARGET], profile: 'full' }, h.execFor('conversation-A'))
    expect(value.ok).toBe(true)
    const hosts = value.hosts as Array<Record<string, unknown>>
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.hostname).toBe('web-app-01')
    expect(hosts[0]!.reachable).toBe(true)
    expect(hosts[0]!.cores).toBe(8)
    const listening = hosts[0]!.listening as Array<{ port: number }>
    expect(listening.map((l) => l.port)).toEqual(expect.arrayContaining([80, 22]))
    expect(hosts[0]!.roles).toEqual(expect.arrayContaining(['nginx']))
    h.cleanup()
  })
})

describe('baseline drift', () => {
  it('captures a named baseline and reports a newly opened port as drift', async () => {
    // 1) capture: only :80 and :22 are listening.
    const shared = mkdtempSync(join(tmpdir(), 'dsh-js-baseline-shared-'))
    const wireA = new FakeWire()
    const a = makeHarness(wireA, { dir: shared })
    setTimeout(() => wireA.emit(KOKO_MENU), 10)
    a.grants.arm('conversation-A', 'persistent')
    const captured = await toolOf(a, 'jumpserver_baseline_capture').execute({ name: 'drift-test', targets: [TARGET] }, a.execFor('conversation-A'))
    expect(captured.ok).toBe(true)
    expect(captured.baseline).toBe('drift-test')

    // 2) compare against a host that now listens on :8080 as well.
    const wireB = new FakeWire()
    const b = makeHarness(wireB, {
      dir: shared,
      listen: 'State Recv-Q Send-Q Local Address:Port Peer Address:Port Process\nLISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=101,fd=6))\nLISTEN 0 128 [::]:22 [::]:* users:(("sshd",pid=90,fd=3))\nLISTEN 0 128 0.0.0.0:8080 0.0.0.0:* users:(("java",pid=555,fd=9))\n',
    })
    setTimeout(() => wireB.emit(KOKO_MENU), 10)
    b.grants.arm('conversation-A', 'persistent')
    const compared = await toolOf(b, 'jumpserver_baseline_compare').execute({ name: 'drift-test' }, b.execFor('conversation-A'))
    expect(compared.ok).toBe(true)
    expect(compared.changed).toBeGreaterThanOrEqual(1)
    void a
    void b
    const drift = compared.drift as Array<Record<string, unknown>>
    // diffNamed reports port-level changes as added/removed/changed.
    const added = drift.flatMap((h) => (h.changes as Array<{ field: string; after: string }>).filter((c) => c.field === 'added').map((c) => c.after))
    expect(added.some((a) => a.includes('8080'))).toBe(true)
    rmSync(shared, { recursive: true, force: true })
  })
})

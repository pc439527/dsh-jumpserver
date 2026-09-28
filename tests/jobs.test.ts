/**
 * Streaming-job lifecycle (ported from jumpserver-mcp v0.4.5 / v0.5.x).
 *
 * These pin the rules that make the job model safe:
 *  - exactly ONE Ctrl+C per interrupt (a running job owns the PTY, so the
 *    interrupt delegates to JobStore.stop instead of signalling twice);
 *  - stop() is idempotent / concurrent-safe;
 *  - reads are cursor reads, not "tail of the buffer";
 *  - jobs are conversation-scoped;
 *  - PTY ownership follows the session lifecycle (close/reconnect releases it).
 */
import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { JobStore } from '../src/runtime/job-store.js'
import { interruptSession } from '../src/runtime/interrupt.js'
import type { SessionBundle, SessionRegistry } from '../src/jumpserver/session-registry.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { ASSET_PROMPT, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

const TARGET = '203.0.113.101'
const SESSION = 'conv-jobs'

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
    enableAudit: false,
    ...overrides,
  }
}

/** Wire + manager + observer + JobStore with ONE running job (started through the store). */
async function harness(): Promise<{ wire: FakeWire; manager: SessionManager; observer: TerminalObserver; jobs: JobStore; jobId: string }> {
  const wire = new FakeWire()
  const observer = new TerminalObserver(2000)
  const manager = new SessionManager({
    getConfig: () => cfg(),
    resolvePassword: async () => 'secret',
    wireFactory: async () => wire,
    onLog: () => {},
    observer,
  } as SessionManagerOptions)
  setTimeout(() => wire.emit(KOKO_MENU), 10)
  // Catch-all replies: the target write gets the asset prompt, every probe
  // write (enter probe, interrupt re-verify) gets a probe answer, and the
  // streaming command itself gets nothing (a job never completes by marker).
  for (let i = 0; i < 40; i += 1) {
    wire.queue((w: string) => {
      // A real shell repaints its prompt after Ctrl+C — probeShellOnly waits
      // for that prompt before it re-probes, so the simulation must too.
      if (w === '\u0003') return '\n' + ASSET_PROMPT
      if (w.startsWith(TARGET)) return ASSET_PROMPT
      return probeReply(w)
    })
  }
  const bundle: SessionBundle = { manager, observer, lastUsedAt: Date.now() }
  const registry = { get: () => bundle } as unknown as SessionRegistry
  const jobs = new JobStore(registry)
  const job = await jobs.start({ sessionId: SESSION, target: TARGET, command: 'tail -f /var/log/app.log' })
  expect(job.target).toBe(TARGET)
  return { wire, manager, observer, jobs, jobId: job.id }
}

describe('streaming job lifecycle (V0.4.5)', () => {
  it('reads output through a cursor and stops with exactly one Ctrl+C', async () => {
    const { wire, manager, jobs, jobId } = await harness()
    // The seed job is RUNNING and owns the PTY.
    expect(manager.hasActiveJob()).toBe(true)
    expect(manager.activeJobId()).toBe(jobId)
    expect(jobs.list(SESSION)).toHaveLength(1)

    wire.emit('\nlog line 1\nlog line 2\n')
    jobs.pump()
    const first = jobs.read(jobId, { sessionId: SESSION })
    expect(first).not.toBeNull()
    expect(first!.output).toContain('log line 1')
    const cursor = first!.nextSeq

    // A second cursor read returns only what arrived after the first one.
    wire.emit('log line 3\n')
    jobs.pump()
    const second = jobs.read(jobId, { sessionId: SESSION, sinceSeq: cursor })
    expect(second!.output).toContain('log line 3')
    expect(second!.output).not.toContain('log line 1')

    const stopped = await jobs.stop(jobId, 'test', SESSION)
    expect(stopped.state).toBe('STOPPED')
    expect(wire.writes.filter((w) => w === '\u0003')).toHaveLength(1)
    expect(manager.hasActiveJob()).toBe(false)
    await manager.close()
  })

  it('stop() is idempotent: a concurrent second stop shares the first verdict', async () => {
    const { wire, manager, jobs, jobId } = await harness()
    const [a, b] = await Promise.all([
      jobs.stop(jobId, 'manual', SESSION),
      jobs.stop(jobId, 'maxDuration', SESSION),
    ])
    expect(a.state).toBe('STOPPED')
    expect(b.state).toBe('STOPPED')
    // The V0.4.4 race sent a second Ctrl+C and could stamp STOPPED over a LOST.
    expect(wire.writes.filter((w) => w === '\u0003')).toHaveLength(1)
    await manager.close()
  })

  it('interruptSession delegates to the job owner (one Ctrl+C, mode=job)', async () => {
    const { wire, manager, jobs, jobId } = await harness()
    const result = await interruptSession(jobs, manager, SESSION)
    expect(result.mode).toBe('job')
    expect(result.sent).toBe(true)
    expect(result.jobId).toBe(jobId)
    expect(result.jobsStopped).toBe(1)
    expect(wire.writes.filter((w) => w === '\u0003')).toHaveLength(1)
    await manager.close()
  })

  it('jobs are conversation-scoped: another conversation cannot read or stop them', async () => {
    const { wire, manager, jobs, jobId } = await harness()
    wire.emit('secret output\n')
    jobs.pump()
    expect(jobs.read(jobId, { sessionId: 'someone-else' })).toBeNull()
    expect(jobs.get(jobId, 'someone-else')).toBeNull()
    expect(jobs.list('someone-else')).toEqual([])
    await expect(jobs.stop(jobId, 'other', 'someone-else')).rejects.toThrow()
    await manager.close()
  })

  it('a job whose shell was closed is reported LOST, not RUNNING', async () => {
    const { manager, jobs, jobId } = await harness()
    await manager.close()
    expect(manager.hasActiveJob()).toBe(false)
    jobs.pump()
    expect(jobs.read(jobId, { sessionId: SESSION })!.state).toBe('LOST')
  })
})

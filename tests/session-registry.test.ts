import { describe, expect, it } from 'vitest'
import { SessionRegistry, type SessionBundle } from '../src/jumpserver/session-registry.js'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { SessionState } from '../src/jumpserver/state-machine.js'

function makeOptions(): SessionManagerOptions {
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
    onLog: () => {},
  }
}

/**
 * V0.2.3 P0 proof: one JumpServer bundle PER conversation. The registry must
 * mint distinct managers/observers per session id, keep them stable across
 * calls of the same id, and never let one conversation read another's
 * terminal stream.
 */
describe('SessionRegistry (one JumpServer per conversation)', () => {
  function makeRegistry(clock: { now: number }) {
    const created: Array<{ id: string; bundle: SessionBundle }> = []
    const registry = new SessionRegistry({
      now: () => clock.now,
      detachGraceMs: 10,
      create: (sessionId: string) => {
        const observer = new TerminalObserver()
        observer.recordState(SessionState.DISCONNECTED, null)
        const manager = new SessionManager(makeOptions())
        const bundle: SessionBundle = { manager, observer, lastUsedAt: clock.now }
        created.push({ id: sessionId, bundle })
        return bundle
      },
    })
    return { registry, created }
  }

  it('each conversation id gets its OWN manager + observer', () => {
    const { registry, created } = makeRegistry({ now: 1000 })
    const a = registry.getOrCreate('session-A')
    const b = registry.getOrCreate('session-B')
    expect(a).not.toBe(b)
    expect(a.manager).not.toBe(b.manager)
    expect(a.observer).not.toBe(b.observer)
    expect(created.map((c) => c.id)).toEqual(['session-A', 'session-B'])
  })

  it('same conversation id reuses the same bundle (no new SSH per call)', () => {
    const { registry, created } = makeRegistry({ now: 1000 })
    const first = registry.getOrCreate('session-A')
    const again = registry.getOrCreate('session-A')
    expect(first).toBe(again)
    expect(created).toHaveLength(1)
  })

  it('conversation A can never read conversation B terminal events', async () => {
    const { registry } = makeRegistry({ now: 1000 })
    const a = registry.getOrCreate('session-A')
    const b = registry.getOrCreate('session-B')

    a.observer.recordOutput('secret-from-A')
    b.observer.recordOutput('output-from-B')

    const aEvents = a.observer.snapshot().filter((e) => e.type === 'output').map((e) => (e as { data: string }).data)
    const bEvents = b.observer.snapshot().filter((e) => e.type === 'output').map((e) => (e as { data: string }).data)
    expect(aEvents).toEqual(['secret-from-A'])
    expect(bEvents).toEqual(['output-from-B'])
    expect(aEvents.join('')).not.toContain('output-from-B')
    expect(bEvents.join('')).not.toContain('secret-from-A')
  })

  it('detaches bundles that are fully disconnected and long-unused', () => {
    const clock = { now: 1000 }
    const { registry, created } = makeRegistry(clock)
    const a = registry.getOrCreate('session-A')
    const b = registry.getOrCreate('session-B')
    const disposed: string[] = []
    ;(a.manager as unknown as { dispose: () => void }).dispose = () => {
      disposed.push('session-A')
    }
    ;(b.manager as unknown as { dispose: () => void }).dispose = () => {
      disposed.push('session-B')
    }

    // A is used NOW (fresh stamp); B was created earlier and stays unused.
    clock.now = 1000 + 20 // past the detach grace for the untouched bundle
    registry.getOrCreate('session-A')
    registry.tickIdle()

    expect(registry.has('session-A')).toBe(true)
    expect(registry.has('session-B')).toBe(false)
    expect(disposed).toEqual(['session-B'])
  })

  it('applyScrollback re-budgets every conversation observer', () => {
    const { registry } = makeRegistry({ now: 1000 })
    const a = registry.getOrCreate('session-A')
    const b = registry.getOrCreate('session-B')
    registry.applyScrollback(1200)
    expect((a.observer as unknown as { scrollback: number }).scrollback).toBe(1200)
    expect((b.observer as unknown as { scrollback: number }).scrollback).toBe(1200)
  })

  it('a fresh bundle records a DISCONNECTED state event so the tab has a baseline', () => {
    const { registry } = makeRegistry({ now: 1000 })
    const a = registry.getOrCreate('session-A')
    const states = a.observer.snapshot().filter((e) => e.type === 'state')
    expect(states[0]).toMatchObject({ type: 'state', state: SessionState.DISCONNECTED })
  })
})

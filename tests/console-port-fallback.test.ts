import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { startConsoleServer, type ConsoleHandle } from '../src/runtime/console.js'

/**
 * A fixed loopback port is what keeps the sidebar URL stable, but one occupied
 * port must never take the console offline: the operator just hit exactly this
 * with another tool on the same number. EADDRINUSE falls back to an ephemeral
 * port instead of reporting the console unavailable.
 */
const services = () => ({
  grantedFor: () => true,
  statusFor: () => ({ state: 'JUMPSERVER_MENU' as const, gateway: '203.0.113.10:2222', target: null, hostname: null, user: null, connected: true, configured: true, permissionMode: 'AUTO' }),
  observerFor: () => null,
  snapshotFor: () => ({ lastSeq: 0, oldestSeq: 0, events: [] }),
  auditFor: () => [],
  assetGroupNames: () => [],
  assetList: async () => ({ assets: [], count: 0 }),
  manualExec: async () => ({ ok: true }),
  jobListFor: () => [],
  diagFor: () => {},
  consoleActiveFor: () => false,
  noteConsoleAlive: () => {},
  getConfig: () => ({ host: '203.0.113.10', username: 'ops' }),
  resolvePassword: async () => undefined,
  terminateFor: async () => undefined,
}) as never

const started: ConsoleHandle[] = []
const blockers: Server[] = []
afterEach(async () => {
  for (const handle of started.splice(0)) await handle.close()
  for (const blocker of blockers.splice(0)) await new Promise<void>((done) => blocker.close(() => done()))
})

/** Occupy a loopback port so the console cannot have it. */
async function occupy(port: number): Promise<number> {
  const server = createServer(() => undefined)
  blockers.push(server)
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => done())
  })
  const address = server.address()
  return typeof address === 'object' && address !== null ? address.port : port
}

describe('console port binding', () => {
  it('falls back to another loopback port when the preferred one is taken', async () => {
    const taken = await occupy(0)
    const handle = await startConsoleServer(services(), { port: taken })
    started.push(handle)

    expect(handle.port).not.toBe(taken)
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.usingFallbackPort).toBe(true)
    // Still usable: the URL points at the port actually bound.
    expect(handle.urlFor(undefined)).toBe('http://127.0.0.1:' + String(handle.port) + '/')
  })

  it('keeps the preferred port when it is free', async () => {
    const probe = await occupy(0)
    // Release it so the console can claim the same number.
    const blocker = blockers.pop()!;
    await new Promise<void>((done) => blocker.close(() => done()))

    const handle = await startConsoleServer(services(), { port: probe })
    started.push(handle)
    expect(handle.port).toBe(probe)
    expect(handle.usingFallbackPort).toBe(false)
  })
})

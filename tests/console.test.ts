/**
 * Embedded console (V0.4.0): the desktop-friendly way in.
 *
 * These pin the security model, because the console exposes a PTY mirror and
 * manual execution:
 *   1. loopback bind only;
 *   2. every request needs the per-process token (page URL or header);
 *   3. the API is the plugin's existing bridge surface — no extra route, no
 *      second policy.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { startConsoleServer, type ConsoleHandle } from '../src/runtime/console.js'
import type { BridgeServices } from '../src/bridge/bridge.js'
import type { JumpServerConfig } from '../src/config/types.js'
import type { TerminalObserver } from '../src/jumpserver/terminal-observer.js'

function cfg(): JumpServerConfig {
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
  }
}

function services(): BridgeServices {
  return {
    getConfig: cfg,
    resolvePassword: async () => undefined,
    grantedFor: () => true,
    terminateFor: async () => undefined,
    statusFor: () => ({ state: 'ASSET_SHELL' as never, gateway: 'g', target: 't', hostname: 'h', user: 'u', connected: true, configured: true, permissionMode: 'READ_ONLY', granted: true }),
    observerFor: () => ({ cursorSeq: 3, oldestSeq: 1, snapshotSince: () => [] }) as unknown as TerminalObserver,
    auditFor: () => [],
    assetGroupNames: () => [],
    assetList: async () => null,
    manualExec: async () => ({ ok: true }),
    jobsFor: async () => [],
    jobStopFor: async (_s, jobId) => ({ ok: true, jobId }),
    interruptFor: async () => ({ ok: true, mode: 'shell' }),
  }
}

const started: ConsoleHandle[] = []
afterEach(async () => {
  for (const handle of started.splice(0)) await handle.close()
})

async function start(): Promise<ConsoleHandle> {
  const handle = await startConsoleServer(services(), { port: 0 })
  started.push(handle)
  return handle
}

describe('V0.4.0 embedded console transport', () => {
  it('binds loopback and hands out a session-scoped token URL', async () => {
    const handle = await start()
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.token.length).toBeGreaterThanOrEqual(32)
    const base = handle.urlFor(undefined)
    expect(base.startsWith('http://127.0.0.1:' + String(handle.port) + '/?token=')).toBe(true)
    // A conversation-scoped URL carries the session so the page is not a
    // cross-conversation view.
    expect(handle.urlFor('conv-1')).toContain('&session=conv-1')
  })

  it('refuses the page and the API without the token', async () => {
    const handle = await start()
    const noToken = await fetch('http://127.0.0.1:' + String(handle.port) + '/')
    expect(noToken.status).toBe(403)
    expect((await noToken.json() as { code?: string }).code).toBe('CONSOLE_TOKEN_REQUIRED')

    const wrongToken = await fetch('http://127.0.0.1:' + String(handle.port) + '/?token=deadbeef')
    expect(wrongToken.status).toBe(403)

    const apiNoToken = await fetch('http://127.0.0.1:' + String(handle.port) + '/api/jumpserver.status', { method: 'POST', body: '{}' })
    expect(apiNoToken.status).toBe(403)
  })

  it('serves the page with the token and the conversation embedded', async () => {
    const handle = await start()
    const res = await fetch(handle.urlFor('conv-1'))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('JumpServer 控制台')
    expect(html).toContain(JSON.stringify(handle.token))
    expect(html).toContain(JSON.stringify('conv-1'))
    // Self-contained: no remote asset may be referenced.
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('exposes exactly the bridge routes behind the token', async () => {
    const handle = await start()
    const base = 'http://127.0.0.1:' + String(handle.port)
    const status = await fetch(base + '/api/jumpserver.status', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-console-token': handle.token },
      body: JSON.stringify({ sessionId: 'conv-1' }),
    })
    expect(status.status).toBe(200)
    expect((await status.json() as { ok?: boolean }).ok).toBe(true)

    const unknown = await fetch(base + '/api/jumpserver.nope', { method: 'POST', headers: { 'x-console-token': handle.token }, body: '{}' })
    expect(unknown.status).toBe(404)
  })

  it('releases the port on close', async () => {
    const handle = await start()
    const url = handle.urlFor('conv-1')
    await handle.close()
    started.length = 0
    await expect(fetch(url)).rejects.toThrow()
  })
})

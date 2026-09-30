/**
 * Embedded console (Desktop 0.2.x): the native Browser Tab way in.
 *
 * These pin the security model, because the console exposes a PTY mirror and
 * manual execution:
 *   1. loopback bind only, with Host/Origin/Sec-Fetch-Site checks;
 *   2. the bearer token never leaves Host memory / an HttpOnly cookie;
 *   3. the API is the plugin's existing bridge surface - no extra route, no
 *      second policy.
 */
import { connect } from 'node:net'
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

/** Minimal raw HTTP/1.1 request so tests can forge headers fetch() forbids. */
async function rawRequest(port: number, request: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(request))
    let received = ''
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { received += chunk })
    socket.on('end', () => resolve(received))
    socket.on('error', reject)
  })
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

describe('embedded console transport', () => {
  it('binds loopback and exposes a token-free, session-scoped URL', async () => {
    const handle = await start()
    expect(handle.port).toBeGreaterThan(0)
    expect(handle.token.length).toBeGreaterThanOrEqual(32)
    const base = handle.urlFor(undefined)
    expect(base).toBe('http://127.0.0.1:' + String(handle.port) + '/')
    // A tool hands this URL to a person, so it must already name the
    // conversation. The id rides in the fragment, which the Host never sees.
    expect(handle.urlFor('conv-1')).toBe(base + '#session=conv-1')
    expect(handle.urlFor('conv 1')).toContain('#session=conv%201')
    expect(handle.urlFor('')).toBe(base)
    expect(base).not.toContain('token')
    expect(base).not.toContain('session')
    // The conversation id must never reach the server's request path.
    expect(handle.urlFor('conv-1').split('#')[0]).toBe(base)
  })

  it('bootstraps an HttpOnly cookie and refuses API calls without it', async () => {
    const handle = await start()
    const page = await fetch(handle.urlFor(undefined))
    expect(page.status).toBe(200)
    const setCookie = page.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Strict')
    expect(setCookie).toContain('Path=/')
    expect(setCookie).not.toContain('session=')
    expect(setCookie).not.toContain('__Host-')

    const crossSite = await fetch(handle.urlFor(undefined), { headers: { origin: 'https://example.org' } })
    expect(crossSite.status).toBe(403)
    // fetch() refuses to override Host, so DNS rebinding is probed on a socket.
    expect(await rawRequest(handle.port, 'GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n'))
      .toContain('403')
    expect(await rawRequest(handle.port, 'GET / HTTP/1.1\r\nHost: 127.0.0.1:' + String(handle.port) + '\r\nConnection: close\r\n\r\n'))
      .toContain('200')

    const apiNoCookie = await fetch(handle.urlFor(undefined) + 'api/jumpserver.status', { method: 'POST', body: '{}' })
    expect(apiNoCookie.status).toBe(403)
    expect((await apiNoCookie.json() as { code?: string }).code).toBe('CONSOLE_COOKIE_REQUIRED')
  })

  it('serves a self-contained page without embedding token or conversation id', async () => {
    const handle = await start()
    const res = await fetch(handle.urlFor('conv-1'))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('JumpServer 控制台')
    expect(html).not.toContain(handle.token)
    expect(html).not.toContain('conv-1')
    expect(html).not.toContain('__TOKEN__')
    expect(html).not.toMatch(/https?:\/\//)
  })

  it('exposes exactly the bridge routes behind the cookie', async () => {
    const handle = await start()
    const base = 'http://127.0.0.1:' + String(handle.port)
    const page = await fetch(base + '/')
    const cookie = (page.headers.get('set-cookie') ?? '').split(';', 1)[0] ?? ''
    const status = await fetch(base + '/api/jumpserver.status', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ sessionId: 'conv-1' }),
    })
    expect(status.status).toBe(200)
    expect((await status.json() as { ok?: boolean }).ok).toBe(true)

    const unknown = await fetch(base + '/api/jumpserver.nope', { method: 'POST', headers: { cookie }, body: '{}' })
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

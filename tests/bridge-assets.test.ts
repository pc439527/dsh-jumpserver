import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerBridgeRoutes, runConnectionTest, draftPasswordSource, type BridgeServices } from '../src/bridge/bridge.js'
import type { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import type { JumpServerConfig } from '../src/config/types.js'

/**
 * V0.3.1 regressions:
 *  1. The asset-picker route must pass group NAMES through untouched. Commit
 *     f4f55b0 wrapped the bridge service's string[] with Object.keys again,
 *     turning ["OA","ESB","SAP"] into ["0","1","2"] in the sidebar.
 *  2. The draft connection test must resolve the password against a DRAFT
 *     passwordEnv (not silently the saved ref) and flag draft when only the
 *     credential fields were edited.
 */

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

interface FakeRes {
  status: number
  writableEnded: boolean
  destroyed: boolean
  writeHead(status: number, headers: unknown): void
  end(text: string): void
}

function drive(handler: (req: IncomingMessage, res: ServerResponse) => void, body: Record<string, unknown>): Promise<{ status: number; payload: Record<string, unknown> }> {
  const readable = Readable.from([JSON.stringify(body)]) as Readable & { method?: string }
  readable.method = 'POST' // requirePost checks this on the IncomingMessage
  const req = readable as unknown as IncomingMessage
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('route did not respond in time')), 5000)
    const res: FakeRes = {
      status: 0,
      writableEnded: false,
      destroyed: false,
      writeHead(status: number, _headers: unknown) {
        this.status = status
      },
      end(text: string) {
        try {
          clearTimeout(timer)
          resolve({ status: this.status, payload: JSON.parse(text) as Record<string, unknown> })
        } catch (error) {
          clearTimeout(timer)
          reject(error as Error)
        }
      },
    }
    handler(req, res as unknown as ServerResponse)
  })
}

describe('V0.3.1 #1 asset-picker group chips', () => {
  it('returns the group NAMES as-is, not Object.keys indices', async () => {
    const services = {
      getConfig: () => baseConfig(),
      resolvePassword: async () => undefined,
      statusFor: () => ({ state: 'JUMPSERVER_MENU', gateway: 'h:2222', target: null, hostname: null, user: null, connected: true, configured: true, permissionMode: 'READ_ONLY', granted: false }),
      grantedFor: () => true,
      observerFor: () => ({}) as unknown as TerminalObserver,
      auditFor: () => [],
      assetGroupNames: () => ['OA', 'ESB', 'SAP'],
      assetList: async () => ({ assets: [], count: 0, reportedTotal: 2, complete: true, health: 'ok', filter: null, group: null, groupMatched: 0 }),
      manualExec: async () => ({ ok: true }),
    } as unknown as BridgeServices

    let route: { handler: (req: IncomingMessage, res: ServerResponse) => void } | undefined
    const webServer = {
      register(r: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) {
        if (r.path === '/api/jumpserver.assets') route = r
        return () => undefined
      },
    }
    registerBridgeRoutes(webServer as never, services)
    expect(route).toBeDefined()
    if (route === undefined) return

    const { payload } = await drive(route.handler, { sessionId: 'conv-1' })
    expect(payload.groups).toEqual(['OA', 'ESB', 'SAP'])
    expect(payload.groups).not.toEqual(['0', '1', '2'])
  })

  it('forwards the requested group to the asset service', async () => {
    let capturedGroup: string | undefined = 'none'
    const services = {
      getConfig: () => baseConfig(),
      resolvePassword: async () => undefined,
      statusFor: () => ({ state: 'JUMPSERVER_MENU', gateway: 'h:2222', target: null, hostname: null, user: null, connected: true, configured: true, permissionMode: 'READ_ONLY', granted: false }),
      grantedFor: () => true,
      observerFor: () => ({}) as unknown as TerminalObserver,
      auditFor: () => [],
      assetGroupNames: () => ['OA', 'ESB'],
      assetList: async (_sessionId: string, opts: { group?: string }) => {
        capturedGroup = opts.group
        return { assets: [], count: 0, reportedTotal: 1, complete: true, health: 'ok', filter: null, group: opts.group ?? null, groupMatched: opts.group === 'OA' ? 1 : 0 }
      },
      manualExec: async () => ({ ok: true }),
    } as unknown as BridgeServices

    let route: { handler: (req: IncomingMessage, res: ServerResponse) => void } | undefined
    const webServer = {
      register(r: { path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) {
        if (r.path === '/api/jumpserver.assets') route = r
        return () => undefined
      },
    }
    registerBridgeRoutes(webServer as never, services)
    if (route === undefined) return
    const { payload } = await drive(route.handler, { sessionId: 'conv-1', group: 'OA' })
    expect(capturedGroup).toBe('OA')
    expect(payload.group).toBe('OA')
  })
})

describe('V0.3.1 #2 draft connection test passwordEnv', () => {
  it('draftPasswordSource prefers the draft env over the saved one', () => {
    const cfg = baseConfig()
    expect(draftPasswordSource({}, cfg)).toEqual({ env: 'JUMPSERVER_PASSWORD' })
    expect(draftPasswordSource({ passwordEnv: 'JS_PROD_PASSWORD' }, cfg)).toEqual({ env: 'JS_PROD_PASSWORD' })
    expect(draftPasswordSource({ passwordEnv: '  JS_STAGING  ' }, cfg)).toEqual({ env: 'JS_STAGING' })
    // a literal draft password wins over any env ref
    expect(draftPasswordSource({ password: 'x', passwordEnv: 'JS_PROD_PASSWORD' }, cfg)).toEqual({ env: null })
  })

  it('runConnectionTest resolves against the DRAFT passwordEnv and flags draft', async () => {
    let resolvedEnv: string | undefined = 'NOT_CALLED'
    const services = {
      getConfig: () => baseConfig(),
      resolvePassword: async (env?: string) => {
        resolvedEnv = env
        return 'draft-ref-secret'
      },
      statusFor: () => ({ state: 'DISCONNECTED', gateway: 'h:2222', target: null, hostname: null, user: null, connected: false, configured: true, permissionMode: 'READ_ONLY', granted: false }),
      grantedFor: () => false,
      observerFor: () => null,
      auditFor: () => [],
      assetGroupNames: () => [],
      assetList: async () => null,
      manualExec: async () => ({ ok: false }),
    } as unknown as BridgeServices

    // 127.0.0.1:1 is refused instantly, so connect() fails fast — the point of
    // the test is the password resolution that happens BEFORE the connect.
    const result = await runConnectionTest(services, {
      host: '127.0.0.1', port: 1, username: 'ops', passwordEnv: 'JS_PROD_PASSWORD',
    })
    expect(resolvedEnv).toBe('JS_PROD_PASSWORD')
    expect(result.draft).toBe(true)
    expect(result.ok).toBe(false) // refused — proves we got past password resolution

    // passwordEnv-only edit still counts as a draft (localhost:1 keeps it offline)
    const envOnly = await runConnectionTest(services, { host: '127.0.0.1', port: 1, username: 'ops', passwordEnv: 'JS_ANOTHER' })
    expect(envOnly.draft).toBe(true)
    expect(resolvedEnv).toBe('JS_ANOTHER')
  })
})
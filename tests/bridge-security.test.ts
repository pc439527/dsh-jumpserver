import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerBridgeRoutes, type BridgeServices } from '../src/bridge/bridge.js'
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
    permissionMode: 'AUTO',
    autoReconnect: true,
    enableAudit: true,
  }
}

function makeServices(granted: boolean, calls: { manual: number; assets: number; audit: number; observer: number }): BridgeServices {
  return {
    getConfig: cfg,
    resolvePassword: async () => undefined,
    grantedFor: () => granted,
    terminateFor: async () => undefined,
    statusFor: () => ({ state: 'ASSET_SHELL' as any, gateway: '203.0.113.10:2222', target: '203.0.113.20', hostname: 'demo', user: 'root', connected: true, configured: true, permissionMode: 'AUTO', granted }),
    observerFor: () => {
      calls.observer++
      return {
        cursorSeq: 1,
        oldestSeq: 1,
        snapshotSince: () => [],
      } as unknown as TerminalObserver
    },
    auditFor: () => { calls.audit++; return [] },
    assetGroupNames: () => [],
    assetList: async () => { calls.assets++; return { assets: [], count: 0, reportedTotal: 0, complete: true, health: 'ok', filter: null, group: null, groupMatched: 0 } },
    manualExec: async () => { calls.manual++; return { ok: true } },
  }
}

function routeOf(services: BridgeServices, path: string) {
  let handler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined
  registerBridgeRoutes({
    register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) {
      if (route.path === path) handler = route.handler
      return () => undefined
    },
  }, services)
  if (handler === undefined) throw new Error('route missing: ' + path)
  return handler
}

function drive(handler: (req: IncomingMessage, res: ServerResponse) => void, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const req = Readable.from([JSON.stringify(body)]) as Readable & { method?: string; headers?: Record<string, string> }
  req.method = 'POST'
  req.headers = headers
  return new Promise<{ status: number; payload: Record<string, unknown> }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no response')), 3000)
    const res = {
      writableEnded: false,
      destroyed: false,
      status: 0,
      writeHead(status: number) { this.status = status },
      end(text: string) {
        clearTimeout(timer)
        resolve({ status: this.status, payload: JSON.parse(text) as Record<string, unknown> })
      },
    }
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
  })
}

function counters() {
  return { manual: 0, assets: 0, audit: 0, observer: 0 }
}

describe('browser bridge security boundaries', () => {
  it('blocks manual execution after the conversation grant is revoked', async () => {
    const calls = counters()
    const { status, payload } = await drive(routeOf(makeServices(false, calls), '/api/jumpserver.manual'), { sessionId: 'conv-1', command: 'uptime' })
    expect(status).toBe(403)
    expect(payload.code).toBe('JUMPSERVER_NOT_ARMED')
    expect(calls.manual).toBe(0)
  })

  it('blocks asset discovery after the conversation grant is revoked', async () => {
    const calls = counters()
    const { status, payload } = await drive(routeOf(makeServices(false, calls), '/api/jumpserver.assets'), { sessionId: 'conv-1' })
    expect(status).toBe(403)
    expect(payload.code).toBe('JUMPSERVER_NOT_ARMED')
    expect(calls.assets).toBe(0)
  })

  it('blocks terminal snapshots after the conversation grant is revoked', async () => {
    const calls = counters()
    const { status, payload } = await drive(routeOf(makeServices(false, calls), '/api/jumpserver.snapshot'), { sessionId: 'conv-1', sinceSeq: 0 })
    expect(status).toBe(403)
    expect(payload.code).toBe('JUMPSERVER_NOT_ARMED')
    expect(calls.observer).toBe(0)
  })

  it('blocks audit reads after the conversation grant is revoked', async () => {
    const calls = counters()
    const { status, payload } = await drive(routeOf(makeServices(false, calls), '/api/jumpserver.audit'), { sessionId: 'conv-1' })
    expect(status).toBe(403)
    expect(payload.code).toBe('JUMPSERVER_NOT_ARMED')
    expect(calls.audit).toBe(0)
  })

  it('allows protected routes while the conversation is granted', async () => {
    const calls = counters()
    const services = makeServices(true, calls)
    expect((await drive(routeOf(services, '/api/jumpserver.manual'), { sessionId: 'conv-1', command: 'uptime' })).status).toBe(200)
    expect((await drive(routeOf(services, '/api/jumpserver.snapshot'), { sessionId: 'conv-1', sinceSeq: 1 })).status).toBe(200)
    expect((await drive(routeOf(services, '/api/jumpserver.audit'), { sessionId: 'conv-1' })).status).toBe(200)
    expect(calls.manual).toBe(1)
    expect(calls.audit).toBe(1)
    expect(calls.observer).toBeGreaterThan(0)
  })

  it('rejects cross-site browser requests before a sensitive route runs', async () => {
    const calls = counters()
    const { status, payload } = await drive(
      routeOf(makeServices(true, calls), '/api/jumpserver.manual'),
      { sessionId: 'conv-1', command: 'uptime' },
      { 'sec-fetch-site': 'cross-site' },
    )
    expect(status).toBe(403)
    expect(payload.code).toBe('CROSS_SITE_BLOCKED')
    expect(calls.manual).toBe(0)
  })
})

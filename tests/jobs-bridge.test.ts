/**
 * Sidebar job control routes (V0.4.5): the 任务 tab lists this conversation's
 * streaming jobs, stops one, and the 中断 button goes through the ONE interrupt
 * entry point. Every route is POST-only, same-site and grant-gated like the
 * rest of the bridge.
 */
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

function services(granted: boolean, calls: Record<string, number>): BridgeServices {
  return {
    getConfig: cfg,
    resolvePassword: async () => undefined,
    grantedFor: () => granted,
    terminateFor: async () => undefined,
    statusFor: () => ({ state: 'ASSET_SHELL' as never, gateway: 'g', target: 't', hostname: 'h', user: 'u', connected: true, configured: true, permissionMode: 'AUTO', granted }),
    observerFor: () => ({ cursorSeq: 1, oldestSeq: 1, snapshotSince: () => [] }) as unknown as TerminalObserver,
    auditFor: () => [],
    assetGroupNames: () => [],
    assetList: async () => null,
    manualExec: async () => ({ ok: true }),
    jobsFor: async () => { calls['jobs'] = (calls['jobs'] ?? 0) + 1; return [{ id: 'jsjob_a', state: 'RUNNING' }] },
    jobStopFor: async (_sessionId, jobId) => {
      calls['stop'] = (calls['stop'] ?? 0) + 1
      return jobId === 'jsjob_a' ? { ok: true, jobId, jobState: 'STOPPED' } : { ok: false, code: 'UNKNOWN_JOB', jobId }
    },
    interruptFor: async () => { calls['interrupt'] = (calls['interrupt'] ?? 0) + 1; return { ok: true, mode: 'job', jobId: 'jsjob_a' } },
  }
}

function routeOf(svc: BridgeServices, path: string) {
  let handler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined
  registerBridgeRoutes({
    register(route: { kind: 'exact'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void }) {
      if (route.path === path) handler = route.handler
      return () => undefined
    },
  }, svc)
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
      end(text: string) { clearTimeout(timer); resolve({ status: this.status, payload: JSON.parse(text) as Record<string, unknown> }) },
    }
    handler(req as unknown as IncomingMessage, res as unknown as ServerResponse)
  })
}

describe('sidebar job control routes', () => {
  it('refuses every job route while the conversation grant is revoked', async () => {
    const calls: Record<string, number> = {}
    const svc = services(false, calls)
    for (const [path, body] of [
      ['/api/jumpserver.jobs', { sessionId: 'conv-1' }],
      ['/api/jumpserver.jobStop', { sessionId: 'conv-1', jobId: 'jsjob_a' }],
      ['/api/jumpserver.interrupt', { sessionId: 'conv-1' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const { status, payload } = await drive(routeOf(svc, path), body)
      expect(status).toBe(403)
      expect(payload.code).toBe('JUMPSERVER_NOT_ARMED')
    }
    expect(calls).toEqual({})
  })

  it('lists the conversation jobs and stops one when granted', async () => {
    const calls: Record<string, number> = {}
    const svc = services(true, calls)
    const list = await drive(routeOf(svc, '/api/jumpserver.jobs'), { sessionId: 'conv-1' })
    expect(list.status).toBe(200)
    expect(list.payload.count).toBe(1)
    expect(calls['jobs']).toBe(1)

    const stopped = await drive(routeOf(svc, '/api/jumpserver.jobStop'), { sessionId: 'conv-1', jobId: 'jsjob_a' })
    expect(stopped.status).toBe(200)
    expect(stopped.payload.jobState).toBe('STOPPED')

    const unknown = await drive(routeOf(svc, '/api/jumpserver.jobStop'), { sessionId: 'conv-1', jobId: 'jsjob_missing' })
    expect(unknown.status).toBe(409)
    expect(unknown.payload.code).toBe('UNKNOWN_JOB')
  })

  it('rejects a job stop without a jobId and interrupts through the single entry point', async () => {
    const calls: Record<string, number> = {}
    const svc = services(true, calls)
    const bad = await drive(routeOf(svc, '/api/jumpserver.jobStop'), { sessionId: 'conv-1' })
    expect(bad.status).toBe(400)
    expect(calls['stop']).toBeUndefined()

    const interrupted = await drive(routeOf(svc, '/api/jumpserver.interrupt'), { sessionId: 'conv-1' })
    expect(interrupted.status).toBe(200)
    expect(interrupted.payload.mode).toBe('job')
    expect(calls['interrupt']).toBe(1)
  })

  it('rejects cross-site requests before a job route runs', async () => {
    const calls: Record<string, number> = {}
    const { status, payload } = await drive(
      routeOf(services(true, calls), '/api/jumpserver.interrupt'),
      { sessionId: 'conv-1' },
      { 'sec-fetch-site': 'cross-site' },
    )
    expect(status).toBe(403)
    expect(payload.code).toBe('CROSS_SITE_BLOCKED')
    expect(calls).toEqual({})
  })
})

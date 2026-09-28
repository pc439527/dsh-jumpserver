/**
 * Embedded ops console (desktop-friendly).
 *
 * The DSH sidebar tab needs the third-party dsh-better-sidebar plugin; this
 * console deliberately does NOT. It is a loopback-only HTTP server owned by the
 * Host process that serves one self-contained page plus the plugin's existing
 * bridge API, so a desktop user can watch and drive a conversation from a
 * browser without installing any client plugin.
 *
 * Safety model (all three must hold, no exceptions):
 *   1. the socket binds to 127.0.0.1 ONLY — never a routable interface;
 *   2. every request needs a per-process token (in the page URL and, for API
 *      calls, in the x-console-token header), compared in constant time;
 *   3. the API is the SAME bridge surface the sidebar uses, so the conversation
 *      grant, the state machine, the one-time manual confirmation challenge and
 *      the audit trail behave identically — the console adds a transport, not a
 *      second policy.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { BridgeServices } from '../bridge/bridge.js'
import { registerBridgeRoutes } from '../bridge/bridge.js'
import { consolePage } from './console-page.js'

export interface ConsoleHandle {
  /** Actually bound port (a configured 0 resolves to an ephemeral one). */
  port: number
  /** Per-process access token. */
  token: string
  /** Conversation-scoped URL to hand to a user or a model. */
  urlFor(sessionId: string | undefined): string
  close(): Promise<void>
}

export interface ConsoleOptions {
  /** 0 (default) binds an ephemeral loopback port. */
  port?: number
}

/** Constant-time token comparison that never throws on a length mismatch. */
function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (provided === undefined || provided.length === 0) return false
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  return Array.isArray(raw) ? raw[0] : raw
}

/**
 * Start the console. Resolves with the bound port, the token and a URL factory;
 * the caller owns the lifetime (close() on plugin teardown).
 */
export function startConsoleServer(services: BridgeServices, options: ConsoleOptions = {}): Promise<ConsoleHandle> {
  const token = randomBytes(24).toString('hex')
  const routes = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>()

  // The bridge registers its exact routes into this adapter, so the console can
  // never expose a route the sidebar would not.
  registerBridgeRoutes({
    register(route) {
      routes.set(route.path, route.handler)
      return () => routes.delete(route.path)
    },
  }, services)

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const provided = url.searchParams.get('token') ?? headerOf(req, 'x-console-token')
    if (!tokenMatches(token, provided ?? undefined)) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: false, code: 'CONSOLE_TOKEN_REQUIRED', message: 'a valid console token is required' }))
      return
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        // Self-contained page: no remote script, style or frame.
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      })
      res.end(consolePage(token, url.searchParams.get('session') ?? ''))
      return
    }
    const handler = routes.get(url.pathname)
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, code: 'NOT_FOUND' }))
      return
    }
    handler(req, res)
  })

  return new Promise<ConsoleHandle>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      resolve({
        port,
        token,
        urlFor: (sessionId) =>
          'http://127.0.0.1:' +
          String(port) +
          '/?token=' +
          token +
          (sessionId !== undefined && sessionId.length > 0 ? '&session=' + encodeURIComponent(sessionId) : ''),
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

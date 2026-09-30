/**
 * Embedded ops console for DSH Desktop.
 *
 * Security boundaries:
 *   1. bind to 127.0.0.1 only;
 *   2. keep the per-process bearer token in Host memory and an HttpOnly,
 *      SameSite=Strict cookie only (never URL, HTML, logs, discovery files, or
 *      tool results);
 *   3. reject cross-site and forged-Host requests;
 *   4. reuse the existing bridge routes and their conversation grant/policy.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { BridgeServices } from '../bridge/bridge.js'
import { registerBridgeRoutes } from '../bridge/bridge.js'
import { consolePage } from './console-page.js'

// __Host- requires Secure; HTTP loopback cookies must use a host-only name.
const CONSOLE_COOKIE = 'dsh_jumpserver_console'

/**
 * Stable Desktop sidebar port; the right-column URL must survive restarts.
 *
 * 8765 is the WorkBuddy console port on this workstation, so the plugin takes
 * its own port and both consoles can run side by side.
 */
export const DEFAULT_CONSOLE_PORT = 8766

export interface ConsoleHandle {
  port: number
  /** Host-internal diagnostic value. Never serialize or log this field. */
  token: string
  /** Stable public loopback address. Session selection belongs in a URL fragment. */
  urlFor(sessionId: string | undefined): string
  /** True when the preferred port was taken and the OS chose one. */
  usingFallbackPort: boolean
  close(): Promise<void>
}

export interface ConsoleOptions {
  /** Defaults to the stable DSH Desktop loopback port. Use 0 only in tests. */
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

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie
  if (typeof raw !== 'string') return undefined
  for (const entry of raw.split(';')) {
    const at = entry.indexOf('=')
    if (at <= 0) continue
    if (entry.slice(0, at).trim() === name) return entry.slice(at + 1).trim()
  }
  return undefined
}

function cookieHeader(token: string): string {
  return CONSOLE_COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Strict'
}

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
    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0
    const allowedOrigin = 'http://127.0.0.1:' + String(port)
    if (req.headers.host !== '127.0.0.1:' + String(port) ||
        (req.headers.origin !== undefined && req.headers.origin !== allowedOrigin) ||
        req.headers['sec-fetch-site'] === 'cross-site') {
      res.writeHead(403, { 'cache-control': 'no-store' })
      res.end()
      return
    }

    const pageRequest = req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')
    if (pageRequest) {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'set-cookie': cookieHeader(token),
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
      })
      res.end(consolePage())
      return
    }

    if (!tokenMatches(token, cookieValue(req, CONSOLE_COOKIE))) {
      res.writeHead(403, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: false, code: 'CONSOLE_COOKIE_REQUIRED', message: 'open the local console page before calling its API' }))
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

  /**
   * Bind the preferred port, falling back to an ephemeral one.
   *
   * A fixed port is what keeps the sidebar URL stable across restarts, but a
   * single occupied port must not take the whole console offline - another tool
   * on 8765/8766 would otherwise mean "JumpServer console unavailable" with no
   * way forward. EADDRINUSE falls back to a loopback port the OS picks.
   */
  const listenOnce = (port: number): Promise<void> =>
    new Promise<void>((done, fail) => {
      const onError = (error: NodeJS.ErrnoException): void => {
        server.removeListener('listening', onListening)
        fail(error)
      }
      const onListening = (): void => {
        server.removeListener('error', onError)
        done()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(port, '127.0.0.1')
    })

  return (async (): Promise<ConsoleHandle> => {
    const preferred = options.port ?? DEFAULT_CONSOLE_PORT
    try {
      await listenOnce(preferred)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error
      // Port 0 asks the OS for a free loopback port.
      await listenOnce(0)
    }
    return await new Promise<ConsoleHandle>((resolve, reject) => {
      const bound = server.address()
      const port = typeof bound === 'object' && bound !== null ? bound.port : 0
      const baseUrl = 'http://127.0.0.1:' + String(port) + '/'
      resolve({
        port,
        token,
        // A tool's consoleUrl is opened by a person, so it must already point
        // at THAT conversation. The id rides in the fragment, which never
        // reaches the Host, so nothing about it lands in access logs.
        urlFor: (sessionId) => {
          const id = (sessionId ?? '').trim()
          if (id.length === 0) return baseUrl
          return baseUrl + '#session=' + encodeURIComponent(id)
        },
        close: () => new Promise<void>((done) => server.close(() => done())),
        usingFallbackPort: port !== (options.port ?? DEFAULT_CONSOLE_PORT),
      })
    })
  })()
}

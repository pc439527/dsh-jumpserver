import { describe, expect, it } from 'vitest'
import { redactSecrets } from '@deepseek-ai/dsh-settings'
import { Config } from '../src/config/schema.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { ASSET_PROMPT, doneReply, FakeWire, KOKO_MENU, probeReply } from './helpers.js'

// 0.1.2-alpha.2 settings baseline: namespaces are lowercase hyphenated ids and
// the registration seam is the provider service method ctx.settings.installSection.
const NS = 'jumpserver' as const

const entry: JumpServerConfig = {
  enabled: true,
  autoOpenTerminal: true,
  terminalScrollback: 5000,
  host: '203.0.113.10',
  port: 2222,
  username: 'ops',
  passwordEnv: 'JUMPSERVER_PASSWORD',
  connectTimeout: 15,
  commandTimeout: 60,
  idleTimeout: 30,
  permissionMode: 'READ_ONLY',
  autoReconnect: true,
  enableAudit: false,
}

/** Minimal SettingsScope the fake settings provider hands out. */
function fakeScope(resolved: JumpServerConfig) {
  const watchers = new Set<() => void>()
  return {
    get: () => resolved,
    watch: (cb: () => void) => {
      watchers.add(cb)
      return () => {
        watchers.delete(cb)
      }
    },
    notify: () => {
      for (const cb of [...watchers]) cb()
    },
  }
}

interface InstallSectionHooks<T> {
  setSource(current: () => T): void
  onChange(): void
}

/** Duck-typed alpha.2 settings provider service (ctx.settings.installSection seam). */
function makeSettings(scope: ReturnType<typeof fakeScope> | undefined) {
  return {
    installSection<T>(
      _owner: unknown,
      _ns: string,
      _schema: unknown,
      fallback: T,
      hooks: InstallSectionHooks<T>,
    ): void {
      hooks.setSource(() => (scope !== undefined ? scope.get() : fallback) as T)
      hooks.onChange()
    },
  }
}

/** The settings seam this test exercises (avoids the real cordis augmentation). */
interface FakeSettingsCtx {
  settings: ReturnType<typeof makeSettings>
  logger: Record<string, () => undefined>
  effect(fn: () => unknown, label?: string): () => undefined
  inject(services: string[], cb: (sctx: unknown) => void): () => undefined
  get(name: string): unknown
  timer: { timeout: () => () => undefined; interval: () => () => undefined }
  tools: { register: () => () => undefined }
}

function makeCtx(settingsService: unknown) {
  const ctx: Record<string, unknown> = {
    fiber: { state: 'active' },
    settings: settingsService,
    logger: { debug: () => undefined, warn: () => undefined },
    effect(_fn: () => unknown, _label?: string) {
      return () => undefined
    },
    inject(_services: string[], _cb: (sctx: unknown) => void) {
      // alpha.2: no inject indirection — the provider service is on ctx.settings.
      return () => undefined
    },
    get(_name: string) {
      return undefined
    },
    timer: {
      timeout: () => () => undefined,
      interval: () => () => undefined,
    },
    tools: {
      register() {
        return () => undefined
      },
    },
  }
  return ctx as unknown as FakeSettingsCtx
}

describe('V0.2 settings resolution', () => {
  it('schema declares the V0.2 defaults (enabled/autoOpenTerminal/terminalScrollback)', () => {
    const json = Config.toJSON() as unknown as { refs: Record<string, { type: string; meta?: Record<string, unknown> }> }
    const refs = Object.values(json.refs)
    const boolDefault = (desc: string) =>
      refs.find((r) => r.type === 'boolean' && String(r.meta?.description).includes(desc))?.meta?.default
    const numDefault = (desc: string) =>
      refs.find((r) => r.type === 'number' && String(r.meta?.description).includes(desc))?.meta?.default
    expect(boolDefault('启用 JumpServer')).toBe(true)
    expect(boolDefault('自动打开')).toBe(true)
    expect(numDefault('scrollback')).toBe(5000)
    const secret = refs.find((r) => String(r.meta?.description).includes('JumpServer 密码'))
    expect(secret?.meta?.role).toBe('secret')
  })

  it('redactSecrets strips the password value and reports it as a write-only slot (wire contract)', () => {
    const out = redactSecrets(Config as unknown as Parameters<typeof redactSecrets>[0], { ...entry, password: 'sup3r-secret' })
    const redacted = out.value as Record<string, unknown>
    expect(redacted.password).toBeUndefined()
    expect(String(redacted.host)).toBe('203.0.113.10')
    expect(out.secrets).toContainEqual({ path: ['password'], set: true })
    // no password in any wire-facing layer
    expect(JSON.stringify(out)).not.toContain('sup3r-secret')
  })

  it('ctx.settings.installSection switches the source to the settings scope when the service exists', () => {
    const scope = fakeScope({ ...entry, host: '203.0.113.209' })
    const ctx = makeCtx(makeSettings(scope))
    let source: () => JumpServerConfig = () => entry
    ctx.settings.installSection(ctx, NS, Config, entry, {
      setSource: (next) => {
        source = next
      },
      onChange: () => undefined,
    })
    expect(source()).toEqual({ ...entry, host: '203.0.113.209' })
  })

  it('ctx.settings.installSection keeps the composition entry when the scope is absent', () => {
    const ctx = makeCtx(makeSettings(undefined))
    let source: () => JumpServerConfig = () => entry
    ctx.settings.installSection(ctx, NS, Config, entry, {
      setSource: (next) => {
        source = next
      },
      onChange: () => undefined,
    })
    expect(source()).toEqual(entry)
  })

  it('session manager reads the live source (settings layer) for observer + batch', async () => {
    const wire = new FakeWire()
    const cfg: JumpServerConfig = { ...entry, enabled: true }
    const observer = new TerminalObserver(5000)
    const options: SessionManagerOptions = {
      getConfig: () => cfg,
      resolvePassword: async () => 'secret',
      wireFactory: async () => wire,
      observer,
      onLog: () => undefined,
    }
    const manager = new SessionManager(options)
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue(ASSET_PROMPT)
    wire.queue(probeReply)
    wire.queue(doneReply)
    const result = await manager.runTargetBatch({
      target: '203.0.113.101',
      commands: [{ command: 'df -h', risk: 'READ' }],
    })
    expect(result.error).toBeNull()
    expect(result.commands[0]?.exitCode).toBe(0)
    const events = observer.snapshot()
    expect(events.some((e) => e.type === 'target')).toBe(true)
    await manager.close()
  })
})

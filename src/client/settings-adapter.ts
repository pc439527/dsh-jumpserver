/**
 * Client-side settings adapter.
 *
 * The browser half used to inject a `settingsScope` SERVICE. That service no
 * longer exists in current DSH builds — the runtime exposes
 * `bindSettingsScope(ctx, { namespace })` from @deepseek-ai/dsh-client-runtime,
 * which is not a resolvable specifier for a third-party bundle — and declaring
 * a service the host does not provide is FATAL: cordis keeps the plugin
 * `pending` and the whole web boot aborts ("1 entry did not activate").
 *
 * This adapter rebuilds the same small surface over the ONE stable seam a
 * browser plugin can always reach: `connection.api.settings`
 * (describe / mutate, both defined by @deepseek-ai/dsh-host-apiproxy). It needs
 * no new module specifier and no injected service beyond `slots`.
 */
import type { JumpServerSettingsScope } from './terminal-tab.js'

/** The subset of `connection.api` this adapter uses. */
export interface SettingsApiFace {
  settings: {
    describe(request: Record<string, never>): Promise<{ result?: { writable?: boolean; namespaces?: Array<Record<string, unknown>> } }>
    mutate(request: { ns: string; ops: Array<Record<string, unknown>>; expectedRevision?: number }): Promise<{ result?: Record<string, unknown> }>
  }
}

type Snapshot = ReturnType<JumpServerSettingsScope['getSnapshot']>

/**
 * A local SettingsScope over one namespace.
 *
 * Reads never block plugin activation: the first `describe` runs in the
 * background and the snapshot starts as `loading`, exactly like the runtime's
 * own scope. Writes carry the revision of the last accepted read so a stale
 * form is refused by the host instead of silently overwriting a change.
 */
export class NamespaceSettingsScope implements JumpServerSettingsScope {
  private snapshot: Snapshot = { status: 'loading', writable: false }
  private readonly listeners = new Set<() => void>()
  private inflight: Promise<unknown> | null = null

  constructor(private readonly api: SettingsApiFace, private readonly ns: string) {}

  getSnapshot(): Snapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    this.refresh()
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Re-read the namespace view (single-flight: concurrent renders share one call).
   *
   * Shape tolerance on purpose. The wire carries an RpcResponse whose payload
   * has been wrapped differently across DSH builds (`result.namespaces` in the
   * current contract, `result.value.namespaces` / `result.ok+value` in older
   * ones), and the request envelope is either the bare payload or `{ payload }`.
   * Guessing wrong used to surface as a bare 异常 in the settings card, so both
   * are accepted, and a namespace that has not been registered YET (the Host
   * installs its settings section during its own activation) gets one retry
   * before the card is told the namespace is unavailable.
   */
  refresh(): void {
    if (this.inflight !== null) return
    this.inflight = this.describeView()
      .then(async (found) => {
        if (found === null) await this.retryOnce()
      })
      .finally(() => {
        this.inflight = null
      })
  }

  private async retryOnce(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 800))
    const again = await this.describeView().catch(() => null)
    if (again === null) this.publish({ status: 'unavailable', writable: false })
  }

  /** Read the namespace view, tolerating both request envelopes and both payload shapes. */
  private async describeView(): Promise<true | null> {
    const attempts: Array<Record<string, unknown>> = [{}, { payload: {} }]
    let lastError: unknown
    for (const request of attempts) {
      try {
        const response = (await this.api.settings.describe(request as never)) as Record<string, unknown>
        const envelope = (response?.['result'] ?? response) as Record<string, unknown>
        const payload = (envelope?.['value'] ?? envelope) as Record<string, unknown>
        const namespaces = (payload?.['namespaces'] ?? envelope?.['namespaces'] ?? []) as Array<Record<string, unknown>>
        const view = namespaces.find((entry) => entry['ns'] === this.ns)
        if (view === undefined) return null
        this.publish({
          status: 'ready',
          writable: envelope['writable'] === true || payload['writable'] === true,
          value: (view['value'] ?? {}) as Record<string, unknown>,
          base: (view['base'] ?? {}) as Record<string, unknown>,
          user: (view['user'] ?? {}) as Record<string, unknown>,
          revision: typeof view['revision'] === 'number' ? (view['revision'] as number) : undefined,
        })
        return true
      } catch (error) {
        lastError = error
      }
    }
    if (lastError !== undefined) throw lastError
    return null
  }

  async set(field: string, value: unknown): Promise<boolean> {
    return this.apply({ op: 'set', path: [field], value })
  }

  async unset(field: string): Promise<boolean> {
    return this.apply({ op: 'unset', path: [field] })
  }

  private async apply(op: Record<string, unknown>): Promise<boolean> {
    try {
      const request: { ns: string; ops: Array<Record<string, unknown>>; expectedRevision?: number } = { ns: this.ns, ops: [op] }
      if (typeof this.snapshot.revision === 'number') request.expectedRevision = this.snapshot.revision
      let response: Record<string, unknown> | undefined
      try {
        response = (await this.api.settings.mutate(request as never)) as Record<string, unknown>
      } catch (first) {
        // Older/alternative envelope: { payload: <request> }.
        response = (await this.api.settings.mutate({ payload: request } as never)) as Record<string, unknown>
      }
      const envelope = (response?.['result'] ?? response) as Record<string, unknown>
      const view = ((envelope?.['value'] ?? envelope) as Record<string, unknown>)
      if (view !== undefined && view !== null && view['ns'] === this.ns) {
        this.publish({
          status: 'ready',
          writable: true,
          value: (view['value'] ?? {}) as Record<string, unknown>,
          base: (view['base'] ?? {}) as Record<string, unknown>,
          user: (view['user'] ?? {}) as Record<string, unknown>,
          revision: typeof view['revision'] === 'number' ? (view['revision'] as number) : undefined,
        })
      } else {
        this.refresh()
      }
      return true
    } catch {
      // The host refused (schema/revision). Re-read so the form shows the truth
      // rather than the value the user typed.
      this.refresh()
      return false
    }
  }

  private publish(next: Snapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

/**
 * Settings scope backed by the plugin's OWN bridge route.
 *
 * Used when `connection.api.settings` is not reachable (the activation trace
 * reports settingsApi:false on the desktop build). The Host merges the file it
 * writes here into the effective configuration, so this is a real settings
 * backend — not a read-only stub — and it needs no host service at all.
 */
export class BridgeSettingsScope implements JumpServerSettingsScope {
  private snapshot: Snapshot = { status: 'loading', writable: true }
  private readonly listeners = new Set<() => void>()
  private inflight = false

  async refresh(): Promise<void> {
    if (this.inflight) return
    this.inflight = true
    try {
      const response = await fetch('/api/jumpserver.config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const body = (await response.json()) as { ok?: boolean; value?: Record<string, unknown>; user?: Record<string, unknown>; code?: string }
      if (body.ok !== true || body.value === undefined) {
        this.publish({ status: 'unavailable', writable: false })
        return
      }
      this.publish({ status: 'ready', writable: true, value: body.value, user: body.user ?? {}, revision: Date.now() })
    } catch {
      this.publish({ status: 'unavailable', writable: false })
    } finally {
      this.inflight = false
    }
  }

  getSnapshot(): Snapshot {
    return this.snapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    void this.refresh()
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(field: string, value: unknown): Promise<boolean> {
    return this.patch({ [field]: value })
  }

  unset(field: string): Promise<boolean> {
    return this.patch({ [field]: null })
  }

  /** Store one credential value through the Host credential seam. */
  async setCredential(ref: string, value: string): Promise<boolean> {
    try {
      const response = await fetch('/api/jumpserver.config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ credential: { ref, value } }),
      })
      const body = (await response.json()) as { ok?: boolean; credentialConfigured?: boolean }
      return body.ok === true
    } catch {
      return false
    }
  }

  private async patch(patch: Record<string, unknown>): Promise<boolean> {
    try {
      const response = await fetch('/api/jumpserver.config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patch }),
      })
      const body = (await response.json()) as { ok?: boolean; value?: Record<string, unknown>; user?: Record<string, unknown> }
      if (body.ok !== true) {
        await this.refresh()
        return false
      }
      this.publish({ status: 'ready', writable: true, value: body.value ?? {}, user: body.user ?? {}, revision: Date.now() })
      return true
    } catch {
      await this.refresh()
      return false
    }
  }

  private publish(next: Snapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }
}

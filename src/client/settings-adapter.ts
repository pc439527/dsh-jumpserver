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

  /** Re-read the namespace view (single-flight: concurrent renders share one call). */
  refresh(): void {
    if (this.inflight !== null) return
    this.inflight = this.api.settings
      .describe({})
      .then((response) => {
        const view = (response?.result?.namespaces ?? []).find((entry) => entry['ns'] === this.ns)
        if (view === undefined) {
          this.publish({ status: 'unavailable', writable: false })
          return
        }
        this.publish({
          status: 'ready',
          writable: response?.result?.writable === true,
          value: (view['value'] ?? {}) as Record<string, unknown>,
          base: (view['base'] ?? {}) as Record<string, unknown>,
          user: (view['user'] ?? {}) as Record<string, unknown>,
          revision: typeof view['revision'] === 'number' ? (view['revision'] as number) : undefined,
        })
      })
      .catch(() => {
        this.publish({ status: 'unavailable', writable: false })
      })
      .finally(() => {
        this.inflight = null
      })
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
      const response = await this.api.settings.mutate(request)
      const view = response?.result
      if (view !== undefined && view['ns'] === this.ns) {
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

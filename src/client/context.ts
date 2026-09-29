/** Structural faces used by the DSH Desktop 0.2.x client entry. */
export interface NativeConfigSnapshot {
  status: string
  writable: boolean
  value?: Record<string, unknown>
  base?: Record<string, unknown>
  user?: Record<string, unknown>
  revision?: number
}

export interface NativeConfigForm {
  getSnapshot(): NativeConfigSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
  unset(field: string): Promise<unknown>
}

export interface BrowserCtx {
  effect(fn: () => unknown | (() => void) | Promise<unknown>, label?: string): unknown
  slots: {
    inject(name: string, cb: () => unknown): () => void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  locale: {
    bind(ns: string): (key: string) => string
    register(ns: string, dicts: Record<string, Record<string, string>>): unknown
  }
  configForms: {
    get(entryId: string): NativeConfigForm
    whileServed(namespaces: string[], register: (served: Set<string>) => () => void): () => void
  }
  remote: {
    credentials: {
      describe(refs: string[]): Promise<{ ok: boolean; value?: Record<string, { configured?: boolean; writable?: boolean }> }>
      set(ref: string, value: string): Promise<unknown>
    }
  }
  sidebarRightTabs: { get(kind: string): unknown }
  sidebarRight: { openTab(kind: string, options: { params: { url: string } }): void }
  uiSession: {
    adapter: {
      current: {
        getSnapshot(): { key?: string }
        subscribe(listener: () => void): () => void
      }
    }
  }
}

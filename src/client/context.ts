/**
 * Structural context face for the dsh-jumpserver browser half.
 *
 * The DSH client runtime builds the real cordis context; this file only
 * restates the services this plugin touches. `betterSidebar` is the
 * dsh-better-sidebar service (consumed type-ONLY from the real package —
 * the bundle never imports dsh-better-sidebar at runtime, it collaborates
 * through this injected service, exactly like the built-in tabs do). It is
 * optional because that plugin is a separate install (see impl.ts).
 */
import type { BetterSidebarService } from 'dsh-better-sidebar/src/client/service'

export type { BetterSidebarService } from 'dsh-better-sidebar/src/client/service'

export interface BrowserCtx {
  effect(fn: () => unknown | (() => void) | Promise<unknown>, label?: string): unknown
  get(name: string): unknown
  /** The ONE injected service: the client runtime's slot registry. */
  slots: {
    inject(name: string, cb: () => unknown): unknown
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  locale: {
    bind(ns: string): (key: string) => string
    register(ns: string, dicts: Record<string, Record<string, string>>): unknown
  }
  settingsScope: {
    bind(spec: { namespace: string }): {
      getSnapshot(): { status: string; writable: boolean; value?: Record<string, unknown>; base?: Record<string, unknown>; user?: Record<string, unknown>; revision?: number }
      subscribe(listener: () => void): () => void
      set(field: string, value: unknown): Promise<boolean>
      unset(field: string): Promise<boolean>
    }
  }
  /**
   * dsh-better-sidebar registry service (V0.2.1: the terminal is a sidebar tab).
   * OPTIONAL since V0.4.0: a DSH install without that plugin (e.g. desktop)
   * still gets the settings card and the loopback console, so a missing sidebar
   * degrades this plugin instead of disabling it.
   */
  betterSidebar?: BetterSidebarService
}

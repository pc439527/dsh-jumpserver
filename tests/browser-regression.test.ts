import { describe, expect, it } from 'vitest'
import { startConsoleServer } from '../src/runtime/console.js'
import { consolePage } from '../src/runtime/console-page.js'
import type { BridgeServices } from '../src/bridge/bridge.js'

/**
 * Desktop 0.2.x browser regressions: the console opens through the native
 * sidebarRight Browser Tab, so the page must stay self-contained and must never
 * embed a credential or a conversation id.
 */
function services(): BridgeServices {
  return {
    getConfig: () => ({}) as never,
    resolvePassword: async () => undefined,
    grantedFor: () => true,
    terminateFor: async () => undefined,
    statusFor: () => ({}) as never,
    observerFor: () => ({ cursorSeq: 0, oldestSeq: 0, snapshotSince: () => [] }) as never,
    auditFor: () => [],
    assetGroupNames: () => [],
    assetList: async () => null,
    manualExec: async () => ({ ok: true }),
    jobsFor: async () => [],
    jobStopFor: async () => (_s: string, jobId: string) => ({ ok: true, jobId }),
    interruptFor: async () => ({ ok: true, mode: 'shell' }),
  } as unknown as BridgeServices
}

describe('minimal browser interaction regressions', () => {
  it('exposes exactly the four implemented console tabs', () => {
    const html = consolePage()
    for (const tab of ['\u7ec8\u7aef', '\u8d44\u4ea7', '\u4efb\u52a1', '\u5ba1\u8ba1']) {
      expect(html).toContain('>' + tab + '<')
    }
    // WorkBuddy-only tabs stay undeclared and unrendered.
    for (const absent of ['\u62d3\u6251', '\u7edf\u8ba1', '\u4f1a\u8bdd']) expect(html).not.toContain('>' + absent + '<')
  })

  it('serves a self-contained page with no remote origin and no embedded token', async () => {
    const handle = await startConsoleServer(services(), { port: 0 })
    try {
      const res = await fetch(handle.urlFor(undefined))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-security-policy')).toContain("default-src 'none'")
      const html = await res.text()
      expect(html).not.toContain(handle.token)
      expect(html).not.toMatch(/https?:\/\//)
    } finally {
      await handle.close()
    }
  })
})

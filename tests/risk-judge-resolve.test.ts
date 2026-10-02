import { describe, expect, it } from 'vitest'
import { judgeCommandRiskDetailed } from '../src/security/risk-judge.js'
import type { RiskJudgeConfig } from '../src/config/types.js'

/**
 * The settings card writes the Jev API key into the DSH credential domain under
 * the `apiKeyEnv` NAME, not into process.env. The judge used to read
 * process.env only, so a key the user actually saved was invisible and the
 * judge stayed silent forever — indistinguishable from "not configured".
 *
 * These pin both halves: the stored credential is found, and every failure mode
 * reports WHY instead of returning a bare null.
 */
function cfg(over: Partial<RiskJudgeConfig> = {}): RiskJudgeConfig {
  return {
    enabled: true,
    endpoint: 'https://judge.invalid/v1/systemone',
    apiKeyEnv: 'JEV_TEST_KEY_REF',
    model: 'jev-latest',
    timeoutMs: 500,
    cacheTtlSeconds: 60,
    redactNetwork: true,
    ...over,
  } as RiskJudgeConfig
}

describe('risk judge credential resolution', () => {
  it('reports no-credential when neither seam has the key', async () => {
    const original = process.env['JEV_TEST_KEY_REF']
    delete process.env['JEV_TEST_KEY_REF']
    const out = await judgeCommandRiskDetailed('some-unknown-binary', cfg(), async () => undefined)
    expect(out.verdict).toBeNull()
    expect(out.error).toBe('no-credential')
    if (original !== undefined) process.env['JEV_TEST_KEY_REF'] = original
  })

  it('reaches the endpoint once the DSH credential seam resolves the key', async () => {
    const original = process.env['JEV_TEST_KEY_REF']
    delete process.env['JEV_TEST_KEY_REF']
    let sawAuth: string | null = null
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string, init: { headers?: Record<string, string> }) => {
      sawAuth = String(init.headers?.['Authorization'] ?? '')
      return { ok: true, json: async () => ({}) }
    }) as never
    try {
      const out = await judgeCommandRiskDetailed(
        'some-unknown-binary',
        cfg(),
        async (ref) => (ref === 'JEV_TEST_KEY_REF' ? 'test-key-not-a-secret' : undefined),
      )
      expect(sawAuth).toBe('Bearer test-key-not-a-secret')
      // The stub payload is not a verdict, so this surfaces the parse failure
      // rather than pretending the judge answered.
      expect(out.verdict).toBeNull()
      expect(out.error).toBe('bad-payload')
    } finally {
      globalThis.fetch = originalFetch
      if (original !== undefined) process.env['JEV_TEST_KEY_REF'] = original
    }
  })

  it('reports timeout and http errors distinctly', async () => {
    const original = process.env['JEV_TEST_KEY_REF']
    process.env['JEV_TEST_KEY_REF'] = 'test-env-key-not-a-secret'
    const originalFetch = globalThis.fetch
    try {
      globalThis.fetch = (async () => { throw Object.assign(new Error('slow'), { name: 'TimeoutError' }) }) as never
      expect((await judgeCommandRiskDetailed('unknown-bin-timeout', cfg())).error).toBe('timeout')

      globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as never
      expect((await judgeCommandRiskDetailed('unknown-bin-http', cfg())).error).toBe('http-error')
    } finally {
      globalThis.fetch = originalFetch
      if (original === undefined) delete process.env['JEV_TEST_KEY_REF']
      else process.env['JEV_TEST_KEY_REF'] = original
    }
  })

  it('reports disabled without touching the network', async () => {
    const out = await judgeCommandRiskDetailed('unknown-bin', cfg({ enabled: false }))
    expect(out.verdict).toBeNull()
    expect(out.error).toBe('disabled')
  })
})

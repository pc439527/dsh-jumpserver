import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetRiskJudgeCache, judgeCommandRiskDetailed } from '../src/security/risk-judge.js'

/**
 * A verdict belongs to the (command, model, endpoint) triple.
 *
 * The key used to be the command alone, so changing the model or the endpoint
 * kept serving the PREVIOUS judge's answer for the whole TTL - the operator
 * switched judges and silently got the old one's opinion back.
 */
// The real response shape: answers keyed by question id.
const PAYLOAD = JSON.stringify({
  answers: {
    read_only: { noul: 0.95, confidence: 0.9 },
    risk_level: { score: 0, confidence: 0.9 },
    impact: { choice: 'none', confidence: 0.9 },
    needs_privilege: { noul: 0.0, confidence: 0.9 },
  },
})

function cfg(over?: Record<string, unknown>) {
  return Object.assign({
    enabled: true,
    endpoint: 'https://api.typesafe.ai/v1/systemone',
    apiKeyEnv: 'TYPESAFE_API_KEY',
    apiKeyFile: '',
    model: 'jev-latest',
    timeoutMs: 1500,
    cacheTtlSeconds: 3600,
    redactNetwork: true,
    autoAllow: { enabled: false, minReadOnly: 0.9, minConfidence: 0.7, maxRiskScore: 1, minSafeProbability: 0.85 },
  }, over || {}) as never
}

const resolve = async () => 'key'

afterEach(() => { resetRiskJudgeCache(); vi.unstubAllGlobals() })

describe('risk judge verdict cache scope', () => {
  it('reuses a verdict for the same command, model and endpoint', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(PAYLOAD, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await judgeCommandRiskDetailed('df -h', cfg(), resolve)
    const second = await judgeCommandRiskDetailed('df -h', cfg(), resolve)
    expect(second.verdict?.cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT reuse a verdict after the model changes', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(PAYLOAD, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await judgeCommandRiskDetailed('df -h', cfg(), resolve)
    const second = await judgeCommandRiskDetailed('df -h', cfg({ model: 'jev-experimental' }), resolve)
    expect(second.verdict?.cached).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does NOT reuse a verdict after the endpoint changes', async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => new Response(PAYLOAD, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await judgeCommandRiskDetailed('df -h', cfg(), resolve)
    const second = await judgeCommandRiskDetailed('df -h', cfg({ endpoint: 'https://example.test/v1/judge' }), resolve)
    expect(second.verdict?.cached).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

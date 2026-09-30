import { describe, expect, it } from 'vitest'
import { auditFailed, auditRefusalLabel, auditRefused } from '../src/runtime/audit-view.js'

/**
 * Desktop 0.2.x: the console renders in the loopback page, so these semantics
 * are pinned as pure helpers instead of through a removed sidebar component.
 */
describe('V0.5.9 refusal rendering', () => {
  it('treats BLOCKED / DENIED as refusals, not as failures', () => {
    const blocked = { result: 'BLOCKED', refusalReason: 'rule dangerous.rm refused' }
    const denied = { result: 'DENIED', refusalReason: 'not approved' }
    expect(auditRefused(blocked)).toBe(true)
    expect(auditRefused(denied)).toBe(true)
    // A refusal is the policy working - it must never render as a red failure.
    expect(auditFailed(blocked)).toBe(false)
    expect(auditFailed(denied)).toBe(false)
  })

  it('still reports a genuine command failure as a failure', () => {
    expect(auditFailed({ result: 'error', exitCode: 1 })).toBe(true)
    expect(auditFailed({ result: 'EXIT_NONZERO', exitCode: 127 })).toBe(true)
    expect(auditRefused({ result: 'ok', exitCode: 0 })).toBe(false)
  })

  it('labels the refusal with its reason and distinguishes denied from blocked', () => {
    const guize = '\u89c4\u5219'
    const reason = '\u672a\u83b7\u4eba\u5de5\u6279\u51c6'
    expect(auditRefusalLabel({ result: 'BLOCKED', refusalReason: guize + ' X' }))
      .toBe('\u5df2\u62e6\u622a\uff1a' + guize + ' X')
    expect(auditRefusalLabel({ result: 'DENIED', refusalReason: reason }))
      .toBe('\u672a\u6279\u51c6\uff1a' + reason)
    expect(auditRefusalLabel({ result: 'BLOCKED' })).toBe('\u5df2\u62e6\u622a')
  })
})

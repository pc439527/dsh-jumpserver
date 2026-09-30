import { describe, expect, it } from 'vitest'
import { serializeAudit } from '../src/runtime/audit-export.js'
import { formatAuditTime } from '../src/runtime/audit-view.js'

describe('audit UI helpers', () => {
  it('renders audit timestamps in the CONFIGURED zone, not a hardcoded one', () => {
    // This used to always be Asia/Shanghai, so every surface showed UTC+8 no
    // matter what the operator set.
    expect(formatAuditTime('2026-09-04T02:08:42.000Z', 'Asia/Shanghai')).toBe('10:08:42')
    expect(formatAuditTime('2026-09-04T02:08:42.000Z', 'UTC')).toBe('02:08:42')
    expect(formatAuditTime('2026-09-04T02:08:42.000Z', 'America/New_York')).toBe('22:08:42')
  })

  it('still shows the record when the zone is unusable', () => {
    expect(formatAuditTime('2026-09-04T02:08:42.000Z', 'Not/AZone')).toBe('02:08:42')
  })

  it('exports only the redacted command field when available', () => {
    const records = [{
      timestamp: '2026-09-04T02:08:42.000Z',
      actor: 'AGENT',
      operation: 'run',
      risk: 'READ',
      target: '203.0.113.10',
      command: 'mysql -psecret -e "SELECT 1"',
      redactedCommand: 'mysql -p****** -e "SELECT 1"',
      result: 'COMPLETED',
      exitCode: 0,
    }]
    const csv = serializeAudit(records, 'csv')
    const json = serializeAudit(records, 'json')
    expect(csv).toContain('mysql -p******')
    expect(csv).not.toContain('mysql -psecret')
    expect(json).toContain('mysql -p******')
    expect(json).not.toContain('mysql -psecret')
  })

  it('escapes CSV cells safely', () => {
    const csv = serializeAudit([{ redactedCommand: 'echo "a,b"', risk: 'READ' }], 'csv')
    expect(csv).toContain('echo ""a,b""')
  })
})

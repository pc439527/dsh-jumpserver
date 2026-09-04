import { describe, expect, it } from 'vitest'
import { serializeAudit } from '../src/client/audit-export.js'
import { formatAuditTime } from '../src/client/terminal-tab.js'

describe('audit UI helpers', () => {
  it('renders audit timestamps in UTC+8 instead of slicing UTC text', () => {
    expect(formatAuditTime('2026-09-04T02:08:42.000Z')).toBe('10:08:42')
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

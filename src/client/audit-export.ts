export type AuditExportFormat = 'csv' | 'json' | 'markdown'

const FIELDS = [
  'timestamp', 'actor', 'operation', 'gateway', 'target', 'hostname', 'risk',
  'riskRuleId', 'riskReason', 'riskConfidence', 'classifierVersion',
  'permissionMode', 'approvalRequired', 'approvalResult', 'result', 'exitCode',
  'durationMs', 'redactedCommand',
] as const

function valueOf(record: Record<string, unknown>, field: string): unknown {
  if (field === 'redactedCommand') return record['redactedCommand'] ?? record['command'] ?? ''
  return record[field] ?? ''
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  return '"' + text.replace(/"/g, '""') + '"'
}

export function serializeAudit(records: Array<Record<string, unknown>>, format: AuditExportFormat): string {
  if (format === 'json') {
    return JSON.stringify(records.map((record) => {
      const out: Record<string, unknown> = {}
      for (const field of FIELDS) out[field] = valueOf(record, field)
      return out
    }), null, 2)
  }

  if (format === 'markdown') {
    const lines = ['# JumpServer Audit Export', '', '| Time | Actor | Operation | Risk | Target | Result | Command |', '| --- | --- | --- | --- | --- | --- | --- |']
    for (const record of records) {
      const safe = (v: unknown) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
      lines.push('| ' + [
        safe(valueOf(record, 'timestamp')),
        safe(valueOf(record, 'actor')),
        safe(valueOf(record, 'operation')),
        safe(valueOf(record, 'risk')),
        safe(valueOf(record, 'target')),
        safe(valueOf(record, 'result')),
        '`' + safe(valueOf(record, 'redactedCommand')).replace(/`/g, '\\`') + '`',
      ].join(' | ') + ' |')
    }
    return lines.join('\n') + '\n'
  }

  const lines = [FIELDS.map(csvCell).join(',')]
  for (const record of records) lines.push(FIELDS.map((field) => csvCell(valueOf(record, field))).join(','))
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

export function downloadAudit(records: Array<Record<string, unknown>>, format: AuditExportFormat): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') return
  const content = serializeAudit(records, format)
  const mime = format === 'json' ? 'application/json;charset=utf-8' : format === 'markdown' ? 'text/markdown;charset=utf-8' : 'text/csv;charset=utf-8'
  const ext = format === 'markdown' ? 'md' : format
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'jumpserver-audit-' + stamp + '.' + ext
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

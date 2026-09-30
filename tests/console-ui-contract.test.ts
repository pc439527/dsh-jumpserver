import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, '..', 'src', 'runtime', 'console-page.ts'), 'utf8')
const bridge = readFileSync(join(here, '..', 'src', 'bridge', 'bridge.ts'), 'utf8')

describe('console audit tab', () => {
  it('offers CSV and JSON export', () => {
    expect(page).toContain('id="auditCsv"');
    expect(page).toContain('id="auditJson"');
    expect(page).toContain('/api/jumpserver.auditExport');
  })

  it('serialises through the shared, tested module rather than a second copy', () => {
    expect(bridge).toContain('serializeAudit');
    expect(bridge).toContain('/api/jumpserver.auditExport');
    expect(bridge).toContain('requireGrant');
  })

  it('renders times in the zone the Host reports, not a hardcoded one', () => {
    expect(page).not.toContain('Asia/Shanghai');
    expect(page).not.toContain('UTC+8');
    expect(page).toContain('auditZone');
    expect(page).toContain('data.timeZone');
  })
})

describe('console interrupt control', () => {
  it('is gated on the task state, not on the grant alone', () => {
    // It used to be enabled whenever the conversation was granted, so it sat
    // red and clickable while parked at the bastion menu.
    expect(page).toContain('renderInterrupt');
    expect(page).toContain("state === 'COMMAND_RUNNING' || runningJobs > 0");
    expect(page).not.toContain("el('interrupt').disabled = !granted");
  })

  it('tracks the running job count from the jobs list', () => {
    expect(page).toContain('runningJobs');
  })
})

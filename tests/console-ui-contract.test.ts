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
describe('console asset picker', () => {
  it('passes search, group and refresh through to the bridge', () => {
    // The route already accepted these; the pane ignored all of them.
    expect(page).toContain('payload.filter');
    expect(page).toContain('payload.group');
    expect(page).toContain('payload.refresh');
  })

  it('offers search, group filter and refresh controls', () => {
    expect(page).toContain('id="assetQuery"');
    expect(page).toContain('id="assetGroup"');
    expect(page).toContain('id="assetRefresh"');
  })

  it('lets an operator enter an asset from its row', () => {
    expect(page).toContain('data-enter');
    expect(page).toContain('enterAsset');
  })

  it('debounces search so each keystroke is not a bastion command', () => {
    expect(page).toContain('assetTimer');
    expect(page).toContain('clearTimeout(assetTimer)');
  })
})

describe('console terminal scrollback', () => {
  it('caps the DOM so a long stream cannot grow the document forever', () => {
    expect(page).toContain('TERM_MAX_ROWS');
    expect(page).toContain('trimTerm');
    // Old rows are dropped in one batch, not one layout per line.
    expect(page).toContain('TERM_TRIM_BATCH');
  })
})

import { describe, expect, it } from 'vitest'
import { manualGate, menuManualKind, classifyManual } from '../src/security/manual-policy.js'

describe('V0.2.7 manual terminal policy', () => {
  it('CONFIRM_MODIFY (default): reads pass, modifies ask once, confirmed executes', () => {
    expect(manualGate('READ', 'CONFIRM_MODIFY', 'READ_ONLY', false)).toEqual({ kind: 'allow' })
    expect(manualGate('LOW', 'CONFIRM_MODIFY', 'AUTO', false)).toEqual({ kind: 'allow' })
    expect(manualGate('MODIFY', 'CONFIRM_MODIFY', 'READ_ONLY', false)).toEqual({ kind: 'confirm', risk: 'MODIFY' })
    expect(manualGate('DANGEROUS', 'CONFIRM_MODIFY', 'FULL_ACCESS', false)).toEqual({ kind: 'confirm', risk: 'DANGEROUS' })
    expect(manualGate('MODIFY', 'CONFIRM_MODIFY', 'READ_ONLY', true).kind).toBe('allow')
  })

  it('FOLLOW_AGENT + READ_ONLY: reads pass, modifies are hard-blocked (no confirm)', () => {
    expect(manualGate('READ', 'FOLLOW_AGENT', 'READ_ONLY', false).kind).toBe('allow')
    const block = manualGate('MODIFY', 'FOLLOW_AGENT', 'READ_ONLY', false)
    expect(block.kind).toBe('block')
    if (block.kind === 'block') expect(block.reason).toContain('FOLLOW_AGENT')
    // a hard READ_ONLY block is final even confirmed
    expect(manualGate('MODIFY', 'FOLLOW_AGENT', 'READ_ONLY', true).kind).toBe('block')
  })

  it('FOLLOW_AGENT + AUTO: reads pass, MODIFY/DANGEROUS ask once, confirmed executes', () => {
    expect(manualGate('READ', 'FOLLOW_AGENT', 'AUTO', false).kind).toBe('allow')
    expect(manualGate('LOW', 'FOLLOW_AGENT', 'AUTO', false).kind).toBe('allow')
    expect(manualGate('MODIFY', 'FOLLOW_AGENT', 'AUTO', false)).toEqual({ kind: 'confirm', risk: 'MODIFY' })
    expect(manualGate('DANGEROUS', 'FOLLOW_AGENT', 'AUTO', false)).toEqual({ kind: 'confirm', risk: 'DANGEROUS' })
    expect(manualGate('MODIFY', 'FOLLOW_AGENT', 'AUTO', true).kind).toBe('allow')
    expect(manualGate('DANGEROUS', 'FOLLOW_AGENT', 'AUTO', true).kind).toBe('allow')
  })

  it('FOLLOW_AGENT + FULL_ACCESS: MODIFY passes, DANGEROUS asks once, confirmed executes', () => {
    expect(manualGate('MODIFY', 'FOLLOW_AGENT', 'FULL_ACCESS', false).kind).toBe('allow')
    expect(manualGate('DANGEROUS', 'FOLLOW_AGENT', 'FULL_ACCESS', false)).toEqual({ kind: 'confirm', risk: 'DANGEROUS' })
    expect(manualGate('DANGEROUS', 'FOLLOW_AGENT', 'FULL_ACCESS', true).kind).toBe('allow')
  })

  it('FULL_ACCESS allows everything (audit still applies)', () => {
    expect(manualGate('DANGEROUS', 'FULL_ACCESS', 'READ_ONLY', false).kind).toBe('allow')
  })
})

describe('V0.2.7 state-aware menu manual input', () => {
  it('parses p / q / target from a menu line', () => {
    expect(menuManualKind('p')).toBe('p')
    expect(menuManualKind('  p ')).toBe('p')
    expect(menuManualKind('q')).toBe('q')
    expect(menuManualKind('quit')).toBe('q')
    expect(menuManualKind('退出')).toBe('q')
    expect(menuManualKind('203.0.113.101')).toBe('enter')
    expect(menuManualKind('s079101_webserver')).toBe('enter')
    expect(menuManualKind('s079101-www')).toBe('enter')
    expect(menuManualKind('')).toBeNull()
    expect(menuManualKind('rm -rf /')).toBeNull()
    expect(menuManualKind('-h')).toBeNull()
  })

  it('classifyManual exposes the risk for auditing/gating', () => {
    expect(classifyManual('free -m').risk).toBe('READ')
    expect(classifyManual('systemctl restart nginx').risk).toBe('MODIFY')
  })
})

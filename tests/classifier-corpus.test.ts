import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { classifyCommand, CLASSIFIER_VERSION } from '../src/security/command-classifier.js'
import { gateDecision } from '../src/security/permission.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): string[] =>
  readFileSync(join(here, 'fixtures', name), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

/**
 * V0.3.1 real-Linux-ops corpus gate (CI must FAIL on any regression):
 *   - every line of read-only-commands.txt  MUST classify READ
 *   - every line of modify-commands.txt     MUST be MODIFY or DANGEROUS (never READ/UNKNOWN)
 *   - every line of dangerous-commands.txt  MUST be DANGEROUS
 *   - every line of unknown-commands.txt    MUST be UNKNOWN (never READ, never claimed MODIFY)
 * READ false-positive budget (<2% of the READ corpus) is asserted too.
 */
describe('V0.3.1 classifier corpus (real Linux ops commands)', () => {
  const reads = fixture('read-only-commands.txt')
  const modifies = fixture('modify-commands.txt')
  const dangerous = fixture('dangerous-commands.txt')
  const unknowns = fixture('unknown-commands.txt')

  it('README corpus is a real corpus (>= 200 commands) and classifies 100% READ', () => {
    expect(reads.length).toBeGreaterThanOrEqual(200)
    const bad = reads
      .map((cmd) => ({ cmd, risk: classifyCommand(cmd).risk }))
      .filter((r) => r.risk !== 'READ')
    expect(bad).toEqual([])
  })

  it('READ false-positive rate < 2% (including classification noise)', () => {
    const fp = reads.filter((cmd) => classifyCommand(cmd).risk !== 'READ').length
    expect(fp / reads.length).toBeLessThan(0.02)
  })

  it('MODIFY corpus: never READ, never downgraded to UNKNOWN', () => {
    const bad = modifies
      .map((cmd) => ({ cmd, risk: classifyCommand(cmd).risk }))
      .filter((r) => r.risk !== 'MODIFY' && r.risk !== 'DANGEROUS')
    expect(bad).toEqual([])
  })

  it('DANGEROUS corpus: every line is DANGEROUS (0 误放)', () => {
    const bad = dangerous
      .map((cmd) => ({ cmd, risk: classifyCommand(cmd).risk }))
      .filter((r) => r.risk !== 'DANGEROUS')
    expect(bad).toEqual([])
  })

  it('UNKNOWN corpus: honest UNKNOWN — never READ, never claimed MODIFY', () => {
    const bad = unknowns
      .map((cmd) => ({ cmd, risk: classifyCommand(cmd).risk }))
      .filter((r) => r.risk !== 'UNKNOWN')
    expect(bad).toEqual([])
  })

  it('every corpus command still resolves an approval decision (matrix sanity)', () => {
    for (const cmd of [...reads, ...modifies, ...dangerous, ...unknowns]) {
      const risk = classifyCommand(cmd).risk
      const auto = gateDecision(risk, 'AUTO')
      if (risk === 'READ' || risk === 'PRIVILEGED_READ') expect(auto.kind, cmd).toBe('allow')
      else expect(auto.kind, cmd).toBe('deny')
    }
  })

  it('classifierVersion is consistent for every corpus hit', () => {
    for (const cmd of [...reads, ...modifies.slice(0, 30), ...unknowns]) {
      expect(classifyCommand(cmd).classifierVersion, cmd).toBe(CLASSIFIER_VERSION)
    }
  })
})

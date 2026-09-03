#!/usr/bin/env node
/**
 * V0.3.1 classifier snapshot report: run AFTER build (reads lib/) so the gate
 * checks the SAME artifact the plugin ships, not the TS sources.
 *
 *   node scripts/classifier-report.mjs [out.json]
 *
 * Verifies the corpus against the BUILT classifier and writes a report with
 * per-risk counts plus a before/after table of key commands. Exit code 0 only
 * when:
 *   - every READ fixture line classifies READ (false-positive budget < 2%)
 *   - every MODIFY fixture line classifies MODIFY/DANGEROUS (0 误放)
 *   - every DANGEROUS fixture line classifies DANGEROUS
 *   - every UNKNOWN fixture line classifies UNKNOWN
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyCommand } from '../lib/security/command-classifier.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = process.argv[2] ?? join(process.cwd(), 'classifier-report.json')

const fixture = (name) =>
  readFileSync(join(here, '..', 'tests', 'fixtures', name), 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))

const reads = fixture('read-only-commands.txt')
const modifies = fixture('modify-commands.txt')
const dangerous = fixture('dangerous-commands.txt')
const unknowns = fixture('unknown-commands.txt')

const classify = (cmd) => {
  const c = classifyCommand(cmd)
  return { cmd, risk: c.risk, ruleId: c.ruleId, reason: c.reason }
}

const readBad = reads.map(classify).filter((r) => r.risk !== 'READ')
const modifyBad = modifies.map(classify).filter((r) => r.risk !== 'MODIFY' && r.risk !== 'DANGEROUS')
const dangerousBad = dangerous.map(classify).filter((r) => r.risk !== 'DANGEROUS')
const unknownBad = unknowns.map(classify).filter((r) => r.risk !== 'UNKNOWN')

const counts = { READ: 0, PRIVILEGED_READ: 0, UNKNOWN: 0, MODIFY: 0, DANGEROUS: 0 }
for (const cmd of [...reads, ...modifies, ...dangerous, ...unknowns]) {
  counts[classifyCommand(cmd).risk] = (counts[classifyCommand(cmd).risk] ?? 0) + 1
}

// before/after table for key commands (V0.3.1 headline changes)
const keyCommands = [
  "sed -n '1,20p' /etc/hosts",
  'findmnt',
  'pstree -ap',
  'pmap -x 1234',
  'lsns',
  'file /opt/app/app.jar',
  'sha256sum /opt/app/app.jar',
  'namei -l /opt/app/config',
  'getfacl /data',
  'lspci',
  'numactl --hardware',
  'systemctl is-failed nginx',
  'systemctl list-dependencies nginx',
  'docker compose ps',
  'kubectl top nodes',
  'kubectl events -n dev',
  'timeout 5 find /tmp -delete',
  'env curl -d a=1 http://server/api',
  'nice sysctl -w vm.drop_caches=3',
  'vendor-cli inspect',
]
const keyTable = keyCommands.map(classify)

const report = {
  classifierVersion: classifyCommand('hostname').classifierVersion,
  generatedAt: new Date().toISOString(),
  corpus: {
    read: reads.length,
    modify: modifies.length,
    dangerous: dangerous.length,
    unknown: unknowns.length,
    total: reads.length + modifies.length + dangerous.length + unknowns.length,
  },
  resultCounts: counts,
  readFalsePositiveRate: reads.length > 0 ? readBad.length / reads.length : 0,
  failures: {
    read: readBad,
    modify: modifyBad,
    dangerous: dangerousBad,
    unknown: unknownBad,
  },
  keyCommands: keyTable,
}

writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log('classifier-report written to ' + outPath)
console.log('counts: ' + JSON.stringify(counts))
if (readBad.length > 0) console.log('READ mismatches: ' + readBad.map((r) => r.cmd + '->' + r.risk).join(' | '))
if (modifyBad.length > 0) console.log('MODIFY mismatches: ' + modifyBad.map((r) => r.cmd + '->' + r.risk).join(' | '))
if (dangerousBad.length > 0) console.log('DANGEROUS mismatches: ' + dangerousBad.map((r) => r.cmd + '->' + r.risk).join(' | '))
if (unknownBad.length > 0) console.log('UNKNOWN mismatches: ' + unknownBad.map((r) => r.cmd + '->' + r.risk).join(' | '))

const ok =
  readBad.length === 0 &&
  modifyBad.length === 0 &&
  dangerousBad.length === 0 &&
  unknownBad.length === 0 &&
  (reads.length === 0 || readBad.length / reads.length < 0.02)
if (!ok) process.exit(1)
console.log('classifier corpus gate: PASS')

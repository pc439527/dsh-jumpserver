import { describe, expect, it } from 'vitest'
import { EvidenceLedger, OpsCaseRegistry, shortHash } from '../src/ops/evidence.js'

describe('V0.3.0 Evidence Ledger', () => {
  it('assigns stable E-xxx ids, hashes output and bounds the excerpt', () => {
    const ledger = new EvidenceLedger()
    const e1 = ledger.add({ kind: 'triage', target: '203.0.113.101', hostname: 'web-app-01', category: 'network', command: 'ss -lntup', exitCode: 0, output: 'netstat-ish output that is long '.repeat(400) })
    const e2 = ledger.add({ kind: 'compare', target: '203.0.113.102', hostname: 'web-app-02', category: 'errors', command: 'journalctl | wc -l', exitCode: 0, output: '37\n' })
    expect([e1.id, e2.id]).toEqual(['E-001', 'E-002'])
    expect(e1.outputHash).toBe(shortHash('netstat-ish output that is long '.repeat(400)))
    expect(e1.stdoutExcerpt.length).toBeLessThan(4200)
    expect(e1.truncated).toBe(true)
    expect(e2.truncated).toBe(false)
    expect(ledger.get('E-002')?.command).toBe('journalctl | wc -l')
    expect(ledger.summarize()).toContain('E-001')
  })
})

describe('V0.3.0 Investigation Case', () => {
  it('creates, appends evidence, hypotheses, actions and renders markdown/json', () => {
    const cases = new OpsCaseRegistry()
    const c = cases.newCase('conversation-A', { title: 'OA 访问缓慢', servers: ['203.0.113.101', '203.0.113.102'], symptoms: '上午访问缓慢' })
    expect(c.id).toBe('CASE-001')
    cases.appendEvidence('conversation-A', { kind: 'triage', target: '203.0.113.101', hostname: 'web-app-01', category: 'identity', command: 'uptime', exitCode: 0, output: 'load average: 13.5' })
    cases.addHypothesis('conversation-A', '101 负载过高')
    cases.recordAction('conversation-A', '对比 101/102')
    cases.conclude('conversation-A', '101 内存不足')
    const current = cases.current('conversation-A')
    expect(current?.evidence.size).toBe(1)
    expect(current?.hypotheses).toEqual(['101 负载过高'])
    expect(cases.get('conversation-A')?.conclusion).toBe('101 内存不足')

    const md = cases.renderMarkdown(current!)
    expect(md).toContain('# Ops Report')
    expect(md).toContain('E-001')
    expect(md).toContain('101 内存不足')
    const json = JSON.parse(cases.renderJson(current!))
    expect(json.caseId).toBe('CASE-001')
    expect(json.evidence[0].outputHash).toHaveLength(12)
  })

  it('second case on the same conversation gets CASE-002 and is the current one', () => {
    const cases = new OpsCaseRegistry()
    cases.newCase('conversation-A', { title: 'first', servers: [] })
    const second = cases.newCase('conversation-A', { title: 'second', servers: [] })
    expect(second.id).toBe('CASE-002')
    expect(cases.current('conversation-A')?.id).toBe('CASE-002')
    expect(cases.list('conversation-A')).toHaveLength(2)
  })

  it('renderers are deterministic strings without blowing up on an empty case', () => {
    const cases = new OpsCaseRegistry()
    const c = cases.newCase('conversation-A', { title: '', servers: [] })
    expect(c.title).toBe('Untitled investigation')
    expect(cases.renderMarkdown(c)).toContain('(pending)')
  })
})

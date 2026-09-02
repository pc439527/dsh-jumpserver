/**
 * V0.3.0 Ops Investigation: Evidence Ledger + Investigation Case.
 *
 * Every collected command output becomes a hash-addressed Evidence record so
 * tickets/RCA can cite "E-013: 203.0.113.136 ss -lntup -> nginx on 80/9962"
 * instead of relying on model memory. An OpsCase per conversation groups the
 * user problem, servers, symptoms, evidence, hypotheses, actions and final
 * conclusion — the shape Ops tickets and RCA drafts are rendered from.
 */
import { createHash } from 'node:crypto'

export type EvidenceKind = 'triage' | 'compare' | 'exec' | 'remediate'

export interface EvidenceRecord {
  /** Stable id: E-001 ... E-999 (per case). */
  id: string
  kind: EvidenceKind
  collectedAt: string
  target: string
  hostname: string | null
  category: string
  command: string
  exitCode: number | null
  /** Bounded stdout excerpt stored in the ledger. */
  stdoutExcerpt: string
  outputHash: string
  truncated: boolean
}

export interface EvidenceInput {
  kind: EvidenceKind
  collectedAt?: string
  target: string
  hostname: string | null
  category: string
  command: string
  exitCode: number | null
  output: string
  truncated?: boolean
  /** Cap on the excerpt stored (default 4000 chars). */
  excerptLimit?: number
}

const MAX_EXCERPT = 4000

export function shortHash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 12)
}

function excerptOf(output: string, limit: number): string {
  if (output.length <= limit) return output
  return output.slice(0, limit) + '\n…(truncated ' + (output.length - limit) + ' chars)'
}

/** Per-case evidence ledger; ids are assigned in insertion order. */
export class EvidenceLedger {
  private records: EvidenceRecord[] = []

  add(input: EvidenceInput): EvidenceRecord {
    const limit = input.excerptLimit ?? MAX_EXCERPT
    const record: EvidenceRecord = {
      id: 'E-' + String(this.records.length + 1).padStart(3, '0'),
      kind: input.kind,
      collectedAt: input.collectedAt ?? new Date().toISOString(),
      target: input.target,
      hostname: input.hostname,
      category: input.category,
      command: input.command,
      exitCode: input.exitCode,
      stdoutExcerpt: excerptOf(input.output, limit),
      outputHash: shortHash(input.output),
      truncated: input.truncated === true || input.output.length > limit,
    }
    this.records.push(record)
    return record
  }

  list(): EvidenceRecord[] {
    return [...this.records]
  }

  get(id: string): EvidenceRecord | undefined {
    return this.records.find((r) => r.id === id)
  }

  get size(): number {
    return this.records.length
  }

  /** One compact line per record — the default ledger digest. */
  summarize(): string {
    return this.records
      .map((r) => '  ' + r.id + ' ' + r.kind + ' ' + r.target + (r.hostname ?? '?') + ' rc=' + (r.exitCode ?? '?') + ' ' + r.category + ' $ ' + r.command)
      .join('\n')
  }
}

export interface OpsCase {
  id: string
  title: string
  servers: string[]
  symptoms: string
  createdAt: string
  conversation: string
  evidence: EvidenceLedger
  hypotheses: string[]
  actions: string[]
  conclusion: string | null
}

export interface NewCaseInput {
  title: string
  servers: string[]
  symptoms?: string
}

/** Per-conversation investigation cases. */
export class OpsCaseRegistry {
  private cases = new Map<string, OpsCase[]>()

  constructor(private readonly now: () => number = Date.now) {}

  newCase(conversation: string, input: NewCaseInput): OpsCase {
    const list = this.cases.get(conversation) ?? []
    const c: OpsCase = {
      id: 'CASE-' + String(list.length + 1).padStart(3, '0'),
      title: input.title.trim() || 'Untitled investigation',
      servers: [...new Set(input.servers.map((s) => s.trim()).filter((s) => s.length > 0))],
      symptoms: (input.symptoms ?? '').trim(),
      createdAt: new Date(this.now()).toISOString(),
      conversation,
      evidence: new EvidenceLedger(),
      hypotheses: [],
      actions: [],
      conclusion: null,
    }
    list.push(c)
    this.cases.set(conversation, list)
    return c
  }

  /** Most recent case of a conversation, or undefined. */
  current(conversation: string): OpsCase | undefined {
    const list = this.cases.get(conversation)
    return list !== undefined && list.length > 0 ? list[list.length - 1] : undefined
  }

  get(conversation: string, caseId?: string): OpsCase | undefined {
    if (caseId === undefined) return this.current(conversation)
    return (this.cases.get(conversation) ?? []).find((c) => c.id === caseId)
  }

  list(conversation: string): OpsCase[] {
    return [...(this.cases.get(conversation) ?? [])]
  }

  requireCurrent(conversation: string): OpsCase {
    const c = this.current(conversation)
    if (c === undefined) throw new Error('NO_CASE: create an investigation case first (jumpserver_case action=new)')
    return c
  }

  appendEvidence(conversation: string, input: EvidenceInput, caseId?: string): EvidenceRecord {
    const c = this.get(conversation, caseId) ?? this.requireCurrent(conversation)
    return c.evidence.add(input)
  }

  addHypothesis(conversation: string, hypothesis: string, caseId?: string): OpsCase {
    const c = this.requireCaseFor(conversation, caseId)
    if (hypothesis.trim().length > 0) c.hypotheses.push(hypothesis.trim())
    return c
  }

  recordAction(conversation: string, action: string, caseId?: string): OpsCase {
    const c = this.requireCaseFor(conversation, caseId)
    if (action.trim().length > 0) c.actions.push(action.trim())
    return c
  }

  conclude(conversation: string, conclusion: string, caseId?: string): OpsCase {
    const c = this.requireCaseFor(conversation, caseId)
    c.conclusion = conclusion.trim()
    return c
  }

  private requireCaseFor(conversation: string, caseId?: string): OpsCase {
    const c = this.get(conversation, caseId)
    if (c === undefined) throw new Error('NO_CASE: create an investigation case first (jumpserver_case action=new)')
    return c
  }

  /** Markdown ops-report draft (ticket/RCA seed). */
  renderMarkdown(c: OpsCase): string {
    const lines: string[] = []
    lines.push('# Ops Report — ' + c.title)
    lines.push('')
    lines.push('- Case: ' + c.id + ' (created ' + c.createdAt + ')')
    lines.push('- Servers: ' + (c.servers.length > 0 ? c.servers.join(', ') : '—'))
    lines.push('- Symptoms: ' + (c.symptoms.length > 0 ? c.symptoms : '—'))
    if (c.evidence.size > 0) {
      lines.push('')
      lines.push('## Evidence')
      lines.push(c.evidence.summarize())
    }
    lines.push('')
    lines.push('## Hypotheses')
    lines.push(c.hypotheses.length > 0 ? c.hypotheses.map((h) => '- ' + h).join('\n') : '- (none)')
    lines.push('')
    lines.push('## Actions')
    lines.push(c.actions.length > 0 ? c.actions.map((a) => '- ' + a).join('\n') : '- (none)')
    lines.push('')
    lines.push('## Conclusion')
    lines.push(c.conclusion !== null ? c.conclusion : '(pending)')
    return lines.join('\n')
  }

  renderJson(c: OpsCase): string {
    return JSON.stringify(
      {
        caseId: c.id,
        title: c.title,
        servers: c.servers,
        symptoms: c.symptoms,
        createdAt: c.createdAt,
        evidence: c.evidence.list(),
        hypotheses: c.hypotheses,
        actions: c.actions,
        conclusion: c.conclusion,
      },
      null,
      2,
    )
  }
}

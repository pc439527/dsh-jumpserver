/**
 * V0.3.0 Ops Investigation: Evidence Ledger + Investigation Case.
 *
 * Every collected command output becomes a hash-addressed Evidence record so
 * tickets/RCA can cite "E-013: 203.0.113.136 ss -lntup -> nginx on 80/9962"
 * instead of relying on model memory. An OpsCase per conversation groups the
 * user problem, servers, symptoms, evidence, hypotheses, actions and final
 * conclusion — the shape Ops tickets and RCA drafts are rendered from.
 */
import { createHash } from 'node:crypto';
const MAX_EXCERPT = 4000;
export function shortHash(text) {
    return createHash('sha1').update(text).digest('hex').slice(0, 12);
}
function excerptOf(output, limit) {
    if (output.length <= limit)
        return output;
    return output.slice(0, limit) + '\n…(truncated ' + (output.length - limit) + ' chars)';
}
/** Per-case evidence ledger; ids are assigned in insertion order. */
export class EvidenceLedger {
    records = [];
    add(input) {
        const limit = input.excerptLimit ?? MAX_EXCERPT;
        const record = {
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
        };
        this.records.push(record);
        return record;
    }
    list() {
        return [...this.records];
    }
    get(id) {
        return this.records.find((r) => r.id === id);
    }
    get size() {
        return this.records.length;
    }
    /** One compact line per record — the default ledger digest. */
    summarize() {
        return this.records
            .map((r) => '  ' + r.id + ' ' + r.kind + ' ' + r.target + (r.hostname ?? '?') + ' rc=' + (r.exitCode ?? '?') + ' ' + r.category + ' $ ' + r.command)
            .join('\n');
    }
}
/** Per-conversation investigation cases. */
export class OpsCaseRegistry {
    now;
    cases = new Map();
    constructor(now = Date.now) {
        this.now = now;
    }
    newCase(conversation, input) {
        const list = this.cases.get(conversation) ?? [];
        const c = {
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
        };
        list.push(c);
        this.cases.set(conversation, list);
        return c;
    }
    /** Most recent case of a conversation, or undefined. */
    current(conversation) {
        const list = this.cases.get(conversation);
        return list !== undefined && list.length > 0 ? list[list.length - 1] : undefined;
    }
    get(conversation, caseId) {
        if (caseId === undefined)
            return this.current(conversation);
        return (this.cases.get(conversation) ?? []).find((c) => c.id === caseId);
    }
    list(conversation) {
        return [...(this.cases.get(conversation) ?? [])];
    }
    /** V0.3.1 P2: drop every case of a detached conversation (memory hygiene). */
    deleteConversation(conversation) {
        this.cases.delete(conversation);
    }
    requireCurrent(conversation) {
        const c = this.current(conversation);
        if (c === undefined)
            throw new Error('NO_CASE: create an investigation case first (jumpserver_case action=new)');
        return c;
    }
    appendEvidence(conversation, input, caseId) {
        const c = this.get(conversation, caseId) ?? this.requireCurrent(conversation);
        return c.evidence.add(input);
    }
    addHypothesis(conversation, hypothesis, caseId) {
        const c = this.requireCaseFor(conversation, caseId);
        if (hypothesis.trim().length > 0)
            c.hypotheses.push(hypothesis.trim());
        return c;
    }
    recordAction(conversation, action, caseId) {
        const c = this.requireCaseFor(conversation, caseId);
        if (action.trim().length > 0)
            c.actions.push(action.trim());
        return c;
    }
    conclude(conversation, conclusion, caseId) {
        const c = this.requireCaseFor(conversation, caseId);
        c.conclusion = conclusion.trim();
        return c;
    }
    requireCaseFor(conversation, caseId) {
        const c = this.get(conversation, caseId);
        if (c === undefined)
            throw new Error('NO_CASE: create an investigation case first (jumpserver_case action=new)');
        return c;
    }
    /** Markdown ops-report draft (ticket/RCA seed). */
    renderMarkdown(c) {
        const lines = [];
        lines.push('# Ops Report — ' + c.title);
        lines.push('');
        lines.push('- Case: ' + c.id + ' (created ' + c.createdAt + ')');
        lines.push('- Servers: ' + (c.servers.length > 0 ? c.servers.join(', ') : '—'));
        lines.push('- Symptoms: ' + (c.symptoms.length > 0 ? c.symptoms : '—'));
        if (c.evidence.size > 0) {
            lines.push('');
            lines.push('## Evidence');
            lines.push(c.evidence.summarize());
        }
        lines.push('');
        lines.push('## Hypotheses');
        lines.push(c.hypotheses.length > 0 ? c.hypotheses.map((h) => '- ' + h).join('\n') : '- (none)');
        lines.push('');
        lines.push('## Actions');
        lines.push(c.actions.length > 0 ? c.actions.map((a) => '- ' + a).join('\n') : '- (none)');
        lines.push('');
        lines.push('## Conclusion');
        lines.push(c.conclusion !== null ? c.conclusion : '(pending)');
        return lines.join('\n');
    }
    renderJson(c) {
        return JSON.stringify({
            caseId: c.id,
            title: c.title,
            servers: c.servers,
            symptoms: c.symptoms,
            createdAt: c.createdAt,
            evidence: c.evidence.list(),
            hypotheses: c.hypotheses,
            actions: c.actions,
            conclusion: c.conclusion,
        }, null, 2);
    }
}

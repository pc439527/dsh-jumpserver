export type EvidenceKind = 'triage' | 'compare' | 'exec' | 'remediate';
export interface EvidenceRecord {
    /** Stable id: E-001 ... E-999 (per case). */
    id: string;
    kind: EvidenceKind;
    collectedAt: string;
    target: string;
    hostname: string | null;
    category: string;
    command: string;
    exitCode: number | null;
    /** Bounded stdout excerpt stored in the ledger. */
    stdoutExcerpt: string;
    outputHash: string;
    truncated: boolean;
}
export interface EvidenceInput {
    kind: EvidenceKind;
    collectedAt?: string;
    target: string;
    hostname: string | null;
    category: string;
    command: string;
    exitCode: number | null;
    output: string;
    truncated?: boolean;
    /** Cap on the excerpt stored (default 4000 chars). */
    excerptLimit?: number;
}
export declare function shortHash(text: string): string;
/** Per-case evidence ledger; ids are assigned in insertion order. */
export declare class EvidenceLedger {
    private records;
    add(input: EvidenceInput): EvidenceRecord;
    list(): EvidenceRecord[];
    get(id: string): EvidenceRecord | undefined;
    get size(): number;
    /** One compact line per record — the default ledger digest. */
    summarize(): string;
}
export interface OpsCase {
    id: string;
    title: string;
    servers: string[];
    symptoms: string;
    createdAt: string;
    conversation: string;
    evidence: EvidenceLedger;
    hypotheses: string[];
    actions: string[];
    conclusion: string | null;
}
export interface NewCaseInput {
    title: string;
    servers: string[];
    symptoms?: string;
}
/** Per-conversation investigation cases. */
export declare class OpsCaseRegistry {
    private readonly now;
    private cases;
    constructor(now?: () => number);
    newCase(conversation: string, input: NewCaseInput): OpsCase;
    /** Most recent case of a conversation, or undefined. */
    current(conversation: string): OpsCase | undefined;
    get(conversation: string, caseId?: string): OpsCase | undefined;
    list(conversation: string): OpsCase[];
    /** V0.3.1 P2: drop every case of a detached conversation (memory hygiene). */
    deleteConversation(conversation: string): void;
    requireCurrent(conversation: string): OpsCase;
    appendEvidence(conversation: string, input: EvidenceInput, caseId?: string): EvidenceRecord;
    addHypothesis(conversation: string, hypothesis: string, caseId?: string): OpsCase;
    recordAction(conversation: string, action: string, caseId?: string): OpsCase;
    conclude(conversation: string, conclusion: string, caseId?: string): OpsCase;
    private requireCaseFor;
    /** Markdown ops-report draft (ticket/RCA seed). */
    renderMarkdown(c: OpsCase): string;
    renderJson(c: OpsCase): string;
}

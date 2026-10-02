import type { RiskJudgeAutoAllowConfig, RiskJudgeConfig } from '../config/types.js';
export interface RiskJudgeVerdict {
    /** Probability the command only reads/display state (0-1). */
    readOnly: number;
    /** Highest lasting effect if executed: none | transient | persistent | destructive. */
    impact: string;
    /**
     * Expected rubric position, 0-based — the value the API actually returns.
     * Measured: the `score` answer is an expectation over the rubric criteria
     * (`0:0.75 1:0.23 2:0.02 …`), so it lives on 0..RISK_LEVELS.length-1. V0.5.7
     * read it as a 1..5 position and clamped every verdict into the safest band;
     * V0.5.8 keeps the real scale (see riskLevelOf).
     */
    riskScore: number;
    /** Rubric label the score falls in. */
    riskLevel: string;
    /**
     * Probability mass the rubric distribution puts on its two safest bands
     * (P(0)+P(1)), or null when the response carried no distribution. The
     * expectation alone can hide a fat tail; this is the number auto-allow
     * trusts.
     */
    safeProbability: number | null;
    /** Probability the command needs root/sudo (0-1). */
    needsPrivilege: number;
    /**
     * Model confidence — the LOWEST confidence the response reported across its
     * answered questions (V0.5.8; V0.5.7 read the impact answer only). A chain is
     * as strong as its weakest answer when the answer decides whether a command
     * runs unattended.
     */
    confidence: number;
    /** True when served from the local TTL cache. */
    cached: boolean;
    /** Outbound call latency in ms (0 when cached). */
    latencyMs: number;
}
/** Rubric labels (Score criteria) — index 0 is safest. */
export declare const RISK_LEVELS: readonly string[];
/**
 * Redact a command before it is sent to the judge. Credentials are always
 * masked; network identifiers are masked unless `redactNetwork` is disabled.
 * Install paths, unit names and file names stay intact — removing them would
 * destroy the semantics being judged.
 */
export declare function redactCommandForJudge(command: string, redactNetwork?: boolean): string;
/** Test hook: drop every cached verdict. */
export declare function resetRiskJudgeCache(): void;
/**
 * The API key never enters the config object, only the name of the env var
 * (and optionally a path) does.
 *
 * Resolution order mirrors ~/.workbuddy/typesafe/ts.py: `TYPESAFE_API_KEY`
 * first, then the key file — so the connector works whether it was spawned by
 * a host that inherited the env var or not. Any read failure is a miss, never
 * a throw: an unreadable key file must degrade to null, not break the gate.
 */
export declare function resolveApiKey(config: RiskJudgeConfig, env?: NodeJS.ProcessEnv): string;
/**
 * Ask the judge about ONE command. Returns null whenever the judge is off,
 * unconfigured, slow, broken or unintelligible — the caller must then behave
 * exactly as it does today.
 */
export declare function judgeCommandRisk(command: string, config: RiskJudgeConfig | undefined, resolveCredential?: (ref: string) => Promise<string | undefined>): Promise<RiskJudgeVerdict | null>;
/** Why the judge produced no verdict. Never changes the gate's decision. */
export type RiskJudgeError = 'disabled' | 'no-command' | 'no-credential' | 'unreachable' | 'timeout' | 'http-error' | 'bad-payload';
/**
 * Why the judge produced no verdict.
 *
 * The settings card stores the API key in the DSH credential domain, NOT in
 * process.env, so the original env-only lookup could never see a key the user
 * actually saved and the judge stayed silent forever. `resolveCredential` is
 * the same credential seam the SSH password already uses.
 *
 * The reason is reported so "configured but not working" stops looking
 * identical to "not configured". It never changes the gate's decision.
 */
export declare function judgeCommandRiskDetailed(command: string, config: RiskJudgeConfig | undefined, resolveCredential?: (ref: string) => Promise<string | undefined>): Promise<{
    verdict: RiskJudgeVerdict | null;
    error?: RiskJudgeError;
}>;
/**
 * One-line numeric summary. Used where the full note would bloat a batch
 * approval prompt (up to 10 commands share one dialog).
 */
export declare function riskJudgeSummary(verdict: RiskJudgeVerdict): string;
/**
 * Approval-copy lines for a verdict. Empty when there is no verdict, so the
 * caller appends nothing and the prompt looks exactly as it does today.
 *
 * The copy must stay honest: it is an opinion shown to a human, never a gate.
 * V0.5.8: when auto-allow is switched on, a verdict that FAILED the guard says
 * so — otherwise the operator cannot tell "the model had no opinion" from "the
 * model had an opinion and it was not good enough to skip this prompt".
 */
export declare function riskJudgeNote(verdict: RiskJudgeVerdict | null, options?: {
    autoAllowEnabled?: boolean;
    autoAllowRefusal?: string;
}): string[];
export interface AutoAllowDecision {
    /** True only when every threshold passed. */
    allow: boolean;
    /** Why it was refused (empty when allowed) — shown to the operator. */
    reason: string;
}
/**
 * The ONLY place a judge verdict may widen what runs.
 *
 * Fail-closed by construction: no config, no verdict, no distribution, a
 * composed command, an opaque-shell class, a multi-line command, an
 * interpreter/remote head, or any threshold miss returns `allow: false` with a
 * human-readable reason. A broken or unreachable judge therefore behaves
 * exactly like V0.5.7 (advisory only) — it can never be the reason something
 * ran.
 */
export declare function decideAutoAllow(verdict: RiskJudgeVerdict | null, context: {
    command: string;
    ruleId?: string;
}, config: RiskJudgeAutoAllowConfig | undefined): AutoAllowDecision;
/**
 * One-line record of a judge decision, for the audit trail and the tool
 * result. `autoAllowed:true` marks a command that ran without a human
 * round-trip — that fact must be readable long after the prompt is gone.
 */
export declare function riskJudgeAuditLine(verdict: RiskJudgeVerdict, autoAllowed: boolean, reason?: string): string;

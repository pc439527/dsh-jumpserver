import { isVolatile } from '@deepseek-ai/cosmokit';
/**
 * Unwrap DSH volatile config references into plain values.
 *
 * Every field in schema.ts is declared `.volatile()` so the Host's settings
 * service will serve this plugin's namespace at all. A volatile field's parsed
 * value is a REFERENCE (cosmokit's Volatile) exposing get(), so reading it
 * directly yields `[object Object]` instead of the configured value. The Host
 * unwraps internally (plainConfig); plugin code must do it explicitly or every
 * scalar read is wrong.
 */
export function unwrapConfig(value) {
    return unwrapValue(value);
}
/** Recursively replace Volatile references with their current snapshots. */
function unwrapValue(value) {
    if (isVolatile(value))
        return unwrapValue(value.get());
    if (Array.isArray(value))
        return value.map(unwrapValue);
    if (value !== null && typeof value === 'object') {
        const out = {};
        for (const [key, child] of Object.entries(value))
            out[key] = unwrapValue(child);
        return out;
    }
    return value;
}
export const PERMISSION_MODES = ['READ_ONLY', 'AUTO', 'FULL_ACCESS'];
/** Every risk value in matrix order (README + classifier snapshot report). */
export const COMMAND_RISKS = ['READ', 'PRIVILEGED_READ', 'UNKNOWN', 'MODIFY', 'DANGEROUS'];
/** Legacy alias (V0.2.x LOW == privileged read). Kept for config compat. */
export const LEGACY_RISK_LOW = 'LOW';
/**
 * Every console tab id, in navigation order.
 *
 * The order IS the rendered order: `resolveConsoleTabs()` walks this array, so
 * the viewer never has to sort and a filtered tab list keeps its place.
 */
export const CONSOLE_TAB_IDS = [
    'terminal',
    'assets',
    'jobs',
    'audit',
];
/** Default visibility of every console tab: all on. */
export const DEFAULT_CONSOLE_TABS = {
    terminal: true,
    assets: true,
    jobs: true,
    audit: true,
};
/**
 * Tabs that can never be hidden.
 *
 * The terminal mirror is the console's reason to exist, so it can never be
 * hidden; the rule is enforced here rather than delegated to each caller.
 */
export const ALWAYS_ON_CONSOLE_TABS = ['terminal'];
/** Default terminal scrollback (rows). */
export const DEFAULT_TERMINAL_SCROLLBACK = 5000;
/** Default asset-list cache TTL (seconds). One 'p' feeds 5 minutes of local filtering. */
export const DEFAULT_ASSET_CACHE_TTL_SECONDS = 300;
/** Hard cap on the terminal observer's raw output byte budget (ring buffer). */
export const MAX_TERMINAL_BYTES = 4 * 1024 * 1024;
/** Default timeout maps (ms). enterAsset is generous: KoKo dials the asset with a progress banner. */
export const DEFAULT_TIMEOUTS = {
    connect: 15000,
    enterAsset: 40000,
    probe: 15000,
    command: 60000,
    leave: 15000,
    listAssets: 15000,
};
/** Hard cap on one command's captured output (1 MiB). */
export const MAX_OUTPUT_BYTES = 1024 * 1024;
/** Max per-command timeout allowed (10 min). */
export const MAX_COMMAND_TIMEOUT_MS = 600000;
/** V0.4.1: default concurrency for a multi-target batch (1 = sequential). */
export const DEFAULT_BATCH_CONCURRENCY = 1;
/** V0.4.1: default session-pool size (simultaneous bastion sessions). */
export const DEFAULT_MAX_SESSIONS = 4;
/** V0.4.1: hard ceiling for batchConcurrency / maxSessions (protects the bastion). */
export const MAX_BATCH_CONCURRENCY = 8;
export const MAX_SESSIONS_CEILING = 16;
/** Bounded capture window for the KoKo 'p' asset-list screen (bytes). */
export const MAX_ASSET_CAPTURE_BYTES = 256 * 1024;
export const DEFAULT_PASSWORD_ENV = 'JUMPSERVER_PASSWORD';
/** V0.5.7: default credential-ref for the optional risk judge (Jev / TypeSafe AI). */
export const DEFAULT_RISK_JUDGE_API_KEY_ENV = 'TYPESAFE_API_KEY';
/** V0.5.7: default System One endpoint. */
export const DEFAULT_RISK_JUDGE_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/**
 * V0.5.7: fallback key file. Empty in the DSH port on purpose — the key is
 * resolved through the DSH credential store (credential-ref) only, so the
 * plugin never reads another product's home directory.
 */
export const DEFAULT_RISK_JUDGE_API_KEY_FILE = '';
/** V0.5.7: default risk-judge settings (disabled — nothing leaves the process). */
export const DEFAULT_RISK_JUDGE = {
    enabled: false,
    endpoint: DEFAULT_RISK_JUDGE_ENDPOINT,
    apiKeyEnv: DEFAULT_RISK_JUDGE_API_KEY_ENV,
    apiKeyFile: DEFAULT_RISK_JUDGE_API_KEY_FILE,
    model: 'jev-latest',
    timeoutMs: 1500,
    cacheTtlSeconds: 3600,
    redactNetwork: true,
    // V0.5.8: opt-in, and conservative even then. See RiskJudgeAutoAllowConfig.
    autoAllow: {
        enabled: false,
        minReadOnly: 0.9,
        minConfidence: 0.7,
        maxRiskScore: 1,
        minSafeProbability: 0.85,
        maxNeedsPrivilege: 0.3,
    },
};
/** Resolve the manual terminal policy with its default (CONFIRM_MODIFY). */
export function manualPolicyOf(cfg) {
    return cfg.manualPermissionMode ?? 'CONFIRM_MODIFY';
}
/**
 * V0.5.7: resolve the effective risk-judge settings from a loosely typed config
 * value (the settings card stores plain JSON). Anything missing or malformed
 * falls back to {@link DEFAULT_RISK_JUDGE}, so a broken config can never turn
 * the judge on by accident.
 */
export function resolveRiskJudge(cfg) {
    const raw = (cfg.riskJudge ?? {});
    const autoRaw = (raw.autoAllow ?? {});
    const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
    const str = (value, fallback) => (typeof value === 'string' && value.length > 0 ? value : fallback);
    const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
    return {
        enabled: bool(raw.enabled, DEFAULT_RISK_JUDGE.enabled),
        endpoint: str(raw.endpoint, DEFAULT_RISK_JUDGE.endpoint),
        apiKeyEnv: str(raw.apiKeyEnv, DEFAULT_RISK_JUDGE.apiKeyEnv),
        apiKeyFile: typeof raw.apiKeyFile === 'string' ? raw.apiKeyFile : DEFAULT_RISK_JUDGE.apiKeyFile,
        model: str(raw.model, DEFAULT_RISK_JUDGE.model),
        timeoutMs: num(raw.timeoutMs, DEFAULT_RISK_JUDGE.timeoutMs),
        cacheTtlSeconds: num(raw.cacheTtlSeconds, DEFAULT_RISK_JUDGE.cacheTtlSeconds),
        redactNetwork: bool(raw.redactNetwork, DEFAULT_RISK_JUDGE.redactNetwork),
        autoAllow: {
            enabled: bool(autoRaw.enabled, DEFAULT_RISK_JUDGE.autoAllow.enabled),
            minReadOnly: num(autoRaw.minReadOnly, DEFAULT_RISK_JUDGE.autoAllow.minReadOnly),
            minConfidence: num(autoRaw.minConfidence, DEFAULT_RISK_JUDGE.autoAllow.minConfidence),
            maxRiskScore: num(autoRaw.maxRiskScore, DEFAULT_RISK_JUDGE.autoAllow.maxRiskScore),
            minSafeProbability: num(autoRaw.minSafeProbability, DEFAULT_RISK_JUDGE.autoAllow.minSafeProbability),
            maxNeedsPrivilege: num(autoRaw.maxNeedsPrivilege, DEFAULT_RISK_JUDGE.autoAllow.maxNeedsPrivilege),
        },
    };
}
/** V0.4.1: bounded concurrency / session-pool ceilings with their defaults. */
export function resolveConcurrency(cfg) {
    const clamp = (value, fallback, max) => {
        if (typeof value !== 'number' || !Number.isFinite(value))
            return fallback;
        return Math.min(max, Math.max(1, Math.floor(value)));
    };
    return {
        batchConcurrency: clamp(cfg.batchConcurrency, DEFAULT_BATCH_CONCURRENCY, MAX_BATCH_CONCURRENCY),
        maxSessions: clamp(cfg.maxSessions, DEFAULT_MAX_SESSIONS, MAX_SESSIONS_CEILING),
    };
}
/**
 * Resolve the effective bastion identity.
 *
 * Precedence: the selected profile wins over the settings card, field by
 * field — so a profile that only overrides the username still inherits the
 * configured host. A malformed/absent profile degrades to the settings card
 * instead of failing: an account problem must never be the reason a
 * connection cannot be made.
 */
export function resolveConnection(cfg) {
    const raw = Array.isArray(cfg.profiles) ? cfg.profiles : [];
    const profiles = raw.filter((p) => p !== null && typeof p === 'object' && typeof p.id === 'string' && p.id.length > 0);
    const active = typeof cfg.activeProfileId === 'string' && cfg.activeProfileId.length > 0
        ? profiles.find((p) => p.id === cfg.activeProfileId)
        : undefined;
    const use = (value, fallback) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
    const port = typeof active?.port === 'number' && Number.isFinite(active.port) && active.port > 0 && active.port <= 65535
        ? Math.floor(active.port)
        : cfg.port;
    return {
        host: use(active?.host, cfg.host),
        port,
        username: use(active?.username, cfg.username),
        passwordEnv: use(active?.passwordEnv, cfg.passwordEnv),
        source: active !== undefined ? 'profile' : 'settings',
        ...(active !== undefined ? { profileId: active.id, profileLabel: active.label } : {}),
    };
}

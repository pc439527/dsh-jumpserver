export type HostKeyOutcome = 
/** Key matches an operator-pinned fingerprint. */
'pinned-match'
/** Key contradicts an operator-pinned fingerprint — hard refusal. */
 | 'pinned-mismatch'
/** Key matches the previously recorded key for this host. */
 | 'known-match'
/** Key differs from the recorded key — hard refusal (possible MITM). */
 | 'mismatch'
/** First contact, no pin: the key was recorded and accepted. */
 | 'tofu-recorded'
/** First contact with no store available to record into; accepted but unverifiable next time. */
 | 'tofu-unrecorded';
export interface HostKeyDecision {
    accept: boolean;
    outcome: HostKeyOutcome;
    /** SHA256 fingerprint of the key that was actually presented. */
    fingerprint: string;
    /** Host-key algorithm parsed from the key blob (e.g. ssh-ed25519). */
    algorithm?: string;
    /** The fingerprint we expected, when one was available (pin or record). */
    expected?: string;
    /** Path of the known_hosts store, when one is configured. */
    storePath?: string;
}
export interface KnownHostRecord {
    algorithm?: string;
    fingerprint: string;
    firstSeenAt: string;
    /** 'tofu' = learned on first contact; 'pinned' = matched a configured fingerprint. */
    source: 'tofu' | 'pinned';
}
/** Parse the algorithm name out of an SSH host-key blob (uint32 length + name). */
export declare function parseKeyAlgorithm(key: Buffer): string | undefined;
/** OpenSSH-style fingerprint, e.g. `SHA256:AbCdEf…` (no padding, like ssh-keygen -lf). */
export declare function sha256Fingerprint(key: Buffer): string;
/** Legacy OpenSSH fingerprint, e.g. `MD5:aa:bb:cc:…`. */
export declare function md5Fingerprint(key: Buffer): string;
/**
 * Compare a key against an operator-supplied fingerprint, accepting every
 * format a person is realistically going to paste:
 *
 *   SHA256:AbCdEf…   OpenSSH default (padding optional, case-sensitive body)
 *   MD5:aa:bb:cc:…   legacy ssh-keygen output
 *   <64 hex chars>   raw sha256 digest
 *   <43/44 base64>   bare sha256, padding optional
 */
export declare function matchesFingerprint(key: Buffer, expected: string): boolean;
/** Empty / whitespace-only fingerprints mean "not configured". */
export declare function normalizeFingerprint(raw: string | undefined): string | undefined;
/** Normalize a host into its known_hosts key (lowercase, always port-qualified). */
export declare function knownHostsKey(host: string, port: number): string;
/**
 * JSON-backed known_hosts store.
 *
 * A corrupt or unreadable file is treated as empty rather than fatal: refusing
 * to start because a sidecar file is malformed would be a worse failure than
 * re-learning the key, and the next write repairs the file. The trade-off is
 * recorded here on purpose — an attacker who can corrupt the file can also
 * force a fresh TOFU, which is why pinning exists for environments that need
 * certainty.
 */
export declare class KnownHostsStore {
    readonly path: string;
    private records;
    constructor(path: string);
    get(hostPort: string): KnownHostRecord | undefined;
    /** Persist a record. Returns false when the file could not be written. */
    put(hostPort: string, record: KnownHostRecord): boolean;
    /** Every recorded host (read-only view, for the console settings tab). */
    entries(): Record<string, KnownHostRecord>;
}
export interface HostKeyGuardOptions {
    host: string;
    port: number;
    /** Operator-pinned fingerprint; when set only a match is accepted. */
    fingerprint?: string;
    /** known_hosts path; when absent, TOFU decisions cannot be persisted. */
    storePath?: string;
    /** Notified for every decision so the caller can log / audit it. */
    onDecision?: (decision: HostKeyDecision) => void;
}
export interface HostKeyGuard {
    /** ssh2 `hostVerifier` (synchronous form). */
    verifier: (key: Buffer) => boolean;
    /** The most recent decision, or undefined before the first verification. */
    last: () => HostKeyDecision | undefined;
}
/**
 * Build the verifier handed to ssh2. Every call records its decision so the
 * connect-failure path can report WHY the handshake was refused instead of a
 * generic "host verification failed".
 */
export declare function createHostKeyGuard(opts: HostKeyGuardOptions): HostKeyGuard;
/** Operator-facing explanation for a refused host key. */
export declare function describeHostKeyRefusal(decision: HostKeyDecision): string;

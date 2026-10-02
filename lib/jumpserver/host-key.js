/**
 * V0.5.0 — SSH host-key verification: TOFU + optional fingerprint pinning.
 *
 * Before this module the connector used an encrypted SSH channel without ever
 * checking WHO was on the other end: `ssh2.connect()` ran with no
 * `hostVerifier`, so a machine that could intercept the route to the bastion
 * would collect the JumpServer password. Encryption without identity
 * verification is not a trust chain.
 *
 * Two modes, chosen by whether the operator pinned a fingerprint:
 *
 *   pinned    config.json (or the connector form) carries a SHA256/MD5
 *             fingerprint. Only a byte-identical key is accepted; anything
 *             else is refused as `pinned-mismatch`.
 *   TOFU      no pin. The first successful contact records the key in a local
 *             known_hosts file and accepts; every later contact must match
 *             that record or the connection is refused as `mismatch`.
 *
 * A mismatch is never auto-healed. Silently re-trusting a changed host key is
 * exactly the behaviour that makes TOFU worthless, so the refusal stands until
 * a human edits or deletes the known_hosts entry.
 *
 * Verification is synchronous because ssh2's `hostVerifier` is called inline
 * during the handshake; the store is loaded once when the guard is created and
 * persisted with a synchronous write.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
/** Parse the algorithm name out of an SSH host-key blob (uint32 length + name). */
export function parseKeyAlgorithm(key) {
    if (key.length < 4)
        return undefined;
    const length = key.readUInt32BE(0);
    if (length <= 0 || 4 + length > key.length)
        return undefined;
    return key.toString('utf8', 4, 4 + length);
}
function sha256Base64(key) {
    return createHash('sha256').update(key).digest('base64');
}
function sha256Hex(key) {
    return createHash('sha256').update(key).digest('hex');
}
function md5Hex(key) {
    return createHash('md5').update(key).digest('hex');
}
function stripPadding(value) {
    return value.replace(/=+$/, '');
}
/** OpenSSH-style fingerprint, e.g. `SHA256:AbCdEf…` (no padding, like ssh-keygen -lf). */
export function sha256Fingerprint(key) {
    return 'SHA256:' + stripPadding(sha256Base64(key));
}
/** Legacy OpenSSH fingerprint, e.g. `MD5:aa:bb:cc:…`. */
export function md5Fingerprint(key) {
    const hex = md5Hex(key);
    const pairs = hex.match(/.{2}/g) ?? [];
    return 'MD5:' + pairs.join(':');
}
/**
 * Compare a key against an operator-supplied fingerprint, accepting every
 * format a person is realistically going to paste:
 *
 *   SHA256:AbCdEf…   OpenSSH default (padding optional, case-sensitive body)
 *   MD5:aa:bb:cc:…   legacy ssh-keygen output
 *   <64 hex chars>   raw sha256 digest
 *   <43/44 base64>   bare sha256, padding optional
 */
export function matchesFingerprint(key, expected) {
    const value = expected.trim();
    const upper = value.toUpperCase();
    if (upper.startsWith('SHA256:')) {
        return stripPadding(value.slice(7).trim()) === stripPadding(sha256Base64(key));
    }
    if (upper.startsWith('MD5:')) {
        return value.slice(4).replace(/[:\s]/g, '').toLowerCase() === md5Hex(key);
    }
    if (/^[0-9a-f]{64}$/i.test(value)) {
        return value.toLowerCase() === sha256Hex(key);
    }
    return stripPadding(value) === stripPadding(sha256Base64(key));
}
/** Empty / whitespace-only fingerprints mean "not configured". */
export function normalizeFingerprint(raw) {
    if (raw === undefined)
        return undefined;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
/** Normalize a host into its known_hosts key (lowercase, always port-qualified). */
export function knownHostsKey(host, port) {
    return host.trim().toLowerCase() + ':' + String(port);
}
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
export class KnownHostsStore {
    path;
    records;
    constructor(path) {
        this.path = path;
        this.records = loadKnownHosts(path);
    }
    get(hostPort) {
        return this.records[hostPort];
    }
    /** Persist a record. Returns false when the file could not be written. */
    put(hostPort, record) {
        this.records[hostPort] = record;
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            const payload = { version: 1, hosts: this.records };
            writeFileSync(this.path, JSON.stringify(payload, null, 2) + '\n', 'utf8');
            return true;
        }
        catch {
            return false;
        }
    }
    /** Every recorded host (read-only view, for the console settings tab). */
    entries() {
        return { ...this.records };
    }
}
function loadKnownHosts(path) {
    if (!existsSync(path))
        return {};
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed === null || typeof parsed !== 'object')
            return {};
        const hosts = parsed.hosts;
        if (hosts === null || typeof hosts !== 'object')
            return {};
        return hosts;
    }
    catch {
        return {};
    }
}
/**
 * Build the verifier handed to ssh2. Every call records its decision so the
 * connect-failure path can report WHY the handshake was refused instead of a
 * generic "host verification failed".
 */
export function createHostKeyGuard(opts) {
    const pin = normalizeFingerprint(opts.fingerprint);
    const storePath = opts.storePath !== undefined && opts.storePath.length > 0 ? opts.storePath : undefined;
    const store = storePath !== undefined ? new KnownHostsStore(storePath) : null;
    const hostPort = knownHostsKey(opts.host, opts.port);
    let last;
    const verifier = (key) => {
        const fingerprint = sha256Fingerprint(key);
        const algorithm = parseKeyAlgorithm(key);
        if (pin !== undefined) {
            const ok = matchesFingerprint(key, pin);
            last = {
                accept: ok,
                outcome: ok ? 'pinned-match' : 'pinned-mismatch',
                fingerprint,
                algorithm,
                expected: pin,
                storePath,
            };
            if (ok && store !== null) {
                store.put(hostPort, { algorithm, fingerprint, firstSeenAt: new Date().toISOString(), source: 'pinned' });
            }
            opts.onDecision?.(last);
            return ok;
        }
        const known = store?.get(hostPort);
        if (known !== undefined) {
            const ok = known.fingerprint === fingerprint;
            last = {
                accept: ok,
                outcome: ok ? 'known-match' : 'mismatch',
                fingerprint,
                algorithm,
                expected: known.fingerprint,
                storePath,
            };
            opts.onDecision?.(last);
            return ok;
        }
        const recorded = store !== null
            ? store.put(hostPort, { algorithm, fingerprint, firstSeenAt: new Date().toISOString(), source: 'tofu' })
            : false;
        last = {
            accept: true,
            outcome: recorded ? 'tofu-recorded' : 'tofu-unrecorded',
            fingerprint,
            algorithm,
            storePath,
        };
        opts.onDecision?.(last);
        return true;
    };
    return { verifier, last: () => last };
}
/** Operator-facing explanation for a refused host key. */
export function describeHostKeyRefusal(decision) {
    const where = decision.storePath !== undefined ? decision.storePath : '(no known_hosts file configured)';
    if (decision.outcome === 'pinned-mismatch') {
        return ('refused: the bastion presented a host key that does not match the pinned fingerprint ' +
            '(expected ' + String(decision.expected) + ', got ' + decision.fingerprint + '). ' +
            'If the bastion was legitimately rebuilt, update the configured fingerprint; ' +
            'do not clear this blindly.');
    }
    return ('refused: the bastion host key changed since the last successful connection ' +
        '(expected ' + String(decision.expected) + ', got ' + decision.fingerprint + '). ' +
        'This is the signature of a man-in-the-middle, but it also happens after a legitimate ' +
        'bastion rebuild. Verify out of band, then edit or delete the entry for this host in ' + where + '.');
}

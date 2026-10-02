import { Client } from 'ssh2';
import { JumpServerError } from './errors.js';
import { createHostKeyGuard, describeHostKeyRefusal } from './host-key.js';
const AUTH_FAILED_PATTERN = /authentication|permission denied|password.*incorrect|incorrect.*password|keyboard-interactive/i;
/**
 * Live ssh2 adapter: one SSH connection with one interactive PTY shell.
 * The entire JumpServer session (menu -> asset -> commands) reuses this
 * single channel; nothing reconnects per command.
 *
 * V0.5.0: the handshake now verifies the bastion's host key before the
 * password is transmitted (see host-key.ts).
 */
export class SshPtyWire {
    client;
    stream;
    dataCbs = new Set();
    errorCbs = new Set();
    closeCbs = new Set();
    settled = false;
    constructor() { }
    static connect(params) {
        return new Promise((resolve, reject) => {
            const client = new Client();
            const wire = new SshPtyWire();
            wire.client = client;
            // V0.5.0: built before `fail` so a refused key can be reported with its
            // actual fingerprint instead of ssh2's generic verification error.
            const guard = createHostKeyGuard({
                host: params.host,
                port: params.port,
                fingerprint: params.hostFingerprint,
                storePath: params.knownHostsPath,
                onDecision: params.onHostKey,
            });
            let timer = setTimeout(() => {
                client.destroy();
                if (!wire.settled) {
                    wire.settled = true;
                    reject(new JumpServerError('CONNECTION_TIMEOUT', 'SSH connect timed out'));
                }
            }, params.connectTimeoutMs);
            const fail = (err) => {
                if (wire.settled) {
                    wire.fireError(err);
                    return;
                }
                wire.settled = true;
                clearTimeout(timer);
                // A refused host key must never be reported as "wrong password" — the
                // two call for completely different operator responses.
                const decision = guard.last();
                if (decision !== undefined && !decision.accept) {
                    reject(new JumpServerError('HOST_KEY_MISMATCH', 'JumpServer host key verification failed', describeHostKeyRefusal(decision)));
                    return;
                }
                const code = AUTH_FAILED_PATTERN.test(err.message)
                    ? 'AUTH_FAILED'
                    : 'CONNECTION_LOST';
                reject(new JumpServerError(code, code === 'AUTH_FAILED' ? 'JumpServer authentication failed' : 'SSH connection failed', err.message));
            };
            client.on('error', fail);
            client.on('close', () => {
                wire.fireClose();
            });
            client.on('ready', () => {
                client.shell({ term: 'xterm', cols: 160, rows: 50 }, (err, stream) => {
                    if (err !== undefined) {
                        fail(new Error(err.message));
                        return;
                    }
                    if (wire.settled) {
                        stream.end();
                        return;
                    }
                    wire.settled = true;
                    clearTimeout(timer);
                    wire.stream = stream;
                    stream.on('data', (buf) => {
                        const text = buf.toString('utf8');
                        for (const cb of wire.dataCbs)
                            cb(text);
                    });
                    stream.on('error', (e) => wire.fireError(e));
                    stream.on('close', () => wire.fireClose());
                    resolve(wire);
                });
            });
            client.connect({
                host: params.host,
                port: params.port,
                username: params.username,
                password: params.password,
                readyTimeout: params.connectTimeoutMs,
                keepaliveInterval: 10000,
                keepaliveCountMax: 3,
                hostVerifier: guard.verifier,
                // V0.5.0: the previous `algorithms.serverHostKey` override listed RSA
                // variants only, so any bastion offering just an ed25519 or ecdsa host
                // key failed to negotiate. kex / cipher / MAC were already at library
                // defaults; dropping this override restores the full modern set on all
                // four axes instead of pinning one of them to a subset.
            });
        });
    }
    write(text) {
        this.stream?.write(text);
    }
    onData(cb) {
        this.dataCbs.add(cb);
    }
    onError(cb) {
        this.errorCbs.add(cb);
    }
    onClose(cb) {
        this.closeCbs.add(cb);
    }
    close() {
        try {
            this.stream?.end();
        }
        catch {
            /* already closed */
        }
        try {
            this.client?.end();
        }
        catch {
            /* already closed */
        }
        this.fireClose();
    }
    fireError(err) {
        for (const cb of [...this.errorCbs])
            cb(err);
    }
    fireClose() {
        for (const cb of [...this.closeCbs])
            cb();
    }
}
export { JumpServerError };

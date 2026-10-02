import { JumpServerError } from './errors.js';
import { type HostKeyDecision } from './host-key.js';
/** Testable wire seam: everything the session core needs from the transport. */
export interface Wire {
    write(text: string): void;
    onData(cb: (chunk: string) => void): void;
    onError(cb: (err: Error) => void): void;
    onClose(cb: () => void): void;
    close(): void;
}
export interface WireConnectParams {
    host: string;
    port: number;
    username: string;
    password: string;
    connectTimeoutMs: number;
    /** V0.5.0: operator-pinned SHA256/MD5 host-key fingerprint (optional). */
    hostFingerprint?: string;
    /** V0.5.0: known_hosts store path — enables TOFU when no fingerprint is pinned. */
    knownHostsPath?: string;
    /** V0.5.0: notified for every host-key decision (audit / diagnostics). */
    onHostKey?: (decision: HostKeyDecision) => void;
}
/**
 * Live ssh2 adapter: one SSH connection with one interactive PTY shell.
 * The entire JumpServer session (menu -> asset -> commands) reuses this
 * single channel; nothing reconnects per command.
 *
 * V0.5.0: the handshake now verifies the bastion's host key before the
 * password is transmitted (see host-key.ts).
 */
export declare class SshPtyWire implements Wire {
    private client?;
    private stream?;
    private dataCbs;
    private errorCbs;
    private closeCbs;
    private settled;
    private constructor();
    static connect(params: WireConnectParams): Promise<SshPtyWire>;
    write(text: string): void;
    onData(cb: (chunk: string) => void): void;
    onError(cb: (err: Error) => void): void;
    onClose(cb: () => void): void;
    close(): void;
    private fireError;
    private fireClose;
}
export { JumpServerError };

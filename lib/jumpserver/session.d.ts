import { type Wire } from './client.js';
import { SessionState } from './state-machine.js';
export interface WireFactory {
    (params: {
        host: string;
        port: number;
        username: string;
        password: string;
        connectTimeoutMs: number;
        /** V0.5.0: pinned SSH host-key fingerprint (optional). */
        hostFingerprint?: string;
        /** V0.5.0: known_hosts store for TOFU. */
        knownHostsPath?: string;
    }): Promise<Wire>;
}
export interface SessionRuntimeConfig {
    host: string;
    port: number;
    username: string;
    password: string;
    /** Test seam: replaces the real ssh2 transport. */
    wireFactory?: WireFactory;
    connectTimeoutMs: number;
    /** V0.5.0: pinned SSH host-key fingerprint; when set, only a match is accepted. */
    hostFingerprint?: string;
    /** V0.5.0: known_hosts store for TOFU when no fingerprint is pinned. */
    knownHostsPath?: string;
    enterAssetMs: number;
    probeMs: number;
    commandMs: number;
    leaveMs: number;
    /** Bounded wait for the KoKo menu to settle after the 'p' asset-list command. */
    listAssetsMs: number;
}
export interface SessionCallbacks {
    onStateChange?: (state: SessionState) => void;
    /**
     * Emitted for every text the connector presents to the USER as a typed
     * command (the raw target line, the raw exec command, exit). Internal
     * protocol scripts (probe/done helpers, __dsh_rc) never surface here —
     * the browser mirror records them as wire noise, not as user input.
     */
    onInput?: (text: string) => void;
    /**
     * Emitted for EVERY raw PTY output chunk as it arrives (echo included).
     * This is the realtime mirror source: the observer records chunks here,
     * so the browser displays actual server stdout, not connector inputs.
     */
    onOutput?: (chunk: string) => void;
    /** Emitted once the target probe verified the asset (hostname/user/pwd known). */
    onTarget?: (target: string, hostname: string | null, user: string | null, pwd: string | null) => void;
    onLost?: () => void;
    onLog?: (message: string) => void;
}
export interface SessionStatus {
    state: SessionState;
    gateway: string;
    target: string | null;
    hostname: string | null;
    user: string | null;
    pwd: string | null;
    connectedAt: number | null;
    lastActivityAt: number | null;
    reconnectCount: number;
}
/**
 * V0.4.3: what actually happened to the COMMAND, as opposed to whether the
 * transport delivered a completion marker.
 *
 * `executionState: 'COMPLETED'` only means "the completion marker came back
 * normally". A command that exits 127 (`jps: command not found`) is a
 * COMPLETED execution with a FAILED command. Reporting it as ok=true hid real
 * failures from the model, the console audit and any PASS/FAIL judgement.
 */
export type CommandStatus = 'SUCCESS' | 'EXIT_NONZERO' | 'TIMEOUT' | 'INTERRUPTED' | 'CONNECTION_LOST' | 'UNKNOWN';
export type ExecOutcome = {
    kind: 'completed';
    exitCode: number;
    commandStatus: 'SUCCESS' | 'EXIT_NONZERO';
    output: string;
    truncated: boolean;
    durationMs: number;
    executionState: 'COMPLETED';
} | {
    kind: 'timeout';
    commandStatus: 'TIMEOUT' | 'UNKNOWN';
    output: string;
    truncated: boolean;
    durationMs: number;
    executionState: 'TIMEOUT' | 'UNKNOWN';
} | {
    kind: 'signal-lost';
    commandStatus: 'CONNECTION_LOST';
    output: string;
    durationMs: number;
    executionState: 'UNKNOWN';
};
export interface ExecOptions {
    timeoutMs?: number;
    signal?: AbortSignal;
}
/**
 * One persistent JumpServer session: a single SSH/PTY transport whose logical
 * state is tracked by {@link SessionState}. Transport host (gateway) and the
 * current asset target are kept strictly separate. Never guesses: ambiguity
 * collapses to UNKNOWN and every operation throws instead of acting.
 */
export declare class JumpServerSession {
    private readonly cfg;
    private readonly callbacks;
    private wire;
    private wireClosed;
    private stateValue;
    private detector;
    private opWatcher;
    /** While non-null, every raw chunk feeds this bounded, ANSI-stripped capture (listAssets). */
    private menuCapture;
    private menuCaptureTruncated;
    /**
     * Capture-local payload timestamps (V0.2.5 P0): the quiet timer for the
     * asset list runs from the LAST VALID ASSET PAYLOAD byte, never from the
     * whole session's lastActivityAt and never from the bare 'p' echo — the
     * echo used to start the 800ms timer before KoKo began printing the table,
     * cutting the 171-asset capture down to "p
  ".
     */
    private menuCapturePayloadAt;
    private menuCaptureLastPayloadAt;
    /**
     * V0.5.5 fail-fast cache: target -> "the bastion could not dial this asset
     * until <timestamp>, KoKo said <reason>". Deliberately NOT cleared on
     * reconnect: the gateway being re-established says nothing about the asset's
     * network path, which is the thing that actually failed.
     */
    private unreachable;
    /**
     * V0.5.6: set while the session is parked on KoKo's `ID>` account-selection
     * prompt — i.e. after ACCOUNT_SELECTION_REQUIRED, until the caller answers.
     *
     * The session deliberately STAYS LIVE there instead of collapsing to UNKNOWN.
     * Collapsing was meant to be fail-closed, but it broke the only way to answer:
     * `requireLiveSession()` / `ensureConnectedLocked()` refuse a non-live
     * session, so the very next call — the one carrying the `accountIndex` the
     * connector had just asked for — was rejected with CONNECTION_LOST. The
     * caller had no choice but to reconnect (fresh SSH handshake + fresh menu)
     * before it could answer a prompt on a PTY that was never dead.
     *
     * Real transcript (2026-09-14, console pid 36612), 3m56s for one dead asset:
     *
     *   enter(no session)     CONNECTION_LOST
     *   connect               ok
     *   enter                 ACCOUNT_SELECTION_REQUIRED   <- prompt raised
     *   enter(accountIndex=1) CONNECTION_LOST              <- answer refused
     *   connect               (reconnect, second SSH dial)
     *   enter(accountIndex=1) ASSET_UNREACHABLE            <- the real failure
     *
     * `pendingAccountChoice` removes the detour: the second call answers the
     * prompt that is already painted, and only then does KoKo dial the asset.
     *
     * Never auto-picked — only an explicit `accountIndex` answers this prompt.
     */
    private pendingAccountChoice;
    currentTarget: string | null;
    currentHostname: string | null;
    currentUser: string | null;
    currentPwd: string | null;
    connectedAt: number | null;
    lastActivityAt: number | null;
    reconnectCount: number;
    constructor(cfg: SessionRuntimeConfig, callbacks?: SessionCallbacks);
    get state(): SessionState;
    /** True while in a state where PTY commands may be meaningful. */
    isLive(): boolean;
    hasPendingOp(): boolean;
    /**
     * V0.5.6: true when this session is LIVE on KoKo's `ID>` prompt for `target`
     * and the caller is now supplying the `accountIndex` it asked for. Only then
     * may a caller skip the "must be at the menu" precondition: the target line
     * was already written, the numbered list is still painted, and the only byte
     * missing is the chosen ID.
     *
     * The live-session requirement is what fails closed — if KoKo timed the
     * selection out, the transport died, or the session moved on, this returns
     * false and the normal preconditions apply (reconnect and re-enter).
     */
    canResumeAccountSelection(target: string, accountIndex?: number): boolean;
    /** V0.5.6: a previous call left this session waiting on KoKo's `ID>` prompt for `target`. */
    private parkedOnAccountPrompt;
    status(): SessionStatus;
    connect(signal?: AbortSignal): Promise<void>;
    /**
     * Enter a target asset through the JumpServer KoKo menu.
     *
     * @param target       Asset IP or name (must already exist on the menu).
     * @param accountIndex The account ID displayed by KoKo on the `ID>` selection
     *                    screen. Required only when the target has more than one
     *                    authorised bastion user — KoKo paints a numbered list
     *                    ending in `ID>` and waits. The value passed here is the
     *                    number shown on that screen (usually 1 or 2), NOT a
     *                    0-based array position. When omitted on a multi-user
     *                    asset this throws ACCOUNT_SELECTION_REQUIRED with the
     *                    parsed account list in `detail`. Single-user assets
     *                    auto-login and ignore this argument.
     * @param signal       Abort signal (the menu-loop polls every ~120ms).
     */
    enter(target: string, accountIndex?: number, signal?: AbortSignal): Promise<void>;
    exec(command: string, options?: ExecOptions): Promise<ExecOutcome>;
    /**
     * V0.4.0 P0: out-of-band interrupt. Writes Ctrl+C straight to the PTY
     * WITHOUT taking the operation queue, so it reaches the remote shell even
     * while a command (or a whole batch) is still in flight. Used by
     * jumpserver_interrupt and by the console's 中断 button.
     */
    sendInterrupt(): boolean;
    /**
     * Interrupt whatever the remote shell is doing, then re-prove the shell.
     * The connector only returns to ASSET_SHELL when a probe actually answers.
     * V0.4.4: a thin wrapper around interruptAndVerify() so there is exactly
     * ONE place that combines Ctrl+C with re-probe.
     */
    interrupt(budgetMs?: number): Promise<{
        sent: boolean;
        verified: boolean;
        state: SessionState;
    }>;
    /**
     * V0.4.4: the ONLY public path that combines Ctrl+C with a probe. Stops
     * a streaming job / out-of-band interrupt / exec recovery all funnel
     * through here so the connector never sends ^C twice and never declares
     * the shell usable without a fresh probe.
     */
    interruptAndVerify(budgetMs?: number): Promise<{
        sent: boolean;
        verified: boolean;
        state: SessionState;
    }>;
    /**
     * V0.4.4: prove the shell is at a prompt WITHOUT sending another Ctrl+C.
     * Use this when the caller already knows the foreground job has been
     * interrupted (e.g. JobStore.stop -> the previous interruptAndVerify
     * step cleared the queue; re-probing must NOT send ^C again).
     */
    verifyShell(budgetMs?: number): Promise<boolean>;
    /**
     * Raw write for the streaming job model (tail -f / journalctl -f / top):
     * the line is sent as-is, with NO completion marker and NO state wait —
     * output is collected from the observer stream instead.
     */
    writeLine(text: string): boolean;
    leave(signal?: AbortSignal): Promise<void>;
    /**
     * List every asset the account is authorized for (KoKo menu command 'p').
     * Display-only: 'p' prints the list and returns to the same menu, so the
     * PTY state NEVER changes ownership here. Captures the screen for a bounded
     * window, stopping once output goes quiet (the list finished painting) or
     * the deadline passes. If the captured tail smells like an interactive
     * pager the session is collapsed to UNKNOWN so the next navigation
     * reconnects instead of typing into the pager.
     */
    listAssets(timeoutMs?: number, signal?: AbortSignal): Promise<{
        text: string;
        truncated: boolean;
        paged: boolean;
        payload: boolean;
        footerComplete: boolean;
        reportedTotal: number | null;
    }>;
    close(): Promise<void>;
    touch(): void;
    /** Debug aid: last normalized screen tail (never contains secrets). */
    screenTail(n?: number): string;
    private attach;
    private onData;
    private onWireClose;
    private waitForScreen;
    private screenFor;
    /** Run one script and watch for its marker; bounded capture, cancellable. */
    private runOp;
    /**
     * V0.4.4: ^C + re-probe. The single V0.4.0→V0.4.3 entry point for exec
     * recovery (timeout / abort) and any other path that MUST interrupt a
     * possibly running remote job before declaring the shell usable again.
     * Splits the V0.4.3 recoverShell() into a pure probe (probeShellOnly)
     * plus this ^C wrapper so callers that have already interrupted can
     * re-probe WITHOUT sending a second Ctrl+C.
     */
    private interruptAndRecover;
    /**
     * V0.4.4: prove the shell answers a probe WITHOUT touching the wire.
     * Waits for the asset-shell prompt, runs the connector-internal probe,
     * parses the H=/U=/P= answer. Returns false when the wire is gone, the
     * prompt never arrived, the probe did not match, or the parser failed.
     * Pure side-effect-free test of "can I trust this session again".
     */
    private probeShellOnly;
    /**
     * V0.4.3: apply the outcome of an out-of-band verification (job stop).
     * recoverShell proves the shell answers a probe; the caller must then move
     * the state machine to match, or the session keeps reporting its stale
     * COMMAND_RUNNING / UNKNOWN state.
     */
    setStateForVerification(state: 'ASSET_SHELL' | 'UNKNOWN'): void;
    private assertState;
    private setState;
    /**
     * V0.5.5: leave the session in a state that is ACTUALLY true after a failed
     * asset entry.
     *
     * When KoKo cannot dial the asset it prints the reason and re-paints its own
     * menu prompt one line below, so the bastion session is intact and every
     * other asset is still one `enter()` away. Collapsing to UNKNOWN there was a
     * lie with a price: the next call needed a full reconnect (fresh SSH
     * handshake ~14 s + a fresh asset-list capture), and the model — seeing
     * `state: UNKNOWN` — had no way to know the difference between "dead
     * session" and "one bad asset". Real transcript: 8 enter/connect cycles,
     * 2m53s, all of it avoidable.
     *
     * The check is tail-anchored and positive (see looksLikeMenuPrompt), and it
     * deliberately does NOT accept an `ID>` prompt: answering that prompt with an
     * asset name would be read as an account choice. No prompt → UNKNOWN, as
     * before. A dead transport is DISCONNECTED, which is what it is.
     */
    private recoverAfterFailedEnter;
    private teardownTransport;
}
export declare const MAX_COMMAND_SECONDS = 600;

/** The harness home directory. */
export declare function harnessHome(): string;
/** Root of jump server plugin state: <dsh home>/jumpserver */
export declare function jumpHomeRoot(): string;
/** TOFU / pinned SSH host-key store (default when knownHostsPath is unset). */
export declare function jumpHomeKnownHosts(): string;
/** Console discovery file with the public loopback URL only. */
export declare function jumpHomeConsole(): string;
/** Boot marker: proves the Host half activated, even if the console later fails. */
export declare function jumpHomeBootMarker(): string;
/** Browser-half activation trace (JSON lines). */
export declare function jumpHomeClientTrace(): string;
/** Directory holding named baselines (<name>.json). */
export declare function jumpHomeBaselines(): string;

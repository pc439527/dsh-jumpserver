import type { BridgeServices } from '../bridge/bridge.js';
/**
 * Stable Desktop sidebar port; the right-column URL must survive restarts.
 *
 * 8766 rather than the more common 8765, so this console can run side by side
 * with other local tools.
 */
export declare const DEFAULT_CONSOLE_PORT = 8766;
export interface ConsoleHandle {
    port: number;
    /** Host-internal diagnostic value. Never serialize or log this field. */
    token: string;
    /** Stable public loopback address. Session selection belongs in a URL fragment. */
    urlFor(sessionId: string | undefined): string;
    /** True when the preferred port was taken and the OS chose one. */
    usingFallbackPort: boolean;
    close(): Promise<void>;
}
export interface ConsoleOptions {
    /** Defaults to the stable DSH Desktop loopback port. Use 0 only in tests. */
    port?: number;
}
export declare function startConsoleServer(services: BridgeServices, options?: ConsoleOptions): Promise<ConsoleHandle>;

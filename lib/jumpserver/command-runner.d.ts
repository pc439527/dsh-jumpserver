import { randomHex } from './timing.js';
export declare const DONE_PREFIX = "__DSH_JS_DONE_";
export declare const PROBE_PREFIX = "__DSH_JS_PROBE_";
/** Build the script that runs command and prints a unique done marker with its exit code. */
export declare function buildDoneScript(command: string, marker: string): string;
/** Build the target-probe script: labeled H=/U=/P= lines between unique markers. */
export declare function buildProbeScript(marker: string): string;
export declare const PROBE_END_PREFIX = "__DSH_JS_PROBE_END_";
/** Parse the done marker's exit code from captured output; null while absent. */
export declare function parseDoneLine(text: string, marker: string): {
    exitCode: number;
} | null;
/** Strip marker lines, internal script lines and trailing whitespace for user-facing output. */
export declare function cleanCommandOutput(raw: string, marker: string): string;
export { randomHex };

export interface ProbeInfo {
    hostname: string | null;
    user: string | null;
    pwd: string | null;
}
export { buildProbeScript } from './command-runner.js';
/**
 * Parse the labeled probe output between the start and end markers:
 *   __DSH_JS_PROBE_<m>
 *   H=hostname
 *   U=user
 *   P=pwd
 *   __DSH_JS_PROBE_END_<m>
 * Robust to command echo, continuation prompts and banner noise: values are
 * found by their labels, not by line position.
 */
export declare function parseProbeOutput(raw: string, marker: string): ProbeInfo | null;

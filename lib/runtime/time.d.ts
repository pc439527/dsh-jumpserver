/**
 * Audit/display timezone (V0.4.0).
 *
 * Storage stays UTC — audit records must remain comparable across hosts and
 * must never be rewritten. Only the DISPLAY layer converts, using the
 * configured IANA zone (`timeZone` in config.json, default Asia/Shanghai).
 */
export declare const DEFAULT_TIME_ZONE = "Asia/Shanghai";
/** Sentinel: use the MCP host's own zone instead of a fixed one. */
export declare const LOCAL_TIME_ZONE = "local";
/** Resolve the effective IANA zone for a config value ('local' => host zone). */
export declare function resolveTimeZone(configured?: string): string;
/** True when the zone is usable; an unknown IANA name must fall back, not throw. */
export declare function isValidTimeZone(timeZone: string): boolean;
/**
 * Render an ISO timestamp as 'YYYY-MM-DD HH:MM:SS' in the given zone.
 * Never throws: unparseable input falls back to the raw (UTC) string slice so
 * a display bug can never hide an audit record.
 */
export declare function formatAuditTime(value: unknown, timeZone: string): string;

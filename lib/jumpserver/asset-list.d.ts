/**
 * KoKo 'p' asset-list parsing (V0.2.3 P1, V0.2.4 P0, V0.2.5 P0): the menu
 * command p prints every asset the account is authorized for. This module
 * turns the raw captured screen text into structured rows and applies a local
 * substring filter — the model asks "which OA servers exist?" and the plugin
 * answers without ever typing an asset name back into the PTY (typing a
 * unique name in KoKo would auto-login, changing the session state; p is
 * strictly display-only).
 *
 * The exact table layout differs between KoKo versions: the classic layout
 * pads columns with wide runs of spaces ("1  OA-APP-01  203.0.113.101  生产区"),
 * while newer KoKo versions render a pipe table
 * ("151 | s113181_BI节点2 | 203.0.113.181 | Linux | 示例单位"). The row
 * splitter prefers the pipe format when a pipe is present and falls back to
 * wide-space alignment otherwise.
 *
 * Parse health (V0.2.4 P0): the result distinguishes "no assets", "capture
 * produced nothing", and "capture present but the parser did not understand
 * it". A parser failure must NEVER be reported as an empty authorized list —
 * the model would wrongly conclude the account has no servers.
 */
export interface AssetEntry {
    /** The row number KoKo printed (null when the line had none). */
    index: number | null;
    /** Best-effort display name (hostname or "name" token). */
    name: string;
    /** IPv4-ish token when present. */
    ip: string | null;
    /** Platform/OS column (pipe-table format, e.g. "Linux"). */
    platform: string | null;
    /** Node/location column (pipe-table tail, e.g. "示例单位"). */
    node: string | null;
    /** Everything after the name/ip in the whitespace layout (comment/node info). */
    comment: string | null;
    /** The normalized source line (ANSI stripped). */
    raw: string;
}
/** Why the parsed list is empty/incomplete. 'ok' = parse healthy. */
export type AssetHealth = 'ok' | 'ASSET_LIST_EMPTY' | 'ASSET_PARSE_FAILED' | 'ASSET_CAPTURE_TIMEOUT' | 'ASSET_CAPTURE_INCOMPLETE';
export interface AssetListResult {
    assets: AssetEntry[];
    /** True when the captured text was capped (list longer than the capture budget). */
    truncated: boolean;
    /** True when the captured tail suggests the list is paged (view it as incomplete). */
    paged: boolean;
    /** The normalized captured text (bounded; useful for ambiguous rows). */
    rawText: string;
    /** Number of numbered (row-shaped) lines found in the capture. */
    rawRows: number;
    /** Number of rows successfully parsed (BEFORE the local filter is applied). */
    parsedRows: number;
    /** KoKo footer: 页码 (page). null when the capture has no footer. */
    page: number | null;
    /** KoKo footer: 每页行数 (rows per page). null when the capture has no footer. */
    pageSize: number | null;
    /** KoKo footer: 总页数 (total pages). null when the capture has no footer. */
    totalPages: number | null;
    /** KoKo footer: 总数量 (total asset count). null when the capture has no footer. */
    reportedTotal: number | null;
    /** True when KoKo painted the footer AND returned to the menu prompt: the whole list finished printing. */
    complete: boolean;
    /**
     * Parse-health classification (V0.2.5 taxonomy):
     *  - ASSET_CAPTURE_TIMEOUT     no output captured at all (nothing to parse);
     *  - ASSET_CAPTURE_INCOMPLETE  output captured but it is only the p echo /
     *                              lone menu prompt — no asset payload arrived;
     *  - ASSET_PARSE_FAILED        asset payload present but the parser could
     *                              not understand any row;
     *  - ASSET_LIST_EMPTY          KoKo CONFIRMED an empty account (footer
     *                              总数量 0 or an explicit no-asset notice);
     *  - ok                        rows parsed and (when a footer exists) the
     *                              captured count matches the parse, or no
     *                              footer was produced by this KoKo version.
     * Only 'ok' and a matching filter are safe to read as "these are the
     * account's servers".
     */
    health: AssetHealth;
}
/**
 * KoKo prints a list footer after the table (real 171-row capture):
 *   页码: 1
 *   每页行数: 171
 *   总页数: 1
 *   总数量: 171
 * The footer is the authoritative end-of-list marker: when it is present AND
 * the menu prompt is visible again, the capture is COMPLETE and the quiet
 * timer is only a fallback for KoKo versions without a footer.
 */
export interface AssetFooter {
    page: number | null;
    pageSize: number | null;
    totalPages: number | null;
    total: number | null;
}
/** Parse the KoKo list footer out of a captured screen; null fields when absent. */
export declare function parseFooter(text: string): AssetFooter;
/**
 * True when text contains ANY asset-list payload: a numbered/pipe row, the
 * footer block, the table header, or an explicit no-asset notice. The bare
 * 'p' echo and a lone "Opt> " prompt must NOT count (V0.2.5 P0: they used to
 * start the quiet timer before the real table arrived).
 */
export declare function hasPayloadEvidence(text: string): boolean;
/** True when the captured text ends with the KoKo menu prompt (the list finished). */
export declare function hasTrailingMenuPrompt(text: string): boolean;
/** KoKo footer confirmed AND the menu prompt is visible again: the list fully painted. */
export declare function footerComplete(text: string): boolean;
/** True when the text tail suggests a paged list ("--more--", "回车查看更多", ...). */
export declare function looksPaged(text: string): boolean;
/**
 * Apply a local case-insensitive substring filter across name/ip/platform/
 * node/comment. Returns [] when the filter matches nothing (the model sees an
 * empty authorized list FOR THAT TERM, never a wrong row). Parsing health is
 * unaffected by filtering.
 */
export declare function filterAssets(assets: AssetEntry[], filter?: string): AssetEntry[];
/**
 * V0.2.6: OR-match every keyword of a system asset group across
 * name/ip/platform/node/comment. "OA" with keywords ["OA","portal","workflow",
 * "办公"] therefore returns portal-nginx / workflow-app02 etc. — not just
 * literal "OA" strings. Empty keyword list matches nothing.
 */
export declare function filterAssetsByGroup(assets: AssetEntry[], keywords: readonly string[]): AssetEntry[];
/**
 * V0.2.6: resolve a group NAME to its keyword list from the configured
 * assetGroups table (exact, case-insensitive). Returns null when no group
 * matches (caller should fail loudly — an unknown group is a config typo,
 * not "zero OA servers").
 */
export declare function resolveGroupKeywords(groups: Readonly<Record<string, {
    keywords?: readonly string[];
}>> | undefined, group: string | undefined | null): readonly string[] | null;
/**
 * Parse the normalized screen text a KoKo 'p' produced and apply a local
 * case-insensitive substring filter. `parsedRows` counts rows parsed BEFORE
 * filtering, so a non-matching filter is distinguishable from a parser that
 * did not understand the table (see {@link AssetListResult.health}).
 */
export declare function parseAssetList(text: string, filter?: string): AssetListResult;

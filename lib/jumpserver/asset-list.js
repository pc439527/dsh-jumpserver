const NUMBERED_LINE = /^\s*(\d+)[.)]?\s+(.+)$/;
const HEADER_LINE = /^(?:\s*(?:id|序号|编号|asset|资产|ip|host|主机|name|名称|comment|备注)\s*)+$/i;
const PROMPT_LINE = /opt\s*[>#]\s*$/i;
/** IPv4 (the common KoKo asset key). */
const IPV4 = /^(\d{1,3})(?:\.\d{1,3}){3}$/;
/** Heuristic: a line is menu decorations/chrome (box drawing, action hints). */
const NOISE_LINE = /[┌─┐│└┘├┤┬┴┼]|^(?:enter|input|search|connect|exit|登录|搜索|输入|退出|帮助|help)\b/i;
function isIp(token) {
    return IPV4.test(token);
}
const FOOTER_PAGE = /页码[:：]\s*(\d+)/;
const FOOTER_PAGE_SIZE = /每页行数[:：]\s*(\d+)/;
const FOOTER_TOTAL_PAGES = /总页数[:：]\s*(\d+)/;
const FOOTER_TOTAL = /总数量[:：]\s*(\d+)/;
/** Parse the KoKo list footer out of a captured screen; null fields when absent. */
export function parseFooter(text) {
    return {
        page: matchInt(FOOTER_PAGE, text),
        pageSize: matchInt(FOOTER_PAGE_SIZE, text),
        totalPages: matchInt(FOOTER_TOTAL_PAGES, text),
        total: matchInt(FOOTER_TOTAL, text),
    };
}
function matchInt(pattern, text) {
    const m = pattern.exec(text);
    if (m === null)
        return null;
    const n = Number(m[1]);
    return Number.isInteger(n) ? n : null;
}
/** KoKo explicit "no assets" notices — the ONLY legitimate LIST_EMPTY evidence. */
const EMPTY_LIST_MARKER = /无资产|没有(?:任何|可用)?\s*资产|暂无(?:任何)?\s*资产|无可用资产|暂无可连接资产|no\s+assets?\b/i;
/** The menu prompt a KoKo terminal prints after an action (incl. the p reply).
 *  V0.2.6: real KoKo deployments print "[Host]> " (type the node name into the
 *  menu), so accept bracketed host prompts alongside the legacy "Opt> ". */
const MENU_PROMPT_LINE = /^\s*(?:\[[A-Za-z0-9._-]+\]\s*[>#]|opt\s*[>#]|请输入[^\n]*[:：])\s*$/i;
const ASSET_HEADER_LINE = /^(?:\s*(?:id|序号|编号|asset|资产|ip|host|主机|name|名称|comment|备注)\s*)+$/i;
// A numbered row: "1  OA-APP-01 ..." or "151 | s079181_..." (any-width index).
const PAYLOAD_ROW = /^\s*\d+[.)]?\s+(?:\S|\|)/m;
const PAYLOAD_PIPE_ROW = /^\s*\d+\s*\|/m;
/**
 * True when text contains ANY asset-list payload: a numbered/pipe row, the
 * footer block, the table header, or an explicit no-asset notice. The bare
 * 'p' echo and a lone "Opt> " prompt must NOT count (V0.2.5 P0: they used to
 * start the quiet timer before the real table arrived).
 */
export function hasPayloadEvidence(text) {
    return (PAYLOAD_ROW.test(text) ||
        PAYLOAD_PIPE_ROW.test(text) ||
        ASSET_HEADER_LINE.test(text) ||
        EMPTY_LIST_MARKER.test(text) ||
        FOOTER_PAGE.test(text) ||
        FOOTER_PAGE_SIZE.test(text) ||
        FOOTER_TOTAL_PAGES.test(text) ||
        FOOTER_TOTAL.test(text));
}
/** True when the captured text ends with the KoKo menu prompt (the list finished). */
export function hasTrailingMenuPrompt(text) {
    const tail = text.trimEnd();
    if (tail.length === 0)
        return false;
    const lastLine = tail.split(/\r?\n/).pop() ?? '';
    return MENU_PROMPT_LINE.test(lastLine);
}
/** KoKo footer confirmed AND the menu prompt is visible again: the list fully painted. */
export function footerComplete(text) {
    return parseFooter(text).total !== null && hasTrailingMenuPrompt(text);
}
/**
 * Split a numbered line's body into aligned columns. Pipe tables win: when
 * the body contains '|', split on it first (AVOIDING the wide-space rule,
 * because pipe tables may keep narrow gaps between columns). Otherwise split
 * on the raw alignment runs; collapsing whitespace before splitting would
 * destroy the column delimiters.
 */
function columns(body) {
    const trimmed = body.trim();
    if (trimmed.includes('|')) {
        const pipe = trimmed
            .split('|')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
        if (pipe.length > 0)
            return pipe;
    }
    return body
        .split(/\s{2,}/)
        .map((c) => c.trim())
        .filter((c) => c.length > 0);
}
function tailEntry(index, name, ip, tail, raw, pipeForm) {
    if (pipeForm) {
        // pipe layout: index | name | ip | platform | node ...
        const platform = tail[0] ?? null;
        const node = tail.length > 1 ? tail.slice(1).join(' ') : null;
        return { index, name, ip, platform, node, comment: null, raw };
    }
    // whitespace layout: name  ip  comment/node ...
    return { index, name, ip, platform: null, node: null, comment: tail.length > 0 ? tail.join(' ') : null, raw };
}
function entryFrom(index, body) {
    const raw = body;
    if (HEADER_LINE.test(raw))
        return null;
    if (PROMPT_LINE.test(raw))
        return null;
    if (NOISE_LINE.test(raw))
        return null;
    const pipeForm = raw.includes('|');
    const cols = columns(raw);
    if (cols.length === 0)
        return null;
    const first = cols[0];
    if (isIp(first)) {
        const name = cols[1] ?? first;
        return tailEntry(index, name, first, cols.slice(2), raw, pipeForm);
    }
    // First non-IP token is treated as the name; a later IPv4 token becomes the ip.
    const ipIndex = cols.findIndex(isIp);
    if (ipIndex > 0) {
        const name = cols.slice(0, ipIndex).join(' ');
        return tailEntry(index, name, cols[ipIndex], cols.slice(ipIndex + 1), raw, pipeForm);
    }
    return { index, name: first, ip: null, platform: null, node: null, comment: cols.length > 1 ? cols.slice(1).join(' ') : null, raw };
}
/** True when the text tail suggests a paged list ("--more--", "回车查看更多", ...). */
export function looksPaged(text) {
    const tail = text.slice(-1200);
    return /(?:more|更多|翻页|回车|space|enter\s+(?:查看|显示)|--more|--\s*更多)/i.test(tail);
}
/** The filter haystack: every field the model may reasonably search on. */
function haystackOf(entry) {
    return [entry.name, entry.ip, entry.platform, entry.node, entry.comment].filter((v) => v !== null && v !== undefined).join(' ');
}
/**
 * Apply a local case-insensitive substring filter across name/ip/platform/
 * node/comment. Returns [] when the filter matches nothing (the model sees an
 * empty authorized list FOR THAT TERM, never a wrong row). Parsing health is
 * unaffected by filtering.
 */
export function filterAssets(assets, filter) {
    const term = filter?.trim();
    if (term === undefined || term.length === 0)
        return assets;
    const lower = term.toLowerCase();
    return assets.filter((entry) => haystackOf(entry).toLowerCase().includes(lower));
}
/**
 * V0.2.6: OR-match every keyword of a system asset group across
 * name/ip/platform/node/comment. "OA" with keywords ["OA","portal","workflow",
 * "办公"] therefore returns portal-nginx / workflow-app02 etc. — not just
 * literal "OA" strings. Empty keyword list matches nothing.
 */
export function filterAssetsByGroup(assets, keywords) {
    const terms = keywords.map((k) => k.trim()).filter((k) => k.length > 0);
    if (terms.length === 0)
        return [];
    const lowers = terms.map((t) => t.toLowerCase());
    return assets.filter((entry) => {
        const hay = haystackOf(entry).toLowerCase();
        return lowers.some((l) => hay.includes(l));
    });
}
/**
 * V0.2.6: resolve a group NAME to its keyword list from the configured
 * assetGroups table (exact, case-insensitive). Returns null when no group
 * matches (caller should fail loudly — an unknown group is a config typo,
 * not "zero OA servers").
 */
export function resolveGroupKeywords(groups, group) {
    if (group === undefined || group === null)
        return null;
    const name = group.trim();
    if (name.length === 0)
        return null;
    const lower = name.toLowerCase();
    for (const [key, def] of Object.entries(groups ?? {})) {
        if (key.toLowerCase() === lower)
            return def?.keywords ?? [];
    }
    return null;
}
/**
 * Parse the normalized screen text a KoKo 'p' produced and apply a local
 * case-insensitive substring filter. `parsedRows` counts rows parsed BEFORE
 * filtering, so a non-matching filter is distinguishable from a parser that
 * did not understand the table (see {@link AssetListResult.health}).
 */
export function parseAssetList(text, filter) {
    const lines = text
        .split(/\r?\n/)
        .map((l) => l.replace(/\s+$/g, ''))
        .filter((l) => l.trim().length > 0);
    const parsed = [];
    let rawRows = 0;
    for (const line of lines) {
        const numbered = NUMBERED_LINE.exec(line);
        if (numbered === null)
            continue;
        rawRows += 1;
        const index = Number(numbered[1]);
        const entry = entryFrom(index, numbered[2] ?? '');
        if (entry === null)
            continue;
        parsed.push(entry);
    }
    const rawText = text;
    const footer = parseFooter(rawText);
    const trimmed = rawText.trim();
    let health = 'ok';
    if (trimmed.length === 0) {
        health = 'ASSET_CAPTURE_TIMEOUT';
    }
    else if (!hasPayloadEvidence(rawText)) {
        // Only the p echo / a lone menu prompt was captured — KoKo never replied
        // with an asset payload. An echo is NOT "the account has no assets".
        health = 'ASSET_CAPTURE_INCOMPLETE';
    }
    else if (footer.total === 0 || EMPTY_LIST_MARKER.test(rawText)) {
        // Confirmed empty: KoKo's own footer says 总数量 0, or an explicit
        // no-asset notice. Nothing else may claim ASSET_LIST_EMPTY.
        health = 'ASSET_LIST_EMPTY';
    }
    else if (parsed.length === 0) {
        // Asset payload exists (rows and/or a footer claiming assets) but no row
        // parsed. The table format is not understood by the parser.
        health = 'ASSET_PARSE_FAILED';
    }
    return {
        assets: filterAssets(parsed, filter),
        truncated: false,
        paged: looksPaged(rawText),
        rawText,
        rawRows,
        parsedRows: parsed.length,
        page: footer.page,
        pageSize: footer.pageSize,
        totalPages: footer.totalPages,
        reportedTotal: footer.total,
        complete: footerComplete(rawText),
        health,
    };
}

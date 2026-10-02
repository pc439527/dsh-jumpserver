import { cleanAnsi } from './output-buffer.js';
const SHELL_PROMPT_PATTERN = /(?:^|\n)\[?[a-zA-Z0-9_.-]+(?:@[a-zA-Z0-9_.-]+)?[ :~\/\\][^\n]*[$#] ?$/m;
const NUMBERED_LINE_PATTERN = /(?:^|\n)\s*\d+[.)]\s+\S/m;
const BOX_PATTERN = /[\u2500-\u257F]/u;
const ACCOUNT_SELECTION_PROMPT = /(?:^|\n)\s*ID>[^\n]*/m;
const ACCOUNT_SELECTION_HEADER = /\[(?:Users|账号|用户|accounts?)\]|\b(?:账号|用户|accounts?|choose\s+account|select\s+account)\b/i;
/**
 * True when the tail looks like a real shell prompt (asset shell).
 */
function looksLikeShellPrompt(tail) {
    // Only inspect the last ~600 chars; a prompt is the final line.
    const window = tail.slice(-600);
    const lines = window.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 0)
        return false;
    const last = lines[lines.length - 1].trimEnd();
    if (last.length === 0 || last.length > 260)
        return false;
    // Prompt ends with '$' / '#' (bash family). Root '# ' also fine.
    if (!/[$#] ?$/.test(last))
        return false;
    return SHELL_PROMPT_PATTERN.test('\n' + window);
}
/**
 * True when the tail shows a JumpServer/KoKo terminal menu.
 */
function looksLikeMenu(tail) {
    const lower = tail.toLowerCase();
    const box = BOX_PATTERN.test(tail);
    const numbered = NUMBERED_LINE_PATTERN.test(tail);
    const idleHint = /idle\s*timeout/i.test(lower);
    const chineseMenu = /请输入|编号|资产名|菜单|选择|回车|退出/i.test(tail);
    const hostPrompt = /\b(?:input|search|connect)\b/i.test(lower);
    const exitHint = /(?:^|\n)\s*(?:\[?\s*0\s*\]?\s*)?(?:\(?exit\)?|退出)\s*(?:菜单|menu)?/i.test(tail);
    const koko = /koko|jumpserver|堡垒机|Opt[>#]\s/iy.test(tail) || /(?:^|\n)\s*(?:Opt|\[[A-Za-z0-9._-]+\])\s*[>#]\s/.test(tail);
    // Require a combination to avoid single-string false positives.
    const scores = [box, numbered, idleHint, chineseMenu].filter(Boolean).length;
    if (scores >= 2)
        return true;
    if (box && chineseMenu)
        return true;
    if (box && exitHint)
        return true;
    if (numbered && idleHint)
        return true;
    if (box && (koko || hostPrompt))
        return true;
    return false;
}
/**
 * V0.5.3: detect the KoKo multi-username selection screen (`ID>` + numbered
 * users list). Conservative by design — see {@link AccountSelectionResult}.
 *
 * KoKo has shipped at least two layouts:
 *   1) simple:  "0) admin", "1) ops", "ID>"
 *   2) table:   "ID | 名称 | 用户名", "1 | root | root", "2 | 手动输入 | @INPUT", "ID>"
 * Both are accepted; the parsed option.index is always the number KoKo prints.
 */
export function looksLikeAccountSelection(tail) {
    const window = tail.slice(-2048);
    if (!ACCOUNT_SELECTION_PROMPT.test('\n' + window)) {
        return { detected: false, options: [], preview: [] };
    }
    const lines = window.split('\n');
    const options = [];
    // Match both "1) root" and "1 | root | root" (the second/third columns are
    // pipe-separated). Capture the first non-ID column as the label.
    // V0.5.3.2: real KoKo pads CJK columns with full-width spaces (U+3000);
    // `\s` does NOT match U+3000 by default, so the rowPattern must accept
    // both half- and full-width whitespace or the table fails to parse even
    // though the prompt itself is detected.
    const rowPattern = /^[\s\u3000]*(\d+)(?:[\s\u3000]*[).][\s\u3000]+|[\s\u3000]*\|[\s\u3000]*)(.+?)(?:[\s\u3000]*\|.*)?$/;
    // Walk backwards from the prompt — the list is painted just above it.
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i];
        const m = rowPattern.exec(line);
        // V0.5.3.3: a non-row line ENDS the list once at least one row was seen.
        // Without this the scan walks past the table separator into KoKo's main
        // menu (also inside the 2048-char window) and swallows its "1)…11)" items,
        // so the contiguity check below rejects a perfectly valid account table.
        if (m === null) {
            if (options.length > 0 && line.trim() !== '')
                break;
            continue;
        }
        const idx = Number(m[1]);
        let label = (m[2] ?? '').trim();
        if (!Number.isFinite(idx) || label.length === 0)
            continue;
        // Strip a trailing table-cell padding pipe if the regex left it.
        label = label.replace(/\s*\|\s*$/, '').trim();
        if (label.length === 0)
            continue;
        // Stop scanning once we leave the list. Blank lines separate the list from
        // the header above; keep walking over them. A non-list, non-blank line ends
        // the list.
        if (options.length > 0 && line.trim() === '')
            continue;
        if (options.length > 0 && /^\s*[-|]+\s*$/.test(line)) {
            // Table separator line (---|---|---) sits between header and rows.
            continue;
        }
        if (options.length > 0 && !rowPattern.test(line))
            break;
        options.push({ index: idx, label });
        // Cap scan to keep detection bounded.
        if (options.length >= 32)
            break;
    }
    options.reverse();
    // Reject single-entry lists — KoKo auto-picks those, no `ID>` would appear.
    if (options.length < 2) {
        return { detected: false, options: [], preview: [] };
    }
    // Contiguity check: IDs must be N, N+1, N+2... (base can be 0 or 1).
    const base = options[0].index;
    for (let i = 0; i < options.length; i += 1) {
        if (options[i].index !== base + i) {
            return { detected: false, options: [], preview: [] };
        }
    }
    return {
        detected: true,
        options,
        preview: options.map((o) => o.index + ') ' + o.label),
    };
}
/**
 * V0.5.5: is the session sitting AT a KoKo prompt right now?
 *
 * After a failed asset dial KoKo prints the reason one line above its own
 * prompt and the menu is usable again:
 *
 *   开始连接到 root(root)@10.0.0.10 error: 网络不通（连接超时）
 *   [Host]> _
 *
 * Whole-tail menu heuristics (looksLikeMenu) are the wrong tool for this
 * decision: the previous screen — the asset table, a numbered node list, the
 * `ID>` account list — is still inside the 8 KiB tail window, so a stale
 * "1) ..." row can outvote the live prompt. This checks the LAST non-blank
 * line only, which is where a prompt lives.
 *
 * `ID>` is deliberately EXCLUDED. At that prompt KoKo is waiting for an account
 * ID, and writing an asset name/IP into it is a real hazard (it would be read
 * as a choice, not as a navigation). Only the two navigation prompts — the
 * asset-list prompt `[Host]>` / `[<node>]>` and the main menu `Opt>` — count.
 */
const KOKO_NAV_PROMPT = /^(?:\[[A-Za-z0-9._-]+\]|Opt)>\s*$/;
export function looksLikeMenuPrompt(tail) {
    const lines = tail.split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        // Trailing cursor artefacts (`_`, `[K`) are stripped by cleanAnsi; a line
        // of pure whitespace is just padding before the prompt, keep walking.
        const line = lines[i].replace(/\s+$/, '');
        if (line.trim().length === 0)
            continue;
        return KOKO_NAV_PROMPT.test(line.trim());
    }
    return false;
}
/**
 * Heavy-screen detector: keeps a bounded normalized tail and answers
 * 'JUMPSERVER_MENU' vs 'ASSET_SHELL' vs unknown. Unbiased to any single
 * string; shell-prompt detection runs FIRST so a live shell never reads as
 * a menu.
 */
export class ScreenDetector {
    maxTail;
    tail = '';
    constructor(maxTail = 8192) {
        this.maxTail = maxTail;
    }
    push(chunk) {
        this.tail = (this.tail + cleanAnsi(chunk)).slice(-this.maxTail);
    }
    detect() {
        if (looksLikeShellPrompt(this.tail))
            return 'ASSET_SHELL';
        if (looksLikeMenu(this.tail))
            return 'JUMPSERVER_MENU';
        return undefined;
    }
    /** Debug aid: last N normalized chars, for fixture capture. */
    tailPreview(n = 400) {
        return this.tail.slice(-n);
    }
    reset() {
        this.tail = '';
    }
}

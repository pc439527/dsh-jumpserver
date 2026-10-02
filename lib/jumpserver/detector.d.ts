/** What the current screen looks like, per a bounded normalized tail. */
export type ScreenState = 'JUMPSERVER_MENU' | 'ASSET_SHELL' | undefined;
/** One option on a KoKo multi-username selection screen. */
export interface AccountSelectionOption {
    /**
     * The ID that KoKo shows and expects the operator to type (usually 1-based,
     * occasionally 0-based depending on the KoKo build). The connector writes this
     * exact value back to the PTY, so `accountIndex` in the public API maps 1:1
     * to the number on the screen.
     */
    index: number;
    /**
     * Raw label of the entry. For `) ` / `. ` rows it is everything after the
     * separator; for pipe-table rows it is the second column (the account name).
     */
    label: string;
}
/**
 * Result of parsing a KoKo "which user do you want to log in as?" screen.
 *
 * The screen appears when a target has MORE THAN ONE authorised bastion user
 * (e.g. admin / ops / root). KoKo prints the list with numbered entries and an
 * `ID>` prompt, then waits for the caller to type the displayed ID. The
 * connector MUST answer that prompt itself — never let it time out, never type
 * blindly into the next shell.
 *
 * V0.5.3: detection is conservative. We require ALL of:
 *   1. an `ID>` token near the tail (the input prompt),
 *   2. at least TWO numbered entries (a single entry would auto-pick),
 *   3. contiguous IDs in whatever base KoKo used (1,2,3... or 0,1,2...).
 * A false positive here would auto-pick an account on every asset entry, so
 * the threshold is intentionally strict.
 */
export interface AccountSelectionResult {
    detected: boolean;
    options: AccountSelectionOption[];
    /**
     * Short human-readable summary (`["1) root", "2) 手动输入"]`).
     * Surfaced in the `ACCOUNT_SELECTION_REQUIRED` error so the model can
     * pass the right `accountIndex` without re-querying the bastion.
     */
    preview: string[];
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
export declare function looksLikeAccountSelection(tail: string): AccountSelectionResult;
export declare function looksLikeMenuPrompt(tail: string): boolean;
/**
 * Heavy-screen detector: keeps a bounded normalized tail and answers
 * 'JUMPSERVER_MENU' vs 'ASSET_SHELL' vs unknown. Unbiased to any single
 * string; shell-prompt detection runs FIRST so a live shell never reads as
 * a menu.
 */
export declare class ScreenDetector {
    private readonly maxTail;
    private tail;
    constructor(maxTail?: number);
    push(chunk: string): void;
    detect(): ScreenState;
    /** Debug aid: last N normalized chars, for fixture capture. */
    tailPreview(n?: number): string;
    reset(): void;
}

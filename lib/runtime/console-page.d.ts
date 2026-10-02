/**
 * The console page, shipped as a string by the Host.
 *
 * Deliberately dependency-free: no CDN, no build step, no framework, so the
 * page can never drift from the server that serves it. Authentication stays in
 * an HttpOnly cookie, and conversation selection is read from the URL fragment,
 * which is never sent to the Host.
 */
export declare function consolePage(): string;

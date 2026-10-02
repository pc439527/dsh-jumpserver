/** Plain-settable delay; DSH-independent (timer cleanup happens via session close / abort checks). */
export declare function sleep(ms: number): Promise<void>;
/** Random uppercase-hex marker of len chars, e.g. A8F31C. */
export declare function randomHex(len: number): string;

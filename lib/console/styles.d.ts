/**
 * Console stylesheet, kept apart from the page so a colour change is not a
 * diff buried inside a 600-line template literal.
 *
 * String.raw for the same reason the page needs it: a plain template literal
 * would eat escape sequences in CSS content values.
 */
export declare const CONSOLE_STYLES: string;

/**
 * Parsing of per-block options written after the language in a fence's info string.
 *
 * The language must come first, because Joplin and most other Markdown renderers treat the first
 * word of the info string as the language. Options follow in any order. For example, these info
 * strings (the text after the opening fence) give:
 *
 * - `ts ln start=10`: numbered, starting at 10.
 * - `text ln`: numbered even when line numbers are off by default.
 * - `ts ln=false`: never numbered.
 * - `py title="utils/math.py"`: shows "utils/math.py" in the block's header.
 *
 * Unknown or malformed options are ignored so that info strings written for other tools keep
 * rendering normally.
 */

export type FenceInfo = {
    /** The first word of the info string, or an empty string when there is none. */
    language: string;
    /** `ln` or `ln=true` gives `true`, `ln=false` gives `false`, and no `ln` option gives `null`. */
    lineNumbers: boolean | null;
    /** The `start=N` option, or `null` when absent or not a non-negative integer. */
    lineNumberStart: number | null;
    /** The `title=...` option without its quotes, or `null` when absent or empty. */
    title: string | null;
};

export type LineNumbering = {
    enabled: boolean;
    /** The number shown on the block's first content line. */
    start: number;
};

/**
 * Matches one option: a bare `key`, `key=value`, or a quoted `key="a b"` / `key='a b'`.
 * For example, `ln start=10 title="my file.ts"` yields `ln`, `start=10` and `title="my file.ts"`.
 */
const OPTION_PATTERN = /([^\s=]+)(?:=("[^"]*"|'[^']*'|\S*))?/g;

/** Up to nine digits keeps `start` a safe integer with a gutter of sensible width. */
const START_VALUE_PATTERN = /^\d{1,9}$/;

function unquote(value: string): string {
    return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

export function parseFenceInfo(info: string): FenceInfo {
    const trimmed = info.trim();
    const languageEnd = trimmed.search(/\s/);
    const language = languageEnd < 0 ? trimmed : trimmed.slice(0, languageEnd);
    const options = languageEnd < 0 ? '' : trimmed.slice(languageEnd);

    let lineNumbers: boolean | null = null;
    let lineNumberStart: number | null = null;
    let title: string | null = null;

    for (const match of options.matchAll(OPTION_PATTERN)) {
        const key = match[1];
        const value = match[2] === undefined ? undefined : unquote(match[2]);

        if (key === 'ln') {
            if (value === undefined || value === 'true') {
                lineNumbers = true;
            } else if (value === 'false') {
                lineNumbers = false;
            }
        } else if (key === 'start' && value !== undefined && START_VALUE_PATTERN.test(value)) {
            lineNumberStart = Number(value);
        } else if (key === 'title' && value) {
            title = value;
        }
    }

    return { language, lineNumbers, lineNumberStart, title };
}

/**
 * Combines a block's options with the global setting. An explicit `ln` option always wins;
 * otherwise `start=N` turns numbering on, since asking for a start number implies wanting numbers.
 */
export function resolveLineNumbering(info: FenceInfo, enabledByDefault: boolean): LineNumbering {
    return {
        enabled: info.lineNumbers ?? (enabledByDefault || info.lineNumberStart !== null),
        start: info.lineNumberStart ?? 1,
    };
}

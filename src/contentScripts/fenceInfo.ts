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
 * - `ts hl=2,5-7`: highlights lines 2, 5, 6 and 7.
 *
 * Unknown or malformed options are ignored so that info strings written for other tools keep
 * rendering normally.
 *
 * Syntax is adapted from Code Block Numbers (https://github.com/haderlka/obsidian-code-block-numbers),
 * MIT License, Copyright (c) 2026 haderlka.
 *
 */

/** An inclusive range of displayed line numbers. */
type LineRange = {
    from: number;
    to: number;
};

export type FenceInfo = {
    /** The first word of the info string, or an empty string when there is none. */
    language: string;
    /** `ln` or `ln=true` gives `true`, `ln=false` gives `false`, and no `ln` option gives `null`. */
    lineNumbers: boolean | null;
    /** The `start=N` option, or `null` when absent or not a non-negative integer. */
    lineNumberStart: number | null;
    /** The `title=...` option without its quotes, or `null` when absent or empty. */
    title: string | null;
    /**
     * The `hl=...` option's line ranges, empty when absent. They refer to displayed line numbers,
     * so with `start=10`, `hl=10` is the block's first line.
     */
    highlightedLines: readonly LineRange[];
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

/** Matches one comma-separated part of `hl`: a line such as `5` or a range such as `5-7`. */
const HIGHLIGHT_PART_PATTERN = /^(\d{1,9})(?:-(\d{1,9}))?$/;

function unquote(value: string): string {
    return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

/** Parses an `hl` value, skipping invalid parts and putting reversed ranges in order. */
function parseLineRanges(value: string): LineRange[] {
    const ranges: LineRange[] = [];

    for (const part of value.split(',')) {
        const match = HIGHLIGHT_PART_PATTERN.exec(part.trim());
        if (!match) {
            continue;
        }

        const first = Number(match[1]);
        const last = match[2] === undefined ? first : Number(match[2]);
        ranges.push({ from: Math.min(first, last), to: Math.max(first, last) });
    }

    return ranges;
}

/** Reads an `ln` value: bare or `true` turns numbering on, `false` off, and anything else is invalid. */
function parseLineNumbersValue(value: string | undefined): boolean | null {
    if (value === undefined || value === 'true') {
        return true;
    }
    return value === 'false' ? false : null;
}

/** Applies one option to the parsed info. Invalid values leave earlier values of the same option in place. */
function applyOption(info: FenceInfo, key: string | undefined, value: string | undefined): void {
    if (key === 'ln') {
        info.lineNumbers = parseLineNumbersValue(value) ?? info.lineNumbers;
    } else if (key === 'start' && value !== undefined && START_VALUE_PATTERN.test(value)) {
        info.lineNumberStart = Number(value);
    } else if (key === 'title' && value) {
        info.title = value;
    } else if (key === 'hl' && value !== undefined) {
        info.highlightedLines = parseLineRanges(value);
    }
}

export function parseFenceInfo(info: string): FenceInfo {
    const trimmed = info.trim();
    const languageEnd = trimmed.search(/\s/);
    const options = languageEnd < 0 ? '' : trimmed.slice(languageEnd);
    const result: FenceInfo = {
        language: languageEnd < 0 ? trimmed : trimmed.slice(0, languageEnd),
        lineNumbers: null,
        lineNumberStart: null,
        title: null,
        highlightedLines: [],
    };

    for (const match of options.matchAll(OPTION_PATTERN)) {
        applyOption(result, match[1], match[2] === undefined ? undefined : unquote(match[2]));
    }

    return result;
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

/** Whether the line with this displayed number is highlighted by the block's `hl` option. */
export function isLineHighlighted(info: FenceInfo, lineNumber: number): boolean {
    return info.highlightedLines.some((range) => lineNumber >= range.from && lineNumber <= range.to);
}

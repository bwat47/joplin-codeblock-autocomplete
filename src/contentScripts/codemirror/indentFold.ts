import { countColumn } from '@codemirror/state';

/** Returns a line's indentation in columns, or `null` for a blank (empty or whitespace-only) line. */
function getIndentColumns(line: string, tabSize: number): number | null {
    const firstNonWhitespace = line.search(/\S/);
    if (firstNonWhitespace === -1) {
        return null;
    }

    return countColumn(line, tabSize, firstNonWhitespace);
}

/**
 * Finds the indentation-based fold that starts at line `index`. Lines are read through `getLine`,
 * which returns `undefined` past the last line, so callers need not copy a large block into an array.
 *
 * A line can fold when the next non-blank line is indented deeper than it. The fold runs over the
 * following lines until the first non-blank line indented no deeper than the starting line, and
 * ends on the last non-blank line before it, so trailing blank lines stay visible. Blank lines
 * never start a fold and never end one. Only relative indentation matters, so a block indented as
 * a whole (for example inside a list item) folds the same as an unindented one.
 *
 * Example (`index` 0):
 * ```text
 * 0 function f() {   <- start
 * 1     if (x) {
 * 2         y();
 * 3     }            <- returned end
 * 4
 * 5 }                <- first line not deeper than the start; stays visible
 * ```
 *
 * @returns The index of the fold's last line, or `null` when the line cannot fold.
 */
export function findIndentFoldEnd(
    getLine: (index: number) => string | undefined,
    index: number,
    tabSize: number
): number | null {
    const startLine = getLine(index);
    const startIndent = startLine === undefined ? null : getIndentColumns(startLine, tabSize);
    if (startIndent === null) {
        return null;
    }

    let end: number | null = null;
    for (let i = index + 1, line = getLine(i); line !== undefined; line = getLine(++i)) {
        const indent = getIndentColumns(line, tabSize);
        if (indent === null) {
            continue;
        }
        if (indent <= startIndent) {
            break;
        }
        end = i;
    }

    return end;
}

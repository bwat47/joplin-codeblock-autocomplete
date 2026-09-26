import { findIndentFoldEnd } from './indentFold';

function foldEnd(lines: readonly string[], index: number, tabSize = 4): number | null {
    return findIndentFoldEnd((i) => lines[i], index, tabSize);
}

describe('findIndentFoldEnd', () => {
    const nested = ['function f() {', '    if (x) {', '        y();', '    }', '}'];

    it('folds the lines indented beneath the start and leaves the closing line visible', () => {
        expect(foldEnd(nested, 0)).toBe(3);
        expect(foldEnd(nested, 1)).toBe(2);
    });

    it('returns null when no following line is indented deeper', () => {
        expect(foldEnd(nested, 2)).toBeNull();
        expect(foldEnd(nested, 3)).toBeNull();
    });

    it('returns null for the last line and for out-of-range indexes', () => {
        expect(foldEnd(nested, 4)).toBeNull();
        expect(foldEnd(nested, 10)).toBeNull();
    });

    it('never starts a fold on a blank line', () => {
        expect(foldEnd(['', '    a'], 0)).toBeNull();
        expect(foldEnd(['   ', '    a'], 0)).toBeNull();
    });

    it('folds across inner blank lines but leaves trailing blank lines visible', () => {
        const lines = ['def f():', '    a = 1', '', '    return a', '', '', 'print(f())'];
        expect(foldEnd(lines, 0)).toBe(3);
    });

    it('runs to the end of the block when nothing dedents', () => {
        expect(foldEnd(['a:', '  b', '  c'], 0)).toBe(2);
    });

    it('measures tabs in columns so mixed tabs and spaces compare correctly', () => {
        const lines = ['\tif x:', '\t    y', '    \tz', '\tw'];
        expect(foldEnd(lines, 0, 4)).toBe(2);
    });

    it('treats a uniformly indented block the same as an unindented one', () => {
        const indented = nested.map((line) => `    ${line}`);
        expect(foldEnd(indented, 0)).toBe(foldEnd(nested, 0));
        expect(foldEnd(indented, 1)).toBe(foldEnd(nested, 1));
    });
});

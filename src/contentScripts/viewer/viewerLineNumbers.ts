import { isRenderedCodeContainer, markRenderedCodePre } from './codeContainer';

/** Asks `lineNumbers.js` to split the code into one element per line. */
const LINES_CONTAINER_CLASS = 'codeblock-autocomplete-viewer-lines';
/** Shows a number on each split line. */
const LINE_NUMBER_CONTAINER_CLASS = 'codeblock-autocomplete-viewer-line-numbers';
/** The first line's number; omitted when numbering starts at 1. */
const LINE_NUMBER_START_ATTRIBUTE = 'data-codeblock-line-start';
/** Space-separated positions (1 for the block's first line) of the lines to highlight. */
const HIGHLIGHT_ATTRIBUTE = 'data-codeblock-highlight-lines';

export type CodeLineMarks = {
    numbered: boolean;
    start: number;
    /** Positions of highlighted lines, counting the block's first line as 1 whatever its number. */
    highlightedLines: readonly number[];
};

/**
 * Marks rendered code for `lineNumbers.js` to number and highlight its lines. Only rendered code
 * is marked, since diagram renderers also use editable containers, and only when there is
 * something to show.
 *
 * The marks go on the `<pre>` holding the code rather than the outer container, because Joplin's
 * mobile Rich Text editor rebuilds the container from its inner HTML alone.
 */
export function markCodeLineContainer(renderedHtml: string, marks: CodeLineMarks): string {
    if ((!marks.numbered && marks.highlightedLines.length === 0) || !isRenderedCodeContainer(renderedHtml)) {
        return renderedHtml;
    }

    const classes = [LINES_CONTAINER_CLASS];
    const attributes: Record<string, string> = {};
    if (marks.numbered) {
        classes.push(LINE_NUMBER_CONTAINER_CLASS);
        if (marks.start !== 1) {
            attributes[LINE_NUMBER_START_ATTRIBUTE] = String(marks.start);
        }
    }
    if (marks.highlightedLines.length > 0) {
        attributes[HIGHLIGHT_ATTRIBUTE] = marks.highlightedLines.join(' ');
    }

    return markRenderedCodePre(renderedHtml, classes.join(' '), attributes);
}

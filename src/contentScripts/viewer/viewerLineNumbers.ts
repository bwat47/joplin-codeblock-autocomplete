import { addContainerAttribute, addContainerClass, isRenderedCodeContainer } from './codeContainer';

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
 * Marks a rendered code container for `lineNumbers.js` to number and highlight its lines. Only
 * rendered code is marked, since diagram renderers also use editable containers, and only when
 * there is something to show.
 */
export function markCodeLineContainer(renderedHtml: string, marks: CodeLineMarks): string {
    if ((!marks.numbered && marks.highlightedLines.length === 0) || !isRenderedCodeContainer(renderedHtml)) {
        return renderedHtml;
    }

    let marked = addContainerClass(renderedHtml, LINES_CONTAINER_CLASS);
    if (marks.numbered) {
        marked = addContainerClass(marked, LINE_NUMBER_CONTAINER_CLASS);
        if (marks.start !== 1) {
            marked = addContainerAttribute(marked, LINE_NUMBER_START_ATTRIBUTE, String(marks.start));
        }
    }
    if (marks.highlightedLines.length > 0) {
        marked = addContainerAttribute(marked, HIGHLIGHT_ATTRIBUTE, marks.highlightedLines.join(' '));
    }

    return marked;
}

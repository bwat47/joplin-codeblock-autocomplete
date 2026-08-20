import { ensureSyntaxTree, language, syntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

const SYNTAX_TREE_PARSE_TIMEOUT_MS = 100;

type FenceChildNodes = {
    closingFenceMark: SyntaxNode | null;
    codeInfo: SyntaxNode | null;
    openingFenceMark: SyntaxNode | null;
};

export type FencedCodeSyntaxTree = {
    /** Whether the tree covers the requested document range. */
    complete: boolean;
    tree: Tree;
};

export type FencedCodeBlockGeometry = {
    /** End of the block: the closing fence line's end, or the node end when the fence is unclosed. */
    blockTo: number;
    /** Child fence nodes, for callers that need the info string or the fence marks themselves. */
    children: FenceChildNodes;
    /** First position of the content, just past the opening fence line's terminator. */
    contentFrom: number;
    /** End of the content, just before the closing fence line's terminator. */
    contentTo: number;
    /** Whether the block is closed by a trailing fence, as opposed to running to the node's end. */
    hasClosingFence: boolean;
    /**
     * Start of the block's own text on the opening line. This is `openingLineFrom` except when a
     * list marker precedes the fence, in which case it starts after that marker — see
     * `findOpeningLineListMark`. Callers rewriting the block should delete from here so they do
     * not consume markup that belongs to the enclosing structure.
     */
    openingFenceFrom: number;
    openingLineFrom: number;
    openingLineTo: number;
};

/**
 * Parses up to `upto`, falling back to whatever has already been parsed when the parse does not
 * finish in time. Callers that need to distinguish an absent node from an unparsed one must check
 * `complete` before acting on the tree. Without a configured language parser, the empty fallback
 * tree is complete for fenced-code discovery because no syntax nodes can be available.
 */
export function getFencedCodeSyntaxTree(state: EditorState, upto: number): FencedCodeSyntaxTree {
    const completeTree = ensureSyntaxTree(state, upto, SYNTAX_TREE_PARSE_TIMEOUT_MS);

    return {
        complete: completeTree !== null || state.facet(language) === null,
        tree: completeTree ?? syntaxTree(state),
    };
}

/**
 * A `FencedCode` node's direct children are the opening `CodeMark`, an optional `CodeInfo`
 * (the info string, always on the opening line), the `CodeText` content, and — only when the
 * block is closed — a trailing `CodeMark` on a later line.
 */
function findFenceChildNodes(fencedCodeNode: SyntaxNode, openingLine: Line): FenceChildNodes {
    let openingFenceMark: SyntaxNode | null = null;
    let closingFenceMark: SyntaxNode | null = null;
    let codeInfo: SyntaxNode | null = null;

    for (let child = fencedCodeNode.firstChild; child; child = child.nextSibling) {
        if (child.name === 'CodeMark') {
            if (!openingFenceMark && child.from >= openingLine.from && child.to <= openingLine.to) {
                openingFenceMark = child;
            } else if (child.from > openingLine.to) {
                closingFenceMark = child;
            }
        } else if (child.name === 'CodeInfo' && child.from >= openingLine.from && child.to <= openingLine.to) {
            codeInfo = child;
        }
    }

    return { closingFenceMark, codeInfo, openingFenceMark };
}

/**
 * Finds a list marker that sits on the opening fence line, before the fence itself (`- ```js`).
 *
 * A list marker is written once, on the item's first line, so removing the whole opening line
 * would destroy the list item. Blockquote markers need no such care: they are repeated on every
 * line of the block, so the content lines keep their own.
 */
function findOpeningLineListMark(fencedCodeNode: SyntaxNode, openingLine: Line): SyntaxNode | null {
    for (let ancestor = fencedCodeNode.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.name !== 'ListItem') continue;

        const listMark = ancestor.firstChild;
        if (listMark?.name === 'ListMark' && listMark.from >= openingLine.from && listMark.to <= fencedCodeNode.from) {
            return listMark;
        }
    }

    return null;
}

/**
 * Resolves the line and content offsets of a `FencedCode` node so callers can read or rewrite
 * the block without repeating the fence arithmetic.
 *
 * Content boundaries exclude the fence lines' terminators. An unclosed block runs to the node's
 * end, and a block with no content collapses `contentTo` onto `contentFrom` rather than running
 * backwards past the opening fence.
 */
export function getFencedCodeBlockGeometry(state: EditorState, fencedCodeNode: SyntaxNode): FencedCodeBlockGeometry {
    const { doc } = state;
    const openingLine = doc.lineAt(fencedCodeNode.from);
    const children = findFenceChildNodes(fencedCodeNode, openingLine);

    // The content starts on the line after the opening fence and ends on the line before the
    // closing one. Addressing those lines by number keeps this independent of `state.lineBreak`,
    // which is two characters for CRLF while a document line break is always one position.
    const contentFrom = openingLine.number < doc.lines ? doc.line(openingLine.number + 1).from : doc.length;
    const closingLine = children.closingFenceMark ? doc.lineAt(children.closingFenceMark.from) : null;
    const openingLineListMark = findOpeningLineListMark(fencedCodeNode, openingLine);

    return {
        blockTo: closingLine ? closingLine.to : fencedCodeNode.to,
        children,
        contentFrom,
        contentTo: closingLine ? Math.max(contentFrom, doc.line(closingLine.number - 1).to) : fencedCodeNode.to,
        hasClosingFence: closingLine !== null,
        openingFenceFrom: openingLineListMark ? openingLineListMark.to : openingLine.from,
        openingLineFrom: openingLine.from,
        openingLineTo: openingLine.to,
    };
}

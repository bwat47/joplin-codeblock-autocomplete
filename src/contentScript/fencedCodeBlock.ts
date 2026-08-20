import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState, Line } from '@codemirror/state';
import type { SyntaxNode, Tree } from '@lezer/common';

const SYNTAX_TREE_PARSE_TIMEOUT_MS = 100;

type FenceChildNodes = {
    closingFenceMark: SyntaxNode | null;
    codeInfo: SyntaxNode | null;
    openingFenceMark: SyntaxNode | null;
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
 * Parses up to `upto`, falling back to whatever has already been parsed when the parse does
 * not finish in time. That fallback tree may cover only part of the document, so callers must
 * tolerate blocks being missing rather than assuming the whole document was scanned.
 */
export function getFencedCodeSyntaxTree(state: EditorState, upto: number): Tree {
    return ensureSyntaxTree(state, upto, SYNTAX_TREE_PARSE_TIMEOUT_MS) ?? syntaxTree(state);
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
    const openingLine = state.doc.lineAt(fencedCodeNode.from);
    const children = findFenceChildNodes(fencedCodeNode, openingLine);

    const lineBreak = state.lineBreak || '\n';
    const contentFrom = Math.min(openingLine.to + lineBreak.length, state.doc.length);
    const closingLine = children.closingFenceMark ? state.doc.lineAt(children.closingFenceMark.from) : null;
    const openingLineListMark = findOpeningLineListMark(fencedCodeNode, openingLine);

    return {
        blockTo: closingLine ? closingLine.to : fencedCodeNode.to,
        children,
        contentFrom,
        contentTo: closingLine ? Math.max(contentFrom, closingLine.from - lineBreak.length) : fencedCodeNode.to,
        hasClosingFence: closingLine !== null,
        openingFenceFrom: openingLineListMark ? openingLineListMark.to : openingLine.from,
        openingLineFrom: openingLine.from,
        openingLineTo: openingLine.to,
    };
}

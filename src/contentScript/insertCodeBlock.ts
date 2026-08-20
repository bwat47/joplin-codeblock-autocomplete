import { EditorSelection, type EditorState, type SelectionRange } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { type FencedCodeBlockGeometry, getFencedCodeBlockGeometry, getFencedCodeSyntaxTree } from './fencedCodeBlock';

const CODE_FENCE_CHAR = '`';
const MIN_CODE_FENCE_LENGTH = 3;

/**
 * Picks a fence long enough that nothing being wrapped can end the block early. CommonMark closes
 * a fenced block at the first line holding a run of at least as many backticks as the opening
 * fence, so wrapping text that already contains fences needs one backtick more than the longest
 * of them. Tilde fences are ignored: they cannot close a backtick-fenced block.
 */
function chooseCodeFence(state: EditorState, from: number, to: number): string {
    const { doc } = state;
    const lastLineNumber = doc.lineAt(to).number;
    let longestEnclosedFence = 0;

    for (let lineNumber = doc.lineAt(from).number; lineNumber <= lastLineNumber; lineNumber++) {
        // Leading whitespace is allowed before a fence, so match past it: `  ```js`.
        const enclosedFence = /^\s*(`{3,})/.exec(doc.line(lineNumber).text);
        if (enclosedFence) longestEnclosedFence = Math.max(longestEnclosedFence, enclosedFence[1].length);
    }

    return CODE_FENCE_CHAR.repeat(Math.max(MIN_CODE_FENCE_LENGTH, longestEnclosedFence + 1));
}

/**
 * Collects every fenced code block that fully contains at least one cursor or selection.
 * A range straddling a fence boundary is not considered contained, so it falls through to
 * the wrapping path instead.
 */
function findFencedCodeBlocksAtSelections(state: EditorState): FencedCodeBlockGeometry[] {
    const tree = getFencedCodeSyntaxTree(state, state.doc.length);
    const blocks: FencedCodeBlockGeometry[] = [];

    tree.iterate({
        enter: (node) => {
            if (node.name !== 'FencedCode') return undefined;

            const block = getFencedCodeBlockGeometry(state, node.node);
            const containsSelection = state.selection.ranges.some((range) => isRangeInsideBlock(range, block));
            if (containsSelection) blocks.push(block);

            return false;
        },
    });

    return blocks;
}

function isRangeInsideBlock(range: SelectionRange, block: FencedCodeBlockGeometry): boolean {
    return range.from >= block.openingLineFrom && range.to <= block.blockTo;
}

function overlapsFencedBlock(span: { from: number; to: number }, fencedBlock: FencedCodeBlockGeometry): boolean {
    return span.from < fencedBlock.blockTo && span.to > fencedBlock.openingFenceFrom;
}

/**
 * Expands a selection range to cover the whole lines it touches. A bare cursor or a
 * partial selection therefore wraps entire lines rather than a fragment. A non-empty
 * selection ending exactly at a line start does not pull in that trailing line.
 */
function expandToLines(state: EditorState, from: number, to: number): { from: number; to: number } {
    const { doc } = state;
    const startLine = doc.lineAt(from);
    const endLine = to > from && to === doc.lineAt(to).from ? doc.lineAt(to - 1) : doc.lineAt(to);
    return { from: startLine.from, to: endLine.to };
}

/**
 * Toggles fenced code block formatting for the current selections.
 *
 * Each cursor or selection contained by an existing fenced code block removes that block's
 * opening and closing fence lines. Every remaining cursor/selection is expanded to the whole
 * lines it touches, so a bare cursor on a line of text wraps that line and a partial selection
 * wraps the full line(s) it spans. Expanded spans that share lines are merged into one block so a
 * multi-cursor selection never produces overlapping changes; the original cursors are then
 * re-anchored inside their block, preserving column and direction. A bare cursor on an empty line
 * still inserts an empty code block.
 */
export function insertCodeBlockAtCursor(view: EditorView): void {
    const { state } = view;
    const { doc } = state;
    const lineBreak = state.lineBreak || '\n';

    const existingBlocks = findFencedCodeBlocksAtSelections(state);

    // Ranges inside existing blocks remove those blocks' fences. Expand every remaining range to
    // the whole lines it touches, then drop the spans that straddle a fence boundary: those
    // conflict with removing that fence, so the removal takes precedence. Discarding them before
    // merging keeps a span that merely shares a line with one from being discarded too.
    const spans = state.selection.ranges
        .filter((range) => !existingBlocks.some((block) => isRangeInsideBlock(range, block)))
        .map((range) => expandToLines(state, range.from, range.to))
        .filter((span) => !existingBlocks.some((fencedBlock) => overlapsFencedBlock(span, fencedBlock)))
        .sort((a, b) => a.from - b.from);

    // Merge spans that share lines so wrapping changes never overlap. Every span lies wholly
    // before or wholly after each fenced block, so a merged span cannot reach into one either.
    const mergedSpans: { from: number; to: number }[] = [];
    for (const span of spans) {
        const last = mergedSpans[mergedSpans.length - 1];
        if (last && span.from <= last.to) {
            last.to = Math.max(last.to, span.to);
        } else {
            mergedSpans.push({ from: span.from, to: span.to });
        }
    }

    // Each block is fenced against its own content, so the offset to the wrapped text varies.
    const wrapBlocks = mergedSpans.map((span) => {
        const fence = chooseCodeFence(state, span.from, span.to);
        return { ...span, fence, contentOffset: fence.length + 1 };
    });

    // Build one change per block and remember where its wrapped content begins.
    //
    // CommonMark does not require blank lines around fenced code blocks, only that the fences sit
    // on their own line. Because each span is already expanded to whole lines, the opening/closing
    // fences always land on their own line, so no surrounding padding needs to be added.
    //
    // Spans end at `Line.to`, which excludes the line terminator, so the sliced text never ends
    // with a line break — appending one unconditionally also covers the empty-line case.
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const block of existingBlocks) {
        changes.push({ from: block.openingFenceFrom, to: block.contentFrom, insert: '' });
        if (block.hasClosingFence) {
            changes.push({ from: block.contentTo, to: block.blockTo, insert: '' });
        }
    }

    for (const { from, to, fence } of wrapBlocks) {
        // `sliceString` separates lines with '\n' unless told otherwise, but the inserted text is
        // split back into lines on `state.lineBreak`, so both have to use the same separator.
        const wrappedText = doc.sliceString(from, to, lineBreak);
        const content = `${wrappedText}${lineBreak}`;

        changes.push({ from, to, insert: `${fence}${lineBreak}${content}${fence}` });
    }

    if (changes.length === 0) return;

    changes.sort((a, b) => a.from - b.from || a.to - b.to);
    const changeSet = state.changes(changes);

    // Re-anchor wrapped cursors/selections inside their new blocks, preserving column and
    // direction. Ranges that removed a fence, or conflicted with a fence removal, map normally.
    const selection = EditorSelection.create(
        state.selection.ranges.map((range) => {
            const block = wrapBlocks.find((b) => range.from >= b.from && range.from <= b.to);
            if (!block) return range.map(changeSet);

            // A document line break is one position whatever `state.lineBreak` holds, which is
            // why `contentOffset` counts it as 1 rather than by its length.
            const base = changeSet.mapPos(block.from, -1) + block.contentOffset;
            const clamp = (pos: number) => base + (Math.min(Math.max(pos, block.from), block.to) - block.from);
            return EditorSelection.range(clamp(range.anchor), clamp(range.head));
        }),
        state.selection.mainIndex
    );

    view.dispatch(state.update({ changes: changeSet, selection }));

    view.focus();
}

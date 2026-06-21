import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const CODE_FENCE = '```';

function countLineBreaksBefore(view: EditorView, from: number, lineBreak: string): number {
    let count = 0;
    let cursor = from;

    while (cursor >= lineBreak.length) {
        if (view.state.doc.sliceString(cursor - lineBreak.length, cursor) !== lineBreak) {
            break;
        }
        count += 1;
        cursor -= lineBreak.length;
    }

    return count;
}

function countLineBreaksAfter(view: EditorView, to: number, lineBreak: string): number {
    let count = 0;
    let cursor = to;

    while (cursor + lineBreak.length <= view.state.doc.length) {
        if (view.state.doc.sliceString(cursor, cursor + lineBreak.length) !== lineBreak) {
            break;
        }
        count += 1;
        cursor += lineBreak.length;
    }

    return count;
}

/**
 * Expands a selection range to cover the whole lines it touches. A bare cursor or a
 * partial selection therefore wraps entire lines rather than a fragment. A non-empty
 * selection ending exactly at a line start does not pull in that trailing line.
 */
function expandToLines(view: EditorView, from: number, to: number): { from: number; to: number } {
    const { doc } = view.state;
    const startLine = doc.lineAt(from);
    const endLine = to > from && to === doc.lineAt(to).from ? doc.lineAt(to - 1) : doc.lineAt(to);
    return { from: startLine.from, to: endLine.to };
}

/**
 * Inserts a fenced code block at every cursor and wraps every selection in a code block,
 * all in a single transaction.
 *
 * The command is line-aware: each cursor/selection is first expanded to the whole lines it
 * touches, so a bare cursor on a line of text wraps that line and a partial selection wraps
 * the full line(s) it spans. Expanded spans that share lines are merged into one block so a
 * multi-cursor selection never produces overlapping changes; the original cursors are then
 * re-anchored inside their block, preserving column and direction. A bare cursor on an empty
 * line still inserts an empty code block.
 */
export function insertCodeBlockAtCursor(view: EditorView): void {
    const { state } = view;
    const { doc } = state;
    const lineBreak = state.lineBreak || '\n';

    // Expand each range to whole lines, then merge spans that share lines so changes never overlap.
    const spans = state.selection.ranges
        .map((range) => expandToLines(view, range.from, range.to))
        .sort((a, b) => a.from - b.from);
    const blocks: { from: number; to: number }[] = [];
    for (const span of spans) {
        const last = blocks[blocks.length - 1];
        if (last && span.from <= last.to) {
            last.to = Math.max(last.to, span.to);
        } else {
            blocks.push({ from: span.from, to: span.to });
        }
    }

    // Build one change per block and remember where its wrapped content begins.
    const changes: { from: number; to: number; insert: string }[] = [];
    const contentOffsets: number[] = [];
    for (const { from, to } of blocks) {
        const wrappedText = doc.sliceString(from, to);
        const leadingBreaks = from === 0 ? 0 : countLineBreaksBefore(view, from, lineBreak);
        const trailingBreaks = to === doc.length ? 0 : countLineBreaksAfter(view, to, lineBreak);
        const prefix = from === 0 ? '' : lineBreak.repeat(Math.max(0, 2 - leadingBreaks));
        const suffix = to === doc.length ? '' : lineBreak.repeat(Math.max(0, 2 - trailingBreaks));
        const content =
            wrappedText.length > 0 ? `${wrappedText}${wrappedText.endsWith(lineBreak) ? '' : lineBreak}` : lineBreak;

        changes.push({ from, to, insert: `${prefix}${CODE_FENCE}${lineBreak}${content}${CODE_FENCE}${suffix}` });
        contentOffsets.push(prefix.length + CODE_FENCE.length + lineBreak.length);
    }

    if (changes.length === 0) return;

    const changeSet = state.changes(changes);

    // Re-anchor each original cursor/selection inside its block, preserving column and
    // direction. Each range's start falls inside exactly one block; clamp the endpoints in
    // case a trailing-line was trimmed off the block.
    const selection = EditorSelection.create(
        state.selection.ranges.map((range) => {
            const index = blocks.findIndex((block) => range.from >= block.from && range.from <= block.to);
            const block = blocks[index];
            const base = changeSet.mapPos(block.from, -1) + contentOffsets[index];
            const clamp = (pos: number) => base + (Math.min(Math.max(pos, block.from), block.to) - block.from);
            return EditorSelection.range(clamp(range.anchor), clamp(range.head));
        })
    );

    view.dispatch(state.update({ changes: changeSet, selection }));

    view.focus();
}

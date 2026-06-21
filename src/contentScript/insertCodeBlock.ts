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
 * Inserts a fenced code block at every cursor and wraps every non-empty selection in its
 * own fenced code block, all in a single transaction.
 *
 * Each range is computed independently against the original document (the line-break
 * counting reads pre-change positions), then the changes are batched together so a
 * multi-cursor selection produces one block per cursor/selection.
 */
export function insertCodeBlockAtCursor(view: EditorView): void {
    const lineBreak = view.state.lineBreak || '\n';

    const changes: { from: number; to: number; insert: string }[] = [];
    // Per change, the anchor/head offsets relative to the start of the insertion. These
    // re-create the original selection inside the new block, preserving its direction
    // (for an empty cursor both collapse to the content line).
    const anchorOffsets: number[] = [];
    const headOffsets: number[] = [];

    for (const range of view.state.selection.ranges) {
        const { from, to, anchor, head } = range;
        const selectedText = view.state.sliceDoc(from, to);
        const leadingBreaks = from === 0 ? 0 : countLineBreaksBefore(view, from, lineBreak);
        const trailingBreaks = to === view.state.doc.length ? 0 : countLineBreaksAfter(view, to, lineBreak);
        const prefix = from === 0 ? '' : lineBreak.repeat(Math.max(0, 2 - leadingBreaks));
        const suffix = to === view.state.doc.length ? '' : lineBreak.repeat(Math.max(0, 2 - trailingBreaks));
        const content =
            selectedText.length > 0 ? `${selectedText}${selectedText.endsWith(lineBreak) ? '' : lineBreak}` : lineBreak;
        const insertText = `${prefix}${CODE_FENCE}${lineBreak}${content}${CODE_FENCE}${suffix}`;

        // The wrapped text begins here; the original anchor/head sit at their offsets within it.
        const contentOffset = prefix.length + CODE_FENCE.length + lineBreak.length;
        changes.push({ from, to, insert: insertText });
        anchorOffsets.push(contentOffset + (anchor - from));
        headOffsets.push(contentOffset + (head - from));
    }

    if (changes.length === 0) return;

    const changeSet = view.state.changes(changes);
    const selection = EditorSelection.create(
        changes.map((change, i) => {
            const insertStart = changeSet.mapPos(change.from, -1);
            return EditorSelection.range(insertStart + anchorOffsets[i], insertStart + headOffsets[i]);
        })
    );

    view.dispatch(view.state.update({ changes: changeSet, selection }));

    view.focus();
}

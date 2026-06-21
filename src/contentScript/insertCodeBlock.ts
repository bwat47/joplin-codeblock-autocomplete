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
    // Offset (relative to the start of each insertion) where the cursor should land,
    // i.e. on the content line between the opening and closing fences.
    const cursorOffsets: number[] = [];

    for (const { from, to } of view.state.selection.ranges) {
        const selectedText = view.state.sliceDoc(from, to);
        const leadingBreaks = from === 0 ? 0 : countLineBreaksBefore(view, from, lineBreak);
        const trailingBreaks = to === view.state.doc.length ? 0 : countLineBreaksAfter(view, to, lineBreak);
        const prefix = from === 0 ? '' : lineBreak.repeat(Math.max(0, 2 - leadingBreaks));
        const suffix = to === view.state.doc.length ? '' : lineBreak.repeat(Math.max(0, 2 - trailingBreaks));
        const content =
            selectedText.length > 0 ? `${selectedText}${selectedText.endsWith(lineBreak) ? '' : lineBreak}` : lineBreak;
        const insertText = `${prefix}${CODE_FENCE}${lineBreak}${content}${CODE_FENCE}${suffix}`;

        changes.push({ from, to, insert: insertText });
        cursorOffsets.push(prefix.length + CODE_FENCE.length + lineBreak.length);
    }

    if (changes.length === 0) return;

    const changeSet = view.state.changes(changes);
    const selection = EditorSelection.create(
        changes.map((change, i) => EditorSelection.cursor(changeSet.mapPos(change.from, -1) + cursorOffsets[i]))
    );

    view.dispatch(view.state.update({ changes: changeSet, selection }));

    view.focus();
}

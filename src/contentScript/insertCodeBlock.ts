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

export function insertCodeBlockAtCursor(view: EditorView): void {
    const { from, to } = view.state.selection.main;
    const lineBreak = view.state.lineBreak || '\n';
    const selectedText = view.state.sliceDoc(from, to);
    const leadingBreaks = from === 0 ? 0 : countLineBreaksBefore(view, from, lineBreak);
    const trailingBreaks = to === view.state.doc.length ? 0 : countLineBreaksAfter(view, to, lineBreak);
    const prefix = from === 0 ? '' : lineBreak.repeat(Math.max(0, 2 - leadingBreaks));
    const suffix = to === view.state.doc.length ? '' : lineBreak.repeat(Math.max(0, 2 - trailingBreaks));
    const content =
        selectedText.length > 0 ? `${selectedText}${selectedText.endsWith(lineBreak) ? '' : lineBreak}` : lineBreak;
    const insertText = `${prefix}${CODE_FENCE}${lineBreak}${content}${CODE_FENCE}${suffix}`;
    const cursorOffset = from + prefix.length + CODE_FENCE.length + lineBreak.length;

    view.dispatch(
        view.state.update({
            changes: { from, to, insert: insertText },
            selection: { anchor: cursorOffset },
        })
    );

    view.focus();
}

import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

type SelectionSpec = {
    anchor: number;
    head: number;
};

type CreateEditorHarnessOptions = {
    extensions?: Extension[];
    rawInput?: boolean;
};

export type EditorHarness = {
    view: EditorView;
    destroy: () => void;
    getCursor: () => number;
    getSelection: () => SelectionSpec;
    getText: () => string;
};

const SELECTION_START = '[[';
const SELECTION_END = ']]';
const CURSOR_MARKER = '|';

function parseSelectionMarkers(input: string): { doc: string; selection: SelectionSpec } {
    const selectionStart = input.indexOf(SELECTION_START);
    const selectionEnd = input.indexOf(SELECTION_END);
    const cursorIndex = input.indexOf(CURSOR_MARKER);

    if (selectionStart !== -1 || selectionEnd !== -1) {
        if (selectionStart === -1 || selectionEnd === -1) {
            throw new Error('Selection markers must include both "[[" and "]]".');
        }
        if (cursorIndex !== -1) {
            throw new Error('Use either selection markers or a cursor marker, not both.');
        }
        if (selectionEnd < selectionStart) {
            throw new Error('Selection end marker must come after selection start marker.');
        }

        const doc = input.replace(SELECTION_START, '').replace(SELECTION_END, '');
        const anchor = selectionStart;
        const head = selectionEnd - SELECTION_START.length;

        return { doc, selection: { anchor, head } };
    }

    if (cursorIndex !== -1) {
        return {
            doc: input.replace(CURSOR_MARKER, ''),
            selection: { anchor: cursorIndex, head: cursorIndex },
        };
    }

    return { doc: input, selection: { anchor: 0, head: 0 } };
}

export function createEditorHarness(input: string, options?: CreateEditorHarnessOptions): EditorHarness {
    const { doc, selection } = options?.rawInput
        ? { doc: input, selection: { anchor: 0, head: 0 } }
        : parseSelectionMarkers(input);
    const state = EditorState.create({
        doc,
        selection,
        extensions: options?.extensions ?? [],
    });
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new EditorView({ state, parent });

    return {
        view,
        destroy: () => {
            view.destroy();
            parent.remove();
        },
        getCursor: () => view.state.selection.main.head,
        getSelection: () => ({
            anchor: view.state.selection.main.anchor,
            head: view.state.selection.main.head,
        }),
        getText: () => view.state.doc.toString(),
    };
}

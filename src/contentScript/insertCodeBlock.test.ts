import { EditorSelection, EditorState } from '@codemirror/state';
import { insertCodeBlockAtCursor } from './insertCodeBlock';
import { createEditorHarness } from '../testUtils/editorHarness';

describe('insertCodeBlockAtCursor', () => {
    it('inserts an empty code block at the cursor and places the cursor inside it', () => {
        const harness = createEditorHarness('|');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('```\n\n```');
            expect(harness.getCursor()).toBe(4);
        } finally {
            harness.destroy();
        }
    });

    it('wraps selected text in a fenced code block and keeps it selected', () => {
        const harness = createEditorHarness('alpha[[console.log(1);]]beta');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('alpha\n\n```\nconsole.log(1);\n```\n\nbeta');
            // "console.log(1);" remains selected inside the new block.
            expect(harness.getSelection()).toEqual({ anchor: 11, head: 26 });
        } finally {
            harness.destroy();
        }
    });

    it('preserves the selection direction when wrapping a backward selection', () => {
        const harness = createEditorHarness('abcdef', {
            rawInput: true,
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });

        try {
            // Select "bcd" with the head at the start (a backward / right-to-left selection).
            harness.view.dispatch({
                selection: EditorSelection.range(4, 1),
            });

            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('a\n\n```\nbcd\n```\n\nef');
            // Head stays before the anchor, so the selection still reads right-to-left.
            expect(harness.getSelection()).toEqual({ anchor: 10, head: 7 });
        } finally {
            harness.destroy();
        }
    });

    it('does not add extra blank lines when the cursor is already separated from surrounding text', () => {
        const harness = createEditorHarness('alpha\n\n|beta');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('alpha\n\n```\n\n```\n\nbeta');
            expect(harness.getCursor()).toBe(11);
        } finally {
            harness.destroy();
        }
    });

    it('inserts an empty code block at every cursor in a multi-cursor selection', () => {
        const harness = createEditorHarness('abcd', {
            rawInput: true,
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });

        try {
            harness.view.dispatch({
                selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
            });

            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('a\n\n```\n\n```\n\nbc\n\n```\n\n```\n\nd');
            expect(harness.view.state.selection.ranges.map((range) => range.head)).toEqual([7, 21]);
        } finally {
            harness.destroy();
        }
    });

    it('wraps each selection in its own code block for a multi-cursor selection', () => {
        const harness = createEditorHarness('abcde', {
            rawInput: true,
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });

        try {
            // Select "b" and "d".
            harness.view.dispatch({
                selection: EditorSelection.create([EditorSelection.range(1, 2), EditorSelection.range(3, 4)]),
            });

            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('a\n\n```\nb\n```\n\nc\n\n```\nd\n```\n\ne');
            // Each wrapped letter stays selected inside its own block.
            expect(
                harness.view.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head }))
            ).toEqual([
                { anchor: 7, head: 8 },
                { anchor: 21, head: 22 },
            ]);
        } finally {
            harness.destroy();
        }
    });

    it('handles a mix of an empty cursor and a selection', () => {
        const harness = createEditorHarness('abcde', {
            rawInput: true,
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });

        try {
            // Empty cursor before "b" and a selection wrapping "d".
            harness.view.dispatch({
                selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.range(3, 4)]),
            });

            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('a\n\n```\n\n```\n\nbc\n\n```\nd\n```\n\ne');
            // Empty cursor collapses to the content line; the wrapped "d" stays selected.
            expect(
                harness.view.state.selection.ranges.map((range) => ({ anchor: range.anchor, head: range.head }))
            ).toEqual([
                { anchor: 7, head: 7 },
                { anchor: 21, head: 22 },
            ]);
        } finally {
            harness.destroy();
        }
    });
});

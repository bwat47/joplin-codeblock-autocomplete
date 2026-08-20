import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { insertCodeBlockAtCursor } from './insertCodeBlock';
import { createEditorHarness } from '../testUtils/editorHarness';

describe('insertCodeBlockAtCursor', () => {
    it('removes code block formatting when the cursor is inside a fenced code block', () => {
        const harness = createEditorHarness('before\n```ts\nconst val|ue = 1;\n```\nafter', {
            extensions: [markdown()],
        });

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('before\nconst value = 1;\nafter');
            expect(harness.getCursor()).toBe(16);
        } finally {
            harness.destroy();
        }
    });

    it('removes tilde fence lines when the cursor is on an existing block fence', () => {
        const harness = createEditorHarness('before\n~~~js|\nvalue();\n~~~\nafter', {
            extensions: [markdown()],
        });

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('before\nvalue();\nafter');
            expect(harness.getCursor()).toBe(7);
        } finally {
            harness.destroy();
        }
    });

    it('removes an unclosed opening fence and keeps its content', () => {
        const harness = createEditorHarness('```python\npri|nt("hello")', {
            extensions: [markdown()],
        });

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('print("hello")');
            expect(harness.getCursor()).toBe(3);
        } finally {
            harness.destroy();
        }
    });

    it('keeps the list marker when the fence shares the list item line', () => {
        const harness = createEditorHarness('- ```js\n  co|de\n  ```\n', {
            extensions: [markdown()],
        });

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('-  code\n');
        } finally {
            harness.destroy();
        }
    });

    it('keeps the ordered list marker when the fence shares the list item line', () => {
        const harness = createEditorHarness('1. ```js\n   co|de\n   ```\n', {
            extensions: [markdown()],
        });

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('1.   code\n');
        } finally {
            harness.destroy();
        }
    });

    it('removes the whole opening line for a fence indented under a list item', () => {
        const harness = createEditorHarness('- item\n\n  ```js\n  co|de\n  ```\n', {
            extensions: [markdown()],
        });

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('- item\n\n  code\n');
        } finally {
            harness.destroy();
        }
    });

    it('removes the whole opening line inside a blockquote, whose marker repeats per line', () => {
        const harness = createEditorHarness('> ```js\n> co|de\n> ```\n', {
            extensions: [markdown()],
        });

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('> code\n');
        } finally {
            harness.destroy();
        }
    });

    it('inserts an empty code block on an empty line and places the cursor inside it', () => {
        const harness = createEditorHarness('|');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('```\n\n```');
            expect(harness.getCursor()).toBe(4);
        } finally {
            harness.destroy();
        }
    });

    it('wraps the whole line when the cursor sits on a line of text and keeps the cursor column', () => {
        const harness = createEditorHarness('before\n\ntar|get\n\nafter');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('before\n\n```\ntarget\n```\n\nafter');
            // Cursor stays before "get" inside the wrapped line.
            expect(harness.getCursor()).toBe(15);
        } finally {
            harness.destroy();
        }
    });

    it('wraps the entire line when only part of a single line is selected', () => {
        const harness = createEditorHarness('one\n\n[[hello]] world\n\ntwo');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('one\n\n```\nhello world\n```\n\ntwo');
            // The original partial selection ("hello") is preserved inside the wrapped line.
            expect(harness.getSelection()).toEqual({ anchor: 9, head: 14 });
        } finally {
            harness.destroy();
        }
    });

    it('includes whole lines when a selection spans multiple lines with partial ends', () => {
        const harness = createEditorHarness('one\n\nal[[pha\nbeta\ngam]]ma\n\ntwo');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('one\n\n```\nalpha\nbeta\ngamma\n```\n\ntwo');
            expect(harness.getSelection()).toEqual({ anchor: 11, head: 23 });
        } finally {
            harness.destroy();
        }
    });

    it('does not pull in the trailing line when a selection ends at a line start', () => {
        const harness = createEditorHarness('one\n\nal[[pha\nbeta\n]]gamma\n\ntwo');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('one\n\n```\nalpha\nbeta\n```\ngamma\n\ntwo');
            // Head clamps to the end of the wrapped content (gamma is excluded).
            expect(harness.getSelection()).toEqual({ anchor: 11, head: 19 });
        } finally {
            harness.destroy();
        }
    });

    it('preserves a backward selection direction when wrapping its line', () => {
        const harness = createEditorHarness('abcdef', { rawInput: true });

        try {
            // Select "bcd" with the head before the anchor (right-to-left).
            harness.view.dispatch({ selection: EditorSelection.range(4, 1) });

            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('```\nabcdef\n```');
            // Whole line wrapped; head stays before the anchor.
            expect(harness.getSelection()).toEqual({ anchor: 8, head: 5 });
        } finally {
            harness.destroy();
        }
    });

    it('wraps each line in its own block for cursors on different lines', () => {
        const harness = createEditorHarness('aaa\nbbb\nccc', {
            rawInput: true,
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });

        try {
            harness.view.dispatch({
                selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(9)]),
            });

            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('```\naaa\n```\nbbb\n```\nccc\n```');
            expect(harness.view.state.selection.ranges.map((range) => range.head)).toEqual([5, 21]);
        } finally {
            harness.destroy();
        }
    });

    it('wraps a shared line once but keeps every cursor on it', () => {
        const harness = createEditorHarness('abcd', {
            rawInput: true,
            extensions: [EditorState.allowMultipleSelections.of(true)],
        });

        try {
            harness.view.dispatch({
                selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
            });

            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('```\nabcd\n```');
            expect(harness.view.state.selection.ranges.map((range) => range.head)).toEqual([5, 7]);
        } finally {
            harness.destroy();
        }
    });
});

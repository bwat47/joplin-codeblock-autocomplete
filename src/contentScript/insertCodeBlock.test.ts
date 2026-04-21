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

    it('wraps selected text in a fenced code block and preserves separation from surrounding text', () => {
        const harness = createEditorHarness('alpha[[console.log(1);]]beta');

        try {
            insertCodeBlockAtCursor(harness.view);

            expect(harness.getText()).toBe('alpha\n\n```\nconsole.log(1);\n```\n\nbeta');
            expect(harness.getCursor()).toBe(11);
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
});

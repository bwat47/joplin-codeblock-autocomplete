import { markdown } from '@codemirror/lang-markdown';
import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createEditorHarness, type EditorHarness } from '../../testUtils/editorHarness';
import { createLineNumbersPlugin, lineNumbersTheme } from './lineNumbers';
import { applyPluginSettings, createSettingsExtension } from './pluginSettings';

type RenderedLine = {
    number: string | null;
    numbered: boolean;
    text: string;
};

function createHarness(doc: string, enableLineNumbers = true): EditorHarness {
    const harness = createEditorHarness(doc, {
        extensions: [markdown(), createSettingsExtension(), lineNumbersTheme, createLineNumbersPlugin()],
    });
    setLineNumbersEnabled(harness, enableLineNumbers);
    return harness;
}

function getNumbers(harness: EditorHarness): string[] {
    return getRenderedLines(harness)
        .map((line) => line.number)
        .filter((number) => number !== null);
}

function setLineNumbersEnabled(harness: EditorHarness, enableLineNumbers: boolean): void {
    applyPluginSettings(harness.view, {
        enableLanguageAutocomplete: true,
        enableCopyWidget: false,
        enableLineNumbers,
        languages: [],
    });
}

function getRenderedLines(harness: EditorHarness): RenderedLine[] {
    return Array.from(harness.view.contentDOM.querySelectorAll('.cm-line')).map((line) => ({
        number: line.getAttribute('data-codeblock-line-number'),
        numbered: line.classList.contains('cm-codeblock-line-numbers'),
        text: line.textContent ?? '',
    }));
}

describe('createLineNumbersPlugin', () => {
    it('numbers content lines and offsets the fences without numbering them', () => {
        const harness = createHarness('before\n```ts\nconst a = 1;\n\nconst b = 2;\n```\nafter');

        try {
            expect(getRenderedLines(harness)).toEqual([
                { number: null, numbered: false, text: 'before' },
                { number: null, numbered: true, text: '```ts' },
                { number: '1', numbered: true, text: 'const a = 1;' },
                { number: '2', numbered: true, text: '' },
                { number: '3', numbered: true, text: 'const b = 2;' },
                { number: null, numbered: true, text: '```' },
                { number: null, numbered: false, text: 'after' },
            ]);
        } finally {
            harness.destroy();
        }
    });

    it('restarts numbering for each block', () => {
        const harness = createHarness('```\na\nb\n```\n\n```\nc\n```');

        try {
            expect(getNumbers(harness)).toEqual(['1', '2', '1']);
        } finally {
            harness.destroy();
        }
    });

    it('numbers an unclosed block through the end of the document', () => {
        const harness = createHarness('```\na\nb');

        try {
            expect(getRenderedLines(harness).map((line) => line.number)).toEqual([null, '1', '2']);
        } finally {
            harness.destroy();
        }
    });

    it('sizes the gutter to the widest number in the block', () => {
        const content = Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n');
        const harness = createHarness(`\`\`\`\n${content}\n\`\`\``);

        try {
            const lines = harness.view.contentDOM.querySelectorAll<HTMLElement>('.cm-codeblock-line-numbers');
            for (const line of lines) {
                expect(line.style.getPropertyValue('--cm-codeblock-line-number-digits')).toBe('2');
            }
        } finally {
            harness.destroy();
        }
    });

    it('keeps list and blockquote prefixes out of the numbering', () => {
        const harness = createHarness('> ```\n> quoted\n> ```');

        try {
            expect(getRenderedLines(harness).map((line) => line.number)).toEqual([null, '1', null]);
        } finally {
            harness.destroy();
        }
    });

    it('renumbers when lines are inserted', () => {
        const harness = createHarness('```\na\n```');

        try {
            harness.view.dispatch({ changes: { from: 4, insert: 'new\n' } });

            expect(getRenderedLines(harness).map((line) => line.number)).toEqual([null, '1', '2', null]);
        } finally {
            harness.destroy();
        }
    });

    it('adds and removes numbers when the setting is toggled', () => {
        const harness = createHarness('```\na\n```', false);

        try {
            expect(harness.view.contentDOM.querySelector('.cm-codeblock-line-numbers')).toBeNull();

            setLineNumbersEnabled(harness, true);
            expect(harness.view.contentDOM.querySelectorAll('.cm-codeblock-line-numbers')).toHaveLength(3);

            setLineNumbersEnabled(harness, false);
            expect(harness.view.contentDOM.querySelector('.cm-codeblock-line-numbers')).toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('numbers newly visible lines by their position in the block when scrolled', () => {
        const content = Array.from({ length: 5000 }, (_, index) => `line ${index + 1}`).join('\n');
        const harness = createHarness(`\`\`\`\n${content}\n\`\`\``);

        try {
            expect(getNumbers(harness)).not.toContain('3999');

            // Scrolling only changes the viewport, so the rebuild must not depend on a doc change.
            const target = harness.view.state.doc.line(4000).from;
            harness.view.dispatch({ effects: EditorView.scrollIntoView(target, { y: 'start' }) });

            const numbers = getNumbers(harness);
            expect(numbers).toContain('3999');
            expect(numbers).not.toContain('1');
            expect(numbers.map(Number)).toEqual(numbers.map((_, index) => Number(numbers[0]) + index));
        } finally {
            harness.destroy();
        }
    });

    it('renumbers when the syntax tree is replaced without a doc change', () => {
        // Swapping in the language replaces the tree without editing the doc, the same
        // condition a background parse catching up produces.
        const language = new Compartment();
        const harness = createEditorHarness('```\na\n```', {
            extensions: [language.of([]), createSettingsExtension(), lineNumbersTheme, createLineNumbersPlugin()],
        });

        try {
            setLineNumbersEnabled(harness, true);
            expect(getNumbers(harness)).toEqual([]);

            harness.view.dispatch({ effects: language.reconfigure(markdown()) });
            expect(getNumbers(harness)).toEqual(['1']);
        } finally {
            harness.destroy();
        }
    });
});

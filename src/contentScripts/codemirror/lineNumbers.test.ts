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

function getHighlightedTexts(harness: EditorHarness): string[] {
    return Array.from(harness.view.contentDOM.querySelectorAll('.cm-line.cm-codeblock-highlighted-line')).map(
        (line) => line.textContent
    );
}

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
        text: line.textContent,
    }));
}

describe('createLineNumbersPlugin', () => {
    it('numbers and offsets content lines while leaving the fences in place', () => {
        const harness = createHarness('before\n```ts\nconst a = 1;\n\nconst b = 2;\n```\nafter');

        try {
            expect(getRenderedLines(harness)).toEqual([
                { number: null, numbered: false, text: 'before' },
                { number: null, numbered: false, text: '```ts' },
                { number: '1', numbered: true, text: 'const a = 1;' },
                { number: '2', numbered: true, text: '' },
                { number: '3', numbered: true, text: 'const b = 2;' },
                { number: null, numbered: false, text: '```' },
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
            expect(harness.view.contentDOM.querySelectorAll('.cm-codeblock-line-numbers')).toHaveLength(1);

            setLineNumbersEnabled(harness, false);
            expect(harness.view.contentDOM.querySelector('.cm-codeblock-line-numbers')).toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('numbers blocks that opt in with ln while the setting is off', () => {
        const harness = createHarness('```ts ln\na\n```\n\n```ts\nb\n```', false);

        try {
            expect(getRenderedLines(harness).map((line) => line.number)).toEqual([
                null,
                '1',
                null,
                null,
                null,
                null,
                null,
            ]);
            expect(harness.view.contentDOM.querySelectorAll('.cm-codeblock-line-numbers')).toHaveLength(1);
        } finally {
            harness.destroy();
        }
    });

    it('skips blocks that opt out with ln=false while the setting is on', () => {
        const harness = createHarness('```ts ln=false\na\n```\n\n```ts\nb\n```');

        try {
            expect(getNumbers(harness)).toEqual(['1']);
            expect(harness.view.contentDOM.querySelectorAll('.cm-codeblock-line-numbers')).toHaveLength(1);
        } finally {
            harness.destroy();
        }
    });

    it('starts numbering from the start option and sizes the gutter to the largest number', () => {
        const harness = createHarness('```ts start=9\na\nb\n```', false);

        try {
            expect(getNumbers(harness)).toEqual(['9', '10']);
            const lines = harness.view.contentDOM.querySelectorAll<HTMLElement>('.cm-codeblock-line-numbers');
            for (const line of lines) {
                expect(line.style.getPropertyValue('--cm-codeblock-line-number-digits')).toBe('2');
            }
        } finally {
            harness.destroy();
        }
    });

    it('updates numbering when the info string options are edited', () => {
        const harness = createHarness('```ts\na\n```', false);

        try {
            expect(getNumbers(harness)).toEqual([]);

            harness.view.dispatch({ changes: { from: 5, insert: ' start=3' } });
            expect(getNumbers(harness)).toEqual(['3']);
        } finally {
            harness.destroy();
        }
    });

    it('highlights the hl lines without numbering them while numbers are off', () => {
        const harness = createHarness('```ts hl=1,3\na\nb\nc\n```', false);

        try {
            expect(getHighlightedTexts(harness)).toEqual(['a', 'c']);
            expect(harness.view.contentDOM.querySelector('.cm-codeblock-line-numbers')).toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('counts highlights from the start number alongside the line numbers', () => {
        const harness = createHarness('```ts start=10 hl=11-12\na\nb\nc\n```');

        try {
            expect(getHighlightedTexts(harness)).toEqual(['b', 'c']);
            expect(getNumbers(harness)).toEqual(['10', '11', '12']);
        } finally {
            harness.destroy();
        }
    });

    it('ignores highlights outside the block', () => {
        const harness = createHarness('```ts hl=5\na\n```\n\nafter', false);

        try {
            expect(getHighlightedTexts(harness)).toEqual([]);
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

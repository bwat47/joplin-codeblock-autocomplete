import {
    autocompletion,
    completionStatus,
    currentCompletions,
    pickedCompletion,
    startCompletion,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import { markdown } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { createEditorHarness } from '../../testUtils/editorHarness';
import { createCodeBlockCompleter, createFenceTriggerExtension } from './fenceAutocomplete';
import { applyPluginSettings, createSettingsExtension } from './pluginSettings';

const EMPTY_CLIENT_RECTS = {
    length: 0,
    item: () => null,
} as unknown as DOMRectList;

const ZERO_RECT = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({}),
} as DOMRect;

beforeAll(() => {
    if (typeof Range === 'undefined') return;

    // jsdom doesn't implement these, even though lib.dom types them as always present.
    const rangePrototype: Partial<Range> = Range.prototype;
    rangePrototype.getClientRects ??= () => EMPTY_CLIENT_RECTS;
    rangePrototype.getBoundingClientRect ??= () => ZERO_RECT;
});

function createCompletionContext(view: ReturnType<typeof createEditorHarness>['view']): CompletionContext {
    return {
        state: view.state,
        pos: view.state.selection.main.head,
    } as CompletionContext;
}

function getResultLabels(result: CompletionResult | null): string[] {
    return result?.options.map((option) => option.label) ?? [];
}

async function waitForActiveCompletion(view: ReturnType<typeof createEditorHarness>['view']): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
        if (completionStatus(view.state) === 'active') return;
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

/** Returns the labels CodeMirror displays after filtering and ranking the completer's options. */
async function getDisplayedLabels(doc: string, languages: string[]): Promise<string[]> {
    const harness = createEditorHarness(doc, {
        extensions: [
            createSettingsExtension(),
            autocompletion({ override: [createCodeBlockCompleter()], activateOnTyping: false }),
        ],
    });

    try {
        applyPluginSettings(harness.view, {
            enableLanguageAutocomplete: true,
            enableCopyWidget: false,
            enableLineNumbers: false,
            languages,
        });

        startCompletion(harness.view);
        await waitForActiveCompletion(harness.view);
        return currentCompletions(harness.view.state).map((completion) => completion.label);
    } finally {
        harness.destroy();
    }
}

function applyCompletion(
    view: ReturnType<typeof createEditorHarness>['view'],
    result: CompletionResult,
    label: string
): void {
    const completion = result.options.find((option) => option.label === label);
    if (!completion) {
        throw new Error(`Completion "${label}" was not found.`);
    }
    if (typeof completion.apply !== 'function') {
        throw new Error(`Completion "${label}" does not provide a function apply handler.`);
    }

    completion.apply(view, completion, result.from, view.state.selection.main.head);
}

describe('createCodeBlockCompleter', () => {
    it('starts at the language position and lists every language plus a no-language option', () => {
        const harness = createEditorHarness('```|', {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['python', 'javascript'],
            });

            const result = createCodeBlockCompleter()(createCompletionContext(harness.view));

            expect(result?.from).toBe(3);
            expect(result?.filter).not.toBe(false);
            expect(getResultLabels(result)).toEqual(['python', 'javascript', 'No language']);
        } finally {
            harness.destroy();
        }
    });

    it('shows the no-language option first, then languages alphabetically, for a bare fence', async () => {
        expect(await getDisplayedLabels('```|', ['python', 'javascript'])).toEqual([
            'No language',
            'javascript',
            'python',
        ]);
    });

    it('shows matching languages before a trailing custom language option', async () => {
        expect(await getDisplayedLabels('```py|', ['python', 'javascript'])).toEqual(['python', 'py']);
    });

    it('fuzzy-matches languages and ranks prefix matches above substring matches', async () => {
        expect(await getDisplayedLabels('```sc|', ['javascript', 'python', 'scss'])).toEqual([
            'scss',
            'javascript',
            'sc',
        ]);
    });

    it('matches non-adjacent characters in order', async () => {
        expect(await getDisplayedLabels('```jsn|', ['javascript', 'json'])).toEqual(['json', 'jsn']);
    });

    it('omits the custom language option when the typed language matches exactly', async () => {
        expect(await getDisplayedLabels('```Python|', ['python', 'pythonconsole'])).toEqual([
            'python',
            'pythonconsole',
        ]);
    });

    it('applies the selected language and inserts a matching closing fence', () => {
        const harness = createEditorHarness('  ~~~~|', {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['json'],
            });

            const completer = createCodeBlockCompleter();
            const result = completer(createCompletionContext(harness.view));
            if (!result) {
                throw new Error('Expected completions for an opening fence.');
            }

            applyCompletion(harness.view, result, 'json');

            expect(harness.getText()).toBe('  ~~~~json\n  \n  ~~~~');
            expect(harness.getCursor()).toBe(13);
        } finally {
            harness.destroy();
        }
    });

    it('marks the inserted change as a picked completion', () => {
        const transactions: Transaction[] = [];
        const harness = createEditorHarness('```|', {
            extensions: [
                createSettingsExtension(),
                EditorView.updateListener.of((update) => transactions.push(...update.transactions)),
            ],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['json'],
            });

            const result = createCodeBlockCompleter()(createCompletionContext(harness.view));
            const completion = result?.options.find((option) => option.label === 'json');
            if (!result || !completion) {
                throw new Error('Expected a json completion for an opening fence.');
            }

            transactions.length = 0;
            applyCompletion(harness.view, result, 'json');

            expect(transactions).toHaveLength(1);
            expect(transactions[0]!.annotation(pickedCompletion)).toBe(completion);
            expect(transactions[0]!.isUserEvent('input.complete')).toBe(true);
        } finally {
            harness.destroy();
        }
    });

    it('places the cursor on the blank line in a CRLF document', () => {
        // A document line break is one position even when the separator is two characters.
        const harness = createEditorHarness('```', {
            rawInput: true,
            extensions: [createSettingsExtension(), EditorState.lineSeparator.of('\r\n')],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['json'],
            });

            harness.view.dispatch({ selection: EditorSelection.cursor(3) });

            const completer = createCodeBlockCompleter();
            const result = completer(createCompletionContext(harness.view));
            if (!result) {
                throw new Error('Expected completions for an opening fence.');
            }

            applyCompletion(harness.view, result, 'json');

            // `Text.toString` joins lines with '\n' regardless of the configured separator.
            expect(harness.getText()).toBe('```json\n\n```');
            expect(harness.getCursor()).toBe(8);
        } finally {
            harness.destroy();
        }
    });

    it('applies the selected language at every cursor in a multi-cursor selection', () => {
        const harness = createEditorHarness('```\n~~~py', {
            rawInput: true,
            extensions: [createSettingsExtension(), EditorState.allowMultipleSelections.of(true)],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['json'],
            });

            // Cursor after the bare ``` fence and after the ~~~py fence.
            harness.view.dispatch({
                selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(9)]),
            });

            const completer = createCodeBlockCompleter();
            const result = completer(createCompletionContext(harness.view));
            if (!result) {
                throw new Error('Expected completions for an opening fence.');
            }

            applyCompletion(harness.view, result, 'json');

            expect(harness.getText()).toBe('```json\n\n```\n~~~json\n\n~~~');
            expect(harness.view.state.selection.ranges.map((range) => range.head)).toEqual([8, 21]);
        } finally {
            harness.destroy();
        }
    });

    it.each([
        ['after a space following the language', '```ts |'],
        ['while typing an option', '```ts ln|'],
        ['while typing a quoted option', '```ts title="a b|'],
        ['after a space following a bare fence', '``` |'],
    ])('offers no languages %s', (_name, doc) => {
        const harness = createEditorHarness(doc, {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['typescript'],
            });

            const completer = createCodeBlockCompleter();
            expect(completer(createCompletionContext(harness.view))).toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('still offers languages while editing the language before existing options', async () => {
        expect(await getDisplayedLabels('```ty| ln', ['typescript'])).toEqual(['typescript', 'ty']);
    });

    it('returns null when language autocomplete is disabled', () => {
        const harness = createEditorHarness('```py|', {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: false,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['python'],
            });

            const completer = createCodeBlockCompleter();
            const result = completer(createCompletionContext(harness.view));

            expect(result).toBeNull();
        } finally {
            harness.destroy();
        }
    });
});

describe('createFenceTriggerExtension', () => {
    it('lets CodeMirror open language completions through normal typed-input activation', async () => {
        const codeBlockCompleter = createCodeBlockCompleter();
        const harness = createEditorHarness('', {
            rawInput: true,
            extensions: [
                createSettingsExtension(),
                autocompletion({ override: [codeBlockCompleter], activateOnTypingDelay: 0 }),
                createFenceTriggerExtension(),
            ],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['python', 'javascript'],
            });

            harness.view.dispatch({
                changes: { from: 0, insert: '```' },
                selection: { anchor: 3 },
                annotations: Transaction.userEvent.of('input.type'),
            });
            await waitForActiveCompletion(harness.view);

            expect(harness.getText()).toBe('```');
            expect(completionStatus(harness.view.state)).toBe('active');
            expect(currentCompletions(harness.view.state).map((completion) => completion.label)).toEqual([
                'No language',
                'javascript',
                'python',
            ]);
        } finally {
            harness.destroy();
        }
    });

    it('auto-inserts a closing fence when autocomplete is disabled', () => {
        const harness = createEditorHarness('', {
            rawInput: true,
            extensions: [createSettingsExtension(), createFenceTriggerExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: false,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['python'],
            });

            harness.view.dispatch({
                changes: { from: 0, insert: '```' },
                selection: { anchor: 3 },
                annotations: Transaction.userEvent.of('input.type'),
            });

            expect(harness.getText()).toBe('```\n```');
            expect(harness.getCursor()).toBe(3);
        } finally {
            harness.destroy();
        }
    });

    it('auto-inserts a closing fence at every cursor in a multi-cursor selection', () => {
        const harness = createEditorHarness('\n', {
            rawInput: true,
            extensions: [
                createSettingsExtension(),
                createFenceTriggerExtension(),
                EditorState.allowMultipleSelections.of(true),
            ],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: false,
                enableCopyWidget: false,
                enableLineNumbers: false,
                languages: ['python'],
            });

            // Type ``` on both empty lines at once.
            harness.view.dispatch({
                changes: [
                    { from: 0, insert: '```' },
                    { from: 1, insert: '```' },
                ],
                selection: EditorSelection.create([EditorSelection.cursor(3), EditorSelection.cursor(7)]),
                annotations: Transaction.userEvent.of('input.type'),
            });

            expect(harness.getText()).toBe('```\n```\n```\n```');
            expect(harness.view.state.selection.ranges.map((range) => range.head)).toEqual([3, 11]);
        } finally {
            harness.destroy();
        }
    });
});

describe('closing fence on language completion', () => {
    function createMarkdownHarness(doc: string): ReturnType<typeof createEditorHarness> {
        const harness = createEditorHarness(doc, {
            extensions: [markdown(), createSettingsExtension(), createFenceTriggerExtension()],
        });
        applyPluginSettings(harness.view, {
            enableLanguageAutocomplete: true,
            enableCopyWidget: false,
            enableLineNumbers: false,
            languages: ['python', 'javascript'],
        });
        return harness;
    }

    function typeText(view: EditorView, text: string): void {
        const pos = view.state.selection.main.head;
        view.dispatch({
            changes: { from: pos, insert: text },
            selection: { anchor: pos + text.length },
            userEvent: 'input.type',
        });
    }

    function deleteBackward(view: EditorView, count: number): void {
        const pos = view.state.selection.main.head;
        view.dispatch({
            changes: { from: pos - count, to: pos },
            selection: { anchor: pos - count },
            userEvent: 'delete.backward',
        });
    }

    function complete(view: EditorView, label: string): void {
        const result = createCodeBlockCompleter()(createCompletionContext(view));
        if (!result) {
            throw new Error('Expected completions for an opening fence.');
        }
        applyCompletion(view, result, label);
    }

    it('changes the language of an existing block without adding a closing fence', () => {
        const harness = createMarkdownHarness('```js|\ncode\n```\n');

        try {
            deleteBackward(harness.view, 2);
            typeText(harness.view, 'py');
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('```python\ncode\n```\n');
            expect(harness.getCursor()).toBe(9);
        } finally {
            harness.destroy();
        }
    });

    it('replaces the whole language word when the cursor is inside it', () => {
        const harness = createMarkdownHarness('```py|thon\ncode\n```');

        try {
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('```python\ncode\n```');
        } finally {
            harness.destroy();
        }
    });

    it('keeps a fence existing when Enter is pressed at the start of its line', () => {
        const harness = createMarkdownHarness('|```ja\ncode\n```');

        try {
            typeText(harness.view, '\n');
            harness.view.dispatch({ selection: { anchor: 6 } });
            complete(harness.view, 'javascript');

            expect(harness.getText()).toBe('\n```javascript\ncode\n```');
        } finally {
            harness.destroy();
        }
    });

    it('closes a fence typed above an existing block', () => {
        // The new fence pairs with the existing block's closing fence, so only its history shows it is new.
        const harness = createMarkdownHarness('|\nparagraph\n```js\ncode\n```');

        try {
            typeText(harness.view, '`');
            typeText(harness.view, '`');
            typeText(harness.view, '`');
            typeText(harness.view, 'py');
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('```python\n\n```\nparagraph\n```js\ncode\n```');
            expect(harness.getCursor()).toBe(10);
        } finally {
            harness.destroy();
        }
    });

    it('closes a fence created by pressing Enter before mid-line backticks', () => {
        const harness = createMarkdownHarness('text|```\nparagraph\n```js\ncode\n```');

        try {
            typeText(harness.view, '\n');
            harness.view.dispatch({ selection: { anchor: 8 } });
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('text\n```python\n\n```\nparagraph\n```js\ncode\n```');
        } finally {
            harness.destroy();
        }
    });

    it('closes an existing fence that runs unclosed to the end of the document', () => {
        const harness = createMarkdownHarness('```|\ncode');

        try {
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('```python\n\n```\ncode');
        } finally {
            harness.destroy();
        }
    });

    it('adds no closing fence to fence text inside an enclosing block', () => {
        const harness = createMarkdownHarness('````md\n```|\n````');

        try {
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('````md\n```python\n````');
        } finally {
            harness.destroy();
        }
    });

    it('treats a fresh fence as existing once the cursor has left its line', () => {
        const harness = createMarkdownHarness('|\n```js\ncode\n```');

        try {
            typeText(harness.view, '```');
            harness.view.dispatch({ selection: { anchor: harness.view.state.doc.length } });
            harness.view.dispatch({ selection: { anchor: 3 } });
            complete(harness.view, 'python');

            // The fence now pairs with the next fence line, which is the documented limit of this rule.
            expect(harness.getText()).toBe('```python\n```js\ncode\n```');
        } finally {
            harness.destroy();
        }
    });
    it('offers no languages on a bare closing fence', () => {
        const harness = createMarkdownHarness('```js\ncode\n```|');

        try {
            expect(createCodeBlockCompleter()(createCompletionContext(harness.view))).toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('offers no languages while typing after a closing fence', () => {
        // Once text follows it, the closing fence parses as an opening fence; its history says otherwise.
        const harness = createMarkdownHarness('```js\ncode\n```|\n');

        try {
            typeText(harness.view, 'p');
            expect(createCodeBlockCompleter()(createCompletionContext(harness.view))).toBeNull();
            typeText(harness.view, 'y');
            expect(createCodeBlockCompleter()(createCompletionContext(harness.view))).toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('offers no languages on a fence typed inside a block, which closes that block', () => {
        const harness = createMarkdownHarness('```js\none\n|\ntwo\n```');

        try {
            typeText(harness.view, '```');
            expect(createCodeBlockCompleter()(createCompletionContext(harness.view))).toBeNull();
            typeText(harness.view, 'p');
            expect(createCodeBlockCompleter()(createCompletionContext(harness.view))).toBeNull();
        } finally {
            harness.destroy();
        }
    });

    it('still offers languages on an opening fence after a closed block', () => {
        const harness = createMarkdownHarness('```js\ncode\n```\n\n|');

        try {
            typeText(harness.view, '```');
            typeText(harness.view, 'py');
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('```js\ncode\n```\n\n```python\n\n```');
        } finally {
            harness.destroy();
        }
    });

    it.each([
        ['indenting with spaces', '```py|\ncode\n```', { from: 0, insert: '  ' }, '  ```python\ncode\n```'],
        ['indenting with a tab', '```py|\ncode\n```', { from: 0, insert: '\t' }, '\t```python\ncode\n```'],
        ['unindenting', '  ```py|\ncode\n```', { from: 0, to: 2 }, '```python\ncode\n```'],
    ])('keeps a fence existing after %s its line', (_name, doc, change, expected) => {
        const harness = createMarkdownHarness(doc);

        try {
            harness.view.dispatch({ changes: change, userEvent: 'input.indent' });
            harness.view.dispatch({ selection: { anchor: harness.view.state.doc.line(1).to } });
            typeText(harness.view, 'th');
            complete(harness.view, 'python');

            expect(harness.getText()).toBe(expected);
        } finally {
            harness.destroy();
        }
    });

    it('closes a fence created by deleting the text before it', () => {
        const harness = createMarkdownHarness('x|```\nparagraph\n```js\ncode\n```');

        try {
            deleteBackward(harness.view, 1);
            harness.view.dispatch({ selection: { anchor: 3 } });
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('```python\n\n```\nparagraph\n```js\ncode\n```');
        } finally {
            harness.destroy();
        }
    });

    it('offers languages on a fence pasted over a whole block', () => {
        const harness = createMarkdownHarness('before\n[[```js\ncode\n```]]\nafter');

        try {
            const { from, to } = harness.view.state.selection.main;
            harness.view.dispatch({
                changes: { from, to, insert: '```py' },
                selection: { anchor: from + 5 },
                userEvent: 'input.paste',
            });
            complete(harness.view, 'python');

            expect(harness.getText()).toBe('before\n```python\n\n```\nafter');
        } finally {
            harness.destroy();
        }
    });

    it('offers no languages after replacing a selection that ends just before a closing fence', () => {
        const harness = createMarkdownHarness('```js\n[[code\n]]```');

        try {
            const { from, to } = harness.view.state.selection.main;
            harness.view.dispatch({ changes: { from, to, insert: 'more\n' }, userEvent: 'input.paste' });
            harness.view.dispatch({ selection: { anchor: harness.view.state.doc.length } });
            typeText(harness.view, 'p');

            expect(createCodeBlockCompleter()(createCompletionContext(harness.view))).toBeNull();
        } finally {
            harness.destroy();
        }
    });
});

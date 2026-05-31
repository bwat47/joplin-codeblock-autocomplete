import {
    autocompletion,
    completionStatus,
    currentCompletions,
    type Completion,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import { Transaction } from '@codemirror/state';
import { applyPluginSettings, createSettingsExtension } from './pluginSettings';
import { createCodeBlockCompleter, createFenceTriggerExtension } from './fenceAutocomplete';
import { createEditorHarness } from '../testUtils/editorHarness';

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

    if (!Range.prototype.getClientRects) {
        Range.prototype.getClientRects = () => EMPTY_CLIENT_RECTS;
    }
    if (!Range.prototype.getBoundingClientRect) {
        Range.prototype.getBoundingClientRect = () => ZERO_RECT;
    }
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

    completion.apply(view, completion as Completion, result.from, view.state.selection.main.head);
}

describe('createCodeBlockCompleter', () => {
    it('returns sorted language completions and a no-language option for a bare fence', () => {
        const harness = createEditorHarness('```|', {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                languages: ['python', 'javascript'],
            });

            const completer = createCodeBlockCompleter();
            const result = completer(createCompletionContext(harness.view));

            expect(result?.from).toBe(3);
            expect(getResultLabels(result)).toEqual(['No language', 'javascript', 'python']);
        } finally {
            harness.destroy();
        }
    });

    it('includes a custom language option for partial input without an exact match', () => {
        const harness = createEditorHarness('```py|', {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
                languages: ['python', 'javascript'],
            });

            const completer = createCodeBlockCompleter();
            const result = completer(createCompletionContext(harness.view));

            expect(result?.from).toBe(3);
            expect(getResultLabels(result)).toEqual(['python', 'py']);
        } finally {
            harness.destroy();
        }
    });

    it('applies the selected language and inserts a matching closing fence', () => {
        const harness = createEditorHarness('  ~~~~|', {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: true,
                enableCopyWidget: false,
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

    it('returns null when language autocomplete is disabled', () => {
        const harness = createEditorHarness('```py|', {
            extensions: [createSettingsExtension()],
        });

        try {
            applyPluginSettings(harness.view, {
                enableLanguageAutocomplete: false,
                enableCopyWidget: false,
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
});

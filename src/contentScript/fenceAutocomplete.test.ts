import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { Transaction } from '@codemirror/state';
import { applyPluginSettings, createSettingsExtension } from './pluginSettings';
import { createCodeBlockCompleter, createFenceTriggerExtension } from './fenceAutocomplete';
import { createEditorHarness } from '../testUtils/editorHarness';

function createCompletionContext(view: ReturnType<typeof createEditorHarness>['view']): CompletionContext {
    return {
        state: view.state,
        pos: view.state.selection.main.head,
    } as CompletionContext;
}

function getResultLabels(result: CompletionResult | null): string[] {
    return result?.options.map((option) => option.label) ?? [];
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

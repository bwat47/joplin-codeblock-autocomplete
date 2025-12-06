import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { Completion, autocompletion, startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import type { Extension, Transaction } from '@codemirror/state';
import type { PluginContext, JoplinCodeMirror } from './types';

/** Cached languages list from settings */
let cachedLanguages: string[] = [];

/**
 * Fetches the language list from plugin settings
 */
async function fetchLanguages(context: PluginContext): Promise<string[]> {
    try {
        const response = (await context.postMessage({ command: 'getLanguages' })) as {
            languages: string[];
        } | null;
        if (response?.languages) {
            cachedLanguages = response.languages;
            return cachedLanguages;
        }
    } catch (error) {
        console.error('Failed to fetch languages:', error);
    }
    return cachedLanguages;
}

export default function codeMirror6Plugin(context: PluginContext, CodeMirror: JoplinCodeMirror): void {
    console.log('Codeblock autocomplete plugin loaded');

    // Fetch languages on startup
    fetchLanguages(context);

    // The core logic function
    const codeBlockCompleter = async (completionContext: CompletionContext): Promise<CompletionResult | null> => {
        // Match three backticks followed by optional word characters
        const prefix = completionContext.matchBefore(/```\w*/);

        console.log('codeBlockCompleter called, prefix:', prefix);

        if (!prefix) {
            return null;
        }

        // Refresh languages from settings
        const languages = await fetchLanguages(context);

        // Build completion options
        const options: Completion[] = [];

        // First option: empty code block (just ```)
        options.push({
            label: '```',
            detail: 'empty code block',
            apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
                const lineBreak = view.state.lineBreak || '\n';
                const backtickStart = from - 3;
                const insertText = `\`\`\`${lineBreak}${lineBreak}\`\`\``;

                const transaction = view.state.update({
                    changes: { from: backtickStart, to, insert: insertText },
                    // Position cursor on the empty line inside the block
                    selection: { anchor: backtickStart + 3 + lineBreak.length },
                });

                view.dispatch(transaction);
            },
        });

        // Add language options from settings
        for (const lang of languages) {
            options.push({
                label: lang,
                detail: 'code block',
                apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
                    const lineBreak = view.state.lineBreak || '\n';
                    const backtickStart = from - 3;
                    const insertText = `\`\`\`${lang}${lineBreak}${lineBreak}\`\`\``;

                    const transaction = view.state.update({
                        changes: { from: backtickStart, to, insert: insertText },
                        selection: { anchor: backtickStart + 3 + lang.length + lineBreak.length },
                    });

                    view.dispatch(transaction);
                },
            });
        }

        console.log('Returning completions:', options.length);

        return {
            from: prefix.to,
            options: options,
            filter: true,
            validFor: /^\w*$/,
        };
    };

    // Create an input handler that triggers completion when ``` is typed
    const triggerCompletionOnBackticks = EditorView.updateListener.of((update: ViewUpdate) => {
        if (!update.docChanged) return;

        // Check if the change involves typing
        update.transactions.forEach((tr: Transaction) => {
            if (tr.isUserEvent('input.type')) {
                const state = update.state;
                const pos = state.selection.main.head;

                // Look back to see if we just completed typing ```
                if (pos >= 3) {
                    const textBefore = state.doc.sliceString(pos - 3, pos);
                    if (textBefore === '```') {
                        console.log('Detected ```, triggering completion');
                        // Small delay to let the document update settle
                        setTimeout(() => {
                            startCompletion(update.view);
                        }, 10);
                    }
                }
            }
        });
    });

    // Register with Joplin's extension system
    let completionExt: Extension;
    if (CodeMirror.joplinExtensions) {
        completionExt = CodeMirror.joplinExtensions.completionSource(codeBlockCompleter);
    } else {
        // Fallback for older setups
        completionExt = autocompletion({ override: [codeBlockCompleter] });
    }

    CodeMirror.addExtension([completionExt, triggerCompletionOnBackticks]);
}

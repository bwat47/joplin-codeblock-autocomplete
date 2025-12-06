import type { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import type { Extension, Transaction } from '@codemirror/state';
import type { PluginContext, JoplinCodeMirror } from './types';

const LANGUAGES = [
    { label: 'javascript', type: 'text' },
    { label: 'typescript', type: 'text' },
    { label: 'python', type: 'text' },
    { label: 'bash', type: 'text' },
    { label: 'html', type: 'text' },
    { label: 'css', type: 'text' },
    { label: 'sql', type: 'text' },
    { label: 'json', type: 'text' },
    { label: 'text', type: 'text', info: 'Plain text' }, // Generic block
];

export default function codeMirror6Plugin(_context: PluginContext, CodeMirror: JoplinCodeMirror): void {
    // Dynamic imports to match Joplin's environment
    // These must be require() calls because the modules are provided by Joplin at runtime
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autocompletion, startCompletion } = require('@codemirror/autocomplete');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { EditorView: CM6EditorView } = require('@codemirror/view');

    console.log('Codeblock autocomplete plugin loaded');

    // The core logic function
    const codeBlockCompleter = async (context: CompletionContext): Promise<CompletionResult | null> => {
        // Match three backticks followed by optional word characters
        // Using literal backticks in the pattern
        const prefix = context.matchBefore(/```\w*/);

        console.log('codeBlockCompleter called, prefix:', prefix);

        // If no match found, don't show completions
        if (!prefix) {
            return null;
        }

        // Prepare the options
        const options: Completion[] = LANGUAGES.map((lang) => ({
            label: lang.label,
            detail: 'code block', // Appears in gray next to the option

            // Custom Apply Function
            // This handles replacing the trigger and positioning the cursor
            apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
                const lineBreak = view.state.lineBreak || '\n';

                // Since 'from' in the result is set to prefix.to (after the ```),
                // we need to replace starting from before the backticks
                const backtickStart = from - 3; // Go back 3 characters to include ```

                // Construct the full block: ```lang \n \n ```
                const insertText = `\`\`\`${lang.label}${lineBreak}${lineBreak}\`\`\``;

                const transaction = view.state.update({
                    changes: { from: backtickStart, to, insert: insertText },
                    // Calculate cursor position:
                    // Start + 3 (backticks) + lang length + 1 (first newline)
                    selection: { anchor: backtickStart + 3 + lang.label.length + lineBreak.length },
                });

                view.dispatch(transaction);
            },
        }));

        console.log('Returning completions:', options.length);

        // Return the result to CodeMirror
        // Set 'from' to after the backticks so the language name replaces nothing initially
        // This allows the completion to show all options when just ``` is typed
        return {
            from: prefix.to, // Start completion from cursor position (after ```)
            options: options,
            filter: true,
            // validFor ensures the completion stays active while typing language name
            validFor: /^\w*$/,
        };
    };

    // Create an input handler that triggers completion when ``` is typed
    const triggerCompletionOnBackticks = CM6EditorView.updateListener.of((update: ViewUpdate) => {
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
                            console.log('Calling startCompletion on view:', update.view);
                            const result = startCompletion(update.view);
                            console.log('startCompletion result:', result);
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

/**
 * CodeMirror 6 plugin for code block language autocompletion.
 */
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { Completion, autocompletion, startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import type { Extension, Transaction } from '@codemirror/state';
import type { PluginContext, JoplinCodeMirror } from './types';
import { logger } from '../logger';

let cachedLanguages: string[] = [];

/** Fetches language list from plugin settings via postMessage */
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
        logger.error('Failed to fetch languages:', error);
    }
    return cachedLanguages;
}

/**
 * Creates a completion apply function for code blocks.
 * @param lang - Language identifier (empty string for plain code block)
 * @param prefixLength - Length of the matched prefix (e.g., 3 for ```, 9 for ```python)
 * @param backtickCount - Number of backticks in the fence (minimum 3, supports 4+)
 */
function createApplyFunction(lang: string, prefixLength: number, backtickCount: number) {
    return (view: EditorView, _completion: Completion, from: number, to: number) => {
        const lineBreak = view.state.lineBreak || '\n';
        const backtickStart = from - prefixLength;
        const fence = '`'.repeat(backtickCount);
        const insertText = lang
            ? `${fence}${lang}${lineBreak}${lineBreak}${fence}`
            : `${fence}${lineBreak}${lineBreak}${fence}`;
        const cursorOffset = lang
            ? backtickStart + backtickCount + lang.length + lineBreak.length
            : backtickStart + backtickCount + lineBreak.length;

        view.dispatch(
            view.state.update({
                changes: { from: backtickStart, to, insert: insertText },
                selection: { anchor: cursorOffset },
            })
        );
    };
}

/** Registers CodeMirror extensions for code block autocompletion */
export default function codeMirror6Plugin(context: PluginContext, CodeMirror: JoplinCodeMirror): void {
    fetchLanguages(context);

    /**
     * Autocomplete source for code blocks.
     * Matches 3 or more backticks followed by optional word characters.
     * Supports nested code blocks with matching fence lengths.
     */
    const codeBlockCompleter = async (completionContext: CompletionContext): Promise<CompletionResult | null> => {
        const prefix = completionContext.matchBefore(/```+\w*/);
        if (!prefix) {
            return null;
        }

        const prefixLength = prefix.text.length;

        // Count the number of backticks (all leading backticks before any word characters)
        // Supports 3+ backticks for nested code blocks
        const backtickMatch = prefix.text.match(/^`+/);
        const backtickCount = backtickMatch ? backtickMatch[0].length : 3;

        const languages = await fetchLanguages(context);
        const options: Completion[] = [
            {
                label: '```',
                detail: 'empty code block',
                apply: createApplyFunction('', prefixLength, backtickCount),
            },
            ...languages.map((lang) => ({
                label: lang,
                detail: 'code block',
                apply: createApplyFunction(lang, prefixLength, backtickCount),
            })),
        ];

        return {
            from: prefix.to,
            options,
            filter: true,
            validFor: /^\w*$/,
        };
    };

    const triggerCompletionOnBackticks = EditorView.updateListener.of((update: ViewUpdate) => {
        if (!update.docChanged) return;

        update.transactions.forEach((tr: Transaction) => {
            if (tr.isUserEvent('input.type')) {
                const pos = update.state.selection.main.head;
                if (pos >= 3 && update.state.doc.sliceString(pos - 3, pos) === '```') {
                    setTimeout(() => startCompletion(update.view), 10);
                }
            }
        });
    });

    let completionExt: Extension;
    if (CodeMirror.joplinExtensions) {
        completionExt = CodeMirror.joplinExtensions.completionSource(codeBlockCompleter);
    } else {
        completionExt = autocompletion({ override: [codeBlockCompleter] });
    }

    CodeMirror.addExtension([completionExt, triggerCompletionOnBackticks]);
}

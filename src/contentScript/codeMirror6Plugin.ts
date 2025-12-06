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

/** Creates a completion apply function for code blocks */
function createApplyFunction(lang: string) {
    return (view: EditorView, _completion: Completion, from: number, to: number) => {
        const lineBreak = view.state.lineBreak || '\n';
        const backtickStart = from - 3;
        const insertText = lang
            ? `\`\`\`${lang}${lineBreak}${lineBreak}\`\`\``
            : `\`\`\`${lineBreak}${lineBreak}\`\`\``;
        const cursorOffset = lang
            ? backtickStart + 3 + lang.length + lineBreak.length
            : backtickStart + 3 + lineBreak.length;

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

    const codeBlockCompleter = async (completionContext: CompletionContext): Promise<CompletionResult | null> => {
        const prefix = completionContext.matchBefore(/```\w*/);
        if (!prefix) {
            return null;
        }

        const languages = await fetchLanguages(context);
        const options: Completion[] = [
            { label: '```', detail: 'empty code block', apply: createApplyFunction('') },
            ...languages.map((lang) => ({
                label: lang,
                detail: 'code block',
                apply: createApplyFunction(lang),
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

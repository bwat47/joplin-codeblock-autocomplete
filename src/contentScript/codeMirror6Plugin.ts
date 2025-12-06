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
 * Parse the opening fence at the current cursor position.
 * Returns fence details or undefined if not at a valid fence position.
 */
function parseOpeningFence(
    state: CompletionContext['state'],
    pos: number
): { indent: string; backtickCount: number; typedLang: string } | undefined {
    const line = state.doc.lineAt(pos);
    const lineText = line.text;
    const lineStartPos = line.from;

    // Match: optional indent + backticks + optional language
    const match = lineText.match(/^(\s*)(`{3,})([^\s`]*)/);
    if (!match) return undefined;

    const indent = match[1];
    const backticks = match[2];
    const typedLang = match[3];

    // Cursor must be after the backticks (either at end of line or after language)
    const fenceStart = lineStartPos + indent.length;
    if (pos < fenceStart + backticks.length) return undefined;

    return {
        indent,
        backtickCount: backticks.length,
        typedLang,
    };
}

/**
 * Creates a completion apply function that inserts remaining language text and closing fence.
 * Insert from cursor, not replace from start.
 */
function createApplyFunction(
    desiredLang: string,
    openingFence: { indent: string; backtickCount: number; typedLang: string }
) {
    return (view: EditorView, _completion: Completion, from: number) => {
        const lineBreak = view.state.lineBreak || '\n';
        const { indent, backtickCount, typedLang } = openingFence;
        const fence = '`'.repeat(backtickCount);

        // Calculate what's left to type for the language name
        const remainingLang = desiredLang.slice(typedLang.length);

        // Insert: remaining language + newlines + closing fence
        const insertText = `${remainingLang}${lineBreak}${lineBreak}${indent}${fence}`;

        // Position cursor on the empty line inside the block
        const cursorOffset = from + remainingLang.length + lineBreak.length;

        view.dispatch(
            view.state.update({
                changes: { from, insert: insertText },
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
     * Parses current line, inserts only remaining text.
     * Supports nested code blocks with matching fence lengths and custom languages.
     */
    const codeBlockCompleter = async (completionContext: CompletionContext): Promise<CompletionResult | null> => {
        const { state, pos } = completionContext;

        // Parse the opening fence at cursor position
        const openingFence = parseOpeningFence(state, pos);
        if (!openingFence) return null;

        const { typedLang } = openingFence;
        const languages = await fetchLanguages(context);

        // Find languages that match what the user has typed so far (case-insensitive)
        const typedLangLower = typedLang.toLowerCase();
        const matchedLanguages = languages.filter((lang) => lang.toLowerCase().startsWith(typedLangLower));

        const options: Completion[] = [];

        // Add matching language options
        matchedLanguages.forEach((lang) => {
            options.push({
                label: lang,
                detail: '',
                apply: createApplyFunction(lang, openingFence),
            });
        });

        // If typed text doesn't exactly match a language, add it as a custom option
        const isExactMatch = matchedLanguages.includes(typedLang);
        if (typedLang && !isExactMatch) {
            // Add custom language with lower priority
            options.push({
                label: typedLang,
                detail: 'custom language',
                apply: createApplyFunction(typedLang, openingFence),
                boost: -1,
            });
        }

        // Add empty code block option only if no language has been typed
        if (!typedLang) {
            options.unshift({
                label: '',
                detail: 'empty code block',
                apply: createApplyFunction('', openingFence),
            });
        }

        return {
            from: pos,
            options,
        };
    };

    const triggerCompletionOnBackticks = EditorView.updateListener.of((update: ViewUpdate) => {
        if (!update.docChanged) return;

        update.transactions.forEach((tr: Transaction) => {
            if (tr.isUserEvent('input.type')) {
                const pos = update.state.selection.main.head;
                if (pos >= 3 && update.state.doc.sliceString(pos - 3, pos) === '```') {
                    // Only trigger if there's only whitespace before the backticks on the line
                    // This prevents triggering in the middle of text like "some text ```"
                    const line = update.state.doc.lineAt(pos);
                    const backtickPosInLine = pos - line.from;
                    const textBeforeBackticks = line.text.slice(0, backtickPosInLine - 3);

                    if (/^\s*$/.test(textBeforeBackticks)) {
                        setTimeout(() => startCompletion(update.view), 10);
                    }
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

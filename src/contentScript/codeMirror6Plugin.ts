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
let hasFetched = false;

async function updateLanguages(context: PluginContext): Promise<string[]> {
    try {
        const response = (await context.postMessage({ command: 'getLanguages' })) as {
            languages: string[];
        } | null;
        if (response?.languages) {
            cachedLanguages = response.languages;
            hasFetched = true;
        }
    } catch (error) {
        logger.error('Failed to fetch languages:', error);
    }
    return cachedLanguages;
}

/** Fetches language list from plugin settings via postMessage */
async function fetchLanguages(context: PluginContext): Promise<string[]> {
    if (hasFetched) {
        // Update in background to keep cache fresh without blocking
        void updateLanguages(context);
        return cachedLanguages;
    }
    return await updateLanguages(context);
}

/**
 * Parse the opening fence at the current cursor position.
 * Returns fence details or undefined if not at a valid fence position.
 */
function parseOpeningFence(
    state: CompletionContext['state'],
    pos: number
): { indent: string; backtickCount: number; typedLang: string; languageStartPos: number } | undefined {
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

    // Calculate where the language name starts (right after the backticks)
    const languageStartPos = fenceStart + backticks.length;

    return {
        indent,
        backtickCount: backticks.length,
        typedLang,
        languageStartPos,
    };
}

/**
 * Creates a completion apply function that replaces typed language and inserts closing fence.
 * Replaces from languageStartPos to current cursor position.
 */
function createApplyFunction(
    desiredLang: string,
    openingFence: { indent: string; backtickCount: number; typedLang: string }
) {
    return (view: EditorView, _completion: Completion, from: number) => {
        const lineBreak = view.state.lineBreak || '\n';
        const { indent, backtickCount } = openingFence;
        const fence = '`'.repeat(backtickCount);

        // Get current cursor position to determine range to replace
        const currentPos = view.state.selection.main.head;

        // Insert: full language + newlines + closing fence
        const insertText = `${desiredLang}${lineBreak}${indent}${lineBreak}${indent}${fence}`;

        // Position cursor on the empty line inside the block
        const cursorOffset = from + desiredLang.length + lineBreak.length + indent.length;

        view.dispatch(
            view.state.update({
                changes: { from, to: currentPos, insert: insertText },
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
        const matchedLanguages = languages
            .filter((lang) => lang.toLowerCase().startsWith(typedLangLower))
            .sort((a, b) => a.localeCompare(b));

        // Build options in explicit order: matched languages first, then custom language
        const matchedOptions: Completion[] = [];
        const customOptions: Completion[] = [];

        // Add matching language options
        matchedLanguages.forEach((lang) => {
            matchedOptions.push({
                label: lang,
                detail: '',
                apply: createApplyFunction(lang, openingFence),
            });
        });

        // If typed text doesn't exactly match a language, add it as a custom option
        const isExactMatch = matchedLanguages.includes(typedLang);
        if (typedLang && !isExactMatch) {
            customOptions.push({
                label: typedLang,
                detail: 'custom language',
                apply: createApplyFunction(typedLang, openingFence),
            });
        }

        // Combine in order: matched first, then custom
        const options = [...matchedOptions, ...customOptions];

        // Add No language option at the beginning if no language has been typed
        if (!typedLang) {
            options.unshift({
                label: 'No language',
                detail: '',
                apply: createApplyFunction('', openingFence),
            });
        }

        return {
            from: openingFence.languageStartPos,
            options,
            filter: false, // Disable automatic filtering/sorting to preserve our order
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

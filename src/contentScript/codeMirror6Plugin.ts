/**
 * CodeMirror 6 plugin for code block language autocompletion.
 */
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { Completion, autocompletion, startCompletion } from '@codemirror/autocomplete';
import type { Extension, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import type { PluginContext, JoplinCodeMirror } from './types';
import { LanguageCache } from './LanguageCache';

/**
 * Parse the opening fence at the current cursor position.
 * Supports both backtick (```) and tilde (~~~) style fences.
 * Returns fence details or undefined if not at a valid fence position.
 */
function parseOpeningFence(
    state: CompletionContext['state'],
    pos: number
): { indent: string; fenceChar: string; fenceCount: number; typedLang: string; languageStartPos: number } | undefined {
    const line = state.doc.lineAt(pos);
    const lineText = line.text;
    const lineStartPos = line.from;

    // Match: optional indent + (3+ backticks OR 3+ tildes) + optional language
    // Backticks: language cannot contain backticks
    // Tildes: language cannot contain spaces (per CommonMark)
    const match = lineText.match(/^(\s*)(`{3,}|~{3,})([^\s`]*)/);
    if (!match) return undefined;

    const indent = match[1];
    const fence = match[2];
    const fenceChar = fence[0]; // '`' or '~'
    const typedLang = match[3];

    // Cursor must be after the fence markers (either at end of line or after language)
    const fenceStart = lineStartPos + indent.length;
    if (pos < fenceStart + fence.length) return undefined;

    // Calculate where the language name starts (right after the fence markers)
    const languageStartPos = fenceStart + fence.length;

    return {
        indent,
        fenceChar,
        fenceCount: fence.length,
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
    openingFence: { indent: string; fenceChar: string; fenceCount: number; typedLang: string }
) {
    return (view: EditorView, _completion: Completion, from: number) => {
        const lineBreak = view.state.lineBreak || '\n';
        const { indent, fenceChar, fenceCount } = openingFence;
        const fence = fenceChar.repeat(fenceCount);

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
    const languageCache = LanguageCache.getInstance(context);
    void languageCache.getLanguages();

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
        const languages = await languageCache.getLanguages();

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

    const triggerCompletionOnFence = EditorView.updateListener.of((update: ViewUpdate) => {
        if (!update.docChanged) return;

        update.transactions.forEach((tr: Transaction) => {
            if (tr.isUserEvent('input.type')) {
                const pos = update.state.selection.main.head;
                const lastThreeChars = pos >= 3 ? update.state.doc.sliceString(pos - 3, pos) : '';

                // Check for both backtick (```) and tilde (~~~) fences
                if (lastThreeChars === '```' || lastThreeChars === '~~~') {
                    // Only trigger if there's only whitespace before the fence on the line
                    // This prevents triggering in the middle of text like "some text ```"
                    const line = update.state.doc.lineAt(pos);
                    const fencePosInLine = pos - line.from;
                    const textBeforeFence = line.text.slice(0, fencePosInLine - 3);

                    if (/^\s*$/.test(textBeforeFence)) {
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

    CodeMirror.addExtension([completionExt, triggerCompletionOnFence]);
}

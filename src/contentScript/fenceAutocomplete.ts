import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { startCompletion } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { getPluginSettings } from './pluginSettings';

type OpeningFence = {
    indent: string;
    fenceChar: string;
    fenceCount: number;
    typedLang: string;
    languageStartPos: number;
};

const COMPLETION_TRIGGER_DELAY_MS = 10;
const IMMEDIATE_FENCE_LENGTH = 3;

/**
 * Parse the opening fence at the current cursor position.
 * Supports both backtick (```) and tilde (~~~) style fences.
 * Returns fence details or undefined if not at a valid fence position.
 */
function parseOpeningFence(state: CompletionContext['state'], pos: number): OpeningFence | undefined {
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
    const fenceChar = fence[0];
    const typedLang = match[3];

    const fenceStart = lineStartPos + indent.length;
    if (pos < fenceStart + fence.length) return undefined;

    return {
        indent,
        fenceChar,
        fenceCount: fence.length,
        typedLang,
        languageStartPos: fenceStart + fence.length,
    };
}

/**
 * Creates a completion apply function that replaces typed language and inserts closing fence.
 * Replaces from languageStartPos to current cursor position.
 */
function createApplyFunction(desiredLang: string, openingFence: OpeningFence) {
    return (view: EditorView, _completion: Completion, from: number) => {
        const lineBreak = view.state.lineBreak || '\n';
        const { indent, fenceChar, fenceCount } = openingFence;
        const fence = fenceChar.repeat(fenceCount);
        const currentPos = view.state.selection.main.head;
        const insertText = `${desiredLang}${lineBreak}${indent}${lineBreak}${indent}${fence}`;
        const cursorOffset = from + desiredLang.length + lineBreak.length + indent.length;

        view.dispatch(
            view.state.update({
                changes: { from, to: currentPos, insert: insertText },
                selection: { anchor: cursorOffset },
            })
        );
    };
}

function autoInsertClosingFence(view: EditorView, openingFence: OpeningFence, cursorPos: number): void {
    const lineBreak = view.state.lineBreak || '\n';
    const closingFence = openingFence.fenceChar.repeat(IMMEDIATE_FENCE_LENGTH);
    const insertText = `${lineBreak}${openingFence.indent}${closingFence}`;

    view.dispatch(
        view.state.update({
            changes: { from: cursorPos, to: cursorPos, insert: insertText },
            selection: { anchor: cursorPos },
        })
    );
}

function buildCompletionOptions(languages: string[], openingFence: OpeningFence): Completion[] {
    const { typedLang } = openingFence;
    const typedLangLower = typedLang.toLowerCase();
    const matchedLanguages = languages
        .filter((lang) => lang.toLowerCase().startsWith(typedLangLower))
        .sort((a, b) => a.localeCompare(b));

    const options = matchedLanguages.map((lang) => ({
        label: lang,
        detail: '',
        apply: createApplyFunction(lang, openingFence),
    }));

    if (!typedLang) {
        options.unshift({
            label: 'No language',
            detail: '',
            apply: createApplyFunction('', openingFence),
        });
        return options;
    }

    const hasExactMatch = matchedLanguages.some((lang) => lang.toLowerCase() === typedLangLower);
    if (!hasExactMatch) {
        options.push({
            label: typedLang,
            detail: 'custom language',
            apply: createApplyFunction(typedLang, openingFence),
        });
    }

    return options;
}

function getFenceTriggerPosition(update: ViewUpdate): number | null {
    if (!update.docChanged) return null;
    if (!update.transactions.some((tr) => tr.isUserEvent('input.type'))) return null;

    const pos = update.state.selection.main.head;
    const typedFence =
        pos >= IMMEDIATE_FENCE_LENGTH ? update.state.doc.sliceString(pos - IMMEDIATE_FENCE_LENGTH, pos) : '';
    if (typedFence !== '```' && typedFence !== '~~~') return null;

    const line = update.state.doc.lineAt(pos);
    const textBeforeFence = line.text.slice(0, pos - line.from - IMMEDIATE_FENCE_LENGTH);
    return /^\s*$/.test(textBeforeFence) ? pos : null;
}

function handleFenceTrigger(update: ViewUpdate): void {
    const triggerPos = getFenceTriggerPosition(update);
    if (triggerPos === null) return;

    const settings = getPluginSettings(update.state);
    if (!settings.enableLanguageAutocomplete) {
        const openingFence = parseOpeningFence(update.state, triggerPos);
        if (openingFence) {
            autoInsertClosingFence(update.view, openingFence, triggerPos);
        }
        return;
    }

    setTimeout(() => {
        if (update.view.state === update.state) {
            startCompletion(update.view);
        }
    }, COMPLETION_TRIGGER_DELAY_MS);
}

export function createCodeBlockCompleter() {
    return (completionContext: CompletionContext): CompletionResult | null => {
        const { state, pos } = completionContext;
        const settings = getPluginSettings(state);

        if (!settings.enableLanguageAutocomplete) return null;

        const openingFence = parseOpeningFence(state, pos);
        if (!openingFence) return null;

        return {
            from: openingFence.languageStartPos,
            options: buildCompletionOptions(settings.languages, openingFence),
            filter: false,
        };
    };
}

export function createFenceTriggerExtension(): Extension {
    return EditorView.updateListener.of((update: ViewUpdate) => {
        handleFenceTrigger(update);
    });
}

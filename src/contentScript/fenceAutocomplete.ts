import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorSelection, type Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { getPluginSettings } from './pluginSettings';

type OpeningFence = {
    indent: string;
    fenceChar: string;
    fenceCount: number;
    typedLang: string;
    languageStartPos: number;
};

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
 *
 * Works across every cursor in a multi-cursor selection: each cursor that sits on a
 * valid opening fence is re-parsed independently so it gets the correct indent, fence
 * style, and replacement range. The chosen language is applied at all of them.
 */
function createApplyFunction(desiredLang: string) {
    return (view: EditorView) => {
        const lineBreak = view.state.lineBreak || '\n';

        const changes: { from: number; to: number; insert: string }[] = [];
        // Offset (relative to the start of each insertion) where the cursor should land,
        // i.e. on the blank line between the opening and closing fences.
        const cursorOffsets: number[] = [];

        for (const range of view.state.selection.ranges) {
            const openingFence = parseOpeningFence(view.state, range.head);
            if (!openingFence) continue;

            const { indent, fenceChar, fenceCount } = openingFence;
            const fence = fenceChar.repeat(fenceCount);
            changes.push({
                from: openingFence.languageStartPos,
                to: range.head,
                insert: `${desiredLang}${lineBreak}${indent}${lineBreak}${indent}${fence}`,
            });
            cursorOffsets.push(desiredLang.length + lineBreak.length + indent.length);
        }

        if (changes.length === 0) return;

        const changeSet = view.state.changes(changes);
        const selection = EditorSelection.create(
            changes.map((change, i) => EditorSelection.cursor(changeSet.mapPos(change.from, -1) + cursorOffsets[i]))
        );

        view.dispatch(view.state.update({ changes: changeSet, selection }));
    };
}

function autoInsertClosingFences(view: EditorView, cursorPositions: number[]): void {
    const lineBreak = view.state.lineBreak || '\n';

    const changes: { from: number; to: number; insert: string }[] = [];
    for (const cursorPos of cursorPositions) {
        const openingFence = parseOpeningFence(view.state, cursorPos);
        if (!openingFence) continue;
        const closingFence = openingFence.fenceChar.repeat(IMMEDIATE_FENCE_LENGTH);
        changes.push({
            from: cursorPos,
            to: cursorPos,
            insert: `${lineBreak}${openingFence.indent}${closingFence}`,
        });
    }

    if (changes.length === 0) return;

    const changeSet = view.state.changes(changes);
    // Keep each cursor right after its opening fence, before the inserted closing fence.
    const selection = EditorSelection.create(
        changes.map((change) => EditorSelection.cursor(changeSet.mapPos(change.from, -1)))
    );

    view.dispatch(view.state.update({ changes: changeSet, selection }));
}

function buildCompletionOptions(languages: string[], openingFence: OpeningFence): Completion[] {
    const { typedLang } = openingFence;
    const typedLangLower = typedLang.toLowerCase();
    const matchedLanguages = languages
        .filter((lang) => lang.toLowerCase().startsWith(typedLangLower))
        .sort((a, b) => a.localeCompare(b));

    const options: Completion[] = matchedLanguages.map((lang) => ({
        label: lang,
        type: 'codeblock',
        apply: createApplyFunction(lang),
    }));

    if (!typedLang) {
        options.unshift({
            label: 'No language',
            type: 'codeblock',
            apply: createApplyFunction(''),
        });
        return options;
    }

    const hasExactMatch = matchedLanguages.some((lang) => lang.toLowerCase() === typedLangLower);
    if (!hasExactMatch) {
        options.push({
            label: typedLang,
            type: 'codeblock',
            detail: 'custom language',
            apply: createApplyFunction(typedLang),
        });
    }

    return options;
}

function getFenceTriggerPositions(update: ViewUpdate): number[] {
    if (!update.docChanged) return [];
    if (!update.transactions.some((tr) => tr.isUserEvent('input.type'))) return [];

    const positions: number[] = [];
    for (const range of update.state.selection.ranges) {
        if (!range.empty) continue;

        const pos = range.head;
        const typedFence =
            pos >= IMMEDIATE_FENCE_LENGTH ? update.state.doc.sliceString(pos - IMMEDIATE_FENCE_LENGTH, pos) : '';
        if (typedFence !== '```' && typedFence !== '~~~') continue;

        const line = update.state.doc.lineAt(pos);
        const textBeforeFence = line.text.slice(0, pos - line.from - IMMEDIATE_FENCE_LENGTH);
        if (/^\s*$/.test(textBeforeFence)) positions.push(pos);
    }
    return positions;
}

function handleFenceTrigger(update: ViewUpdate): void {
    const triggerPositions = getFenceTriggerPositions(update);
    if (triggerPositions.length === 0) return;

    const settings = getPluginSettings(update.state);
    if (settings.enableLanguageAutocomplete) return;

    autoInsertClosingFences(update.view, triggerPositions);
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

export const fenceAutocompleteTheme = EditorView.baseTheme({
    '.cm-completionIcon-codeblock::after': {
        content: "'λ'",
        fontFamily: 'monospace',
        opacity: '0.7',
    },
});

export function createFenceTriggerExtension(): Extension {
    return EditorView.updateListener.of((update: ViewUpdate) => {
        handleFenceTrigger(update);
    });
}

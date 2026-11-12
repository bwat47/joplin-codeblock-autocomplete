import {
    pickedCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
} from '@codemirror/autocomplete';
import { language } from '@codemirror/language';
import { EditorSelection, StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

import { getFencedCodeBlockGeometry, getFencedCodeSyntaxTree } from './fencedCodeBlock';
import { getPluginSettings } from './pluginSettings';

type OpeningFence = {
    indent: string;
    fenceChar: string;
    fenceCount: number;
    typedLang: string;
    languageStartPos: number;
};

const IMMEDIATE_FENCE_LENGTH = 3;
const COMPLETION_USER_EVENT = 'input.complete';

/**
 * Completion type for language options. CodeMirror adds `cm-completionIcon-<type>` to each
 * option's icon, so styles can target this plugin's options without affecting completion menus
 * from Joplin or other plugins.
 */
const LANGUAGE_COMPLETION_TYPE = 'codeblock-autocomplete-language';

/**
 * Optional indent (group 1) followed by a fence of 3+ backticks or tildes, at the start of a line.
 * Matches "~~~" and "  ~~~~ts" (as "  ~~~~"); does not match "~~" or "a~~~".
 */
const FENCE_PREFIX_PATTERN = /^(\s*)(?:`{3,}|~{3,})/;

/**
 * Parse the opening fence at the current cursor position.
 * Supports both backtick and tilde (~~~) style fences.
 * Returns fence details or undefined if not at a valid fence position: the cursor must be
 * in the language word directly after the fence, so typing options after the language
 * (for example `ts ln` or `ts title="a"`) does not offer languages.
 */
function parseOpeningFence(state: CompletionContext['state'], pos: number): OpeningFence | undefined {
    const line = state.doc.lineAt(pos);
    const lineText = line.text;
    const lineStartPos = line.from;

    // Match: optional indent + (3+ backticks OR 3+ tildes) + optional language
    // Backticks: language cannot contain backticks
    // Tildes: language cannot contain spaces (per CommonMark)
    const match = /^(\s*)(`{3,}|~{3,})([^\s`]*)/.exec(lineText);
    if (!match) return undefined;

    // Every capture participates in a successful match, including empty indent/language.
    const indent = match[1]!;
    const fence = match[2]!;
    const fenceChar = fence.charAt(0);
    const typedLang = match[3]!;

    const fenceStart = lineStartPos + indent.length;
    const languageStartPos = fenceStart + fence.length;
    if (pos < languageStartPos || pos > languageStartPos + typedLang.length) return undefined;

    return {
        indent,
        fenceChar,
        fenceCount: fence.length,
        typedLang,
        languageStartPos,
    };
}

/** Offsets of the fence characters within a line, after any indent. */
type FenceRun = { start: number; end: number };

/** The line's fence characters, or undefined when the line does not start with a fence. */
function getFenceRun(lineText: string): FenceRun | undefined {
    const match = FENCE_PREFIX_PATTERN.exec(lineText);
    return match ? { start: match[1]!.length, end: match[0].length } : undefined;
}

/**
 * Whether a change made the fence characters `fenceFrom`..`fenceTo` new.
 *
 * It did when it inserted, removed, or replaced fence characters, or when it made them lead their
 * line (Enter before a mid-line fence, deleting text before it). Changes after the fence (typing
 * the language) leave it as it was, and so do changes before it that only affect whitespace or
 * line breaks: indenting the line, Enter at its start, joining an empty line above it.
 */
function changeCreatesFence(
    startState: EditorState,
    fenceFrom: number,
    fenceTo: number,
    change: { toA: number; fromB: number; toB: number }
): boolean {
    if (change.fromB < fenceTo && change.toB > fenceFrom) return true;
    if (change.fromB >= fenceTo) return false;

    // The change ends before the fence, and only whitespace separates them. The fence already led
    // its line if only whitespace preceded the change's end in the old document too.
    const oldLineFrom = startState.doc.lineAt(change.toA).from;
    return !/^\s*$/.test(startState.doc.sliceString(oldLineFrom, change.toA));
}

/**
 * Whether the line `lineFrom`..`lineTo` holds the closing fence of a block that opened earlier.
 *
 * A closing fence cannot carry an info string, so this only recognizes a closing fence until
 * something is typed after it; from then on the line parses as an opening fence.
 */
function isClosingFenceLine(state: EditorState, lineFrom: number, lineTo: number): boolean {
    const { tree } = getFencedCodeSyntaxTree(state, lineTo);
    let closing = false;

    tree.iterate({
        from: lineFrom,
        to: lineTo,
        enter: (node) => {
            if (closing) return false;
            if (node.name !== 'CodeMark' || node.from < lineFrom) return undefined;

            const parent = node.node.parent;
            closing = parent?.name === 'FencedCode' && parent.from < lineFrom;
            return false;
        },
    });

    return closing;
}

/**
 * How the fence on a line the user is editing came about:
 * - `created`: the user made the fence characters themselves (see `changeCreatesFence`).
 * - `closing`: the line was a closing fence when the user edited it.
 */
type FenceOrigin = 'created' | 'closing';

/** Fence lines that `tr` created or started editing as closing fences, keyed by line start. */
function getEditedFenceLines(tr: Transaction): Map<number, FenceOrigin> {
    const { startState, state } = tr;
    const lines = new Map<number, FenceOrigin>();

    tr.changes.iterChanges((fromA, toA, fromB, toB) => {
        for (
            let lineNumber = state.doc.lineAt(fromB).number;
            lineNumber <= state.doc.lineAt(toB).number;
            lineNumber++
        ) {
            const line = state.doc.line(lineNumber);
            const fenceRun = getFenceRun(line.text);
            if (!fenceRun) continue;
            if (
                changeCreatesFence(startState, line.from + fenceRun.start, line.from + fenceRun.end, {
                    toA,
                    fromB,
                    toB,
                })
            ) {
                lines.set(line.from, 'created');
            }
        }

        // A closing fence keeps its history only when its fence characters survive the change.
        // Lines strictly between the change's first and last lines are deleted outright, so only
        // those two can hold one.
        const firstLine = startState.doc.lineAt(fromA);
        const lastLine = startState.doc.lineAt(toA);
        for (const line of firstLine.number === lastLine.number ? [firstLine] : [firstLine, lastLine]) {
            const fenceRun = getFenceRun(line.text);
            if (!fenceRun) continue;
            if (fromA < line.from + fenceRun.end && toA > line.from + fenceRun.start) continue;
            if (isClosingFenceLine(startState, line.from, line.to)) {
                lines.set(state.doc.lineAt(tr.changes.mapPos(line.from, 1)).from, 'closing');
            }
        }
    });

    return lines;
}

/**
 * The origin of each fence line the user is editing, keyed by line start.
 *
 * The document alone cannot say what a fence was before the user typed on its line. A fence typed
 * above an existing block pairs with that block's closing fence just as the block's own opening
 * fence does, and a closing fence becomes an opening fence as soon as a language is typed after
 * it. So the origin is recorded by the edit itself and kept until no cursor is on the line.
 * A fence the user is editing without a recorded origin is an existing opening fence.
 *
 * A later edit that finds the line closing a block overrides `created`: a fence typed inside an
 * existing block closes that block.
 */
const editedFenceLines = StateField.define<ReadonlyMap<number, FenceOrigin>>({
    create: () => new Map(),
    update(lines, tr) {
        if (!tr.docChanged && !tr.selection) return lines;

        const candidates = new Map<number, FenceOrigin>();
        for (const [from, origin] of lines) candidates.set(tr.changes.mapPos(from, 1), origin);
        for (const [from, origin] of getEditedFenceLines(tr)) candidates.set(from, origin);
        if (candidates.size === 0) return lines;

        const { doc, selection } = tr.state;
        const cursorLines = new Set(selection.ranges.map((range) => doc.lineAt(range.head).from));
        const edited = new Map<number, FenceOrigin>();
        for (const [pos, origin] of candidates) {
            const line = doc.lineAt(pos);
            if (cursorLines.has(line.from) && getFenceRun(line.text)) {
                edited.set(line.from, origin);
            }
        }

        return edited;
    },
});

function getFenceOrigin(state: EditorState, lineFrom: number): FenceOrigin | undefined {
    return state.field(editedFenceLines, false)?.get(lineFrom);
}

/**
 * Whether the fence on `pos`'s line closes a block, either now or when the user started editing
 * it. A language typed there would turn the closing fence into an opening one.
 */
function isEditingClosingFence(state: EditorState, pos: number): boolean {
    const line = state.doc.lineAt(pos);
    return getFenceOrigin(state, line.from) === 'closing' || isClosingFenceLine(state, line.from, line.to);
}

function findFencedCodeStartingOnLine(state: EditorState, lineFrom: number, lineTo: number): SyntaxNode | null {
    const { tree } = getFencedCodeSyntaxTree(state, lineTo);
    let fencedCode: SyntaxNode | null = null;

    tree.iterate({
        from: lineFrom,
        to: lineTo,
        enter: (node) => {
            if (fencedCode) return false;
            if (node.name !== 'FencedCode') return undefined;
            if (node.from >= lineFrom) fencedCode = node.node;
            // A block that started earlier encloses this line, so this line is not an opening fence.
            return false;
        },
    });

    return fencedCode;
}

/**
 * Whether applying a language to the fence on the line `lineFrom`..`lineTo` should also add a
 * closing fence.
 *
 * A fence the user created always gets one. An existing fence gets one only when a fully parsed document
 * shows it opening a block that runs unclosed to the end. Without a Markdown parser there is no
 * structure to protect, so it is closed like a new fence. When the answer is uncertain (a partial
 * parse, or a line that is not an opening fence, such as one inside an enclosing block), no
 * closing fence is added: a missing fence is easier to notice and fix than a stray one that
 * silently restructures the rest of the note.
 */
function shouldInsertClosingFence(state: EditorState, lineFrom: number, lineTo: number): boolean {
    if (getFenceOrigin(state, lineFrom) === 'created') return true;
    if (state.facet(language) === null) return true;

    const fencedCode = findFencedCodeStartingOnLine(state, lineFrom, lineTo);
    if (!fencedCode) return false;

    const { hasClosingFence } = getFencedCodeBlockGeometry(state, fencedCode);
    return !hasClosingFence && getFencedCodeSyntaxTree(state, state.doc.length).complete;
}

/**
 * Creates a completion apply function that replaces the typed language and, for a new block,
 * inserts a closing fence (see `shouldInsertClosingFence`).
 *
 * Works across every cursor in a multi-cursor selection: each cursor that sits on a
 * valid opening fence is re-parsed independently so it gets the correct indent, fence
 * style, and replacement range. The chosen language is applied at all of them.
 * The whole language word is replaced, including any part after the cursor.
 */
function createApplyFunction(desiredLang: string) {
    return (view: EditorView, completion: Completion) => {
        const lineBreak = view.state.lineBreak || '\n';

        const changes: { from: number; to: number; insert: string; cursorOffset: number }[] = [];

        for (const range of view.state.selection.ranges) {
            const openingFence = parseOpeningFence(view.state, range.head);
            if (!openingFence || isEditingClosingFence(view.state, range.head)) continue;

            const { indent, fenceChar, fenceCount, languageStartPos, typedLang } = openingFence;
            const languageEnd = languageStartPos + typedLang.length;
            const line = view.state.doc.lineAt(range.head);

            if (!shouldInsertClosingFence(view.state, line.from, line.to)) {
                changes.push({
                    from: languageStartPos,
                    to: languageEnd,
                    insert: desiredLang,
                    cursorOffset: desiredLang.length,
                });
                continue;
            }

            const fence = fenceChar.repeat(fenceCount);
            changes.push({
                from: languageStartPos,
                to: languageEnd,
                insert: `${desiredLang}${lineBreak}${indent}${lineBreak}${indent}${fence}`,
                // Offset (relative to the start of the insertion) where the cursor should land,
                // i.e. on the blank line between the opening and closing fences. A document line break is
                // one position whatever `state.lineBreak` holds, so it counts as 1 rather than its length.
                cursorOffset: desiredLang.length + 1 + indent.length,
            });
        }

        if (changes.length === 0) return;

        const changeSet = view.state.changes(changes);
        const selection = EditorSelection.create(
            changes.map((change) => EditorSelection.cursor(changeSet.mapPos(change.from, -1) + change.cursorOffset))
        );

        view.dispatch(
            view.state.update({
                changes: changeSet,
                selection,
                // Matches what CodeMirror dispatches when it applies a string completion.
                annotations: pickedCompletion.of(completion),
                userEvent: COMPLETION_USER_EVENT,
            })
        );
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

/**
 * Options without a section always sort above sectioned ones, so this keeps the
 * custom entry last even though its label is an exact match for the typed text.
 */
const CUSTOM_LANGUAGE_SECTION = 'Custom language';

/**
 * Builds the unfiltered option list; CodeMirror's fuzzy matcher filters, ranks
 * and highlights it against the typed language.
 */
function buildCompletionOptions(languages: string[], openingFence: OpeningFence): Completion[] {
    const { typedLang } = openingFence;

    const options: Completion[] = languages.map((lang) => ({
        label: lang,
        type: LANGUAGE_COMPLETION_TYPE,
        apply: createApplyFunction(lang),
    }));

    if (!typedLang) {
        options.push({
            label: 'No language',
            type: LANGUAGE_COMPLETION_TYPE,
            boost: 99,
            apply: createApplyFunction(''),
        });
        return options;
    }

    const typedLangLower = typedLang.toLowerCase();
    const hasExactMatch = languages.some((lang) => lang.toLowerCase() === typedLangLower);
    if (!hasExactMatch) {
        options.push({
            label: typedLang,
            type: LANGUAGE_COMPLETION_TYPE,
            section: CUSTOM_LANGUAGE_SECTION,
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
        if (!openingFence || isEditingClosingFence(state, pos)) return null;

        // No `validFor`: CodeMirror re-queries on each keystroke so the custom
        // entry tracks the typed text.
        return {
            from: openingFence.languageStartPos,
            options: buildCompletionOptions(settings.languages, openingFence),
        };
    };
}

const LANGUAGE_ICON_CLASS = `cm-completionIcon-${LANGUAGE_COMPLETION_TYPE}`;
const LANGUAGE_ROW_SELECTOR = `.cm-tooltip.cm-tooltip-autocomplete > ul > li:has(.${LANGUAGE_ICON_CLASS})`;
const LANGUAGE_ICON_SELECTOR = `.cm-tooltip.cm-tooltip-autocomplete .cm-completionIcon.${LANGUAGE_ICON_CLASS}`;

/**
 * Styles for language completion rows. Every selector is scoped to this plugin's icon class so
 * completion menus from Joplin or other plugins keep their own styling.
 */
export const fenceAutocompleteTheme = EditorView.baseTheme({
    [LANGUAGE_ICON_SELECTOR]: {
        // Explicit so stylesheets that hide completion icons in every menu
        // (e.g. Quick Links Plus) don't hide the language icon.
        display: 'inline-block',
    },
    [`${LANGUAGE_ICON_SELECTOR}::after`]: {
        content: "'λ'",
        fontFamily: 'monospace',
        opacity: '0.7',
    },
    // Resets label padding that other plugins (e.g. Quick Links Plus) apply to every completion menu.
    [`${LANGUAGE_ROW_SELECTOR} > .cm-completionLabel`]: {
        padding: '0',
    },
});

export function createFenceTriggerExtension(): Extension {
    return [
        editedFenceLines,
        EditorView.updateListener.of((update: ViewUpdate) => {
            handleFenceTrigger(update);
        }),
    ];
}

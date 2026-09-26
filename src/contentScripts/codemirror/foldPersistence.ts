/**
 * Saves each note's code block folds through the main process and restores them when the note is
 * shown again.
 *
 * Joplin reuses one editor for every note: switching notes, and sync rewriting the open note,
 * both replace the whole document in one transaction, which drops every fold. Folds are therefore
 * read from the transaction's start state at those moments. A saved fold records its starting
 * line's number and text; restoring finds that line again and recomputes the fold from the current
 * indentation, dropping folds that no longer fit.
 */
import { foldedRanges, foldEffect, syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Facet, Transaction } from '@codemirror/state';
import { type EditorView, type PluginValue, type ViewUpdate, ViewPlugin } from '@codemirror/view';
import { logger } from '../../logger';
import { resolveFoldableLine } from './codeFolding';
import { areSerializedFoldsEqual, normalizeSerializedFolds, type SerializedFold } from './foldSerialization';
import { getPluginSettings } from './pluginSettings';
import { GET_FOLD_STATE_COMMAND, type PostMessageContext, SAVE_FOLD_STATE_COMMAND } from './types';

const SAVE_DELAY_MS = 500;
/** How far from its saved line number a fold's line is searched for by its text. */
const LINE_SEARCH_RADIUS = 50;

type PendingRestore = {
    noteId: string;
    folds: SerializedFold[];
};

type ResolvedFold = { from: number; to: number } | 'incomplete' | null;

function isFoldingEnabled(state: EditorState): boolean {
    return getPluginSettings(state).enableCodeFolding;
}

/** Records the starting line of every folded range, in document order. */
function serializeFolds(state: EditorState): SerializedFold[] {
    const { doc } = state;
    const folds: SerializedFold[] = [];
    let previousLine = 0;

    foldedRanges(state).between(0, doc.length, (from) => {
        const line = doc.lineAt(from);
        if (line.number !== previousLine) {
            folds.push({ line: line.number, text: line.text });
            previousLine = line.number;
        }
    });

    return folds;
}

/**
 * Finds the line a saved fold started on: its saved line number when the text still matches,
 * otherwise the nearest line within `LINE_SEARCH_RADIUS` with exactly that text.
 */
function findFoldLine(state: EditorState, fold: SerializedFold): number | null {
    const { doc } = state;
    const matches = (lineNumber: number): boolean =>
        lineNumber >= 1 && lineNumber <= doc.lines && doc.line(lineNumber).text === fold.text;

    for (let distance = 0; distance <= LINE_SEARCH_RADIUS; distance++) {
        if (matches(fold.line - distance)) return fold.line - distance;
        if (matches(fold.line + distance)) return fold.line + distance;
    }

    return null;
}

function resolveFold(state: EditorState, fold: SerializedFold): ResolvedFold {
    const lineNumber = findFoldLine(state, fold);
    if (lineNumber === null) {
        return null;
    }

    const { complete, line } = resolveFoldableLine(state, lineNumber);
    return complete ? line : 'incomplete';
}

/** Whether a transaction replaced the whole document, as Joplin does when it swaps note bodies. */
function replacesWholeDocument(tr: Transaction): boolean {
    let whole = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
        whole ||= fromA === 0 && toA === tr.startState.doc.length;
    });
    return whole;
}

class FoldPersistencePlugin implements PluginValue {
    /** Folds known to be saved for the current note; `null` until its saved folds have loaded. */
    private savedFolds: SerializedFold[] | null = null;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingRestore: PendingRestore | null = null;
    private loadRequestId = 0;
    private destroyed = false;

    public constructor(
        private readonly view: EditorView,
        private readonly context: PostMessageContext,
        private readonly noteIdFacet: Facet<string, string>
    ) {
        if (isFoldingEnabled(view.state)) {
            this.requestFolds(view.state.facet(noteIdFacet));
        }
    }

    public update(update: ViewUpdate): void {
        const { startState, state } = update;
        const wasEnabled = isFoldingEnabled(startState);

        if (!isFoldingEnabled(state)) {
            // Disabling drops every fold with the folding compartment; that is not a change to save.
            if (wasEnabled) this.reset();
            return;
        }

        const previousNoteId = startState.facet(this.noteIdFacet);
        const noteId = state.facet(this.noteIdFacet);

        if (previousNoteId !== noteId) {
            // The switch itself dropped the outgoing note's folds, so save them from the start state.
            if (wasEnabled) this.saveNow(previousNoteId, serializeFolds(startState));
            this.reset();
            this.requestFolds(noteId);
            return;
        }

        if (!wasEnabled) {
            this.requestFolds(noteId);
            return;
        }

        if (update.transactions.some(replacesWholeDocument)) {
            // Sync rewrote the open note: put back the folds that the replacement dropped.
            const folds = serializeFolds(startState);
            if (folds.length > 0) {
                this.pendingRestore = { noteId, folds };
                this.deferRestore();
            }
            return;
        }

        if (this.pendingRestore && syntaxTree(startState) !== syntaxTree(state)) {
            this.deferRestore();
        }

        if (foldedRanges(startState) !== foldedRanges(state)) {
            this.scheduleSave();
        }
    }

    public destroy(): void {
        this.destroyed = true;
        if (this.saveTimer !== null) {
            this.saveNow(this.view.state.facet(this.noteIdFacet), serializeFolds(this.view.state));
        }
        this.clearSaveTimer();
    }

    private reset(): void {
        this.clearSaveTimer();
        this.savedFolds = null;
        this.pendingRestore = null;
        this.loadRequestId++;
    }

    private requestFolds(noteId: string): void {
        if (!noteId) {
            return;
        }

        const requestId = ++this.loadRequestId;
        this.context
            .postMessage({ command: GET_FOLD_STATE_COMMAND, noteId })
            .then((response) => {
                if (this.destroyed || requestId !== this.loadRequestId) {
                    return;
                }

                const folds = normalizeSerializedFolds(response) ?? [];
                this.savedFolds = folds;
                if (folds.length > 0) {
                    this.pendingRestore = { noteId, folds };
                    this.restore();
                }
            })
            .catch((error: unknown) => {
                logger.error('Failed to load code block fold state:', error);
            });
    }

    /** `update` must not dispatch, so restoring from there waits until the update has finished. */
    private deferRestore(): void {
        void Promise.resolve().then(() => this.restore());
    }

    /**
     * Applies the pending folds. Waits for a later syntax tree when a fold's line has not been
     * parsed yet; once every fold is resolved, folds that no longer fit are dropped and the cleaned
     * list is saved.
     */
    private restore(): void {
        const pending = this.pendingRestore;
        const { state } = this.view;
        if (this.destroyed || !pending || pending.noteId !== state.facet(this.noteIdFacet)) {
            return;
        }

        const resolved = pending.folds.map((fold) => resolveFold(state, fold));
        if (resolved.includes('incomplete')) {
            return;
        }

        this.pendingRestore = null;
        const alreadyFolded = new Set(serializeFolds(state).map((fold) => fold.line));
        const effects = resolved
            .filter((range): range is { from: number; to: number } => range !== null && range !== 'incomplete')
            .filter((range) => !alreadyFolded.has(state.doc.lineAt(range.from).number))
            .map((range) => foldEffect.of(range));

        if (effects.length > 0) {
            this.view.dispatch({ effects });
        }
        if (resolved.includes(null)) {
            this.scheduleSave();
        }
    }

    private scheduleSave(): void {
        this.clearSaveTimer();
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            const { state } = this.view;
            this.saveNow(state.facet(this.noteIdFacet), serializeFolds(state));
        }, SAVE_DELAY_MS);
    }

    /**
     * Sends the note's folds unless they match what is already saved. Nothing is sent before the
     * note's saved folds have loaded, so an early save cannot overwrite them.
     */
    private saveNow(noteId: string, folds: SerializedFold[]): void {
        if (!noteId || this.savedFolds === null || areSerializedFoldsEqual(folds, this.savedFolds)) {
            return;
        }

        this.savedFolds = folds;
        this.context.postMessage({ command: SAVE_FOLD_STATE_COMMAND, noteId, folds }).catch((error: unknown) => {
            logger.error('Failed to save code block fold state:', error);
        });
    }

    private clearSaveTimer(): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
    }
}

export function createFoldPersistence(context: PostMessageContext, noteIdFacet: Facet<string, string>): Extension {
    return ViewPlugin.define((view) => new FoldPersistencePlugin(view, context, noteIdFacet));
}

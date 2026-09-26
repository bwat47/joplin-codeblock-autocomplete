import { vi, type Mock } from 'vitest';
import { markdown } from '@codemirror/lang-markdown';
import { foldEffect, foldedRanges } from '@codemirror/language';
import { Facet, StateEffect, StateField } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { createEditorHarness, type EditorHarness } from '../../testUtils/editorHarness';
import { createCodeFoldingExtension, resolveFoldableLine } from './codeFolding';
import type { SerializedFold } from './foldSerialization';
import { createFoldPersistence } from './foldPersistence';
import { applyPluginSettings, createSettingsExtension } from './pluginSettings';
import { GET_FOLD_STATE_COMMAND, SAVE_FOLD_STATE_COMMAND } from './types';

vi.mock('../../logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

type Message = { command: string; noteId?: string; folds?: SerializedFold[] };

const SAVE_DELAY_MS = 500;

// Mirrors Joplin's selectedNoteIdExtension: a field set by an effect, exposed through a facet.
const setNoteId = StateEffect.define<string>();
const noteIdFacet = Facet.define<string, string>({ combine: (values) => values[0] ?? '' });

function noteIdField(initialNoteId: string): StateField<string> {
    return StateField.define({
        create: () => initialNoteId,
        update: (value, tr) => tr.effects.find((effect) => effect.is(setNoteId))?.value ?? value,
        provide: (field) => noteIdFacet.from(field),
    });
}

const NOTE_A = ['# A', '```js', 'function f() {', '    return 1;', '}', '```'].join('\n');
const NOTE_B = ['# B', '```py', 'def g():', '    pass', '```'].join('\n');

let harness: EditorHarness | null = null;
let storedFolds: Record<string, SerializedFold[]>;
let postMessage: Mock<(message: Message) => Promise<unknown>>;

beforeEach(() => {
    vi.useFakeTimers();
    storedFolds = {};
    postMessage = vi.fn(async (message: Message) =>
        message.command === GET_FOLD_STATE_COMMAND ? (storedFolds[message.noteId ?? ''] ?? []) : null
    );
});

afterEach(() => {
    harness?.destroy();
    harness = null;
    vi.useRealTimers();
});

function setFolding(view: EditorView, enableCodeFolding: boolean): void {
    applyPluginSettings(view, {
        enableLanguageAutocomplete: true,
        enableCopyWidget: false,
        enableCodeFolding,
        languages: [],
    });
}

async function createEditor(doc: string, noteId = 'a', enableCodeFolding = true): Promise<EditorView> {
    harness = createEditorHarness(doc, {
        rawInput: true,
        extensions: [
            markdown(),
            noteIdField(noteId),
            createSettingsExtension(),
            createCodeFoldingExtension(),
            createFoldPersistence({ postMessage }, noteIdFacet),
        ],
    });
    setFolding(harness.view, enableCodeFolding);
    await flush();
    return harness.view;
}

/** Lets pending message replies and deferred restores run. */
async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
}

function foldLine(view: EditorView, lineNumber: number): void {
    const { line } = resolveFoldableLine(view.state, lineNumber);
    if (!line) throw new Error(`Line ${lineNumber} cannot fold.`);
    view.dispatch({ effects: foldEffect.of(line) });
}

function foldedLines(view: EditorView): number[] {
    const lines: number[] = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from) => {
        lines.push(view.state.doc.lineAt(from).number);
    });
    return lines;
}

function switchNote(view: EditorView, noteId: string, body: string): void {
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: body },
        effects: setNoteId.of(noteId),
    });
}

function saves(): Message[] {
    return postMessage.mock.calls.map(([message]) => message).filter((m) => m.command === SAVE_FOLD_STATE_COMMAND);
}

function requests(): Message[] {
    return postMessage.mock.calls.map(([message]) => message).filter((m) => m.command === GET_FOLD_STATE_COMMAND);
}

describe('fold persistence', () => {
    it('saves the folded lines after a delay', async () => {
        const view = await createEditor(NOTE_A);

        foldLine(view, 3);
        expect(saves()).toEqual([]);

        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(saves()).toEqual([
            { command: SAVE_FOLD_STATE_COMMAND, noteId: 'a', folds: [{ line: 3, text: 'function f() {' }] },
        ]);
    });

    it('does not save again when the folded lines have not changed', async () => {
        const view = await createEditor(NOTE_A);
        foldLine(view, 3);
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);

        // An edit after the fold moves no folded line.
        view.dispatch({ changes: { from: view.state.doc.length, insert: '\n' } });
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(saves()).toHaveLength(1);
    });

    it('saves the outgoing note on a switch and restores the incoming one', async () => {
        storedFolds.b = [{ line: 3, text: 'def g():' }];
        const view = await createEditor(NOTE_A);
        foldLine(view, 3);

        switchNote(view, 'b', NOTE_B);
        expect(saves()).toEqual([
            { command: SAVE_FOLD_STATE_COMMAND, noteId: 'a', folds: [{ line: 3, text: 'function f() {' }] },
        ]);
        expect(requests().map((m) => m.noteId)).toEqual(['a', 'b']);

        await flush();
        expect(foldedLines(view)).toEqual([3]);
        expect(view.state.doc.line(3).text).toBe('def g():');
    });

    it('ignores saved folds that arrive after their note was left', async () => {
        let resolveA: (folds: SerializedFold[]) => void = () => {};
        postMessage.mockImplementation((message: Message) => {
            if (message.command === GET_FOLD_STATE_COMMAND && message.noteId === 'a') {
                return new Promise((resolve) => (resolveA = resolve));
            }
            return Promise.resolve([]);
        });
        const view = await createEditor(NOTE_A);

        switchNote(view, 'b', NOTE_A);
        resolveA([{ line: 3, text: 'function f() {' }]);
        await flush();
        expect(foldedLines(view)).toEqual([]);

        // Note A's reply must not stand in for note B's saved folds, or this save would be skipped.
        foldLine(view, 3);
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(saves()).toEqual([
            { command: SAVE_FOLD_STATE_COMMAND, noteId: 'b', folds: [{ line: 3, text: 'function f() {' }] },
        ]);
    });

    it('drops saved folds that no longer fit and saves the cleaned list', async () => {
        storedFolds.a = [
            { line: 3, text: 'function f() {' },
            { line: 4, text: 'a line that was deleted' },
            { line: 1, text: '# A' },
        ];
        const view = await createEditor(NOTE_A);

        expect(foldedLines(view)).toEqual([3]);
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(saves()).toEqual([
            { command: SAVE_FOLD_STATE_COMMAND, noteId: 'a', folds: [{ line: 3, text: 'function f() {' }] },
        ]);
    });

    it('clears the saved folds when none of them fit anymore', async () => {
        storedFolds.a = [{ line: 4, text: 'a line that was deleted' }];
        const view = await createEditor(NOTE_A);

        expect(foldedLines(view)).toEqual([]);
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(saves()).toEqual([{ command: SAVE_FOLD_STATE_COMMAND, noteId: 'a', folds: [] }]);
    });

    it('finds a fold whose line moved by its text', async () => {
        storedFolds.a = [{ line: 1, text: 'function f() {' }];
        const view = await createEditor(NOTE_A);

        expect(foldedLines(view)).toEqual([3]);
    });

    it('keeps folds when the open note is rewritten in place', async () => {
        const view = await createEditor(NOTE_A);
        foldLine(view, 3);

        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: `Synced line\n${NOTE_A}` } });
        await flush();

        expect(foldedLines(view)).toEqual([4]);
    });

    it('sends nothing while folding is disabled', async () => {
        const view = await createEditor(NOTE_A, 'a', false);

        switchNote(view, 'b', NOTE_B);
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('restores the open note when folding is turned on', async () => {
        storedFolds.a = [{ line: 3, text: 'function f() {' }];
        const view = await createEditor(NOTE_A, 'a', false);

        setFolding(view, true);
        await flush();

        expect(requests().map((m) => m.noteId)).toEqual(['a']);
        expect(foldedLines(view)).toEqual([3]);
    });
});

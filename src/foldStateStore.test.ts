import { vi } from 'vitest';

const joplinMock = vi.hoisted(() => ({
    settings: {
        value: vi.fn<(key: string) => Promise<unknown>>(async () => '{}'),
        setValue: vi.fn<(key: string, value: unknown) => Promise<void>>(async () => {}),
    },
    data: {
        get: vi.fn<(path: string[], query?: unknown) => Promise<unknown>>(async () => ({})),
    },
}));

vi.mock('api', () => ({ default: joplinMock }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { FoldStateStore } from './foldStateStore';
import { SETTING_KEYS } from './settingsKeys';

const SAVE_DELAY_MS = 1000;
const FOLDS = [{ line: 3, text: 'function f() {' }];

function savedValue(): Record<string, { folds: unknown; updatedAt: number }> {
    const call = joplinMock.settings.setValue.mock.lastCall;
    if (!call) throw new Error('Expected the fold state to be saved.');
    expect(call[0]).toBe(SETTING_KEYS.foldState);
    return JSON.parse(call[1] as string);
}

async function loadStore(stored: unknown, options?: { maxNotes?: number }): Promise<FoldStateStore> {
    joplinMock.settings.value.mockResolvedValueOnce(stored);
    const store = new FoldStateStore({ saveDelayMs: SAVE_DELAY_MS, ...options });
    await store.load();
    return store;
}

beforeEach(() => {
    vi.useFakeTimers();
    joplinMock.settings.setValue.mockClear();
    joplinMock.data.get.mockReset();
    joplinMock.data.get.mockResolvedValue({});
});

afterEach(() => {
    vi.useRealTimers();
});

describe('FoldStateStore', () => {
    it('loads valid entries and drops malformed ones', async () => {
        const store = await loadStore(
            JSON.stringify({
                good: { folds: FOLDS, updatedAt: 1 },
                badFolds: { folds: [{ line: 0, text: 'x' }], updatedAt: 1 },
                empty: { folds: [], updatedAt: 1 },
                noTimestamp: { folds: FOLDS },
            })
        );

        expect(store.getFolds('good')).toEqual(FOLDS);
        expect(store.getFolds('badFolds')).toEqual([]);
        expect(store.getFolds('empty')).toEqual([]);
        expect(store.getFolds('noTimestamp')).toEqual([]);
    });

    it('starts empty when the stored value is not readable JSON', async () => {
        const store = await loadStore('{not json');
        expect(store.getFolds('any')).toEqual([]);
    });

    it('saves once, after a delay, however many changes are made', async () => {
        const store = await loadStore('{}');

        store.setFolds('a', FOLDS);
        store.setFolds('b', FOLDS);
        expect(joplinMock.settings.setValue).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(joplinMock.settings.setValue).toHaveBeenCalledTimes(1);
        expect(Object.keys(savedValue())).toEqual(['a', 'b']);
    });

    it('removes a note entry when its folds are cleared', async () => {
        const store = await loadStore(JSON.stringify({ a: { folds: FOLDS, updatedAt: 1 } }));

        store.setFolds('a', []);
        expect(store.getFolds('a')).toEqual([]);

        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(savedValue()).toEqual({});
    });

    it('does not save when clearing folds a note never had', async () => {
        const store = await loadStore('{}');

        store.setFolds('a', []);
        await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
        expect(joplinMock.settings.setValue).not.toHaveBeenCalled();
    });

    it('evicts the least recently updated notes beyond the cap', async () => {
        const store = await loadStore(
            JSON.stringify({
                oldest: { folds: FOLDS, updatedAt: 1 },
                newer: { folds: FOLDS, updatedAt: 2 },
            }),
            { maxNotes: 2 }
        );

        store.setFolds('newest', FOLDS);
        expect(store.getFolds('oldest')).toEqual([]);
        expect(store.getFolds('newer')).toEqual(FOLDS);
        expect(store.getFolds('newest')).toEqual(FOLDS);
    });

    describe('sweepDeletedNotes', () => {
        it('removes notes that no longer exist and keeps the rest', async () => {
            const store = await loadStore(
                JSON.stringify({
                    deleted: { folds: FOLDS, updatedAt: 1 },
                    deletedWithCode: { folds: FOLDS, updatedAt: 1 },
                    existing: { folds: FOLDS, updatedAt: 1 },
                    unreachable: { folds: FOLDS, updatedAt: 1 },
                })
            );
            joplinMock.data.get.mockImplementation(async (path) => {
                if (path[1] === 'deleted') throw new Error('Not Found');
                if (path[1] === 'deletedWithCode') throw Object.assign(new Error('Missing'), { code: 404 });
                if (path[1] === 'unreachable') throw new Error('Database is locked');
                return { id: path[1] };
            });

            await store.sweepDeletedNotes();

            expect(store.getFolds('deleted')).toEqual([]);
            expect(store.getFolds('deletedWithCode')).toEqual([]);
            expect(store.getFolds('existing')).toEqual(FOLDS);
            expect(store.getFolds('unreachable')).toEqual(FOLDS);

            await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
            expect(Object.keys(savedValue())).toEqual(['existing', 'unreachable']);
        });

        it('does not save when nothing was removed', async () => {
            const store = await loadStore(JSON.stringify({ existing: { folds: FOLDS, updatedAt: 1 } }));

            await store.sweepDeletedNotes();
            await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
            expect(joplinMock.settings.setValue).not.toHaveBeenCalled();
        });
    });
});

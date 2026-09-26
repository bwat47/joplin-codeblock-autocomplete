/**
 * Per-note code block fold state, kept in memory and saved to a hidden plugin setting.
 *
 * The setting is local to this device and works on desktop and mobile. Folds that no longer match
 * a note's text are dropped by the editor when the note is reopened; entries for permanently
 * deleted notes are removed by a sweep shortly after startup. The note cap is only a backstop.
 */
import joplin from 'api';
import { logger } from './logger';
import { normalizeSerializedFolds, type SerializedFold } from './contentScripts/codemirror/foldSerialization';
import { SETTING_KEYS } from './settingsKeys';

type FoldStateEntry = {
    folds: SerializedFold[];
    updatedAt: number;
};

type FoldStateStoreOptions = {
    maxNotes?: number;
    saveDelayMs?: number;
};

const DEFAULT_MAX_NOTES = 2000;
const DEFAULT_SAVE_DELAY_MS = 1000;

function parseStoredEntries(raw: unknown): Map<string, FoldStateEntry> {
    const entries = new Map<string, FoldStateEntry>();
    if (typeof raw !== 'string' || raw === '') {
        return entries;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        logger.warn('Ignoring unreadable code block fold state.', error);
        return entries;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return entries;
    }

    for (const [noteId, value] of Object.entries(parsed as Record<string, unknown>)) {
        const entry = value as Partial<FoldStateEntry> | null;
        const folds = normalizeSerializedFolds(entry?.folds);
        if (folds && folds.length > 0 && typeof entry?.updatedAt === 'number') {
            entries.set(noteId, { folds, updatedAt: entry.updatedAt });
        }
    }

    return entries;
}

/**
 * Whether a data API error means the item does not exist. Joplin throws `ErrorNotFound`
 * (HTTP 404, message "Not Found"), but only its message is guaranteed to survive the IPC hop into
 * the plugin, so both are checked.
 */
function isNotFoundError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return typeof error === 'string' && /not found/i.test(error);
    }

    const { code, httpCode, message } = error as { code?: unknown; httpCode?: unknown; message?: unknown };
    return code === 404 || httpCode === 404 || (typeof message === 'string' && /not found/i.test(message));
}

export class FoldStateStore {
    private entries = new Map<string, FoldStateEntry>();
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly maxNotes: number;
    private readonly saveDelayMs: number;

    public constructor(options: FoldStateStoreOptions = {}) {
        this.maxNotes = options.maxNotes ?? DEFAULT_MAX_NOTES;
        this.saveDelayMs = options.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS;
    }

    public async load(): Promise<void> {
        this.entries = parseStoredEntries(await joplin.settings.value(SETTING_KEYS.foldState));
    }

    public getFolds(noteId: string): SerializedFold[] {
        return this.entries.get(noteId)?.folds ?? [];
    }

    /** Replaces a note's folds; an empty list removes the note's entry. */
    public setFolds(noteId: string, folds: SerializedFold[]): void {
        if (folds.length === 0) {
            if (this.entries.delete(noteId)) {
                this.scheduleSave();
            }
            return;
        }

        this.entries.set(noteId, { folds, updatedAt: Date.now() });
        this.evictOldest();
        this.scheduleSave();
    }

    /**
     * Removes entries for notes that no longer exist. Notes in the trash keep their entry because
     * they can be restored, and a lookup that fails for any other reason keeps it too: a spare
     * entry is cheaper than losing fold state to a transient error.
     */
    public async sweepDeletedNotes(): Promise<void> {
        let removed = 0;

        for (const noteId of [...this.entries.keys()]) {
            try {
                await joplin.data.get(['notes', noteId], { fields: ['id'] });
            } catch (error) {
                if (isNotFoundError(error)) {
                    this.entries.delete(noteId);
                    removed++;
                } else {
                    logger.warn(`Could not check whether note ${noteId} still exists.`, error);
                }
            }
        }

        if (removed > 0) {
            logger.info(`Removed code block fold state for ${removed} deleted note(s).`);
            this.scheduleSave();
        }
    }

    private evictOldest(): void {
        if (this.entries.size <= this.maxNotes) {
            return;
        }

        const oldestFirst = [...this.entries].sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
        for (const [noteId] of oldestFirst.slice(0, this.entries.size - this.maxNotes)) {
            this.entries.delete(noteId);
        }
    }

    private scheduleSave(): void {
        if (this.saveTimer !== null) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.save();
        }, this.saveDelayMs);
    }

    private async save(): Promise<void> {
        try {
            await joplin.settings.setValue(SETTING_KEYS.foldState, JSON.stringify(Object.fromEntries(this.entries)));
        } catch (error) {
            logger.error('Failed to save code block fold state.', error);
        }
    }
}

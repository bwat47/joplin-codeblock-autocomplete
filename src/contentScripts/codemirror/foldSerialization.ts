/**
 * Saved fold format shared by the editor content script and the main-process fold store. Pure, so
 * the main process can use it without pulling in CodeMirror.
 */

/**
 * A fold as saved for a note: the 1-based number and exact text of the line the fold starts on.
 * The fold's end is recomputed from indentation when restoring, so it always matches the text.
 */
export type SerializedFold = {
    line: number;
    text: string;
};

function isSerializedFold(value: unknown): value is SerializedFold {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const { line, text } = value as SerializedFold;
    return Number.isInteger(line) && line > 0 && typeof text === 'string';
}

/** Returns the folds as a clean array, or `null` when the value is not a valid fold list. */
export function normalizeSerializedFolds(value: unknown): SerializedFold[] | null {
    if (!Array.isArray(value) || !value.every(isSerializedFold)) {
        return null;
    }

    return value.map(({ line, text }) => ({ line, text }));
}

export function areSerializedFoldsEqual(a: readonly SerializedFold[], b: readonly SerializedFold[]): boolean {
    return (
        a.length === b.length && a.every((fold, index) => fold.line === b[index].line && fold.text === b[index].text)
    );
}

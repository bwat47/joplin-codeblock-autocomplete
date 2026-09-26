import { markdown } from '@codemirror/lang-markdown';
import { foldedRanges } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { createEditorHarness, type EditorHarness } from '../../testUtils/editorHarness';
import { createCodeFoldingExtension } from './codeFolding';
import { applyPluginSettings, createSettingsExtension } from './pluginSettings';

type FoldRange = { from: number; to: number };

let harness: EditorHarness | null = null;

afterEach(() => {
    harness?.destroy();
    harness = null;
});

function createFoldingEditor(doc: string, enableCodeFolding = true): EditorView {
    harness = createEditorHarness(doc, {
        rawInput: true,
        extensions: [markdown(), createSettingsExtension(), createCodeFoldingExtension()],
    });
    setCodeFolding(harness.view, enableCodeFolding);
    return harness.view;
}

function setCodeFolding(view: EditorView, enableCodeFolding: boolean): void {
    applyPluginSettings(view, {
        enableLanguageAutocomplete: true,
        enableCopyWidget: false,
        enableCodeFolding,
        languages: [],
    });
}

function getMarkers(view: EditorView): HTMLElement[] {
    return Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-codeblock-fold-marker'));
}

/** Returns the only marker on the given line. */
function getLineMarker(view: EditorView, lineNumber: number): HTMLElement {
    const markers = getMarkers(view).filter(
        (marker) => view.state.doc.lineAt(view.posAtDOM(marker)).number === lineNumber
    );
    if (markers.length !== 1) throw new Error(`Expected one fold marker on line ${lineNumber}.`);
    return markers[0];
}

function getFolds(view: EditorView): FoldRange[] {
    const folds: FoldRange[] = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
        folds.push({ from, to });
    });
    return folds;
}

function clickMarker(view: EditorView, lineNumber: number): void {
    getLineMarker(view, lineNumber).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

function lineEnd(view: EditorView, lineNumber: number): number {
    return view.state.doc.line(lineNumber).to;
}

const JS_BLOCK = ['# Title', '', '```js', 'function f() {', '    return 1;', '}', '```'].join('\n');

describe('code block folding', () => {
    it('renders no markers while the setting is off', () => {
        const view = createFoldingEditor(JS_BLOCK, false);
        expect(getMarkers(view)).toHaveLength(0);
    });

    it('marks only foldable lines inside fenced code', () => {
        const doc = [
            '- item',
            '    indented list text',
            '',
            '```js',
            'function f() {',
            '    return 1;',
            '}',
            '```',
        ].join('\n');
        const view = createFoldingEditor(doc);

        expect(getMarkers(view)).toHaveLength(1);
        getLineMarker(view, 5);
    });

    it("places each marker at its line's indentation level", () => {
        const doc = ['```js', 'function f() {', '    if (x) {', '        y();', '    }', '}', '```'].join('\n');
        const view = createFoldingEditor(doc);

        expect(view.posAtDOM(getLineMarker(view, 2))).toBe(view.state.doc.line(2).from);
        expect(view.posAtDOM(getLineMarker(view, 3))).toBe(view.state.doc.line(3).from + 4);
    });

    it('folds and unfolds the indented body from the marker', () => {
        const view = createFoldingEditor(JS_BLOCK);

        clickMarker(view, 4);
        expect(getFolds(view)).toEqual([{ from: lineEnd(view, 4), to: lineEnd(view, 5) }]);
        expect(getLineMarker(view, 4).classList).toContain('cm-codeblock-fold-marker-folded');

        clickMarker(view, 4);
        expect(getFolds(view)).toEqual([]);
        expect(getLineMarker(view, 4).classList).not.toContain('cm-codeblock-fold-marker-folded');
    });

    it('measures indentation after the blockquote markers', () => {
        const doc = ['> ```py', '> def f():', '>     return 1', '> ```'].join('\n');
        const view = createFoldingEditor(doc);

        expect(view.posAtDOM(getLineMarker(view, 2))).toBe(view.state.doc.line(2).from + 2);
        clickMarker(view, 2);
        expect(getFolds(view)).toEqual([{ from: lineEnd(view, 2), to: lineEnd(view, 3) }]);
    });

    it('does not treat code starting with ">" as a blockquote marker', () => {
        // Stripping `> ` here would make the second line look indented beneath the first.
        const doc = ['```', 'quote:', '>     reply', '```'].join('\n');
        const view = createFoldingEditor(doc);

        expect(getMarkers(view)).toHaveLength(0);
    });

    it('removes the markers and clears folds when the setting is turned off', () => {
        const view = createFoldingEditor(JS_BLOCK);
        clickMarker(view, 4);
        expect(getFolds(view)).toHaveLength(1);

        setCodeFolding(view, false);
        expect(getMarkers(view)).toHaveLength(0);
        expect(getFolds(view)).toEqual([]);
    });
});

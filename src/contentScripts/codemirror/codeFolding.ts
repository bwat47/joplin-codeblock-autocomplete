/**
 * Indentation-based folding inside fenced code blocks, with a fold arrow drawn inline just before
 * each foldable line's first character, at its indentation level.
 *
 * Folding is limited to the content lines of fenced code blocks, so enabling it does not make
 * headings, lists, or whole fences foldable. The whole feature lives in a compartment toggled by
 * the plugin setting, so disabling drops any existing folds along with `codeFolding()`.
 */
import { codeFolding, foldEffect, foldedRanges, syntaxTree, unfoldEffect } from '@codemirror/language';
import { Compartment, type EditorState, type Extension, type Range, type StateEffect } from '@codemirror/state';
import {
    Decoration,
    type DecorationSet,
    EditorView,
    type PluginValue,
    type ViewUpdate,
    ViewPlugin,
    WidgetType,
} from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { getFencedCodeBlockGeometry, getFencedCodeSyntaxTree } from './fencedCodeBlock';
import { findIndentFoldEnd } from './indentFold';

type FoldRange = {
    from: number;
    to: number;
};

type FoldableLine = FoldRange & {
    /** Where the arrow goes: the line's first character after any blockquote markers and indent. */
    markerPos: number;
};

/**
 * One blockquote marker with its optional trailing space.
 *
 * Example: `"> > code"` → first match `"> "`, leaving `"> code"`.
 */
const BLOCKQUOTE_MARKER_PATTERN = /^[ \t]*>[ \t]?/;

const codeFoldingCompartment = new Compartment();

function createChevronIcon(ownerDocument: Document): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = ownerDocument.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');

    const path = ownerDocument.createElementNS(namespace, 'path');
    path.setAttribute('d', 'M4 6l4 4 4-4');
    svg.append(path);
    return svg;
}

function getBlockquoteDepth(node: SyntaxNode): number {
    let depth = 0;
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor.name === 'Blockquote') {
            depth++;
        }
    }
    return depth;
}

/**
 * Removes the enclosing blockquotes' `>` markers from a content line so they do not hide its
 * indentation. Exactly `depth` markers are removed, so code that itself starts with `>` (a
 * `>>>` prompt, say) is left alone in blocks that are not inside a blockquote.
 */
function stripBlockquoteMarkers(text: string, depth: number): string {
    let stripped = text;
    for (let i = 0; i < depth; i++) {
        stripped = stripped.replace(BLOCKQUOTE_MARKER_PATTERN, '');
    }
    return stripped;
}

/** Offset of the first non-whitespace character, or the text length for a blank line. */
function getIndentLength(text: string): number {
    const index = text.search(/\S/);
    return index === -1 ? text.length : index;
}

/**
 * Finds every foldable content line in the fenced code blocks within the viewport, keyed by the
 * line's start offset. A fold runs from the end of its first line to the end of its last line, so
 * the first line stays visible.
 */
function findViewportFoldableLines(view: EditorView): Map<number, FoldableLine> {
    const { state } = view;
    const { doc } = state;
    const { from: viewportFrom, to: viewportTo } = view.viewport;
    const foldableLines = new Map<number, FoldableLine>();
    const { tree } = getFencedCodeSyntaxTree(state, viewportTo);

    tree.iterate({
        from: viewportFrom,
        to: viewportTo,
        enter: (node) => {
            if (node.name !== 'FencedCode') {
                return undefined;
            }

            const { contentFrom, contentTo } = getFencedCodeBlockGeometry(state, node.node);
            if (contentTo <= contentFrom) {
                return false;
            }

            const firstLine = doc.lineAt(contentFrom).number;
            const lastLine = doc.lineAt(contentTo).number;
            const blockquoteDepth = getBlockquoteDepth(node.node);
            const getLine = (index: number): string | undefined => {
                const lineNumber = firstLine + index;
                return lineNumber <= lastLine
                    ? stripBlockquoteMarkers(doc.line(lineNumber).text, blockquoteDepth)
                    : undefined;
            };

            const visibleFirst = Math.max(firstLine, doc.lineAt(viewportFrom).number);
            const visibleLast = Math.min(lastLine, doc.lineAt(viewportTo).number);
            for (let lineNumber = visibleFirst; lineNumber <= visibleLast; lineNumber++) {
                const end = findIndentFoldEnd(getLine, lineNumber - firstLine, state.tabSize);
                if (end !== null) {
                    const line = doc.line(lineNumber);
                    const content = stripBlockquoteMarkers(line.text, blockquoteDepth);
                    foldableLines.set(line.from, {
                        from: line.to,
                        to: doc.line(firstLine + end).to,
                        markerPos: line.from + (line.text.length - content.length) + getIndentLength(content),
                    });
                }
            }

            return false;
        },
    });

    return foldableLines;
}

/** Returns the folded range that starts at the end of the given line, if any. */
function findFoldAtLine(state: EditorState, lineFrom: number): FoldRange | null {
    const lineTo = state.doc.lineAt(lineFrom).to;
    let found: FoldRange | null = null;
    foldedRanges(state).between(lineTo, lineTo, (from, to) => {
        if (from === lineTo) {
            found = { from, to };
            return false;
        }
        return undefined;
    });
    return found;
}

class FoldMarkerWidget extends WidgetType {
    public constructor(private readonly folded: boolean) {
        super();
    }

    public eq(other: WidgetType): boolean {
        return other instanceof FoldMarkerWidget && other.folded === this.folded;
    }

    /**
     * The widget itself is zero-width so the line's text does not move; the icon is positioned
     * absolutely to its left, over the indentation or the code block's left padding.
     */
    public toDOM(view: EditorView): HTMLElement {
        const ownerDocument = view.dom.ownerDocument;
        const marker = ownerDocument.createElement('span');
        marker.className = this.folded
            ? 'cm-codeblock-fold-marker cm-codeblock-fold-marker-folded'
            : 'cm-codeblock-fold-marker';
        marker.title = this.folded ? 'Unfold' : 'Fold';
        marker.setAttribute('aria-hidden', 'true');
        marker.append(createChevronIcon(ownerDocument));

        // Keep the click from moving the cursor or starting a selection.
        marker.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });
        marker.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleFoldAtLine(view, view.state.doc.lineAt(view.posAtDOM(marker)).from);
        });

        return marker;
    }

    public ignoreEvent(): boolean {
        return true;
    }
}

const OPEN_MARKER = Decoration.widget({ widget: new FoldMarkerWidget(false), side: -1 });
const FOLDED_MARKER = Decoration.widget({ widget: new FoldMarkerWidget(true), side: -1 });

class FoldMarkerPlugin implements PluginValue {
    public foldableLines: Map<number, FoldableLine>;
    public decorations: DecorationSet;

    public constructor(view: EditorView) {
        this.foldableLines = findViewportFoldableLines(view);
        this.decorations = this.buildDecorations(view.state);
    }

    public update(update: ViewUpdate): void {
        const structureChanged =
            update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state);
        if (structureChanged) {
            this.foldableLines = findViewportFoldableLines(update.view);
        }

        if (structureChanged || foldedRanges(update.startState) !== foldedRanges(update.state)) {
            this.decorations = this.buildDecorations(update.state);
        }
    }

    /**
     * A folded line keeps its arrow even if an edit made it unfoldable, so the fold can always be
     * opened again from the arrow. A fold starts at its first line's end, so the line holding
     * `from` is the folded line.
     */
    private buildDecorations(state: EditorState): DecorationSet {
        const { doc } = state;
        const markers = new Map<number, Range<Decoration>>();

        for (const [lineFrom, line] of this.foldableLines) {
            markers.set(lineFrom, OPEN_MARKER.range(line.markerPos));
        }
        foldedRanges(state).between(0, doc.length, (from) => {
            const line = doc.lineAt(from);
            const markerPos = this.foldableLines.get(line.from)?.markerPos ?? line.from + getIndentLength(line.text);
            markers.set(line.from, FOLDED_MARKER.range(markerPos));
        });

        return Decoration.set([...markers.values()], true);
    }
}

const foldMarkerPlugin = ViewPlugin.fromClass(FoldMarkerPlugin, {
    decorations: (plugin) => plugin.decorations,
});

function toggleFoldAtLine(view: EditorView, lineFrom: number): void {
    const folded = findFoldAtLine(view.state, lineFrom);
    if (folded) {
        view.dispatch({ effects: unfoldEffect.of(folded) });
        return;
    }

    const line = view.plugin(foldMarkerPlugin)?.foldableLines.get(lineFrom);
    if (line) {
        view.dispatch({ effects: foldEffect.of({ from: line.from, to: line.to }) });
    }
}

const codeFoldingTheme = EditorView.baseTheme({
    '.cm-codeblock-fold-marker': {
        position: 'relative',
        display: 'inline-block',
        width: '0',
        height: '1em',
        verticalAlign: '-0.15em',
        cursor: 'pointer',
        opacity: '0',
        transition: 'opacity 0.1s',
    },
    '.cm-line:hover .cm-codeblock-fold-marker, .cm-codeblock-fold-marker-folded': {
        opacity: '0.7',
    },
    '@media (any-hover: none)': {
        '.cm-codeblock-fold-marker': {
            opacity: '0.7',
        },
    },
    '.cm-codeblock-fold-marker svg': {
        position: 'absolute',
        right: '0.2em',
        top: '0.05em',
        width: '0.9em',
        height: '0.9em',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: '1.75',
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
    },
    '.cm-codeblock-fold-marker-folded svg': {
        transform: 'rotate(-90deg)',
    },
});

export function createCodeFoldingExtension(): Extension {
    return codeFoldingCompartment.of([]);
}

/** Returns the effect that turns code block folding on or off. */
export function codeFoldingReconfigureEffect(enabled: boolean): StateEffect<unknown> {
    return codeFoldingCompartment.reconfigure(enabled ? [codeFolding(), foldMarkerPlugin, codeFoldingTheme] : []);
}

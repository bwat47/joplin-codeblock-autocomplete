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

type ViewportCodeBlocks = {
    /** Start offsets of every visible line of a fenced code block, fence lines included. */
    blockLineFroms: number[];
    foldableLines: Map<number, FoldableLine>;
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

type CodeBlockContent = {
    firstLine: number;
    lastLine: number;
    blockquoteDepth: number;
    /** Reads a content line by its index within the block, blockquote markers removed. */
    getLine: (index: number) => string | undefined;
};

/** Describes a fenced code block's content lines, or returns `null` when it has none. */
function getCodeBlockContent(state: EditorState, fencedCodeNode: SyntaxNode): CodeBlockContent | null {
    const { doc } = state;
    const { contentFrom, contentTo } = getFencedCodeBlockGeometry(state, fencedCodeNode);
    if (contentTo <= contentFrom) {
        return null;
    }

    const firstLine = doc.lineAt(contentFrom).number;
    const lastLine = doc.lineAt(contentTo).number;
    const blockquoteDepth = getBlockquoteDepth(fencedCodeNode);
    return {
        firstLine,
        lastLine,
        blockquoteDepth,
        getLine: (index) => {
            const lineNumber = firstLine + index;
            return lineNumber <= lastLine
                ? stripBlockquoteMarkers(doc.line(lineNumber).text, blockquoteDepth)
                : undefined;
        },
    };
}

/**
 * Computes the fold starting at a content line of the given block. A fold runs from the end of its
 * first line to the end of its last line, so the first line stays visible.
 */
function computeFoldableLine(state: EditorState, block: CodeBlockContent, lineNumber: number): FoldableLine | null {
    const end = findIndentFoldEnd(block.getLine, lineNumber - block.firstLine, state.tabSize);
    if (end === null) {
        return null;
    }

    const line = state.doc.line(lineNumber);
    const content = stripBlockquoteMarkers(line.text, block.blockquoteDepth);
    return {
        from: line.to,
        to: state.doc.line(block.firstLine + end).to,
        markerPos: line.from + (line.text.length - content.length) + getIndentLength(content),
    };
}

/**
 * Finds the visible lines of the fenced code blocks within the viewport, and every foldable
 * content line among them keyed by the line's start offset.
 */
function findViewportCodeBlocks(view: EditorView): ViewportCodeBlocks {
    const { state } = view;
    const { doc } = state;
    const { from: viewportFrom, to: viewportTo } = view.viewport;
    const viewportFirstLine = doc.lineAt(viewportFrom).number;
    const viewportLastLine = doc.lineAt(viewportTo).number;
    const blockLineFroms: number[] = [];
    const foldableLines = new Map<number, FoldableLine>();
    const { tree } = getFencedCodeSyntaxTree(state, viewportTo);

    tree.iterate({
        from: viewportFrom,
        to: viewportTo,
        enter: (node) => {
            if (node.name !== 'FencedCode') {
                return undefined;
            }

            const { blockTo, openingLineFrom } = getFencedCodeBlockGeometry(state, node.node);
            const blockLast = Math.min(doc.lineAt(blockTo).number, viewportLastLine);
            for (let n = Math.max(doc.lineAt(openingLineFrom).number, viewportFirstLine); n <= blockLast; n++) {
                blockLineFroms.push(doc.line(n).from);
            }

            const block = getCodeBlockContent(state, node.node);
            if (!block) {
                return false;
            }

            const visibleLast = Math.min(block.lastLine, viewportLastLine);
            for (let n = Math.max(block.firstLine, viewportFirstLine); n <= visibleLast; n++) {
                const foldableLine = computeFoldableLine(state, block, n);
                if (foldableLine) {
                    foldableLines.set(doc.line(n).from, foldableLine);
                }
            }

            return false;
        },
    });

    return { blockLineFroms, foldableLines };
}

export type ResolvedFoldableLine = {
    /** Whether the syntax tree covered the line; when false, `line` is not meaningful yet. */
    complete: boolean;
    line: FoldRange | null;
};

/**
 * Resolves the fold that would start at the given line, for restoring saved folds. Only content
 * lines of fenced code blocks can fold; fence lines and lines outside code blocks resolve to `null`.
 */
export function resolveFoldableLine(state: EditorState, lineNumber: number): ResolvedFoldableLine {
    const line = state.doc.line(lineNumber);
    const { complete, tree } = getFencedCodeSyntaxTree(state, line.to);
    if (!complete) {
        return { complete: false, line: null };
    }

    // A fenced block's range is contiguous, so its node covers the start of every line it spans,
    // including blockquote markers and list indentation on its content lines.
    let block: CodeBlockContent | null = null;
    for (let node: SyntaxNode | null = tree.resolveInner(line.from, 1); node; node = node.parent) {
        if (node.name === 'FencedCode') {
            block = getCodeBlockContent(state, node);
            break;
        }
    }

    if (!block || lineNumber < block.firstLine || lineNumber > block.lastLine) {
        return { complete: true, line: null };
    }

    const foldableLine = computeFoldableLine(state, block, lineNumber);
    return { complete: true, line: foldableLine && { from: foldableLine.from, to: foldableLine.to } };
}

/** Returns the folded range that starts at the end of the given line, if any. */
function findFoldedRangeAtLine(state: EditorState, lineFrom: number): FoldRange | null {
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
     * absolutely to its left, over the indentation or the left padding given to code block lines.
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
const CODE_BLOCK_LINE = Decoration.line({ class: 'cm-codeblock-fold-line' });

class FoldMarkerPlugin implements PluginValue {
    public codeBlocks: ViewportCodeBlocks;
    public decorations: DecorationSet;

    public constructor(view: EditorView) {
        this.codeBlocks = findViewportCodeBlocks(view);
        this.decorations = this.buildDecorations(view.state);
    }

    public update(update: ViewUpdate): void {
        const structureChanged =
            update.docChanged || update.viewportChanged || syntaxTree(update.startState) !== syntaxTree(update.state);
        if (structureChanged) {
            this.codeBlocks = findViewportCodeBlocks(update.view);
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
        const { blockLineFroms, foldableLines } = this.codeBlocks;
        const markers = new Map<number, Range<Decoration>>();

        for (const [lineFrom, line] of foldableLines) {
            markers.set(lineFrom, OPEN_MARKER.range(line.markerPos));
        }
        foldedRanges(state).between(0, doc.length, (from) => {
            const line = doc.lineAt(from);
            const markerPos = foldableLines.get(line.from)?.markerPos ?? line.from + getIndentLength(line.text);
            markers.set(line.from, FOLDED_MARKER.range(markerPos));
        });

        const lines = blockLineFroms.map((lineFrom) => CODE_BLOCK_LINE.range(lineFrom));
        return Decoration.set([...lines, ...markers.values()], true);
    }
}

const foldMarkerPlugin = ViewPlugin.fromClass(FoldMarkerPlugin, {
    decorations: (plugin) => plugin.decorations,
});

function toggleFoldAtLine(view: EditorView, lineFrom: number): void {
    const folded = findFoldedRangeAtLine(view.state, lineFrom);
    if (folded) {
        view.dispatch({ effects: unfoldEffect.of(folded) });
        return;
    }

    const line = view.plugin(foldMarkerPlugin)?.codeBlocks.foldableLines.get(lineFrom);
    if (line) {
        view.dispatch({ effects: foldEffect.of({ from: line.from, to: line.to }) });
    }
}

const codeFoldingTheme = EditorView.baseTheme({
    // Room inside the code block's background for the arrows of unindented lines. Joplin sets
    // `padding-left: 1px` on lines of gutterless editors with
    // `&:not(:has(> .cm-scroller > .cm-gutters)) .cm-line`, which counts as four classes, so this
    // selector is anchored to the editor and content to outrank it.
    '&.cm-editor .cm-content > .cm-line.cm-codeblock-fold-line': {
        paddingLeft: '1.5em',
    },
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

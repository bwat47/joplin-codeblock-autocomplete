import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, type ViewUpdate, ViewPlugin, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { logger } from '../logger';
import { areSettingsEqual, getPluginSettings } from './pluginSettings';
import type { PluginContext } from './types';

type FencedCodeBlockInfo = {
    copyText: string;
    hiddenInfoFrom: number | null;
    hiddenInfoTo: number | null;
    interactionSelectionAnchor: number;
    language: string | null;
    openingLineFrom: number;
    openingLineTo: number;
};

const SYNTAX_TREE_PARSE_TIMEOUT_MS = 100;
const COPY_WIDGET_TITLE = 'Copy code block';
const COPY_ICON_LABEL = 'Copy';

function getInteractionSelectionAnchor(state: EditorView['state'], openingLineFrom: number): number {
    const openingLine = state.doc.lineAt(openingLineFrom);

    if (openingLine.number < state.doc.lines) {
        return state.doc.line(openingLine.number + 1).from;
    }

    if (openingLine.number > 1) {
        return state.doc.line(openingLine.number - 1).from;
    }

    return openingLine.from;
}

export const copyWidgetTheme = EditorView.baseTheme({
    '.cm-line.cm-codeblock-copy-line': {
        position: 'relative',
    },
    '.cm-codeblock-copy-widget': {
        position: 'absolute',
        top: '0',
        right: '0.25rem',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.25rem',
        padding: '0 0.35rem',
        border: '0',
        borderRadius: '4px',
        backgroundColor: 'transparent',
        color: 'inherit',
        font: 'inherit',
        lineHeight: '1.4',
        cursor: 'pointer',
    },
    '@media (any-hover: hover)': {
        '.cm-codeblock-copy-widget:hover': {
            backgroundColor: 'rgba(127, 127, 127, 0.16)',
        },
    },
    '.cm-codeblock-copy-widget:focus': {
        outline: 'none',
    },
    '.cm-codeblock-copy-widget svg': {
        width: '0.95em',
        height: '0.95em',
        display: 'block',
        fill: 'currentColor',
    },
});

function getFencedCodeBlockInfo(
    state: EditorView['state'],
    fencedCodeNode: SyntaxNode
): FencedCodeBlockInfo | undefined {
    const openingLine = state.doc.lineAt(fencedCodeNode.from);
    let openingFenceMark: SyntaxNode | null = null;
    let closingFenceMark: SyntaxNode | null = null;
    let codeInfo: SyntaxNode | null = null;

    for (let child = fencedCodeNode.firstChild; child; child = child.nextSibling) {
        if (child.name === 'CodeMark') {
            if (!openingFenceMark && child.from >= openingLine.from && child.to <= openingLine.to) {
                openingFenceMark = child;
            } else if (child.from > openingLine.to) {
                closingFenceMark = child;
            }
        } else if (child.name === 'CodeInfo' && child.from >= openingLine.from && child.to <= openingLine.to) {
            codeInfo = child;
        }
    }

    const lineBreak = state.lineBreak || '\n';
    const contentFrom = Math.min(openingLine.to + lineBreak.length, state.doc.length);
    const closingLineStart = closingFenceMark ? state.doc.lineAt(closingFenceMark.from).from : fencedCodeNode.to;
    const contentTo = closingFenceMark ? Math.max(contentFrom, closingLineStart - lineBreak.length) : closingLineStart;

    return {
        copyText: getFencedCodeBlockCopyText(state, fencedCodeNode, contentFrom, contentTo),
        hiddenInfoFrom: openingFenceMark && codeInfo ? openingFenceMark.to : null,
        hiddenInfoTo: codeInfo ? codeInfo.to : null,
        interactionSelectionAnchor: getInteractionSelectionAnchor(state, openingLine.from),
        language: codeInfo ? state.doc.sliceString(codeInfo.from, codeInfo.to) : null,
        openingLineFrom: openingLine.from,
        openingLineTo: openingLine.to,
    };
}

function getVisibleFencedCodeBlocks(view: EditorView): FencedCodeBlockInfo[] {
    const seenBlocks = new Set<number>();
    const blocks: FencedCodeBlockInfo[] = [];
    const tree = ensureSyntaxTree(view.state, view.viewport.to, SYNTAX_TREE_PARSE_TIMEOUT_MS) ?? syntaxTree(view.state);

    for (const { from, to } of view.visibleRanges) {
        tree.iterate({
            from,
            to,
            enter: (node) => {
                if (node.name !== 'FencedCode') {
                    return undefined;
                }

                if (seenBlocks.has(node.from)) {
                    return false;
                }
                seenBlocks.add(node.from);

                const blockInfo = getFencedCodeBlockInfo(view.state, node.node);
                if (blockInfo) {
                    blocks.push(blockInfo);
                }

                return false;
            },
        });
    }

    return blocks;
}

/**
 * Returns the set of block opening-line offsets that currently have a cursor on them.
 * Every cursor in a multi-cursor selection is considered, so a block's widget is
 * suppressed whenever any cursor sits on its opening fence line.
 */
function getActiveOpeningLineFroms(state: EditorView['state'], blocks: readonly FencedCodeBlockInfo[]): Set<number> {
    const activeOpeningLineFroms = new Set<number>();
    if (blocks.length === 0) {
        return activeOpeningLineFroms;
    }

    const selectedLineFroms = new Set<number>();
    for (const range of state.selection.ranges) {
        selectedLineFroms.add(state.doc.lineAt(range.head).from);
    }

    for (const block of blocks) {
        if (selectedLineFroms.has(block.openingLineFrom)) {
            activeOpeningLineFroms.add(block.openingLineFrom);
        }
    }

    return activeOpeningLineFroms;
}

function areLineFromSetsEqual(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
    if (a.size !== b.size) {
        return false;
    }

    for (const value of a) {
        if (!b.has(value)) {
            return false;
        }
    }

    return true;
}

function getCopyText(state: EditorView['state'], contentFrom: number, contentTo: number): string {
    const from = Math.max(0, Math.min(contentFrom, state.doc.length));
    const to = Math.max(from, Math.min(contentTo, state.doc.length));
    return state.doc.sliceString(from, to);
}

function getFencedCodeBlockCopyText(
    state: EditorView['state'],
    fencedCodeNode: SyntaxNode,
    contentFrom: number,
    contentTo: number
): string {
    const codeTextParts: string[] = [];

    for (let child = fencedCodeNode.firstChild; child; child = child.nextSibling) {
        if (child.name === 'CodeText') {
            codeTextParts.push(state.doc.sliceString(child.from, child.to));
        }
    }

    if (codeTextParts.length > 0) {
        return codeTextParts.join('');
    }

    return getCopyText(state, contentFrom, contentTo);
}

function createCopyIcon(ownerDocument: Document): SVGSVGElement {
    const namespace = 'http://www.w3.org/2000/svg';
    const svg = ownerDocument.createElementNS(namespace, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');

    const backSheet = ownerDocument.createElementNS(namespace, 'path');
    backSheet.setAttribute(
        'd',
        'M5 1.75A1.75 1.75 0 0 0 3.25 3.5v7A1.75 1.75 0 0 0 5 12.25h.75v-1.5H5a.25.25 0 0 1-.25-.25v-7A.25.25 0 0 1 5 3.25h4.5a.25.25 0 0 1 .25.25V4h1.5v-.5A1.75 1.75 0 0 0 9.5 1.75H5Z'
    );

    const frontSheet = ownerDocument.createElementNS(namespace, 'path');
    frontSheet.setAttribute(
        'd',
        'M8 5.75A1.75 1.75 0 0 0 6.25 7.5v5A1.75 1.75 0 0 0 8 14.25h4A1.75 1.75 0 0 0 13.75 12.5v-5A1.75 1.75 0 0 0 12 5.75H8Zm0 1.5h4a.25.25 0 0 1 .25.25v5a.25.25 0 0 1-.25.25H8a.25.25 0 0 1-.25-.25v-5A.25.25 0 0 1 8 7.25Z'
    );

    svg.append(backSheet, frontSheet);
    return svg;
}

class CopyCodeBlockWidget extends WidgetType {
    public constructor(
        private readonly context: PluginContext,
        private readonly interactionSelectionAnchor: number,
        private readonly language: string | null,
        private readonly copyText: string
    ) {
        super();
    }

    public eq(other: WidgetType): boolean {
        return (
            other instanceof CopyCodeBlockWidget &&
            other.interactionSelectionAnchor === this.interactionSelectionAnchor &&
            other.language === this.language &&
            other.copyText === this.copyText
        );
    }

    public toDOM(view: EditorView): HTMLElement {
        const ownerDocument = view.dom.ownerDocument;
        const button = ownerDocument.createElement('button');
        let selectionMoveRequestedByTouch = false;

        button.type = 'button';
        button.className = 'cm-codeblock-copy-widget';
        button.title = COPY_WIDGET_TITLE;
        button.setAttribute('aria-label', this.language ? `Copy ${this.language} code block` : COPY_WIDGET_TITLE);

        button.append(createCopyIcon(ownerDocument));
        button.append(ownerDocument.createTextNode(this.language ?? COPY_ICON_LABEL));

        button.addEventListener('pointerdown', (event) => {
            selectionMoveRequestedByTouch = event.pointerType === 'touch';
        });

        // Do not clear this on pointerup: touch browsers dispatch the click after pointerup,
        // and that click still needs to move the selection to avoid the mobile scroll jump.
        button.addEventListener('pointercancel', () => {
            selectionMoveRequestedByTouch = false;
        });

        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();

            if (selectionMoveRequestedByTouch) {
                this.moveSelectionForCopy(view);
            }

            selectionMoveRequestedByTouch = false;
            void this.copyCodeBlock();
        });

        return button;
    }

    public ignoreEvent(): boolean {
        return true;
    }

    private moveSelectionForCopy(view: EditorView): void {
        view.dispatch({
            selection: { anchor: this.interactionSelectionAnchor },
        });
        view.focus();
    }

    private async copyCodeBlock(): Promise<void> {
        try {
            await this.context.postMessage({
                command: 'copyCodeBlock',
                text: this.copyText,
            });
        } catch (error) {
            logger.error('Failed to copy code block:', error);
        }
    }
}

function buildCopyWidgetDecorations(
    context: PluginContext,
    blocks: readonly FencedCodeBlockInfo[],
    activeOpeningLineFroms: ReadonlySet<number>
): DecorationSet {
    if (blocks.length === 0) {
        return Decoration.none;
    }

    const decorationRanges: Range<Decoration>[] = [];

    for (const block of blocks) {
        if (activeOpeningLineFroms.has(block.openingLineFrom)) {
            continue;
        }

        decorationRanges.push(Decoration.line({ class: 'cm-codeblock-copy-line' }).range(block.openingLineFrom));

        if (block.hiddenInfoFrom !== null && block.hiddenInfoTo !== null) {
            decorationRanges.push(Decoration.replace({}).range(block.hiddenInfoFrom, block.hiddenInfoTo));
        }

        decorationRanges.push(
            Decoration.widget({
                widget: new CopyCodeBlockWidget(
                    context,
                    block.interactionSelectionAnchor,
                    block.language,
                    block.copyText
                ),
                side: 1,
            }).range(block.openingLineTo)
        );
    }

    return Decoration.set(decorationRanges, true);
}

export function createCopyWidgetPlugin(context: PluginContext) {
    return ViewPlugin.fromClass(
        class {
            blocks: readonly FencedCodeBlockInfo[] = [];
            decorations: DecorationSet = Decoration.none;
            activeOpeningLineFroms: ReadonlySet<number> = new Set();

            constructor(view: EditorView) {
                this.rebuildStructure(view);
            }

            update(update: ViewUpdate): void {
                const previousSettings = getPluginSettings(update.startState);
                const nextSettings = getPluginSettings(update.state);
                const settingsChanged = !areSettingsEqual(previousSettings, nextSettings);

                if (!nextSettings.enableCopyWidget) {
                    if (this.blocks.length > 0 || this.activeOpeningLineFroms.size > 0 || settingsChanged) {
                        this.blocks = [];
                        this.activeOpeningLineFroms = new Set();
                        this.decorations = Decoration.none;
                    }
                    return;
                }

                if (update.docChanged || update.viewportChanged || settingsChanged) {
                    this.rebuildStructure(update.view);
                    return;
                }

                if (update.selectionSet) {
                    const nextActiveOpeningLineFroms = getActiveOpeningLineFroms(update.state, this.blocks);
                    if (!areLineFromSetsEqual(nextActiveOpeningLineFroms, this.activeOpeningLineFroms)) {
                        this.activeOpeningLineFroms = nextActiveOpeningLineFroms;
                        this.decorations = buildCopyWidgetDecorations(
                            context,
                            this.blocks,
                            this.activeOpeningLineFroms
                        );
                    }
                }
            }

            private rebuildStructure(view: EditorView): void {
                const settings = getPluginSettings(view.state);
                if (!settings.enableCopyWidget) {
                    this.blocks = [];
                    this.activeOpeningLineFroms = new Set();
                    this.decorations = Decoration.none;
                    return;
                }

                this.blocks = getVisibleFencedCodeBlocks(view);
                this.activeOpeningLineFroms = getActiveOpeningLineFroms(view.state, this.blocks);
                this.decorations = buildCopyWidgetDecorations(context, this.blocks, this.activeOpeningLineFroms);
            }
        },
        {
            decorations: (value) => value.decorations,
        }
    );
}

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
    language: string | null;
    openingLineFrom: number;
    openingLineNumber: number;
    openingLineTo: number;
};

const SYNTAX_TREE_PARSE_TIMEOUT_MS = 100;
const COPY_WIDGET_TITLE = 'Copy code block';
const COPY_ICON_LABEL = 'Copy';

export const copyWidgetTheme = EditorView.baseTheme({
    '.cm-line.cm-codeblock-copy-line': {
        position: 'relative',
    },
    '.cm-codeblock-copy-hidden': {
        display: 'none',
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
    '.cm-codeblock-copy-widget:hover': {
        backgroundColor: 'rgba(127, 127, 127, 0.16)',
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
    const copyText = contentFrom <= contentTo ? state.doc.sliceString(contentFrom, contentTo) : '';

    return {
        copyText,
        hiddenInfoFrom: openingFenceMark && codeInfo ? openingFenceMark.to : null,
        hiddenInfoTo: codeInfo ? codeInfo.to : null,
        language: codeInfo ? state.doc.sliceString(codeInfo.from, codeInfo.to) : null,
        openingLineFrom: openingLine.from,
        openingLineNumber: openingLine.number,
        openingLineTo: openingLine.to,
    };
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
        private readonly language: string | null,
        private readonly copyText: string
    ) {
        super();
    }

    public eq(other: WidgetType): boolean {
        return (
            other instanceof CopyCodeBlockWidget && other.language === this.language && other.copyText === this.copyText
        );
    }

    public toDOM(view: EditorView): HTMLElement {
        const button = view.dom.ownerDocument.createElement('button');
        button.type = 'button';
        button.className = 'cm-codeblock-copy-widget';
        button.title = COPY_WIDGET_TITLE;
        button.setAttribute('aria-label', this.language ? `Copy ${this.language} code block` : COPY_WIDGET_TITLE);

        button.append(createCopyIcon(view.dom.ownerDocument));
        button.append(view.dom.ownerDocument.createTextNode(this.language ?? COPY_ICON_LABEL));

        button.addEventListener('mousedown', (event) => {
            event.preventDefault();
            event.stopPropagation();
        });

        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void this.copyCodeBlock();
        });

        return button;
    }

    public ignoreEvent(): boolean {
        return true;
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

function buildCopyWidgetDecorations(view: EditorView, context: PluginContext): DecorationSet {
    const settings = getPluginSettings(view.state);
    if (!settings.enableCopyWidget) {
        return Decoration.none;
    }

    const cursorLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
    const decorationRanges: Range<Decoration>[] = [];
    const seenBlocks = new Set<string>();
    const tree = ensureSyntaxTree(view.state, view.viewport.to, SYNTAX_TREE_PARSE_TIMEOUT_MS) ?? syntaxTree(view.state);

    for (const { from, to } of view.visibleRanges) {
        tree.iterate({
            from,
            to,
            enter: (node) => {
                if (node.name !== 'FencedCode') {
                    return undefined;
                }

                const key = `${node.from}:${node.to}`;
                if (seenBlocks.has(key)) {
                    return false;
                }
                seenBlocks.add(key);

                const blockInfo = getFencedCodeBlockInfo(view.state, node.node);
                if (!blockInfo || blockInfo.openingLineNumber === cursorLineNumber) {
                    return false;
                }

                decorationRanges.push(
                    Decoration.line({ class: 'cm-codeblock-copy-line' }).range(blockInfo.openingLineFrom)
                );

                if (blockInfo.hiddenInfoFrom !== null && blockInfo.hiddenInfoTo !== null) {
                    decorationRanges.push(
                        Decoration.mark({ class: 'cm-codeblock-copy-hidden' }).range(
                            blockInfo.hiddenInfoFrom,
                            blockInfo.hiddenInfoTo
                        )
                    );
                }

                decorationRanges.push(
                    Decoration.widget({
                        widget: new CopyCodeBlockWidget(context, blockInfo.language, blockInfo.copyText),
                        side: 1,
                    }).range(blockInfo.openingLineTo)
                );

                return false;
            },
        });
    }

    return Decoration.set(decorationRanges, true);
}

export function createCopyWidgetPlugin(context: PluginContext) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = buildCopyWidgetDecorations(view, context);
            }

            update(update: ViewUpdate): void {
                const settingsChanged = !areSettingsEqual(
                    getPluginSettings(update.startState),
                    getPluginSettings(update.state)
                );

                if (update.docChanged || update.viewportChanged || update.selectionSet || settingsChanged) {
                    this.decorations = buildCopyWidgetDecorations(update.view, context);
                }
            }
        },
        {
            decorations: (value) => value.decorations,
        }
    );
}

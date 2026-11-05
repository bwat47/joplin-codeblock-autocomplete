import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';

import { parseFenceInfo, resolveLineNumbering } from '../fenceInfo';
import { getFencedCodeBlockGeometry, getFencedCodeSyntaxTree } from './fencedCodeBlock';
import { getPluginSettings } from './pluginSettings';

const LINE_CLASS = 'cm-codeblock-line-numbers';
const LINE_NUMBER_ATTRIBUTE = 'data-codeblock-line-number';
const DIGITS_PROPERTY = '--cm-codeblock-line-number-digits';

/** Space between the number and the code, and between the number and the block's left edge. */
const NUMBER_GAP = '0.75em';
const NUMBER_INSET = '0.5em';
const GUTTER_WIDTH = `calc(var(${DIGITS_PROPERTY}, 1) * 1ch + ${NUMBER_GAP} + ${NUMBER_INSET})`;

/**
 * The gutter is reserved with a transparent `border-left` rather than `padding-left`.
 *
 * CodeMirror's selection layer reads `padding-left` (and a negative `text-indent`) from the first
 * rendered `.cm-line` and applies it to every full-line selection rectangle in the editor, so
 * padding only the code block lines would misplace selections elsewhere whenever a code line
 * happens to be rendered first. Borders are not read, and the line's background (Joplin's code
 * block shading) still paints underneath a transparent border. This also leaves `padding-left`
 * and `text-indent` free for other extensions, such as hanging indents for wrapped lines.
 *
 * The number is absolutely positioned against the padding box's left edge (`right: 100%`), which
 * places it inside the border. `text-indent` is reset because it is inherited, and a hanging
 * indent on the line would otherwise shift the number's own text.
 */
export const lineNumbersTheme = EditorView.baseTheme({
    [`.cm-line.${LINE_CLASS}`]: {
        position: 'relative',
        borderLeft: `${GUTTER_WIDTH} solid transparent`,
    },
    [`.cm-line.${LINE_CLASS}[${LINE_NUMBER_ATTRIBUTE}]::before`]: {
        content: `attr(${LINE_NUMBER_ATTRIBUTE})`,
        position: 'absolute',
        top: '0',
        right: '100%',
        marginRight: NUMBER_GAP,
        textIndent: '0',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        opacity: '0.5',
        pointerEvents: 'none',
        userSelect: 'none',
    },
});

/**
 * Decorates the visible lines of every numbered fenced code block that intersects the viewport.
 * Every block line is shifted by the gutter so the fences stay aligned with the code, but only
 * content lines are numbered, counting from the block's start number (1 unless its info string
 * sets `start=N`) on the line after the opening fence.
 *
 * Whether a block is numbered comes from its info string options, falling back to the setting,
 * so blocks are inspected even while the setting is off.
 *
 * Numbers come from the block's geometry rather than the viewport, so a block that starts above
 * the viewport still shows its true line numbers. Only lines inside the visible ranges are
 * decorated, which keeps very long blocks cheap.
 */
function buildLineNumberDecorations(view: EditorView, enabledByDefault: boolean): DecorationSet {
    const { state } = view;
    const { doc } = state;
    const { tree } = getFencedCodeSyntaxTree(state, view.viewport.to);
    const decorations: Range<Decoration>[] = [];

    for (const visibleRange of view.visibleRanges) {
        const firstVisibleLine = doc.lineAt(visibleRange.from).number;
        const lastVisibleLine = doc.lineAt(visibleRange.to).number;

        tree.iterate({
            from: visibleRange.from,
            to: visibleRange.to,
            enter: (node) => {
                if (node.name !== 'FencedCode') {
                    return undefined;
                }

                const { blockTo, children, hasClosingFence, openingLineFrom } = getFencedCodeBlockGeometry(
                    state,
                    node.node
                );
                const info = children.codeInfo ? doc.sliceString(children.codeInfo.from, children.codeInfo.to) : '';
                const numbering = resolveLineNumbering(parseFenceInfo(info), enabledByDefault);
                if (!numbering.enabled) {
                    return false;
                }

                const openingLine = doc.lineAt(openingLineFrom).number;
                const lastLine = doc.lineAt(blockTo).number;
                const lastContentLine = hasClosingFence ? lastLine - 1 : lastLine;
                const largestNumber = numbering.start + Math.max(0, lastContentLine - openingLine - 1);
                const style = `${DIGITS_PROPERTY}: ${String(largestNumber).length}`;

                const from = Math.max(openingLine, firstVisibleLine);
                const to = Math.min(lastLine, lastVisibleLine);
                for (let lineNumber = from; lineNumber <= to; lineNumber++) {
                    const isContentLine = lineNumber > openingLine && lineNumber <= lastContentLine;
                    const attributes: Record<string, string> = { style };
                    if (isContentLine) {
                        attributes[LINE_NUMBER_ATTRIBUTE] = String(numbering.start + lineNumber - openingLine - 1);
                    }

                    decorations.push(
                        Decoration.line({ class: LINE_CLASS, attributes }).range(doc.line(lineNumber).from)
                    );
                }

                return false;
            },
        });
    }

    return Decoration.set(decorations, true);
}

export function createLineNumbersPlugin(): Extension {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;

            constructor(view: EditorView) {
                this.decorations = this.build(view);
            }

            update(update: ViewUpdate): void {
                // A tree change without a doc change means a background parse has caught up,
                // which may reveal blocks that were unparsed when the decorations were built.
                if (
                    getPluginSettings(update.startState).enableLineNumbers !==
                        getPluginSettings(update.state).enableLineNumbers ||
                    update.docChanged ||
                    update.viewportChanged ||
                    syntaxTree(update.startState) !== syntaxTree(update.state)
                ) {
                    this.decorations = this.build(update.view);
                }
            }

            private build(view: EditorView): DecorationSet {
                return buildLineNumberDecorations(view, getPluginSettings(view.state).enableLineNumbers);
            }
        },
        {
            decorations: (value) => value.decorations,
        }
    );
}

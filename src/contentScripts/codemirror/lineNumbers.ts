import { syntaxTree } from '@codemirror/language';
import type { Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, type ViewUpdate, ViewPlugin } from '@codemirror/view';
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
 * Decorates the visible lines of every fenced code block that intersects the viewport. Every
 * block line is shifted by the gutter so the fences stay aligned with the code, but only content
 * lines are numbered, counting from 1 on the line after the opening fence.
 *
 * Numbers come from the block's geometry rather than the viewport, so a block that starts above
 * the viewport still shows its true line numbers. Only lines inside the visible ranges are
 * decorated, which keeps very long blocks cheap.
 */
function buildLineNumberDecorations(view: EditorView): DecorationSet {
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

                const { blockTo, hasClosingFence, openingLineFrom } = getFencedCodeBlockGeometry(state, node.node);
                const openingLine = doc.lineAt(openingLineFrom).number;
                const lastLine = doc.lineAt(blockTo).number;
                const lastContentLine = hasClosingFence ? lastLine - 1 : lastLine;
                const digits = String(Math.max(1, lastContentLine - openingLine)).length;
                const style = `${DIGITS_PROPERTY}: ${digits}`;

                const from = Math.max(openingLine, firstVisibleLine);
                const to = Math.min(lastLine, lastVisibleLine);
                for (let lineNumber = from; lineNumber <= to; lineNumber++) {
                    const isContentLine = lineNumber > openingLine && lineNumber <= lastContentLine;
                    const attributes: Record<string, string> = { style };
                    if (isContentLine) {
                        attributes[LINE_NUMBER_ATTRIBUTE] = String(lineNumber - openingLine);
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
                const wasEnabled = getPluginSettings(update.startState).enableLineNumbers;
                const isEnabled = getPluginSettings(update.state).enableLineNumbers;

                // A tree change without a doc change means a background parse has caught up,
                // which may reveal blocks that were unparsed when the decorations were built.
                if (
                    wasEnabled !== isEnabled ||
                    (isEnabled &&
                        (update.docChanged ||
                            update.viewportChanged ||
                            syntaxTree(update.startState) !== syntaxTree(update.state)))
                ) {
                    this.decorations = this.build(update.view);
                }
            }

            private build(view: EditorView): DecorationSet {
                return getPluginSettings(view.state).enableLineNumbers
                    ? buildLineNumberDecorations(view)
                    : Decoration.none;
            }
        },
        {
            decorations: (value) => value.decorations,
        }
    );
}

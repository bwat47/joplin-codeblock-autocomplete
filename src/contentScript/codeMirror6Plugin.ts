/**
 * CodeMirror 6 plugin for code block language autocompletion.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { forceParsing, syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, type ViewUpdate, ViewPlugin, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { logger } from '../logger';
import type { PluginContext, JoplinCodeMirror, PluginSettingsResponse } from './types';

type OpeningFence = {
    indent: string;
    fenceChar: string;
    fenceCount: number;
    typedLang: string;
    languageStartPos: number;
};

type VisibleRange = {
    from: number;
    to: number;
};

type FencedCodeBlockInfo = {
    copyText: string;
    hiddenInfoFrom: number | null;
    hiddenInfoTo: number | null;
    language: string | null;
    openingLineFrom: number;
    openingLineNumber: number;
    openingLineTo: number;
};

const DEFAULT_SETTINGS: PluginSettingsResponse = {
    enableLanguageAutocomplete: true,
    enableCopyWidget: false,
    languages: [],
};

const COMPLETION_TRIGGER_DELAY_MS = 10;
const IMMEDIATE_FENCE_LENGTH = 3;
const SYNTAX_TREE_PARSE_TIMEOUT_MS = 50;
const COPY_WIDGET_TITLE = 'Copy code block';
const COPY_ICON_LABEL = 'Copy';

let copyWidgetContext: PluginContext | null = null;

const updateCopyWidgetSettingsEffect = StateEffect.define<PluginSettingsResponse>();
const updateCopyWidgetVisibleRangesEffect = StateEffect.define<VisibleRange[]>();
const refreshCopyWidgetDecorationsEffect = StateEffect.define();

const copyWidgetSettingsField = StateField.define<PluginSettingsResponse>({
    create: () => DEFAULT_SETTINGS,
    update: (value, transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(updateCopyWidgetSettingsEffect)) {
                return effect.value;
            }
        }

        return value;
    },
});

const copyWidgetVisibleRangesField = StateField.define<VisibleRange[]>({
    create: (state) => [{ from: 0, to: state.doc.length }],
    update: (value, transaction) => {
        for (const effect of transaction.effects) {
            if (effect.is(updateCopyWidgetVisibleRangesEffect)) {
                return effect.value;
            }
        }

        if (!transaction.docChanged) {
            return value;
        }

        return value.map((range) => ({
            from: transaction.changes.mapPos(range.from, -1),
            to: transaction.changes.mapPos(range.to, 1),
        }));
    },
});

const copyWidgetDecorationsField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (value, transaction) => {
        const shouldRecompute =
            transaction.docChanged ||
            transaction.selection !== undefined ||
            transaction.effects.some(
                (effect) =>
                    effect.is(updateCopyWidgetSettingsEffect) ||
                    effect.is(updateCopyWidgetVisibleRangesEffect) ||
                    effect.is(refreshCopyWidgetDecorationsEffect)
            );

        if (!shouldRecompute) {
            return transaction.docChanged ? value.map(transaction.changes) : value;
        }

        const settings = transaction.state.field(copyWidgetSettingsField);
        const visibleRanges = transaction.state.field(copyWidgetVisibleRangesField);
        return buildCopyWidgetDecorations(transaction.state, visibleRanges, settings);
    },
    provide: (field) => EditorView.decorations.from(field),
});

const copyWidgetTheme = EditorView.baseTheme({
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

/**
 * Parse the opening fence at the current cursor position.
 * Supports both backtick (```) and tilde (~~~) style fences.
 * Returns fence details or undefined if not at a valid fence position.
 */
function parseOpeningFence(state: CompletionContext['state'], pos: number): OpeningFence | undefined {
    const line = state.doc.lineAt(pos);
    const lineText = line.text;
    const lineStartPos = line.from;

    // Match: optional indent + (3+ backticks OR 3+ tildes) + optional language
    // Backticks: language cannot contain backticks
    // Tildes: language cannot contain spaces (per CommonMark)
    const match = lineText.match(/^(\s*)(`{3,}|~{3,})([^\s`]*)/);
    if (!match) return undefined;

    const indent = match[1];
    const fence = match[2];
    const fenceChar = fence[0]; // '`' or '~'
    const typedLang = match[3];

    // Cursor must be after the fence markers (either at end of line or after language)
    const fenceStart = lineStartPos + indent.length;
    if (pos < fenceStart + fence.length) return undefined;

    // Calculate where the language name starts (right after the fence markers)
    const languageStartPos = fenceStart + fence.length;

    return {
        indent,
        fenceChar,
        fenceCount: fence.length,
        typedLang,
        languageStartPos,
    };
}

/**
 * Creates a completion apply function that replaces typed language and inserts closing fence.
 * Replaces from languageStartPos to current cursor position.
 */
function createApplyFunction(desiredLang: string, openingFence: OpeningFence) {
    return (view: EditorView, _completion: Completion, from: number) => {
        const lineBreak = view.state.lineBreak || '\n';
        const { indent, fenceChar, fenceCount } = openingFence;
        const fence = fenceChar.repeat(fenceCount);

        // Get current cursor position to determine range to replace
        const currentPos = view.state.selection.main.head;

        // Insert: full language + newlines + closing fence
        const insertText = `${desiredLang}${lineBreak}${indent}${lineBreak}${indent}${fence}`;

        // Position cursor on the empty line inside the block
        const cursorOffset = from + desiredLang.length + lineBreak.length + indent.length;

        view.dispatch(
            view.state.update({
                changes: { from, to: currentPos, insert: insertText },
                selection: { anchor: cursorOffset },
            })
        );
    };
}

function autoInsertClosingFence(view: EditorView, openingFence: OpeningFence, cursorPos: number): void {
    const lineBreak = view.state.lineBreak || '\n';
    const closingFence = openingFence.fenceChar.repeat(IMMEDIATE_FENCE_LENGTH);
    const insertText = `${lineBreak}${openingFence.indent}${closingFence}`;

    view.dispatch(
        view.state.update({
            changes: { from: cursorPos, to: cursorPos, insert: insertText },
            selection: { anchor: cursorPos },
        })
    );
}

async function getSettings(context: PluginContext): Promise<PluginSettingsResponse> {
    try {
        const response = (await context.postMessage({
            command: 'getSettings',
        })) as PluginSettingsResponse | null;

        if (
            response &&
            typeof response.enableLanguageAutocomplete === 'boolean' &&
            typeof response.enableCopyWidget === 'boolean' &&
            Array.isArray(response.languages)
        ) {
            return response;
        }
    } catch (error) {
        logger.error('Failed to fetch autocomplete settings:', error);
    }

    return DEFAULT_SETTINGS;
}

function buildCompletionOptions(languages: string[], openingFence: OpeningFence): Completion[] {
    const { typedLang } = openingFence;
    const typedLangLower = typedLang.toLowerCase();
    const matchedLanguages = languages
        .filter((lang) => lang.toLowerCase().startsWith(typedLangLower))
        .sort((a, b) => a.localeCompare(b));

    const options = matchedLanguages.map((lang) => ({
        label: lang,
        detail: '',
        apply: createApplyFunction(lang, openingFence),
    }));

    if (!typedLang) {
        options.unshift({
            label: 'No language',
            detail: '',
            apply: createApplyFunction('', openingFence),
        });
        return options;
    }

    const hasExactMatch = matchedLanguages.some((lang) => lang.toLowerCase() === typedLangLower);
    if (!hasExactMatch) {
        options.push({
            label: typedLang,
            detail: 'custom language',
            apply: createApplyFunction(typedLang, openingFence),
        });
    }

    return options;
}

function getFenceTriggerPosition(update: ViewUpdate): number | null {
    if (!update.docChanged) return null;
    if (!update.transactions.some((tr) => tr.isUserEvent('input.type'))) return null;

    const pos = update.state.selection.main.head;
    const typedFence =
        pos >= IMMEDIATE_FENCE_LENGTH ? update.state.doc.sliceString(pos - IMMEDIATE_FENCE_LENGTH, pos) : '';
    if (typedFence !== '```' && typedFence !== '~~~') return null;

    const line = update.state.doc.lineAt(pos);
    const textBeforeFence = line.text.slice(0, pos - line.from - IMMEDIATE_FENCE_LENGTH);
    return /^\s*$/.test(textBeforeFence) ? pos : null;
}

async function handleFenceTrigger(context: PluginContext, update: ViewUpdate): Promise<void> {
    const triggerPos = getFenceTriggerPosition(update);
    if (triggerPos === null) return;

    const openingFence = parseOpeningFence(update.state, triggerPos);
    if (!openingFence) return;

    const settings = await getSettings(context);

    // Skip if the document changed while we waited on the main-process settings response.
    if (update.view.state !== update.state) return;

    if (settings.enableLanguageAutocomplete) {
        setTimeout(() => {
            if (update.view.state === update.state) {
                startCompletion(update.view);
            }
        }, COMPLETION_TRIGGER_DELAY_MS);
        return;
    }

    autoInsertClosingFence(update.view, openingFence, triggerPos);
}

function cloneVisibleRanges(ranges: readonly VisibleRange[]): VisibleRange[] {
    return ranges.map((range) => ({
        from: range.from,
        to: range.to,
    }));
}

function areVisibleRangesEqual(a: readonly VisibleRange[], b: readonly VisibleRange[]): boolean {
    if (a.length !== b.length) return false;

    return a.every((range, index) => range.from === b[index].from && range.to === b[index].to);
}

function areSettingsEqual(a: PluginSettingsResponse, b: PluginSettingsResponse): boolean {
    return (
        a.enableLanguageAutocomplete === b.enableLanguageAutocomplete &&
        a.enableCopyWidget === b.enableCopyWidget &&
        a.languages.length === b.languages.length &&
        a.languages.every((language, index) => language === b.languages[index])
    );
}

function buildCopyWidgetDecorations(
    state: CompletionContext['state'],
    visibleRanges: readonly VisibleRange[],
    settings: PluginSettingsResponse
): DecorationSet {
    if (!settings.enableCopyWidget) {
        return Decoration.none;
    }

    const cursorLineNumber = state.doc.lineAt(state.selection.main.head).number;
    const rangesToInspect = visibleRanges.length > 0 ? visibleRanges : [{ from: 0, to: state.doc.length }];
    const decorationRanges: Range<Decoration>[] = [];
    const seenBlocks = new Set<string>();
    const tree = syntaxTree(state);

    for (const range of rangesToInspect) {
        tree.iterate({
            from: range.from,
            to: range.to,
            enter: (node) => {
                if (node.name !== 'FencedCode') {
                    return undefined;
                }

                const key = `${node.from}:${node.to}`;
                if (seenBlocks.has(key)) {
                    return false;
                }
                seenBlocks.add(key);

                const blockInfo = getFencedCodeBlockInfo(state, node.node);
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
                        widget: new CopyCodeBlockWidget(copyWidgetContext, blockInfo.language, blockInfo.copyText),
                        side: 1,
                    }).range(blockInfo.openingLineTo)
                );

                return false;
            },
        });
    }

    return Decoration.set(decorationRanges, true);
}

function getFencedCodeBlockInfo(
    state: CompletionContext['state'],
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
        private readonly context: PluginContext | null,
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

        if (this.language) {
            button.textContent = this.language;
        } else {
            button.append(createCopyIcon(view.dom.ownerDocument));
            button.append(view.dom.ownerDocument.createTextNode(COPY_ICON_LABEL));
        }

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
        if (!this.context) {
            logger.error('Failed to copy code block: widget context is unavailable.');
            return;
        }

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

class CopyWidgetViewPlugin {
    private destroyed = false;
    private lastSettings: PluginSettingsResponse = DEFAULT_SETTINGS;
    private lastVisibleRanges: VisibleRange[];
    private settingsRequestId = 0;

    public constructor(
        private readonly view: EditorView,
        private readonly context: PluginContext
    ) {
        this.lastVisibleRanges = cloneVisibleRanges(view.visibleRanges);

        queueMicrotask(() => {
            if (this.destroyed) {
                return;
            }

            this.dispatchVisibleRanges(this.lastVisibleRanges);

            if (this.refreshSyntaxTree()) {
                this.dispatchEffects([refreshCopyWidgetDecorationsEffect.of(null)]);
            }
        });

        void this.syncSettings();
    }

    public destroy(): void {
        this.destroyed = true;
    }

    public update(update: ViewUpdate): void {
        if (update.viewportChanged) {
            const visibleRanges = cloneVisibleRanges(update.view.visibleRanges);
            if (!areVisibleRangesEqual(visibleRanges, this.lastVisibleRanges)) {
                this.lastVisibleRanges = visibleRanges;
                this.dispatchVisibleRanges(visibleRanges);
            }
        }

        if (update.docChanged || update.viewportChanged) {
            const parsed = this.refreshSyntaxTree();
            if (parsed) {
                this.dispatchEffects([refreshCopyWidgetDecorationsEffect.of(null)]);
            }
        }

        if (update.docChanged || update.selectionSet || update.viewportChanged) {
            void this.syncSettings();
        }
    }

    private dispatchEffects(effects: readonly StateEffect<unknown>[]): void {
        if (this.destroyed || effects.length === 0) {
            return;
        }

        this.view.dispatch({
            effects,
        });
    }

    private dispatchVisibleRanges(visibleRanges: VisibleRange[]): void {
        this.dispatchEffects([updateCopyWidgetVisibleRangesEffect.of(visibleRanges)]);
    }

    private refreshSyntaxTree(): boolean {
        const maxVisibleTo = this.lastVisibleRanges.reduce((max, range) => Math.max(max, range.to), 0);
        if (!this.view.inView || maxVisibleTo === 0 || syntaxTreeAvailable(this.view.state, maxVisibleTo)) {
            return false;
        }

        return forceParsing(this.view, maxVisibleTo, SYNTAX_TREE_PARSE_TIMEOUT_MS);
    }

    private async syncSettings(): Promise<void> {
        const requestId = ++this.settingsRequestId;
        const settings = await getSettings(this.context);

        if (this.destroyed || requestId !== this.settingsRequestId || areSettingsEqual(settings, this.lastSettings)) {
            return;
        }

        this.lastSettings = settings;
        this.dispatchEffects([
            updateCopyWidgetSettingsEffect.of(settings),
            refreshCopyWidgetDecorationsEffect.of(null),
        ]);
    }
}

/** Registers CodeMirror extensions for code block autocompletion */
export default function codeMirror6Plugin(context: PluginContext, CodeMirror: JoplinCodeMirror): void {
    copyWidgetContext = context;

    /**
     * Autocomplete source for code blocks.
     * Parses current line, inserts only remaining text.
     * Supports nested code blocks with matching fence lengths and custom languages.
     */
    const codeBlockCompleter = async (completionContext: CompletionContext): Promise<CompletionResult | null> => {
        const { state, pos } = completionContext;
        const settings = await getSettings(context);

        if (!settings.enableLanguageAutocomplete) return null;

        const openingFence = parseOpeningFence(state, pos);
        if (!openingFence) return null;

        return {
            from: openingFence.languageStartPos,
            options: buildCompletionOptions(settings.languages, openingFence),
            filter: false, // Disable automatic filtering/sorting to preserve our order
        };
    };

    const triggerCompletionOnFence = EditorView.updateListener.of((update: ViewUpdate) => {
        void handleFenceTrigger(context, update);
    });

    const copyWidgetPlugin = ViewPlugin.define((view) => new CopyWidgetViewPlugin(view, context));

    let completionExt: Extension;
    if (CodeMirror.joplinExtensions) {
        completionExt = CodeMirror.joplinExtensions.completionSource(codeBlockCompleter);
    } else {
        completionExt = autocompletion({ override: [codeBlockCompleter] });
    }

    CodeMirror.addExtension([
        completionExt,
        triggerCompletionOnFence,
        copyWidgetSettingsField,
        copyWidgetVisibleRangesField,
        copyWidgetDecorationsField,
        copyWidgetTheme,
        copyWidgetPlugin.extension,
    ]);
}

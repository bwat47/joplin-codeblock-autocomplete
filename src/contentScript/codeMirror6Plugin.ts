/**
 * CodeMirror 6 plugin for code block language autocompletion.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Compartment, Facet, type Extension, type Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, type ViewUpdate, ViewPlugin, WidgetType } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { CodeMirrorControl } from 'api/types';
import { logger } from '../logger';
import type { PluginContext, PluginSettingsResponse } from './types';
import { UPDATE_SETTINGS_COMMAND } from './types';

type OpeningFence = {
    indent: string;
    fenceChar: string;
    fenceCount: number;
    typedLang: string;
    languageStartPos: number;
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
const SYNTAX_TREE_PARSE_TIMEOUT_MS = 100;
const COPY_WIDGET_TITLE = 'Copy code block';
const COPY_ICON_LABEL = 'Copy';

const pluginSettingsFacet = Facet.define<PluginSettingsResponse, PluginSettingsResponse>({
    combine: (values) => values[0] ?? DEFAULT_SETTINGS,
});

const pluginSettingsCompartment = new Compartment();

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

function getPluginSettings(state: CompletionContext['state']): PluginSettingsResponse {
    return state.facet(pluginSettingsFacet);
}

function normalizeSettings(value: unknown): PluginSettingsResponse {
    if (
        value &&
        typeof value === 'object' &&
        typeof (value as PluginSettingsResponse).enableLanguageAutocomplete === 'boolean' &&
        typeof (value as PluginSettingsResponse).enableCopyWidget === 'boolean' &&
        Array.isArray((value as PluginSettingsResponse).languages)
    ) {
        return {
            enableLanguageAutocomplete: (value as PluginSettingsResponse).enableLanguageAutocomplete,
            enableCopyWidget: (value as PluginSettingsResponse).enableCopyWidget,
            languages: (value as PluginSettingsResponse).languages
                .filter((language): language is string => typeof language === 'string')
                .map((language) => language.trim())
                .filter((language) => language.length > 0),
        };
    }

    return DEFAULT_SETTINGS;
}

function areSettingsEqual(a: PluginSettingsResponse, b: PluginSettingsResponse): boolean {
    return (
        a.enableLanguageAutocomplete === b.enableLanguageAutocomplete &&
        a.enableCopyWidget === b.enableCopyWidget &&
        a.languages.length === b.languages.length &&
        a.languages.every((language, index) => language === b.languages[index])
    );
}

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
    const fenceChar = fence[0];
    const typedLang = match[3];

    const fenceStart = lineStartPos + indent.length;
    if (pos < fenceStart + fence.length) return undefined;

    return {
        indent,
        fenceChar,
        fenceCount: fence.length,
        typedLang,
        languageStartPos: fenceStart + fence.length,
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
        const currentPos = view.state.selection.main.head;
        const insertText = `${desiredLang}${lineBreak}${indent}${lineBreak}${indent}${fence}`;
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

function handleFenceTrigger(update: ViewUpdate): void {
    const triggerPos = getFenceTriggerPosition(update);
    if (triggerPos === null) return;

    const settings = getPluginSettings(update.state);
    if (!settings.enableLanguageAutocomplete) {
        const openingFence = parseOpeningFence(update.state, triggerPos);
        if (openingFence) {
            autoInsertClosingFence(update.view, openingFence, triggerPos);
        }
        return;
    }

    setTimeout(() => {
        if (update.view.state === update.state) {
            startCompletion(update.view);
        }
    }, COMPLETION_TRIGGER_DELAY_MS);
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

async function syncInitialSettings(context: PluginContext, codeMirror: CodeMirrorControl): Promise<void> {
    try {
        const settings = normalizeSettings(
            await context.postMessage({
                command: 'getSettings',
            })
        );

        (codeMirror.editor as EditorView).dispatch({
            effects: pluginSettingsCompartment.reconfigure(pluginSettingsFacet.of(settings)),
        });
    } catch (error) {
        logger.error('Failed to fetch autocomplete settings:', error);
    }
}

/** Registers CodeMirror extensions for code block autocompletion */
export default function codeMirror6Plugin(context: PluginContext, CodeMirror: CodeMirrorControl): void {
    /**
     * Autocomplete source for code blocks.
     * Parses current line, inserts only remaining text.
     * Supports nested code blocks with matching fence lengths and custom languages.
     */
    const codeBlockCompleter = (completionContext: CompletionContext): CompletionResult | null => {
        const { state, pos } = completionContext;
        const settings = getPluginSettings(state);

        if (!settings.enableLanguageAutocomplete) return null;

        const openingFence = parseOpeningFence(state, pos);
        if (!openingFence) return null;

        return {
            from: openingFence.languageStartPos,
            options: buildCompletionOptions(settings.languages, openingFence),
            filter: false,
        };
    };

    const triggerCompletionOnFence = EditorView.updateListener.of((update: ViewUpdate) => {
        handleFenceTrigger(update);
    });

    const copyWidgetPlugin = ViewPlugin.fromClass(
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

    const settingsExtension = pluginSettingsCompartment.of(pluginSettingsFacet.of(DEFAULT_SETTINGS));

    CodeMirror.registerCommand(UPDATE_SETTINGS_COMMAND, (settings: unknown) => {
        (CodeMirror.editor as EditorView).dispatch({
            effects: pluginSettingsCompartment.reconfigure(pluginSettingsFacet.of(normalizeSettings(settings))),
        });
    });

    let completionExt: Extension;
    if (CodeMirror.joplinExtensions) {
        completionExt = CodeMirror.joplinExtensions.completionSource(codeBlockCompleter);
    } else {
        completionExt = autocompletion({ override: [codeBlockCompleter] });
    }

    CodeMirror.addExtension([
        settingsExtension,
        completionExt,
        triggerCompletionOnFence,
        copyWidgetTheme,
        copyWidgetPlugin,
    ]);

    void syncInitialSettings(context, CodeMirror);
}

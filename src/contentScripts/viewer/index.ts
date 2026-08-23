/**
 * Markdown viewer integration for fenced-code copy buttons.
 *
 * The existing fence renderer remains responsible for all code rendering and
 * Rich Text metadata. This plugin only inserts a button into the outer
 * `joplin-editable` container produced for fenced blocks.
 */
import type { MarkdownItContentScriptModule } from 'api/types';

type MarkdownItToken = {
    tag?: string;
};

type MarkdownItRenderer = {
    renderToken(
        tokens: MarkdownItToken[],
        index: number,
        options: unknown,
        environment?: unknown,
        renderer?: MarkdownItRenderer
    ): string;
};

type MarkdownItRendererRule = (
    tokens: MarkdownItToken[],
    index: number,
    options: unknown,
    environment: unknown,
    renderer: MarkdownItRenderer
) => string;

type MarkdownItLike = {
    renderer: {
        rules: {
            fence?: MarkdownItRendererRule;
        };
    };
};

type InstalledRendererRule = MarkdownItRendererRule & {
    codeblockAutocompleteViewerCopy?: boolean;
};

const COPY_BUTTON_CLASS = 'codeblock-autocomplete-viewer-copy-button';
const EDITABLE_CLASS_PATTERN = /class=(['"])[^'"]*\bjoplin-editable\b[^'"]*\1/;
const OUTER_CONTAINER_CLOSE = '</div>';

const COPY_BUTTON_HTML = `<button type="button" class="${COPY_BUTTON_CLASS}" title="Copy code block" aria-label="Copy code block">
<svg viewBox="0 0 16 16" aria-hidden="true">
<path d="M5 1.75A1.75 1.75 0 0 0 3.25 3.5v7A1.75 1.75 0 0 0 5 12.25h.75v-1.5H5a.25.25 0 0 1-.25-.25v-7A.25.25 0 0 1 5 3.25h4.5a.25.25 0 0 1 .25.25V4h1.5v-.5A1.75 1.75 0 0 0 9.5 1.75H5Z"></path>
<path d="M8 5.75A1.75 1.75 0 0 0 6.25 7.5v5A1.75 1.75 0 0 0 8 14.25h4A1.75 1.75 0 0 0 13.75 12.5v-5A1.75 1.75 0 0 0 12 5.75H8Zm0 1.5h4a.25.25 0 0 1 .25.25v5a.25.25 0 0 1-.25.25H8a.25.25 0 0 1-.25-.25v-5A.25.25 0 0 1 8 7.25Z"></path>
</svg>
</button>`;

function injectCopyButton(renderedHtml: string): string {
    if (!EDITABLE_CLASS_PATTERN.test(renderedHtml)) {
        return renderedHtml;
    }

    const closingTagIndex = renderedHtml.lastIndexOf(OUTER_CONTAINER_CLOSE);
    if (closingTagIndex < 0) {
        return renderedHtml;
    }

    return `${renderedHtml.slice(0, closingTagIndex)}${COPY_BUTTON_HTML}${renderedHtml.slice(closingTagIndex)}`;
}

export function installViewerCopyButtonRenderer(markdownIt: MarkdownItLike): void {
    const currentRenderer = markdownIt.renderer.rules.fence as InstalledRendererRule | undefined;
    if (currentRenderer?.codeblockAutocompleteViewerCopy) {
        return;
    }

    const defaultRenderer: MarkdownItRendererRule =
        currentRenderer ??
        ((tokens, index, options, environment, renderer) =>
            renderer.renderToken(tokens, index, options, environment, renderer));

    const viewerCopyRenderer: InstalledRendererRule = (tokens, index, options, environment, renderer) => {
        const renderedHtml = defaultRenderer(tokens, index, options, environment, renderer);
        if (tokens[index]?.tag !== 'code') {
            return renderedHtml;
        }

        return injectCopyButton(renderedHtml);
    };
    viewerCopyRenderer.codeblockAutocompleteViewerCopy = true;

    markdownIt.renderer.rules.fence = viewerCopyRenderer;
}

export default function (): MarkdownItContentScriptModule {
    return {
        plugin: (markdownIt: MarkdownItLike) => {
            installViewerCopyButtonRenderer(markdownIt);
        },
        assets: () => [{ name: 'copyWidget.css' }, { name: 'copyWidget.js' }],
    };
}

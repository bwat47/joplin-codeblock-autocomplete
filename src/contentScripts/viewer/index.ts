/**
 * Markdown viewer integration for fenced-code copy buttons.
 *
 * The existing fence renderer remains responsible for all code rendering and
 * Rich Text metadata. This plugin only inserts a button into the outer
 * `joplin-editable` container produced for fenced blocks that actually render
 * code, leaving Joplin's other `fence` overrides (mermaid, ABC, Fountain)
 * untouched.
 */
import type { MarkdownItContentScriptModule } from 'api/types';
import { SETTING_KEYS } from '../../settingsKeys';

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

type MarkdownItPluginOptions = {
    settingValue(key: string): unknown;
};

type IsViewerCopyWidgetEnabled = () => boolean;

const COPY_BUTTON_CLASS = 'codeblock-autocomplete-viewer-copy-button';
/**
 * Added to the container that receives a button. The stylesheet needs to scope
 * `position` and the reserved `padding-right` to those containers only, since
 * Joplin reuses `joplin-editable` for diagrams and maths; marking the container
 * here means the stylesheet does not have to rediscover that with `:has()`,
 * which is the newest thing the viewer would otherwise depend on.
 */
const COPY_CONTAINER_CLASS = 'codeblock-autocomplete-viewer-copy-container';
const EDITABLE_CLASS_PATTERN = /class=(['"])[^'"]*\bjoplin-editable\b[^'"]*\1/;
/**
 * Joplin's own `fence` overrides (mermaid, ABC, Fountain) also emit a
 * `joplin-editable` container, so the container alone does not identify a code
 * block. Only Joplin's code renderer wraps its output in `<code>`, and none of
 * the diagram renderers do, so require a rendered `<code>` element as well.
 * Matches `<code>` and `<code class="...">` but not `<codesomething>`.
 */
const RENDERED_CODE_PATTERN = /<code[\s/>]/;
const OUTER_CONTAINER_CLOSE = '</div>';

const COPY_BUTTON_HTML = `<button type="button" class="${COPY_BUTTON_CLASS}" title="Copy code block" aria-label="Copy code block">
<svg viewBox="0 0 16 16" aria-hidden="true">
<path d="M5 1.75A1.75 1.75 0 0 0 3.25 3.5v7A1.75 1.75 0 0 0 5 12.25h.75v-1.5H5a.25.25 0 0 1-.25-.25v-7A.25.25 0 0 1 5 3.25h4.5a.25.25 0 0 1 .25.25V4h1.5v-.5A1.75 1.75 0 0 0 9.5 1.75H5Z"></path>
<path d="M8 5.75A1.75 1.75 0 0 0 6.25 7.5v5A1.75 1.75 0 0 0 8 14.25h4A1.75 1.75 0 0 0 13.75 12.5v-5A1.75 1.75 0 0 0 12 5.75H8Zm0 1.5h4a.25.25 0 0 1 .25.25v5a.25.25 0 0 1-.25.25H8a.25.25 0 0 1-.25-.25v-5A.25.25 0 0 1 8 7.25Z"></path>
</svg>
</button>`;

function injectCopyButton(renderedHtml: string): string {
    if (!EDITABLE_CLASS_PATTERN.test(renderedHtml) || !RENDERED_CODE_PATTERN.test(renderedHtml)) {
        return renderedHtml;
    }

    const closingTagIndex = renderedHtml.lastIndexOf(OUTER_CONTAINER_CLOSE);
    if (closingTagIndex < 0) {
        return renderedHtml;
    }

    const withButton = `${renderedHtml.slice(0, closingTagIndex)}${COPY_BUTTON_HTML}${renderedHtml.slice(closingTagIndex)}`;

    // Append to the existing class list rather than rewriting it, so Joplin's
    // own classes on the container survive. The pattern is not global, so only
    // the outer container is marked.
    return withButton.replace(
        EDITABLE_CLASS_PATTERN,
        (attribute) => `${attribute.slice(0, -1)} ${COPY_CONTAINER_CLASS}${attribute.slice(-1)}`
    );
}

export function installViewerCopyButtonRenderer(
    markdownIt: MarkdownItLike,
    isCopyWidgetEnabled: IsViewerCopyWidgetEnabled
): void {
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
        if (tokens[index]?.tag !== 'code' || !isCopyWidgetEnabled()) {
            return renderedHtml;
        }

        return injectCopyButton(renderedHtml);
    };
    viewerCopyRenderer.codeblockAutocompleteViewerCopy = true;

    markdownIt.renderer.rules.fence = viewerCopyRenderer;
}

export default function (): MarkdownItContentScriptModule {
    return {
        plugin: (markdownIt: MarkdownItLike, pluginOptions: MarkdownItPluginOptions) => {
            installViewerCopyButtonRenderer(
                markdownIt,
                () => pluginOptions.settingValue(SETTING_KEYS.enableViewerCopyWidget) === true
            );
        },
        assets: () => [{ name: 'copyWidget.css' }, { name: 'copyWidget.js' }],
    };
}

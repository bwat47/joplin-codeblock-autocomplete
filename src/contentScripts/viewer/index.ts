/**
 * Markdown viewer integration for fenced-code headers (copy button and title) and line numbers.
 *
 * The existing fence renderer remains responsible for all code rendering and
 * Rich Text metadata. This plugin adds optional decorations to the outer
 * `joplin-editable` container produced for fenced blocks that actually render
 * code, leaving Joplin's other `fence` overrides (mermaid, ABC, Fountain)
 * untouched.
 */
import type { MarkdownItContentScriptModule } from 'api/types';
import { SETTING_KEYS } from '../../settingsKeys';
import { parseFenceInfo, resolveLineNumbering } from '../fenceInfo';
import { addContainerClass, isRenderedCodeContainer, prependToContainer } from './codeContainer';
import { escapeHtml } from './escapeHtml';
import { preserveFenceInfo } from './fenceSource';
import { markLineNumberContainer } from './viewerLineNumbers';

type MarkdownItToken = {
    info?: string;
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
    codeblockAutocompleteViewerFeatures?: boolean;
};

type MarkdownItPluginOptions = {
    settingValue(key: string): unknown;
};

type IsViewerFeatureEnabled = () => boolean;

const COPY_BUTTON_CLASS = 'codeblock-autocomplete-viewer-copy-button';
const TITLE_CLASS = 'codeblock-autocomplete-viewer-title';
/**
 * Added to the container that receives a button. The stylesheet needs to scope
 * `position` and the reserved `padding-right` to those containers only, since
 * Joplin reuses `joplin-editable` for diagrams and maths; marking the container
 * here means the stylesheet does not have to rediscover that with `:has()`,
 * which is the newest thing the viewer would otherwise depend on.
 */
const COPY_CONTAINER_CLASS = 'codeblock-autocomplete-viewer-copy-container';
const OUTER_CONTAINER_CLOSE = '</div>';

const COPY_BUTTON_HTML = `<button type="button" class="${COPY_BUTTON_CLASS}" title="Copy code block" aria-label="Copy code block">
<svg viewBox="0 0 16 16" aria-hidden="true">
<path d="M5 1.75A1.75 1.75 0 0 0 3.25 3.5v7A1.75 1.75 0 0 0 5 12.25h.75v-1.5H5a.25.25 0 0 1-.25-.25v-7A.25.25 0 0 1 5 3.25h4.5a.25.25 0 0 1 .25.25V4h1.5v-.5A1.75 1.75 0 0 0 9.5 1.75H5Z"></path>
<path d="M8 5.75A1.75 1.75 0 0 0 6.25 7.5v5A1.75 1.75 0 0 0 8 14.25h4A1.75 1.75 0 0 0 13.75 12.5v-5A1.75 1.75 0 0 0 12 5.75H8Zm0 1.5h4a.25.25 0 0 1 .25.25v5a.25.25 0 0 1-.25.25H8a.25.25 0 0 1-.25-.25v-5A.25.25 0 0 1 8 7.25Z"></path>
</svg>
</button>`;

/**
 * Adds the header: the copy button, and the block's title when its info string sets one. The title
 * comes first in the container so it sits above the code, sharing its row with the button.
 */
function injectHeader(renderedHtml: string, title: string | null): string {
    if (!isRenderedCodeContainer(renderedHtml)) {
        return renderedHtml;
    }

    const closingTagIndex = renderedHtml.lastIndexOf(OUTER_CONTAINER_CLOSE);
    if (closingTagIndex < 0) {
        return renderedHtml;
    }

    const withButton = `${renderedHtml.slice(0, closingTagIndex)}${COPY_BUTTON_HTML}${renderedHtml.slice(closingTagIndex)}`;
    const withTitle =
        title === null
            ? withButton
            : prependToContainer(withButton, `<div class="${TITLE_CLASS}">${escapeHtml(title)}</div>`);

    return addContainerClass(withTitle, COPY_CONTAINER_CLASS);
}

export function installViewerCodeBlockRenderer(
    markdownIt: MarkdownItLike,
    isCopyWidgetEnabled: IsViewerFeatureEnabled,
    isLineNumbersEnabled: IsViewerFeatureEnabled
): void {
    const currentRenderer: InstalledRendererRule | undefined = markdownIt.renderer.rules.fence;
    if (currentRenderer?.codeblockAutocompleteViewerFeatures) {
        return;
    }

    const defaultRenderer: MarkdownItRendererRule =
        currentRenderer ??
        ((tokens, index, options, environment, renderer) =>
            renderer.renderToken(tokens, index, options, environment, renderer));

    const viewerRenderer: InstalledRendererRule = (tokens, index, options, environment, renderer) => {
        const renderedHtml = defaultRenderer(tokens, index, options, environment, renderer);
        const token = tokens[index];
        if (token?.tag !== 'code') {
            return renderedHtml;
        }

        // Runs regardless of the viewer settings, so turning them off does not make Rich Text
        // edits drop the options.
        const info = token.info ?? '';
        const fenceInfo = parseFenceInfo(info);
        const withSource = preserveFenceInfo(renderedHtml, info);
        const numbering = resolveLineNumbering(fenceInfo, isLineNumbersEnabled());
        const withNumbers = numbering.enabled ? markLineNumberContainer(withSource, numbering.start) : withSource;
        return isCopyWidgetEnabled() ? injectHeader(withNumbers, fenceInfo.title) : withNumbers;
    };
    viewerRenderer.codeblockAutocompleteViewerFeatures = true;

    markdownIt.renderer.rules.fence = viewerRenderer;
}

export default function (): MarkdownItContentScriptModule {
    return {
        plugin: (markdownIt: MarkdownItLike, pluginOptions: MarkdownItPluginOptions) => {
            installViewerCodeBlockRenderer(
                markdownIt,
                () => pluginOptions.settingValue(SETTING_KEYS.enableViewerCopyWidget) === true,
                () => pluginOptions.settingValue(SETTING_KEYS.enableViewerLineNumbers) === true
            );
        },
        assets: () => [
            { name: 'copyWidget.css' },
            { name: 'copyWidget.js' },
            { name: 'lineNumbers.css' },
            { name: 'lineNumbers.js' },
        ],
    };
}

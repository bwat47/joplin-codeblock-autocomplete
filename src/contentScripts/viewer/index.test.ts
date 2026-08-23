import { installViewerCopyButtonRenderer } from './index';

type MarkdownItLike = Parameters<typeof installViewerCopyButtonRenderer>[0];
type RendererRule = NonNullable<MarkdownItLike['renderer']['rules']['fence']>;

const JOPLIN_FENCE_HTML =
    '<div class="joplin-editable"><pre class="joplin-source" data-joplin-language="ts">const value = 1;\n</pre>' +
    '<pre class="hljs"><code><span>const value = 1;</span>\n</code></pre></div>\n';

function createMarkdownIt(renderedHtml: string): {
    markdownIt: MarkdownItLike;
    defaultFenceRenderer: ReturnType<typeof vi.fn<RendererRule>>;
} {
    const defaultFenceRenderer = vi.fn<RendererRule>(() => renderedHtml);
    const markdownIt: MarkdownItLike = {
        renderer: {
            rules: {
                fence: defaultFenceRenderer,
            },
        },
    };

    return { markdownIt, defaultFenceRenderer };
}

function renderFence(markdownIt: MarkdownItLike, token: Record<string, unknown> = {}): string {
    const renderer = {
        renderToken: vi.fn(() => ''),
    };
    const fenceRenderer = markdownIt.renderer.rules.fence;
    if (!fenceRenderer) {
        throw new Error('Expected a fence renderer to be installed.');
    }

    return fenceRenderer([{ tag: 'code', ...token }], 0, {}, {}, renderer);
}

describe('installViewerCopyButtonRenderer', () => {
    it.each([
        ['backtick fence', { markup: '```', info: 'typescript' }],
        ['tilde fence', { markup: '~~~', info: '' }],
        ['quoted fence', { markup: '```', level: 1 }],
        ['outer fence containing a shorter fence', { markup: '````', info: 'markdown' }],
    ])('adds one accessible copy button to a %s', (_name, token) => {
        const { markdownIt } = createMarkdownIt(JOPLIN_FENCE_HTML);
        installViewerCopyButtonRenderer(markdownIt);

        const renderedHtml = renderFence(markdownIt, token);
        const document = new DOMParser().parseFromString(renderedHtml, 'text/html');
        const button = document.querySelector('.codeblock-autocomplete-viewer-copy-button');

        expect(document.querySelectorAll('.codeblock-autocomplete-viewer-copy-button')).toHaveLength(1);
        expect(button?.getAttribute('type')).toBe('button');
        expect(button?.getAttribute('title')).toBe('Copy code block');
        expect(button?.getAttribute('aria-label')).toBe('Copy code block');
        expect(button?.closest('.joplin-editable')).not.toBeNull();
    });

    it('preserves the existing rendered HTML and Rich Text source metadata', () => {
        const { markdownIt, defaultFenceRenderer } = createMarkdownIt(JOPLIN_FENCE_HTML);
        installViewerCopyButtonRenderer(markdownIt);

        const renderedHtml = renderFence(markdownIt);

        expect(defaultFenceRenderer).toHaveBeenCalledOnce();
        expect(renderedHtml).toContain('<pre class="joplin-source" data-joplin-language="ts">const value = 1;\n</pre>');
        expect(renderedHtml).toContain('<pre class="hljs"><code><span>const value = 1;</span>\n</code></pre>');
    });

    it('does not modify non-code fence output or renderer rules for other code forms', () => {
        const { markdownIt } = createMarkdownIt(JOPLIN_FENCE_HTML);
        const rules = markdownIt.renderer.rules as MarkdownItLike['renderer']['rules'] & {
            code_block: RendererRule;
            code_inline: RendererRule;
            html_block: RendererRule;
        };
        const codeBlockRenderer = vi.fn<RendererRule>(() => '<pre><code>indented</code></pre>');
        const codeInlineRenderer = vi.fn<RendererRule>(() => '<code>inline</code>');
        const htmlBlockRenderer = vi.fn<RendererRule>(() => '<pre><code>raw HTML</code></pre>');
        rules.code_block = codeBlockRenderer;
        rules.code_inline = codeInlineRenderer;
        rules.html_block = htmlBlockRenderer;

        installViewerCopyButtonRenderer(markdownIt);

        const renderer = { renderToken: vi.fn(() => '') };
        const fenceRenderer = markdownIt.renderer.rules.fence;
        expect(fenceRenderer?.([{ tag: 'div' }], 0, {}, {}, renderer)).toBe(JOPLIN_FENCE_HTML);
        expect(rules.code_block).toBe(codeBlockRenderer);
        expect(rules.code_inline).toBe(codeInlineRenderer);
        expect(rules.html_block).toBe(htmlBlockRenderer);
    });

    it('returns the original fence HTML when the expected editable container is unavailable', () => {
        const unsupportedHtml = '<pre><code>plain renderer output</code></pre>\n';
        const { markdownIt } = createMarkdownIt(unsupportedHtml);
        installViewerCopyButtonRenderer(markdownIt);

        expect(renderFence(markdownIt)).toBe(unsupportedHtml);
    });

    it('does not stack renderer wrappers when installed more than once', () => {
        const { markdownIt, defaultFenceRenderer } = createMarkdownIt(JOPLIN_FENCE_HTML);

        installViewerCopyButtonRenderer(markdownIt);
        installViewerCopyButtonRenderer(markdownIt);

        const renderedHtml = renderFence(markdownIt);
        expect(defaultFenceRenderer).toHaveBeenCalledOnce();
        expect(renderedHtml.match(/codeblock-autocomplete-viewer-copy-button/g)).toHaveLength(1);
    });
});

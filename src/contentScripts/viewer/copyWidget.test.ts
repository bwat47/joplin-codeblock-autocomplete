type WebviewMessage = {
    command: string;
    text?: string;
};

type ViewerController = {
    destroy(): void;
};

type ViewerWindow = Window &
    typeof globalThis & {
        __codeblockAutocompleteViewerCopyController?: ViewerController;
    };

const BUTTON_HTML =
    '<button type="button" class="codeblock-autocomplete-viewer-copy-button" title="Copy code block" aria-label="Copy code block">' +
    '<svg><path></path></svg></button>';

/**
 * Mirrors the container Joplin's `MdToHtml` `highlight()` callback emits for a
 * fenced code block: a `hidden` `pre.joplin-source` carrying the Rich Text
 * round-trip metadata, followed by the highlighted `pre.hljs > code`.
 *
 * `sourceText` is the already-escaped text Joplin puts inside `pre.joplin-source`.
 * Joplin applies `removeLastNewLine()` before writing it, so it holds the fence
 * contents minus the single newline that belongs to the closing fence.
 */
function setViewerHtml(sourceText: string, renderedCode = sourceText, language = 'ts'): HTMLButtonElement {
    document.body.innerHTML =
        '<div class="joplin-editable">' +
        `<pre class="joplin-source" hidden data-joplin-language="${language}" ` +
        `data-joplin-source-open="\`\`\`${language}&#10;" data-joplin-source-close="&#10;\`\`\`">${sourceText}</pre>` +
        `<pre class="hljs"><code>${renderedCode}</code></pre>` +
        BUTTON_HTML +
        '</div>';

    const button = document.querySelector('.codeblock-autocomplete-viewer-copy-button');
    if (!(button instanceof HTMLButtonElement)) {
        throw new Error('Expected the viewer copy button to exist.');
    }
    return button;
}

async function loadViewerAsset(): Promise<ViewerController> {
    vi.resetModules();
    // @ts-expect-error The viewer asset is intentionally a classic browser script, not a module.
    await import('./copyWidget.js');

    if (document.readyState === 'loading') {
        document.dispatchEvent(new Event('DOMContentLoaded'));
    }
    await Promise.resolve();

    const controller = (window as ViewerWindow).__codeblockAutocompleteViewerCopyController;
    if (!controller) {
        throw new Error('Expected the viewer copy controller to start.');
    }
    return controller;
}

describe('viewer copy widget asset', () => {
    let postMessage: ReturnType<typeof vi.fn<(contentScriptId: string, message: WebviewMessage) => Promise<unknown>>>;
    let controller: ViewerController | undefined;

    beforeEach(() => {
        document.body.innerHTML = '';

        postMessage = vi.fn(async () => ({ ok: true }));
        Object.assign(globalThis, { webviewApi: { postMessage } });
    });

    afterEach(() => {
        controller?.destroy();
        controller = undefined;
        delete (globalThis as { webviewApi?: unknown }).webviewApi;
    });

    it('does not request settings or react to note updates', async () => {
        setViewerHtml('code');
        controller = await loadViewerAsset();

        expect(postMessage).not.toHaveBeenCalled();

        document.dispatchEvent(new Event('joplin-noteDidUpdate'));
        await Promise.resolve();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('copies the unescaped source text verbatim', async () => {
        // Joplin has already removed the newline belonging to the closing fence,
        // so an ordinary block reaches us without a trailing line ending.
        const button = setViewerHtml('first &amp; second', '<span>highlighted output</span>');
        controller = await loadViewerAsset();
        postMessage.mockClear();

        button.click();
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', {
            command: 'copyCodeBlock',
            text: 'first & second',
        });
    });

    it('preserves a trailing blank line the author wrote inside the block', async () => {
        // Source ending in a blank line reaches `pre.joplin-source` as
        // 'code\n\n' minus Joplin's one stripped newline, so the remaining '\n'
        // is the author's blank line and must survive the copy.
        const button = setViewerHtml('code\n', '<span>highlighted output</span>');
        controller = await loadViewerAsset();
        postMessage.mockClear();

        button.click();
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', {
            command: 'copyCodeBlock',
            text: 'code\n',
        });
    });

    it('falls back to highlighted rendered code when source metadata is missing', async () => {
        document.body.innerHTML =
            '<div class="joplin-editable"><pre class="hljs"><code>const <span>value</span> = &quot;x&quot;;</code></pre>' +
            BUTTON_HTML +
            '</div>';
        const button = document.querySelector('.codeblock-autocomplete-viewer-copy-button');
        if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a copy button.');
        controller = await loadViewerAsset();
        postMessage.mockClear();

        button.click();
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', {
            command: 'copyCodeBlock',
            text: 'const value = "x";',
        });
    });

    it('keeps delegated clicks working after the rendered note is replaced', async () => {
        setViewerHtml('first');
        controller = await loadViewerAsset();
        postMessage.mockClear();

        const replacementButton = setViewerHtml('replacement');
        replacementButton.click();
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', {
            command: 'copyCodeBlock',
            text: 'replacement',
        });
    });

    it('does not copy when no code source can be found', async () => {
        controller = await loadViewerAsset();

        document.body.innerHTML = `<div class="joplin-editable">${BUTTON_HTML}</div>`;
        const sourceLessButton = document.querySelector('.codeblock-autocomplete-viewer-copy-button');
        if (!(sourceLessButton instanceof HTMLButtonElement)) throw new Error('Expected a copy button.');
        sourceLessButton.click();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('fails safely when copy requests reject', async () => {
        const button = setViewerHtml('code');
        controller = await loadViewerAsset();
        postMessage.mockRejectedValueOnce(new Error('clipboard unavailable'));

        expect(() => button.click()).not.toThrow();
        await Promise.resolve();
    });
});

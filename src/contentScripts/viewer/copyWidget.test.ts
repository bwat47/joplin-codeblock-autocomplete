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

function setViewerHtml(sourceText: string, renderedCode = sourceText): HTMLButtonElement {
    document.body.innerHTML =
        '<div class="joplin-editable">' +
        `<pre class="joplin-source">${sourceText}</pre>` +
        `<pre><code>${renderedCode}</code></pre>` +
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

    it('copies source text exactly, including an intentional trailing line ending', async () => {
        const button = setViewerHtml('first &amp; second\n', '<span>highlighted output</span>');
        controller = await loadViewerAsset();
        postMessage.mockClear();

        button.click();
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', {
            command: 'copyCodeBlock',
            text: 'first & second\n',
        });
    });

    it('falls back to highlighted rendered code when source metadata is missing', async () => {
        document.body.innerHTML =
            '<div class="joplin-editable"><pre><code>const <span>value</span> = &quot;x&quot;;</code></pre>' +
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

type WebviewMessage = {
    command: string;
    text?: string;
};

type ViewerController = {
    destroy(): void;
    refreshSettings(): Promise<void>;
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
        vi.useFakeTimers();
        document.documentElement.classList.remove('codeblock-autocomplete-viewer-copy-enabled');
        document.body.innerHTML = '';

        postMessage = vi.fn(async (_contentScriptId, message) => {
            if (message.command === 'getSettings') {
                return { enableViewerCopyWidget: true };
            }
            return { ok: true };
        });
        Object.assign(globalThis, { webviewApi: { postMessage } });
    });

    afterEach(() => {
        controller?.destroy();
        controller = undefined;
        delete (globalThis as { webviewApi?: unknown }).webviewApi;
        vi.useRealTimers();
    });

    it('enables and disables the widget from live settings', async () => {
        setViewerHtml('code\n');
        controller = await loadViewerAsset();

        expect(document.documentElement.classList.contains('codeblock-autocomplete-viewer-copy-enabled')).toBe(true);

        postMessage.mockResolvedValueOnce({ enableViewerCopyWidget: false });
        await controller.refreshSettings();

        expect(document.documentElement.classList.contains('codeblock-autocomplete-viewer-copy-enabled')).toBe(false);
    });

    it('refreshes settings after a note update and on the polling interval', async () => {
        setViewerHtml('code\n');
        controller = await loadViewerAsset();
        postMessage.mockClear();

        document.dispatchEvent(new Event('joplin-noteDidUpdate'));
        await Promise.resolve();
        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', { command: 'getSettings' });

        postMessage.mockClear();
        await vi.advanceTimersByTimeAsync(2000);
        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', { command: 'getSettings' });
    });

    it('copies source text and removes only one structural trailing line ending', async () => {
        const button = setViewerHtml('first &amp; second\n\n', '<span>highlighted output</span>');
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
            '<div class="joplin-editable"><pre><code>const <span>value</span> = &quot;x&quot;;\n</code></pre>' +
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
        setViewerHtml('first\n');
        controller = await loadViewerAsset();
        postMessage.mockClear();

        const replacementButton = setViewerHtml('replacement\n');
        replacementButton.click();
        await Promise.resolve();

        expect(postMessage).toHaveBeenCalledWith('codeblockAutocompleteViewer', {
            command: 'copyCodeBlock',
            text: 'replacement',
        });
    });

    it('does not copy while disabled or when no code source can be found', async () => {
        const button = setViewerHtml('code\n');
        postMessage.mockResolvedValueOnce({ enableViewerCopyWidget: false });
        controller = await loadViewerAsset();
        postMessage.mockClear();

        button.click();
        expect(postMessage).not.toHaveBeenCalled();

        document.documentElement.classList.add('codeblock-autocomplete-viewer-copy-enabled');
        document.body.innerHTML = `<div class="joplin-editable">${BUTTON_HTML}</div>`;
        const sourceLessButton = document.querySelector('.codeblock-autocomplete-viewer-copy-button');
        if (!(sourceLessButton instanceof HTMLButtonElement)) throw new Error('Expected a copy button.');
        sourceLessButton.click();
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('fails safely when settings and copy requests reject', async () => {
        const button = setViewerHtml('code\n');
        postMessage.mockRejectedValueOnce(new Error('settings unavailable'));
        controller = await loadViewerAsset();

        expect(document.documentElement.classList.contains('codeblock-autocomplete-viewer-copy-enabled')).toBe(false);

        postMessage.mockResolvedValueOnce({ enableViewerCopyWidget: true });
        await controller.refreshSettings();
        postMessage.mockRejectedValueOnce(new Error('clipboard unavailable'));

        expect(() => button.click()).not.toThrow();
        await Promise.resolve();
    });
});

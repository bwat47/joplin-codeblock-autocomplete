import { markLineNumberContainer } from './viewerLineNumbers';

type ViewerController = { destroy(): void };

function setCode(html: string): HTMLElement {
    document.body.innerHTML =
        '<div class="joplin-editable codeblock-autocomplete-viewer-line-numbers">' +
        '<pre class="joplin-source" hidden data-joplin-language="ts">original source</pre>' +
        `<pre class="hljs"><code>${html}</code></pre></div>`;
    return document.querySelector('code')!;
}

async function loadAsset(): Promise<ViewerController> {
    vi.resetModules();
    // @ts-expect-error The viewer asset is a classic browser script.
    await import('./lineNumbers.js');
    if (document.readyState === 'loading') document.dispatchEvent(new Event('DOMContentLoaded'));
    return window.__codeblockAutocompleteViewerLineNumbersController!;
}

function lines(code: HTMLElement): Element[] {
    return Array.from(code.querySelectorAll('.codeblock-autocomplete-viewer-code-line'));
}

describe('viewer line numbers', () => {
    let controller: ViewerController | undefined;
    afterEach(() => {
        controller?.destroy();
        controller = undefined;
        document.body.innerHTML = '';
    });

    it('preserves nested highlighting across newlines and escaped characters', async () => {
        const code = setCode(
            '<span class="comment">first\n<span class="inner">second &amp; &lt;x&gt;\nthird</span> end</span>'
        );
        const text = code.textContent;
        const source = document.querySelector('.joplin-source')!.outerHTML;
        controller = await loadAsset();
        expect(code.textContent).toBe(text);
        expect(lines(code).map((line) => line.getAttribute('data-line-number'))).toEqual(['1', '2', '3']);
        expect(lines(code).map((line) => line.querySelector('.comment')?.textContent)).toEqual([
            'first\n',
            'second & <x>\n',
            'third end',
        ]);
        expect(code.querySelectorAll('.inner')).toHaveLength(2);
        expect(document.querySelector('.joplin-source')!.outerHTML).toBe(source);
    });

    it.each([
        ['', ['']],
        ['a', ['a']],
        ['a\n', ['a\n', '']],
        ['a\n\nb', ['a\n', '\n', 'b']],
    ])('preserves empty lines in %j', async (text, expected) => {
        const code = setCode(text);
        controller = await loadAsset();
        expect(lines(code).map((line) => line.textContent)).toEqual(expected);
        expect(code.textContent).toBe(text);
    });

    it('sizes the gutter and handles replacement notes without numbering twice', async () => {
        const code = setCode(Array.from({ length: 10 }, () => 'x').join('\n'));
        controller = await loadAsset();
        expect(code.style.getPropertyValue('--codeblock-line-number-digits')).toBe('2');
        const replacement = setCode('new\nnote');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(lines(replacement)).toHaveLength(2);
        controller = await loadAsset();
        expect(lines(replacement)).toHaveLength(2);
    });

    it('leaves unmarked code and diagram containers alone', async () => {
        document.body.innerHTML =
            '<div class="joplin-editable"><pre><code>plain</code></pre></div>' +
            '<div class="joplin-editable codeblock-autocomplete-viewer-line-numbers"><pre class="mermaid">graph</pre></div>';
        const original = document.body.innerHTML;
        controller = await loadAsset();
        expect(document.body.innerHTML).toBe(original);
    });

    it('marks eligible renderer output without changing source metadata', () => {
        const html =
            '<div class="other joplin-editable"><pre class="joplin-source">source</pre><pre><code>x</code></pre></div>';
        expect(markLineNumberContainer(html)).toBe(
            html.replace('other joplin-editable', 'other joplin-editable codeblock-autocomplete-viewer-line-numbers')
        );
        const diagram = '<div class="joplin-editable"><pre class="mermaid">graph</pre></div>';
        expect(markLineNumberContainer(diagram)).toBe(diagram);
    });
});

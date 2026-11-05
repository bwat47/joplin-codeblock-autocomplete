import { markCodeLineContainer } from './viewerLineNumbers';
import type { ViewerAssetController, ViewerWindow } from './viewerTypes';

const viewerWindow = window as ViewerWindow;

function setCode(html: string, preAttributes = ''): HTMLElement {
    document.body.innerHTML =
        '<div class="joplin-editable">' +
        '<pre class="joplin-source" hidden data-joplin-language="ts">original source</pre>' +
        '<pre class="hljs codeblock-autocomplete-viewer-lines codeblock-autocomplete-viewer-line-numbers"' +
        `${preAttributes}><code>${html}</code></pre></div>`;
    return document.querySelector('code')!;
}

async function loadAsset(): Promise<ViewerAssetController> {
    vi.resetModules();
    // @ts-expect-error The viewer asset is a classic browser script.
    await import('./lineNumbers.js');
    if (document.readyState === 'loading') document.dispatchEvent(new Event('DOMContentLoaded'));
    return viewerWindow.__codeblockAutocompleteViewerLineNumbersController!;
}

function lines(code: HTMLElement): Element[] {
    return Array.from(code.querySelectorAll('.codeblock-autocomplete-viewer-code-line'));
}

describe('viewer line numbers', () => {
    let controller: ViewerAssetController | undefined;
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

    it('starts numbering from the start attribute', async () => {
        const code = setCode('a\nb', ' data-codeblock-line-start="9"');
        controller = await loadAsset();
        expect(lines(code).map((line) => line.getAttribute('data-line-number'))).toEqual(['9', '10']);
        expect(code.style.getPropertyValue('--codeblock-line-number-digits')).toBe('2');
    });

    it('highlights lines by position without numbering them in unnumbered code', async () => {
        document.body.innerHTML =
            '<div class="joplin-editable">' +
            '<pre class="hljs codeblock-autocomplete-viewer-lines" data-codeblock-highlight-lines="1 3">' +
            '<code>a\nb\nc</code></pre></div>';
        const code = document.querySelector('code')!;
        controller = await loadAsset();

        expect(lines(code).map((line) => line.textContent)).toEqual(['a\n', 'b\n', 'c']);
        expect(lines(code).map((line) => line.getAttribute('data-line-number'))).toEqual([null, null, null]);
        expect(
            lines(code).map((line) => line.classList.contains('codeblock-autocomplete-viewer-highlighted-line'))
        ).toEqual([true, false, true]);
        expect(code.style.getPropertyValue('--codeblock-line-number-digits')).toBe('');
    });

    it('leaves unmarked code and diagram containers alone', async () => {
        document.body.innerHTML =
            '<div class="joplin-editable"><pre><code>plain</code></pre></div>' +
            '<div class="joplin-editable"><pre class="mermaid codeblock-autocomplete-viewer-lines">graph</pre></div>';
        const original = document.body.innerHTML;
        controller = await loadAsset();
        expect(document.body.innerHTML).toBe(original);
    });

    it('marks the rendered code pre without changing the container or source metadata', () => {
        const html =
            '<div class="other joplin-editable"><pre class="joplin-source">source</pre>' +
            '<pre class="hljs"><code>x</code></pre></div>';
        const lines = 'codeblock-autocomplete-viewer-lines';
        const numbers = 'codeblock-autocomplete-viewer-line-numbers';
        const mark = (numbered: boolean, start: number, highlightedLines: number[]): string =>
            markCodeLineContainer(html, { numbered, start, highlightedLines });

        expect(mark(true, 1, [])).toBe(html.replace('<pre class="hljs">', `<pre class="hljs ${lines} ${numbers}">`));
        expect(mark(true, 0, [])).toBe(
            html.replace('<pre class="hljs">', `<pre class="hljs ${lines} ${numbers}" data-codeblock-line-start="0">`)
        );
        expect(mark(false, 5, [1, 3])).toBe(
            html.replace('<pre class="hljs">', `<pre class="hljs ${lines}" data-codeblock-highlight-lines="1 3">`)
        );
        expect(mark(false, 1, [])).toBe(html);
        const withoutClass = '<div class="joplin-editable"><pre><code>x</code></pre></div>';
        expect(markCodeLineContainer(withoutClass, { numbered: false, start: 1, highlightedLines: [1] })).toBe(
            `<div class="joplin-editable"><pre class="${lines}" data-codeblock-highlight-lines="1"><code>x</code></pre></div>`
        );
        const diagram = '<div class="joplin-editable"><pre class="mermaid">graph</pre></div>';
        expect(markCodeLineContainer(diagram, { numbered: true, start: 5, highlightedLines: [1] })).toBe(diagram);
    });
});

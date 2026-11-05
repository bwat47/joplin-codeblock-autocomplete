import { preserveFenceInfo } from './fenceSource';

function joplinFenceHtml(language: string): string {
    return (
        `<div class="joplin-editable"><pre class="joplin-source" hidden data-joplin-language="${language}" ` +
        `data-joplin-source-open="\`\`\`${language}&#10;" data-joplin-source-close="&#10;\`\`\`">x</pre>` +
        '<pre class="hljs"><code>x</code></pre></div>\n'
    );
}

function getSource(html: string): Element {
    const source = new DOMParser().parseFromString(html, 'text/html').querySelector('.joplin-source');
    if (!source) {
        throw new Error('Expected a source element.');
    }
    return source;
}

describe('preserveFenceInfo', () => {
    it('writes the whole info string into the source metadata', () => {
        const source = getSource(preserveFenceInfo(joplinFenceHtml('ts'), ' ts ln start=5 '));

        expect(source.getAttribute('data-joplin-source-open')).toBe('```ts ln start=5\n');
        expect(source.getAttribute('data-joplin-language')).toBe('ts ln start=5');
        expect(source.getAttribute('data-joplin-source-close')).toBe('\n```');
        expect(source.textContent).toBe('x');
    });

    it('escapes the info string for the attributes', () => {
        const info = 'ts title="a & <b>" $& $1';
        const source = getSource(preserveFenceInfo(joplinFenceHtml('ts'), info));

        expect(source.getAttribute('data-joplin-source-open')).toBe(`\`\`\`${info}\n`);
        expect(source.getAttribute('data-joplin-language')).toBe(info);
    });

    it('changes only the source element', () => {
        const html = joplinFenceHtml('ts');
        const result = preserveFenceInfo(html, 'ts ln');

        expect(result.slice(result.indexOf('</pre>'))).toBe(html.slice(html.indexOf('</pre>')));
    });

    it.each([
        ['an info string without options', 'ts'],
        ['an empty info string', ''],
        ['an info string containing a backtick', 'ts `x`'],
    ])('leaves the HTML unchanged for %s', (_name, info) => {
        const html = joplinFenceHtml('ts');

        expect(preserveFenceInfo(html, info)).toBe(html);
    });

    it('leaves output without the expected source metadata unchanged', () => {
        const withoutOpen =
            '<div class="joplin-editable"><pre class="joplin-source" data-joplin-language="ts">x</pre>' +
            '<pre class="hljs"><code>x</code></pre></div>\n';
        const diagram =
            '<div class="joplin-editable"><pre class="joplin-source" hidden data-joplin-language="mermaid" ' +
            'data-joplin-source-open="```mermaid&#10;" data-joplin-source-close="&#10;```&#10;">graph</pre>' +
            '<pre class="mermaid">graph</pre></div>\n';

        expect(preserveFenceInfo(withoutOpen, 'ts ln')).toBe(withoutOpen);
        expect(preserveFenceInfo(diagram, 'mermaid ln')).toBe(diagram);
    });
});

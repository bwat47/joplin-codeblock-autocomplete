/** Matches Joplin's editable class attribute, including containers with other classes. */
const EDITABLE_CLASS_PATTERN = /class=(['"])[^'"]*\bjoplin-editable\b[^'"]*\1/;
/**
 * Joplin's own `fence` overrides (mermaid, ABC, Fountain) also emit a
 * `joplin-editable` container, so the container alone does not identify a code
 * block. Only Joplin's code renderer wraps its output in `<code>`, and none of
 * the diagram renderers do, so require a rendered `<code>` element as well.
 * Matches `<code>` and `<code class="...">` but not `<codesomething>`.
 */
const RENDERED_CODE_PATTERN = /<code[\s/>]/;

/** Whether fence output is a `joplin-editable` container around rendered code. */
export function isRenderedCodeContainer(renderedHtml: string): boolean {
    return EDITABLE_CLASS_PATTERN.test(renderedHtml) && RENDERED_CODE_PATTERN.test(renderedHtml);
}

/**
 * Appends a class to the outer `joplin-editable` container rather than
 * rewriting its class list, so Joplin's own classes survive. The pattern is
 * not global, so only the outer container is marked.
 */
export function addContainerClass(renderedHtml: string, className: string): string {
    return renderedHtml.replace(
        EDITABLE_CLASS_PATTERN,
        (attribute) => `${attribute.slice(0, -1)} ${className}${attribute.slice(-1)}`
    );
}

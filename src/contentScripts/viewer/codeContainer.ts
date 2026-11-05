/** Matches Joplin's editable class attribute, including containers with other classes. */
const EDITABLE_CLASS_PATTERN = /class=(['"])[^'"]*\bjoplin-editable\b[^'"]*\1/;
/** Matches the whole opening tag of the editable container, for example `<div class="joplin-editable">`. */
const EDITABLE_OPENING_TAG_PATTERN = /<div\b[^>]*\bclass=(['"])[^'"]*\bjoplin-editable\b[^'"]*\1[^>]*>/;
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

/**
 * Adds an attribute to the outer `joplin-editable` container, next to its class attribute. The
 * value is written as given, so callers must pass attribute-safe values.
 */
export function addContainerAttribute(renderedHtml: string, name: string, value: string): string {
    return renderedHtml.replace(EDITABLE_CLASS_PATTERN, (attribute) => `${attribute} ${name}="${value}"`);
}

/** Inserts HTML as the first child of the outer `joplin-editable` container. */
export function prependToContainer(renderedHtml: string, html: string): string {
    return renderedHtml.replace(EDITABLE_OPENING_TAG_PATTERN, (openingTag) => `${openingTag}${html}`);
}

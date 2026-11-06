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
 * Matches the opening tag of the `<pre>` holding the rendered code, for example
 * `<pre class="hljs">` directly before `<code>`. The hidden source `<pre>` holds escaped text, so
 * it never matches.
 */
const RENDERED_CODE_PRE_PATTERN = /<pre\b([^>]*)>(?=<code[\s/>])/;
/** Matches a class attribute and captures its quote and class list, for example `class="hljs"`. */
const CLASS_ATTRIBUTE_PATTERN = /\bclass=(['"])([^'"]*)\1/;

/**
 * Adds classes and attributes to the `<pre>` holding the rendered code. Unlike the outer
 * container, it survives Joplin's mobile Rich Text editor, which keeps only the container's inner
 * HTML. Attribute values are written as given, so callers must pass attribute-safe values.
 */
export function markRenderedCodePre(
    renderedHtml: string,
    className: string,
    attributes: Readonly<Record<string, string>>
): string {
    return renderedHtml.replace(RENDERED_CODE_PRE_PATTERN, (_tag, existingAttributes: string) => {
        const withClass = CLASS_ATTRIBUTE_PATTERN.test(existingAttributes)
            ? existingAttributes.replace(
                  CLASS_ATTRIBUTE_PATTERN,
                  (_attribute, quote: string, classes: string) => `class=${quote}${classes} ${className}${quote}`
              )
            : `${existingAttributes} class="${className}"`;
        const extraAttributes = Object.entries(attributes)
            .map(([name, value]) => ` ${name}="${value}"`)
            .join('');

        return `<pre${withClass}${extraAttributes}>`;
    });
}

/** Inserts HTML as the first child of the outer `joplin-editable` container. */
export function prependToContainer(renderedHtml: string, html: string): string {
    return renderedHtml.replace(EDITABLE_OPENING_TAG_PATTERN, (openingTag) => `${openingTag}${html}`);
}

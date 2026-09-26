const LINE_NUMBER_CONTAINER_CLASS = 'codeblock-autocomplete-viewer-line-numbers';
/** Matches Joplin's editable class attribute, including containers with other classes. */
const EDITABLE_CLASS_PATTERN = /class=(['"])[^'"]*\bjoplin-editable\b[^'"]*\1/;

/** Marks rendered code only; diagram renderers also use editable containers. */
export function markLineNumberContainer(renderedHtml: string): string {
    if (!/<pre[\s>]/.test(renderedHtml) || !/<code[\s>]/.test(renderedHtml)) {
        return renderedHtml;
    }
    return renderedHtml.replace(
        EDITABLE_CLASS_PATTERN,
        (attribute) => `${attribute.slice(0, -1)} ${LINE_NUMBER_CONTAINER_CLASS}${attribute.slice(-1)}`
    );
}

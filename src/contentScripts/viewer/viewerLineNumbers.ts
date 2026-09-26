import { addContainerClass, isRenderedCodeContainer } from './codeContainer';

const LINE_NUMBER_CONTAINER_CLASS = 'codeblock-autocomplete-viewer-line-numbers';

/** Marks rendered code only; diagram renderers also use editable containers. */
export function markLineNumberContainer(renderedHtml: string): string {
    return isRenderedCodeContainer(renderedHtml)
        ? addContainerClass(renderedHtml, LINE_NUMBER_CONTAINER_CLASS)
        : renderedHtml;
}

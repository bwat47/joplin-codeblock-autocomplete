import { addContainerAttribute, addContainerClass, isRenderedCodeContainer } from './codeContainer';

const LINE_NUMBER_CONTAINER_CLASS = 'codeblock-autocomplete-viewer-line-numbers';
/** Read by `lineNumbers.js`; omitted when numbering starts at 1. */
const LINE_NUMBER_START_ATTRIBUTE = 'data-codeblock-line-start';

/** Marks rendered code only; diagram renderers also use editable containers. */
export function markLineNumberContainer(renderedHtml: string, start: number): string {
    if (!isRenderedCodeContainer(renderedHtml)) {
        return renderedHtml;
    }

    const marked = addContainerClass(renderedHtml, LINE_NUMBER_CONTAINER_CLASS);
    return start === 1 ? marked : addContainerAttribute(marked, LINE_NUMBER_START_ATTRIBUTE, String(start));
}

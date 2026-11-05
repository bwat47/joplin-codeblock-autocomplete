// @ts-check
(function () {
    'use strict';

    var CONTAINER_CLASS = 'codeblock-autocomplete-viewer-line-numbers';
    var LINE_CLASS = 'codeblock-autocomplete-viewer-code-line';
    var NUMBERED_ATTRIBUTE = 'data-codeblock-numbered';
    /** Set by the renderer from the fence's `start=N` option; absent means 1. */
    var START_ATTRIBUTE = 'data-codeblock-line-start';
    /** Excludes numbered code so observer passes triggered by any DOM change stay cheap. */
    var UNNUMBERED_CODE_SELECTOR =
        '.' + CONTAINER_CLASS + ' > pre:not(.joplin-source) > code:not([' + NUMBERED_ATTRIBUTE + '])';
    /** @type {MutationObserver | null} */
    var observer = null;

    /**
     * Split text nodes while cloning their highlight ancestors for each new line.
     * A highlight span can cross several newlines, so splitting HTML strings
     * would produce broken markup. Newlines stay in the code's textContent.
     * @param {HTMLElement} code
     */
    function numberCode(code) {
        var ownerDocument = code.ownerDocument;
        var fragment = ownerDocument.createDocumentFragment();
        /** @type {Node[]} */
        var ancestors = [];
        /** @type {Node[]} */
        var parents = [];
        var container = code.closest('.' + CONTAINER_CLASS);
        var start = Number((container && container.getAttribute(START_ATTRIBUTE)) || 1);
        var count = 0;

        function currentParent() {
            var parent = parents[parents.length - 1];
            if (!parent) throw new Error('Expected a parent while numbering code lines.');
            return parent;
        }

        function newLine() {
            var line = ownerDocument.createElement('span');
            line.className = LINE_CLASS;
            line.setAttribute('data-line-number', String(start + count++));
            fragment.appendChild(line);
            parents = [line];
            ancestors.forEach(function (ancestor) {
                var clone = ancestor.cloneNode(false);
                currentParent().appendChild(clone);
                parents.push(clone);
            });
        }

        /** @param {Node} node */
        function visit(node) {
            if (node.nodeType === 3) {
                var parts = (node.nodeValue || '').split('\n');
                parts.forEach(function (part, index) {
                    if (index) newLine();
                    currentParent().appendChild(
                        ownerDocument.createTextNode(part + (index < parts.length - 1 ? '\n' : ''))
                    );
                });
            } else if (node.nodeType === 1) {
                var clone = node.cloneNode(false);
                currentParent().appendChild(clone);
                ancestors.push(node);
                parents.push(clone);
                Array.from(node.childNodes).forEach(visit);
                ancestors.pop();
                parents.pop();
            }
        }

        newLine();
        Array.from(code.childNodes).forEach(visit);
        code.replaceChildren(fragment);
        code.style.setProperty('--codeblock-line-number-digits', String(String(start + count - 1).length));
        code.setAttribute(NUMBERED_ATTRIBUTE, 'true');
    }

    function update() {
        document.querySelectorAll(UNNUMBERED_CODE_SELECTOR).forEach(function (code) {
            if (code instanceof HTMLElement) numberCode(code);
        });
    }

    function start() {
        if (observer) return;
        update();
        observer = new MutationObserver(update);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function destroy() {
        document.removeEventListener('DOMContentLoaded', start);
        if (observer) observer.disconnect();
        observer = null;
    }

    var viewerWindow = /** @type {import('./viewerTypes').ViewerWindow} */ (window);
    var previousController = viewerWindow.__codeblockAutocompleteViewerLineNumbersController;
    if (previousController) previousController.destroy();
    viewerWindow.__codeblockAutocompleteViewerLineNumbersController = { destroy: destroy };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

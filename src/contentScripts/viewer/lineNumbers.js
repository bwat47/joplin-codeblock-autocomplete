(function () {
    'use strict';

    var CONTAINER_CLASS = 'codeblock-autocomplete-viewer-line-numbers';
    var LINE_CLASS = 'codeblock-autocomplete-viewer-code-line';
    var CONTROLLER_KEY = '__codeblockAutocompleteViewerLineNumbersController';
    var observer = null;

    /**
     * Split text nodes while cloning their highlight ancestors for each new line.
     * A highlight span can cross several newlines, so splitting HTML strings
     * would produce broken markup. Newlines stay in the code's textContent.
     */
    function numberCode(code) {
        if (code.hasAttribute('data-codeblock-numbered')) return;

        var ownerDocument = code.ownerDocument;
        var fragment = ownerDocument.createDocumentFragment();
        var ancestors = [];
        var parents = [];
        var line;
        var count = 0;

        function newLine() {
            line = ownerDocument.createElement('span');
            line.className = LINE_CLASS;
            line.setAttribute('data-line-number', String(++count));
            fragment.appendChild(line);
            parents = [line];
            ancestors.forEach(function (ancestor) {
                var clone = ancestor.cloneNode(false);
                parents[parents.length - 1].appendChild(clone);
                parents.push(clone);
            });
        }

        function visit(node) {
            if (node.nodeType === 3) {
                var parts = node.nodeValue.split('\n');
                parts.forEach(function (part, index) {
                    if (index) newLine();
                    parents[parents.length - 1].appendChild(
                        ownerDocument.createTextNode(part + (index < parts.length - 1 ? '\n' : ''))
                    );
                });
            } else if (node.nodeType === 1) {
                var clone = node.cloneNode(false);
                parents[parents.length - 1].appendChild(clone);
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
        code.style.setProperty('--codeblock-line-number-digits', String(String(count).length));
        code.setAttribute('data-codeblock-numbered', 'true');
    }

    function update() {
        document.querySelectorAll('.' + CONTAINER_CLASS + ' > pre:not(.joplin-source) > code').forEach(numberCode);
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

    var previousController = window[CONTROLLER_KEY];
    if (previousController) previousController.destroy();
    window[CONTROLLER_KEY] = { destroy: destroy };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

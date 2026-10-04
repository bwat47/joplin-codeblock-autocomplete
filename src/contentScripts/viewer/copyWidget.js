// @ts-check
(function () {
    'use strict';

    var CONTENT_SCRIPT_ID = 'codeblockAutocompleteViewer';
    var BUTTON_CLASS = 'codeblock-autocomplete-viewer-copy-button';
    var started = false;

    /** @param {Element} button */
    function getCopyText(button) {
        var container = button.closest('.joplin-editable');
        if (!container) return null;

        var source = container.querySelector('.joplin-source');
        var renderedCode = container.querySelector('pre:not(.joplin-source) > code, pre > code');
        var text = null;
        if (source) {
            text = source.textContent;
        } else if (renderedCode) {
            text = renderedCode.textContent;
        }
        if (typeof text !== 'string') return null;

        return text;
    }

    /** @param {Element} button */
    function copyCodeBlock(button) {
        var text = getCopyText(button);
        // Joplin exposes a lexical global, which need not be a property of window.
        /** @type {unknown} */
        var hostApi =
            // @ts-expect-error Joplin injects this name only in the viewer runtime.
            typeof webviewApi === 'undefined' ? undefined : webviewApi;
        var viewerApi = /** @type {import('./viewerTypes').ViewerWebviewApi | undefined} */ (hostApi);
        if (text === null || !viewerApi || typeof viewerApi.postMessage !== 'function') {
            return;
        }

        viewerApi.postMessage(CONTENT_SCRIPT_ID, { command: 'copyCodeBlock', text: text }).catch(function () {
            // The main plugin process logs clipboard failures.
        });
    }

    /** @param {MouseEvent} event */
    function handleClick(event) {
        if (!(event.target instanceof Element)) return;

        var button = event.target.closest('.' + BUTTON_CLASS);
        if (!button) return;

        event.preventDefault();
        event.stopPropagation();
        copyCodeBlock(button);
    }

    function start() {
        if (started) return;
        started = true;

        document.addEventListener('click', handleClick);
    }

    function destroy() {
        document.removeEventListener('DOMContentLoaded', start);
        document.removeEventListener('click', handleClick);
        started = false;
    }

    var viewerWindow = /** @type {import('./viewerTypes').ViewerWindow} */ (window);
    var previousController = viewerWindow.__codeblockAutocompleteViewerCopyController;
    if (previousController && typeof previousController.destroy === 'function') {
        previousController.destroy();
    }

    viewerWindow.__codeblockAutocompleteViewerCopyController = {
        destroy: destroy,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

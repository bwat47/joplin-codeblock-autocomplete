(function () {
    'use strict';

    var CONTENT_SCRIPT_ID = 'codeblockAutocompleteViewer';
    var BUTTON_CLASS = 'codeblock-autocomplete-viewer-copy-button';
    var CONTROLLER_KEY = '__codeblockAutocompleteViewerCopyController';
    var started = false;

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

    function copyCodeBlock(button) {
        var text = getCopyText(button);
        if (text === null || typeof webviewApi === 'undefined' || typeof webviewApi.postMessage !== 'function') {
            return;
        }

        webviewApi.postMessage(CONTENT_SCRIPT_ID, { command: 'copyCodeBlock', text: text }).catch(function () {
            // The main plugin process logs clipboard failures.
        });
    }

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

    var previousController = window[CONTROLLER_KEY];
    if (previousController && typeof previousController.destroy === 'function') {
        previousController.destroy();
    }

    window[CONTROLLER_KEY] = {
        destroy: destroy,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

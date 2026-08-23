(function () {
    'use strict';

    var CONTENT_SCRIPT_ID = 'codeblockAutocompleteViewer';
    var BUTTON_CLASS = 'codeblock-autocomplete-viewer-copy-button';
    var ENABLED_CLASS = 'codeblock-autocomplete-viewer-copy-enabled';
    var CONTROLLER_KEY = '__codeblockAutocompleteViewerCopyController';
    var SETTINGS_POLL_INTERVAL_MS = 2000;
    var settingsRequestSequence = 0;
    var pollTimer = null;
    var started = false;

    function setEnabled(enabled) {
        document.documentElement.classList.toggle(ENABLED_CLASS, enabled);
    }

    function fetchSettings() {
        var requestSequence = ++settingsRequestSequence;

        if (typeof webviewApi === 'undefined' || typeof webviewApi.postMessage !== 'function') {
            setEnabled(false);
            return Promise.resolve();
        }

        return webviewApi
            .postMessage(CONTENT_SCRIPT_ID, { command: 'getSettings' })
            .then(function (settings) {
                if (requestSequence !== settingsRequestSequence) return;
                setEnabled(Boolean(settings && settings.enableViewerCopyWidget === true));
            })
            .catch(function () {
                if (requestSequence !== settingsRequestSequence) return;
                setEnabled(false);
            });
    }

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

        return text.replace(/(?:\r\n|\n|\r)$/, '');
    }

    function copyCodeBlock(button) {
        var text = getCopyText(button);
        if (text === null || typeof webviewApi === 'undefined' || typeof webviewApi.postMessage !== 'function') {
            return;
        }

        webviewApi
            .postMessage(CONTENT_SCRIPT_ID, { command: 'copyCodeBlock', text: text })
            .catch(function () {
                // The main plugin process logs clipboard failures.
            });
    }

    function handleClick(event) {
        if (!(event.target instanceof Element)) return;

        var button = event.target.closest('.' + BUTTON_CLASS);
        if (!button || !document.documentElement.classList.contains(ENABLED_CLASS)) return;

        event.preventDefault();
        event.stopPropagation();
        copyCodeBlock(button);
    }

    function start() {
        if (started) return;
        started = true;

        document.addEventListener('click', handleClick);
        document.addEventListener('joplin-noteDidUpdate', fetchSettings);
        void fetchSettings();
        pollTimer = window.setInterval(fetchSettings, SETTINGS_POLL_INTERVAL_MS);
    }

    function destroy() {
        document.removeEventListener('DOMContentLoaded', start);
        document.removeEventListener('click', handleClick);
        document.removeEventListener('joplin-noteDidUpdate', fetchSettings);
        if (pollTimer !== null) window.clearInterval(pollTimer);
        pollTimer = null;
        started = false;
        settingsRequestSequence += 1;
        setEnabled(false);
    }

    var previousController = window[CONTROLLER_KEY];
    if (previousController && typeof previousController.destroy === 'function') {
        previousController.destroy();
    }

    window[CONTROLLER_KEY] = {
        destroy: destroy,
        refreshSettings: fetchSettings,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();

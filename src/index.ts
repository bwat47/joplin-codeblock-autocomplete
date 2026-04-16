/**
 * Codeblock Autocomplete plugin entry point.
 * Provides language autocompletion when typing ``` in the markdown editor.
 */
import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerSettings, initializeSettingsCache, getContentScriptSettings } from './settings';

const CONTENT_SCRIPT_ID = 'codeBlockCompleter';

type ContentScriptMessage =
    | { command: 'getSettings' }
    | { command: 'copyCodeBlock'; text: string }
    | { command: string; text?: unknown };

joplin.plugins.register({
    onStart: async function () {
        await registerSettings();
        await initializeSettingsCache();

        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/index.js'
        );

        await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, (message: ContentScriptMessage) => {
            if (message.command === 'getSettings') {
                return getContentScriptSettings();
            }
            if (message.command === 'copyCodeBlock' && typeof message.text === 'string') {
                return joplin.clipboard.writeText(message.text);
            }
            return null;
        });
    },
});

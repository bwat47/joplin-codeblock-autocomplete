/**
 * Codeblock Autocomplete plugin entry point.
 * Provides language autocompletion when typing ``` in the markdown editor.
 */
import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerSettings, initializeSettingsCache, getLanguageList } from './settings';

const CONTENT_SCRIPT_ID = 'codeBlockCompleter';

joplin.plugins.register({
    onStart: async function () {
        await registerSettings();
        await initializeSettingsCache();

        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/index.js'
        );

        await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, (message: { command: string }) => {
            if (message.command === 'getLanguages') {
                return { languages: getLanguageList() };
            }
            return null;
        });
    },
});

import joplin from 'api';
import { ContentScriptType } from 'api/types';
import { registerSettings, initializeSettingsCache, getLanguageList } from './settings';

const CONTENT_SCRIPT_ID = 'codeBlockCompleter';

joplin.plugins.register({
    onStart: async function () {
        // 1. Register settings
        await registerSettings();

        // 2. Initialize settings cache
        await initializeSettingsCache();

        // 3. Register the CodeMirror content script
        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/index.js'
        );

        // 4. Handle messages from content script to get settings
        await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, (message: { command: string }) => {
            if (message.command === 'getLanguages') {
                return { languages: getLanguageList() };
            }
            return null;
        });
    },
});

// src/index.ts
import joplin from 'api';
import { ContentScriptType } from 'api/types';

joplin.plugins.register({
    onStart: async function () {
        // Register the CodeMirror content script
        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            'codeBlockCompleter',
            './contentScript/index.js'
        );
    },
});

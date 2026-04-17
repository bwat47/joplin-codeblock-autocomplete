/**
 * Codeblock Autocomplete plugin entry point.
 * Provides language autocompletion when typing ``` in the markdown editor.
 */
import joplin from 'api';
import { ContentScriptType, ToastType, ToolbarButtonLocation } from 'api/types';
import { logger } from './logger';
import { INSERT_CODE_BLOCK_COMMAND, UPDATE_SETTINGS_COMMAND } from './contentScript/types';
import { registerSettings, getContentScriptSettings, arePluginSettingsChanged } from './settings';

const CONTENT_SCRIPT_ID = 'codeBlockCompleter';
const INSERT_CODE_BLOCK_TOOLBAR_COMMAND = 'insertCodeblockAutocompleteToolbarBlock';
const INSERT_CODE_BLOCK_TOOLBAR_BUTTON_ID = 'insertCodeblockAutocompleteToolbarButton';

type ContentScriptMessage =
    | { command: 'getSettings' }
    | { command: 'copyCodeBlock'; text: string }
    | { command: string; text?: unknown };

async function insertCodeBlockInEditor(): Promise<void> {
    try {
        await joplin.commands.execute('editor.execCommand', {
            name: INSERT_CODE_BLOCK_COMMAND,
            args: [],
        });
    } catch (error) {
        logger.warn('Failed to insert a fenced code block in the active editor.', error);
    }
}

joplin.plugins.register({
    onStart: async function () {
        await registerSettings();

        await joplin.contentScripts.register(
            ContentScriptType.CodeMirrorPlugin,
            CONTENT_SCRIPT_ID,
            './contentScript/index.js'
        );

        await joplin.contentScripts.onMessage(CONTENT_SCRIPT_ID, async (message: ContentScriptMessage) => {
            if (message.command === 'getSettings') {
                return getContentScriptSettings();
            }
            if (message.command === 'copyCodeBlock' && typeof message.text === 'string') {
                await joplin.clipboard.writeText(message.text);
                await joplin.views.dialogs.showToast({ message: 'Code copied to clipboard.', type: ToastType.Success });
                return;
            }
            return null;
        });

        await joplin.commands.register({
            name: INSERT_CODE_BLOCK_TOOLBAR_COMMAND,
            label: 'Insert code block',
            iconName: 'fas fa-code',
            execute: async () => {
                await insertCodeBlockInEditor();
            },
        });

        await joplin.views.toolbarButtons.create(
            INSERT_CODE_BLOCK_TOOLBAR_BUTTON_ID,
            INSERT_CODE_BLOCK_TOOLBAR_COMMAND,
            ToolbarButtonLocation.EditorToolbar
        );

        joplin.settings.onChange(async (event) => {
            if (!arePluginSettingsChanged(event.keys)) {
                return;
            }

            const settings = await getContentScriptSettings();

            try {
                await joplin.commands.execute('editor.execCommand', {
                    name: UPDATE_SETTINGS_COMMAND,
                    args: [settings],
                });
            } catch (error) {
                logger.warn('Failed to push updated settings to the active editor.', error);
            }
        });
    },
});

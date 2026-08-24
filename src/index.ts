/**
 * Codeblock Autocomplete plugin entry point.
 * Provides language autocompletion when typing ``` in the markdown editor.
 */
import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToastType, ToolbarButtonLocation } from 'api/types';
import { logger } from './logger';
import { INSERT_CODE_BLOCK_COMMAND, UPDATE_SETTINGS_COMMAND } from './contentScripts/codemirror/types';
import { areCodeMirrorSettingsChanged, getContentScriptSettings, registerSettings } from './settings';

const CODE_MIRROR_CONTENT_SCRIPT_ID = 'codeBlockCompleter';
const VIEWER_CONTENT_SCRIPT_ID = 'codeblockAutocompleteViewer';
const INSERT_CODE_BLOCK_TOOLBAR_COMMAND = 'insertCodeblockAutocompleteToolbarBlock';
const INSERT_CODE_BLOCK_MENU_ITEM_ID = 'insertCodeblockAutocompleteEditMenuItem';
const INSERT_CODE_BLOCK_TOOLBAR_BUTTON_ID = 'insertCodeblockAutocompleteToolbarButton';

type ContentScriptMessage = { command: string; text?: unknown };

type CopyCodeBlockResult = {
    ok: boolean;
};

function normalizeContentScriptMessage(message: unknown): ContentScriptMessage | null {
    if (!message || typeof message !== 'object' || typeof (message as ContentScriptMessage).command !== 'string') {
        return null;
    }

    return message as ContentScriptMessage;
}

async function copyCodeBlock(text: unknown): Promise<CopyCodeBlockResult> {
    if (typeof text !== 'string') {
        return { ok: false };
    }

    try {
        await joplin.clipboard.writeText(text);
    } catch (error) {
        logger.error('Failed to copy code block to the clipboard.', error);
        return { ok: false };
    }

    try {
        await joplin.views.dialogs.showToast({ message: 'Code copied to clipboard.', type: ToastType.Success });
    } catch (error) {
        logger.warn('Code was copied, but the success toast could not be shown.', error);
    }

    return { ok: true };
}

async function handleCodeMirrorMessage(rawMessage: unknown): Promise<unknown> {
    const message = normalizeContentScriptMessage(rawMessage);
    if (!message) {
        return null;
    }

    if (message.command === 'getSettings') {
        return getContentScriptSettings();
    }
    if (message.command === 'copyCodeBlock') {
        return copyCodeBlock(message.text);
    }

    return null;
}

async function handleViewerMessage(rawMessage: unknown): Promise<unknown> {
    const message = normalizeContentScriptMessage(rawMessage);
    if (!message) {
        return null;
    }

    if (message.command === 'copyCodeBlock') {
        return copyCodeBlock(message.text);
    }

    return null;
}

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
            CODE_MIRROR_CONTENT_SCRIPT_ID,
            './contentScripts/codemirror/index.js'
        );
        await joplin.contentScripts.register(
            ContentScriptType.MarkdownItPlugin,
            VIEWER_CONTENT_SCRIPT_ID,
            './contentScripts/viewer/index.js'
        );

        await joplin.contentScripts.onMessage(CODE_MIRROR_CONTENT_SCRIPT_ID, handleCodeMirrorMessage);
        await joplin.contentScripts.onMessage(VIEWER_CONTENT_SCRIPT_ID, handleViewerMessage);

        await joplin.commands.register({
            name: INSERT_CODE_BLOCK_TOOLBAR_COMMAND,
            label: 'Insert code block',
            iconName: 'fas fa-code',
            execute: async () => {
                await insertCodeBlockInEditor();
            },
        });

        await joplin.views.menuItems.create(
            INSERT_CODE_BLOCK_MENU_ITEM_ID,
            INSERT_CODE_BLOCK_TOOLBAR_COMMAND,
            MenuItemLocation.Edit,
            { accelerator: 'CmdOrCtrl+Alt+`' }
        );

        await joplin.views.toolbarButtons.create(
            INSERT_CODE_BLOCK_TOOLBAR_BUTTON_ID,
            INSERT_CODE_BLOCK_TOOLBAR_COMMAND,
            ToolbarButtonLocation.EditorToolbar
        );

        joplin.settings.onChange(async (event) => {
            if (!areCodeMirrorSettingsChanged(event.keys)) {
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

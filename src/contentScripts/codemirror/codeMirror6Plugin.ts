/**
 * CodeMirror 6 content-script composition root for code block features.
 */
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { CodeMirrorControl } from 'api/types';
import { copyWidgetTheme, createCopyWidgetPlugin } from './copyWidget';
import { createCodeBlockCompleter, createFenceTriggerExtension, fenceAutocompleteTheme } from './fenceAutocomplete';
import { insertCodeBlockAtCursor } from './insertCodeBlock';
import { createLineNumbersPlugin, lineNumbersTheme } from './lineNumbers';
import { applyPluginSettings, createSettingsExtension, syncInitialSettings } from './pluginSettings';
import { INSERT_CODE_BLOCK_COMMAND, UPDATE_SETTINGS_COMMAND, type PostMessageContext } from './types';

export default function codeMirror6Plugin(context: PostMessageContext, CodeMirror: CodeMirrorControl): void {
    const codeBlockCompleter = createCodeBlockCompleter();
    const settingsExtension = createSettingsExtension();

    CodeMirror.registerCommand(UPDATE_SETTINGS_COMMAND, (settings: unknown) => {
        applyPluginSettings(CodeMirror.editor as EditorView, settings);
    });
    CodeMirror.registerCommand(INSERT_CODE_BLOCK_COMMAND, () => {
        insertCodeBlockAtCursor(CodeMirror.editor as EditorView);
    });

    // Joplin's API declares this as `any` to avoid depending on CodeMirror types.
    const completionExt = CodeMirror.joplinExtensions.completionSource(codeBlockCompleter) as Extension;

    CodeMirror.addExtension([
        settingsExtension,
        completionExt,
        createFenceTriggerExtension(),
        copyWidgetTheme,
        fenceAutocompleteTheme,
        createCopyWidgetPlugin(context),
        lineNumbersTheme,
        createLineNumbersPlugin(),
    ]);

    void syncInitialSettings(context, CodeMirror);
}

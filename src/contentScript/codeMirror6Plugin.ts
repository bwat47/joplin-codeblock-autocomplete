/**
 * CodeMirror 6 content-script composition root for code block features.
 */
import { autocompletion } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CodeMirrorControl } from 'api/types';
import { copyWidgetTheme, createCopyWidgetPlugin } from './copyWidget';
import { createCodeBlockCompleter, createFenceTriggerExtension } from './fenceAutocomplete';
import { applyPluginSettings, createSettingsExtension, syncInitialSettings } from './pluginSettings';
import type { PluginContext } from './types';
import { UPDATE_SETTINGS_COMMAND } from './types';

export default function codeMirror6Plugin(context: PluginContext, CodeMirror: CodeMirrorControl): void {
    const codeBlockCompleter = createCodeBlockCompleter();
    const settingsExtension = createSettingsExtension();

    CodeMirror.registerCommand(UPDATE_SETTINGS_COMMAND, (settings: unknown) => {
        applyPluginSettings(CodeMirror.editor as EditorView, settings);
    });

    let completionExt: Extension;
    if (CodeMirror.joplinExtensions) {
        completionExt = CodeMirror.joplinExtensions.completionSource(codeBlockCompleter);
    } else {
        completionExt = autocompletion({ override: [codeBlockCompleter] });
    }

    CodeMirror.addExtension([
        settingsExtension,
        completionExt,
        createFenceTriggerExtension(),
        copyWidgetTheme,
        createCopyWidgetPlugin(context),
    ]);

    void syncInitialSettings(context, CodeMirror);
}

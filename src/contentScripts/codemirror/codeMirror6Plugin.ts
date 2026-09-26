/**
 * CodeMirror 6 content-script composition root for code block features.
 */
import { autocompletion } from '@codemirror/autocomplete';
import type { Extension, Facet } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CodeMirrorControl } from 'api/types';
import { logger } from '../../logger';
import { createCodeFoldingExtension } from './codeFolding';
import { copyWidgetTheme, createCopyWidgetPlugin } from './copyWidget';
import { createFoldPersistence } from './foldPersistence';
import { createCodeBlockCompleter, createFenceTriggerExtension, fenceAutocompleteTheme } from './fenceAutocomplete';
import { insertCodeBlockAtCursor } from './insertCodeBlock';
import { applyPluginSettings, createSettingsExtension, syncInitialSettings } from './pluginSettings';
import type { PostMessageContext } from './types';
import { INSERT_CODE_BLOCK_COMMAND, UPDATE_SETTINGS_COMMAND } from './types';

export default function codeMirror6Plugin(context: PostMessageContext, CodeMirror: CodeMirrorControl): void {
    const codeBlockCompleter = createCodeBlockCompleter();
    const settingsExtension = createSettingsExtension();

    CodeMirror.registerCommand(UPDATE_SETTINGS_COMMAND, (settings: unknown) => {
        applyPluginSettings(CodeMirror.editor as EditorView, settings);
    });
    CodeMirror.registerCommand(INSERT_CODE_BLOCK_COMMAND, () => {
        insertCodeBlockAtCursor(CodeMirror.editor as EditorView);
    });

    let completionExt: Extension;
    if (CodeMirror.joplinExtensions) {
        completionExt = CodeMirror.joplinExtensions.completionSource(codeBlockCompleter);
    } else {
        completionExt = autocompletion({ override: [codeBlockCompleter] });
    }

    // Joplin exposes the open note's ID from 3.3, the plugin's minimum version; without it, folds
    // simply are not remembered between notes.
    const noteIdFacet = CodeMirror.joplinExtensions?.noteIdFacet as Facet<string, string> | undefined;
    if (!noteIdFacet) {
        logger.warn('Note ID facet unavailable; code block folds will not be remembered.');
    }

    CodeMirror.addExtension([
        settingsExtension,
        completionExt,
        createFenceTriggerExtension(),
        copyWidgetTheme,
        fenceAutocompleteTheme,
        createCopyWidgetPlugin(context),
        createCodeFoldingExtension(),
        noteIdFacet ? createFoldPersistence(context, noteIdFacet) : [],
    ]);

    void syncInitialSettings(context, CodeMirror);
}

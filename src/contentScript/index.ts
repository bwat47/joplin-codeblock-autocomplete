/**
 * Content script entry point for CodeMirror integration.
 */
import type { CodeMirrorControl, ContentScriptContext, MarkdownEditorContentScriptModule } from 'api/types';
import codeMirror6Plugin from './codeMirror6Plugin';

export default function (context: ContentScriptContext): MarkdownEditorContentScriptModule {
    return {
        plugin: (editorControl: CodeMirrorControl) => {
            if (editorControl.cm6) {
                codeMirror6Plugin(context, editorControl);
            }
        },
    };
}

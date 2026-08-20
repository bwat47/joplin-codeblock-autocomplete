/**
 * Content script entry point for CodeMirror integration.
 */
import type { CodeMirrorControl } from 'api/types';
import codeMirror6Plugin from './codeMirror6Plugin';
import type { PluginContext } from './types';

type ContentScriptModule = {
    plugin: (CodeMirror: CodeMirrorControl) => void;
};

export default function (context: PluginContext): ContentScriptModule {
    return {
        plugin: (CodeMirror: CodeMirrorControl) => {
            if (CodeMirror.cm6) {
                codeMirror6Plugin(context, CodeMirror);
            }
        },
    };
}

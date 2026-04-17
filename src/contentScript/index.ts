/**
 * Content script entry point for CodeMirror integration.
 */
import type { CodeMirrorControl } from 'api/types';
import codeMirror6Plugin from './codeMirror6Plugin';
import type { PluginContext } from './types';

module.exports = {
    default: function (context: PluginContext) {
        return {
            plugin: (CodeMirror: CodeMirrorControl) => {
                if (CodeMirror.cm6) {
                    codeMirror6Plugin(context, CodeMirror);
                }
            },
        };
    },
};

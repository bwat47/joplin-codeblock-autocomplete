/**
 * Content script entry point for CodeMirror integration.
 */
import codeMirror6Plugin from './codeMirror6Plugin';
import type { PluginContext, JoplinCodeMirror } from './types';

module.exports = {
    default: function (context: PluginContext) {
        return {
            plugin: (CodeMirror: JoplinCodeMirror) => {
                if (CodeMirror.cm6) {
                    codeMirror6Plugin(context, CodeMirror);
                }
            },
        };
    },
};

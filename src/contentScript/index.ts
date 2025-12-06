// src/contentScript/index.ts
import codeMirror6Plugin from './codeMirror6Plugin';

module.exports = {
    default: function (context: any) {
        return {
            plugin: (CodeMirror: any) => {
                // We only initialize if it's the CM6 implementation
                if (CodeMirror.cm6) {
                    codeMirror6Plugin(context, CodeMirror);
                }
            },
            // No assets or CSS needed for this minimal version
            // as we use the default CM6 tooltip styles
        };
    },
};

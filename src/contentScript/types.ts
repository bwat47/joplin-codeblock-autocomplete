/**
 * Type definitions for Joplin content script integration.
 */
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';

/** Context provided by Joplin to content scripts */
export interface PluginContext {
    postMessage(message: unknown): Promise<unknown>;
}

/** Joplin's CodeMirror wrapper interface */
export interface JoplinCodeMirror {
    cm6: boolean;
    joplinExtensions?: {
        completionSource: (source: (context: CompletionContext) => Promise<CompletionResult | null>) => Extension;
    };
    addExtension: (extensions: Extension[]) => void;
}

import { Compartment, Facet, type EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

import type { CodeMirrorControl } from 'api/types';
import { logger } from '../../logger';
import type { PluginSettingsResponse, PostMessageContext } from './types';

const DEFAULT_SETTINGS: PluginSettingsResponse = {
    enableLanguageAutocomplete: true,
    enableCopyWidget: false,
    enableLineNumbers: false,
    languages: [],
};

const pluginSettingsFacet = Facet.define<PluginSettingsResponse, PluginSettingsResponse>({
    combine: (values) => values[0] ?? DEFAULT_SETTINGS,
});

const pluginSettingsCompartment = new Compartment();

export function getPluginSettings(state: EditorState): PluginSettingsResponse {
    return state.facet(pluginSettingsFacet);
}

function normalizeSettings(value: unknown): PluginSettingsResponse {
    if (
        value &&
        typeof value === 'object' &&
        typeof (value as PluginSettingsResponse).enableLanguageAutocomplete === 'boolean' &&
        typeof (value as PluginSettingsResponse).enableCopyWidget === 'boolean' &&
        typeof (value as PluginSettingsResponse).enableLineNumbers === 'boolean' &&
        Array.isArray((value as PluginSettingsResponse).languages)
    ) {
        return {
            enableLanguageAutocomplete: (value as PluginSettingsResponse).enableLanguageAutocomplete,
            enableCopyWidget: (value as PluginSettingsResponse).enableCopyWidget,
            enableLineNumbers: (value as PluginSettingsResponse).enableLineNumbers,
            languages: (value as PluginSettingsResponse).languages
                .filter((language): language is string => typeof language === 'string')
                .map((language) => language.trim())
                .filter((language) => language.length > 0),
        };
    }

    return DEFAULT_SETTINGS;
}

export function areSettingsEqual(a: PluginSettingsResponse, b: PluginSettingsResponse): boolean {
    return (
        a.enableLanguageAutocomplete === b.enableLanguageAutocomplete &&
        a.enableCopyWidget === b.enableCopyWidget &&
        a.enableLineNumbers === b.enableLineNumbers &&
        a.languages.length === b.languages.length &&
        a.languages.every((language, index) => language === b.languages[index])
    );
}

export function createSettingsExtension(): Extension {
    return pluginSettingsCompartment.of(pluginSettingsFacet.of(DEFAULT_SETTINGS));
}

export function applyPluginSettings(view: EditorView, settings: unknown): void {
    view.dispatch({
        effects: pluginSettingsCompartment.reconfigure(pluginSettingsFacet.of(normalizeSettings(settings))),
    });
}

export async function syncInitialSettings(context: PostMessageContext, codeMirror: CodeMirrorControl): Promise<void> {
    try {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Joplin's content script API, not window.postMessage
        const response = await context.postMessage({ command: 'getSettings' });
        const settings = normalizeSettings(response);

        applyPluginSettings(codeMirror.editor as EditorView, settings);
    } catch (error) {
        logger.error('Failed to fetch autocomplete settings:', error);
    }
}

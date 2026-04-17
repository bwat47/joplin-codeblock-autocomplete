/** Context provided by Joplin to content scripts */
export interface PluginContext {
    postMessage(message: unknown): Promise<unknown>;
}

export interface PluginSettingsResponse {
    enableLanguageAutocomplete: boolean;
    enableCopyWidget: boolean;
    languages: string[];
}

export const UPDATE_SETTINGS_COMMAND = 'updateCodeblockAutocompleteSettings';

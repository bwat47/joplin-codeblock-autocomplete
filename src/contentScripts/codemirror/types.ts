/** Narrow messaging contract used by content-script internals. */
export interface PostMessageContext {
    postMessage(message: unknown): Promise<unknown>;
}

export interface PluginSettingsResponse {
    enableLanguageAutocomplete: boolean;
    enableCopyWidget: boolean;
    languages: string[];
}

export const UPDATE_SETTINGS_COMMAND = 'updateCodeblockAutocompleteSettings';
export const INSERT_CODE_BLOCK_COMMAND = 'insertCodeblockAutocompleteBlock';

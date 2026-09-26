/** Narrow messaging contract used by content-script internals. */
export interface PostMessageContext {
    postMessage(message: unknown): Promise<unknown>;
}

export interface PluginSettingsResponse {
    enableLanguageAutocomplete: boolean;
    enableCopyWidget: boolean;
    enableCodeFolding: boolean;
    languages: string[];
}

export const UPDATE_SETTINGS_COMMAND = 'updateCodeblockAutocompleteSettings';
export const INSERT_CODE_BLOCK_COMMAND = 'insertCodeblockAutocompleteBlock';

/** Content-script messages for loading and saving a note's code block folds. */
export const GET_FOLD_STATE_COMMAND = 'getFoldState';
export const SAVE_FOLD_STATE_COMMAND = 'saveFoldState';

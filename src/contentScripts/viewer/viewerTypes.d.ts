/** Types for local access to Joplin's viewer environment; no global declarations. */
export type ViewerAssetController = {
    destroy(): void;
};

export type ViewerWindow = Window & {
    __codeblockAutocompleteViewerCopyController?: ViewerAssetController;
    __codeblockAutocompleteViewerLineNumbersController?: ViewerAssetController;
};

export type ViewerCopyMessage = {
    command: 'copyCodeBlock';
    text: string;
};

export type ViewerWebviewApi = {
    postMessage(contentScriptId: string, message: ViewerCopyMessage): Promise<unknown>;
};

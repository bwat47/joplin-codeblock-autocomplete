/** Globals shared by the classic browser assets loaded in Joplin's Markdown viewer. */
type ViewerAssetController = {
    destroy(): void;
};

interface Window {
    __codeblockAutocompleteViewerCopyController?: ViewerAssetController;
    __codeblockAutocompleteViewerLineNumbersController?: ViewerAssetController;
}

declare const webviewApi:
    | {
          postMessage(contentScriptId: string, message: { command: string; text: string }): Promise<unknown>;
      }
    | undefined;

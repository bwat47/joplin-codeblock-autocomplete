import { ToastType } from 'api/types';
import type { PluginSettingsResponse } from './contentScripts/codemirror/types';
import { UPDATE_SETTINGS_COMMAND } from './contentScripts/codemirror/types';

type MessageHandler = (message: unknown) => Promise<unknown>;
type SettingsChangeHandler = (event: { keys: string[] }) => void;

const mocks = vi.hoisted(() => ({
    joplin: {
        plugins: {
            register: vi.fn<(script: { onStart(): Promise<void> }) => Promise<void>>(),
        },
        contentScripts: {
            register: vi.fn(),
            onMessage: vi.fn<(scriptId: string, handler: MessageHandler) => Promise<void>>(),
        },
        commands: { register: vi.fn(), execute: vi.fn<() => Promise<unknown>>() },
        clipboard: { writeText: vi.fn<(text: string) => Promise<void>>() },
        views: {
            dialogs: { showToast: vi.fn<() => Promise<void>>() },
            menuItems: { create: vi.fn() },
            toolbarButtons: { create: vi.fn() },
        },
        settings: { onChange: vi.fn<(handler: SettingsChangeHandler) => Promise<void>>() },
    },
    registerSettings: vi.fn(),
    areCodeMirrorSettingsChanged: vi.fn<(keys: string[]) => boolean>(),
    getContentScriptSettings: vi.fn<() => Promise<PluginSettingsResponse>>(),
    logger: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock('api', () => ({ default: mocks.joplin }));
vi.mock('./settings', () => mocks);
vi.mock('./logger', () => ({ logger: mocks.logger }));

const CODE_MIRROR_SCRIPT_ID = 'codeBlockCompleter';
const VIEWER_SCRIPT_ID = 'codeblockAutocompleteViewer';

const SETTINGS: PluginSettingsResponse = {
    enableLanguageAutocomplete: true,
    enableCopyWidget: false,
    enableLineNumbers: false,
    languages: ['typescript'],
};

async function startPlugin(): Promise<void> {
    await import('./index');
    await mocks.joplin.plugins.register.mock.calls[0][0].onStart();
}

function getMessageHandler(scriptId: string): MessageHandler {
    const call = mocks.joplin.contentScripts.onMessage.mock.calls.find(([id]) => id === scriptId);
    if (!call) throw new Error(`No message handler registered for ${scriptId}`);
    return call[1];
}

function getSettingsChangeHandler(): SettingsChangeHandler {
    return mocks.joplin.settings.onChange.mock.calls[0][0];
}

beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.joplin.plugins.register.mockResolvedValue(undefined);
    mocks.joplin.settings.onChange.mockResolvedValue(undefined);
    mocks.joplin.commands.execute.mockResolvedValue(undefined);
    mocks.joplin.clipboard.writeText.mockResolvedValue(undefined);
    mocks.joplin.views.dialogs.showToast.mockResolvedValue(undefined);
    mocks.areCodeMirrorSettingsChanged.mockReturnValue(true);
    mocks.getContentScriptSettings.mockResolvedValue(SETTINGS);
    await startPlugin();
});

describe('settings changes', () => {
    it('pushes updated settings to the active editor', async () => {
        getSettingsChangeHandler()({ keys: ['editorSetting'] });
        await vi.waitFor(() => {
            expect(mocks.joplin.commands.execute).toHaveBeenCalledWith('editor.execCommand', {
                name: UPDATE_SETTINGS_COMMAND,
                args: [SETTINGS],
            });
        });
    });

    it('ignores changes to unrelated settings', () => {
        mocks.areCodeMirrorSettingsChanged.mockReturnValue(false);
        getSettingsChangeHandler()({ keys: ['unrelatedSetting'] });
        expect(mocks.getContentScriptSettings).not.toHaveBeenCalled();
        expect(mocks.joplin.commands.execute).not.toHaveBeenCalled();
    });

    it.each(['read', 'push'])('logs a failed settings %s', async (step) => {
        const error = new Error('settings unavailable');
        if (step === 'read') mocks.getContentScriptSettings.mockRejectedValueOnce(error);
        else mocks.joplin.commands.execute.mockRejectedValueOnce(error);

        getSettingsChangeHandler()({ keys: ['editorSetting'] });
        await vi.waitFor(() => {
            expect(mocks.logger.warn).toHaveBeenCalledWith(
                'Failed to push updated settings to the active editor.',
                error
            );
        });
    });
});

describe('content script messages', () => {
    it.each([CODE_MIRROR_SCRIPT_ID, VIEWER_SCRIPT_ID])(
        '%s ignores malformed and unknown messages',
        async (scriptId) => {
            const handleMessage = getMessageHandler(scriptId);
            for (const message of [null, 'copyCodeBlock', {}, { command: 1 }, { command: 'unknown' }]) {
                await expect(handleMessage(message)).resolves.toBeNull();
            }
        }
    );

    it('returns settings to the CodeMirror content script', async () => {
        await expect(getMessageHandler(CODE_MIRROR_SCRIPT_ID)({ command: 'getSettings' })).resolves.toEqual(SETTINGS);
    });

    it('does not return settings to the viewer content script', async () => {
        await expect(getMessageHandler(VIEWER_SCRIPT_ID)({ command: 'getSettings' })).resolves.toBeNull();
        expect(mocks.getContentScriptSettings).not.toHaveBeenCalled();
    });

    it.each([CODE_MIRROR_SCRIPT_ID, VIEWER_SCRIPT_ID])('%s copies code to the clipboard', async (scriptId) => {
        const result = await getMessageHandler(scriptId)({ command: 'copyCodeBlock', text: 'const x = 1;' });
        expect(result).toEqual({ ok: true });
        expect(mocks.joplin.clipboard.writeText).toHaveBeenCalledWith('const x = 1;');
        expect(mocks.joplin.views.dialogs.showToast).toHaveBeenCalledWith({
            message: 'Code copied to clipboard.',
            type: ToastType.Success,
        });
    });

    it('rejects copy requests without string text', async () => {
        const result = await getMessageHandler(CODE_MIRROR_SCRIPT_ID)({ command: 'copyCodeBlock', text: 42 });
        expect(result).toEqual({ ok: false });
        expect(mocks.joplin.clipboard.writeText).not.toHaveBeenCalled();
    });

    it('reports clipboard write failures', async () => {
        const error = new Error('clipboard unavailable');
        mocks.joplin.clipboard.writeText.mockRejectedValueOnce(error);
        const result = await getMessageHandler(CODE_MIRROR_SCRIPT_ID)({ command: 'copyCodeBlock', text: 'code' });
        expect(result).toEqual({ ok: false });
        expect(mocks.logger.error).toHaveBeenCalledWith('Failed to copy code block to the clipboard.', error);
        expect(mocks.joplin.views.dialogs.showToast).not.toHaveBeenCalled();
    });

    it('still reports success when the toast fails', async () => {
        const error = new Error('toast unavailable');
        mocks.joplin.views.dialogs.showToast.mockRejectedValueOnce(error);
        const result = await getMessageHandler(CODE_MIRROR_SCRIPT_ID)({ command: 'copyCodeBlock', text: 'code' });
        expect(result).toEqual({ ok: true });
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            'Code was copied, but the success toast could not be shown.',
            error
        );
    });
});

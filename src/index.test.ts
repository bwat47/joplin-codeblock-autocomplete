import type { PluginSettingsResponse } from './contentScripts/codemirror/types';
import { UPDATE_SETTINGS_COMMAND } from './contentScripts/codemirror/types';

const mocks = vi.hoisted(() => ({
    joplin: {
        plugins: {
            register: vi.fn<(script: { onStart(): Promise<void> }) => Promise<void>>(),
        },
        contentScripts: { register: vi.fn(), onMessage: vi.fn() },
        commands: { register: vi.fn(), execute: vi.fn<() => Promise<unknown>>() },
        views: { menuItems: { create: vi.fn() }, toolbarButtons: { create: vi.fn() } },
        settings: { onChange: vi.fn<(handler: (event: { keys: string[] }) => void) => Promise<void>>() },
    },
    registerSettings: vi.fn(),
    areCodeMirrorSettingsChanged: vi.fn<(keys: string[]) => boolean>(),
    getContentScriptSettings: vi.fn<() => Promise<PluginSettingsResponse>>(),
    logger: { warn: vi.fn(), error: vi.fn() },
}));

vi.mock('api', () => ({ default: mocks.joplin }));
vi.mock('./settings', () => mocks);
vi.mock('./logger', () => ({ logger: mocks.logger }));

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

beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.joplin.plugins.register.mockResolvedValue(undefined);
    mocks.joplin.settings.onChange.mockResolvedValue(undefined);
    mocks.joplin.commands.execute.mockResolvedValue(undefined);
    mocks.areCodeMirrorSettingsChanged.mockReturnValue(true);
    mocks.getContentScriptSettings.mockResolvedValue(SETTINGS);
});

it('logs plugin registration failures', async () => {
    const error = new Error('registration failed');
    mocks.joplin.plugins.register.mockRejectedValueOnce(error);
    await import('./index');
    expect(mocks.logger.error).toHaveBeenCalledWith('Failed to register the Codeblock Utils plugin.', error);
});

it('propagates settings listener registration failures through startup', async () => {
    const error = new Error('listener registration failed');
    mocks.joplin.settings.onChange.mockRejectedValueOnce(error);
    await expect(startPlugin()).rejects.toThrow(error);
});

it('pushes editor settings from a synchronous change callback', async () => {
    await startPlugin();
    const handler = mocks.joplin.settings.onChange.mock.calls[0][0];
    expect(handler({ keys: ['editorSetting'] })).toBeUndefined();
    await vi.waitFor(() => {
        expect(mocks.joplin.commands.execute).toHaveBeenCalledWith('editor.execCommand', {
            name: UPDATE_SETTINGS_COMMAND,
            args: [SETTINGS],
        });
    });
});

it.each(['read', 'push'])('logs a failed settings %s without rejecting the change callback', async (step) => {
    await startPlugin();
    const error = new Error('settings unavailable');
    if (step === 'read') mocks.getContentScriptSettings.mockRejectedValueOnce(error);
    else mocks.joplin.commands.execute.mockRejectedValueOnce(error);

    const handler = mocks.joplin.settings.onChange.mock.calls[0][0];
    expect(handler({ keys: ['editorSetting'] })).toBeUndefined();
    await vi.waitFor(() => {
        expect(mocks.logger.warn).toHaveBeenCalledWith('Failed to push updated settings to the active editor.', error);
    });
});

import { vi } from 'vitest';
import { SettingItemType, type SettingItem } from 'api/types';

const joplinMock = vi.hoisted(() => ({
    settings: {
        registerSection: vi.fn(async () => {}),
        registerSettings: vi.fn<(spec: Record<string, SettingItem>) => Promise<void>>(async () => {}),
        value: vi.fn(async () => ''),
        values: vi.fn<(keys: string[]) => Promise<Record<string, unknown>>>(async () => ({})),
    },
    versionInfo: vi.fn(async () => ({ platform: 'desktop' })),
}));

vi.mock('api', () => ({ default: joplinMock }));
vi.mock('./logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { areCodeMirrorSettingsChanged, registerSettings } from './settings';
import { SETTING_KEYS, SETTINGS_SECTION_ID } from './settingsKeys';

async function getRegisteredSettingsSpec(): Promise<Record<string, SettingItem>> {
    joplinMock.settings.registerSettings.mockClear();
    await registerSettings();

    const spec = joplinMock.settings.registerSettings.mock.calls[0]?.[0];
    if (!spec) throw new Error('Expected registerSettings to receive a settings spec.');
    return spec;
}

describe('areCodeMirrorSettingsChanged', () => {
    /**
     * The editor is the only consumer that needs settings pushed to it on
     * change, so every registered setting must be classified. Deriving the
     * editor key set from `SETTINGS_CONFIG.target` is what keeps a newly added
     * editor setting from silently failing to reach the open editor.
     */
    it('classifies every registered setting as editor, viewer, or internal', async () => {
        const registeredKeys = Object.keys(await getRegisteredSettingsSpec());
        const nonEditorKeys: string[] = [SETTING_KEYS.enableViewerCopyWidget, SETTING_KEYS.foldState];

        expect(registeredKeys.length).toBeGreaterThan(0);
        for (const key of registeredKeys) {
            expect(areCodeMirrorSettingsChanged([key])).toBe(!nonEditorKeys.includes(key));
        }
    });

    it('ignores the internal fold state, which only the main process uses', () => {
        expect(areCodeMirrorSettingsChanged([SETTING_KEYS.foldState])).toBe(false);
    });

    it('ignores the viewer setting, which the renderer reads for itself', () => {
        expect(areCodeMirrorSettingsChanged([SETTING_KEYS.enableViewerCopyWidget])).toBe(false);
    });

    it('ignores keys belonging to other plugins', () => {
        expect(areCodeMirrorSettingsChanged([])).toBe(false);
        expect(areCodeMirrorSettingsChanged(['someOtherPlugin.enableCopyWidget'])).toBe(false);
    });

    it('reports a change when any editor setting is among the changed keys', () => {
        expect(areCodeMirrorSettingsChanged([SETTING_KEYS.enableViewerCopyWidget, SETTING_KEYS.languages])).toBe(true);
    });
});

describe('registerSettings', () => {
    it('registers every configured setting in the plugin section, hiding internal ones', async () => {
        const spec = await getRegisteredSettingsSpec();

        expect(Object.keys(spec)).toEqual([
            SETTING_KEYS.enableLanguageAutocomplete,
            SETTING_KEYS.enableCopyWidget,
            SETTING_KEYS.enableCodeFolding,
            SETTING_KEYS.enableViewerCopyWidget,
            SETTING_KEYS.languages,
            SETTING_KEYS.foldState,
        ]);
        for (const [key, item] of Object.entries(spec)) {
            expect(item.section).toBe(SETTINGS_SECTION_ID);
            expect(item.public).toBe(key !== SETTING_KEYS.foldState);
            expect(item.label).toBeTruthy();
            expect(item.description).toBeTruthy();
        }
    });

    // The spec is built from `SETTINGS_CONFIG` rather than written out per
    // setting, so the stored type has to follow from the default value.
    it('derives the Joplin setting type from each default value', async () => {
        const spec = await getRegisteredSettingsSpec();

        expect(spec[SETTING_KEYS.enableLanguageAutocomplete]).toMatchObject({
            type: SettingItemType.Bool,
            value: true,
        });
        expect(spec[SETTING_KEYS.enableCopyWidget]).toMatchObject({ type: SettingItemType.Bool, value: false });
        expect(spec[SETTING_KEYS.enableCodeFolding]).toMatchObject({ type: SettingItemType.Bool, value: false });
        expect(spec[SETTING_KEYS.enableViewerCopyWidget]).toMatchObject({ type: SettingItemType.Bool, value: false });
        expect(spec[SETTING_KEYS.languages]).toMatchObject({ type: SettingItemType.String });
        expect(spec[SETTING_KEYS.languages].value).toContain('typescript');
    });
});

describe('desktop-only settings', () => {
    /** The platform is looked up once per module, so each platform needs a freshly loaded module. */
    async function loadSettingsFor(platform: 'desktop' | 'mobile'): Promise<typeof import('./settings')> {
        vi.resetModules();
        joplinMock.versionInfo.mockResolvedValue({ platform });
        return import('./settings');
    }

    async function registeredFoldingSetting(platform: 'desktop' | 'mobile'): Promise<SettingItem> {
        const settings = await loadSettingsFor(platform);
        joplinMock.settings.registerSettings.mockClear();
        await settings.registerSettings();
        const spec = joplinMock.settings.registerSettings.mock.calls[0]?.[0];
        if (!spec) throw new Error('Expected registerSettings to receive a settings spec.');
        return spec[SETTING_KEYS.enableCodeFolding];
    }

    async function codeFoldingEnabledOn(platform: 'desktop' | 'mobile'): Promise<boolean> {
        const settings = await loadSettingsFor(platform);
        joplinMock.settings.values.mockResolvedValue({
            [SETTING_KEYS.enableLanguageAutocomplete]: true,
            [SETTING_KEYS.enableCopyWidget]: false,
            [SETTING_KEYS.enableCodeFolding]: true,
            [SETTING_KEYS.languages]: 'js',
        });
        return (await settings.getContentScriptSettings()).enableCodeFolding;
    }

    it('shows code block folding on desktop', async () => {
        expect((await registeredFoldingSetting('desktop')).public).toBe(true);
    });

    it('hides code block folding on mobile', async () => {
        expect((await registeredFoldingSetting('mobile')).public).toBe(false);
    });

    it('keeps code block folding off on mobile even when it was enabled before', async () => {
        expect(await codeFoldingEnabledOn('desktop')).toBe(true);
        expect(await codeFoldingEnabledOn('mobile')).toBe(false);
    });
});

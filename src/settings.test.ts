import { vi } from 'vitest';
import { SettingItemType, type SettingItem } from 'api/types';

const joplinMock = vi.hoisted(() => ({
    settings: {
        registerSection: vi.fn(async () => {}),
        registerSettings: vi.fn<(spec: Record<string, SettingItem>) => Promise<void>>(async () => {}),
        value: vi.fn(async () => ''),
    },
}));

vi.mock('api', () => ({ default: joplinMock }));

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
    it('classifies every registered setting as either editor or viewer', async () => {
        const registeredKeys = Object.keys(await getRegisteredSettingsSpec());

        expect(registeredKeys.length).toBeGreaterThan(0);
        for (const key of registeredKeys) {
            const isViewerSetting = key === SETTING_KEYS.enableViewerCopyWidget;
            expect(areCodeMirrorSettingsChanged([key])).toBe(!isViewerSetting);
        }
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
    it('registers every configured setting as public in the plugin section', async () => {
        const spec = await getRegisteredSettingsSpec();

        expect(Object.keys(spec)).toEqual([
            SETTING_KEYS.enableLanguageAutocomplete,
            SETTING_KEYS.enableCopyWidget,
            SETTING_KEYS.enableViewerCopyWidget,
            SETTING_KEYS.languages,
        ]);
        for (const item of Object.values(spec)) {
            expect(item.section).toBe(SETTINGS_SECTION_ID);
            expect(item.public).toBe(true);
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
        expect(spec[SETTING_KEYS.enableViewerCopyWidget]).toMatchObject({ type: SettingItemType.Bool, value: false });
        expect(spec[SETTING_KEYS.languages]).toMatchObject({ type: SettingItemType.String });
        expect(spec[SETTING_KEYS.languages].value).toContain('typescript');
    });
});

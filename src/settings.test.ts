import { vi } from 'vitest';
import type { SettingItem } from 'api/types';

const joplinMock = vi.hoisted(() => ({
    settings: {
        registerSection: vi.fn(async () => {}),
        registerSettings: vi.fn<(spec: Record<string, SettingItem>) => Promise<void>>(async () => {}),
        value: vi.fn(async () => ''),
    },
}));

vi.mock('api', () => ({ default: joplinMock }));

import { areCodeMirrorSettingsChanged, registerSettings } from './settings';
import { SETTING_KEYS } from './settingsKeys';

async function getRegisteredSettingKeys(): Promise<string[]> {
    joplinMock.settings.registerSettings.mockClear();
    await registerSettings();

    const spec = joplinMock.settings.registerSettings.mock.calls[0]?.[0];
    if (!spec) throw new Error('Expected registerSettings to receive a settings spec.');
    return Object.keys(spec);
}

describe('areCodeMirrorSettingsChanged', () => {
    /**
     * The editor is the only consumer that needs settings pushed to it on
     * change, so every registered setting must be classified. Deriving the
     * editor key set from `SETTINGS_CONFIG.target` is what keeps a newly added
     * editor setting from silently failing to reach the open editor.
     */
    it('classifies every registered setting as either editor or viewer', async () => {
        const registeredKeys = await getRegisteredSettingKeys();

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

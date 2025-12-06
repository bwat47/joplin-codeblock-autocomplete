/**
 * Joplin settings registration for Codeblock Autocomplete plugin.
 *
 * Integrates plugin configuration into Joplin's preferences UI, allowing
 * users to customize plugin behavior through Settings > Codeblock Autocomplete.
 */

import joplin from 'api';
import { SettingItem, SettingItemType } from 'api/types';

const SECTION_ID = 'codeblockAutocomplete';

/** Default languages for code block autocompletion */
const DEFAULT_LANGUAGES =
    'javascript, typescript, python, bash, shell, html, css, sql, json, xml, yaml, markdown, c, cpp, csharp, java, go, rust, php, ruby, swift, kotlin';

const SETTINGS_CONFIG = {
    languages: {
        key: `${SECTION_ID}.languages`,
        defaultValue: DEFAULT_LANGUAGES,
        label: 'Autocomplete languages',
        description:
            'Comma-separated list of language identifiers to show in the autocomplete menu. The empty option (```) is always shown first.',
    },
} as const;

export type SettingsCache = {
    languages: string;
};

/**
 * Module-level settings cache for synchronous access
 */
export const settingsCache: SettingsCache = {
    languages: DEFAULT_LANGUAGES,
};

/**
 * Parses the languages setting into an array of language strings
 */
export function getLanguageList(): string[] {
    return settingsCache.languages
        .split(',')
        .map((lang) => lang.trim())
        .filter((lang) => lang.length > 0);
}

/**
 * Updates the settings cache by reading all values from Joplin settings
 */
async function updateSettingsCache(): Promise<void> {
    settingsCache.languages = await joplin.settings.value(SETTINGS_CONFIG.languages.key);
}

/**
 * Initializes the settings cache and registers change listener.
 * Must be called once during plugin initialization, after registerSettings().
 */
export async function initializeSettingsCache(): Promise<void> {
    await updateSettingsCache();

    joplin.settings.onChange(async (event) => {
        if (event.keys.includes(SETTINGS_CONFIG.languages.key)) {
            await updateSettingsCache();
        }
    });
}

export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SECTION_ID, {
        label: 'Codeblock Autocomplete',
        iconName: 'fas fa-code',
    });

    const settingsSpec: Record<string, SettingItem> = {
        [SETTINGS_CONFIG.languages.key]: {
            value: SETTINGS_CONFIG.languages.defaultValue,
            type: SettingItemType.String,
            section: SECTION_ID,
            public: true,
            label: SETTINGS_CONFIG.languages.label,
            description: SETTINGS_CONFIG.languages.description,
        },
    };

    await joplin.settings.registerSettings(settingsSpec);
}

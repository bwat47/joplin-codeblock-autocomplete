/**
 * Plugin settings registration and access helpers.
 */
import joplin from 'api';
import { SettingItem, SettingItemType } from 'api/types';

const SECTION_ID = 'codeblockAutocomplete';

const DEFAULT_LANGUAGES =
    'bash, c, clojure, cpp, csharp, css, dart, diff, dockerfile, elixir, elm, erlang, go, groovy, haskell, html, java, javascript, json, julia, kotlin, latex, lua, makefile, markdown, objective-c, ocaml, perl, php, powershell, python, r, ruby, rust, scala, shell, sql, swift, toml, txt, typescript, xml, yaml';

const SETTINGS_CONFIG = {
    enableLanguageAutocomplete: {
        key: `${SECTION_ID}.enableLanguageAutocomplete`,
        defaultValue: true,
        label: 'Enable language auto-complete',
        description: 'Enable auto-complete dropdown for code block languages.',
    },
    enableCopyWidget: {
        key: `${SECTION_ID}.enableCopyWidget`,
        defaultValue: false,
        label: 'Enable code block copy widget',
        description:
            'Show a copy button on fenced code blocks in the Markdown editor and hide the opening-fence language text when the cursor is not on that line.',
    },
    languages: {
        key: `${SECTION_ID}.languages`,
        defaultValue: DEFAULT_LANGUAGES,
        label: 'Autocomplete languages',
        description:
            'Comma-separated list of language identifiers to show in the autocomplete menu. The "No language" option is always shown first.',
    },
} as const;

export type ContentScriptSettings = {
    enableLanguageAutocomplete: boolean;
    enableCopyWidget: boolean;
    languages: string[];
};

const SETTINGS_KEYS = new Set<string>(Object.values(SETTINGS_CONFIG).map((setting) => setting.key));

function parseLanguageList(languages: string): string[] {
    return languages
        .split(',')
        .map((lang) => lang.trim())
        .filter((lang) => lang.length > 0);
}

/** Returns the current content-script settings directly from Joplin's settings store. */
export async function getContentScriptSettings(): Promise<ContentScriptSettings> {
    const [enableLanguageAutocomplete, enableCopyWidget, languages] = await Promise.all([
        joplin.settings.value(SETTINGS_CONFIG.enableLanguageAutocomplete.key),
        joplin.settings.value(SETTINGS_CONFIG.enableCopyWidget.key),
        joplin.settings.value(SETTINGS_CONFIG.languages.key),
    ]);

    return {
        enableLanguageAutocomplete,
        enableCopyWidget,
        languages: parseLanguageList(languages),
    };
}

export function arePluginSettingsChanged(keys: string[]): boolean {
    return keys.some((key) => SETTINGS_KEYS.has(key));
}

/** Registers plugin settings with Joplin */
export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SECTION_ID, {
        label: 'Codeblock Autocomplete',
        iconName: 'fas fa-code',
    });

    const settingsSpec: Record<string, SettingItem> = {
        [SETTINGS_CONFIG.enableLanguageAutocomplete.key]: {
            value: SETTINGS_CONFIG.enableLanguageAutocomplete.defaultValue,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: SETTINGS_CONFIG.enableLanguageAutocomplete.label,
            description: SETTINGS_CONFIG.enableLanguageAutocomplete.description,
        },
        [SETTINGS_CONFIG.enableCopyWidget.key]: {
            value: SETTINGS_CONFIG.enableCopyWidget.defaultValue,
            type: SettingItemType.Bool,
            section: SECTION_ID,
            public: true,
            label: SETTINGS_CONFIG.enableCopyWidget.label,
            description: SETTINGS_CONFIG.enableCopyWidget.description,
        },
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

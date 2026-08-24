/**
 * Plugin settings registration and access helpers.
 */
import joplin from 'api';
import { SettingItem, SettingItemType } from 'api/types';
import { SETTING_KEYS, SETTINGS_SECTION_ID } from './settingsKeys';

const DEFAULT_LANGUAGES =
    'bash, c, clojure, cpp, csharp, css, dart, diff, dockerfile, elixir, elm, erlang, go, groovy, haskell, html, java, javascript, json, julia, kotlin, latex, lua, makefile, markdown, objective-c, ocaml, perl, php, powershell, python, r, ruby, rust, scala, shell, sql, swift, toml, txt, typescript, xml, yaml';

/**
 * Which content script consumes a setting. The editor is pushed new values
 * explicitly on change, so it needs to know which keys concern it; the viewer
 * reads its own settings through Joplin's renderer options instead.
 */
type SettingTarget = 'editor' | 'viewer';

type SettingDefinition = {
    key: string;
    defaultValue: boolean | string;
    label: string;
    description: string;
    target: SettingTarget;
};

const SETTINGS_CONFIG = {
    enableLanguageAutocomplete: {
        key: SETTING_KEYS.enableLanguageAutocomplete,
        defaultValue: true,
        label: 'Enable language auto-complete',
        description: 'Enable auto-complete dropdown for code block languages.',
        target: 'editor',
    },
    enableCopyWidget: {
        key: SETTING_KEYS.enableCopyWidget,
        defaultValue: false,
        label: 'Enable code block copy widget',
        description:
            'Show a copy button on fenced code blocks in the Markdown editor and hide the opening-fence language text when the cursor is not on that line.',
        target: 'editor',
    },
    enableViewerCopyWidget: {
        key: SETTING_KEYS.enableViewerCopyWidget,
        defaultValue: false,
        label: 'Enable Markdown viewer copy widget',
        description: 'Show a copy button when hovering over fenced code blocks in the Markdown viewer.',
        target: 'viewer',
    },
    languages: {
        key: SETTING_KEYS.languages,
        defaultValue: DEFAULT_LANGUAGES,
        label: 'Autocomplete languages',
        description:
            'Comma-separated list of language identifiers to show in the autocomplete menu. The "No language" option is always shown first.',
        target: 'editor',
    },
} as const satisfies Record<string, SettingDefinition>;

export type ContentScriptSettings = {
    enableLanguageAutocomplete: boolean;
    enableCopyWidget: boolean;
    languages: string[];
};

const CODE_MIRROR_SETTINGS_KEYS = new Set<string>(
    Object.values(SETTINGS_CONFIG)
        .filter((setting) => setting.target === 'editor')
        .map((setting) => setting.key)
);

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

export function areCodeMirrorSettingsChanged(keys: string[]): boolean {
    return keys.some((key) => CODE_MIRROR_SETTINGS_KEYS.has(key));
}

/** Registers plugin settings with Joplin */
export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SETTINGS_SECTION_ID, {
        label: 'Codeblock Autocomplete',
        iconName: 'fas fa-code',
    });

    const settingsSpec: Record<string, SettingItem> = {
        [SETTINGS_CONFIG.enableLanguageAutocomplete.key]: {
            value: SETTINGS_CONFIG.enableLanguageAutocomplete.defaultValue,
            type: SettingItemType.Bool,
            section: SETTINGS_SECTION_ID,
            public: true,
            label: SETTINGS_CONFIG.enableLanguageAutocomplete.label,
            description: SETTINGS_CONFIG.enableLanguageAutocomplete.description,
        },
        [SETTINGS_CONFIG.enableCopyWidget.key]: {
            value: SETTINGS_CONFIG.enableCopyWidget.defaultValue,
            type: SettingItemType.Bool,
            section: SETTINGS_SECTION_ID,
            public: true,
            label: SETTINGS_CONFIG.enableCopyWidget.label,
            description: SETTINGS_CONFIG.enableCopyWidget.description,
        },
        [SETTINGS_CONFIG.enableViewerCopyWidget.key]: {
            value: SETTINGS_CONFIG.enableViewerCopyWidget.defaultValue,
            type: SettingItemType.Bool,
            section: SETTINGS_SECTION_ID,
            public: true,
            label: SETTINGS_CONFIG.enableViewerCopyWidget.label,
            description: SETTINGS_CONFIG.enableViewerCopyWidget.description,
        },
        [SETTINGS_CONFIG.languages.key]: {
            value: SETTINGS_CONFIG.languages.defaultValue,
            type: SettingItemType.String,
            section: SETTINGS_SECTION_ID,
            public: true,
            label: SETTINGS_CONFIG.languages.label,
            description: SETTINGS_CONFIG.languages.description,
        },
    };

    await joplin.settings.registerSettings(settingsSpec);
}

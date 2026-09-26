/**
 * Plugin settings registration and access helpers.
 */
import joplin from 'api';
import { SettingItem, SettingItemType } from 'api/types';
import { logger } from './logger';
import { SETTING_KEYS, SETTINGS_SECTION_ID } from './settingsKeys';

const DEFAULT_LANGUAGES =
    'bash, c, clojure, cpp, csharp, css, dart, diff, dockerfile, elixir, elm, erlang, go, groovy, haskell, html, java, javascript, json, julia, kotlin, latex, lua, makefile, markdown, objective-c, ocaml, perl, php, powershell, python, r, ruby, rust, scala, shell, sql, swift, toml, txt, typescript, xml, yaml';

/**
 * Which part of the plugin consumes a setting. The editor is pushed new values
 * explicitly on change, so it needs to know which keys concern it; the viewer
 * reads its own settings through Joplin's renderer options instead. Internal
 * settings are hidden storage owned by the main process.
 */
type SettingTarget = 'editor' | 'viewer' | 'internal';

type SettingDefinition = {
    key: string;
    defaultValue: boolean | string;
    label: string;
    description: string;
    target: SettingTarget;
    /** Hidden and treated as off on mobile, where the feature does not work reliably. */
    desktopOnly?: boolean;
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
        label: 'Enable Markdown editor copy widget',
        description:
            'Show a copy button on fenced code blocks in the Markdown editor and hide the opening-fence language text when the cursor is not on that line.',
        target: 'editor',
    },
    enableCodeFolding: {
        key: SETTING_KEYS.enableCodeFolding,
        defaultValue: false,
        label: 'Enable Markdown editor code block folding',
        description:
            'Show a fold arrow at the indentation of a line inside a fenced code block when hovering it, to fold the lines indented beneath it.',
        target: 'editor',
        desktopOnly: true,
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
    foldState: {
        key: SETTING_KEYS.foldState,
        defaultValue: '{}',
        label: 'Code block fold state',
        description: 'Internal storage for the folded code block lines of each note.',
        target: 'internal',
    },
} as const satisfies Record<string, SettingDefinition>;

export type ContentScriptSettings = {
    enableLanguageAutocomplete: boolean;
    enableCopyWidget: boolean;
    enableCodeFolding: boolean;
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

let mobilePlatform: Promise<boolean> | null = null;

/** Whether the plugin is running in Joplin mobile. Looked up once, since the platform cannot change. */
function isMobilePlatform(): Promise<boolean> {
    mobilePlatform ??= joplin
        .versionInfo()
        .then((info) => info.platform === 'mobile')
        .catch((error: unknown) => {
            logger.warn('Could not determine the Joplin platform; assuming desktop.', error);
            return false;
        });
    return mobilePlatform;
}

/**
 * Returns the current content-script settings directly from Joplin's settings
 * store. Joplin recommends `values()` over repeated `value()` calls: it reads
 * the whole batch over a single IPC round trip.
 */
export async function getContentScriptSettings(): Promise<ContentScriptSettings> {
    const isMobile = await isMobilePlatform();
    const values = await joplin.settings.values([
        SETTINGS_CONFIG.enableLanguageAutocomplete.key,
        SETTINGS_CONFIG.enableCopyWidget.key,
        SETTINGS_CONFIG.enableCodeFolding.key,
        SETTINGS_CONFIG.languages.key,
    ]);

    return {
        enableLanguageAutocomplete: values[SETTINGS_CONFIG.enableLanguageAutocomplete.key] as boolean,
        enableCopyWidget: values[SETTINGS_CONFIG.enableCopyWidget.key] as boolean,
        // A value stored before the setting was hidden on mobile must not keep folding enabled there.
        enableCodeFolding: !isMobile && (values[SETTINGS_CONFIG.enableCodeFolding.key] as boolean),
        languages: parseLanguageList(values[SETTINGS_CONFIG.languages.key] as string),
    };
}

export function areCodeMirrorSettingsChanged(keys: string[]): boolean {
    return keys.some((key) => CODE_MIRROR_SETTINGS_KEYS.has(key));
}

/**
 * Maps a default value onto the Joplin setting type that stores it. Deriving
 * this rather than declaring it per setting keeps the two from disagreeing.
 */
function settingItemType(defaultValue: SettingDefinition['defaultValue']): SettingItemType {
    switch (typeof defaultValue) {
        case 'boolean':
            return SettingItemType.Bool;
        case 'string':
            return SettingItemType.String;
        default: {
            // `defaultValue` narrows to `never` here, so widening the union in
            // `SettingDefinition` fails to compile rather than silently
            // registering the new kind of setting as a string.
            const unsupported: never = defaultValue;
            throw new Error(`Unsupported setting default value: ${String(unsupported)}`);
        }
    }
}

/** Registers plugin settings with Joplin */
export async function registerSettings(): Promise<void> {
    await joplin.settings.registerSection(SETTINGS_SECTION_ID, {
        label: 'Codeblock Autocomplete',
        iconName: 'fas fa-code',
    });

    const isMobile = await isMobilePlatform();
    const isPublic = (setting: SettingDefinition): boolean =>
        setting.target !== 'internal' && !(isMobile && setting.desktopOnly);

    const settingsSpec: Record<string, SettingItem> = Object.fromEntries(
        Object.values(SETTINGS_CONFIG).map((setting) => [
            setting.key,
            {
                value: setting.defaultValue,
                type: settingItemType(setting.defaultValue),
                section: SETTINGS_SECTION_ID,
                public: isPublic(setting),
                label: setting.label,
                description: setting.description,
            },
        ])
    );

    await joplin.settings.registerSettings(settingsSpec);
}

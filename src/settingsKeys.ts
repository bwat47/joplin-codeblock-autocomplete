export const SETTINGS_SECTION_ID = 'codeblockAutocomplete';

export const SETTING_KEYS = {
    enableLanguageAutocomplete: `${SETTINGS_SECTION_ID}.enableLanguageAutocomplete`,
    enableCopyWidget: `${SETTINGS_SECTION_ID}.enableCopyWidget`,
    enableLineNumbers: `${SETTINGS_SECTION_ID}.enableLineNumbers`,
    enableViewerLineNumbers: `${SETTINGS_SECTION_ID}.enableViewerLineNumbers`,
    enableViewerCopyWidget: `${SETTINGS_SECTION_ID}.enableViewerCopyWidget`,
    languages: `${SETTINGS_SECTION_ID}.languages`,
} as const;

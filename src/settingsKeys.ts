export const SETTINGS_SECTION_ID = 'codeblockAutocomplete';

export const SETTING_KEYS = {
    enableLanguageAutocomplete: `${SETTINGS_SECTION_ID}.enableLanguageAutocomplete`,
    enableCopyWidget: `${SETTINGS_SECTION_ID}.enableCopyWidget`,
    enableLineNumbers: `${SETTINGS_SECTION_ID}.enableLineNumbers`,
    enableViewerCopyWidget: `${SETTINGS_SECTION_ID}.enableViewerCopyWidget`,
    enableViewerLineNumbers: `${SETTINGS_SECTION_ID}.enableViewerLineNumbers`,
    languages: `${SETTINGS_SECTION_ID}.languages`,
} as const;

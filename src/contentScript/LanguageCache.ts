import { PluginContext, PluginSettingsResponse } from './types';
import { logger } from '../logger';

/**
 * Manages fetching and caching of plugin settings used by the editor integration.
 */
export class LanguageCache {
    private static instance: LanguageCache;
    private settings: PluginSettingsResponse = {
        enableLanguageAutocomplete: true,
        languages: [],
    };
    private hasFetched = false;
    private context: PluginContext;

    private constructor(context: PluginContext) {
        this.context = context;
    }

    /**
     * Get the singleton instance of LanguageCache.
     * Note: Context is only used for initialization on the first call.
     */
    public static getInstance(context: PluginContext): LanguageCache {
        if (!LanguageCache.instance) {
            LanguageCache.instance = new LanguageCache(context);
        }
        return LanguageCache.instance;
    }

    /**
     * Returns cached settings.
     * Fetches from the main process on first call, then returns cached values.
     * Triggers a background refresh to keep sync with settings changes.
     */
    public async getSettings(): Promise<PluginSettingsResponse> {
        if (this.hasFetched) {
            // Return immediately, but trigger a background refresh to handle setting changes
            // We use void to fire-and-forget the promise to avoid blocking the UI
            void this.refresh();
            return this.settings;
        }

        return this.refresh();
    }

    public async getLanguages(): Promise<string[]> {
        return (await this.getSettings()).languages;
    }

    public isLanguageAutocompleteEnabled(): boolean {
        void this.getSettings();
        return this.settings.enableLanguageAutocomplete;
    }

    /**
     * Forces a refresh of settings from the main process.
     */
    private async refresh(): Promise<PluginSettingsResponse> {
        try {
            const response = (await this.context.postMessage({
                command: 'getSettings',
            })) as PluginSettingsResponse | null;

            if (response && Array.isArray(response.languages)) {
                this.settings = response;
                this.hasFetched = true;
            }
        } catch (error) {
            logger.error('Failed to fetch autocomplete settings:', error);
        }

        return this.settings;
    }
}

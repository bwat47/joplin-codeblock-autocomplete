import { PluginContext } from './types';
import { logger } from '../logger';

/**
 * Manages fetching and caching of language options for autocomplete.
 */
export class LanguageCache {
    private static instance: LanguageCache;
    private languages: string[] = [];
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
     * Returns the list of languages.
     * Fetches from settings on first call, then returns cached version.
     * Triggers a background refresh to keep sync with settings changes.
     */
    public async getLanguages(): Promise<string[]> {
        if (this.hasFetched) {
            // Return immediately, but trigger a background refresh to handle setting changes
            // We use void to fire-and-forget the promise prevents blocking the UI
            void this.refresh();
            return this.languages;
        }

        return this.refresh();
    }

    /**
     * Forces a refresh of the language list from the main process.
     */
    private async refresh(): Promise<string[]> {
        try {
            const response = (await this.context.postMessage({ command: 'getLanguages' })) as {
                languages: string[];
            } | null;

            if (response?.languages) {
                this.languages = response.languages;
                this.hasFetched = true;
            }
        } catch (error) {
            logger.error('Failed to fetch languages:', error);
        }

        return this.languages;
    }
}

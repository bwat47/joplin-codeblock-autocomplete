import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: [
            {
                find: /^api$/,
                replacement: fileURLToPath(new URL('./api/index.ts', import.meta.url)),
            },
            {
                find: /^api\/(.*)$/,
                replacement: `${fileURLToPath(new URL('./api/', import.meta.url))}$1`,
            },
        ],
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.test.ts'],
        passWithNoTests: true,
    },
});

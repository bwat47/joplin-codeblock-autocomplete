/** @type {import('jest').Config} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'jsdom',
    roots: ['<rootDir>/src'],
    testMatch: ['**/*.test.ts'],
    moduleNameMapper: {
        '^api$': '<rootDir>/api/index.ts',
        '^api/(.*)$': '<rootDir>/api/$1',
    },
};

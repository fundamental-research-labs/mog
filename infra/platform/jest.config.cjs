const preset = require('../../jest.preset.cjs');

module.exports = {
  ...preset,
  testEnvironment: 'jsdom',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: [...preset.testPathIgnorePatterns, '<rootDir>/memory/'],
  setupFiles: ['<rootDir>/jest.polyfills.cjs'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
};

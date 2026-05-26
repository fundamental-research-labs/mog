const preset = require('../../../jest.preset.cjs');

module.exports = {
  ...preset,
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts'],
};

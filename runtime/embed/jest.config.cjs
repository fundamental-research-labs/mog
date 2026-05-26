const preset = require('../../jest.preset.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: './tsconfig.json',
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  testTimeout: 15000,
  forceExit: true,
};

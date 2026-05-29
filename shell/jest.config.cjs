const preset = require('../jest.preset.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          jsx: 'react-jsx',
        },
      },
    ],
  },
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    '^@mog-sdk/kernel/app-api$': '<rootDir>/../kernel/src/api/app/index.ts',
    '\\.svg\\?react$': '<rootDir>/__mocks__/svg-mock.js',
  },
};

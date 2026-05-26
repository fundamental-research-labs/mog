const preset = require('../../jest.preset.cjs');

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
  setupFilesAfterEnv: ['@testing-library/jest-dom', '<rootDir>/jest.setup.cjs'],
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    '^@mog/shell$': '<rootDir>/__mocks__/shell-mock.ts',
    '\\.svg\\?react$': '<rootDir>/__mocks__/svg-react-mock.mjs',
    '\\.svg$': '<rootDir>/__mocks__/svg-react-mock.mjs',
    '\\.css\\?inline$': '<rootDir>/__mocks__/css-inline-mock.js',
    '\\.(css|less|scss|sass)$': '<rootDir>/__mocks__/style-mock.js',
  },
};

const preset = require('../jest.preset.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    // Mock napi-loader to avoid import.meta.url (ESM-only) in Jest CJS mode.
    // Required by SDK conformance tests that boot the full document lifecycle.
    '.*napi-loader.*': '<rootDir>/__mocks__/napi-loader-mock.mjs',
    // Mock @mog/env to avoid import.meta.env (Vite-injected) syntax error in CJS.
    '^@mog/env$': '<rootDir>/__mocks__/env-mock.mjs',
    // Redirect @mog/transport to the napi-capable entry (index.ts) instead of
    // the browser entry (index.browser.ts) that only supports WASM. SDK
    // conformance tests need NAPI transport for headless document creation.
    '^@mog/transport$': '<rootDir>/../infra/transport/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: './tsconfig.json',
      },
    ],
  },
  setupFiles: ['<rootDir>/src/api/document/__tests__/sdk-conformance/setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // SDK conformance tests boot the full kernel stack — give them time
  testTimeout: 30000,
};

const preset = require('../../jest.preset.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...preset,
  moduleNameMapper: {
    ...preset.moduleNameMapper,
    // Mock napi-loader to avoid import.meta.url (ESM-only) in Jest CJS mode
    '.*napi-loader.*': '<rootDir>/__mocks__/napi-loader-mock.js',
    '^@mog-sdk/chart-raster-wasm$':
      '<rootDir>/../../compute/chart-render-wasm/npm/compute_chart_render_wasm.js',
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
  setupFiles: ['<rootDir>/__tests__/setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Headless tests boot the full kernel stack — give them time
  testTimeout: 30000,
  // Force exit after tests complete — the kernel's async lifecycle (ydoc observers,
  // schema bridge timers) can leave dangling handles after engine.dispose(). This is
  // safe because each test fully disposes its engine before completion.
  forceExit: true,
};

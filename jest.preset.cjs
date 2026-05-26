// jest.preset.cjs
//
// Shared Jest preset for the Mog workspace. Every package's `jest.config.cjs`
// spreads this preset and adds only local overrides (jsdom environment, svg
// mocks, tsconfig overrides, etc.).
//
// Module resolution for @mog/* siblings is handled by each package's
// conditional exports in its own package.json (development → src/*.ts).
// Jest's resolver honors the `development` condition below, so no
// jest.paths.cjs spread is needed.

/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node', // default; packages can override (e.g. jsdom)
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testEnvironmentOptions: {
    // Route workspace `@mog/*` imports through the `development` conditional
    // export (→ src/*.ts, which ts-jest then transforms). Without this,
    // Jest's resolver falls through to `import` and picks up `dist/*.js`.
    customExportConditions: ['development'],
  },
  moduleNameMapper: {
    // Strip the `.js` extension that ts-jest's ESM presets require on
    // relative imports. Per-package configs can spread this map and add
    // their own asset / virtual-module mocks.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        // Per-package tsconfig overrides live in the package's local config.
      },
    ],
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  roots: ['<rootDir>'],
  // With `tsc -b` now emitting `dist/*.js` into each composite package, Jest's
  // haste-map would pick up duplicate manual mocks (src/__mocks__/foo.ts and
  // the emitted dist/__mocks__/foo.js). Ignore `dist/` uniformly so Jest only
  // sees the TypeScript source. Per-package configs that also want to ignore
  // other paths should spread this array in their own override.
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/'],
};

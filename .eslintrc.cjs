/**
 * Workspace-wide ESLint config for workspace boundary guards.
 *
 * The single load-bearing rule here is `import/no-relative-packages`, which
 * understands the pnpm workspace graph natively and flags any relative
 * import that crosses a `package.json` boundary. This is the structural
 * enforcement that replaces older glob bans.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import', 'mog'],
  settings: {
    'import/resolver': {
      typescript: {
        project: ['./tsconfig.json'],
        alwaysTryTypes: true,
      },
      node: true,
    },
  },
  rules: {
    'import/no-relative-packages': 'error',
    'mog/import-boundaries': 'error',
  },
  overrides: [
    {
      // kernel-host-internal is a workspace-private bridge that wraps selected
      // kernel lifecycle internals without adding public @mog-sdk/kernel exports.
      files: ['kernel/host-internal/src/**/*.{ts,tsx}'],
      rules: {
        'import/no-relative-packages': 'off',
      },
    },
    {
      // Turbopack resolves the "development" export condition to raw .ts source.
      // .js extensions in relative imports break because no literal .js exists —
      // use extensionless imports instead (both webpack and turbopack handle them).
      //
      // Only enforced in packages that turbopack actually bundles. Node-only
      // Node-only packages require .js extensions
      // per the Node.js ESM spec — do NOT add them here.
      files: [
        'apps/spreadsheet/src/**/*.{ts,tsx}',
        'shell/src/**/*.{ts,tsx}',
        'canvas/**/*.{ts,tsx}',
        'charts/**/*.{ts,tsx}',
        'contracts/**/*.{ts,tsx}',
        'infra/**/*.{ts,tsx}',
        'kernel/**/*.{ts,tsx}',
        'table-engine/**/*.{ts,tsx}',
        'types/**/*.{ts,tsx}',
        'typeset/**/*.{ts,tsx}',
        'ui/**/*.{ts,tsx}',
        'views/**/*.{ts,tsx}',
        'spreadsheet-utils/**/*.{ts,tsx}',
        'file-io/**/*.{ts,tsx}',
      ],
      rules: {
        'mog/no-js-extension-imports': 'error',
      },
    },
    {
      // Ban raw import.meta.env — must use @mog/env (getEnvVar, isDev, isProd)
      files: ['**/*.{ts,tsx}'],
      excludedFiles: ['infra/env/src/index.ts', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: 'MemberExpression[property.name="env"] > MetaProperty',
            message: 'Use @mog/env (getEnvVar, isDev, isProd) instead of import.meta.env.',
          },
        ],
      },
    },
    {
      // Ban .svg?react imports — must use @mog/icons
      files: ['**/*.{ts,tsx}'],
      excludedFiles: ['infra/icons/src/index.ts'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['*.svg?react', '**/*.svg?react'],
                message: 'Import icons from @mog/icons instead of .svg?react imports.',
              },
            ],
          },
        ],
      },
    },
  ],
  ignorePatterns: [
    'node_modules',
    'dist',
    'build',
    'out',
    'output',
    '.next',
    'coverage',
    '**/*.gen.ts',
    '**/*.gen.tsx',
  ],
};

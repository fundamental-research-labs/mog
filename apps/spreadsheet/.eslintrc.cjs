/**
 * apps/spreadsheet ESLint config.
 *
 * Inherits the workspace-wide rules from `<root>/.eslintrc.cjs` and adds:
 *
 * - `mog/no-mirror-bypass-in-hooks` for files under `src/hooks/**` only.
 *
 * The `mog` plugin is provided by the local workspace package
 * `tools/eslint-plugin-mog` (pulled in via `eslint-plugin-mog: workspace:*`).
 */
module.exports = {
  root: false,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  plugins: ['mog'],
  rules: {},
  overrides: [
    {
      files: ['src/hooks/**/*.ts', 'src/hooks/**/*.tsx'],
      rules: {
        'mog/no-mirror-bypass-in-hooks': 'error',
      },
    },
  ],
};

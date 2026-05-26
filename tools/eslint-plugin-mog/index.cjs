/**
 * Local ESLint plugin: `eslint-plugin-mog`.
 *
 * Packaged as a private workspace package (`tools/eslint-plugin-mog`) so
 * `.eslintrc.cjs` can reference rules via `mog/<rule-name>` the same way
 * any third-party plugin would. Consumers add `eslint-plugin-mog` to
 * their `devDependencies` (workspace:*) and list `'mog'` under `plugins`
 * in their eslintrc.
 *
 * Rules:
 *   - `mog/no-mirror-bypass-in-hooks` — kernel state mirror guard.
 *     Blocks the `useState(default) + useEffect(async ws.*)`
 *     anti-pattern in `apps/spreadsheet/src/hooks/`.
 */

'use strict';

module.exports = {
  rules: {
    'no-mirror-bypass-in-hooks': require('./no-mirror-bypass-in-hooks.cjs'),
    'no-js-extension-imports': require('./no-js-extension-imports.cjs'),
    'import-boundaries': require('./import-boundaries.cjs'),
  },
};

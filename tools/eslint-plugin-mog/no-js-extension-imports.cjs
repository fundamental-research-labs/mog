/**
 * ESLint rule: no-js-extension-imports
 *
 * Bans `.js`, `.mjs`, and `.cjs` extensions in relative imports within mog
 * source files.
 *
 * Why: Turbopack resolves the "development" export condition in mog
 * package.json files, which points to raw .ts source. When those source
 * files import siblings using .js extensions (standard TypeScript ESM
 * convention), turbopack fails because no literal .js file exists in src/ —
 * only .ts files. Webpack handles this via extensionAlias, but turbopack
 * has no equivalent. Extensionless imports work fine in both bundlers.
 */

'use strict';

const JS_EXT_RE = /\.(js|mjs|cjs)$/;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow .js/.mjs/.cjs extensions in relative imports (breaks turbopack)',
    },
    fixable: 'code',
    schema: [],
    messages: {
      noJsExt:
        'Relative import "{{source}}" uses a .js extension. Remove it — turbopack cannot resolve .js to .ts in raw source files.',
    },
  },

  create(context) {
    function check(node) {
      const source = node.source;
      if (!source || typeof source.value !== 'string') return;

      const value = source.value;
      if (!value.startsWith('.')) return;
      if (!JS_EXT_RE.test(value)) return;

      context.report({
        node: source,
        messageId: 'noJsExt',
        data: { source: value },
        fix(fixer) {
          const fixed = value.replace(JS_EXT_RE, '');
          return fixer.replaceText(source, `'${fixed}'`);
        },
      });
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

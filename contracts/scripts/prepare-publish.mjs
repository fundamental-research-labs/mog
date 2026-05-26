/**
 * Transforms package.json exports for npm publishing.
 *
 * The in-repo `exports` map uses conditional entries:
 *   { development: './src/foo.ts', types: './dist/foo.d.ts', import: './dist/foo.js' }
 * The `development` condition lets workspace consumers read source directly
 * (via jest/vite `customExportConditions: ['development']`) while published
 * consumers resolve through `types`/`import` to the compiled output.
 *
 * This script generates a `publishConfig.exports` map that strips the
 * `development` condition so external consumers never see (and never
 * try to resolve) `./src/` paths — the published tarball only ships `dist/`.
 *
 * Idempotent — running twice produces the same result.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = join(__dirname, '..', 'package.json');

const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

/**
 * Resolve the dev-side source path (`./src/...ts`) from an export value.
 * Prefers the modern conditional shape (`value.development`), falling back
 * to `value.default` / `value.types` for legacy single-path entries.
 * Returns null if no usable path exists (caller should skip+warn).
 */
function resolveDevSrcPath(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  return value.development || value.default || value.types || null;
}

/**
 * Transform a source path like ./src/foo/bar.ts into a dist declaration path
 * like ./dist/foo/bar.d.ts
 */
function toDistPath(srcPath, extension) {
  // ./src/foo/bar.ts → ./dist/foo/bar.d.ts
  // ./src/foo/bar/index.ts → ./dist/foo/bar/index.d.ts
  if (!srcPath.startsWith('./src/')) {
    throw new Error(`Unexpected export path: ${srcPath}`);
  }
  const withoutSrc = srcPath.slice('./src/'.length);
  const withoutExt = withoutSrc.replace(/\.ts$/, '');
  return `./dist/${withoutExt}.${extension}`;
}

// Build publishConfig exports from the development exports
const publishExports = {};

for (const [key, value] of Object.entries(pkg.exports)) {
  const srcPath = resolveDevSrcPath(value);
  if (!srcPath) {
    console.warn(`Skipping export "${key}" — no resolvable path`);
    continue;
  }
  const dtsPath = toDistPath(srcPath, 'd.ts');
  const jsPath = toDistPath(srcPath, 'js');
  publishExports[key] = {
    types: dtsPath,
    import: jsPath,
  };
}

// Determine the root entry point declaration path
const rootSrcPath = resolveDevSrcPath(pkg.exports['.']);
const rootDtsPath = rootSrcPath ? toDistPath(rootSrcPath, 'd.ts') : './dist/index.d.ts';
const rootJsPath = rootSrcPath ? toDistPath(rootSrcPath, 'js') : './dist/index.js';

// Set publishConfig (merging with any existing publishConfig)
pkg.publishConfig = {
  ...pkg.publishConfig,
  access: 'public',
  main: rootJsPath,
  types: rootDtsPath,
  exports: publishExports,
};

writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');

console.log(`Updated publishConfig with ${Object.keys(publishExports).length} export entries.`);
console.log(`Root types: ${rootDtsPath}`);
console.log(`Root import: ${rootJsPath}`);

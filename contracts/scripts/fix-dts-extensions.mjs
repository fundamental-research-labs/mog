/**
 * Post-build script: adds `.js` extensions to relative import/export specifiers
 * in compiled `.d.ts` and `.js` files, required for NodeNext/ESM consumers.
 *
 * Handles two cases:
 *   - File imports:      '../cells/rich-text' → '../cells/rich-text.js'
 *   - Directory imports:  '../core'           → '../core/index.js'
 *     (when ../core is a directory with index.d.ts)
 */

import { statSync } from 'node:fs';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

/** Recursively collect declaration/runtime files that contain ESM specifiers. */
async function collectImportSpecifierFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectImportSpecifierFiles(full)));
    } else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Regex that matches relative specifiers in:
 *   - export * from './foo'
 *   - export { X } from './foo'
 *   - import { X } from './foo'
 *   - import type { X } from './foo'
 *   - export { X } from './foo'
 *   - import('./foo')
 *
 * Captures:
 *   group 1: the prefix (e.g. `from '` or `import('`)
 *   group 2: the specifier (e.g. `./foo` or `../bar/baz`)
 *   group 3: the suffix (e.g. `'` or `')`)
 */
const SPECIFIER_RE = /((?:from\s+|import\s*\()['"])(\.[^'"]+)(['"])/g;

/**
 * Pre-compute a set of directory paths in dist that contain index.d.ts.
 * Used to decide between `./foo.js` vs `./foo/index.js`.
 */
async function buildDirIndex() {
  const dirs = new Set();
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const full = join(dir, entry.name);
        // Check if this directory has an index.d.ts
        try {
          const st = await stat(join(full, 'index.d.ts'));
          if (st.isFile()) dirs.add(full);
        } catch {
          /* no index.d.ts */
        }
        await walk(full);
      }
    }
  }
  await walk(DIST);
  return dirs;
}

function createSpecifierFixer(dirsWithIndex) {
  return function fixSpecifiers(content, filePath) {
    const fileDir = dirname(filePath);
    return content.replace(SPECIFIER_RE, (_match, prefix, specifier, suffix) => {
      // Already has an extension — don't touch
      if (
        specifier.endsWith('.js') ||
        specifier.endsWith('.mjs') ||
        specifier.endsWith('.cjs') ||
        specifier.endsWith('.json')
      ) {
        return `${prefix}${specifier}${suffix}`;
      }
      // Resolve the specifier to an absolute path to check if it's a directory
      const resolved = resolve(fileDir, specifier);
      for (const extension of ['.d.ts', '.d.mts', '.d.cts', '.js', '.mjs', '.cjs']) {
        try {
          const st = statSync(`${resolved}${extension}`);
          if (st.isFile()) {
            return `${prefix}${specifier}${runtimeExtensionFor(extension)}${suffix}`;
          }
        } catch {
          // No exact file match for this extension.
        }
      }
      if (dirsWithIndex.has(resolved)) {
        // It's a directory with index.d.ts → append /index.js
        return `${prefix}${specifier}/index.js${suffix}`;
      }
      // It's a file → append .js
      return `${prefix}${specifier}.js${suffix}`;
    });
  };
}

function runtimeExtensionFor(declarationOrRuntimeExtension) {
  switch (declarationOrRuntimeExtension) {
    case '.d.mts':
    case '.mjs':
      return '.mjs';
    case '.d.cts':
    case '.cjs':
      return '.cjs';
    default:
      return '.js';
  }
}

async function main() {
  const dirsWithIndex = await buildDirIndex();
  const fixSpecifiers = createSpecifierFixer(dirsWithIndex);
  const files = await collectImportSpecifierFiles(DIST);
  let changed = 0;
  for (const file of files) {
    const original = await readFile(file, 'utf8');
    const fixed = fixSpecifiers(original, file);
    if (fixed !== original) {
      await writeFile(file, fixed, 'utf8');
      changed++;
    }
  }
  console.log(
    `fix-dts-extensions: processed ${files.length} files, fixed ${changed} (${dirsWithIndex.size} index dirs)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

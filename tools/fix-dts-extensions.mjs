#!/usr/bin/env node

import { statSync } from 'node:fs';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error('Usage: node tools/fix-dts-extensions.mjs <dist-dir> [dist-dir...]');
  process.exit(1);
}

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (
      entry.name.endsWith('.d.ts') ||
      entry.name.endsWith('.d.cts') ||
      entry.name.endsWith('.d.mts')
    ) {
      files.push(full);
    }
  }
  return files;
}

async function buildDirIndex(root) {
  const dirs = new Set();
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      try {
        const st = await stat(join(full, 'index.d.ts'));
        if (st.isFile()) dirs.add(full);
      } catch {
        // no index.d.ts
      }
      await walk(full);
    }
  }
  await walk(root);
  return dirs;
}

const SPECIFIER_RE = /((?:from\s+|import\s*\()['"])(\.[^'"]+)(['"])/g;

function fixSpecifiers(content, filePath, dirsWithIndex) {
  const fileDir = dirname(filePath);
  return content.replace(SPECIFIER_RE, (_match, prefix, specifier, suffix) => {
    if (/\.(?:js|mjs|cjs|json|d\.ts|d\.mts|d\.cts)$/.test(specifier)) {
      return `${prefix}${specifier}${suffix}`;
    }
    const resolved = resolve(fileDir, specifier);
    for (const extension of ['.d.ts', '.d.mts', '.d.cts', '.js', '.mjs', '.cjs']) {
      try {
        const st = statSync(`${resolved}${extension}`);
        if (st.isFile()) return `${prefix}${specifier}${runtimeExtensionFor(extension)}${suffix}`;
      } catch {
        // No exact file match for this extension.
      }
    }
    if (dirsWithIndex.has(resolved)) {
      return `${prefix}${specifier}/index.js${suffix}`;
    }
    return `${prefix}${specifier}.js${suffix}`;
  });
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

let total = 0;
let changed = 0;
for (const rootArg of roots) {
  const root = resolve(rootArg);
  const dirsWithIndex = await buildDirIndex(root);
  const files = await collectFiles(root);
  total += files.length;
  for (const file of files) {
    const original = await readFile(file, 'utf8');
    const fixed = fixSpecifiers(original, file, dirsWithIndex);
    if (fixed !== original) {
      await writeFile(file, fixed, 'utf8');
      changed++;
    }
  }
}

console.log(`fix-dts-extensions: processed ${total} files, fixed ${changed}`);

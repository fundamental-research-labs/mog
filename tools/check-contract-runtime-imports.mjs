#!/usr/bin/env node

/**
 * Runtime self-containment gate for the canonical contracts package.
 *
 * The public @mog-sdk/contracts package may use private shards as build inputs,
 * but compiled runtime artifacts must not import private workspace packages.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONTRACTS_DIR = resolve(ROOT, 'contracts');
const DIST_DIR = resolve(CONTRACTS_DIR, 'dist');

const FORBIDDEN_RUNTIME_IMPORTS = [
  /^@mog-sdk\/spreadsheet-contracts(?:\/.*)?$/,
  /^@mog-sdk\/types-[^/]+(?:\/.*)?$/,
  /^@mog\/types-[^/]+(?:\/.*)?$/,
  /^@mog\/(?!spreadsheet$).+/,
  /^@rust-bridge\/.+/,
];

function walkFiles(dir, predicate) {
  const results = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath, predicate));
    } else if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}

function collectRuntimeSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }

  return [...new Set(specifiers)].sort();
}

function lineForSpecifier(source, specifier) {
  const index = source.indexOf(specifier);
  if (index < 0) return 1;
  return source.slice(0, index).split('\n').length;
}

function isForbidden(specifier) {
  return FORBIDDEN_RUNTIME_IMPORTS.some((pattern) => pattern.test(specifier));
}

function main() {
  const manifestPath = resolve(CONTRACTS_DIR, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const files = walkFiles(DIST_DIR, (filePath) => /\.(?:js|mjs|cjs)$/.test(filePath));
  let failureCount = 0;

  if (files.length === 0) {
    console.error(`MISSING: ${relative(ROOT, DIST_DIR)} contains no runtime JavaScript files.`);
    process.exit(1);
  }

  for (const filePath of files) {
    const source = readFileSync(filePath, 'utf-8');
    for (const specifier of collectRuntimeSpecifiers(source)) {
      if (!isForbidden(specifier)) continue;
      console.error(
        `RUNTIME-IMPORT: ${relative(ROOT, filePath)}:${lineForSpecifier(source, specifier)}: forbidden runtime import ${specifier}`,
      );
      failureCount += 1;
    }
  }

  if (failureCount > 0) {
    console.error(
      `\ncheck:contract-runtime-imports FAILED — ${failureCount} forbidden runtime import(s) in ${manifest.name}.`,
    );
    process.exit(1);
  }

  console.log(
    `check:contract-runtime-imports PASSED — ${manifest.name} runtime artifacts are self-contained.`,
  );
}

main();

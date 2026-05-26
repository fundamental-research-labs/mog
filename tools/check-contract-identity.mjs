#!/usr/bin/env node

/**
 * Canonical SDK contract identity gate.
 *
 * Public facade packages may import or re-export shared SDK identities from
 * @mog-sdk/contracts. They must not redeclare those identities locally in their
 * published declaration entries.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadPackageInventory,
  publicDeclarationEntriesFromExports,
} from './package-export-dispositions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SHARED_SYMBOLS = [
  'CellId',
  'SheetId',
  'RowId',
  'ColId',
  'CellValue',
  'CellRange',
  'Workbook',
  'Worksheet',
  'DocumentSource',
  'DocumentStorageConfig',
  'StorageProviderConfig',
  'StorageProviderKind',
  'SpreadsheetEvent',
  'Command',
];

function parseWorkspacePatterns() {
  const source = readFileSync(resolve(ROOT, 'pnpm-workspace.yaml'), 'utf-8');
  const patterns = [];
  let inPackages = false;

  for (const line of source.split('\n')) {
    if (/^\S/.test(line)) {
      inPackages = line.trim() === 'packages:';
      continue;
    }
    if (!inPackages) continue;
    const match = line.match(/^\s*-\s*['"]?([^'"]+)['"]?\s*$/);
    if (match) patterns.push(match[1]);
  }

  return patterns;
}

function expandWorkspacePattern(pattern) {
  if (!pattern.includes('*')) return [resolve(ROOT, pattern)];
  const parts = pattern.split('/');
  let dirs = [ROOT];

  for (const part of parts) {
    if (part === '*') {
      dirs = dirs.flatMap((dir) =>
        existsSync(dir)
          ? readdirSync(dir)
              .map((entry) => resolve(dir, entry))
              .filter((entryPath) => statSync(entryPath).isDirectory())
          : [],
      );
    } else {
      dirs = dirs.map((dir) => resolve(dir, part));
    }
  }

  return dirs;
}

function discoverWorkspacePackages() {
  const packages = new Map();
  for (const pattern of parseWorkspacePatterns()) {
    for (const packageDir of expandWorkspacePattern(pattern)) {
      const manifestPath = resolve(packageDir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.name) packages.set(manifest.name, { dir: packageDir, manifest });
    }
  }
  return packages;
}

function declarationEntriesForPackage(inventory, workspacePackage) {
  const entries = new Set();
  if (typeof workspacePackage.manifest.types === 'string') {
    entries.add(workspacePackage.manifest.types.replace(/^\.\//, ''));
  }
  for (const entry of publicDeclarationEntriesFromExports(inventory, workspacePackage.manifest)) {
    entries.add(entry);
  }
  return [...entries].filter((entry) => /\.(?:d\.ts|d\.cts|d\.mts)$/.test(entry)).sort();
}

function publicFacadePackages(inventory) {
  return Object.entries(inventory)
    .filter(([name, entry]) => entry.disposition === 'ship-public' && name !== '@mog-sdk/contracts')
    .map(([name]) => name)
    .sort();
}

function lineForOffset(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function findLocalSharedDeclarations(source) {
  const failures = [];
  const symbolPattern = SHARED_SYMBOLS.map((symbol) =>
    symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('|');
  const declarationPattern = new RegExp(
    String.raw`\bexport\s+(?:declare\s+)?(?:interface|type|class|enum|const|let|var|function)\s+(${symbolPattern})\b`,
    'g',
  );

  for (const match of source.matchAll(declarationPattern)) {
    failures.push({ symbol: match[1], line: lineForOffset(source, match.index ?? 0) });
  }

  return failures;
}

function main() {
  const inventory = loadPackageInventory(ROOT);
  const workspacePackages = discoverWorkspacePackages();
  let failureCount = 0;

  for (const packageName of publicFacadePackages(inventory)) {
    const workspacePackage = workspacePackages.get(packageName);
    if (!workspacePackage) {
      console.error(`MISSING: ${packageName} workspace package not found`);
      failureCount += 1;
      continue;
    }

    const declarationEntries = declarationEntriesForPackage(inventory, workspacePackage);
    for (const entry of declarationEntries) {
      const filePath = resolve(workspacePackage.dir, entry);
      if (!existsSync(filePath)) continue;
      const source = readFileSync(filePath, 'utf-8');
      for (const failure of findLocalSharedDeclarations(source)) {
        console.error(
          `IDENTITY: ${relative(ROOT, filePath)}:${failure.line}: shared symbol ${failure.symbol} is declared locally; import or re-export it from @mog-sdk/contracts`,
        );
        failureCount += 1;
      }
    }
  }

  if (failureCount > 0) {
    console.error(
      `\ncheck:contract-identity FAILED — ${failureCount} shared identity redeclaration(s).`,
    );
    process.exit(1);
  }

  console.log(
    'check:contract-identity PASSED — public facades do not redeclare shared SDK identities.',
  );
}

main();

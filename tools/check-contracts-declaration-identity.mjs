#!/usr/bin/env node

/**
 * Guard the public @mog-sdk/contracts declaration graph against duplicate
 * unique-symbol brand owners.
 *
 * A branded type declared with `unique symbol` is nominal. If declaration
 * bundling emits the same conceptual brand in two modules, TypeScript correctly
 * treats the resulting types as incompatible. This gate catches that class at
 * the declaration artifact boundary instead of waiting for repo-wide typecheck
 * or external fixtures to explode.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONTRACTS_DIST = resolve(ROOT, 'contracts/dist');
const GUARDED_BRAND_SYMBOLS = new Set([
  '__cellId',
  '__rowId',
  '__colId',
  '__sheetId',
  '__rangeId',
  '__formattedText',
  'formulaA1Brand',
  'formulaTemplateBrand',
  'DocumentBrand',
  'ViewportBrand',
  'LayerBrand',
]);
const UNIQUE_SYMBOL_RE = /\bdeclare\s+const\s+([A-Za-z_$][\w$]*)\s*:\s*unique\s+symbol\b/g;

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

function lineForOffset(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function canonicalSymbolName(symbolName) {
  return symbolName.replace(/_\d+$/, '');
}

if (!existsSync(CONTRACTS_DIST)) {
  console.error(`MISSING: ${relative(ROOT, CONTRACTS_DIST)} does not exist.`);
  process.exit(1);
}

const declarationsBySymbol = new Map();
const files = walkFiles(CONTRACTS_DIST, (filePath) => filePath.endsWith('.d.ts'));

for (const filePath of files) {
  const source = readFileSync(filePath, 'utf8');
  for (const match of source.matchAll(UNIQUE_SYMBOL_RE)) {
    const symbolName = match[1];
    const canonicalName = canonicalSymbolName(symbolName);
    if (!GUARDED_BRAND_SYMBOLS.has(canonicalName)) continue;
    const declarations = declarationsBySymbol.get(canonicalName) ?? [];
    declarations.push({
      symbolName,
      filePath,
      line: lineForOffset(source, match.index ?? 0),
    });
    declarationsBySymbol.set(canonicalName, declarations);
  }
}

let failures = 0;
for (const [canonicalName, declarations] of [...declarationsBySymbol.entries()].sort()) {
  const uniqueLocations = new Set(
    declarations.map(
      (declaration) => `${declaration.filePath}:${declaration.line}:${declaration.symbolName}`,
    ),
  );
  if (uniqueLocations.size <= 1) continue;

  console.error(`IDENTITY: duplicate unique-symbol owner for ${canonicalName}`);
  for (const declaration of declarations) {
    console.error(
      `  - ${relative(ROOT, declaration.filePath)}:${declaration.line} declares ${declaration.symbolName}`,
    );
  }
  failures += 1;
}

if (failures > 0) {
  console.error(
    `\ncheck:contracts-declaration-identity FAILED — ${failures} duplicate brand owner(s) in @mog-sdk/contracts declarations.`,
  );
  process.exit(1);
}

console.log(
  `check:contracts-declaration-identity PASSED — ${declarationsBySymbol.size} unique-symbol brand owner(s), no duplicates.`,
);

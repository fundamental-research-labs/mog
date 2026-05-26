#!/usr/bin/env node

// Verifies that every exported symbol from kernel barrels is classified
// in the host-surface disposition matrix, and vice versa.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, '..');

const VALID_DISPOSITIONS = new Set([
  'public-host-facade',
  'authorized-materialization-api',
  'trusted-adapter-only',
  'cooperative-legacy',
  'internal-test-only',
  'downstream-blocker',
  'removed',
]);

const BLOCKED_STATUSES = new Set(['blocked', 'deferred', 'not-started']);
const COMPLETE_STATUSES = new Set(['complete', 'verified']);
const VALID_STATUSES = new Set([...BLOCKED_STATUSES, ...COMPLETE_STATUSES]);

const BARREL_MAP = {
  '@mog-sdk/kernel': 'kernel/src/index.ts',
  '@mog-sdk/kernel/storage': 'kernel/src/storage/index.ts',
};

const FORBIDDEN_ROOT_KERNEL_SYMBOLS = new Set([
  'AppKernelAPI',
  'AppKernelAPIOptions',
  'CapabilityGatedAPIOptions',
  'CreateCapabilityGatedAPIOptions',
  'ScopedAPIContext',
  'createAppKernelAPI',
  'createCapabilityGatedApi',
  'createUngatedAdapter',
  'DocumentHandle.createAppKernelAPI',
]);

const DOCUMENT_HANDLE_SOURCE = 'kernel/src/api/document/document-factory.ts';

// ── JSONC loader ────────────────────────────────────────────────────────

function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const noTrailingCommas = stripped.replace(/,\s*([\]}])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

// ── Extract exported symbols from a TS barrel ───────────────────────────

function extractExportedSymbols(filePath) {
  const src = readFileSync(filePath, 'utf-8');
  const symbols = new Set();

  // Match export { ... } and export type { ... } blocks (possibly multiline)
  const exportBlockRe = /export\s+(?:type\s+)?\{([^}]+)\}/g;
  let match;
  while ((match = exportBlockRe.exec(src)) !== null) {
    // Strip inline // comments before splitting by comma
    const block = match[1].replace(/\/\/.*$/gm, '');
    for (const entry of block.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;
      // Handle: "type Foo", "Foo as Bar", "type Foo as Bar", plain "Foo".
      // Disposition is keyed by the public barrel name, so aliases classify
      // the exported name ("Bar"), not the local source name ("Foo").
      const cleaned = trimmed.replace(/^type\s+/, '');
      const aliasMatch = cleaned.match(/^.+\s+as\s+([A-Za-z_$][\w$]*)$/);
      const name = (aliasMatch?.[1] ?? cleaned).trim();
      if (name) symbols.add(name);
    }
  }

  // Match: export { default as Foo } from '...'  (re-export with rename)
  // Already handled above via the generic block regex.

  // Match: export * as Foo from '...'
  const namespaceRe = /^export\s+\*\s+as\s+(\w+)\s+from\s+['"][^'"]+['"]/gm;
  while ((match = namespaceRe.exec(src)) !== null) {
    symbols.add(match[1]);
  }

  // Match standalone: export class Foo / export function foo / export const foo
  const standaloneRe =
    /^export\s+(?:abstract\s+)?(?:class|function|const|let|var|enum|interface|type)\s+(\w+)/gm;
  while ((match = standaloneRe.exec(src)) !== null) {
    symbols.add(match[1]);
  }

  return symbols;
}

// ── Main ────────────────────────────────────────────────────────────────

const dispositionPath = resolve(__dirname, 'host-surface-disposition.jsonc');
const inventory = loadJsonc(dispositionPath);
let errors = 0;

// Validate schema field
if (inventory.$schema !== '02a-host-surface-disposition') {
  console.error('ERROR: $schema must be "02a-host-surface-disposition"');
  errors++;
}

const platformVerificationMatrix = inventory.platformVerificationMatrix;
if (!platformVerificationMatrix || typeof platformVerificationMatrix !== 'object') {
  console.error('ERROR: platformVerificationMatrix is required');
  errors++;
} else {
  for (const [surface, entry] of Object.entries(platformVerificationMatrix)) {
    if (!entry || typeof entry !== 'object') {
      console.error(`ERROR [platformVerificationMatrix]: "${surface}" must be an object`);
      errors++;
      continue;
    }
    if (!VALID_DISPOSITIONS.has(entry.disposition)) {
      console.error(
        `ERROR [platformVerificationMatrix]: "${surface}" has invalid disposition "${entry.disposition}"`,
      );
      errors++;
    }
    if (!VALID_STATUSES.has(entry.status)) {
      console.error(
        `ERROR [platformVerificationMatrix]: "${surface}" has invalid status "${entry.status}"`,
      );
      errors++;
    }
    if (COMPLETE_STATUSES.has(entry.status) && entry.blockedBy) {
      console.error(
        `ERROR [platformVerificationMatrix]: "${surface}" is marked ${entry.status} but still has blockedBy="${entry.blockedBy}"`,
      );
      errors++;
    }
    if (BLOCKED_STATUSES.has(entry.status) && entry.disposition === 'public-host-facade') {
      console.error(
        `ERROR [platformVerificationMatrix]: "${surface}" is blocked but classified as public-host-facade`,
      );
      errors++;
    }
    if (entry.status === 'complete' && !entry.verification) {
      console.error(
        `ERROR [platformVerificationMatrix]: "${surface}" is complete without a verification command/artifact`,
      );
      errors++;
    }
  }
}

for (const [pkg, barrelRelPath] of Object.entries(BARREL_MAP)) {
  const barrelPath = resolve(ROOT, barrelRelPath);
  const actualSymbols = extractExportedSymbols(barrelPath);
  const declaredSymbols = inventory.surfaces?.[pkg] ?? {};

  // Validate each declared entry
  for (const [sym, entry] of Object.entries(declaredSymbols)) {
    if (!VALID_DISPOSITIONS.has(entry.disposition)) {
      console.error(`ERROR [${pkg}]: "${sym}" has invalid disposition "${entry.disposition}"`);
      errors++;
    }
  }

  const declaredSet = new Set(Object.keys(declaredSymbols));

  if (pkg === '@mog-sdk/kernel') {
    const forbiddenActual = [...actualSymbols]
      .filter((s) => FORBIDDEN_ROOT_KERNEL_SYMBOLS.has(s))
      .sort();
    if (forbiddenActual.length > 0) {
      console.error(`\nERROR [${pkg}]: forbidden app API symbol(s) exported from root barrel:`);
      for (const s of forbiddenActual) {
        console.error(`  - ${s}`);
      }
      errors += forbiddenActual.length;
    }

    const forbiddenDeclared = [...declaredSet]
      .filter((s) => FORBIDDEN_ROOT_KERNEL_SYMBOLS.has(s))
      .sort();
    if (forbiddenDeclared.length > 0) {
      console.error(`\nERROR [${pkg}]: forbidden app API symbol(s) classified on root surface:`);
      for (const s of forbiddenDeclared) {
        console.error(`  - ${s}`);
      }
      errors += forbiddenDeclared.length;
    }

    const documentHandleSource = readFileSync(resolve(ROOT, DOCUMENT_HANDLE_SOURCE), 'utf-8');
    const documentHandleBlock =
      documentHandleSource.match(/export interface DocumentHandle \{[\s\S]*?\n\}/)?.[0] ?? '';
    if (/\bcreateAppKernelAPI\s*\(/.test(documentHandleBlock)) {
      console.error(
        `\nERROR [${pkg}]: forbidden DocumentHandle.createAppKernelAPI member in ${DOCUMENT_HANDLE_SOURCE}`,
      );
      errors++;
    }
  }

  // Check for unclassified symbols (in barrel but not in disposition)
  const unclassified = [...actualSymbols].filter((s) => !declaredSet.has(s)).sort();
  if (unclassified.length > 0) {
    console.error(`\nERROR [${pkg}]: ${unclassified.length} unclassified symbol(s) in barrel:`);
    for (const s of unclassified) {
      console.error(`  - ${s}`);
    }
    errors += unclassified.length;
  }

  // Check for stale symbols (in disposition but not in barrel)
  const stale = [...declaredSet].filter((s) => !actualSymbols.has(s)).sort();
  if (stale.length > 0) {
    console.error(
      `\nERROR [${pkg}]: ${stale.length} stale symbol(s) in disposition (not found in barrel):`,
    );
    for (const s of stale) {
      console.error(`  - ${s}`);
    }
    errors += stale.length;
  }

  // Summary for this package
  const classified = [...actualSymbols].filter((s) => declaredSet.has(s)).length;
  console.log(
    `${pkg}: ${classified}/${actualSymbols.size} symbols classified` +
      (unclassified.length ? `, ${unclassified.length} unclassified` : '') +
      (stale.length ? `, ${stale.length} stale` : ''),
  );
}

if (errors > 0) {
  console.error(`\nFAILED: ${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log('\nAll host surface symbols are classified. No gaps.');
}

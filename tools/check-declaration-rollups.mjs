/**
 * Gate 4: Declaration self-containment checker.
 *
 * Scans all .d.ts, .d.cts, and .d.mts files in ship-public package dist directories
 * for forbidden imports of internal workspace packages. Any leaked import
 * means the published declaration files are NOT self-contained and will
 * break external consumers who don't have those workspace packages installed.
 *
 * Usage:
 *   node tools/check-declaration-rollups.mjs
 *
 * Exit 0 if all declarations are self-contained.
 * Exit 1 if any leaked imports are found.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicDeclarationEntriesFromExports } from './package-export-dispositions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Forbidden patterns in .d.ts / .d.cts files.
// Each pattern catches a category of internal import that must not appear
// in published declaration output.
const FORBIDDEN_DTS_PATTERNS = [
  // @mog-sdk/spreadsheet-contracts (any subpath) — static import/export
  /from\s+['"]@mog-sdk\/spreadsheet-contracts(?:\/[^'"]*)?['"]/,
  // @mog-sdk/types-* (any package) — static import/export
  /from\s+['"]@mog-sdk\/types-[^'"]*['"]/,
  // @mog/types-* (any package) — static import/export
  /from\s+['"]@mog\/types-[^'"]*['"]/,
  // @mog/* (any workspace-internal package) — static import/export
  /from\s+['"]@mog\/[^'"]*['"]/,
  // @rust-bridge/* (any) — static import/export
  /from\s+['"]@rust-bridge\/[^'"]*['"]/,
  // Dynamic import() equivalents of all the above
  /import\(\s*['"]@mog-sdk\/spreadsheet-contracts(?:\/[^'"]*)?['"]\s*\)/,
  /import\(\s*['"]@mog-sdk\/types-[^'"]*['"]\s*\)/,
  /import\(\s*['"]@mog\/types-[^'"]*['"]\s*\)/,
  /import\(\s*['"]@mog\/[^'"]*['"]\s*\)/,
  /import\(\s*['"]@rust-bridge\/[^'"]*['"]\s*\)/,
  // Public facade declarations must not be made self-contained by erasing
  // contracts to `any`.
  /\bexport\s+(?:declare\s+)?(?:const|let|var|function|class)\s+\w+[^;\n]*:\s*any\b/,
  /\bexport\s+type\s+\w+\s*=\s*any\b/,
  /\bexport\s+interface\s+\w+[^{}]*\{[^}]*:\s*any\b/s,
  // Workspace-private friend exports must never leak into public declarations.
  /from\s+['"]@mog-sdk\/kernel\/host-lifecycle-internal['"]/,
  /import\(\s*['"]@mog-sdk\/kernel\/host-lifecycle-internal['"]\s*\)/,
];

// Allowlist: imports between public @mog-sdk/* packages are permitted.
// These are legitimate peer/runtime dependencies between published packages.
const ALLOWED_DTS_IMPORTS = [
  /['"]@mog-sdk\/contracts(?:\/[^'"]*)?['"]/,
  /['"]@mog-sdk\/kernel['"]/,
  /['"]@mog-sdk\/sheet-view['"]/,
  /['"]@mog-sdk\/embed(?:\/[^'"]*)?['"]/,
  /['"]@mog-sdk\/wasm['"]/,
];

function parseJsonc(filePath) {
  const source = readFileSync(filePath, 'utf-8');
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(stripped);
}

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
      dirs = dirs.flatMap((dir) => {
        if (!existsSync(dir)) return [];
        return readdirSync(dir)
          .map((entry) => join(dir, entry))
          .filter((entryPath) => statSync(entryPath).isDirectory());
      });
    } else {
      dirs = dirs.map((dir) => join(dir, part));
    }
  }

  return dirs;
}

function discoverWorkspacePackages() {
  const packages = new Map();

  for (const pattern of parseWorkspacePatterns()) {
    for (const packageDir of expandWorkspacePattern(pattern)) {
      const manifestPath = join(packageDir, 'package.json');
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.name) {
        packages.set(manifest.name, { dir: packageDir, manifest });
      }
    }
  }

  return packages;
}

function declarationEntriesForPackage(inventory, manifest) {
  const entries = new Set();
  if (typeof manifest.types === 'string') {
    entries.add(manifest.types.replace(/^\.\//, ''));
  }
  for (const entry of publicDeclarationEntriesFromExports(inventory, manifest)) {
    entries.add(entry);
  }
  return [...entries].filter((entry) => /\.(?:d\.ts|d\.cts|d\.mts)$/.test(entry)).sort();
}

function hasBinEntries(manifest) {
  if (!manifest.bin) return false;
  if (typeof manifest.bin === 'string') return true;
  return (
    typeof manifest.bin === 'object' &&
    !Array.isArray(manifest.bin) &&
    Object.keys(manifest.bin).length > 0
  );
}

function loadRequiredPackages() {
  const inventory = parseJsonc(resolve(__dirname, 'package-inventory.jsonc'));
  const workspacePackages = discoverWorkspacePackages();
  const required = [];
  const skipped = [];

  for (const [inventoryName, entry] of Object.entries(inventory)) {
    if (entry.disposition !== 'ship-public') {
      if (entry.disposition === 'binary-wrapper') {
        skipped.push({
          name: inventoryName,
          reason: 'binary-wrapper package not covered by declaration rollup checker',
        });
      }
      continue;
    }

    const packageName = entry.publicTarget ?? inventoryName;
    const workspacePackage = workspacePackages.get(packageName);
    if (!workspacePackage) {
      required.push({
        name: packageName,
        missingReason: 'no matching workspace package found from pnpm-workspace.yaml',
      });
      continue;
    }

    const entries = declarationEntriesForPackage(inventory, workspacePackage.manifest);
    if (entries.length === 0 && hasBinEntries(workspacePackage.manifest)) {
      skipped.push({
        name: packageName,
        reason: 'bin-only package not covered by declaration rollup checker',
      });
      continue;
    }
    required.push({
      name: packageName,
      packageDir: workspacePackage.dir,
      distDir: join(workspacePackage.dir, 'dist'),
      distRelDir: join(relative(ROOT, workspacePackage.dir), 'dist'),
      entries,
    });
  }

  required.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));
  return { required, skipped };
}

/**
 * Recursively find all .d.ts and .d.cts files in a directory.
 */
function findDeclarationFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findDeclarationFiles(fullPath));
    } else if (entry.endsWith('.d.ts') || entry.endsWith('.d.cts') || entry.endsWith('.d.mts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Check if a line matches an allowed public-to-public import.
 */
function isAllowedImport(line) {
  return ALLOWED_DTS_IMPORTS.some((pattern) => pattern.test(line));
}

function stripCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

// --- Main ---

let totalErrors = 0;
let totalFiles = 0;
let packagesChecked = 0;
const checked = [];
const missing = [];
const { required: requiredPackages, skipped } = loadRequiredPackages();

for (const pkg of requiredPackages) {
  if (pkg.missingReason) {
    console.error(`MISSING: ${pkg.name} — ${pkg.missingReason}`);
    missing.push({ name: pkg.name, reason: pkg.missingReason });
    totalErrors++;
    continue;
  }

  if (pkg.entries.length === 0) {
    console.error(`MISSING: ${pkg.name} — package manifest declares no dist declaration entries`);
    missing.push({
      name: pkg.name,
      reason: 'no dist declaration entries declared in package.json',
    });
    totalErrors++;
    continue;
  }

  if (!existsSync(pkg.distDir)) {
    console.error(`MISSING: ${pkg.name} — required dist directory ${pkg.distRelDir} not found`);
    missing.push({ name: pkg.name, reason: `${pkg.distRelDir} not found` });
    totalErrors++;
    continue;
  }

  packagesChecked++;
  checked.push(pkg.name);
  const dtsFiles = pkg.entries.map((entry) => resolve(pkg.packageDir, entry));
  let packageErrors = 0;

  if (dtsFiles.length === 0) {
    console.error(
      `MISSING: ${pkg.name} — package manifest declares zero public declaration entries`,
    );
    missing.push({ name: pkg.name, reason: 'zero public declaration entries' });
    totalErrors++;
    packageErrors++;
  }

  for (const entry of pkg.entries) {
    const entryPath = resolve(pkg.packageDir, entry);
    if (!existsSync(entryPath)) {
      const relEntryPath = relative(ROOT, entryPath);
      console.error(`MISSING: ${pkg.name} — required declaration entry ${relEntryPath} not found`);
      missing.push({ name: pkg.name, reason: `${relEntryPath} not found` });
      totalErrors++;
      packageErrors++;
    }
  }

  for (const dtsFile of dtsFiles) {
    totalFiles++;
    const content = readFileSync(dtsFile, 'utf-8');
    if (pkg.name === '@mog-sdk/kernel' && /\bunknown\b/.test(stripCommentsAndStrings(content))) {
      const relPath = dtsFile.replace(ROOT + '/', '');
      console.error(
        `LEAK: ${relPath}: @mog-sdk/kernel public declarations must not erase contracts to unknown`,
      );
      totalErrors++;
      packageErrors++;
    }
    const lines = content.split('\n');
    const relPath = dtsFile.replace(ROOT + '/', '');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of FORBIDDEN_DTS_PATTERNS) {
        if (pattern.test(line)) {
          // Check if this is an allowed public-to-public import
          if (isAllowedImport(line)) continue;

          console.error(`LEAK: ${relPath}:${i + 1}: ${line.trim()}`);
          totalErrors++;
          packageErrors++;
          break; // one match per line is enough
        }
      }
    }
  }

  if (packageErrors === 0) {
    console.log(`OK: ${pkg.name} — ${dtsFiles.length} declaration file(s) self-contained`);
  } else {
    console.error(
      `LEAKED: ${pkg.name} — ${packageErrors} leaked import(s) in ${dtsFiles.length} declaration file(s)`,
    );
  }
}

if (packagesChecked === 0) {
  console.error('\ncheck:declaration-rollups FAILED — zero packages checked.');
  process.exit(1);
}

console.log('\nCoverage:');
console.log(
  `  Required (${requiredPackages.length}): ${requiredPackages.map((pkg) => pkg.name).join(', ') || '(none)'}`,
);
console.log(`  Checked (${checked.length}): ${checked.join(', ') || '(none)'}`);
console.log(
  `  Missing (${missing.length}): ${missing.map((pkg) => `${pkg.name} (${pkg.reason})`).join(', ') || '(none)'}`,
);
console.log(
  `  Skipped (${skipped.length}): ${skipped.map((pkg) => `${pkg.name} (${pkg.reason})`).join(', ') || '(none)'}`,
);

console.log(`\nScanned ${totalFiles} declaration file(s) across ${packagesChecked} package(s).`);

if (totalErrors > 0) {
  console.error(`\ncheck:declaration-rollups FAILED — ${totalErrors} leaked import(s) found.`);
  console.error('Fix: ensure all types are owned/inlined by the facade.');
  console.error('See the public package boundary plan for api-extractor approach.');
  process.exit(1);
}

console.log('check:declaration-rollups PASSED — all public facades self-contained.');

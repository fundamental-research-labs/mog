#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CONTRACTS_DIR = resolve(ROOT, 'contracts');
const CONTRACTS_SRC = resolve(CONTRACTS_DIR, 'src');
const CONTRACTS_DIST = resolve(CONTRACTS_DIR, 'dist');
const INVENTORY_PATH = resolve(ROOT, 'tools/contracts-runtime-inventory.json');

const PRIVATE_RUNTIME_PACKAGE = /^@mog(?:-sdk)?\/(?:types-[^/]+|spreadsheet-contracts)(?:\/.*)?$/;
const VALID_CLASSIFICATIONS = new Set([
  'public contract runtime value',
  'type-only contract',
  'private implementation helper',
  'runtime SDK utility candidate',
]);
const VALID_OWNERSHIPS = new Set([
  'contracts-owned',
  'generated-projection',
  'moved-public-runtime',
  'removed-from-public-surface',
]);
const RETAINED_OWNERSHIPS = new Set([
  'contracts-owned',
  'generated-projection',
  'moved-public-runtime',
]);

function main() {
  const contractsManifest = readJson(resolve(CONTRACTS_DIR, 'package.json'));
  const inventory = readJson(INVENTORY_PATH);
  const packageSources = loadPackageSources();
  const publicModuleByTarget = buildPublicModuleTargetMap(contractsManifest);
  const discovered = discoverPrivateRuntimeExports(publicModuleByTarget);
  const inventoryBySource = new Map(inventory.entries.map((entry) => [entry.source, entry]));
  const failures = [];

  validateInventoryShape(inventory, inventoryBySource, failures);

  for (const leak of discovered.values()) {
    const entry = inventoryBySource.get(leak.source);
    if (!entry) {
      failures.push(
        `MISSING-INVENTORY: ${leak.source} is imported or re-exported from ${formatSites(leak.sites)}.`,
      );
      continue;
    }

    validatePublicModules(entry, contractsManifest, failures);
    failures.push(
      `PRIVATE-RUNTIME-LEAK: ${leak.source} is still imported or re-exported from ${formatSites(leak.sites)}. Public contracts runtime values must be projected into @mog-sdk/contracts; type-only contracts must use export type/import type.`,
    );

    const runtimeExports = collectRuntimeExportsForSpecifier(leak.source, packageSources);
    const declaredRuntimeExports = new Set(entry.runtimeExports ?? []);

    for (const symbol of runtimeExports) {
      if (!declaredRuntimeExports.has(symbol)) {
        failures.push(
          `MISSING-RUNTIME-DISPOSITION: ${leak.source} exports runtime value ${symbol}.`,
        );
      }
    }

    for (const symbol of declaredRuntimeExports) {
      if (!runtimeExports.has(symbol)) {
        failures.push(
          `STALE-RUNTIME-DISPOSITION: ${leak.source} declares ${symbol}, but the private source no longer exports it as a runtime value.`,
        );
      }
    }

    if (runtimeExports.size > 0) {
      if (entry.classification === 'type-only contract') {
        failures.push(
          `INVALID-CLASSIFICATION: ${leak.source} has runtime exports but is classified as type-only contract.`,
        );
      }
      if (!entry.sourceOfTruth) {
        failures.push(
          `MISSING-SOURCE-OF-TRUTH: ${leak.source} has retained runtime exports without sourceOfTruth.`,
        );
      }
    }

    const expectedPublicModules = [...leak.publicModules].sort();
    const declaredPublicModules = [...new Set(entry.publicModules ?? [])].sort();
    for (const publicModule of expectedPublicModules) {
      if (!declaredPublicModules.includes(publicModule)) {
        failures.push(
          `MISSING-PUBLIC-MODULE: ${leak.source} is re-exported by ${publicModule}, but the inventory does not list that public identity.`,
        );
      }
    }
  }

  for (const entry of inventory.entries) {
    validatePublicModules(entry, contractsManifest, failures);
  }

  if (failures.length > 0) {
    console.error(
      `check:contracts-runtime-inventory FAILED (${failures.length} issue${failures.length === 1 ? '' : 's'}):`,
    );
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  const runtimeValueCount = inventory.entries
    .map((entry) => entry.runtimeExports?.length ?? 0)
    .reduce((sum, count) => sum + count, 0);
  console.log(
    `check:contracts-runtime-inventory PASSED — ${discovered.size} current private runtime import/re-export source(s), ${runtimeValueCount} retained runtime value disposition(s).`,
  );
}

function validateInventoryShape(inventory, inventoryBySource, failures) {
  if (inventory.schemaVersion !== 1) {
    failures.push(`INVALID-SCHEMA: expected schemaVersion 1.`);
  }
  if (inventory.package !== '@mog-sdk/contracts') {
    failures.push(`INVALID-PACKAGE: expected package @mog-sdk/contracts.`);
  }
  if (!Array.isArray(inventory.entries)) {
    failures.push(`INVALID-ENTRIES: entries must be an array.`);
    return;
  }
  if (inventoryBySource.size !== inventory.entries.length) {
    failures.push(`DUPLICATE-SOURCE: each inventory source must be unique.`);
  }

  for (const entry of inventory.entries) {
    if (!PRIVATE_RUNTIME_PACKAGE.test(entry.source ?? '')) {
      failures.push(
        `INVALID-SOURCE: ${entry.source ?? '<missing>'} is not a private type shard specifier.`,
      );
    }
    if (!VALID_CLASSIFICATIONS.has(entry.classification)) {
      failures.push(
        `INVALID-CLASSIFICATION: ${entry.source} uses ${entry.classification ?? '<missing>'}.`,
      );
    }
    if (!VALID_OWNERSHIPS.has(entry.ownership)) {
      failures.push(`INVALID-OWNERSHIP: ${entry.source} uses ${entry.ownership ?? '<missing>'}.`);
    }
    if (!Array.isArray(entry.runtimeExports)) {
      failures.push(`INVALID-RUNTIME-EXPORTS: ${entry.source} runtimeExports must be an array.`);
    }
    if (!Array.isArray(entry.publicModules)) {
      failures.push(`INVALID-PUBLIC-MODULES: ${entry.source} publicModules must be an array.`);
    }
    if (RETAINED_OWNERSHIPS.has(entry.ownership) && !entry.verificationFixture) {
      failures.push(
        `MISSING-VERIFICATION: ${entry.source} retained disposition needs verificationFixture.`,
      );
    }
  }
}

function validatePublicModules(entry, contractsManifest, failures) {
  for (const publicModule of entry.publicModules ?? []) {
    const exportKey =
      publicModule === contractsManifest.name
        ? '.'
        : publicModule.replace(`${contractsManifest.name}/`, './');
    if (!contractsManifest.exports?.[exportKey]) {
      failures.push(
        `INVALID-PUBLIC-MODULE: ${entry.source} retains ${publicModule}, but contracts/package.json does not export ${exportKey}.`,
      );
    }
  }
}

function discoverPrivateRuntimeExports(publicModuleByTarget) {
  const leaks = new Map();
  const files = [
    ...walkFiles(
      CONTRACTS_SRC,
      (file) => file.endsWith('.ts') && !/\/__tests__\//.test(file) && !/\.test\.tsx?$/.test(file),
    ),
    ...walkFiles(CONTRACTS_DIST, (file) => /\.(?:js|mjs|cjs|d\.ts)$/.test(file)),
  ];

  for (const file of files) {
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const specifier of collectRuntimeSpecifiers(source)) {
      if (!PRIVATE_RUNTIME_PACKAGE.test(specifier)) continue;
      const relativePath = relative(ROOT, file);
      const publicModule = publicModuleByTarget.get(normalizeManifestTarget(file));
      const leak = leaks.get(specifier) ?? {
        source: specifier,
        sites: [],
        publicModules: new Set(),
      };
      leak.sites.push(relativePath);
      if (publicModule) leak.publicModules.add(publicModule);
      leaks.set(specifier, leak);
    }
  }

  return new Map([...leaks.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

function collectRuntimeExportSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?!type\b)(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g,
    /\bexport\s+(?!type\b)\{[\s\S]*?\}\s+from\s+['"]([^'"]+)['"]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return specifiers;
}

const collectRuntimeSpecifiers = collectRuntimeExportSpecifiers;

function collectRuntimeExportsForSpecifier(specifier, packageSources) {
  const sourceFile = resolvePackageSource(specifier, packageSources);
  if (!sourceFile) return new Set();
  return collectRuntimeExportsFromFile(sourceFile, packageSources, new Set());
}

function collectRuntimeExportsFromFile(file, packageSources, seen) {
  const resolvedFile = resolveSourceFile(file);
  if (!resolvedFile || seen.has(resolvedFile)) return new Set();
  seen.add(resolvedFile);

  const source = stripComments(readFileSync(resolvedFile, 'utf8'));
  const exports = new Set();

  for (const pattern of [
    /\bexport\s+(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g,
    /\bexport\s+async\s+function\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      exports.add(match[1]);
    }
  }

  for (const match of source.matchAll(
    /\bexport\s+(?!type\b)\{([\s\S]*?)\}(?:\s+from\s+['"]([^'"]+)['"])?/g,
  )) {
    const clause = match[1];
    const from = match[2];
    for (const name of parseNamedExportClause(clause)) {
      exports.add(name.exported);
    }
    if (from && from.startsWith('.')) {
      const target = resolveRelativeSource(resolvedFile, from);
      const targetExports = collectRuntimeExportsFromFile(target, packageSources, seen);
      for (const symbol of targetExports) exports.add(symbol);
    }
  }

  for (const match of source.matchAll(/\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g)) {
    const specifier = match[1];
    const target = specifier.startsWith('.')
      ? resolveRelativeSource(resolvedFile, specifier)
      : resolvePackageSource(specifier, packageSources);
    if (!target) continue;
    const targetExports = collectRuntimeExportsFromFile(target, packageSources, seen);
    for (const symbol of targetExports) exports.add(symbol);
  }

  return new Set([...exports].sort());
}

function parseNamedExportClause(clause) {
  return clause
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.startsWith('type '))
    .map((part) => {
      const normalized = part.replace(/^type\s+/, '').trim();
      const [local, exported = local] = normalized.split(/\s+as\s+/).map((value) => value.trim());
      return { local, exported };
    })
    .filter((entry) => /^[A-Za-z_$][\w$]*$/.test(entry.exported));
}

function resolvePackageSource(specifier, packageSources) {
  const packageName = packageNameForSpecifier(specifier);
  const subpath = specifier.slice(packageName.length) || '.';
  const manifest = packageSources.get(packageName);
  if (!manifest) return null;
  const exportKey = subpath === '.' ? '.' : `.${subpath}`;
  const target = manifest.exports?.[exportKey]?.development;
  return target ? resolve(manifest.dir, target) : null;
}

function packageNameForSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/');
    return `${scope}/${name}`;
  }
  return specifier.split('/')[0];
}

function loadPackageSources() {
  const packages = new Map();
  for (const manifestPath of walkFiles(resolve(ROOT, 'types'), (file) =>
    file.endsWith('package.json'),
  )) {
    const manifest = readJson(manifestPath);
    if (!PRIVATE_RUNTIME_PACKAGE.test(manifest.name ?? '')) continue;
    packages.set(manifest.name, { dir: dirname(manifestPath), exports: manifest.exports ?? {} });
  }
  return packages;
}

function buildPublicModuleTargetMap(manifest) {
  const targets = new Map();
  for (const [exportKey, conditions] of Object.entries(manifest.exports ?? {})) {
    const publicModule =
      exportKey === '.' ? manifest.name : `${manifest.name}/${exportKey.slice(2)}`;
    for (const condition of ['development', 'import', 'types']) {
      const target = conditions?.[condition];
      if (!target) continue;
      targets.set(normalizeManifestTarget(resolve(CONTRACTS_DIR, target)), publicModule);
    }
  }
  return targets;
}

function normalizeManifestTarget(file) {
  const relativePath = relative(CONTRACTS_DIR, file).replaceAll('\\', '/');
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function resolveRelativeSource(fromFile, specifier) {
  return resolve(dirname(fromFile), specifier);
}

function resolveSourceFile(file) {
  const candidates = extname(file)
    ? [file]
    : [
        `${file}.ts`,
        `${file}.tsx`,
        `${file}.d.ts`,
        join(file, 'index.ts'),
        join(file, 'index.tsx'),
        join(file, 'index.d.ts'),
      ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function walkFiles(dir, predicate, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkFiles(fullPath, predicate, results);
    } else if (stat.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function formatSites(sites) {
  const unique = [...new Set(sites)].sort();
  if (unique.length <= 3) return unique.join(', ');
  return `${unique.slice(0, 3).join(', ')} and ${unique.length - 3} more`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

main();

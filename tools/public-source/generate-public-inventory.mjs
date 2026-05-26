#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadJsonc, normalizeRelPath, parseJsonc, readJson, stableJson } from './common.mjs';

export { parseJsonc };

const WORKSPACE_PACKAGE_DIR_FIELDS = [
  'publicWorkspacePackages',
  'workspacePackageDirs',
  'includedWorkspacePackageDirs',
];
const WORKSPACE_PACKAGE_NAME_FIELDS = [
  'workspacePackages',
  'includedWorkspacePackages',
  'includeWorkspacePackages',
  'includedPackages',
  'packages',
];
const REQUIRED_PACKAGE_NAME_FIELDS = [
  'requiredWorkspacePackages',
  'requiredIncludedPackages',
  'requiredPackages',
];
const PACKAGE_LESS_INVENTORY_FIELDS = [
  'allowedPackageLessInventoryEntries',
  'packageLessInventoryEntries',
  'allowPackageLessInventoryEntries',
  'allowedInventoryOnlyEntries',
];

export function buildPublicInventory(root, manifest) {
  const inventoryPath = resolve(root, 'tools/package-inventory.jsonc');
  if (!existsSync(inventoryPath)) {
    throw new Error(`Missing package inventory: ${inventoryPath}`);
  }

  const sourceInventory = loadJsonc(inventoryPath);
  const normalized = normalizePublicSourceManifest(root, manifest);
  const workspaceNames = new Set(normalized.workspaceNames);
  const requiredNames = new Set(normalized.requiredNames);
  const allowedPackageLessInventoryEntries = new Set(normalized.allowedPackageLessInventoryEntries);
  const errors = [];

  errors.push(...normalized.errors);

  const publicInventory = {};
  for (const [name, entry] of Object.entries(sourceInventory)) {
    if (workspaceNames.has(name) || allowedPackageLessInventoryEntries.has(name)) {
      publicInventory[name] = entry;
    }
  }

  for (const name of requiredNames) {
    if (!publicInventory[name]) {
      errors.push(
        `${name}: required included package is missing from tools/package-inventory.jsonc`,
      );
    }
  }

  errors.push(
    ...validatePublicInventory(publicInventory, {
      workspaceNames,
      requiredNames,
      allowedPackageLessInventoryEntries,
    }),
  );

  return {
    inventory: publicInventory,
    workspaceNames: [...workspaceNames].sort(),
    requiredNames: [...requiredNames].sort(),
    allowedPackageLessInventoryEntries: [...allowedPackageLessInventoryEntries].sort(),
    errors,
  };
}

export function normalizePublicSourceManifest(root, manifest) {
  if (manifest === undefined) {
    manifest = root;
    root = process.cwd();
  }
  const workspaceNames = new Set();
  const requiredNames = new Set();
  const allowedPackageLessInventoryEntries = new Set();
  const errors = [];
  const generatedPackagesByPath = new Map(
    (manifest.generatedWorkspacePackages ?? []).map((pkg) => [normalizeRelPath(pkg.path), pkg]),
  );

  for (const field of WORKSPACE_PACKAGE_DIR_FIELDS) {
    if (!(field in manifest)) continue;
    for (const item of readStringList(manifest[field], field, errors)) {
      const dir = normalizeRelPath(item);
      const packageJsonPath = resolve(root, dir, 'package.json');
      if (!existsSync(packageJsonPath)) {
        const generatedPackage = generatedPackagesByPath.get(dir);
        if (generatedPackage?.name) {
          workspaceNames.add(generatedPackage.name);
          requiredNames.add(generatedPackage.name);
          continue;
        }
        errors.push(`${dir}: included public workspace package is missing package.json`);
        continue;
      }
      const pkg = readJson(packageJsonPath);
      if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
        errors.push(`${dir}: package.json is missing name`);
        continue;
      }
      workspaceNames.add(pkg.name);
      requiredNames.add(pkg.name);
    }
  }

  for (const field of WORKSPACE_PACKAGE_NAME_FIELDS) {
    if (!(field in manifest)) continue;
    for (const item of readPackageNameList(manifest[field], field, errors)) {
      workspaceNames.add(item.name);
      if (item.required) {
        requiredNames.add(item.name);
      }
    }
  }

  for (const field of REQUIRED_PACKAGE_NAME_FIELDS) {
    if (!(field in manifest)) continue;
    for (const item of readPackageNameList(manifest[field], field, errors)) {
      workspaceNames.add(item.name);
      requiredNames.add(item.name);
    }
  }

  for (const field of PACKAGE_LESS_INVENTORY_FIELDS) {
    if (!(field in manifest)) continue;
    for (const item of readPackageNameList(manifest[field], field, errors)) {
      allowedPackageLessInventoryEntries.add(item.name);
    }
  }

  for (const name of allowedPackageLessInventoryEntries) {
    if (workspaceNames.has(name)) {
      errors.push(
        `${name}: package-less inventory entry is also an included public workspace package`,
      );
    }
  }

  if (workspaceNames.size === 0) {
    errors.push(
      `manifest must include at least one public workspace package via ${[
        ...WORKSPACE_PACKAGE_DIR_FIELDS,
        ...WORKSPACE_PACKAGE_NAME_FIELDS,
      ].join(', ')}`,
    );
  }

  return {
    workspaceNames: [...workspaceNames].sort(),
    requiredNames: [...requiredNames].sort(),
    allowedPackageLessInventoryEntries: [...allowedPackageLessInventoryEntries].sort(),
    errors,
  };
}

export function validatePublicInventory(inventory, manifest) {
  const workspaceNames = new Set(manifest.workspaceNames ?? manifest.workspacePackages ?? []);
  const requiredNames = new Set(
    manifest.requiredNames ?? manifest.requiredWorkspacePackages ?? workspaceNames,
  );
  const allowedPackageLessInventoryEntries = new Set(
    manifest.allowedPackageLessInventoryEntries ?? [],
  );
  const allowedInventoryNames = new Set([...workspaceNames, ...allowedPackageLessInventoryEntries]);
  const errors = [];

  for (const name of Object.keys(inventory)) {
    if (!allowedInventoryNames.has(name)) {
      errors.push(
        `${name}: public inventory contains a package that is not in the public workspace and not listed as an allowed package-less entry`,
      );
    }
  }

  for (const name of requiredNames) {
    if (!(name in inventory)) {
      errors.push(`${name}: required included package is absent from public inventory`);
    }
  }

  return errors;
}

export function generatePublicInventory(sourceInventory, manifest, options = {}) {
  const normalized = normalizePublicSourceManifest(manifest);
  const sourceWorkspacePackageNames = new Set(
    options.sourceWorkspacePackageNames ?? Object.keys(sourceInventory),
  );
  const publicInventory = {};
  const errors = [...normalized.errors];

  for (const name of normalized.requiredNames) {
    if (!sourceWorkspacePackageNames.has(name) || !(name in sourceInventory)) {
      errors.push(`${name}: included workspace package is absent from source inventory`);
    }
  }

  for (const [name, entry] of Object.entries(sourceInventory)) {
    if (
      normalized.workspaceNames.includes(name) ||
      normalized.allowedPackageLessInventoryEntries.includes(name)
    ) {
      publicInventory[name] = entry;
    }
  }

  errors.push(...validatePublicInventory(publicInventory, normalized));
  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
  return publicInventory;
}

function readStringList(value, field, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field}: expected an array`);
    return [];
  }

  const items = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === 'string' && item.length > 0) {
      items.push(item);
    } else {
      errors.push(`${field}[${index}]: expected a non-empty string`);
    }
  }
  return items;
}

function readPackageNameList(value, field, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field}: expected an array`);
    return [];
  }

  const items = [];
  for (const [index, item] of value.entries()) {
    if (typeof item === 'string' && item.length > 0) {
      items.push({ name: item, required: true });
      continue;
    }
    if (
      item &&
      typeof item === 'object' &&
      !Array.isArray(item) &&
      typeof item.name === 'string' &&
      item.name.length > 0
    ) {
      if ('required' in item && typeof item.required !== 'boolean') {
        errors.push(`${field}[${index}].required: expected a boolean`);
      }
      items.push({ name: item.name, required: item.required !== false });
      continue;
    }
    errors.push(
      `${field}[${index}]: expected a package name string or { "name": string, "required"?: boolean }`,
    );
  }

  return items;
}

export function serializePublicInventory(inventory) {
  return [
    '{',
    '  // Generated by tools/public-source/generate-public-inventory.mjs.',
    '  // This inventory intentionally contains only packages present in the',
    '  // public source workspace.',
    stableJson(inventory)
      .trim()
      .slice(1, -1)
      .split('\n')
      .map((line) => (line ? `  ${line}` : line))
      .join('\n'),
    '}',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    manifest: null,
    out: null,
    check: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') args.root = argv[++i];
    else if (arg === '--manifest') args.manifest = argv[++i];
    else if (arg === '--out') args.out = argv[++i];
    else if (arg === '--check') args.check = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/public-source/generate-public-inventory.mjs [options]

Options:
  --root <path>       Projected repo root to inspect (default: cwd)
  --manifest <path>   Projection manifest (default: <root>/tools/public-source/public-source-manifest.jsonc)
  --out <path>        Inventory output path (default: <root>/tools/package-inventory.jsonc)
  --check             Fail if the existing output differs from generated output
`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.root);
  const manifestPath = resolve(
    args.manifest ?? resolve(root, 'tools/public-source/public-source-manifest.jsonc'),
  );
  const outPath = resolve(args.out ?? resolve(root, 'tools/package-inventory.jsonc'));
  const manifest = loadJsonc(manifestPath);
  const { inventory, workspaceNames, requiredNames, allowedPackageLessInventoryEntries, errors } =
    buildPublicInventory(root, manifest);

  if (errors.length > 0) {
    console.error(
      `public inventory FAILED (${errors.length} error${errors.length === 1 ? '' : 's'}):`,
    );
    for (const error of errors.sort()) console.error(`  - ${error}`);
    process.exit(1);
  }

  const serialized = serializePublicInventory(inventory);
  if (args.check) {
    const currentInventory = existsSync(outPath) ? loadJsonc(outPath) : {};
    const currentErrors = existsSync(outPath)
      ? validatePublicInventory(currentInventory, {
          workspaceNames,
          requiredNames,
          allowedPackageLessInventoryEntries,
        })
      : [`${normalizeRelPath(outPath)}: public inventory file is missing`];
    if (currentErrors.length > 0) {
      console.error(
        `public inventory FAILED (${currentErrors.length} error${currentErrors.length === 1 ? '' : 's'}):`,
      );
      for (const error of currentErrors.sort()) console.error(`  - ${error}`);
      process.exit(1);
    }

    const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (current !== serialized) {
      console.error(
        `public inventory FAILED: ${normalizeRelPath(outPath)} is not generated from the projection manifest`,
      );
      process.exit(1);
    }
    console.log(`public inventory OK: ${Object.keys(inventory).length} package entries`);
    return;
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialized);
  console.log(
    `public inventory written: ${normalizeRelPath(outPath)} (${Object.keys(inventory).length} package entries)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exit(1);
  }
}

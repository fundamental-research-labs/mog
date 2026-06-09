#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicPackageCandidate,
  discoverWorkspacePackages,
  loadJsonc,
  publicPackageOutputDirectoryName,
  publicPackageNames,
} from './public-package-manifest.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const outArgIndex = process.argv.indexOf('--out');
const outRoot = resolve(
  ROOT,
  outArgIndex >= 0 ? process.argv[outArgIndex + 1] : 'artifacts/public-packages',
);

const inventory = loadJsonc(resolve(ROOT, 'tools/package-inventory.jsonc'));
const workspacePackages = discoverWorkspacePackages(ROOT);
const names = publicPackageNames(inventory);

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

const missing = [];
for (const packageName of names) {
  const workspacePackage = workspacePackages.get(packageName);
  if (!workspacePackage || !existsSync(workspacePackage.dir)) {
    missing.push(`${packageName}: workspace package directory not found`);
    continue;
  }

  const packageOutDir = resolve(outRoot, publicPackageOutputDirectoryName(packageName));
  createPublicPackageCandidate(packageName, {
    root: ROOT,
    inventory,
    workspacePackages,
    outDir: packageOutDir,
  });
  console.log(`${packageName} -> ${packageOutDir}`);
}

if (missing.length > 0) {
  console.error(
    `\nassemble-public-packages FAILED (${missing.length} missing package${missing.length === 1 ? '' : 's'}):`,
  );
  for (const issue of missing) {
    console.error(`  - ${issue}`);
  }
  process.exit(1);
}

console.log(
  `\nassemble-public-packages PASSED — ${names.length} package director${names.length === 1 ? 'y' : 'ies'} written to ${outRoot}`,
);

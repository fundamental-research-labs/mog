#!/usr/bin/env node

/**
 * Build the production artifacts that public package-boundary gates validate.
 *
 * This script intentionally derives required packages from
 * tools/package-inventory.jsonc. If inventory says a package is public, missing
 * build scripts or missing artifacts are contract failures, not fixture skips.
 */

import { copyFileSync, existsSync, globSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ensurePrivateFriendArtifactsExist,
  isPublicExportSubpath,
} from './package-export-dispositions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const checkOnly = process.argv.includes('--check-only');
const skipTsBuild = process.argv.includes('--skip-ts-build') || checkOnly;
const skipNativeBuild = process.argv.includes('--skip-native-build') || checkOnly;
const skipWasmBuild = process.argv.includes('--skip-wasm-build') || checkOnly;
const skipHostNativeArtifact = process.argv.includes('--skip-host-native-artifact') || checkOnly;
const throughPackage = argValue('--through');

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1] ?? null;
  const prefix = `${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const stripped = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  return JSON.parse(stripped.replace(/,\s*([\]}])/g, '$1'));
}

function discoverWorkspacePackages() {
  const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf-8');
  const patterns = [];
  let inPackages = false;

  for (const line of workspace.split('\n')) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const match = line.match(/^\s+-\s+'([^']+)'$/);
    if (match) {
      patterns.push(match[1]);
    } else if (/^\S/.test(line) && line.trim()) {
      break;
    }
  }

  const packages = new Map();
  for (const pattern of patterns) {
    const matches =
      pattern === '.'
        ? [join(ROOT, 'package.json')]
        : globSync(join(ROOT, pattern, 'package.json'));

    for (const manifestPath of matches) {
      if (
        manifestPath.includes('/node_modules/') ||
        manifestPath.includes('/target') ||
        manifestPath.includes('/.claude/')
      ) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (!manifest.name) continue;
      packages.set(manifest.name, {
        dir: dirname(manifestPath),
        manifestPath,
        manifest,
      });
    }
  }
  return packages;
}

function run(command, args, options = {}) {
  const printable = [command, ...args].join(' ');
  console.log(`  $ ${printable}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${printable} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

function collectExportTargets(value, targets = new Set()) {
  if (!value) return targets;
  if (typeof value === 'string') {
    targets.add(value);
    return targets;
  }
  if (typeof value !== 'object') return targets;
  for (const nested of Object.values(value)) {
    collectExportTargets(nested, targets);
  }
  return targets;
}

function collectPublicExportTargets(inventory, manifest) {
  const targets = new Set();
  const exportsField = manifest.exports;
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return targets;
  }
  for (const [subpath, value] of Object.entries(exportsField)) {
    if (!isPublicExportSubpath(inventory, manifest.name, subpath)) continue;
    collectExportTargets(value, targets);
  }
  return targets;
}

function verifyPackageArtifact(pkg, inventory) {
  const distDir = join(pkg.dir, 'dist');
  const relDir = pkg.dir.replace(ROOT + '/', '');
  const errors = [];

  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    errors.push(
      `${pkg.manifest.name} (${relDir}): missing dist directory after public artifact build`,
    );
    return errors;
  }

  errors.push(...ensurePrivateFriendArtifactsExist(inventory, pkg.manifest, pkg.dir));

  if (hasBinEntries(pkg.manifest)) {
    errors.push(...verifyBinArtifacts(pkg.manifest, pkg.dir, relDir));
  }

  const targets = collectPublicExportTargets(inventory, pkg.manifest);
  if (targets.size === 0 && hasBinEntries(pkg.manifest)) {
    return errors;
  }

  const distTargets = [...targets].filter((target) => target.startsWith('./dist/'));
  if (distTargets.length === 0) {
    errors.push(`${pkg.manifest.name} (${relDir}): export map has no ./dist/* artifact targets`);
  }

  for (const target of distTargets) {
    const targetPath = join(pkg.dir, target);
    if (!existsSync(targetPath)) {
      errors.push(`${pkg.manifest.name} (${relDir}): missing export artifact ${target}`);
    }
  }

  const declarationTargets = distTargets.filter(
    (target) => target.endsWith('.d.ts') || target.endsWith('.d.cts') || target.endsWith('.d.mts'),
  );
  if (declarationTargets.length === 0) {
    errors.push(`${pkg.manifest.name} (${relDir}): export map has no declaration artifact targets`);
  }

  return errors;
}

function hasBinEntries(manifest) {
  return binTargets(manifest).length > 0;
}

function binTargets(manifest) {
  if (!manifest.bin) return [];
  if (typeof manifest.bin === 'string') return [manifest.bin];
  if (typeof manifest.bin !== 'object' || Array.isArray(manifest.bin)) return [];
  return Object.values(manifest.bin).filter((target) => typeof target === 'string');
}

function verifyBinArtifacts(manifest, packageRoot, relDir) {
  const errors = [];
  for (const target of binTargets(manifest)) {
    if (!target.startsWith('./dist/')) {
      errors.push(`${manifest.name} (${relDir}): bin target ${target} must point at ./dist/*`);
      continue;
    }

    const targetPath = join(packageRoot, target);
    if (!existsSync(targetPath)) {
      errors.push(`${manifest.name} (${relDir}): missing bin artifact ${target}`);
      continue;
    }

    const source = readFileSync(targetPath, 'utf8');
    if (!source.startsWith('#!')) {
      errors.push(`${manifest.name} (${relDir}): bin artifact ${target} is missing a shebang`);
    }

    const mode = statSync(targetPath).mode;
    if ((mode & 0o111) === 0) {
      errors.push(`${manifest.name} (${relDir}): bin artifact ${target} is not executable`);
    }
  }
  return errors;
}

function hostNativePackageName() {
  if (process.platform === 'darwin') return `@mog-sdk/darwin-${process.arch}`;
  if (process.platform === 'win32' && process.arch === 'x64') return '@mog-sdk/win32-x64-msvc';
  if (process.platform === 'linux') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const hasGlibc = Boolean(process.report?.getReport?.().header.glibcVersionRuntime);
    return `@mog-sdk/linux-${arch}-${hasGlibc ? 'gnu' : 'musl'}`;
  }
  return null;
}

function verifyPackageFiles(pkg, packageRoot) {
  const files = pkg.files ?? [];
  const missing = [];
  for (const file of files) {
    const filePath = join(packageRoot, file);
    if (!existsSync(filePath)) missing.push(file);
  }
  return missing;
}

function workspaceDependencyNames(manifest) {
  const sections = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  const names = new Set();

  for (const section of sections) {
    for (const [name, version] of Object.entries(section ?? {})) {
      if (String(version).startsWith('workspace:')) {
        names.add(name);
      }
    }
  }

  return names;
}

function orderedShipPublicPackages(inventory, workspacePackages) {
  const names = Object.entries(inventory)
    .filter(([, entry]) => entry.disposition === 'ship-public')
    .map(([name]) => name);
  return orderWorkspacePackageSet(names, workspacePackages);
}

function orderWorkspacePackageSet(names, workspacePackages) {
  const nameSet = new Set(names);
  const dependencyNames = new Map();
  const dependents = new Map(names.map((name) => [name, []]));
  const remainingDependencyCounts = new Map();

  for (const name of names) {
    const pkg = workspacePackages.get(name);
    const deps = pkg
      ? [...workspaceDependencyNames(pkg.manifest)].filter((depName) => nameSet.has(depName))
      : [];
    dependencyNames.set(name, deps);
    remainingDependencyCounts.set(name, deps.length);

    for (const depName of deps) {
      dependents.get(depName)?.push(name);
    }
  }

  const ready = names.filter((name) => remainingDependencyCounts.get(name) === 0);
  const ordered = [];

  while (ready.length > 0) {
    const name = ready.shift();
    ordered.push(name);

    for (const dependent of dependents.get(name) ?? []) {
      const remaining = (remainingDependencyCounts.get(dependent) ?? 0) - 1;
      remainingDependencyCounts.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
      }
    }
  }

  if (ordered.length !== names.length) {
    const cyclic = names
      .filter((name) => !ordered.includes(name))
      .map((name) => {
        const deps = dependencyNames.get(name) ?? [];
        return `${name} -> ${deps.join(', ') || '(none)'}`;
      });
    throw new Error(`ship-public package build graph contains a cycle: ${cyclic.join('; ')}`);
  }

  return ordered;
}

function collectWorkspaceDependencyClosure(rootNames, workspacePackages) {
  const closure = new Set();
  const queue = [...rootNames];

  while (queue.length > 0) {
    const name = queue.shift();
    const pkg = workspacePackages.get(name);
    if (!pkg) continue;

    for (const depName of workspaceDependencyNames(pkg.manifest)) {
      if (closure.has(depName)) continue;
      if (!workspacePackages.has(depName)) continue;
      closure.add(depName);
      queue.push(depName);
    }
  }

  return closure;
}

function orderedGeneratedAssetPrerequisites(inventory, workspacePackages, rootNames) {
  const dependencyClosure = collectWorkspaceDependencyClosure(rootNames, workspacePackages);
  const names = [...dependencyClosure].filter(
    (name) => inventory[name]?.disposition === 'generated-asset',
  );
  return orderWorkspacePackageSet(names, workspacePackages);
}

function workspacePackageDir(pkg) {
  return pkg.dir.replace(ROOT + '/', '');
}

function buildTypeShardDeclarations(workspacePackages, errors) {
  const typeShardNames = [...workspacePackages.keys()].filter(
    (name) => name.startsWith('@mog/types-') || name.startsWith('@mog-sdk/types-'),
  );
  const orderedTypeShardNames = orderWorkspacePackageSet(typeShardNames, workspacePackages);

  console.log('\n=== Declaration prerequisites ===');

  for (const name of orderedTypeShardNames) {
    const pkg = workspacePackages.get(name);
    if (!pkg) {
      errors.push(`${name}: type shard is not a workspace package`);
      continue;
    }

    if (skipTsBuild) {
      console.log(`  SKIP tsc -b ${name} (${checkOnly ? 'check-only' : 'skip-ts-build'})`);
      continue;
    }

    try {
      run('pnpm', [
        '-C',
        workspacePackageDir(pkg),
        'exec',
        'tsc',
        '-b',
        '.',
        '--force',
        '--pretty',
        'false',
      ]);
    } catch (error) {
      errors.push(`${name}: declaration prerequisite build failed: ${error.message}`);
    }
  }
}

function buildProjectReferenceDeclarations(project, errors) {
  if (skipTsBuild) {
    console.log(`  SKIP tsc -b ${project} (${checkOnly ? 'check-only' : 'skip-ts-build'})`);
    return;
  }

  try {
    run('pnpm', ['-C', project, 'exec', 'tsc', '-b', '.', '--force', '--pretty', 'false']);
  } catch (error) {
    errors.push(`${project}: declaration prerequisite build failed: ${error.message}`);
  }
}

function buildDeclarationPrerequisites(workspacePackages, errors) {
  buildTypeShardDeclarations(workspacePackages, errors);
  buildProjectReferenceDeclarations('views/sheet-view', errors);
}

function buildKernelArtifact(errors) {
  console.log('\n=== Kernel artifact prerequisite ===');

  if (!skipTsBuild) {
    try {
      run('pnpm', ['--filter', '@mog-sdk/kernel', 'build']);
    } catch (error) {
      errors.push(`@mog-sdk/kernel: ${error.message}`);
    }
  } else {
    console.log(`  SKIP build @mog-sdk/kernel (${checkOnly ? 'check-only' : 'skip-ts-build'})`);
  }

  if (!skipTsBuild) {
    try {
      run('pnpm', [
        '-C',
        'kernel/host-internal',
        'exec',
        'tsc',
        '-b',
        '.',
        '--force',
        '--pretty',
        'false',
      ]);
    } catch (error) {
      errors.push(`@mog/kernel-host-internal: ${error.message}`);
    }
  } else {
    console.log(
      `  SKIP tsc -b @mog/kernel-host-internal (${checkOnly ? 'check-only' : 'skip-ts-build'})`,
    );
  }
}

function buildWasmArtifact(workspacePackages, errors) {
  console.log('\n=== WASM asset artifact ===');
  const wasmPkg = workspacePackages.get('@mog-sdk/wasm');
  if (!wasmPkg) {
    errors.push('@mog-sdk/wasm: binary-wrapper package missing from workspace');
    return null;
  }

  if (!skipWasmBuild) {
    try {
      run('bash', ['compute/wasm/build.sh', '--profile', 'release']);
    } catch (error) {
      errors.push(`@mog-sdk/wasm: ${error.message}`);
    }
  } else {
    console.log(`  SKIP WASM build (${checkOnly ? 'check-only' : 'skip-wasm-build'})`);
  }

  const missing = verifyPackageFiles(wasmPkg.manifest, wasmPkg.dir);
  if (missing.length > 0) {
    errors.push(`@mog-sdk/wasm: missing packaged WASM file(s): ${missing.join(', ')}`);
  }

  return wasmPkg;
}

function buildChartRasterWasmArtifact(workspacePackages, errors) {
  console.log('\n=== Chart raster WASM asset artifact ===');
  const chartRasterPkg = workspacePackages.get('@mog-sdk/chart-raster-wasm');
  if (!chartRasterPkg) {
    errors.push('@mog-sdk/chart-raster-wasm: binary-wrapper package missing from workspace');
    return null;
  }

  if (!skipWasmBuild) {
    try {
      run('bash', ['compute/chart-render-wasm/build.sh', '--profile', 'release']);
    } catch (error) {
      errors.push(`@mog-sdk/chart-raster-wasm: ${error.message}`);
    }
  } else {
    console.log(`  SKIP chart raster WASM build (${checkOnly ? 'check-only' : 'skip-wasm-build'})`);
  }

  const missing = verifyPackageFiles(chartRasterPkg.manifest, chartRasterPkg.dir);
  if (missing.length > 0) {
    errors.push(`@mog-sdk/chart-raster-wasm: missing packaged WASM file(s): ${missing.join(', ')}`);
  }

  return chartRasterPkg;
}

const inventory = loadJsonc(join(ROOT, 'tools/package-inventory.jsonc'));
const workspacePackages = discoverWorkspacePackages();
const errors = [];

console.log('=== TS public facade artifacts ===');
let shipPublicNames = [];
try {
  shipPublicNames = orderedShipPublicPackages(inventory, workspacePackages);
  if (throughPackage) {
    const throughIndex = shipPublicNames.indexOf(throughPackage);
    if (throughIndex === -1) {
      throw new Error(`${throughPackage}: --through package is not a ship-public package`);
    }
    shipPublicNames = shipPublicNames.slice(0, throughIndex + 1);
  }
  console.log(`  build order: ${shipPublicNames.join(' -> ')}`);
} catch (error) {
  errors.push(error.message);
}

let generatedAssetPrerequisites = [];
try {
  generatedAssetPrerequisites = orderedGeneratedAssetPrerequisites(
    inventory,
    workspacePackages,
    shipPublicNames,
  );
} catch (error) {
  errors.push(error.message);
}

if (generatedAssetPrerequisites.length > 0) {
  console.log('\n=== Generated asset prerequisites ===');
}

for (const name of generatedAssetPrerequisites) {
  const pkg = workspacePackages.get(name);
  if (!pkg) {
    errors.push(`${name}: generated-asset prerequisite is not a workspace package`);
    continue;
  }

  if (!pkg.manifest.scripts?.build) {
    errors.push(`${name}: generated-asset prerequisite has no build script`);
    continue;
  }

  if (!skipTsBuild) {
    try {
      run('pnpm', ['--filter', name, 'build']);
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  } else {
    console.log(`  SKIP build ${name} (${checkOnly ? 'check-only' : 'skip-ts-build'})`);
  }
}

buildDeclarationPrerequisites(workspacePackages, errors);

const needsWasmArtifact = shipPublicNames.some((name) =>
  ['@mog-sdk/embed', '@mog-sdk/spreadsheet-app'].includes(name),
);
const wasmPkg = needsWasmArtifact ? buildWasmArtifact(workspacePackages, errors) : null;
if (!needsWasmArtifact) {
  console.log('\n=== WASM asset artifact ===');
  console.log(`  SKIP WASM build (not required by selected ship-public packages)`);
}
const needsChartRasterWasmArtifact = shipPublicNames.includes('@mog-sdk/sdk');
const chartRasterWasmPkg = needsChartRasterWasmArtifact
  ? buildChartRasterWasmArtifact(workspacePackages, errors)
  : null;
if (!needsChartRasterWasmArtifact) {
  console.log('\n=== Chart raster WASM asset artifact ===');
  console.log(`  SKIP chart raster WASM build (not required by selected ship-public packages)`);
}
let kernelArtifactBuilt = false;
let sdkArtifactBuilt = false;

for (const name of shipPublicNames) {
  const pkg = workspacePackages.get(name);
  if (!pkg) {
    errors.push(`${name}: ship-public package is not a workspace package`);
    continue;
  }

  if (!pkg.manifest.scripts?.build) {
    errors.push(`${name}: ship-public package has no build script`);
    continue;
  }

  if (name === '@mog-sdk/sdk' && !kernelArtifactBuilt) {
    buildKernelArtifact(errors);
    kernelArtifactBuilt = true;
  }

  if (!skipTsBuild) {
    try {
      run('pnpm', ['--filter', name, 'build']);
      if (name === '@mog-sdk/sdk') {
        sdkArtifactBuilt = true;
      }
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
      continue;
    }
  } else {
    console.log(`  SKIP build ${name} (${checkOnly ? 'check-only' : 'skip-ts-build'})`);
  }

  errors.push(...verifyPackageArtifact(pkg, inventory));
}

if (shipPublicNames.includes('@mog-sdk/contracts') && !skipTsBuild) {
  console.log('\n=== Contracts declaration finalization ===');
  try {
    run('pnpm', ['--filter', '@mog-sdk/contracts', 'build']);
  } catch (error) {
    errors.push(`@mog-sdk/contracts finalization: ${error.message}`);
  }
}

if (sdkArtifactBuilt && !skipTsBuild) {
  console.log('\n=== SDK artifact verification ===');
  try {
    run('pnpm', ['--filter', '@mog-sdk/sdk', 'verify-build']);
  } catch (error) {
    errors.push(`@mog-sdk/sdk: ${error.message}`);
  }
}

console.log('\n=== Host native artifact ===');
const hostNative = hostNativePackageName();
if (skipHostNativeArtifact) {
  console.log(
    `  SKIP host native artifact (${checkOnly ? 'check-only' : 'skip-host-native-artifact'})`,
  );
} else if (!hostNative) {
  errors.push(`unsupported host native platform: ${process.platform}/${process.arch}`);
} else if (!inventory[hostNative]) {
  errors.push(`${hostNative}: host native package missing from inventory`);
} else {
  const pkg = workspacePackages.get(hostNative);
  if (!pkg) {
    errors.push(`${hostNative}: host native package missing from workspace`);
  } else {
    if (!skipNativeBuild) {
      try {
        run('pnpm', ['-C', 'compute/napi', 'build:release']);
        const builtBinary = join(ROOT, 'compute/napi/compute-core-napi.node');
        if (existsSync(builtBinary)) {
          mkdirSync(pkg.dir, { recursive: true });
          copyFileSync(builtBinary, join(pkg.dir, 'compute-core-napi.node'));
        }
      } catch (error) {
        errors.push(`${hostNative}: ${error.message}`);
      }
    } else {
      console.log(
        `  SKIP native build ${hostNative} (${checkOnly ? 'check-only' : 'skip-native-build'})`,
      );
    }

    const missing = verifyPackageFiles(pkg.manifest, pkg.dir);
    if (missing.length > 0) {
      errors.push(`${hostNative}: missing packaged native file(s): ${missing.join(', ')}`);
    }
  }
}

console.log('\n=== Public artifact build report ===');
console.log(
  `  ship-public packages: ${Object.entries(inventory)
    .filter(([, e]) => e.disposition === 'ship-public')
    .map(([name]) => name)
    .sort()
    .join(', ')}`,
);
console.log(`  host native package: ${hostNative ?? '(unsupported)'}`);
console.log(`  wasm package: ${wasmPkg ? '@mog-sdk/wasm' : '(missing)'}`);
console.log(
  `  chart raster wasm package: ${chartRasterWasmPkg ? '@mog-sdk/chart-raster-wasm' : '(missing)'}`,
);

if (errors.length > 0) {
  console.error(
    `\nbuild:public-artifacts FAILED (${errors.length} error${errors.length === 1 ? '' : 's'}):`,
  );
  for (const error of errors) {
    console.error(`  ERROR: ${error}`);
  }
  process.exit(1);
}

console.log('\nbuild:public-artifacts PASSED');

/**
 * External fixture orchestration script.
 *
 * Builds ship-public packages, packs them into tarballs, validates packed
 * manifests, then runs each fixture in an isolated temp directory using npm
 * (not pnpm) to verify that packed artifacts work outside the monorepo.
 *
 * Usage:
 *   node fixtures/external/orchestrate.mjs
 *   node fixtures/external/orchestrate.mjs --skip-build   # skip build step
 *   node fixtures/external/orchestrate.mjs --skip-pack    # use existing tarballs
 *   node fixtures/external/orchestrate.mjs --manifest-only # stop after packed manifest validation
 *
 * Exit 0 if all required fixtures pass and all required packages are valid.
 * Exit 1 if any required build, pack, manifest validation, or fixture fails.
 */

import {
  packPackage,
  readPackedManifest,
  readPackedFileList,
  createFixtureEnv,
  assertTypecheck,
  assertRuntime,
  assertPackageScript,
  assertTypecheckFails,
  assertImportFails,
  cleanup,
  FixtureInstallError,
} from './shared/utils.mjs';
import { prepareContractsRuntimeInventoryFixture } from './shared/contracts-runtime-inventory.mjs';
import { resolve, dirname } from 'node:path';
import { readFileSync, readdirSync, existsSync, statSync, globSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { assertPublicPackedManifestHasNoPrivateFriendExports } from '../../tools/package-export-dispositions.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO = resolve(__dirname, '../..');

const skipBuild = process.argv.includes('--skip-build');
const skipPack = process.argv.includes('--skip-pack');
const manifestOnly = process.argv.includes('--manifest-only');

const inventory = loadJsonc(resolve(MONOREPO, 'tools/package-inventory.jsonc'));
const workspacePackages = discoverWorkspacePackages();
const {
  required: REQUIRED_PACK_TARGETS,
  optional: OPTIONAL_PACK_TARGETS,
  all: PACK_TARGETS,
} = loadPackTargets();

const optionalPackageNames = new Set(Object.keys(OPTIONAL_PACK_TARGETS));
const packTargetNames = new Set(Object.keys(PACK_TARGETS));
const tarballMap = {};
const buildResults = [];
const packResults = [];
const manifestResults = [];
const fixtureResults = [];

function loadJsonc(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(
    raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([\]}])/g, '$1'),
  );
}

function discoverWorkspacePackages() {
  const workspace = readFileSync(resolve(MONOREPO, 'pnpm-workspace.yaml'), 'utf-8');
  const patterns = [];
  let inPackages = false;

  for (const line of workspace.split('\n')) {
    if (/^packages:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const match = line.match(/^\s+-\s+['"]([^'"]+)['"]$/);
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
        ? [resolve(MONOREPO, 'package.json')]
        : globSync(resolve(MONOREPO, pattern, 'package.json'));

    for (const manifestPath of matches) {
      if (
        manifestPath.includes('/node_modules/') ||
        manifestPath.includes('/target') ||
        manifestPath.includes('/.claude/')
      ) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (manifest.name) {
        packages.set(manifest.name, {
          dir: dirname(manifestPath),
          manifest,
        });
      }
    }
  }

  return packages;
}

function loadPackTargets() {
  const required = {};
  const optional = {};

  for (const [inventoryName, entry] of Object.entries(inventory)) {
    if (!['ship-public', 'binary-wrapper'].includes(entry.disposition)) continue;

    const packageName = entry.publicTarget ?? inventoryName;
    const workspacePackage = workspacePackages.get(packageName);
    const target = {
      dir: workspacePackage?.dir ?? resolve(MONOREPO, '__missing__', packageName),
      inventory: entry,
    };

    if (entry.disposition === 'ship-public') {
      target.build = `pnpm --filter ${packageName} build`;
      target.requireBuildScript = true;
      required[packageName] = target;
      continue;
    }

    if (packageName === '@mog-sdk/wasm') {
      target.build = 'bash compute/wasm/build.sh --profile release';
      target.buildTimeoutMs = 900_000;
      required[packageName] = target;
      continue;
    }

    const platform = nativePlatformFromPackageName(packageName);
    if (platform && isHostNativePlatform(platform)) {
      required[packageName] = target;
    } else if (platform) {
      optional[packageName] = {
        ...target,
        reason: 'non-host native optional dependency',
      };
    } else {
      required[packageName] = target;
    }
  }

  return {
    required,
    optional,
    all: { ...required, ...optional },
  };
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

function orderedRequiredPackTargetEntries() {
  const entries = Object.entries(REQUIRED_PACK_TARGETS);
  const shipPublicEntries = entries.filter(
    ([, target]) => target.inventory.disposition === 'ship-public',
  );
  const otherEntries = entries.filter(
    ([, target]) => target.inventory.disposition !== 'ship-public',
  );
  const shipPublicNames = shipPublicEntries.map(([name]) => name);
  const shipPublicNameSet = new Set(shipPublicNames);
  const dependents = new Map(shipPublicNames.map((name) => [name, []]));
  const remainingDependencyCounts = new Map();

  for (const [name, target] of shipPublicEntries) {
    const manifest = workspacePackages.get(name)?.manifest;
    const deps = manifest
      ? [...workspaceDependencyNames(manifest)].filter((depName) => shipPublicNameSet.has(depName))
      : [];
    remainingDependencyCounts.set(name, deps.length);

    for (const depName of deps) {
      dependents.get(depName)?.push(name);
    }

    if (!workspacePackages.has(name) && existsSync(target.dir)) {
      remainingDependencyCounts.set(name, 0);
    }
  }

  const ready = shipPublicNames.filter((name) => remainingDependencyCounts.get(name) === 0);
  const orderedNames = [];

  while (ready.length > 0) {
    const name = ready.shift();
    orderedNames.push(name);

    for (const dependent of dependents.get(name) ?? []) {
      const remaining = (remainingDependencyCounts.get(dependent) ?? 0) - 1;
      remainingDependencyCounts.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
      }
    }
  }

  if (orderedNames.length !== shipPublicNames.length) {
    const cyclic = shipPublicNames.filter((name) => !orderedNames.includes(name)).join(', ');
    throw new Error(`ship-public package build graph contains a cycle: ${cyclic}`);
  }

  const byName = new Map(shipPublicEntries);
  return [...orderedNames.map((name) => [name, byName.get(name)]), ...otherEntries];
}

// ─── Step 1: Build ────────────────────────────────────────────────────────

if (!skipBuild && !skipPack) {
  console.log('=== Step 1: Build required packages ===');
  let orderedRequiredTargets;
  try {
    orderedRequiredTargets = orderedRequiredPackTargetEntries();
  } catch (e) {
    recordBuild('ship-public-order', false, e.message);
    orderedRequiredTargets = Object.entries(REQUIRED_PACK_TARGETS);
  }

  for (const [name, target] of orderedRequiredTargets) {
    if (!existsSync(target.dir)) {
      recordBuild(name, false, `directory not found: ${target.dir}`);
      continue;
    }

    if (!target.build) {
      recordBuild(name, true, 'no build command configured; using existing package contents');
      continue;
    }

    if (target.requireBuildScript && !hasBuildScript(target.dir)) {
      recordBuild(name, false, 'required public package has no build script');
      continue;
    }

    try {
      console.log(`  Building ${name}...`);
      execSync(target.build, {
        cwd: MONOREPO,
        stdio: 'inherit',
        timeout: target.buildTimeoutMs ?? 300_000,
      });
      recordBuild(name, true, 'built');
    } catch (e) {
      recordBuild(name, false, e.message);
    }
  }
} else {
  console.log('=== Step 1: Build SKIPPED ===');
}

// ─── Step 2: Pack ─────────────────────────────────────────────────────────

console.log('\n=== Step 2: Pack artifacts ===');

for (const [name, target] of Object.entries(PACK_TARGETS)) {
  if (!existsSync(target.dir)) {
    if (optionalPackageNames.has(name)) {
      recordPack(name, 'skipped', `optional ${target.reason}; directory not found`);
    } else {
      recordPack(name, 'failed', `required package directory not found: ${target.dir}`);
    }
    continue;
  }

  if (skipPack) {
    const tarball = expectedTarballPath(target.dir);
    if (existsSync(tarball)) {
      tarballMap[name] = tarball;
      recordPack(name, 'passed', `using existing tarball ${tarball}`);
    } else if (optionalPackageNames.has(name)) {
      recordPack(
        name,
        'skipped',
        `optional ${target.reason}; existing tarball not found at ${tarball}`,
      );
    } else {
      recordPack(name, 'failed', `required tarball not found at ${tarball}`);
    }
    continue;
  }

  try {
    tarballMap[name] = packPackage(target.dir);
    recordPack(name, 'passed', `packed ${tarballMap[name]}`);
  } catch (e) {
    if (optionalPackageNames.has(name)) {
      recordPack(name, 'skipped', `optional ${target.reason}; pack failed: ${e.message}`);
    } else {
      recordPack(name, 'failed', `required pack failed: ${e.message}`);
    }
  }
}

// ─── Step 3: Packed Manifest Validation ───────────────────────────────────

console.log('\n=== Step 3: Packed Manifest Validation ===');

for (const [name, tarball] of Object.entries(tarballMap)) {
  try {
    const manifest = readPackedManifest(tarball);
    const fileList = readPackedFileList(tarball);
    assertPublicPackedManifestHasNoPrivateFriendExports(inventory, manifest);
    const errors = validatePackedManifest(manifest, fileList, optionalPackageNames.has(name));
    if (errors.length > 0) {
      recordManifest(name, false, errors.join('; '));
    } else {
      recordManifest(name, true, 'manifest valid');
    }
  } catch (e) {
    recordManifest(name, false, `could not read packed manifest: ${e.message}`);
  }
}

if (manifestOnly) {
  reportAndExit('check:public-package-manifests');
}

// ─── Step 4: Positive Fixtures ────────────────────────────────────────────

console.log('\n=== Step 4: Positive Fixtures ===');

const positiveDir = resolve(__dirname, 'positive');
if (existsSync(positiveDir)) {
  for (const fixture of readdirSync(positiveDir).sort()) {
    const fixtureSrc = resolve(positiveDir, fixture);
    if (!statSync(fixtureSrc).isDirectory()) continue;
    runFixture('positive', fixture, fixtureSrc);
  }
}

// ─── Step 5: Negative Fixtures ────────────────────────────────────────────

console.log('\n=== Step 5: Negative Fixtures ===');

const negativeDir = resolve(__dirname, 'negative');
if (existsSync(negativeDir)) {
  for (const fixture of readdirSync(negativeDir).sort()) {
    const fixtureSrc = resolve(negativeDir, fixture);
    if (!statSync(fixtureSrc).isDirectory()) continue;
    runFixture('negative', fixture, fixtureSrc);
  }
}

// ─── Step 6: Stub detection ──────────────────────────────────────────────

console.log('\n=== Step 6: Stub Detection ===');

const requiredNonStubPositiveFixtures = [
  { fixtureName: 'kernel', packageName: '@mog-sdk/kernel' },
  { fixtureName: 'sheet-view', packageName: '@mog-sdk/sheet-view' },
].filter(({ packageName }) => packTargetNames.has(packageName));
for (const { fixtureName } of requiredNonStubPositiveFixtures) {
  const smokePath = resolve(__dirname, 'positive', fixtureName, 'smoke.ts');
  if (!existsSync(smokePath)) {
    recordFixture(
      'positive',
      fixtureName,
      'failed',
      `${fixtureName} positive fixture smoke.ts not found`,
    );
    continue;
  }

  const smokeContent = readFileSync(smokePath, 'utf-8');
  if (
    smokeContent.includes(`SKIP: ${fixtureName} fixture`) ||
    smokeContent.includes('facade package not yet created') ||
    smokeContent.includes('This fixture will be populated') ||
    smokeContent.includes('TODO: Uncomment')
  ) {
    recordFixture('positive', fixtureName, 'failed', `${fixtureName} fixture is still a stub`);
  } else {
    console.log(`  OK: ${fixtureName} fixture is not a stub`);
  }
}

// ─── Step 7: Report ───────────────────────────────────────────────────────

const requiredFixtures = fixtureResults.filter((result) => result.required);
const passedFixtures = fixtureResults.filter((result) => result.status === 'passed');
const failedFixtures = fixtureResults.filter((result) => result.status === 'failed');
const skippedFixtures = fixtureResults.filter((result) => result.status === 'skipped');
const failedBuilds = buildResults.filter((result) => result.status === 'failed');
const failedPacks = packResults.filter((result) => result.status === 'failed');
const failedManifests = manifestResults.filter((result) => result.status === 'failed');

console.log('\n=== Coverage Report ===');
console.log(`  Required fixtures: ${requiredFixtures.length}`);
console.log(`  Passed fixtures:   ${passedFixtures.length}`);
console.log(`  Failed fixtures:   ${failedFixtures.length}`);
console.log(`  Skipped fixtures:  ${skippedFixtures.length}`);

printResults('Required build failures', failedBuilds);
printResults('Pack failures', failedPacks);
printResults('Manifest failures', failedManifests);
printResults('Fixture failures', failedFixtures);
printResults('Fixture skips', skippedFixtures);

reportAndExit('check:external-fixtures');

function runFixture(kind, fixture, fixtureSrc) {
  const pkgJsonPath = resolve(fixtureSrc, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    recordFixture(kind, fixture, 'failed', 'required fixture has no package.json');
    return;
  }

  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  const requiredPkgs = fixturePackageDeps(pkgJson).filter((name) => name.startsWith('@mog-sdk/'));
  const missingTarballs = requiredPkgs.filter((name) => !tarballMap[name]);
  if (missingTarballs.length > 0) {
    const missingActiveTarballs = missingTarballs.filter((name) => packTargetNames.has(name));
    if (missingActiveTarballs.length === 0) {
      recordFixture(
        kind,
        fixture,
        'skipped',
        `depends on deferred public package(s): ${missingTarballs.join(', ')}`,
        { required: false },
      );
      return;
    }
    recordFixture(
      kind,
      fixture,
      'failed',
      `missing required tarballs: ${missingActiveTarballs.join(', ')}`,
    );
    return;
  }

  console.log(`\n  --- ${fixture}${kind === 'negative' ? ' (negative)' : ''} ---`);
  let tmpDir;
  try {
    tmpDir = createFixtureEnv(fixtureSrc, tarballMap);

    if (kind === 'positive' && fixture === 'contracts-runtime-values') {
      const coverage = prepareContractsRuntimeInventoryFixture(MONOREPO, tmpDir);
      console.log(
        `  contracts-runtime-values coverage: ${coverage.runtimeValueCount} retained runtime import(s) from ${coverage.generatedBy}`,
      );
    }

    if (kind === 'positive') {
      runPositiveFixture(fixture, fixtureSrc, tmpDir);
    } else {
      runNegativeFixture(fixture, fixtureSrc, tmpDir);
    }
  } catch (e) {
    if (e instanceof FixtureInstallError) {
      const detail = formatInstallFailure(e);
      recordFixture(kind, fixture, 'failed', `install failed before fixture assertions: ${detail}`);
    } else {
      recordFixture(kind, fixture, 'failed', e.message);
    }
  } finally {
    if (tmpDir) cleanup(tmpDir);
  }
}

function runPositiveFixture(fixture, fixtureSrc, tmpDir) {
  const tcOk = assertTypecheck(tmpDir, fixture);
  if (!tcOk) {
    recordFixture('positive', fixture, 'failed', 'typecheck failed');
    return;
  }

  const tmpPkgJson = JSON.parse(readFileSync(resolve(tmpDir, 'package.json'), 'utf-8'));
  if (tmpPkgJson.scripts?.test) {
    if (!assertPackageScript(tmpDir, 'test', `${fixture} fixture test`)) {
      recordFixture('positive', fixture, 'failed', 'fixture npm test failed');
      return;
    }
    recordFixture('positive', fixture, 'passed', 'typecheck and fixture npm test passed');
    return;
  }

  const hasSmokeTs = existsSync(resolve(fixtureSrc, 'smoke.ts'));
  const hasSmokeMjs = existsSync(resolve(fixtureSrc, 'smoke.mjs'));
  if (hasSmokeTs && !assertRuntime(tmpDir, 'smoke.ts', `${fixture} runtime`)) {
    recordFixture('positive', fixture, 'failed', 'runtime smoke.ts failed');
    return;
  }
  if (hasSmokeMjs && !assertRuntime(tmpDir, 'smoke.mjs', `${fixture} runtime`)) {
    recordFixture('positive', fixture, 'failed', 'runtime smoke.mjs failed');
    return;
  }

  recordFixture('positive', fixture, 'passed', 'passed');
}

function runNegativeFixture(fixture, fixtureSrc, tmpDir) {
  const tcFailed = assertTypecheckFails(tmpDir, fixture);
  if (!tcFailed) {
    recordFixture('negative', fixture, 'failed', 'expected typecheck failure but typecheck passed');
    return;
  }

  const hasRuntimeMjs = existsSync(resolve(fixtureSrc, 'runtime.mjs'));
  if (hasRuntimeMjs) {
    const importFailed = assertImportFails(tmpDir, 'runtime.mjs', `${fixture} runtime`);
    if (!importFailed) {
      recordFixture(
        'negative',
        fixture,
        'failed',
        'expected runtime import failure but import passed',
      );
      return;
    }
  }

  recordFixture(
    'negative',
    fixture,
    'passed',
    'expected failure observed after successful install',
  );
}

function fixturePackageDeps(pkgJson) {
  const names = new Set();
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys(pkgJson[field] || {})) {
      names.add(name);
    }
  }
  return [...names];
}

function validatePackedManifest(manifest, fileList, optionalArtifactFiles) {
  const packageName = manifest.name ?? '<unnamed>';
  const errors = [];
  const inventoryEntry = inventory[packageName];
  const dependencyFields = [
    'dependencies',
    'peerDependencies',
    'optionalDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ];

  if (!inventoryEntry) {
    errors.push(`package is not classified in tools/package-inventory.jsonc`);
  } else if (!['ship-public', 'binary-wrapper'].includes(inventoryEntry.disposition)) {
    errors.push(`inventory disposition ${inventoryEntry.disposition} is not externally packable`);
  } else {
    if (inventoryEntry.publicTarget !== packageName) {
      errors.push(
        `inventory publicTarget ${inventoryEntry.publicTarget} does not match packed name`,
      );
    }
    if (manifest.private === true) {
      errors.push(`public ${inventoryEntry.disposition} package must not pack with private: true`);
    }
  }

  for (const field of dependencyFields) {
    const deps = manifest[field];
    if (!deps) continue;

    if (Array.isArray(deps)) {
      for (const depName of deps) {
        if (isForbiddenInternalPackage(depName) && manifest.private !== true) {
          errors.push(`${field}.${depName} exposes forbidden internal package`);
        }
      }
      continue;
    }

    for (const [depName, spec] of Object.entries(deps)) {
      if (isWorkspaceReference(spec)) {
        errors.push(`${field}.${depName} uses forbidden workspace reference ${spec}`);
      }
      if (isForbiddenInternalPackage(depName) && manifest.private !== true) {
        errors.push(`${field}.${depName} exposes forbidden internal package`);
      }
      if (depName.startsWith('@mog-sdk/')) {
        const depInventory = inventory[depName];
        if (!depInventory) {
          errors.push(`${field}.${depName} is not classified in package inventory`);
        } else if (!['ship-public', 'binary-wrapper'].includes(depInventory.disposition)) {
          errors.push(
            `${field}.${depName} points at non-public ${depInventory.disposition} package`,
          );
        } else {
          const depWorkspaceManifest = workspacePackages.get(depName)?.manifest;
          if (depWorkspaceManifest?.version && spec !== depWorkspaceManifest.version) {
            errors.push(
              `${field}.${depName} uses ${spec}; expected exact lock-step version ${depWorkspaceManifest.version}`,
            );
          }
        }
      }
    }
  }

  for (const depName of Object.keys(manifest.devDependencies || {})) {
    if (depName === '@mog/compute-core-napi' && manifest.private !== true) {
      errors.push(`devDependencies.${depName} exposes private native package`);
    }
  }
  if (manifest.devDependencies && Object.keys(manifest.devDependencies).length > 0) {
    errors.push(`public packed manifest must not include devDependencies`);
  }

  if (isForbiddenInternalPackage(packageName)) {
    errors.push(`pack target itself is forbidden internal package ${packageName}`);
  }

  if (!optionalArtifactFiles && Array.isArray(manifest.files)) {
    for (const fileEntry of manifest.files) {
      if (typeof fileEntry !== 'string') continue;
      if (!packedFilesEntryExists(fileList, fileEntry)) {
        errors.push(`files entry ${fileEntry} is not included in packed tarball`);
      }
    }
  }

  for (const exportTarget of collectExportTargets(manifest.exports)) {
    if (!packedPathExists(fileList, exportTarget)) {
      errors.push(`exports target ${exportTarget} is not included in packed tarball`);
    }
  }

  for (const [binName, binTarget] of binEntries(manifest)) {
    if (!String(binTarget).startsWith('./dist/')) {
      errors.push(`bin.${binName} target ${binTarget} must point at ./dist/*`);
    }
    if (!packedPathExists(fileList, binTarget)) {
      errors.push(`bin.${binName} target ${binTarget} is not included in packed tarball`);
    }
  }

  for (const filePath of fileList) {
    if (
      filePath.startsWith('src/') ||
      filePath.startsWith('testing/') ||
      filePath.startsWith('scripts/')
    ) {
      errors.push(`source/test/internal script file packed: ${filePath}`);
    }
  }

  const developmentExportSubpaths = collectDevelopmentExportSubpaths(manifest.exports);
  if (developmentExportSubpaths.length > 0) {
    errors.push(
      `exports contain forbidden development condition(s): ${developmentExportSubpaths.join(', ')}`,
    );
  }

  return errors;
}

function reportAndExit(gateName) {
  const requiredFixtures = fixtureResults.filter((result) => result.required);
  const passedFixtures = fixtureResults.filter((result) => result.status === 'passed');
  const failedFixtures = fixtureResults.filter((result) => result.status === 'failed');
  const skippedFixtures = fixtureResults.filter((result) => result.status === 'skipped');
  const failedBuilds = buildResults.filter((result) => result.status === 'failed');
  const failedPacks = packResults.filter((result) => result.status === 'failed');
  const failedManifests = manifestResults.filter((result) => result.status === 'failed');

  if (manifestOnly) {
    console.log('\n=== Coverage Report ===');
    printResults('Required build failures', failedBuilds);
    printResults('Pack failures', failedPacks);
    printResults('Manifest failures', failedManifests);
  }

  const failed =
    failedBuilds.length +
    failedPacks.length +
    failedManifests.length +
    failedFixtures.length +
    skippedFixtures.filter((result) => result.required).length;

  if (!manifestOnly) {
    console.log(
      `\n=== Results: ${passedFixtures.length} fixtures passed, ${failedFixtures.length} failed, ${skippedFixtures.length} skipped ===`,
    );
  }

  if (failed > 0) {
    console.error(`\n${gateName} FAILED`);
    process.exit(1);
  }

  console.log(`\n${gateName} PASSED`);
  process.exit(0);
}

function binEntries(manifest) {
  if (!manifest.bin) return [];
  if (typeof manifest.bin === 'string') return [[manifest.name ?? '<unnamed>', manifest.bin]];
  if (typeof manifest.bin !== 'object' || Array.isArray(manifest.bin)) return [];
  return Object.entries(manifest.bin).filter(([, target]) => typeof target === 'string');
}

function collectDevelopmentExportSubpaths(exportsField) {
  const subpaths = [];
  if (!exportsField || typeof exportsField !== 'object' || Array.isArray(exportsField)) {
    return subpaths;
  }
  for (const [subpath, value] of Object.entries(exportsField)) {
    if (exportTargetHasDevelopmentCondition(value)) {
      subpaths.push(subpath);
    }
  }
  return subpaths;
}

function exportTargetHasDevelopmentCondition(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((item) => exportTargetHasDevelopmentCondition(item));
  }
  if (Object.prototype.hasOwnProperty.call(value, 'development')) {
    return true;
  }
  return Object.values(value).some((item) => exportTargetHasDevelopmentCondition(item));
}

function isWorkspaceReference(spec) {
  return (
    typeof spec === 'string' &&
    (spec.startsWith('workspace:') || spec.startsWith('link:') || spec.startsWith('file:'))
  );
}

function isForbiddenInternalPackage(name) {
  return (
    typeof name === 'string' &&
    (name.startsWith('@mog/') ||
      name === '@mog-sdk/spreadsheet-contracts' ||
      name.startsWith('@mog-sdk/types-') ||
      name.startsWith('@mog/types-') ||
      name.startsWith('@rust-bridge/'))
  );
}

function collectExportTargets(exportsField) {
  const targets = [];
  collectExportTargetsInto(exportsField, targets);
  return targets;
}

function collectExportTargetsInto(value, targets) {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.startsWith('./')) {
      targets.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectExportTargetsInto(item, targets);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectExportTargetsInto(item, targets);
    }
  }
}

function packedPathExists(fileList, exportTarget) {
  const normalized = exportTarget.replace(/^\.\//, '');
  return fileList.has(normalized);
}

function packedFilesEntryExists(fileList, fileEntry) {
  const normalized = fileEntry.replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized) return true;
  if (fileList.has(normalized)) return true;
  return [...fileList].some((filePath) => filePath.startsWith(`${normalized}/`));
}

function isHostNativePlatform(platform) {
  if (process.platform === 'darwin') {
    return platform === `darwin-${process.arch}`;
  }
  if (process.platform === 'win32') {
    return platform === `win32-${process.arch}-msvc`;
  }
  if (process.platform === 'linux') {
    return platform === `linux-${process.arch}-gnu`;
  }
  return false;
}

function nativePlatformFromPackageName(packageName) {
  const match = packageName.match(
    /^@mog-sdk\/(darwin-(?:arm64|x64)|linux-(?:arm64|x64)-(?:gnu|musl)|win32-x64-msvc)$/,
  );
  return match?.[1] ?? null;
}

function expectedTarballPath(packageDir) {
  const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf-8'));
  const fileName = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`;
  return resolve(tmpdir(), fileName);
}

function hasBuildScript(packageDir) {
  const pkg = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf-8'));
  return typeof pkg.scripts?.build === 'string' && pkg.scripts.build.trim().length > 0;
}

function recordBuild(name, ok, reason) {
  const status = ok ? 'passed' : 'failed';
  buildResults.push({ name, status, reason });
  console.log(`  ${status.toUpperCase()}: ${name} (${reason})`);
}

function recordPack(name, status, reason) {
  packResults.push({ name, status, reason });
  console.log(`  ${status.toUpperCase()}: ${name} (${reason})`);
}

function recordManifest(name, ok, reason) {
  const status = ok ? 'passed' : 'failed';
  manifestResults.push({ name, status, reason });
  console.log(`  ${status.toUpperCase()}: ${name} (${reason})`);
}

function recordFixture(kind, name, status, reason, options = {}) {
  const result = {
    kind,
    name,
    status,
    reason,
    required: options.required ?? true,
  };
  fixtureResults.push(result);
  console.log(`  ${status.toUpperCase()}: ${kind}/${name} (${reason})`);
}

function printResults(label, results) {
  console.log(`\n  ${label}: ${results.length}`);
  for (const result of results) {
    const name = result.kind ? `${result.kind}/${result.name}` : result.name;
    console.log(`    - ${name}: ${result.reason}`);
  }
}

function formatInstallFailure(error) {
  const output = `${error.stdout}\n${error.stderr}`.trim();
  return output.split('\n').filter(Boolean).slice(-6).join(' | ') || error.message;
}

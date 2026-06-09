/**
 * Shared utilities for external fixture orchestration.
 *
 * Provides helpers for packing, installing, typechecking, runtime testing,
 * and cleanup of isolated fixture environments.
 */

import { execSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdtempSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  createPublicPackageCandidate,
  discoverWorkspacePackages,
} from '../../../tools/public-package-manifest.mjs';
import { loadPackageInventory } from '../../../tools/package-export-dispositions.mjs';

export class FixtureInstallError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'FixtureInstallError';
    this.cause = cause;
    this.stdout = cause?.stdout?.toString?.() ?? cause?.stdout ?? '';
    this.stderr = cause?.stderr?.toString?.() ?? cause?.stderr ?? '';
  }
}

/**
 * Pack a workspace package into the same release candidate shape used by publish flows.
 * @param {string} packageDir - Absolute path to the workspace package directory
 * @returns {string} Absolute path to the created tarball
 */
export function packPackage(packageDir) {
  const inventory = loadPackageInventory();
  const workspacePackages = discoverWorkspacePackages();
  const manifestPath = resolve(packageDir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const packDir = mkdtempSync(resolve(tmpdir(), 'mog-pack-'));
  createPublicPackageCandidate(manifest.name, {
    inventory,
    workspacePackages,
    outDir: packDir,
  });

  const packOutput = execSync('npm pack --pack-destination /tmp --json', {
    cwd: packDir,
    encoding: 'utf-8',
  }).trim();
  const packMetadata = JSON.parse(packOutput);
  const tarballName = packMetadata.at(0)?.filename;
  if (!tarballName) {
    throw new Error(`npm pack did not report a tarball filename for ${packageDir}`);
  }
  return resolve('/tmp', tarballName);
}

/**
 * Read the package.json bundled inside an npm tarball.
 * @param {string} tarballPath - Absolute path to a .tgz created by npm pack
 * @returns {Record<string, unknown>} Parsed package.json contents
 */
export function readPackedManifest(tarballPath) {
  const manifestJson = execSync(`tar -xOf ${shellQuote(tarballPath)} package/package.json`, {
    encoding: 'utf-8',
    env: { ...process.env, LC_ALL: 'C' },
    timeout: 30_000,
  });
  return JSON.parse(manifestJson);
}

/**
 * List files bundled inside an npm tarball, with the package/ prefix removed.
 * @param {string} tarballPath - Absolute path to a .tgz created by npm pack
 * @returns {Set<string>} Tarball file paths relative to the package root
 */
export function readPackedFileList(tarballPath) {
  const output = execSync(`tar -tzf ${shellQuote(tarballPath)}`, {
    encoding: 'utf-8',
    env: { ...process.env, LC_ALL: 'C' },
    timeout: 30_000,
  });
  return new Set(
    output
      .split('\n')
      .filter(Boolean)
      .map((entry) => entry.replace(/^package\//, '')),
  );
}

/**
 * Create an isolated fixture environment in a temp directory.
 * Copies the fixture source and rewrites package.json dependencies
 * to point at packed tarballs.
 *
 * @param {string} fixtureSrcDir - Path to the fixture source directory
 * @param {Record<string, string>} tarballMap - Map of package name to tarball path
 * @returns {string} Path to the temporary working directory
 */
export function createFixtureEnv(fixtureSrcDir, tarballMap) {
  const tmpDir = resolve(tmpdir(), `mog-fixture-${randomBytes(6).toString('hex')}`);
  mkdirSync(tmpDir, { recursive: true });
  cpSync(fixtureSrcDir, tmpDir, { recursive: true });

  // Rewrite package.json to use tarball paths
  const pkgPath = resolve(tmpDir, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

    for (const depField of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (!pkg[depField]) continue;
      for (const [name, _version] of Object.entries(pkg[depField])) {
        if (tarballMap[name]) {
          pkg[depField][name] = `file:${tarballMap[name]}`;
        }
      }
    }
    // Public SDK packages can depend on each other. Install only the packed
    // public SDK transitive closure needed by this fixture so dependencies
    // resolve locally without introducing unrelated peer conflicts.
    pkg.dependencies ??= {};
    for (const name of publicSdkDependencyClosure(pkg, tarballMap)) {
      const tarballPath = tarballMap[name];
      if (tarballPath && !pkg.dependencies[name]) {
        pkg.dependencies[name] = `file:${tarballPath}`;
      }
    }
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
  }

  // Install with npm (not pnpm) to avoid workspace resolution
  try {
    execSync('npm install --ignore-scripts', {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: 120_000,
    });
  } catch (e) {
    throw new FixtureInstallError('npm install failed', e);
  }

  return tmpDir;
}

function isPlatformBinaryPackage(name) {
  return /^@mog-sdk\/(?:darwin-(?:arm64|x64)|linux-(?:arm64|x64)-(?:gnu|musl)|win32-x64-msvc)$/.test(
    name,
  );
}

function isCurrentPlatformBinaryPackage(name) {
  if (process.platform === 'darwin') {
    return name === `@mog-sdk/darwin-${process.arch}`;
  }
  if (process.platform === 'win32') {
    return process.arch === 'x64' && name === '@mog-sdk/win32-x64-msvc';
  }
  if (process.platform === 'linux') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const libc = process.report?.getReport?.().header.glibcVersionRuntime ? 'gnu' : 'musl';
    return name === `@mog-sdk/linux-${arch}-${libc}`;
  }
  return false;
}

function publicSdkDependencyClosure(pkg, tarballMap) {
  const seen = new Set();
  const queue = [];

  for (const name of packageDependencyNames(pkg)) {
    if (tarballMap[name]) {
      seen.add(name);
      queue.push(name);
    }
  }

  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    const manifest = readPackedManifest(tarballMap[name]);
    for (const depName of publicSdkDependencyNamesForPackedManifest(manifest, tarballMap)) {
      if (seen.has(depName)) continue;
      seen.add(depName);
      queue.push(depName);
    }
  }

  return [...seen].filter(
    (name) => !isPlatformBinaryPackage(name) || isCurrentPlatformBinaryPackage(name),
  );
}

function packageDependencyNames(pkg) {
  const names = new Set();
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const name of Object.keys(pkg[field] ?? {})) {
      names.add(name);
    }
  }
  return names;
}

function publicSdkDependencyNamesForPackedManifest(manifest, tarballMap) {
  const names = new Set();
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (name.startsWith('@mog-sdk/') && tarballMap[name]) {
        names.add(name);
      }
    }
  }
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    if (
      name.startsWith('@mog-sdk/') &&
      tarballMap[name] &&
      (!isPlatformBinaryPackage(name) || isCurrentPlatformBinaryPackage(name))
    ) {
      names.add(name);
    }
  }
  return names;
}

/**
 * Assert that tsc --noEmit passes for the fixture.
 * @param {string} fixtureDir - Path to the fixture working directory
 * @param {string} label - Human-readable label for reporting
 * @returns {boolean} true if typecheck passed
 */
export function assertTypecheck(fixtureDir, label) {
  try {
    execSync('npx tsc --noEmit', {
      cwd: fixtureDir,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    console.log(`  PASS [typecheck]: ${label}`);
    return true;
  } catch (e) {
    console.error(`  FAIL [typecheck]: ${label}`);
    console.error(e.stdout || e.stderr || e.message);
    return false;
  }
}

/**
 * Assert that a Node.js script runs successfully.
 * @param {string} fixtureDir - Path to the fixture working directory
 * @param {string} script - Script path relative to fixtureDir
 * @param {string} label - Human-readable label for reporting
 * @returns {boolean} true if runtime test passed
 */
export function assertRuntime(fixtureDir, script, label) {
  try {
    execSync(`node ${script}`, {
      cwd: fixtureDir,
      encoding: 'utf-8',
      timeout: 30_000,
    });
    console.log(`  PASS [runtime]: ${label}`);
    return true;
  } catch (e) {
    console.error(`  FAIL [runtime]: ${label}`);
    console.error(e.stdout || e.stderr || e.message);
    return false;
  }
}

/**
 * Run an npm package script in a fixture environment.
 * @param {string} fixtureDir - Path to the fixture working directory
 * @param {string} script - npm script name
 * @param {string} label - Human-readable label for reporting
 * @returns {boolean} true if the script passed
 */
export function assertPackageScript(fixtureDir, script, label) {
  try {
    execSync(`npm run ${script}`, {
      cwd: fixtureDir,
      encoding: 'utf-8',
      timeout: 120_000,
    });
    console.log(`  PASS [script:${script}]: ${label}`);
    return true;
  } catch (e) {
    console.error(`  FAIL [script:${script}]: ${label}`);
    console.error(e.stdout || e.stderr || e.message);
    return false;
  }
}

/**
 * Assert that tsc --noEmit FAILS for the fixture (negative test).
 * @param {string} fixtureDir - Path to the fixture working directory
 * @param {string} label - Human-readable label for reporting
 * @returns {boolean} true if typecheck correctly failed
 */
export function assertTypecheckFails(fixtureDir, label) {
  try {
    execSync('npx tsc --noEmit', {
      cwd: fixtureDir,
      encoding: 'utf-8',
      timeout: 60_000,
    });
    console.error(`  FAIL [neg-typecheck]: ${label} -- expected tsc failure but it succeeded`);
    return false;
  } catch (_e) {
    console.log(`  PASS [neg-typecheck]: ${label} -- tsc correctly failed`);
    return true;
  }
}

/**
 * Assert that a Node.js import FAILS at runtime (negative test).
 * @param {string} fixtureDir - Path to the fixture working directory
 * @param {string} script - Script path relative to fixtureDir
 * @param {string} label - Human-readable label for reporting
 * @returns {boolean} true if import correctly failed
 */
export function assertImportFails(fixtureDir, script, label) {
  try {
    execSync(`node ${script}`, {
      cwd: fixtureDir,
      encoding: 'utf-8',
      timeout: 15_000,
    });
    console.error(`  FAIL [neg-import]: ${label} -- expected import failure but it succeeded`);
    return false;
  } catch (_e) {
    console.log(`  PASS [neg-import]: ${label} -- import correctly failed`);
    return true;
  }
}

/**
 * Remove a temporary fixture directory.
 * @param {string} tmpDir - Path to remove
 */
export function cleanup(tmpDir) {
  rmSync(tmpDir, { recursive: true, force: true });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

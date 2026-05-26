/**
 * Smoke test: simulate end-user installation of @mog-sdk/node.
 *
 * Packs the SDK into a tarball, extracts it into an isolated temp directory,
 * and attempts to import the ESM and CJS bundles. This catches packaging bugs
 * like leaked workspace imports (e.g. @mog-sdk/contracts) that
 * would cause ERR_PACKAGE_PATH_NOT_EXPORTED or ERR_MODULE_NOT_FOUND for users.
 *
 * Usage:
 *   node scripts/smoke-test.mjs           # run after `pnpm build`
 *   node scripts/smoke-test.mjs --quick   # skip CJS check
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = resolve(__dirname, '..');

const quick = process.argv.includes('--quick');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    failed++;
  } else {
    console.log(`  PASS: ${message}`);
    passed++;
  }
}

// ── 1. Pack the SDK ────────────────────────────────────────────────────────

console.log('\n--- 1. npm pack ---');

const packDir = resolve(tmpdir(), `mog-sdk-smoke-pack-${randomBytes(4).toString('hex')}`);
mkdirSync(packDir, { recursive: true });

const packOutput = execSync(`npm pack --pack-destination "${packDir}" 2>&1`, {
  cwd: SDK_ROOT,
  encoding: 'utf-8',
}).trim();

// npm pack prints the tarball filename on the last line
const tarballName = packOutput.split('\n').pop().trim();
const tarball = resolve(packDir, tarballName);
assert(existsSync(tarball), `tarball created: ${tarballName}`);

// ── 2. Extract into isolated temp dir ──────────────────────────────────────

console.log('\n--- 2. Extract to isolated directory ---');

const testDir = resolve(tmpdir(), `mog-sdk-smoke-${randomBytes(4).toString('hex')}`);
mkdirSync(testDir, { recursive: true });

execSync(`tar xzf "${tarball}" -C "${testDir}"`, { encoding: 'utf-8' });

// npm pack extracts into a `package/` subdirectory
const pkgDir = resolve(testDir, 'package');
assert(existsSync(resolve(pkgDir, 'dist', 'index.js')), 'ESM bundle present in tarball');
assert(existsSync(resolve(pkgDir, 'dist', 'index.cjs')), 'CJS bundle present in tarball');

// ── 3. ESM import in isolation ─────────────────────────────────────────────

console.log('\n--- 3. ESM import (isolated) ---');

// Write a mini test script that imports the SDK just like a user would.
// We point directly at the extracted package — no node_modules, no workspace.
// Any leaked external import will fail here.
const esmTestScript = resolve(testDir, 'test-esm.mjs');
writeFileSync(
  esmTestScript,
  `
import { createRequire } from 'node:module';

// Resolve the package directly (simulates npm install without workspace deps)
const distIndex = new URL('./package/dist/index.js', import.meta.url);

try {
  const sdk = await import(distIndex);
  const exports = Object.keys(sdk);

  // Basic sanity: key exports exist
  const required = ['createWorkbook'];
  const missing = required.filter(name => !(name in sdk));

  if (missing.length > 0) {
    console.error('MISSING_EXPORTS:' + missing.join(','));
    process.exit(2);
  }
  if ('DocumentFactory' in sdk) {
    console.error('FORBIDDEN_EXPORT:DocumentFactory');
    process.exit(3);
  }

  console.log('OK:' + exports.length + ' exports');
  process.exit(0);
} catch (e) {
  console.error('IMPORT_ERROR:' + e.code + ':' + e.message);
  process.exit(1);
}
`,
);

try {
  const esmResult = execSync(`node "${esmTestScript}" 2>&1`, {
    encoding: 'utf-8',
    timeout: 15000,
  }).trim();

  if (esmResult.startsWith('OK:')) {
    assert(true, `ESM import succeeded (${esmResult})`);
  } else {
    assert(false, `ESM import unexpected output: ${esmResult}`);
  }
} catch (e) {
  const stderr = (e.stderr || e.stdout || e.message).trim();
  if (stderr.includes('ERR_MODULE_NOT_FOUND') && stderr.includes('@mog-sdk/kernel')) {
    console.log(
      `  SKIP: ESM import skipped (declared @mog-sdk/kernel dependency not installed in direct extraction)`,
    );
  } else if (stderr.includes('IMPORT_ERROR:')) {
    assert(false, `ESM import failed — leaked external dependency: ${stderr}`);
  } else if (stderr.includes('MISSING_EXPORTS:')) {
    assert(false, `ESM import missing exports: ${stderr}`);
  } else if (
    stderr.includes('compute-core') ||
    stderr.includes('NAPI') ||
    stderr.includes('.node')
  ) {
    // Native addon not available — expected outside full build environment
    console.log(`  SKIP: ESM import skipped (native addon not available)`);
  } else {
    assert(false, `ESM import failed: ${stderr}`);
  }
}

// ── 4. CJS require in isolation ────────────────────────────────────────────

if (!quick) {
  console.log('\n--- 4. CJS require (isolated) ---');

  const cjsTestScript = resolve(testDir, 'test-cjs.cjs');
  writeFileSync(
    cjsTestScript,
    `
const path = require('path');

try {
  const sdk = require(path.join(__dirname, 'package', 'dist', 'index.cjs'));
  const exports = Object.keys(sdk);

  const required = ['createWorkbook'];
  const missing = required.filter(name => !(name in sdk));

  if (missing.length > 0) {
    console.error('MISSING_EXPORTS:' + missing.join(','));
    process.exit(2);
  }
  if ('DocumentFactory' in sdk) {
    console.error('FORBIDDEN_EXPORT:DocumentFactory');
    process.exit(3);
  }

  console.log('OK:' + exports.length + ' exports');
  process.exit(0);
} catch (e) {
  console.error('REQUIRE_ERROR:' + (e.code || '') + ':' + e.message);
  process.exit(1);
}
`,
  );

  try {
    const cjsResult = execSync(`node "${cjsTestScript}" 2>&1`, {
      encoding: 'utf-8',
      timeout: 15000,
    }).trim();

    if (cjsResult.startsWith('OK:')) {
      assert(true, `CJS require succeeded (${cjsResult})`);
    } else {
      assert(false, `CJS require unexpected output: ${cjsResult}`);
    }
  } catch (e) {
    const stderr = (e.stderr || e.stdout || e.message).trim();
    if (stderr.includes('MODULE_NOT_FOUND') && stderr.includes('@mog-sdk/kernel')) {
      console.log(
        `  SKIP: CJS require skipped (declared @mog-sdk/kernel dependency not installed in direct extraction)`,
      );
    } else if (stderr.includes('REQUIRE_ERROR:')) {
      assert(false, `CJS require failed — leaked external dependency: ${stderr}`);
    } else if (
      stderr.includes('compute-core') ||
      stderr.includes('NAPI') ||
      stderr.includes('.node')
    ) {
      console.log(`  SKIP: CJS require skipped (native addon not available)`);
    } else {
      assert(false, `CJS require failed: ${stderr}`);
    }
  }
}

// ── Cleanup ────────────────────────────────────────────────────────────────

rmSync(testDir, { recursive: true, force: true });
rmSync(packDir, { recursive: true, force: true });

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\n=== Smoke test: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);

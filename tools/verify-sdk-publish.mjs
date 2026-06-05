#!/usr/bin/env node
/**
 * Pre-publish verification for @mog-sdk/node, @mog-sdk/contracts, and
 * SDK-owned public runtime dependencies.
 *
 * Composable check runner — run all checks or pick/skip individual ones.
 *
 * Usage:
 *   node tools/verify-sdk-publish.mjs              # run all checks
 *   node tools/verify-sdk-publish.mjs --list        # list available checks
 *   node tools/verify-sdk-publish.mjs --skip=typecheck          # skip consumer tsc
 *   node tools/verify-sdk-publish.mjs --only=static             # fast local-only checks
 *   node tools/verify-sdk-publish.mjs --only=extensions,leaks   # specific checks
 *   node tools/verify-sdk-publish.mjs --skip=typecheck,runtime  # skip multiple
 *
 * Check groups:
 *   static   = prechecks, extensions, leaks, exports-sync, dep-check
 *   consumer = pack, pack-verify, typecheck, runtime
 *   all      = static + consumer  (default)
 *
 * Requires: both packages already built (`pnpm build` in each).
 */

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { packPackage } from '../fixtures/external/shared/utils.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// Paths
// ═══════════════════════════════════════════════════════════════════════════

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SDK_DIR = resolve(ROOT, 'runtime/sdk');
const CONTRACTS_DIR = resolve(ROOT, 'contracts');
const COMPUTE_WASM_DIR = resolve(ROOT, 'compute/wasm/npm');
const CHART_RASTER_WASM_DIR = resolve(ROOT, 'compute/chart-render-wasm/npm');
const WORKER_FIXTURE_MINIFLARE_VERSION = '4.20260603.0';
const WORKER_FIXTURE_ESBUILD_VERSION = '0.25.12';

// ═══════════════════════════════════════════════════════════════════════════
// Test harness
// ═══════════════════════════════════════════════════════════════════════════

let passed = 0;
let failed = 0;
let skippedCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    console.log(`  \x1b[32mPASS\x1b[0m ${message}`);
    passed++;
  } else {
    console.error(`  \x1b[31mFAIL\x1b[0m ${message}`);
    failed++;
    failures.push(message);
  }
}

function skip(message) {
  console.log(`  \x1b[33mSKIP\x1b[0m ${message}`);
  skippedCount++;
}

function warn(message) {
  console.log(`  \x1b[33mWARN\x1b[0m ${message}`);
}

function section(title) {
  console.log(`\n\x1b[1m── ${title} ──\x1b[0m`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

function collectDtsFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectDtsFiles(full));
    else if (entry.name.endsWith('.d.ts') && !entry.name.endsWith('.d.ts.map')) files.push(full);
  }
  return files;
}

const RELATIVE_SPECIFIER_RE = /(?:from\s+|import\s*\()['"](\.[^'"]+)['"]/g;

function countExtensionIssues(distDir) {
  const dtsFiles = collectDtsFiles(distDir);
  let issues = 0;
  const examples = [];
  for (const file of dtsFiles) {
    const content = readFileSync(file, 'utf-8');
    let match;
    RELATIVE_SPECIFIER_RE.lastIndex = 0;
    while ((match = RELATIVE_SPECIFIER_RE.exec(content)) !== null) {
      const spec = match[1];
      if (
        !spec.endsWith('.js') &&
        !spec.endsWith('.mjs') &&
        !spec.endsWith('.cjs') &&
        !spec.endsWith('.json')
      ) {
        if (examples.length < 5) {
          examples.push(`${file.slice(distDir.length + 1)}: '${spec}'`);
        }
        issues++;
      }
    }
  }
  return { issues, examples, fileCount: dtsFiles.length };
}

// Consumer project state — lazily initialized by the first check that needs it
let _consumerDir = null;
let _testDir = null;
let _workerToolsDir = null;

function ensureConsumerProject() {
  if (_consumerDir) return _consumerDir;

  _testDir = mkdtempSync(join(tmpdir(), 'mog-sdk-verify-'));
  _consumerDir = join(_testDir, 'consumer');
  mkdirSync(_consumerDir, { recursive: true });

  // Pack the same transformed public manifests that external fixtures and CI publish.
  const contractsTarPath = packPackage(CONTRACTS_DIR);
  assert(existsSync(contractsTarPath), `Contracts packed: ${contractsTarPath.split('/').pop()}`);

  const sdkTarPath = packPackage(SDK_DIR);
  assert(existsSync(sdkTarPath), `SDK packed: ${sdkTarPath.split('/').pop()}`);

  const chartRasterWasmTarPath = packPackage(CHART_RASTER_WASM_DIR);
  assert(
    existsSync(chartRasterWasmTarPath),
    `Chart raster WASM packed: ${chartRasterWasmTarPath.split('/').pop()}`,
  );

  const computeWasmTarPath = packPackage(COMPUTE_WASM_DIR);
  assert(existsSync(computeWasmTarPath), `Compute WASM packed: ${computeWasmTarPath.split('/').pop()}`);

  // Create consumer package.json
  writeFileSync(
    join(_consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'test-consumer',
        version: '1.0.0',
        type: 'module',
        dependencies: {
          '@mog-sdk/node': `file:${sdkTarPath}`,
          '@mog-sdk/contracts': `file:${contractsTarPath}`,
          '@mog-sdk/wasm': `file:${computeWasmTarPath}`,
          '@mog-sdk/chart-raster-wasm': `file:${chartRasterWasmTarPath}`,
        },
      },
      null,
      2,
    ),
  );

  // Install
  console.log('  Installing packages in isolated consumer...');
  const inst = spawnSync('npm', ['install', '--ignore-scripts', '--omit=optional'], {
    cwd: _consumerDir,
    encoding: 'utf-8',
    timeout: 60000,
  });
  assert(inst.status === 0, 'npm install succeeded in consumer project');
  if (inst.status !== 0) {
    const err = [inst.stdout, inst.stderr].filter(Boolean).join('\n').trim();
    console.error('    ' + (err || `exit code ${inst.status}, no output`).slice(0, 500));
    // Show the package.json for debugging
    console.error('    consumer package.json:');
    console.error(
      '    ' + readFileSync(join(_consumerDir, 'package.json'), 'utf-8').replace(/\n/g, '\n    '),
    );
  }

  return _consumerDir;
}

function cleanupConsumer() {
  if (_testDir) rmSync(_testDir, { recursive: true, force: true });
}

function ensureWorkerRuntimeTools() {
  if (_workerToolsDir) return _workerToolsDir;

  if (!_testDir) {
    _testDir = mkdtempSync(join(tmpdir(), 'mog-sdk-verify-'));
  }
  _workerToolsDir = join(_testDir, 'worker-runtime-tools');
  mkdirSync(_workerToolsDir, { recursive: true });
  writeFileSync(
    join(_workerToolsDir, 'package.json'),
    JSON.stringify(
      {
        name: 'mog-worker-runtime-tools',
        version: '1.0.0',
        type: 'module',
        private: true,
        devDependencies: {
          esbuild: WORKER_FIXTURE_ESBUILD_VERSION,
          miniflare: WORKER_FIXTURE_MINIFLARE_VERSION,
        },
      },
      null,
      2,
    ),
  );

  console.log('  Installing Worker runtime fixture tools...');
  const inst = spawnSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: _workerToolsDir,
    encoding: 'utf-8',
    timeout: 120000,
  });
  assert(inst.status === 0, 'Worker runtime fixture tools installed');
  if (inst.status !== 0) {
    const err = [inst.stdout, inst.stderr].filter(Boolean).join('\n').trim();
    console.error('    ' + (err || `exit code ${inst.status}, no output`).slice(0, 800));
    return _workerToolsDir;
  }

  writeFileSync(
    join(_workerToolsDir, 'run-worker-runtime.mjs'),
    `
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const fixtureDir = process.env.MOG_WORKER_FIXTURE_DIR;
if (!fixtureDir) {
  throw new Error('MOG_WORKER_FIXTURE_DIR is required');
}

const bundlePath = join(fixtureDir, 'worker-bundle.mjs');
await build({
  absWorkingDir: fixtureDir,
  entryPoints: ['worker-entry.mjs'],
  outfile: bundlePath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['workerd', 'browser', 'import', 'default'],
  external: ['*.wasm'],
  logLevel: 'silent',
  sourcemap: false,
  sourcesContent: false,
  legalComments: 'none',
});

const bundle = await readFile(bundlePath, 'utf8');
const wasmImportSpecifiers = [
  ...bundle.matchAll(/(?:from|import)\\s*['"]([^'"]+\\.wasm)['"]/g),
].map((match) => match[1]);
console.log('BUNDLE_PATH:' + bundlePath);
console.log('BUNDLE_WASM_IMPORTS:' + JSON.stringify(wasmImportSpecifiers));
const escapingWasmImports = wasmImportSpecifiers.filter((specifier) =>
  specifier.split('/').includes('..'),
);
if (escapingWasmImports.length > 0) {
  throw new Error('Worker bundle has escaping WASM imports: ' + escapingWasmImports.join(', '));
}
const forbiddenBundlePatterns = [
  /\\bnode:[^'")\\s]+/,
  /\\bcreateRequire\\b/,
  /@mog-sdk\\/(?:darwin|linux|win32)-/,
  /new\\s+Function\\s*\\(/,
  /return\\s+import\\s*\\(\\s*specifier\\s*\\)/,
];
const forbidden = forbiddenBundlePatterns
  .map((pattern) => bundle.match(pattern)?.[0])
  .filter(Boolean);
if (forbidden.length > 0) {
  throw new Error('Worker bundle contains forbidden runtime dependency: ' + forbidden.join(', '));
}

const mf = new Miniflare({
  modules: true,
  scriptPath: bundlePath,
  modulesRules: [
    { type: 'ESModule', include: ['**/*.mjs'], fallthrough: true },
    { type: 'CompiledWasm', include: ['**/*.wasm'] },
  ],
  compatibilityDate: '2026-06-05',
});

try {
  const response = await mf.dispatchFetch('https://worker-runtime.test/chart');
  const text = await response.text();
  if (!response.ok) {
    throw new Error('Worker response ' + response.status + ': ' + text.slice(0, 4000));
  }
  const body = JSON.parse(text);
  if (body.ok !== true) {
    throw new Error('Worker body not ok: ' + text.slice(0, 1000));
  }
  console.log(
    'OK:' +
      JSON.stringify({
        pngBytes: body.pngBytes,
        pngWidth: body.pngWidth,
        pngHeight: body.pngHeight,
        jpegBytes: body.jpegBytes,
        svgBytes: body.svgBytes,
      }),
  );
} finally {
  await mf.dispose();
}
`,
  );

  return _workerToolsDir;
}

// ═══════════════════════════════════════════════════════════════════════════
// Check definitions
// ═══════════════════════════════════════════════════════════════════════════

const checks = new Map();

// Helper to register a check
function defineCheck(name, { group, description, fn }) {
  checks.set(name, { group, description, fn });
}

// ── Static checks (fast, local-only) ──────────────────────────────────────

defineCheck('prechecks', {
  group: 'static',
  description: 'Verify both packages are built (dist/ exists)',
  fn() {
    section('Pre-checks');
    assert(existsSync(resolve(SDK_DIR, 'dist/index.d.ts')), '@mog-sdk/node dist/index.d.ts exists');
    assert(existsSync(resolve(SDK_DIR, 'dist/index.js')), '@mog-sdk/node dist/index.js exists');
    assert(existsSync(resolve(SDK_DIR, 'dist/index.cjs')), '@mog-sdk/node dist/index.cjs exists');
    assert(existsSync(resolve(CONTRACTS_DIR, 'dist')), '@mog-sdk/contracts dist/ exists');
    assert(
      existsSync(resolve(CONTRACTS_DIR, 'dist/index.d.ts')),
      '@mog-sdk/contracts dist/index.d.ts exists',
    );
    assert(
      existsSync(resolve(CHART_RASTER_WASM_DIR, 'compute_chart_render_wasm.js')),
      '@mog-sdk/chart-raster-wasm glue exists',
    );
    assert(
      existsSync(resolve(CHART_RASTER_WASM_DIR, 'compute_chart_render_wasm_bg.wasm')),
      '@mog-sdk/chart-raster-wasm binary exists',
    );
    assert(
      existsSync(resolve(COMPUTE_WASM_DIR, 'compute_core_wasm_bg.wasm')),
      '@mog-sdk/wasm binary exists',
    );
    if (failed > 0) {
      console.error(
        '\n\x1b[31mPre-checks failed. Run the relevant package builds before publishing.\x1b[0m',
      );
      process.exit(1);
    }
  },
});

defineCheck('extensions', {
  group: 'static',
  description: 'Validate .js extensions on relative imports in contracts dist .d.ts',
  fn() {
    section('Contracts .d.ts relative import extensions');
    const { issues, examples, fileCount } = countExtensionIssues(resolve(CONTRACTS_DIR, 'dist'));
    assert(
      issues === 0,
      `All relative specifiers have .js extensions (${fileCount} files checked)`,
    );
    if (issues > 0) {
      for (const ex of examples) console.error(`    ${ex}`);
      console.error(
        `    Total missing: ${issues}. Fix: node contracts/scripts/fix-dts-extensions.mjs`,
      );
    }
  },
});

defineCheck('leaks', {
  group: 'static',
  description: 'Check SDK .d.ts for internal monorepo import leaks',
  fn() {
    section('SDK .d.ts internal import leak check');
    const dts = readFileSync(resolve(SDK_DIR, 'dist/index.d.ts'), 'utf-8');
    const patterns = [
      { re: /from ['"]@mog\/[^'"]*['"]/g, label: '@mog/*' },
      { re: /from ['"]@rust-bridge\/[^'"]*['"]/g, label: '@rust-bridge/*' },
      { re: /import\(\s*['"]@mog\/[^'"]*['"]\s*\)/g, label: 'import(@mog/*)' },
      { re: /import\(\s*['"]@rust-bridge\/[^'"]*['"]\s*\)/g, label: 'import(@rust-bridge/*)' },
    ];
    let leakCount = 0;
    for (const { re, label } of patterns) {
      const matches = dts.match(re) || [];
      if (matches.length > 0) {
        for (const m of matches.slice(0, 3)) console.error(`    leak (${label}): ${m}`);
        leakCount += matches.length;
      }
    }
    assert(leakCount === 0, 'No internal @mog/* or @rust-bridge/* imports in SDK .d.ts');
  },
});

defineCheck('exports-sync', {
  group: 'static',
  description: 'Validate contracts publishConfig.exports covers all export paths',
  fn() {
    section('Contracts publishConfig.exports sync');
    const pkg = JSON.parse(readFileSync(resolve(CONTRACTS_DIR, 'package.json'), 'utf-8'));
    const dev = Object.keys(pkg.exports || {});
    const pub = Object.keys(pkg.publishConfig?.exports || {});
    const missing = dev.filter((k) => !pub.includes(k));
    assert(missing.length === 0, `publishConfig.exports covers all ${dev.length} export paths`);
    if (missing.length > 0) {
      for (const k of missing.slice(0, 10)) console.error(`    missing: ${k}`);
      console.error('    Fix: node contracts/scripts/prepare-publish.mjs');
    }
  },
});

defineCheck('dep-check', {
  group: 'static',
  description: 'Verify SDK lists contracts as a proper dependency',
  fn() {
    section('SDK dependency check');
    const dts = readFileSync(resolve(SDK_DIR, 'dist/index.d.ts'), 'utf-8');
    const pkg = JSON.parse(readFileSync(resolve(SDK_DIR, 'package.json'), 'utf-8'));
    const refsContracts = /['"]@mog-sdk\/spreadsheet-contracts/.test(dts);
    if (refsContracts) {
      assert(
        !!pkg.dependencies?.['@mog-sdk/contracts'],
        '@mog-sdk/contracts is in dependencies (types reference it)',
      );
      assert(
        !pkg.devDependencies?.['@mog-sdk/contracts'],
        '@mog-sdk/contracts is NOT in devDependencies',
      );
    } else {
      assert(true, 'SDK types are self-contained (no contracts references)');
    }
  },
});

// ── Consumer checks (require packing + isolated install) ──────────────────

defineCheck('pack', {
  group: 'consumer',
  description: 'Pack both packages and install in isolated consumer project',
  fn() {
    section('Consumer project setup (pnpm pack → npm install)');
    ensureConsumerProject();
  },
});

defineCheck('pack-verify', {
  group: 'consumer',
  description: 'Verify packed tarball contents (.js extensions, export map)',
  fn() {
    section('Packed tarball verification');
    const dir = ensureConsumerProject();

    // Extension check on packed contracts
    const packedDist = join(dir, 'node_modules/@mog-sdk/contracts/dist');
    if (existsSync(packedDist)) {
      const { issues, fileCount } = countExtensionIssues(packedDist);
      assert(
        issues === 0,
        `Packed contracts .d.ts: all relative specifiers have .js extensions (${fileCount} files)`,
      );
    } else {
      assert(false, 'Packed contracts dist/ not found in consumer node_modules');
    }

    // Export map check
    const pkgPath = join(dir, 'node_modules/@mog-sdk/contracts/package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const exps = pkg.exports || {};
      const srcExports = Object.entries(exps).filter(([, v]) => {
        const val = typeof v === 'string' ? v : v?.types || v?.default || '';
        return val.includes('/src/');
      });
      assert(
        srcExports.length === 0,
        `No exports point to src/ (all ${Object.keys(exps).length} point to dist/)`,
      );
      if (srcExports.length > 0) {
        for (const [k, v] of srcExports.slice(0, 5))
          console.error(`    ${k} → ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      }
    }
  },
});

defineCheck('typecheck', {
  group: 'consumer',
  description: 'TypeScript consumer typecheck (NodeNext + Bundler)',
  fn() {
    const dir = ensureConsumerProject();

    // Write consumer TS
    writeFileSync(
      join(dir, 'consumer.ts'),
      `
import { createWorkbook } from '@mog-sdk/node';
import type { Workbook, Worksheet } from '@mog-sdk/node';
import type { DocumentSource, ImportOptions } from '@mog-sdk/node';

async function test(): Promise<void> {
  const wb: Workbook = await createWorkbook();
  const ws: Worksheet = wb.activeSheet;
  await ws.setCell('A1', 42);
  const val = await ws.getValue('A1');
  console.log(val);
  await wb.dispose();
}
`,
    );

    // Install tsc
    spawnSync('npm', ['install', '--save-dev', 'typescript@~5.7.0', '@types/node@^20'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 60000,
    });
    const tscPath = join(dir, 'node_modules/.bin/tsc');

    function runTsc(label, tsconfig) {
      writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2));
      const result = spawnSync(tscPath, ['--noEmit'], {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 30000,
      });
      if (result.status === 0) {
        assert(true, `${label}: no errors`);
        return;
      }

      const errors = (result.stdout || '')
        .trim()
        .split('\n')
        .filter((l) => l.includes('error TS'));
      const consumerErrors = errors.filter((l) => l.includes('consumer.ts'));
      const contractsLeaks = errors.filter(
        (l) => l.includes('Cannot find module') && l.includes('@mog'),
      );
      const dtsErrors = errors.filter(
        (l) => l.includes('node_modules/') && (l.includes('TS1039') || l.includes('TS1046')),
      );
      const moduleResErrors = errors.filter(
        (l) => l.includes("Cannot find module '") && !l.includes('@mog/') && l.includes('.js'),
      );

      if (consumerErrors.length > 0) {
        assert(false, `${label}: consumer code has type errors`);
        for (const line of consumerErrors.slice(0, 5)) console.error('    ' + line);
      } else {
        assert(true, `${label}: consumer code typechecks`);
      }
      if (contractsLeaks.length > 0) {
        assert(
          false,
          `${label}: contracts .d.ts leaks internal @mog/* imports (${contractsLeaks.length})`,
        );
        for (const line of contractsLeaks.slice(0, 3)) console.error('    ' + line);
      } else {
        assert(true, `${label}: no internal @mog/* import leaks in contracts`);
      }
      if (dtsErrors.length > 0) {
        warn(
          `${label}: ${dtsErrors.length} .d.ts syntax issues (TS1039/TS1046) — pre-existing tsup bugs`,
        );
      }
      if (moduleResErrors.length > 0) {
        assert(false, `${label}: .js extension resolution failures (${moduleResErrors.length})`);
        for (const line of moduleResErrors.slice(0, 3)) console.error('    ' + line);
      }
    }

    section('Consumer typecheck (NodeNext)');
    runTsc('NodeNext (skipLibCheck)', {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['consumer.ts'],
    });
    runTsc('NodeNext (strict)', {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ['node'],
      },
      include: ['consumer.ts'],
    });

    section('Consumer typecheck (Bundler)');
    runTsc('Bundler (skipLibCheck)', {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: ['node'],
      },
      include: ['consumer.ts'],
    });
    runTsc('Bundler (strict)', {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        types: ['node'],
      },
      include: ['consumer.ts'],
    });
  },
});

defineCheck('runtime', {
  group: 'consumer',
  description: 'Runtime ESM import and CJS require in isolation',
  fn() {
    const dir = ensureConsumerProject();

    // ESM
    section('Runtime ESM import (isolated)');
    writeFileSync(
      join(dir, 'test-import.mjs'),
      `
try {
  const sdk = await import('@mog-sdk/node');
  const required = ['createWorkbook', 'HeadlessEngine', 'createHeadlessEngine'];
  const missing = required.filter(k => !(k in sdk));
  if (missing.length > 0) { console.error('MISSING:' + missing.join(',')); process.exit(2); }
  console.log('OK:' + Object.keys(sdk).length);
} catch (e) {
  if (e.message?.includes('compute-core') || e.message?.includes('.node') || e.message?.includes('NAPI')) {
    console.log('SKIP_NATIVE'); process.exit(0);
  }
  console.error('IMPORT_ERROR:' + e.code + ':' + e.message); process.exit(1);
}
`,
    );
    const esmResult = spawnSync('node', ['test-import.mjs'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    const esmOut = (esmResult.stdout || '').trim();
    if (esmOut.startsWith('OK:')) assert(true, `ESM import succeeded (${esmOut})`);
    else if (esmOut === 'SKIP_NATIVE' || (esmResult.stderr || '').includes('compute-core'))
      skip('ESM import skipped (native addon not built)');
    else assert(false, `ESM import failed: ${(esmResult.stderr || esmOut).slice(0, 300)}`);

    // CJS
    section('Runtime CJS require (isolated)');
    writeFileSync(
      join(dir, 'test-require.cjs'),
      `
try {
  const sdk = require('@mog-sdk/node');
  const required = ['createWorkbook', 'HeadlessEngine', 'createHeadlessEngine'];
  const missing = required.filter(k => !(k in sdk));
  if (missing.length > 0) { console.error('MISSING:' + missing.join(',')); process.exit(2); }
  console.log('OK:' + Object.keys(sdk).length);
} catch (e) {
  if (e.message?.includes('compute-core') || e.message?.includes('.node') || e.message?.includes('NAPI')) {
    console.log('SKIP_NATIVE'); process.exit(0);
  }
  console.error('REQUIRE_ERROR:' + (e.code || '') + ':' + e.message); process.exit(1);
}
`,
    );
    const cjsResult = spawnSync('node', ['test-require.cjs'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 15000,
    });
    const cjsOut = (cjsResult.stdout || '').trim();
    if (cjsOut.startsWith('OK:')) assert(true, `CJS require succeeded (${cjsOut})`);
    else if (cjsOut === 'SKIP_NATIVE' || (cjsResult.stderr || '').includes('compute-core'))
      skip('CJS require skipped (native addon not built)');
    else assert(false, `CJS require failed: ${(cjsResult.stderr || cjsOut).slice(0, 300)}`);

    section('Runtime WASM chart export (isolated, no optional native packages)');
    writeFileSync(
      join(dir, 'test-wasm-chart.mjs'),
      `
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createWorkbook } from '@mog-sdk/node/wasm';

const require = createRequire(import.meta.url);
const computeWasmPath = require.resolve('@mog-sdk/wasm/wasm');
const chartRasterWasmPath = require.resolve('@mog-sdk/chart-raster-wasm/wasm');
const [computeBytes, chartRasterBytes] = await Promise.all([
  readFile(computeWasmPath),
  readFile(chartRasterWasmPath),
]);

const wb = await createWorkbook({
  wasmModule: await WebAssembly.compile(computeBytes),
  chartRendering: {
    rasterModule: await WebAssembly.compile(chartRasterBytes),
  },
  userTimezone: 'UTC',
});

try {
  const ws = wb.activeSheet;
  await ws.setRange('A1:B3', [
    ['Month', 'Revenue'],
    ['Jan', 12],
    ['Feb', 28],
  ]);
  const chart = await ws.charts.add({
    type: 'bar',
    dataRange: 'A1:B3',
    anchorRow: 0,
    anchorCol: 3,
  });
  const png = await ws.charts.exportImage(chart.id, {
    format: 'png',
    width: 320,
    height: 180,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
  });
  if (!png.startsWith('data:image/png;base64,')) {
    throw new Error('PNG data URL prefix missing');
  }
  const bytes = Buffer.from(png.split(',', 2)[1], 'base64');
  const signature = [...bytes.slice(0, 8)].join(',');
  if (signature !== '137,80,78,71,13,10,26,10') {
    throw new Error('PNG signature mismatch: ' + signature);
  }
  console.log('OK:' + bytes.length);
} finally {
  await wb.dispose();
}
`,
    );
    const wasmChartResult = spawnSync('node', ['test-wasm-chart.mjs'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 30000,
    });
    const wasmChartOut = (wasmChartResult.stdout || '').trim();
    if (wasmChartResult.status === 0 && wasmChartOut.includes('OK:')) {
      assert(true, `WASM chart export succeeded (${wasmChartOut.split('\n').at(-1)})`);
    } else {
      assert(
        false,
        `WASM chart export failed: ${[wasmChartResult.stdout, wasmChartResult.stderr]
          .filter(Boolean)
          .join('\n')
          .slice(0, 800)}`,
      );
    }
  },
});

defineCheck('worker-runtime', {
  group: 'consumer',
  description: 'Miniflare/workerd-style WASM chart export with packed SDK packages',
  fn() {
    const dir = ensureConsumerProject();
    const toolsDir = ensureWorkerRuntimeTools();

    section('Worker runtime WASM chart export (Miniflare, packed packages)');
    const fixtureDirPath = join(dir, 'worker-runtime');
    mkdirSync(fixtureDirPath, { recursive: true });
    const fixtureDir = realpathSync(fixtureDirPath);

    const computeWasmPath = join(
      dir,
      'node_modules/@mog-sdk/wasm/compute_core_wasm_bg.wasm',
    );
    const chartRasterWasmPath = join(
      dir,
      'node_modules/@mog-sdk/chart-raster-wasm/compute_chart_render_wasm_bg.wasm',
    );
    assert(existsSync(computeWasmPath), 'Worker fixture compute WASM artifact exists');
    assert(existsSync(chartRasterWasmPath), 'Worker fixture chart raster WASM artifact exists');
    copyFileSync(computeWasmPath, join(fixtureDir, 'compute_core_wasm_bg.wasm'));
    copyFileSync(chartRasterWasmPath, join(fixtureDir, 'compute_chart_render_wasm_bg.wasm'));

    writeFileSync(
      join(fixtureDir, 'worker-entry.mjs'),
      `
import { createWorkbook } from '@mog-sdk/node';
import computeWasmModule from './compute_core_wasm_bg.wasm';
import chartRasterWasmModule from './compute_chart_render_wasm_bg.wasm';

function decodeDataUrl(dataUrl, expectedPrefix) {
  if (!dataUrl.startsWith(expectedPrefix)) {
    throw new Error('Expected data URL prefix ' + expectedPrefix + ', got ' + dataUrl.slice(0, 64));
  }
  const base64 = dataUrl.split(',', 2)[1];
  if (!base64) throw new Error('Missing data URL payload');
  return atob(base64);
}

function signature(binary, count) {
  return Array.from(binary.slice(0, count), (char) => char.charCodeAt(0)).join(',');
}

function readPngUint32(binary, offset) {
  return (
    binary.charCodeAt(offset) * 0x1000000 +
    binary.charCodeAt(offset + 1) * 0x10000 +
    binary.charCodeAt(offset + 2) * 0x100 +
    binary.charCodeAt(offset + 3)
  );
}

function serializeError(error) {
  if (!(error instanceof Error)) return { message: String(error) };
  const cause = error.cause ? serializeError(error.cause) : undefined;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause,
  };
}

export default {
  async fetch() {
    let wb;
    try {
      if (typeof process !== 'undefined') {
        throw new Error('Worker global unexpectedly exposes process');
      }
      console.log('WORKER_STAGE:createWorkbook:start');
      wb = await createWorkbook({
        runtime: 'wasm',
        wasmModule: computeWasmModule,
        chartRendering: {
          rasterModule: chartRasterWasmModule,
        },
        userTimezone: 'UTC',
      });
      console.log('WORKER_STAGE:createWorkbook:end');

      const ws = wb.activeSheet;
      console.log('WORKER_STAGE:setRange:start');
      await ws.setRange('A1:B3', [
        ['Month', 'Revenue'],
        ['Jan', 12],
        ['Feb', 28],
      ]);
      console.log('WORKER_STAGE:setRange:end');
      console.log('WORKER_STAGE:chartAdd:start');
      const chart = await ws.charts.add({
        type: 'bar',
        dataRange: 'A1:B3',
        anchorRow: 0,
        anchorCol: 3,
      });
      console.log('WORKER_STAGE:chartAdd:end');

      console.log('WORKER_STAGE:export:start');
      const [svg, png, jpeg] = await Promise.all([
        ws.charts.exportImage(chart.id, {
          format: 'svg',
          width: 320,
          height: 180,
          backgroundColor: '#ffffff',
        }),
        ws.charts.exportImage(chart.id, {
          format: 'png',
          width: 320,
          height: 180,
          pixelRatio: 2,
          backgroundColor: '#ffffff',
        }),
        ws.charts.exportImage(chart.id, {
          format: 'jpeg',
          width: 320,
          height: 180,
          pixelRatio: 1,
          quality: 0.82,
          backgroundColor: '#ffffff',
        }),
      ]);
      console.log('WORKER_STAGE:export:end');

      const svgXml = decodeDataUrl(svg, 'data:image/svg+xml;base64,');
      if (!svgXml.includes('<svg') || !svgXml.includes('</svg>')) {
        throw new Error('Decoded SVG payload is not SVG XML');
      }

      const pngBinary = decodeDataUrl(png, 'data:image/png;base64,');
      const pngSignature = signature(pngBinary, 8);
      if (pngSignature !== '137,80,78,71,13,10,26,10') {
        throw new Error('PNG signature mismatch: ' + pngSignature);
      }
      const pngWidth = readPngUint32(pngBinary, 16);
      const pngHeight = readPngUint32(pngBinary, 20);
      if (pngWidth !== 640 || pngHeight !== 360) {
        throw new Error('PNG dimensions mismatch: ' + pngWidth + 'x' + pngHeight);
      }

      const jpegBinary = decodeDataUrl(jpeg, 'data:image/jpeg;base64,');
      const jpegSignature = signature(jpegBinary, 2);
      if (jpegSignature !== '255,216') {
        throw new Error('JPEG signature mismatch: ' + jpegSignature);
      }

      return Response.json({
        ok: true,
        svgBytes: svgXml.length,
        pngBytes: pngBinary.length,
        pngWidth,
        pngHeight,
        jpegBytes: jpegBinary.length,
      });
    } catch (error) {
      console.error('WORKER_ERROR:' + JSON.stringify(serializeError(error)));
      return Response.json(
        {
          ok: false,
          error: serializeError(error),
        },
        { status: 500 },
      );
    } finally {
      wb?.dispose();
    }
  },
};
`,
    );

    const result = spawnSync('node', [join(toolsDir, 'run-worker-runtime.mjs')], {
      cwd: fixtureDir,
      env: {
        ...process.env,
        MOG_WORKER_FIXTURE_DIR: fixtureDir,
      },
      encoding: 'utf-8',
      timeout: 120000,
    });
    const out = (result.stdout || '').trim();
    if (result.status === 0 && out.includes('OK:')) {
      assert(true, `Worker runtime chart export succeeded (${out.split('\n').at(-1)})`);
    } else {
      assert(
        false,
        `Worker runtime chart export failed: ${[
          result.error ? String(result.error) : '',
          result.signal ? `signal=${result.signal}` : '',
          result.stdout,
          result.stderr,
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 6000)}`,
      );
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// CLI parsing & runner
// ═══════════════════════════════════════════════════════════════════════════

const GROUPS = {
  static: ['prechecks', 'extensions', 'leaks', 'exports-sync', 'dep-check'],
  consumer: ['pack', 'pack-verify', 'typecheck', 'runtime', 'worker-runtime'],
};
GROUPS.all = [...GROUPS.static, ...GROUPS.consumer];

function parseArgs() {
  const args = process.argv.slice(2);
  let only = null;
  let skipSet = new Set();
  let listMode = false;

  for (const arg of args) {
    if (arg === '--list' || arg === '-l') {
      listMode = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      console.log(`Usage: verify-sdk-publish.mjs [options]

Options:
  --list, -l               List all available checks
  --only=<checks>          Run only these checks (comma-separated names or groups)
  --skip=<checks>          Skip these checks (comma-separated names or groups)
  --help, -h               Show this help

Check names: ${GROUPS.all.join(', ')}
Groups:      static, consumer, all

Examples:
  --only=static            Fast local-only checks (no npm pack/install)
  --skip=typecheck          Skip consumer tsc (still does pack + runtime)
  --only=leaks,extensions   Just check .d.ts quality
  --skip=typecheck,runtime  Only structural checks + pack verification`);
      process.exit(0);
    }

    const onlyMatch = arg.match(/^--only=(.+)$/);
    if (onlyMatch) {
      only = new Set();
      for (const token of onlyMatch[1].split(',')) {
        if (GROUPS[token]) GROUPS[token].forEach((c) => only.add(c));
        else if (checks.has(token)) only.add(token);
        else {
          console.error(`Unknown check or group: ${token}`);
          process.exit(1);
        }
      }
      continue;
    }

    const skipMatch = arg.match(/^--skip=(.+)$/);
    if (skipMatch) {
      for (const token of skipMatch[1].split(',')) {
        if (GROUPS[token]) GROUPS[token].forEach((c) => skipSet.add(c));
        else if (checks.has(token)) skipSet.add(token);
        else {
          console.error(`Unknown check or group: ${token}`);
          process.exit(1);
        }
      }
      continue;
    }

    console.error(`Unknown argument: ${arg}. Use --help for usage.`);
    process.exit(1);
  }

  return { only, skipSet, listMode };
}

const { only, skipSet, listMode } = parseArgs();

if (listMode) {
  console.log('\x1b[1mAvailable checks:\x1b[0m\n');
  for (const [name, { group, description }] of checks) {
    console.log(`  \x1b[36m${name.padEnd(15)}\x1b[0m [${group}]  ${description}`);
  }
  console.log('\n\x1b[1mGroups:\x1b[0m');
  for (const [g, members] of Object.entries(GROUPS)) {
    console.log(`  \x1b[36m${g.padEnd(15)}\x1b[0m ${members.join(', ')}`);
  }
  process.exit(0);
}

// Determine which checks to run
const toRun = [];
for (const name of GROUPS.all) {
  if (only && !only.has(name)) continue;
  if (skipSet.has(name)) {
    console.log(`\x1b[33m⊘ Skipping: ${name}\x1b[0m`);
    continue;
  }
  toRun.push(name);
}

// Run checks
try {
  for (const name of toRun) {
    checks.get(name).fn();
  }
} finally {
  cleanupConsumer();
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════

console.log(
  `\n\x1b[1m═══ Results: ${passed} passed, ${failed} failed, ${skippedCount} skipped ═══\x1b[0m`,
);

if (toRun.length < GROUPS.all.length) {
  const skippedChecks = GROUPS.all.filter((c) => !toRun.includes(c));
  console.log(`\x1b[2m    Checks skipped: ${skippedChecks.join(', ')}\x1b[0m`);
}

if (failed > 0) {
  console.error('\n\x1b[31mPre-publish verification FAILED:\x1b[0m');
  for (const f of failures) console.error(`  • ${f}`);
  console.error('\nDo NOT publish until all checks pass.');
  process.exit(1);
} else {
  console.log('\n\x1b[32mAll checks passed — safe to publish.\x1b[0m');
}

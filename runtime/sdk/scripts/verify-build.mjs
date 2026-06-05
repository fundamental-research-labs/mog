/**
 * Verify the built SDK package is complete and functional.
 *
 * Checks:
 * 1. All dist files exist (ESM, CJS, DTS)
 * 2. ESM bundle imports and exports the expected symbols
 * 3. CJS bundle can be required
 * 4. Type declarations are self-contained (no @mog/* imports)
 * 5. Package.json is correctly configured for publishing
 * 6. Integration test: create a workbook and set/get a cell value
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = resolve(__dirname, '..');
const DIST = resolve(SDK_ROOT, 'dist');
const REPO_ROOT = resolve(SDK_ROOT, '..', '..');
const require = createRequire(import.meta.url);

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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTypeReexport(source, moduleName, names) {
  const pattern = new RegExp(
    String.raw`export\s+type\s+\{([^}]*)\}\s+from\s+['"]${escapeRegExp(moduleName)}['"]`,
    'g',
  );

  for (const match of source.matchAll(pattern)) {
    const exportedNames = match[1]
      .split(',')
      .map((part) =>
        part
          .trim()
          .replace(/\s+as\s+\w+$/u, '')
          .trim(),
      )
      .filter(Boolean);

    if (names.every((name) => exportedNames.includes(name))) {
      return true;
    }
  }

  return false;
}

function formatTypeScriptDiagnostics(ts, diagnostics) {
  return diagnostics
    .slice(0, 12)
    .map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      if (!diagnostic.file || diagnostic.start == null) {
        return `    TS${diagnostic.code}: ${message}`;
      }
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `    ${diagnostic.file.fileName}:${position.line + 1}:${
        position.character + 1
      } TS${diagnostic.code}: ${message}`;
    })
    .join('\n');
}

function checkTypeScriptConsumerCompiles() {
  const ts = require('typescript');
  const tempDir = mkdtempSync(resolve(tmpdir(), 'mog-sdk-verify-types-'));
  const consumerFile = resolve(tempDir, 'consumer.ts');

  try {
    writeFileSync(resolve(tempDir, 'package.json'), '{ "type": "module" }\n');
    writeFileSync(
      consumerFile,
      `
import { createWorkbook, type Workbook, type Worksheet } from '@mog-sdk/node';

async function main() {
  const wb: Workbook = await createWorkbook();
  const ws: Worksheet = wb.activeSheet;
  await ws.setCell('A1', 42);
  const value = await ws.getValue('A1');
  await wb.dispose();
  return value;
}

void main;
`,
    );

    const options = {
      target: ts.ScriptTarget.ESNext,
      lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      esModuleInterop: true,
      baseUrl: tempDir,
      paths: {
        '@mog-sdk/node': [resolve(DIST, 'index.d.ts')],
        '@mog-sdk/contracts': [resolve(REPO_ROOT, 'contracts', 'dist', 'index.d.ts')],
        '@mog-sdk/contracts/*': [
          resolve(REPO_ROOT, 'contracts', 'dist', '*.d.ts'),
          resolve(REPO_ROOT, 'contracts', 'dist', '*', 'index.d.ts'),
          resolve(REPO_ROOT, 'contracts', 'dist', '*'),
        ],
      },
      types: ['node'],
      typeRoots: [resolve(SDK_ROOT, 'node_modules', '@types')],
    };

    const program = ts.createProgram([consumerFile], options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    assert(diagnostics.length === 0, 'Public TypeScript consumer compiles');
    if (diagnostics.length > 0) {
      console.error(formatTypeScriptDiagnostics(ts, diagnostics));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function checkNoEagerChartRasterRegistration(file) {
  const source = readFileSync(resolve(DIST, file), 'utf-8');
  const eagerPattern =
    /createNodeChartImageExporterFactory\s*\(\s*loadNodeSdkNapiAddon\s*\(\s*\)\s*\)/;
  assert(
    !eagerPattern.test(source),
    `${file} does not eagerly load the chart raster backend during exporter registration`,
  );
}

async function checkBundledEdgeImportMetaUrlUndefinedImport() {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'mog-sdk-edge-import-'));

  try {
    writeFileSync(resolve(tempDir, 'package.json'), '{ "type": "module" }\n');

    for (const entry of readdirSync(DIST, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.js')) continue;

      const sourcePath = resolve(DIST, entry.name);
      const source = readFileSync(sourcePath, 'utf-8');
      writeFileSync(resolve(tempDir, entry.name), source.replaceAll('import.meta.url', 'undefined'));
    }

    const esm = await import(pathToFileURL(resolve(tempDir, 'index.js')).href);
    assert(
      typeof esm.createWorkbook === 'function',
      'ESM import succeeds when bundled import.meta.url is undefined',
    );
  } catch (e) {
    assert(false, `ESM import with undefined import.meta.url failed: ${e.message}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// =========================================================================
// 1. Dist files exist
// =========================================================================
console.log('\n--- 1. Dist files exist ---');

const expectedFiles = [
  'index.js', // ESM
  'index.cjs', // CJS
  'index.d.ts', // ESM types
  'index.d.cts', // CJS types
  'index.js.map', // ESM sourcemap
  'index.cjs.map', // CJS sourcemap
];

for (const file of expectedFiles) {
  const filepath = resolve(DIST, file);
  assert(existsSync(filepath), `${file} exists`);
  if (existsSync(filepath)) {
    const size = statSync(filepath).size;
    assert(size > 0, `${file} is non-empty (${(size / 1024).toFixed(1)} KB)`);
  }
}

// =========================================================================
// 2. ESM bundle exports expected symbols
// =========================================================================
console.log('\n--- 2. ESM exports ---');

try {
  const esm = await import(resolve(DIST, 'index.js'));
  assert(typeof esm.createWorkbook === 'function', 'createWorkbook is a function');
  assert(!('DocumentFactory' in esm), 'DocumentFactory is not exported');
} catch (e) {
  assert(false, `ESM import failed: ${e.message}`);
}

await checkBundledEdgeImportMetaUrlUndefinedImport();

// =========================================================================
// 3. CJS bundle exports expected symbols
// =========================================================================
console.log('\n--- 3. CJS exports ---');

try {
  const cjs = require(resolve(DIST, 'index.cjs'));
  assert(typeof cjs.createWorkbook === 'function', 'CJS createWorkbook is a function');
  assert(!('DocumentFactory' in cjs), 'CJS DocumentFactory is not exported');
} catch (e) {
  if (e.message?.includes('No "exports" main defined') && e.message?.includes('@mog-sdk/kernel')) {
    console.log(
      `  SKIP: CJS direct-dist require skipped in workspace symlink layout: ${e.message}`,
    );
  } else {
    assert(false, `CJS require failed: ${e.message}`);
  }
}

// =========================================================================
// 4. Type declarations are self-contained
// =========================================================================
console.log('\n--- 4. Self-contained types ---');

const dts = readFileSync(resolve(DIST, 'index.d.ts'), 'utf-8');
const bootDts = readFileSync(resolve(DIST, 'boot.d.ts'), 'utf-8');

// Check no unresolvable imports remain (imports from @mog/* or @rust-bridge/*)
// (JSDoc comments with @mog-sdk/node are OK)
const privateImportPattern =
  /\b(?:import|export)\b[\s\S]*?\bfrom\s+['"](@mog\/|@rust-bridge\/|@mog-sdk\/types-|@mog-sdk\/spreadsheet-contracts)[^'"]*['"]/g;
const privateImports = [...dts.matchAll(privateImportPattern)].map((match) =>
  match[0].replace(/\s+/g, ' ').trim(),
);
assert(
  privateImports.length === 0,
  `No unresolvable private imports (found ${privateImports.length})`,
);
if (privateImports.length > 0) {
  for (const statement of privateImports) {
    console.error(`    -> ${statement}`);
  }
}

const bundledSharedDeclarations =
  dts.match(
    /^\s*export\s+(?:declare\s+)?(?:interface|class|enum|const|type)\s+(?:Workbook|Worksheet|ScreenshotOptions|WorkbookSecurity)\b/gm,
  ) ?? [];
assert(
  bundledSharedDeclarations.length === 0,
  'Workbook/Worksheet contract identities are not bundled into index.d.ts',
);
assert(
  hasTypeReexport(dts, '@mog-sdk/contracts/api', [
    'Workbook',
    'Worksheet',
    'ScreenshotOptions',
    'WorkbookSecurity',
  ]),
  'Workbook/Worksheet are re-exported from @mog-sdk/contracts/api',
);
assert(
  /export\s*\{[^}]*\bcreateWorkbook\b[^}]*\}\s+from\s+['"]\.\/boot\.js['"]/s.test(dts),
  'createWorkbook is re-exported from boot.d.ts entrypoint',
);
assert(
  /\bexport\s+declare\s+function\s+createWorkbook\s*\(/.test(bootDts),
  'createWorkbook overloads are declared in boot.d.ts',
);
assert(!/\bexport\s*\{\s*DocumentFactory\s*\}/.test(dts), 'DocumentFactory not declared');
checkTypeScriptConsumerCompiles();

// =========================================================================
// 5. Package.json is correct
// =========================================================================
console.log('\n--- 5. Package.json ---');

const pkg = JSON.parse(readFileSync(resolve(SDK_ROOT, 'package.json'), 'utf-8'));

assert(pkg.name === '@mog-sdk/node', `name is @mog-sdk/node`);
assert(!pkg.private, 'not marked private');
assert(pkg.main === 'dist/index.cjs', 'main points to CJS');
assert(pkg.module === 'dist/index.mjs' || pkg.module === 'dist/index.js', 'module points to ESM');
assert(pkg.types === 'dist/index.d.ts', 'types points to DTS');
assert(pkg.exports, 'exports field exists');
assert(pkg.files && pkg.files.includes('dist'), 'files includes dist');
assert(
  pkg.publishConfig && pkg.publishConfig.access === 'public',
  'publishConfig.access is public',
);
assert(pkg.optionalDependencies, 'optionalDependencies exists');
assert(pkg.optionalDependencies['@mog-sdk/darwin-arm64'], 'darwin-arm64 optional dep');
assert(pkg.optionalDependencies['@mog-sdk/linux-x64-musl'], 'linux-x64-musl optional dep');
assert(pkg.engines && pkg.engines.node, 'engines.node specified');

// =========================================================================
// 6. Lazy chart raster registration
// =========================================================================
console.log('\n--- 6. Lazy chart raster registration ---');

checkNoEagerChartRasterRegistration('index.js');
checkNoEagerChartRasterRegistration('index.cjs');

// =========================================================================
// 7. Integration test: create a workbook
// =========================================================================
console.log('\n--- 7. Integration test ---');

try {
  const { createWorkbook } = await import(resolve(DIST, 'index.js'));
  let wb = null;

  try {
    wb = await createWorkbook();
    assert(wb != null, 'workbook created');

    const ws = wb.activeSheet;
    assert(ws != null, 'active sheet exists');

    await ws.setCell('A1', 42);
    const val = await ws.getValue('A1');
    assert(val === 42, `A1 value is 42 (got ${val})`);

    await ws.setCell('A2', '=A1*2');
    const formulaVal = await ws.getValue('A2');
    assert(formulaVal === 84, `A2 (=A1*2) is 84 (got ${formulaVal})`);
  } finally {
    if (wb != null && typeof wb.dispose === 'function') {
      await wb.dispose();
      assert(true, 'workbook disposed');
    }
  }
} catch (e) {
  // This will fail if compute-core-napi isn't built, which is expected in CI
  // but should work locally
  if (
    e.message?.includes('compute-core') ||
    e.message?.includes('NAPI') ||
    e.message?.includes('addon')
  ) {
    console.log(`  SKIP: Integration test skipped (native addon not built: ${e.message})`);
  } else {
    assert(false, `Integration test failed: ${e.message}\n${e.stack}`);
  }
}

// =========================================================================
// Summary
// =========================================================================
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);

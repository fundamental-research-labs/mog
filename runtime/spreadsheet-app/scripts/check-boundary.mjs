import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const requireDist = process.argv.includes('--require-dist');

function read(relativePath) {
  return readFileSync(resolve(ROOT, relativePath), 'utf-8');
}

function findDeclarationFiles(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findDeclarationFiles(fullPath));
    } else if (/\.(?:d\.ts|d\.cts|d\.mts)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function findFiles(dir, predicate) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findFiles(fullPath, predicate));
    } else if (predicate(entry, fullPath)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function relativeFromRepo(filePath) {
  return filePath.replace(`${resolve(ROOT, '../..')}/`, '');
}

function assertNoPatterns(source, sourceName, patterns) {
  for (const { pattern, message } of patterns) {
    assert.equal(
      pattern.test(source),
      false,
      `${sourceName} leaked forbidden ${message}: ${pattern}`,
    );
  }
}

function exportedNames(source) {
  const names = [];
  const direct = /export\s+(?:async\s+)?(?:interface|type|const|function|class)\s+(\w+)/g;
  let match;
  while ((match = direct.exec(source))) names.push(match[1]);

  const braces = /export\s+(?:type\s+)?\{([^}]+)\}/g;
  while ((match = braces.exec(source))) {
    for (const part of match[1].split(',')) {
      const cleaned = part.replace(/\s+as\s+\w+/, '').trim();
      if (cleaned) names.push(cleaned);
    }
  }
  return names;
}

const manifest = JSON.parse(read('package.json'));
const publicTypes = read('src/public-types.ts');
const root = read('src/index.tsx');
const appAttachment = read('src/app-attachment.tsx');
const runtime = read('src/runtime.ts');
const tsupConfig = read('tsup.config.ts');
const appPanelLayer = read('../../apps/spreadsheet/src/chrome/layers/PanelLayer.tsx');
const distDir = resolve(ROOT, 'dist');
const repoRoot = resolve(ROOT, '../..');
const appSpreadsheetRoot = resolve(repoRoot, 'apps/spreadsheet');
const distDeclarationFiles = findDeclarationFiles(distDir);
if (requireDist) {
  assert.ok(
    distDeclarationFiles.length > 0,
    'dist must contain declaration files before boundary checking',
  );
}

const declarationSources = distDeclarationFiles.map((filePath) => ({
  filePath,
  source: readFileSync(filePath, 'utf-8'),
}));

const forbiddenSourcePatterns = [
  {
    pattern: /@mog-sdk\/kernel\/internal/,
    message: 'kernel internal import or resolver alias',
  },
  {
    pattern: /kernel\/src\/internal\.ts/,
    message: 'kernel source-internal resolver path',
  },
];

assertNoPatterns(tsupConfig, 'tsup.config.ts', forbiddenSourcePatterns);
assertNoPatterns(appPanelLayer, 'apps/spreadsheet/src/chrome/layers/PanelLayer.tsx', [
  {
    pattern: /components\/testing\/TestPanel|TestPanel/,
    message: 'static development testing panel import',
  },
  {
    pattern: /@mog\/spreadsheet-testing|use-testing/,
    message: 'development spreadsheet testing runtime import',
  },
]);

const forbiddenProductionSourcePatterns = [
  ...forbiddenSourcePatterns,
  {
    pattern: /(?:from\s+|import\s*\(\s*)['"]@mog\/app-spreadsheet\/dev\/testing-panel['"]/,
    message: 'development testing panel contribution import',
  },
  {
    pattern: /(?:from\s+|import\s*\(\s*)['"]@mog\/spreadsheet-testing(?:\/fixtures)?['"]/,
    message: 'development spreadsheet testing package import',
  },
  {
    pattern: /(?:from\s+|import\s*\(\s*)['"][^'"]*components\/testing\/TestPanel['"]/,
    message: 'development testing panel implementation import',
  },
  {
    pattern: /(?:from\s+|import\s*\(\s*)['"][^'"]*hooks\/settings\/use-testing['"]/,
    message: 'development testing hook import',
  },
];

function isProductionAppSource(filePath) {
  const relative = relativeFromRepo(filePath);
  if (!/\.(?:ts|tsx)$/.test(relative)) return false;
  if (relative.includes('/__tests__/') || /\.test\.tsx?$/.test(relative)) return false;
  if (relative.startsWith('apps/spreadsheet/src/dev/')) return false;
  if (relative.startsWith('apps/spreadsheet/src/components/testing/')) return false;
  if (relative === 'apps/spreadsheet/src/hooks/settings/use-testing.ts') return false;
  return true;
}

const productionSourceFiles = [
  resolve(appSpreadsheetRoot, 'index.tsx'),
  resolve(appSpreadsheetRoot, 'register.ts'),
  resolve(appSpreadsheetRoot, 'manifest.ts'),
  ...findFiles(resolve(appSpreadsheetRoot, 'src'), (_entry, filePath) =>
    isProductionAppSource(filePath),
  ),
  ...findFiles(resolve(ROOT, 'src'), (entry) => /\.(?:ts|tsx)$/.test(entry)),
];

for (const filePath of productionSourceFiles) {
  assertNoPatterns(
    readFileSync(filePath, 'utf-8'),
    relativeFromRepo(filePath),
    forbiddenProductionSourcePatterns,
  );
}

if (requireDist) {
  const distArtifactFiles = findFiles(distDir, (entry) =>
    /\.(?:[cm]?js|[cm]?js\.map|d\.[cm]?ts|d\.ts|css)$/.test(entry),
  );
  for (const filePath of distArtifactFiles) {
    const source = readFileSync(filePath, 'utf-8');
    assertNoPatterns(source, filePath, [
      ...forbiddenSourcePatterns,
      {
        pattern: /@mog\/spreadsheet-testing/,
        message: 'development spreadsheet testing package',
      },
      {
        pattern: /dev\/testing\/src|dev\/testing/,
        message: 'development testing source path',
      },
      {
        pattern: /components\/testing\/TestPanel|hooks\/settings\/use-testing/,
        message: 'development testing panel source path',
      },
      {
        pattern: /TestPanel Component/,
        message: 'development testing panel implementation',
      },
    ]);
  }
}

assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './mog-embed.css', './styles.css']);

// Verify scoped embed CSS
if (requireDist) {
  const embedCss = read('dist/mog-embed.css');
  assert.ok(embedCss.includes('[data-mog-engine]'), 'mog-embed.css must contain scoped selectors');
  const stylesCss = read('dist/styles.css');
  assert.ok(
    !stylesCss.includes('[data-mog-engine] .flex'),
    'styles.css must not contain scoped utilities',
  );
}
assert.deepEqual(manifest.files, ['dist']);

for (const forbidden of [
  /@mog\/shell/,
  /@mog\/app-spreadsheet/,
  /@mog-sdk\/kernel/,
  /@mog-sdk\/spreadsheet-contracts/,
  /@mog-sdk\/types-/,
  /@mog\/types-/,
  /@rust-bridge\//,
  /\bFeatureGates\b/,
  /\bIAppKernelAPI\b/,
  /\bShellHost\b/,
  /\bShellHostProps\b/,
  /\bDocumentHandle\b/,
  /\bDocumentManager\b/,
  /\bShellBootstrapResult\b/,
  /\bDocumentContext\b/,
  /\bComputeBridge\b/,
  /\buiStore\b/,
  /\bRuntimeState\b/,
  /\bWorkbookRecord\b/,
  /\bSpreadsheetAppDocumentHandle\b/,
  /\bRegisteredSpreadsheetAppBridge\b/,
  /\bComponentOwned\w*\b/,
  /\bMogSpreadsheetDocumentPolicy\b/,
  /\bopenBackgroundWorkbook\b/,
  /readonly\s+document\?\s*:/,
]) {
  assert.equal(
    forbidden.test(publicTypes),
    false,
    `public-types.ts leaked forbidden public declaration pattern ${forbidden}`,
  );
  for (const declaration of declarationSources) {
    assert.equal(
      forbidden.test(declaration.source),
      false,
      `${declaration.filePath} leaked forbidden public declaration pattern ${forbidden}`,
    );
  }
}

const names = exportedNames(root);
for (const name of [
  'ComponentOwnedMogSpreadsheetApp',
  'ComponentOwnedMogSpreadsheetAppProps',
  'ComponentOwnedMogSpreadsheetDocumentPolicy',
  'ComponentOwnedSpreadsheetAppHandle',
  'ComponentOwnedSpreadsheetLifecycleEvents',
  'ComponentOwnedSpreadsheetWorkbookHandle',
  'DocumentHandle',
  'DocumentContext',
  'ComputeBridge',
  'FeatureGates',
  'IAppKernelAPI',
  'RegisteredSpreadsheetAppBridge',
  'RuntimeState',
  'ShellHost',
  'ShellHostProps',
  'ShellBootstrapResult',
  'SpreadsheetAppDocumentHandle',
  'DocumentManager',
  'WorkbookRecord',
  'uiStore',
]) {
  assert.equal(names.includes(name), false, `root export leaked ${name}`);
}

for (const name of [
  'createSpreadsheetRuntime',
  'MogSpreadsheetApp',
  'mountSpreadsheetApp',
  'SpreadsheetRuntime',
  'SpreadsheetRuntimeOptions',
  'SpreadsheetWorkbookSession',
  'SpreadsheetAppAttachmentHandle',
  'SpreadsheetOpenWorkbookRequest',
  'SpreadsheetAttachmentState',
  'SpreadsheetMarkSavedInput',
  'SpreadsheetBuiltInFeatureGateCapability',
  'SpreadsheetFeatureGateCapabilities',
  'SpreadsheetFeatureGateCapability',
  'SpreadsheetVersionControlFeatureGateCapability',
]) {
  assert.equal(names.includes(name), true, `root export is missing public contract ${name}`);
}

for (const required of [
  /export interface SpreadsheetRuntime\b/,
  /export interface SpreadsheetWorkbookSession\b/,
  /export interface SpreadsheetAppAttachmentHandle\b/,
  /export interface MogSpreadsheetAppProps extends MogSpreadsheetAttachmentEvents\b/,
  /export type SpreadsheetVersionControlFeatureGateCapability\b/,
  /export interface SpreadsheetFeatureGateCapabilities\b/,
  /readonly capabilities\?: SpreadsheetFeatureGateCapabilities;/,
  /readonly runtime: SpreadsheetRuntime;/,
  /readonly workbook: SpreadsheetWorkbookSession;/,
]) {
  assert.equal(
    required.test(publicTypes),
    true,
    `public-types.ts is missing required public declaration pattern ${required}`,
  );
}

for (const dep of ['@mog/shell', '@mog/app-spreadsheet']) {
  assert.equal(
    Object.hasOwn(manifest.dependencies ?? {}, dep),
    false,
    `runtime dependency leaked private package ${dep}`,
  );
}

for (const dep of ['@mog-sdk/kernel']) {
  for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    assert.equal(
      Object.hasOwn(manifest[field] ?? {}, dep),
      false,
      `public package manifest leaked unpublished package ${field}.${dep}`,
    );
  }
}

assert.equal(
  /ref\.current\?\.ready\s*\?\?\s*Promise\.resolve/.test(root),
  false,
  'mountSpreadsheetApp must not expose an immediately resolved ready fallback',
);

assert.equal(
  /export const MogSpreadsheetApp = forwardRef/.test(root),
  false,
  'public MogSpreadsheetApp must not be implemented by the legacy component-owned wrapper',
);
assert.equal(
  /export const MogSpreadsheetApp = RuntimeOwnedMogSpreadsheetApp;/.test(root),
  true,
  'public MogSpreadsheetApp must route through the runtime-owned attachment controller',
);
assert.equal(
  /export const mountSpreadsheetApp = mountRuntimeOwnedSpreadsheetApp;/.test(root),
  true,
  'public mountSpreadsheetApp must route through the runtime-owned attachment controller',
);

for (const forbidden of [/disposeDocument\s*\(/, /disposeAll\s*\(/, /shell\.dispose\s*\(/]) {
  assert.equal(
    forbidden.test(appAttachment),
    false,
    `app-attachment.tsx must not tear down workbook/runtime ownership during UI detach: ${forbidden}`,
  );
}

for (const required of [
  /ACTIVE_WORKBOOK_ATTACHMENTS/,
  /SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER/,
  /await environment\?\.detach\(\)/,
  /root\.unmount\(\)/,
  /getHandleRef\.current\s*=\s*getHandle/,
  /const handle = getHandleRef\.current\(\);[\s\S]*propsRef\.current\.onReady\?\.\(handle\)/,
]) {
  assert.equal(
    required.test(appAttachment),
    true,
    `app-attachment.tsx is missing Watermark admission behavior ${required}`,
  );
}

assert.equal(
  /onReady\?\.\(handleRef\.current!\)/.test(appAttachment),
  false,
  'onReady must not depend on the optional React ref to materialize its public handle',
);

for (const required of [
  /SPREADSHEET_RUNTIME_ATTACHMENT_CONTROLLER/,
  /attachWorkbookSession/,
  /status: 'headless'/,
  /status: 'AlreadyAttached'|AlreadyAttached/,
]) {
  assert.equal(
    required.test(runtime),
    true,
    `runtime.ts is missing Watermark admission runtime attachment behavior ${required}`,
  );
}

console.log('@mog-sdk/spreadsheet-app boundary check passed');

#!/usr/bin/env node

import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  ensureCleanDir,
  findCargoTomls,
  findPackageJsons,
  listFiles,
  loadJsonc,
  minimatchPath,
  normalizeRelPath,
  optionalRun,
  readJson,
  REPO_ROOT,
  run,
  sha256File,
  writeJson,
} from './common.mjs';
import { buildPublicInventory, serializePublicInventory } from './generate-public-inventory.mjs';

function parseArgs(argv) {
  const args = {
    manifest: resolve(REPO_ROOT, 'tools/public-source/public-source-manifest.jsonc'),
    source: 'origin/dev',
    out: null,
    stagingRepo: null,
    commit: false,
    commitMessage: null,
    skipLockfiles: false,
    skipHygiene: false,
    allowWorkingTree: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest') args.manifest = resolve(argv[++i]);
    else if (arg === '--source') args.source = argv[++i];
    else if (arg === '--out') args.out = resolve(argv[++i]);
    else if (arg === '--staging-repo') args.stagingRepo = resolve(argv[++i]);
    else if (arg === '--commit') args.commit = true;
    else if (arg === '--message') args.commitMessage = argv[++i];
    else if (arg === '--skip-lockfiles') args.skipLockfiles = true;
    else if (arg === '--skip-hygiene') args.skipHygiene = true;
    else if (arg === '--allow-working-tree') args.allowWorkingTree = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.out && args.stagingRepo) {
    throw new Error('Use either --out or --staging-repo, not both');
  }
  if (args.commit && !args.stagingRepo) {
    throw new Error('--commit requires --staging-repo');
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/public-source/project-public-source.mjs [options]

Options:
  --source <rev>          Source commit-ish (default: origin/dev)
  --allow-working-tree    Allow --source WORKTREE for non-promotable local dry runs
  --out <path>            Write projection to a clean output directory
  --staging-repo <path>   Write projection into a mog-public-staging checkout
  --commit                Commit the projected tree in --staging-repo
  --message <text>        Commit message for --commit
  --skip-lockfiles        Do not regenerate pnpm-lock.yaml/Cargo.lock
  --skip-hygiene          Do not run public source hygiene after projection
`);
}

function resolveSource(source, allowWorkingTree) {
  if (source === 'WORKTREE') {
    if (!allowWorkingTree) {
      throw new Error('--source WORKTREE requires --allow-working-tree and is never promotable');
    }
    return {
      mode: 'working-tree',
      ref: 'WORKTREE',
      promotable: false,
      commit: run('git', ['rev-parse', '--verify', 'HEAD^{commit}']).trim(),
    };
  }
  const commit = run('git', ['rev-parse', '--verify', `${source}^{commit}`]).trim();
  return { mode: 'git-ref', ref: source, promotable: true, commit };
}

function prepareOutput(args, manifest) {
  if (args.stagingRepo) {
    if (!existsSync(args.stagingRepo)) {
      mkdirSync(dirname(args.stagingRepo), { recursive: true });
      run('git', ['clone', manifest.stagingRepository.url, args.stagingRepo], {
        cwd: dirname(args.stagingRepo),
        stdio: 'inherit',
      });
    }
    assertCleanStagingRepo(args.stagingRepo);
    ensureCleanDir(args.stagingRepo, { preserveGit: true, stagingRepo: true });
    return args.stagingRepo;
  }

  const out = args.out ?? mkTempOutput();
  ensureCleanDir(out);
  return out;
}

function assertCleanStagingRepo(path) {
  const status = optionalRun('git', ['status', '--porcelain'], { cwd: path });
  if (!status.ok) {
    throw new Error(
      `Staging output path is not a usable git checkout: ${path}\n${status.stderr.trim()}`,
    );
  }
  if (status.stdout.trim()) {
    throw new Error(
      `Refusing to overwrite dirty staging checkout: ${path}\n${status.stdout.trim()}`,
    );
  }
}

function mkTempOutput() {
  const prefix = resolve(tmpdir(), 'mog-public-source-');
  return run('mktemp', ['-d', `${prefix}XXXXXX`]).trim();
}

function copySourceTree(source, manifest, outRoot) {
  if (source.mode === 'working-tree') {
    for (const relPath of manifest.includePaths) {
      const from = resolve(REPO_ROOT, relPath);
      if (!existsSync(from)) {
        throw new Error(`Included path does not exist in working tree: ${relPath}`);
      }
      cpSync(from, resolve(outRoot, relPath), {
        recursive: true,
        preserveTimestamps: false,
        filter: (src) => !isIgnoredWorkingTreeCopyPath(src),
      });
    }
    return;
  }

  const tarPath = resolve(tmpdir(), `mog-public-source-${process.pid}-${Date.now()}.tar`);
  const fd = openSync(tarPath, 'w');
  const result = spawnSync(
    'git',
    ['archive', '--format=tar', source.commit, '--', ...manifest.includePaths],
    {
      cwd: REPO_ROOT,
      stdio: ['ignore', fd, 'pipe'],
      encoding: 'utf8',
      shell: false,
    },
  );
  closeSync(fd);
  if (result.status !== 0) {
    rmSync(tarPath, { force: true });
    throw new Error(`git archive failed:\n${result.stderr}`);
  }
  try {
    run('tar', ['-xf', tarPath, '-C', outRoot]);
  } finally {
    rmSync(tarPath, { force: true });
  }
}

function isIgnoredWorkingTreeCopyPath(src) {
  const normalized = normalizeRelPath(src);
  return (
    normalized.endsWith('/.DS_Store') ||
    normalized.includes('/node_modules/') ||
    normalized.includes('/target/') ||
    normalized.includes('/target-native/') ||
    normalized.includes('/target-wasm/') ||
    normalized.includes('/.tsup/') ||
    normalized.endsWith('/.tsup') ||
    normalized.includes('/.venv/') ||
    normalized.endsWith('/.venv')
  );
}

function deleteExcludedPaths(outRoot, manifest) {
  const deleted = [];
  const allPaths = listFiles(outRoot).sort((a, b) => b.length - a.length);
  for (const path of allPaths) {
    if (!(manifest.excludePaths ?? []).some((pattern) => minimatchPath(path, pattern))) continue;
    const fullPath = resolve(outRoot, path);
    if (!existsSync(fullPath)) continue;
    rmSync(fullPath, { recursive: true, force: true });
    deleted.push(path);
  }
  return deleted.sort();
}

function deleteGeneratedSourceAdjacentFiles(outRoot) {
  const deleted = [];
  for (const path of listFiles(outRoot)) {
    if (!isGeneratedSourceAdjacentFile(outRoot, path)) continue;
    rmSync(resolve(outRoot, path), { force: true });
    deleted.push(path);
  }
  return deleted.sort();
}

function isGeneratedSourceAdjacentFile(outRoot, path) {
  if (path === 'kernel/src/global.d.ts') return false;
  if (!path.includes('/src/')) return false;
  const generatedSuffixes = ['.js', '.js.map', '.d.ts', '.d.ts.map'];
  const suffix = generatedSuffixes.find((candidate) => path.endsWith(candidate));
  if (!suffix) return false;

  const sourceBase = path.slice(0, -suffix.length);
  return (
    existsSync(resolve(outRoot, `${sourceBase}.ts`)) ||
    existsSync(resolve(outRoot, `${sourceBase}.tsx`))
  );
}

function generatePnpmWorkspace(outRoot, manifest) {
  const lines = ['packages:'];
  for (const path of manifest.publicWorkspacePackages) {
    lines.push(`  - '${path}'`);
  }
  lines.push('');
  lines.push('onlyBuiltDependencies:');
  lines.push('  - esbuild');
  lines.push('');
  writeFileSync(resolve(outRoot, 'pnpm-workspace.yaml'), lines.join('\n'));
}

function generateRootPackage(outRoot, manifest) {
  const packagePath = resolve(outRoot, 'package.json');
  const pkg = readJson(packagePath);
  pkg.private = true;
  pkg.description = 'Mog public source workspace';
  pkg.license = manifest.repositoryMetadata?.license ?? 'MIT';
  pkg.packageManager = manifest.packageManager;
  pkg.repository = manifest.repositoryMetadata?.repository;
  pkg.scripts = manifest.rootPackageScripts ?? {};
  delete pkg.dependencies;
  writeJson(packagePath, pkg);
}

function generateTsconfig(outRoot, manifest) {
  const base = readJson(resolve(outRoot, 'tsconfig.json'));
  const references = [];
  for (const path of manifest.publicWorkspacePackages) {
    if (path === '.') continue;
    if (existsSync(resolve(outRoot, path, 'tsconfig.json'))) {
      references.push({ path: `./${path}` });
    }
  }
  base.references = references;
  writeJson(resolve(outRoot, 'tsconfig.json'), base);
  prunePackageTsconfigReferences(outRoot);
}

function generateGlobalTypeDeclarations(outRoot) {
  const source = resolve(outRoot, 'kernel/src/global.ts');
  const target = resolve(outRoot, 'kernel/src/global.d.ts');
  if (existsSync(source)) {
    writeFileSync(target, readFileSync(source, 'utf8'));
  }
}

function prunePackageTsconfigReferences(outRoot) {
  for (const tsconfig of listFiles(outRoot).filter((path) => path.endsWith('tsconfig.json'))) {
    if (tsconfig === 'tsconfig.json') continue;
    const path = resolve(outRoot, tsconfig);
    const config = readJson(path);
    if (!Array.isArray(config.references)) continue;

    const baseDir = dirname(path);
    const references = config.references.filter((reference) => {
      if (!reference || typeof reference.path !== 'string') return true;
      const target = resolve(baseDir, reference.path);
      return (
        existsSync(target) ||
        existsSync(resolve(target, 'tsconfig.json')) ||
        existsSync(`${target}.json`)
      );
    });
    if (references.length === config.references.length) continue;

    if (references.length > 0) {
      config.references = references;
    } else {
      delete config.references;
    }
    writeJson(path, config);
  }
}

function generateWorkspacePackages(outRoot, manifest) {
  for (const pkg of manifest.generatedWorkspacePackages ?? []) {
    if (pkg.name === '@mog/devtools') {
      generateDevtoolsFacade(outRoot, pkg.path);
      continue;
    }
    if (pkg.name === '@mog/spreadsheet-testing') {
      generateSpreadsheetTestingFacade(outRoot, pkg.path);
      continue;
    }
    throw new Error(
      `No generator registered for generated workspace package ${pkg.name} at ${pkg.path}`,
    );
  }
}

function generateDevtoolsFacade(outRoot, packageDir) {
  const root = resolve(outRoot, packageDir);
  mkdirSync(resolve(root, 'src'), { recursive: true });
  writeJson(resolve(root, 'package.json'), {
    name: '@mog/devtools',
    version: '0.1.0',
    license: 'MIT',
    private: true,
    type: 'module',
    files: ['src', 'dist'],
    exports: {
      '.': {
        development: './src/index.ts',
        types: './src/index.ts',
        import: './dist/index.js',
      },
      './shell-persistence': {
        development: './src/shell-persistence.ts',
        types: './src/shell-persistence.ts',
        import: './dist/shell-persistence.js',
      },
    },
    scripts: {
      build: 'tsc -b .',
      typecheck: 'tsc -b .',
      'check-types': 'tsc -b .',
    },
    devDependencies: {
      typescript: '^5.7.0',
    },
  });
  writeJson(resolve(root, 'tsconfig.json'), {
    extends: '../../tsconfig.json',
    compilerOptions: {
      composite: true,
      declaration: true,
      declarationMap: true,
      incremental: true,
      noEmit: false,
      rootDir: './src',
      outDir: './dist',
    },
    include: ['src/**/*'],
    exclude: [
      'node_modules',
      'dist',
      'src/**/__tests__/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  });
  writeFileSync(
    resolve(root, 'src/index.ts'),
    `export interface OSDevToolsViewportBufferEvent {
  kind: 'mutation-applied' | 'full-refresh' | 'delta-applied';
  viewportId: string;
  patchCount: number;
  skippedOutOfBounds: number;
  bufferBounds: {
    startRow: number;
    startCol: number;
    rows: number;
    cols: number;
  };
  generation: number;
  overflowPoolBytes: number;
  sampleCells?: Array<{ row: number; col: number; displayText: string | null }>;
  correlationId?: number;
}

export interface OSDevToolsHook {
  reportActor?(actorId: string, inspectionEvent: unknown): void;
  reportRender?(
    appId: string,
    componentId: string,
    phase: string,
    actualDurationMs: number,
    baseDurationMs: number,
  ): void;
  reportEvent?(event: { type: string }): void;
  reportBridgeCall?(
    bridge: string,
    method: string,
    args: unknown[],
    durationMs: number,
    result: unknown,
    error?: string,
  ): void;
  reportViewportBuffer?(event: OSDevToolsViewportBufferEvent): void;
  reportAction?(
    action: string,
    durationMs: number,
    result: { handled: boolean; error?: string; receipts?: unknown[] },
    payload?: unknown,
  ): void;
  reportReceipt?(
    receipts: Array<{
      domain: string;
      action: string;
      id: string;
      bounds?: unknown;
      object?: unknown;
    }>,
  ): void;
  reportCanvasFrame?(timings: Record<string, unknown>): void;
}

type RecordingListener = () => void;

class NoopRecordingStore {
  subscribe(_listener: RecordingListener): () => void {
    return () => {};
  }
}

const recordingStore = new NoopRecordingStore();

export function setupDevTools(): void {
  if (typeof window === 'undefined') return;
  const target = window as Window & {
    __dt?: Record<string, unknown>;
    __OS_DEVTOOLS__?: OSDevToolsHook;
  };
  target.__OS_DEVTOOLS__ ??= {};
  target.__dt ??= {};
  target.__dt.getRecording ??= () => recordingStore;
  target.__dt.isRecording ??= () => false;
  target.__dt.startRecording ??= () => undefined;
  target.__dt.stopRecording ??= () => ({ events: [], machines: {} });
  target.__dt.captureError ??= () => undefined;
  target.__dt.breadcrumb ??= () => undefined;
}

setupDevTools();
`,
  );
  writeFileSync(
    resolve(root, 'src/shell-persistence.ts'),
    `type DevToolsRecord = Record<string, unknown>;

function getDevToolsConsole(): DevToolsRecord | null {
  if (typeof window === 'undefined') return null;
  const target = window as Window & { __dt?: DevToolsRecord };
  target.__dt ??= {};
  return target.__dt;
}

function installGetter<T>(name: string, read: () => T, fallback: T): void {
  const dt = getDevToolsConsole();
  if (!dt) return;
  Object.defineProperty(dt, name, {
    configurable: true,
    enumerable: true,
    get(): T {
      try {
        return read();
      } catch {
        return fallback;
      }
    },
  });
}

export interface PersistenceEnabledReaders {
  hasAnyAppendActive(): boolean;
  lifecycleHooksRegistered(): boolean;
  bootResolutionTerminal(): boolean;
}

export function installPersistenceEnabledGetter(readers: PersistenceEnabledReaders): void {
  installGetter(
    'persistenceEnabled',
    () =>
      readers.hasAnyAppendActive() &&
      readers.lifecycleHooksRegistered() &&
      readers.bootResolutionTerminal(),
    false,
  );
}

export interface PersistenceStateReader {
  readPersistenceState(): Iterable<readonly [string, unknown]>;
}

export function installPersistenceStateGetter(reader: PersistenceStateReader): void {
  installGetter('persistenceState', () => Object.fromEntries(reader.readPersistenceState()), {});
}

export interface PersistenceProvidersReader {
  readPersistenceProviders(): Iterable<readonly [string, { providers: readonly object[] }]>;
}

export function installPersistenceProvidersGetter(reader: PersistenceProvidersReader): void {
  installGetter('persistenceProviders', () => Object.fromEntries(reader.readPersistenceProviders()), {});
}

export interface ProviderStateReaders {
  readHasAnyDocReadOnly(): boolean;
}

export function installProviderStateGetter(readers: ProviderStateReaders): void {
  installGetter('providerState', () => ({ readOnly: readers.readHasAnyDocReadOnly() }), {
    readOnly: false,
  });
}
`,
  );
}

function generateSpreadsheetTestingFacade(outRoot, packageDir) {
  const root = resolve(outRoot, packageDir);
  mkdirSync(resolve(root, 'src'), { recursive: true });
  writeJson(resolve(root, 'package.json'), {
    name: '@mog/spreadsheet-testing',
    version: '0.1.0',
    license: 'MIT',
    private: true,
    type: 'module',
    files: ['src', 'dist'],
    exports: {
      '.': {
        development: './src/index.ts',
        types: './src/index.ts',
        import: './dist/index.js',
      },
    },
    scripts: {
      build: 'tsc -b .',
      typecheck: 'tsc -b .',
      'check-types': 'tsc -b .',
    },
    devDependencies: {
      typescript: '^5.7.0',
    },
  });
  writeJson(resolve(root, 'tsconfig.json'), {
    extends: '../../tsconfig.json',
    compilerOptions: {
      composite: true,
      declaration: true,
      declarationMap: true,
      incremental: true,
      noEmit: false,
      rootDir: './src',
      outDir: './dist',
    },
    include: ['src/**/*'],
    exclude: [
      'node_modules',
      'dist',
      'src/**/__tests__/**',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
  });
  writeFileSync(
    resolve(root, 'src/index.ts'),
    `export type AssertionType = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'greaterThan' | 'lessThan' | 'isBlank' | 'isNotBlank' | 'custom';
export type AssertionSeverity = 'error' | 'warning' | 'info';

export type AssertionTarget =
  | { type: 'cell'; sheetId?: string; row: number; col: number }
  | { type: 'range'; sheetId?: string; startRow: number; startCol: number; endRow: number; endCol: number };

export interface AssertionParams {
  expected?: unknown;
  tolerance?: number;
  formula?: string;
}

export interface CellAssertion {
  id: string;
  name?: string;
  description?: string;
  target: AssertionTarget;
  type: AssertionType;
  params?: AssertionParams;
  severity?: AssertionSeverity;
  enabled?: boolean;
}

export interface TestResult {
  assertionId: string;
  passed: boolean;
  status?: 'pass' | 'fail' | 'pending';
  message?: string;
  actual?: unknown;
  expected?: unknown;
  durationMs?: number;
}

export interface TestRunSummary {
  total: number;
  passed: number;
  failed: number;
  skipped?: number;
  durationMs?: number;
}

export interface TestSuite {
  id: string;
  name: string;
  description?: string;
  assertionIds: string[];
  enabled?: boolean;
  autoRun?: boolean;
}

export interface ICellValueProvider {
  getCellValue(sheetId: string, row: number, col: number): unknown;
  getRangeValues(sheetId: string, startRow: number, startCol: number, endRow: number, endCol: number): unknown[][];
}

type Listener<T extends unknown[] = []> = (...args: T) => void;

export function createTestingFramework(_options: {
  valueProvider: ICellValueProvider;
  eventEmitter?: { emit(event: unknown): void };
}) {
  const assertions: CellAssertion[] = [];
  const suites: TestSuite[] = [];
  let autoRun = false;
  const assertionListeners = new Set<Listener>();
  const suiteListeners = new Set<Listener>();
  const completedListeners = new Set<Listener<[TestResult[], TestRunSummary]>>();
  const notifyAssertions = () => assertionListeners.forEach((listener) => listener());
  const notifySuites = () => suiteListeners.forEach((listener) => listener());
  const summaryFor = (results: TestResult[]): TestRunSummary => ({
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
  });
  const runAssertions = async (items: CellAssertion[]) => {
    const results = items.map((assertion) => ({
      assertionId: assertion.id,
      passed: true,
      status: 'pass' as const,
    }));
    const summary = summaryFor(results);
    completedListeners.forEach((listener) => listener(results, summary));
    return results;
  };
  return {
    getAllAssertions: () => [...assertions],
    listSuites: () => [...suites],
    isAutoRunEnabled: () => autoRun,
    onAssertionsChanged(listener: Listener) {
      assertionListeners.add(listener);
      return () => {
        assertionListeners.delete(listener);
      };
    },
    onSuitesChanged(listener: Listener) {
      suiteListeners.add(listener);
      return () => {
        suiteListeners.delete(listener);
      };
    },
    onTestsCompleted(listener: Listener<[TestResult[], TestRunSummary]>) {
      completedListeners.add(listener);
      return () => {
        completedListeners.delete(listener);
      };
    },
    clearHandlers() {
      assertionListeners.clear();
      suiteListeners.clear();
      completedListeners.clear();
    },
    addAssertion(assertion: Omit<CellAssertion, 'id'>): CellAssertion {
      const next = { id: crypto.randomUUID(), ...assertion };
      assertions.push(next);
      notifyAssertions();
      return next;
    },
    updateAssertion(id: string, updates: Partial<CellAssertion>) {
      Object.assign(assertions.find((assertion) => assertion.id === id) ?? {}, updates);
      notifyAssertions();
    },
    removeAssertion(id: string) {
      const index = assertions.findIndex((assertion) => assertion.id === id);
      if (index >= 0) assertions.splice(index, 1);
      notifyAssertions();
    },
    getAssertionsForCell(_sheetId: string, row: number, col: number) {
      return assertions.filter((assertion) => assertion.target.type === 'cell' && assertion.target.row === row && assertion.target.col === col);
    },
    createSuite(name: string, options: Partial<Omit<TestSuite, 'id' | 'name'>> = {}): TestSuite {
      const next = { id: crypto.randomUUID(), assertionIds: [], enabled: true, ...options, name };
      suites.push(next);
      notifySuites();
      return next;
    },
    updateSuite(id: string, updates: Partial<TestSuite>) {
      Object.assign(suites.find((suite) => suite.id === id) ?? {}, updates);
      notifySuites();
    },
    deleteSuite(id: string) {
      const index = suites.findIndex((suite) => suite.id === id);
      if (index >= 0) suites.splice(index, 1);
      notifySuites();
    },
    addAssertionsToSuite(suiteId: string, assertionIds: string[]) {
      const suite = suites.find((item) => item.id === suiteId);
      if (suite) suite.assertionIds = [...new Set([...suite.assertionIds, ...assertionIds])];
      notifySuites();
    },
    removeAssertionsFromSuite(suiteId: string, assertionIds: string[]) {
      const suite = suites.find((item) => item.id === suiteId);
      if (suite) suite.assertionIds = suite.assertionIds.filter((id) => !assertionIds.includes(id));
      notifySuites();
    },
    runAll: () => runAssertions(assertions),
    runSuite: (suiteId: string) => runAssertions(assertions.filter((assertion) => suites.find((suite) => suite.id === suiteId)?.assertionIds.includes(assertion.id))),
    runCell: (sheetId: string, row: number, col: number) => runAssertions(assertions.filter((assertion) => assertion.target.type === 'cell' && assertion.target.sheetId === sheetId && assertion.target.row === row && assertion.target.col === col)),
    runAutoRunSuites: () => runAssertions(assertions),
    setAutoRun(enabled: boolean) {
      autoRun = enabled;
    },
  };
}
`,
  );
}

function generateCargoToml(outRoot, manifest) {
  const source = readFileSync(resolve(outRoot, 'Cargo.toml'), 'utf8');
  const tailStart = source.indexOf('[workspace.package]');
  if (tailStart < 0) throw new Error('Cargo.toml is missing [workspace.package]');
  let tail = source.slice(tailStart);
  tail = tail
    .replace(/authors = \[[^\]]*\]/, 'authors = ["Mog Contributors"]')
    .replace(
      /repository = "https:\/\/github\.com\/lyfegame\/shortcut"/g,
      `repository = "${manifest.publicRepository.url}"`,
    );

  const lines = ['[workspace]', 'resolver = "2"', 'members = ['];
  for (const member of manifest.publicCargoMembers) {
    lines.push(`    "${member}",`);
  }
  lines.push(']', '', tail.trimEnd(), '');
  writeFileSync(resolve(outRoot, 'Cargo.toml'), lines.join('\n'));
}

function generatePublicInventory(outRoot, manifest) {
  const { inventory, errors } = buildPublicInventory(outRoot, manifest);
  if (errors.length > 0) {
    throw new Error(
      `public inventory generation failed:\n${errors.map((error) => `  - ${error}`).join('\n')}`,
    );
  }
  writeFileSync(
    resolve(outRoot, 'tools/package-inventory.jsonc'),
    serializePublicInventory(inventory),
  );
}

function rewritePackageDependencies(outRoot, manifest) {
  const removals = manifest.packageDependencyRemovals ?? {};
  if (Object.keys(removals).length === 0) return;

  for (const packageJson of findPackageJsons(outRoot)) {
    const path = resolve(outRoot, packageJson);
    const pkg = readJson(path);
    let changed = false;
    for (const [field, names] of Object.entries(removals)) {
      if (!pkg[field]) continue;
      for (const name of names) {
        if (name in pkg[field]) {
          delete pkg[field][name];
          changed = true;
        }
      }
      if (Object.keys(pkg[field]).length === 0) {
        delete pkg[field];
        changed = true;
      }
    }
    if (changed) writeJson(path, pkg);
  }
}

function rewritePackageMetadata(outRoot, manifest) {
  const repository = manifest.repositoryMetadata?.repository;
  const license = manifest.repositoryMetadata?.license;
  if (!repository && !license) return;

  for (const packageJson of findPackageJsons(outRoot)) {
    const path = resolve(outRoot, packageJson);
    const pkg = readJson(path);
    let changed = false;
    if (repository) {
      pkg.repository = repository;
      changed = true;
    }
    if (license) {
      pkg.license = license;
      changed = true;
    }
    if (pkg.exports && typeof pkg.exports === 'object') {
      for (const [key, value] of Object.entries(pkg.exports)) {
        if (
          key.includes('/dev/') ||
          key.startsWith('./dev/') ||
          JSON.stringify(value).includes('/src/dev/')
        ) {
          delete pkg.exports[key];
          changed = true;
          continue;
        }
        if (value && typeof value === 'object' && 'development' in value && 'types' in value) {
          value.types = value.development;
          changed = true;
        }
      }
    }
    if (changed) writeJson(path, pkg);
  }
}

function rewriteCargoMetadata(outRoot, manifest) {
  const repository = manifest.publicRepository?.url;
  if (!repository) return;

  for (const cargoToml of findCargoTomls(outRoot)) {
    const path = resolve(outRoot, cargoToml);
    let source = readFileSync(path, 'utf8');
    const rewritten = source
      .replace(/authors = \[[^\]]*\]/g, 'authors = ["Mog Contributors"]')
      .replace(
        /repository = "https:\/\/github\.com\/lyfegame\/shortcut"/g,
        `repository = "${repository}"`,
      );
    if (rewritten !== source) {
      writeFileSync(path, rewritten);
    }
  }
}

function rewritePublicSourceText(outRoot) {
  const textFilePattern =
    /\.(c|cc|cfg|cjs|cmake|cpp|css|csv|cts|h|hpp|html|ini|js|json|jsonc|jsx|lock|md|mjs|mts|py|rs|scss|sh|sql|svg|toml|ts|tsx|txt|xml|ya?ml)$/;
  const textBasenames = new Set([
    '.dockerignore',
    '.editorconfig',
    '.env.example',
    '.env.sample',
    '.env.template',
    '.gitattributes',
    '.gitignore',
    '.npmignore',
    '.nvmrc',
    'Cargo.lock',
    'Dockerfile',
    'LICENSE',
    'NOTICE',
    'README',
    'TRADEMARKS.md',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
  ]);

  for (const relPath of listFiles(outRoot)) {
    if (relPath === 'tools/public-source/public-source-manifest.jsonc') continue;
    const fullPath = resolve(outRoot, relPath);
    const basename = relPath.split('/').at(-1);
    if (!textFilePattern.test(relPath) && !textBasenames.has(basename)) continue;
    let source = readFileSync(fullPath, 'utf8');
    const rewritten = sanitizePrivatePathReferences(source);
    if (rewritten !== source) {
      writeFileSync(fullPath, rewritten);
    }
  }

  for (const relPath of [
    '.eslintrc.cjs',
    '.gitignore',
    '.prettierignore',
    'compute/wasm/.cargo/config.toml',
  ]) {
    const fullPath = resolve(outRoot, relPath);
    if (!existsSync(fullPath)) continue;
    const source = readFileSync(fullPath, 'utf8');
    const rewritten = sanitizePrivatePathReferences(source);
    if (rewritten !== source) writeFileSync(fullPath, rewritten);
  }
}

function sanitizePrivatePathReferences(source) {
  return source
    .replace(/(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*dev\/)/g, '$1public-reference/')
    .replace(/(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*plans\/)/g, '$1public-notes/')
    .replace(/(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*\.claude\/)/g, '$1public-worktrees/')
    .replace(/(^|[^A-Za-z0-9_.-/])((?:\.{1,2}\/)*agents\/skills\/)/g, '$1public-skills/')
    .replace(/(?:file:\/\/)?\/Users\/[A-Za-z0-9._-]+(?:\/[^\s"'`)<\]}]*)?/g, '/path/to/mog');
}

function generatePublicWorkflow(outRoot, manifest) {
  const nodeVersion = manifest.toolchain?.node ?? '24.6.0';
  const pnpmVersion = manifest.toolchain?.pnpm ?? '10.11.0';
  const rustVersion = manifest.toolchain?.rust ?? 'stable';
  const workflow = `name: Public Source CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: \${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  source:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v5
        with:
          version: ${pnpmVersion}
      - uses: actions/setup-node@v6
        with:
          node-version: ${nodeVersion}
          cache: pnpm
      - run: node tools/public-source/check-public-source-hygiene.mjs --root .
      - run: node tools/public-source/generate-public-inventory.mjs --root . --check

  typescript:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v5
        with:
          version: ${pnpmVersion}
      - uses: actions/setup-node@v6
        with:
          node-version: ${nodeVersion}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm validate:public-source

  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: ${rustVersion}
          components: clippy
      - run: cargo check --workspace --locked
      - run: cargo test --workspace --locked
      - run: cargo clippy --workspace --locked
`;
  const path = resolve(outRoot, '.github/workflows/public-ci.yml');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, workflow);
}

function generateThirdPartyNotices(outRoot) {
  const noticeSources = ['infra/icons/NOTICE', 'compute/core/fonts/LICENSE.md'];
  const sections = ['# Third-Party Notices', ''];
  for (const relPath of noticeSources) {
    const path = resolve(outRoot, relPath);
    if (!existsSync(path)) continue;
    sections.push(`## ${relPath}`, '', readFileSync(path, 'utf8').trim(), '');
  }
  writeFileSync(resolve(outRoot, 'THIRD_PARTY_NOTICES.md'), `${sections.join('\n').trim()}\n`);
}

function validateProjection(outRoot, manifest) {
  const errors = [];
  const workspaceDirs = new Set(manifest.publicWorkspacePackages.map(normalizeRelPath));
  const workspaceNames = new Set();

  for (const dir of workspaceDirs) {
    const packagePath = resolve(outRoot, dir, 'package.json');
    if (!existsSync(packagePath)) {
      errors.push(`${dir}: public workspace package missing package.json`);
      continue;
    }
    const pkg = readJson(packagePath);
    workspaceNames.add(pkg.name);
  }

  for (const packageJson of findPackageJsons(outRoot)) {
    if (packageJson === 'package.json') continue;
    if ((manifest.allowedPackageJsonGlobs ?? []).some((glob) => minimatchPath(packageJson, glob)))
      continue;
    const dir = normalizeRelPath(dirname(packageJson));
    if (!workspaceDirs.has(dir)) {
      errors.push(`${packageJson}: package.json is copied but not in publicWorkspacePackages`);
    }
  }

  for (const packageJson of findPackageJsons(outRoot)) {
    const pkg = readJson(resolve(outRoot, packageJson));
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const [depName, spec] of Object.entries(pkg[field] ?? {})) {
        if (
          typeof spec === 'string' &&
          spec.startsWith('workspace:') &&
          !workspaceNames.has(depName)
        ) {
          errors.push(
            `${packageJson}: ${field}.${depName} points at absent public workspace package`,
          );
        }
      }
    }
  }

  const publicCargoTomls = new Set(['Cargo.toml']);
  for (const member of manifest.publicCargoMembers) {
    publicCargoTomls.add(`${normalizeRelPath(member)}/Cargo.toml`);
  }
  for (const cargoToml of findCargoTomls(outRoot)) {
    if (publicCargoTomls.has(cargoToml)) continue;
    if (
      (manifest.allowedStandaloneCargoTomlGlobs ?? []).some((glob) =>
        minimatchPath(cargoToml, glob),
      )
    )
      continue;
    errors.push(`${cargoToml}: copied Cargo.toml is not a public workspace member`);
  }

  const workflowFiles = listFiles(resolve(outRoot, '.github/workflows')).filter(
    (path) => path.endsWith('.yml') || path.endsWith('.yaml'),
  );
  for (const workflow of workflowFiles) {
    if (workflow !== 'public-ci.yml') {
      errors.push(`.github/workflows/${workflow}: workflow is not generated/allowlisted`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `projection validation failed:\n${errors
        .sort()
        .map((error) => `  - ${error}`)
        .join('\n')}`,
    );
  }
}

function regenerateLockfiles(outRoot) {
  run('pnpm', ['install', '--lockfile-only'], { cwd: outRoot, stdio: 'inherit' });
  run('cargo', ['generate-lockfile'], { cwd: outRoot, stdio: 'inherit' });
}

function runHygiene(outRoot) {
  run('node', ['tools/public-source/check-public-source-hygiene.mjs', '--root', '.'], {
    cwd: outRoot,
    stdio: 'inherit',
  });
}

function commitStaging(outRoot, source, manifest, args) {
  const status = optionalRun('git', ['status', '--porcelain'], { cwd: outRoot });
  if (!status.stdout.trim()) {
    console.log('staging repo unchanged; no commit created');
    return null;
  }
  run('git', ['add', '-A'], { cwd: outRoot, stdio: 'inherit' });
  const message =
    args.commitMessage ??
    `Project public source from ${source.ref} (${source.commit.slice(0, 12)})

Manifest: ${sha256File(args.manifest)}
Source ref: ${source.ref}
Source: ${source.commit}
Public repo: ${manifest.publicRepository.url}`;
  const identity = manifest.publicCommitIdentity;
  if (!identity?.name || !identity?.email) {
    throw new Error(
      'publicCommitIdentity.name and publicCommitIdentity.email are required for staging commits',
    );
  }
  run('git', ['commit', '-m', message], {
    cwd: outRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    },
  });
  return run('git', ['rev-parse', '--verify', 'HEAD^{commit}'], { cwd: outRoot }).trim();
}

function collectVersions(outRoot) {
  const commands = {
    node: ['node', ['--version']],
    pnpm: ['pnpm', ['--version']],
    rustc: ['rustc', ['--version']],
    cargo: ['cargo', ['--version']],
    git: ['git', ['--version']],
  };
  const versions = {};
  for (const [key, [command, args]] of Object.entries(commands)) {
    const result = optionalRun(command, args, { cwd: outRoot });
    versions[key] = result.ok ? result.stdout.trim() : null;
  }
  return versions;
}

function writeReport(outRoot, source, manifest, args, deleted, stagingCommit) {
  const files = listFiles(outRoot);
  const report = {
    generatedAt: new Date().toISOString(),
    sourceInternalCommit: source.commit,
    sourceRef: source.ref,
    sourceMode: source.mode,
    promotable: source.promotable && !args.skipHygiene && !args.skipLockfiles,
    projectionManifest: normalizeRelPath(relative(REPO_ROOT, args.manifest)),
    projectionManifestHash: sha256File(args.manifest),
    publicRepository: manifest.publicRepository,
    stagingRepository: manifest.stagingRepository,
    stagingCommit,
    publicCommitIdentity: manifest.publicCommitIdentity,
    toolVersions: collectVersions(outRoot),
    includedPathCount: manifest.includePaths.length,
    excludedPathCount: deleted.length,
    outputFileCount: files.length,
    includedWorkspacePackageCount: manifest.publicWorkspacePackages.length,
    includedRustWorkspaceMemberCount: manifest.publicCargoMembers.length,
    generatedFiles: manifest.generatedFiles,
    lockfilesGenerated: !args.skipLockfiles,
    hygieneRun: !args.skipHygiene,
    verificationCommands: manifest.verificationCommands,
  };
  const reportPath = resolve(outRoot, 'public-source-projection-report.json');
  writeJson(reportPath, report);
  return reportPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = loadJsonc(args.manifest);
  const source = resolveSource(args.source, args.allowWorkingTree);
  const outRoot = prepareOutput(args, manifest);

  console.log(`projecting ${source.mode} ${source.ref} (${source.commit}) -> ${outRoot}`);
  copySourceTree(source, manifest, outRoot);
  const deleted = deleteExcludedPaths(outRoot, manifest);
  deleted.push(...deleteGeneratedSourceAdjacentFiles(outRoot));

  generatePnpmWorkspace(outRoot, manifest);
  generateRootPackage(outRoot, manifest);
  generateWorkspacePackages(outRoot, manifest);
  generateTsconfig(outRoot, manifest);
  generateGlobalTypeDeclarations(outRoot);
  generateCargoToml(outRoot, manifest);
  rewriteCargoMetadata(outRoot, manifest);
  generatePublicInventory(outRoot, manifest);
  rewritePackageDependencies(outRoot, manifest);
  rewritePackageMetadata(outRoot, manifest);
  generatePublicWorkflow(outRoot, manifest);
  generateThirdPartyNotices(outRoot);
  rewritePublicSourceText(outRoot);
  validateProjection(outRoot, manifest);

  if (!args.skipHygiene) runHygiene(outRoot);
  if (!args.skipLockfiles) regenerateLockfiles(outRoot);
  if (!args.skipHygiene) runHygiene(outRoot);

  const reportPath = writeReport(outRoot, source, manifest, args, deleted, null);
  const stagingCommit = args.commit ? commitStaging(outRoot, source, manifest, args) : null;
  if (stagingCommit) console.log(`staging commit: ${stagingCommit}`);
  console.log(`projection report: ${reportPath}`);
  console.log(`projection output: ${outRoot}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    console.error(error.stack ?? error.message);
    process.exit(1);
  }
}
